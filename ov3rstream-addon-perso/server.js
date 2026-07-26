/* ============================================================
   OV3RSTREAM FR — addon Stremio perso
   Page brandée + AllDebrid + sources publiques (YTS / EZTV)
   Paramètres : langue (VF/MULTi/VOSTFR) + résolutions.
   ============================================================ */

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 7000;

const AGENT = 'ov3rstream';
const ADDON_ID = 'com.ov3rdrive.ov3rstream';
const ADDON_NAME = 'OV3RSTREAM FR';

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

/* ---------- aides ---------- */
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const dec = (str) => { try { return JSON.parse(Buffer.from(str, 'base64url').toString()); } catch { return null; } };
const fetchJSON = async (url, opts) => { const r = await fetch(url, opts); return r.json(); };
const human = (b) => { if (!b) return ''; const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; b = +b; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return b.toFixed(1) + ' ' + u[i]; };
const FR_RE = /(vff|vfi|vfq|\bvf\b|multi|truefrench|french|vostfr|fre?nch)/i;

/* ---------- sources publiques ---------- */
async function ytsMovie(imdb) {
  try {
    const j = await fetchJSON(`https://yts.mx/api/v2/list_movies.json?query_term=${imdb}`);
    const m = j?.data?.movies?.[0];
    if (!m) return [];
    return (m.torrents || []).map(t => ({
      quality: t.quality, size: t.size_bytes || t.size, seeds: t.seeds,
      hash: t.hash.toLowerCase(), name: `${m.title} (${m.year}) ${t.quality}`
    }));
  } catch { return []; }
}
async function eztvEpisode(imdb, season, episode) {
  try {
    const id = imdb.replace('tt', '');
    const j = await fetchJSON(`https://eztvx.to/api/get-torrents?imdb_id=${id}&limit=100`);
    const s2 = String(season).padStart(2, '0'), e2 = String(episode).padStart(2, '0');
    const re = new RegExp(`s${s2}e${e2}`, 'i');
    return (j?.torrents || []).filter(t => re.test(t.title)).map(t => ({
      quality: /2160|4k/i.test(t.title) ? '2160p' : /1080/i.test(t.title) ? '1080p' : /720/i.test(t.title) ? '720p' : 'SD',
      size: t.size_bytes, seeds: t.seeds, hash: (t.hash || '').toLowerCase(), name: t.title
    })).filter(x => x.hash);
  } catch { return []; }
}

/* ---------- AllDebrid ---------- */
const AD = 'https://api.alldebrid.com/v4';
async function adResolve(apikey, hash) {
  const up = await fetchJSON(`${AD}/magnet/upload?agent=${AGENT}&apikey=${apikey}&magnets[]=${hash}`);
  const info = up?.data?.magnets?.[0];
  if (!info || info.error) return null;
  if (info.ready === false && !info.instant) return null;
  const st = await fetchJSON(`${AD}/magnet/status?agent=${AGENT}&apikey=${apikey}&id=${info.id}`);
  const files = st?.data?.magnets?.links || st?.data?.magnets?.[0]?.links || [];
  if (!files.length) return null;
  const vids = files.filter(f => /\.(mkv|mp4|avi|mov|m4v)$/i.test(f.filename || f.link || ''));
  const pick = (vids.length ? vids : files).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  if (!pick) return null;
  const un = await fetchJSON(`${AD}/link/unlock?agent=${AGENT}&apikey=${apikey}&link=${encodeURIComponent(pick.link)}`);
  const url = un?.data?.link;
  return url ? { url, size: pick.size } : null;
}

/* ---------- manifest ---------- */
function manifest(host, configured) {
  return {
    id: ADDON_ID, version: '1.0.0', name: ADDON_NAME,
    description: 'Films & séries en streaming via AllDebrid — addon perso OV3RSTREAM FR.',
    logo: `${host}/public/logo.png`,
    background: `${host}/public/banner.png`,
    resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt'],
    behaviorHints: { configurable: true, configurationRequired: !configured }
  };
}

