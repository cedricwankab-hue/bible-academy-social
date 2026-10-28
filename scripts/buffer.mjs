// Petit client de l'API Buffer (GraphQL, https://api.buffer.com). Clé : secret BUFFER_API_KEY (clé personnelle, 1 an).
export const KEY = process.env.BUFFER_API_KEY || '';
export async function gql(query, variables = {}) {
  const r = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(`Buffer ${r.status} ${JSON.stringify(j.errors || j).slice(0, 400)}`);
  return j.data;
}
/** Organisation et chaînes (comptes reliés) : { orgId, channels: [{ id, service, name }] } */
export async function channels() {
  const d = await gql('query { account { organizations { id name } } }');
  const orgId = d.account.organizations[0].id;
  const c = await gql('query($o: OrganizationId!) { channels(input: { organizationId: $o }) { id service name } }', { o: orgId });
  return { orgId, channels: c.channels };
}
