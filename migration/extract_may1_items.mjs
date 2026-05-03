import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BS = String.fromCharCode(92);
const QU = String.fromCharCode(34);

function extractJsonObjects(filepath) {
  const buf = readFileSync(filepath);
  const str = buf.toString('binary');
  const records = [];
  let i = 0;
  while (i < str.length) {
    const nameStart = str.indexOf('{"name":"', i);
    if (nameStart < 0) break;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let end = -1;
    for (let j = nameStart; j < str.length; j++) {
      const c = str[j];
      if (escape) { escape = false; continue; }
      if (c === BS && inStr) { escape = true; continue; }
      if (c === QU) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) { i = nameStart + 1; continue; }
    const candidate = str.slice(nameStart, end + 1);
    try {
      const obj = JSON.parse(candidate);
      if (obj._id && obj.type) records.push(obj);
    } catch (e) { /* skip */ }
    i = end + 1;
  }
  return records;
}

const actorsLdb = join(tmpdir(), 'may1-extract', 'data', 'actors', '001025.ldb');
const actors = extractJsonObjects(actorsLdb);
console.log('Extracted actors:', actors.length);
const types = {};
for (const a of actors) types[a.type] = (types[a.type] ?? 0) + 1;
console.log('Actor types:', types);
const withItems = actors.filter(a => a.items?.length > 0);
console.log('Actors with embedded items:', withItems.length);
let totalItems = 0;
for (const a of withItems) totalItems += a.items.length;
console.log('Total embedded items:', totalItems);

writeFileSync('migration/snapshots/may1_actors_extracted.json', JSON.stringify(actors, null, 2));
console.log('Saved to migration/snapshots/may1_actors_extracted.json');
