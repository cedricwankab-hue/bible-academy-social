// Vérifie la clé Instagram sans rien publier : compte relié, type de compte, quota de publication. Écrit state/check.json (aucun secret).
import fs from 'node:fs';
const V = process.env.GRAPH_VERSION || 'v23.0', T = process.env.IG_ACCESS_TOKEN || '';
const get = async (p, q) => { const r = await fetch(`https://graph.instagram.com/${V}${p}?${new URLSearchParams({ ...q, access_token: T })}`); return r.json(); };
const out = { at: new Date().toISOString(), tokenPresent: !!T };
try {
  out.me = await get('/me', { fields: 'user_id,username,account_type,followers_count,media_count' });
  const id = out.me.user_id || out.me.id;
  if (id) out.limit = await get(`/${id}/content_publishing_limit`, { fields: 'config,quota_usage' });
} catch (e) { out.error = e.message; }
fs.writeFileSync('state/check.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
