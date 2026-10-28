// Vérifie la clé Instagram et la prolonge (une clé longue durée vaut 60 jours ; la prolonger chaque semaine la garde valide).
// Instagram renvoie une nouvelle clé : on ne peut pas réécrire un secret GitHub depuis une Action sans clé d'admin,
// donc on se contente de prolonger celle en place (le jeton actuel reste valable 60 jours de plus) et d'alerter si elle expire bientôt.
const TOKEN = process.env.IG_ACCESS_TOKEN || '';
if (!TOKEN) { console.error('IG_ACCESS_TOKEN manquant'); process.exit(1); }
const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(TOKEN));
const j = await r.json();
if (!r.ok || j.error) { console.error('Prolongation refusée :', JSON.stringify(j.error || j).slice(0, 300)); process.exit(1); }
console.log('Clé prolongée, valable encore', Math.round(j.expires_in / 86400), 'jours');