/* ---------- routes Stremio ---------- */
app.get('/manifest.json', (req, res) => {
  res.json(manifest(`${req.protocol}://${req.get('host')}`, false));
});
app.get('/:cfg/manifest.json', (req, res) => {
  const cfg = dec(req.params.cfg);
  res.json(manifest(`${req.protocol}://${req.get('host')}`, !!(cfg && cfg.ad)));
});

app.get('/:cfg/stream/:type/:id.json', async (req, res) => {
  const cfg = dec(req.params.cfg);
  if (!cfg || !cfg.ad) return res.json({ streams: [] });
  const { type } = req.params;
  const parts = req.params.id.replace('.json', '').split(':');
  const imdb = parts[0];
  const allowedRes = (cfg.res && cfg.res.length) ? cfg.res : ['2160p', '1080p', '720p', 'SD'];
  const preferFR = !!cfg.fr;

  let torrents = [];
  if (type === 'movie') torrents = await ytsMovie(imdb);
  else if (type === 'series') torrents = await eztvEpisode(imdb, parts[1], parts[2]);

  // filtre résolution
  torrents = torrents.filter(t => allowedRes.includes(t.quality));
  // tri : FR d'abord si demandé, puis seeds
  torrents.sort((a, b) => {
    if (preferFR) {
      const fa = FR_RE.test(a.name) ? 1 : 0, fb = FR_RE.test(b.name) ? 1 : 0;
      if (fb - fa) return fb - fa;
    }
    return (b.seeds || 0) - (a.seeds || 0);
  });
  torrents = torrents.slice(0, 10);

  const streams = [];
  await Promise.all(torrents.map(async (t) => {
    try {
      const r = await adResolve(cfg.ad, t.hash);
      if (r) {
        const fr = FR_RE.test(t.name) ? ' 🇫🇷' : '';
        streams.push({
          _q: t.quality,
          name: `OV3RSTREAM${fr}\n${t.quality}`,
          title: `${t.name}\n⚡ AllDebrid · 👤 ${t.seeds || '?'} · 💾 ${human(t.size)}`,
          url: r.url,
          behaviorHints: { bingeGroup: `ov3r-${t.quality}` }
        });
      }
    } catch {}
  }));
  const order = { '2160p': 4, '1080p': 3, '720p': 2, 'SD': 1 };
  streams.sort((a, b) => (order[b._q] || 0) - (order[a._q] || 0));
  streams.forEach(s => delete s._q);
  res.json({ streams });
});

