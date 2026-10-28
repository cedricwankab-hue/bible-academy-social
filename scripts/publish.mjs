// Bible Academy — publication planifiée (Instagram ; TikTok à venir).
// Lancé toutes les 15 min par .github/workflows/publish.yml. Lit queue/*.json, publie ce qui est dû, note le résultat dans state/published.json.
// Secrets : IG_ACCESS_TOKEN (clé longue durée de @bibleacademyapp). Variables : IG_USER_ID, GRAPH_VERSION (défaut v23.0), DRY_RUN=1 pour tester sans publier.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const V = process.env.GRAPH_VERSION || 'v23.0';
const IG = `https://graph.instagram.com/${V}`;
const TOKEN = process.env.IG_ACCESS_TOKEN || '';
const IG_USER = process.env.IG_USER_ID || '17841467603931873';
const DRY = process.env.DRY_RUN === '1';
const ONLY = process.env.ONLY_ID || '';          // pour publier un seul élément à la main (workflow_dispatch)
const NOW = Date.now();

const statePath = path.join(ROOT, 'state/published.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { published: {}, errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function ig(method, p, params = {}) {
  const u = new URL(IG + p);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = method === 'GET' ? await fetch(u + '?' + body) : await fetch(u, { method, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return j;
}
async function waitReady(id, label) {
  for (let i = 0; i < 40; i++) {               // jusqu'à ~6 min (vidéos)
    const s = await ig('GET', `/${id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`${label} : traitement Instagram ${s.status_code} ${s.status || ''}`);
    await sleep(9000);
  }
  throw new Error(`${label} : Instagram n'a pas fini le traitement à temps`);
}

async function publishIG(item) {
  let creation;
  if (item.kind === 'carousel') {
    const children = [];
    for (const url of item.media.slice(0, 10)) {
      const c = await ig('POST', `/${IG_USER}/media`, { image_url: url, is_carousel_item: 'true' });
      children.push(c.id);
    }
    for (const c of children) await waitReady(c, 'image');
    creation = (await ig('POST', `/${IG_USER}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: item.caption })).id;
  } else if (item.kind === 'reel') {
    const p = { media_type: 'REELS', video_url: item.media[0], caption: item.caption, share_to_feed: 'true' };
    if (item.cover) p.cover_url = item.cover;
    creation = (await ig('POST', `/${IG_USER}/media`, p)).id;
  } else if (item.kind === 'image') {
    creation = (await ig('POST', `/${IG_USER}/media`, { image_url: item.media[0], caption: item.caption })).id;
  } else throw new Error('type inconnu : ' + item.kind);
  await waitReady(creation, item.kind);
  const pub = await ig('POST', `/${IG_USER}/media_publish`, { creation_id: creation });
  const info = await ig('GET', `/${pub.id}`, { fields: 'permalink,timestamp' }).catch(() => ({}));
  return { mediaId: pub.id, permalink: info.permalink || null };
}

// file d'attente : queue/<date>.json → { items: [{ id, platform, kind, at (ISO), media: [urls], cover?, caption }] }
const items = fs.readdirSync(path.join(ROOT, 'queue')).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(ROOT, 'queue', f), 'utf8')).items || []).map((x) => ({ ...x, file: f })));

const due = items.filter((x) => x.platform === 'ig' && !state.published[x.id] && (ONLY ? x.id === ONLY : Date.parse(x.at) <= NOW && NOW - Date.parse(x.at) < 6 * 3600e3));
log(`${items.length} éléments en file, ${due.length} à publier maintenant${DRY ? ' (essai, rien n’est publié)' : ''}`);
if (due.length && !TOKEN && !DRY) { console.error('IG_ACCESS_TOKEN manquant'); process.exit(1); }

let changed = false;
for (const item of due.slice(0, 3)) {          // au plus 3 par passage
  try {
    log('→', item.id, item.kind, item.media.length, 'fichier(s)');
    const res = DRY ? { mediaId: 'dry-run', permalink: null } : await publishIG(item);
    state.published[item.id] = { platform: 'ig', kind: item.kind, at: new Date().toISOString(), planned: item.at, ...res };
    log('✓', item.id, res.permalink || res.mediaId);
    changed = true;
  } catch (e) {
    log('✗', item.id, e.message);
    state.errors.push({ id: item.id, at: new Date().toISOString(), error: e.message.slice(0, 400) });
    state.errors = state.errors.slice(-50);
    changed = true;
  }
}
if (changed && !DRY) fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
