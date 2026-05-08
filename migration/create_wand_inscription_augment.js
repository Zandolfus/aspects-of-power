// Creates the Wand Inscription augment as a world item. Run via:
//   node migration/run_playwright_eval.js migration/create_wand_inscription_augment.js
// Idempotent: if a world item named "Wand Inscription" exists, no-op.

async () => {
  const existing = game.items.contents.find(i => i.type === 'augment' && i.name === 'Wand Inscription');
  if (existing) {
    return JSON.stringify({ status: 'already_exists', id: existing.id, grantsTags: existing.system.grantsTags });
  }

  const itemData = {
    name: 'Wand Inscription',
    type: 'augment',
    img: 'icons/weapons/wands/wand-gem-pink.webp',
    system: {
      description:
        '<p>Etched arcane runes channel the essence of a wand into the host weapon. While slotted, the host item carries the <strong>wand</strong> implement tag — Basic-tier spells cast while wielding it gain the Wand bonus (-23% celerity wait).</p>'
        + '<p><em>Replaces nothing. Strips cleanly on unslot.</em></p>',
      statBonuses: [],
      itemBonuses: [],
      isProfessionAugment: false,
      craftBonuses: [],
      grantsTags: ['wand'],
    },
  };

  const created = await Item.create(itemData);
  return JSON.stringify({
    status: 'created',
    id: created.id,
    name: created.name,
    grantsTags: created.system.grantsTags,
  });
}
