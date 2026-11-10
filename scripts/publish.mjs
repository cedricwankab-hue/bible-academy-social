// Bible Academy — publication planifiée : Instagram en direct (API officielle), TikTok et Facebook via Buffer.
// Lancé toutes les 15 min par .github/workflows/publish.yml. Lit queue/*.json, publie ce qui est dû, note le résultat dans state/published.json.
// Secrets : IG_ACCESS_TOKEN (clé longue durée de @bibleacademyapp), BUFFER_API_KEY (clé personnelle Buffer). Variables : IG_USER_ID, GRAPH_VERSION (défaut v23.0), DRY_RUN=1 pour tester sans publier.
import fs from 'node:fs';
import path from 'node:path';
import { gql, channels, RL, KEY as BUFFER_KEY } from './buffer.mjs';

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
  let pub;
  try { pub = await ig('POST', `/${IG_USER}/media_publish`, { creation_id: creation }); }
  catch (e) {
    // Instagram répond parfois « action is blocked » alors que le post est bien sorti : on vérifie avant de conclure à un échec
    await sleep(20000);
    const found = await findPublished(item);
    if (found) { log('publié malgré l’erreur Instagram :', item.id); return { ...found, note: 'publié malgré une erreur Instagram' }; }
    throw e;
  }
  const info = await ig('GET', `/${pub.id}`, { fields: 'permalink,timestamp' }).catch(() => ({}));
  return { mediaId: pub.id, permalink: info.permalink || null };
}
// cherche parmi les derniers posts du compte un post avec la même légende (début), publié dans les dernières 8 h
async function findPublished(item) {
  const head = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const r = await ig('GET', `/${IG_USER}/media`, { fields: 'id,caption,permalink,timestamp', limit: '25' }).catch(() => ({ data: [] }));
  const m = (r.data || []).find((x) => head(x.caption) === head(item.caption) && Date.now() - Date.parse(x.timestamp) < 8 * 3600e3);
  return m ? { mediaId: m.id, permalink: m.permalink || null } : null;
}