/* ---------- page de config brandée ---------- */
function configPage() {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OV3RSTREAM FR</title>
<style>
:root{--acc:#7c5cff;--acc2:#39d0d8;--bg:#0c0d14;--panel:#161824;--line:#2a2d42;--ink:#eceefb;--mut:#9fa3c4}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
background:radial-gradient(1100px 620px at 80% -10%,#211d40 0%,var(--bg) 55%);color:var(--ink);min-height:100vh}
.wrap{max-width:560px;margin:0 auto;padding:50px 22px 80px;text-align:center}
img.logo{width:120px;height:120px;filter:drop-shadow(0 10px 30px rgba(124,92,255,.45))}
h1{font-size:30px;margin:16px 0 4px;font-weight:800;letter-spacing:.5px}h1 .c{color:var(--acc2)}
.sub{color:var(--mut);font-size:15px;margin:0 auto;max-width:430px}
.badge{display:inline-block;font-size:12px;color:var(--acc2);border:1px solid var(--line);border-radius:999px;padding:5px 13px;margin-top:14px;letter-spacing:.1em;text-transform:uppercase}
.card{background:linear-gradient(180deg,var(--panel),#12131d80);border:1px solid var(--line);border-radius:18px;padding:24px 22px;margin:24px 0;text-align:left}
label.lb{font-size:12.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
input.k{width:100%;margin-top:8px;padding:13px 14px;border-radius:11px;border:1px solid var(--line);background:#0e0f18;color:#fff;font-size:15px}
input.k:focus{outline:none;border-color:var(--acc)}
.hint{font-size:12.5px;color:var(--mut);margin-top:8px}.hint a{color:var(--acc2)}
.sect{margin-top:22px}
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:10px}
.chip{user-select:none;cursor:pointer;border:1px solid var(--line);background:#0e0f18;color:#cdd2f0;border-radius:10px;padding:9px 14px;font-size:14px}
.chip.on{background:linear-gradient(90deg,var(--acc),#5a3fe0);color:#fff;border-color:transparent}
button.go{width:100%;margin-top:22px;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,var(--acc),#5a3fe0);color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.out{display:none;margin-top:18px}.out.show{display:block}
.linkbox{background:#0e0f18;border:1px solid var(--line);border-radius:11px;padding:12px;font-family:ui-monospace,monospace;font-size:12px;color:#cdd6ff;word-break:break-all}
.row{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.btn2{flex:1;text-align:center;padding:12px;border-radius:11px;text-decoration:none;font-weight:700;font-size:14px}
.install{background:var(--acc2);color:#04212a}.copy{background:#22253a;color:#fff;border:1px solid var(--line);cursor:pointer}
.foot{color:var(--mut);font-size:12.5px;margin-top:28px}
</style></head><body>
<div class="wrap">
  <img class="logo" src="/public/logo.png" alt="OV3RSTREAM FR">
  <h1>OV3R<span class="c">STREAM</span> FR</h1>
  <p class="sub">Ton addon Stremio. Films & séries en streaming direct via AllDebrid. Configure, installe, profite.</p>
  <div class="badge">🎬 Streaming · AllDebrid</div>

  <div class="card">
    <label class="lb" for="ad">Clé API AllDebrid</label>
    <input id="ad" class="k" type="text" placeholder="Colle ta clé AllDebrid ici" autocomplete="off" spellcheck="false">
    <div class="hint">Pas de clé ? Génère-la sur <a href="https://alldebrid.com/apikeys/" target="_blank">alldebrid.com/apikeys</a>.</div>

    <div class="sect">
      <label class="lb">Résolutions</label>
      <div class="chips" id="res">
        <div class="chip on" data-v="2160p">4K · 2160p</div>
        <div class="chip on" data-v="1080p">1080p</div>
        <div class="chip on" data-v="720p">720p</div>
        <div class="chip" data-v="SD">SD</div>
      </div>
    </div>

    <div class="sect">
      <label class="lb">Langue</label>
      <div class="chips" id="lang">
        <div class="chip" data-v="fr">🇫🇷 Privilégier VF / MULTi / VOSTFR</div>
      </div>
      <div class="hint">Active pour faire remonter les versions FR quand elles existent dans les sources.</div>
    </div>

    <button class="go" id="go">Générer mon lien d'installation</button>

    <div class="out" id="out">
      <label class="lb">Ton lien d'installation</label>
      <div class="linkbox" id="murl"></div>
      <div class="row">
        <a class="btn2 install" id="install" href="#">📲 Installer dans Stremio</a>
        <button class="btn2 copy" id="copy">📋 Copier</button>
      </div>
    </div>
  </div>

  <div class="foot">OV3RSTREAM FR · films & séries · propulsé par AllDebrid</div>
</div>
<script>
  const host = location.origin;
  const b64 = (o)=>btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>c.classList.toggle('on'));
  document.getElementById('go').onclick=()=>{
    const ad=document.getElementById('ad').value.trim();
    if(!ad){alert('Colle ta clé AllDebrid.');return;}
    const res=[...document.querySelectorAll('#res .chip.on')].map(c=>c.dataset.v);
    const fr=document.querySelector('#lang .chip.on')?true:false;
    const cfg=b64({ad,res,fr});
    const manifest=host+'/'+cfg+'/manifest.json';
    document.getElementById('murl').textContent=manifest;
    document.getElementById('install').href='stremio://'+manifest.replace(/^https?:\\/\\//,'');
    document.getElementById('out').classList.add('show');
  };
  document.getElementById('copy').onclick=()=>{
    navigator.clipboard.writeText(document.getElementById('murl').textContent);
    document.getElementById('copy').textContent='✓ Copié';
    setTimeout(()=>document.getElementById('copy').textContent='📋 Copier',1500);
  };
</script>
</body></html>`;
}

app.get(['/', '/configure', '/:cfg/configure'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(configPage());
});

app.listen(PORT, () => console.log(`OV3RSTREAM FR en écoute sur :${PORT}`));
