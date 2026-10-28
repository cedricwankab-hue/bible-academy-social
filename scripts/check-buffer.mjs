// Vérifie la clé Buffer sans rien publier : chaînes reliées + schéma utile (modes, métadonnées TikTok/Facebook). Écrit state/buffer-check.json (aucun secret).
import fs from 'node:fs';
import { gql, channels, KEY } from './buffer.mjs';
const out = { at: new Date().toISOString(), keyPresent: !!KEY };
try { Object.assign(out, await channels()); } catch (e) { out.channelsError = e.message; }
try {
  const T = '{ kind name ofType { kind name ofType { kind name ofType { kind name } } } }';
  const d = await gql(`query { __schema { queryType { fields { name args { name type ${T} } } } types { name kind enumValues { name } inputFields { name type ${T} } fields { name type ${T} } } } }`);
  const keep = /^(Post|Share|Scheduling|Facebook|Tiktok|TikTok|Asset|Image|Video|Instagram|DailyPosting|Service)/;
  out.query = d.__schema.queryType.fields.filter((f) => /post|channel|limit/i.test(f.name));
  out.types = d.__schema.types.filter((t) => keep.test(t.name) && (t.enumValues || t.inputFields || /^Post$|Error$/.test(t.name)))
    .map((t) => ({ name: t.name, kind: t.kind, enum: t.enumValues?.map((e) => e.name), input: t.inputFields?.map((f) => f.name + ':' + JSON.stringify(f.type).replace(/"(kind|name|ofType)":/g, '').replace(/null/g, '')), fields: t.name === 'Post' ? t.fields.map((f) => f.name) : undefined }));
} catch (e) { out.schemaError = e.message; }
fs.mkdirSync('state', { recursive: true });
fs.writeFileSync('state/buffer-check.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ keyPresent: out.keyPresent, channels: out.channels, channelsError: out.channelsError, schemaError: out.schemaError }, null, 2));