// ——— TikTok et Facebook : on confie chaque publication à Buffer ~1 h avant son heure, Buffer la publie à l'heure exacte ———
const SERVICE = { tt: 'tiktok', fb: 'facebook', yt: 'youtube' };
const CONFIG = fs.existsSync(path.join(ROOT, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) : {};
// TikTok en mode « notification » : Cédric reçoit un rappel Buffer et ajoute lui-même un son TikTok tendance avant de publier
const night = (iso) => {
  const n = CONFIG.tiktokAutoAtNight; if (!n) return false;
  const hm = new Intl.DateTimeFormat('fr-FR', { timeZone: n.tz || 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  return n.from > n.to ? (hm >= n.from || hm < n.to) : (hm >= n.from && hm < n.to);
};
const scheduling = (item) => (item.platform === 'tt' && CONFIG.tiktokMode === 'notification' && !night(item.at) ? 'notification' : 'automatic');
let chans;
async function publishBuffer(item) {
  chans ??= CONFIG.bufferChannels?.length ? CONFIG.bufferChannels : (await channels()).channels;
  const ch = chans.find((c) => String(c.service).toLowerCase() === SERVICE[item.platform]);
  if (!ch) throw new Error(`aucune chaîne ${SERVICE[item.platform]} reliée dans Buffer`);
  const video = item.kind === 'reel' || item.kind === 'video';
  const assets = video
    ? [{ video: { url: item.media[0], ...(item.platform === 'tt' && item.thumbMs ? { metadata: { thumbnailOffset: item.thumbMs } } : {}) } }]
    : item.media.slice(0, item.platform === 'tt' ? 35 : 10).map((url) => ({ image: { url } }));
  const firstLine = item.caption.split('\n').find((l) => l.trim()) || '';
  // YouTube : Shorts (vidéo verticale de moins de 3 min), catégorie 27 = Éducation, pas « pour enfants »
  const metadata = item.platform === 'fb' ? { facebook: { type: video ? 'reel' : 'post' } }
    : item.platform === 'yt' ? { youtube: { title: (item.title || firstLine).replace(/#\w+/g, '').trim().slice(0, 90) + ' #Shorts', categoryId: '27', madeForKids: false, notifySubscribers: true } }
    : { tiktok: { title: (item.title || firstLine).slice(0, 90) } };
  const dueAt = new Date(Math.max(Date.parse(item.at), Date.now() + 3 * 60e3)).toISOString();
  const d = await gql(`mutation($input: CreatePostInput!) { createPost(input: $input) {
      __typename ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } } }`,
    { input: { channelId: ch.id, text: item.caption, schedulingType: scheduling(item), mode: 'customScheduled', dueAt, assets, ...(metadata ? { metadata } : {}) } });
  const r = d.createPost;
  if (!r.post) throw new Error('Buffer refuse (' + r.__typename + ') : ' + (r.message || JSON.stringify(r)));
  return { via: 'buffer', bufferId: r.post.id, status: 'scheduled', mode: scheduling(item), dueAt: r.post.dueAt || dueAt, permalink: null };
}
/** Met à jour les publications confiées à Buffer : envoyée (lien) ou erreur. Économe : on ne regarde un post qu'après son heure
 *  (+15 min), au plus une fois toutes les 3 h et 3 fois en tout. */
async function syncBuffer() {
  if (frugal()) return 0;   // quota presque vide : on ne vérifie plus l'envoi (Buffer publie quand même)
  const open = Object.entries(state.published).filter(([, v]) => v.via === 'buffer' && v.status === 'scheduled'
    && Date.now() > Date.parse(v.dueAt || v.planned) + 15 * 60e3 && (!v.checkedAt || Date.now() - Date.parse(v.checkedAt) > 3 * 3600e3) && (v.checks || 0) < 3);
  let n = 0;
  for (const [id, v] of open.slice(0, 8)) {
    try {
      v.checkedAt = new Date().toISOString(); v.checks = (v.checks || 0) + 1; n++;
      const d = await gql('query($id: PostId!) { post(input: { id: $id }) { id status externalLink sentAt error { message } } }', { id: v.bufferId });
      const p = d.post; if (!p) continue;
      const st = String(p.status).toLowerCase();
      if (st === 'sent') { Object.assign(v, { status: 'sent', at: p.sentAt || new Date().toISOString(), permalink: p.externalLink || null }); log('✓ envoyé par Buffer', id, p.externalLink || ''); }
      else if (st === 'error') { v.status = 'error'; v.error = p.error?.message || 'erreur Buffer'; state.errors.push({ id, at: new Date().toISOString(), error: 'Buffer : ' + v.error }); log('✗ Buffer', id, v.error); }
    } catch (e) { log('suivi Buffer', id, e.message.slice(0, 200)); if (e.rateLimited) { bufferLimited(e); break; } }
  }
  return n;
}
// mode économe : moins de 800 requêtes restantes sur 30 jours → seulement les créations de posts
const frugal = () => (RL.month?.left ?? state.bufferQuota?.left ?? 9999) < 800;
// quota Buffer épuisé : on arrête tout appel Buffer jusqu'à la remise à zéro (en-tête t), sinon 24 h
function bufferLimited(e) {
  const w = e.window === '30d' ? RL.month : e.window === '24h' ? RL.day : RL.q15;
  const sec = (w && w.resetIn) || e.retryAfter || 24 * 3600;
  state.bufferPauseUntil = new Date(Date.now() + sec * 1000).toISOString();
  log('Quota Buffer épuisé (' + (e.window || '?') + ') : pause jusqu’au', state.bufferPauseUntil);
}

// file d'attente : queue/<date>.json → { items: [{ id, platform: ig|tt|fb, kind, at (ISO), media: [urls], cover?, caption }] }
const items = fs.readdirSync(path.join(ROOT, 'queue')).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(ROOT, 'queue', f), 'utf8')).items || []).map((x) => ({ ...x, file: f })));

const fresh = (x, early = 0) => Date.parse(x.at) - early <= NOW && NOW - Date.parse(x.at) < 6 * 3600e3;
// Instagram n'a pas de programmation : GitHub lance les passages avec du retard, donc on prend ce qui tombe dans les 65 prochaines minutes (Buffer : 5 h à l'avance) et on attend l'heure exacte.
const pick = (x) => !state.published[x.id] && (ONLY ? x.id === ONLY : fresh(x, x.platform === 'ig' ? 65 * 60e3 : 5 * 3600e3));
const dueIG = items.filter((x) => x.platform === 'ig' && pick(x)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
// YouTube seulement quand la chaîne est reliée dans Buffer (config.bufferChannels)
const ytOn = (CONFIG.bufferChannels || []).some((c) => String(c.service).toLowerCase() === 'youtube');
const dueBuf = items.filter((x) => (x.platform === 'tt' || x.platform === 'fb' || (x.platform === 'yt' && ytOn)) && pick(x));
log(`${items.length} éléments en file ; à traiter : ${dueIG.length} Instagram, ${dueBuf.length} TikTok/Facebook${DRY ? ' (essai, rien n’est publié)' : ''}`);
if (dueIG.length && !TOKEN && !DRY) { console.error('IG_ACCESS_TOKEN manquant'); process.exit(1); }

let changed = false;
const fail = (item, e) => {
  log('✗', item.id, e.message);
  state.errors.push({ id: item.id, at: new Date().toISOString(), error: e.message.slice(0, 400) });
  state.errors = state.errors.slice(-50);
  changed = true;
};
// pause Instagram : après un « action is blocked », on ne publie plus rien sur Instagram pendant 48 h (le compte doit refroidir)
const igPaused = state.igPauseUntil && Date.parse(state.igPauseUntil) > NOW && !ONLY;
if (igPaused && dueIG.length) log('Instagram en pause jusqu’au', state.igPauseUntil, ':', dueIG.length, 'publication(s) reportée(s)');
for (const item of igPaused ? [] : dueIG.slice(0, 3)) {          // au plus 3 par passage
  // déjà tenté et en échec : on vérifie d'abord qu'il n'est pas déjà en ligne (jamais de doublon)
  if (!DRY && state.errors.some((e) => e.id === item.id)) {
    const found = await findPublished(item).catch(() => null);
    if (found) { state.published[item.id] = { platform: 'ig', kind: item.kind, at: new Date().toISOString(), planned: item.at, ...found, note: 'retrouvé en ligne' }; changed = true; log('déjà en ligne :', item.id); continue; }
  }
  try {
    const wait = Date.parse(item.at) - Date.now();
    if (!ONLY && wait > 0) { log('attente de l’heure prévue :', item.id, Math.round(wait / 1000), 's'); if (!DRY) await sleep(wait); }
    log('→', item.id, item.kind, item.media.length, 'fichier(s)');
    const res = DRY ? { mediaId: 'dry-run', permalink: null } : await publishIG(item);
    state.published[item.id] = { platform: 'ig', kind: item.kind, at: new Date().toISOString(), planned: item.at, ...res };
    log('✓', item.id, res.permalink || res.mediaId);
    changed = true;
  } catch (e) {
    fail(item, e);
    if (/action is blocked|2207051/.test(e.message)) { state.igPauseUntil = new Date(Date.now() + 48 * 3600e3).toISOString(); log('Instagram bloque les publications : pause de 48 h'); break; }
  }
}
const bufPaused = state.bufferPauseUntil && Date.parse(state.bufferPauseUntil) > NOW && !ONLY;
if (bufPaused && dueBuf.length) log('Buffer en pause (quota) jusqu’au', state.bufferPauseUntil, ':', dueBuf.length, 'publication(s) en attente');
if (BUFFER_KEY && !bufPaused) {
  for (const item of dueBuf.slice(0, 6)) {
    try {
      log('→ Buffer', item.id, item.kind, item.media.length, 'fichier(s)');
      const res = DRY ? { via: 'buffer', bufferId: 'dry-run', status: 'dry' } : await publishBuffer(item);
      state.published[item.id] = { platform: item.platform, kind: item.kind, planned: item.at, ...res };
      log('✓ confié à Buffer', item.id, res.dueAt || '');
      changed = true;
    } catch (e) { fail(item, e); if (e.rateLimited) { bufferLimited(e); break; } }
  }
  if (!DRY && !(state.bufferPauseUntil && Date.parse(state.bufferPauseUntil) > Date.now()) && (await syncBuffer())) changed = true;
  if (RL.month) { state.bufferQuota = { ...RL.month, at: new Date().toISOString() }; changed = true; }
} else if (dueBuf.length) log('BUFFER_API_KEY absent : TikTok et Facebook en attente');
if (changed && !DRY) fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

// abonnés Instagram (lus pour le bilan Telegram de 22 h) : state/stats.json, réécrit seulement s'il change
if (TOKEN && !DRY) {
  try {
    const me = await ig('GET', '/me', { fields: 'followers_count,media_count' });
    const sp = path.join(ROOT, 'state/stats.json');
    const old = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : {};
    if (!old.ig || old.ig.followers !== me.followers_count || old.ig.posts !== me.media_count)
      fs.writeFileSync(sp, JSON.stringify({ ...old, ig: { followers: me.followers_count, posts: me.media_count, at: new Date().toISOString() } }, null, 2) + '\n');
  } catch (e) { log('statistiques Instagram', e.message.slice(0, 200)); }
}

// Résultats par publication (vues, portée, enregistrements, partages…) toutes les ~6 h : state/insights.json.
// La tâche du soir s'en sert pour refaire plus de ce qui marche (formats, accroches, heures).
if (!DRY) {
  const ip = path.join(ROOT, 'state/insights.json');
  const prev = fs.existsSync(ip) ? JSON.parse(fs.readFileSync(ip, 'utf8')) : { posts: {} };
  if (!prev.at || Date.now() - Date.parse(prev.at) > 6 * 3600e3) {
    const out = { at: new Date().toISOString(), posts: prev.posts || {} };
    let bufMetrics = 0;
    const recent = Object.entries(state.published).filter(([id, v]) => !id.startsWith('test') && Date.now() - Date.parse(v.at || v.planned || 0) < 14 * 864e5);
    for (const [id, v] of recent) {
      try {
        if (v.platform === 'ig' && v.mediaId && TOKEN) {
          const metrics = v.kind === 'reel' ? 'views,reach,saved,shares,likes,comments,total_interactions' : 'views,reach,saved,shares,likes,comments,total_interactions';
          const r = await ig('GET', `/${v.mediaId}/insights`, { metric: metrics });
          out.posts[id] = { platform: 'ig', kind: v.kind, at: v.at, ...Object.fromEntries((r.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? null])) };
        } else if (v.via === 'buffer' && v.bufferId && BUFFER_KEY && v.status === 'sent' && !v.metricsAt && Date.now() - Date.parse(v.at) > 36 * 3600e3
          && !(state.bufferPauseUntil && Date.parse(state.bufferPauseUntil) > Date.now()) && !frugal() && (bufMetrics++ < 6)) {
          // Buffer : une seule lecture par post, 36 h après sa sortie (quota mensuel limité)
          v.metricsAt = new Date().toISOString(); changed = true;
          const d = await gql('query($id: PostId!) { post(input: { id: $id }) { metrics { type value } } }', { id: v.bufferId });
          const m = d.post?.metrics || [];
          out.posts[id] = { platform: v.platform, kind: v.kind, at: v.at, ...Object.fromEntries(m.map((x) => [x.type, x.value])) };
        }
      } catch (e) { out.posts[id] = { ...(out.posts[id] || {}), platform: v.platform, error: e.message.slice(0, 160) }; if (e.rateLimited) bufferLimited(e); }
    }
    fs.writeFileSync(ip, JSON.stringify(out, null, 2) + '\n');
    log('résultats mis à jour :', Object.keys(out.posts).length, 'publications');
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  }
}
if (BUFFER_KEY) log('Buffer : ' + RL.calls + ' requête(s) ce passage' + (RL.month ? `, ${RL.month.left}/${RL.month.quota} restantes sur 30 jours (remise à zéro dans ${Math.round(RL.month.resetIn / 86400)} j)` : ''));
