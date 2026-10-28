# Bible Academy — publication sur les réseaux

Dépôt public qui sert à deux choses :
1. **héberger les images et vidéos** des publications (`media/`, servi par GitHub Pages) : Instagram et TikTok vont les chercher à une adresse publique ;
2. **publier à l'heure prévue** : `.github/workflows/publish.yml` tourne toutes les 15 minutes, lit `queue/*.json` et publie sur Instagram ce qui est dû. Le résultat est noté dans `state/published.json`.

Le contenu est fabriqué chaque nuit dans le dépôt privé `bible-academy` (dossier `social/`), puis copié ici.

Secrets (Settings → Secrets and variables → Actions) : `IG_ACCESS_TOKEN`. Variable : `IG_USER_ID` (17841467603931873).
