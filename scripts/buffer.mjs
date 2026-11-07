// Petit client de l'API Buffer (GraphQL, https://api.buffer.com). Clé : secret BUFFER_API_KEY (clé personnelle, 1 an).
// Limites du plan gratuit : 150 requêtes / 15 min, 600 / 24 h, 1 000 par chaîne reliée / 30 jours. On les économise :
// chaque réponse donne les requêtes restantes (en-têtes RateLimit), gardées dans RL.
export const KEY = process.env.BUFFER_API_KEY || '';
export const RL = { calls: 0 };
function readLimits(h) {
  // RateLimit: "...;r=12;t=3600" et RateLimit-Policy: "...;q=2000;w=2592000" (une entrée par fenêtre)
  const lim = (h.get('ratelimit') || '').split(',').map((s) => Object.fromEntries(s.split(';').map((kv) => kv.trim().split('=')).filter((p) => p.length === 2)));
  const pol = (h.get('ratelimit-policy') || '').split(',').map((s) => Object.fromEntries(s.split(';').map((kv) => kv.trim().split('=')).filter((p) => p.length === 2)));
  pol.forEach((p, i) => { const w = +p.w; const l = lim[i] || {}; if (w) RL[w >= 2e6 ? 'month' : w >= 8e4 ? 'day' : 'q15'] = { quota: +p.q, left: +l.r, resetIn: +l.t }; });
}
export async function gql(query, variables = {}) {
  RL.calls++;
  const r = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ query, variables }),
  });
  readLimits(r.headers);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) {
    const e = new Error(`Buffer ${r.status} ${JSON.stringify(j.errors || j).slice(0, 400)}`);
    if (r.status === 429 || /RATE_LIMIT/.test(e.message)) { e.rateLimited = true; e.window = (j.errors?.[0]?.extensions?.window) || ''; e.retryAfter = +r.headers.get('retry-after') || 0; }
    throw e;
  }
  return j.data;
}
/** Organisation et chaînes (comptes reliés) : { orgId, channels: [{ id, service, name }] } */
export async function channels() {
  const d = await gql('query { account { organizations { id name } } }');
  const orgId = d.account.organizations[0].id;
  const c = await gql('query($o: OrganizationId!) { channels(input: { organizationId: $o }) { id service name } }', { o: orgId });
  return { orgId, channels: c.channels };
}
