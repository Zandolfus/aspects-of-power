import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const actorsDir = join(tmpdir(), 'may1-actors-unpacked');
const itemsDir = join(tmpdir(), 'may1-items-unpacked');

const restore = {
  actors: {},
  worldItems: [],
};

let totalItems = 0;
for (const f of readdirSync(actorsDir)) {
  if (!f.endsWith('.json')) continue;
  const a = JSON.parse(readFileSync(join(actorsDir, f), 'utf8'));
  const items = (a.items ?? []).filter(i => i.type === 'item');
  if (items.length === 0) continue;
  restore.actors[a._id] = {
    name: a.name,
    items: items.map(i => ({
      id: i._id,
      name: i.name,
      statBonuses: i.system?.statBonuses ?? [],
      armorBonus: i.system?.armorBonus ?? 0,
      veilBonus: i.system?.veilBonus ?? 0,
    })),
  };
  totalItems += items.length;
}

for (const f of readdirSync(itemsDir)) {
  if (!f.endsWith('.json')) continue;
  const i = JSON.parse(readFileSync(join(itemsDir, f), 'utf8'));
  if (i.type !== 'item') continue;
  restore.worldItems.push({
    id: i._id,
    name: i.name,
    statBonuses: i.system?.statBonuses ?? [],
    armorBonus: i.system?.armorBonus ?? 0,
    veilBonus: i.system?.veilBonus ?? 0,
  });
  totalItems++;
}

const out = 'migration/snapshots/may1_item_restore_manifest.json';
writeFileSync(out, JSON.stringify(restore, null, 2));
console.log(`Built restore manifest: ${Object.keys(restore.actors).length} actors, ${totalItems} items`);
console.log(`Saved to ${out}`);
