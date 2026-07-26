# OV3RSTREAM FR — déployer TON addon (gratuit, sur Render)

Ton addon = ton code, ta page, ton nom, ton logo. Aucun "AIOStreams"/"StreamFusion".

## Ce qu'il fait
- Page brandée `/configure` (ton logo + nom) où chacun colle SA clé AllDebrid.
- Cherche films (YTS) et séries (EZTV) → passe par AllDebrid → renvoie des liens streamables à Stremio.
- Chaque utilisateur a sa propre clé (rien stocké côté serveur).

## Déployer sur Render (gratuit)
1. Mets ces fichiers dans un dépôt **GitHub** (nouveau repo → upload de tout le dossier).
2. Sur [Render](https://dashboard.render.com) → **New +** → **Web Service** → connecte ton repo GitHub.
3. Render détecte Node tout seul :
   - Build Command : `npm install`
   - Start Command : `node server.js`
   - Instance : **Free**
4. Deploy. Ton URL sera du type `https://ov3rstream.onrender.com`.
5. Ta page = `https://ov3rstream.onrender.com/configure`

> Alternative : le `Dockerfile` est fourni si tu préfères déployer en image Docker.

## Utiliser / partager
- Ouvre `/configure` → colle ta clé AllDebrid → **Générer** → **Installer dans Stremio**.
- Pour partager : tu donnes le lien `/configure`. Chacun met sa clé.

## Bon à savoir
- Sources publiques (YTS/EZTV) = plutôt internationales/VO. Pour du VF pur il faudrait un tracker privé (voir plus bas).
- Free Render : mise en veille après 15 min → ~50s au 1er lancement.
- `SECRET`/clés : aucune clé en dur, tout est dans le lien perso de chaque utilisateur.
