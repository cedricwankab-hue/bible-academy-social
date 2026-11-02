// Envoie chaque matin sur Telegram 10 créateurs chrétiens américains à suivre, un message par réseau :
// TikTok (creators/pool.json → @bibleacademy4) et Instagram (creators/ig-pool.json → @bibleacademyapp). Jamais deux fois le même.
// Secret : TELEGRAM_TOKEN (le bot du bilan Bible Academy). Chat : TELEGRAM_CHAT_ID (sinon celui de Cédric).
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (f) => path.join(ROOT, 'creators', f);
const NETS = [
  { key: 'tt', name: 'TikTok', account: '@bibleacademy4', pool: 'pool.json', sent: 'sent.json', url: (h) => `https://www.tiktok.com/@${h}`, tip: 'laisse un vrai commentaire sur la dernière vidéo de 3 ou 4 d’entre eux' },
  { key: 'ig', name: 'Instagram', account: '@bibleacademyapp', pool: 'ig-pool.json', sent: 'ig-sent.json', url: (h) => `https://www.instagram.com/${h}/`, tip: 'aime et commente sincèrement le dernier post de 3 ou 4 d’entre eux' },
];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const N = +(process.env.COUNT || 10);
// test : creators/trigger contient « test AAAA-MM-JJ » → renvoie la liste du jour une seule fois, sans rien marquer
const trig = fs.existsSync(P('trigger')) ? fs.readFileSync(P('trigger'), 'utf8') : '';
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' K' : String(n));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const token = process.env.TELEGRAM_TOKEN, chat = process.env.TELEGRAM_CHAT_ID || '1431156766';
let failed = false;

for (const net of NETS) {
  if (!fs.existsSync(P(net.pool))) continue;
  const pool = JSON.parse(fs.readFileSync(P(net.pool), 'utf8')).creators;
  const sent = fs.existsSync(P(net.sent)) ? JSON.parse(fs.readFileSync(P(net.sent), 'utf8')) : { days: {} };
  const TEST = trig.includes('test ' + today) && sent.tested !== today && sent.days[today];
  if (sent.days[today] && !process.env.FORCE && !TEST) { console.log(net.name, ': déjà envoyé aujourd’hui'); continue; }
  const done = new Set(Object.values(sent.days).flat());
  const next = TEST ? pool.filter((c) => sent.days[today].includes(c.handle)) : pool.filter((c) => !done.has(c.handle)).slice(0, N);
  const left = pool.filter((c) => !done.has(c.handle)).length - next.length;
  let text = `📖 <b>Bible Academy</b>${TEST ? ' (test)' : ''}\n👥 <b>${next.length} créateurs à suivre aujourd'hui sur ${net.name}</b> (${net.account})\n\n`;
  text += next.map((c, i) => `${i + 1}. <a href="${net.url(c.handle)}">@${esc(c.handle)}</a> · ${fmt(c.followers)}${c.where ? ' · ' + esc(c.where) : ''}\n   <i>${esc(c.about || '')}</i>`).join('\n');
  text += `\n\n✅ Suis-les, et ${net.tip}.`;
  if (left < 20) text += `\n⚠️ Réserve ${net.name} presque vide (${left} restants) : demande à Claude d'en trouver d'autres.`;
  if (!next.length) text = `📖 <b>Bible Academy</b>\n⚠️ Plus de créateurs ${net.name} en réserve : demande à Claude d’en chercher d’autres.`;
  if (process.env.DRY_RUN === '1' || !token) { console.log(text + '\n'); continue; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  const j = await r.json();
  if (!j.ok) { console.error(net.name, 'Telegram :', JSON.stringify(j).slice(0, 200)); failed = true; continue; }
  if (TEST) sent.tested = today; else if (next.length) sent.days[today] = next.map((c) => c.handle);
  fs.writeFileSync(P(net.sent), JSON.stringify(sent, null, 1) + '\n');
  console.log(net.name, 'envoyé :', next.map((c) => c.handle).join(', '));
}
if (!token) console.log('(TELEGRAM_TOKEN absent : rien envoyé)');
if (failed) process.exit(1);
