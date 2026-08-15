/**
 * Equipment summons — conjured gear as a first-class kind of summon.
 * Exemplar: Threadcutter, Gabriel's soulbound dagger.
 *
 * A creature summon clones an actor onto the canvas; an equipment summon
 * conjures an ITEM into the caster's hands, statted from the caster rather
 * than from crafting: budget = class level × the rate the summon skill's
 * rarity earns (config.summonEquipment, formulas.summonEquipmentBudget),
 * split across abilities by the skill's authored weights.
 *
 * Soul-binding is the TYPE's semantics, not a per-item flag:
 *  - RECAST TOGGLES. Casting while the item exists dismisses it; casting
 *    while absent conjures it fresh, stats re-derived for the caster's
 *    CURRENT level — re-summoning IS the upgrade path.
 *  - UNEQUIPPING BANISHES. The item returns to the summoner's soul —
 *    deleted, never stored, never lootable, never tradeable. Conjured gear
 *    does not persist without the summoner's will; that is what makes it a
 *    summon and not crafting.
 *
 * The conjured item carries `flags['aspects-of-power'].summonedEquipment`
 * (the document-payload namespace) naming its source skill, so lookup is
 * by provenance, never by name — Felicia's skill and weapon sharing the
 * name "Maia's Lament" is the standing warning about name matching.
 */

import { isActingGM } from '../helpers/gm.mjs';
import {
  distributeStatBudget, parseStatSplit, summonEquipmentBudget,
} from '../helpers/formulas.mjs';

const SYS = 'aspects-of-power';
const ABILITY_KEYS = ['vitality', 'endurance', 'strength', 'dexterity', 'toughness',
  'intelligence', 'willpower', 'wisdom', 'perception'];

/** Conjured items on this actor, optionally only those from one skill. */
export function findSummonedEquipment(actor, sourceSkillId = null) {
  return (actor?.items ?? []).filter(i => {
    const f = i.flags?.[SYS]?.summonedEquipment;
    return f && (!sourceSkillId || f.sourceSkillId === sourceSkillId);
  });
}

/**
 * The conjured item's data, derived fresh from the caster's current state.
 * Returns null (with a notification) when the skill is malformed — a junk
 * stat split must refuse, not conjure a statless blade.
 */
export function buildSummonedItemData(actor, skill) {
  const tc = skill.system.tagConfig ?? {};
  const level = actor.system.attributes?.class?.level ?? 0;
  const rarity = skill.system.rarity ?? 'common';
  const split = parseStatSplit(tc.summonStatSplit);
  if (!split.length || !level) {
    ui.notifications.warn(`${skill.name}: summonStatSplit is empty or unparseable, or the caster has no class level.`);
    return null;
  }
  const budget = summonEquipmentBudget(level, rarity);
  const parts = new Map(distributeStatBudget(budget, split).map(p => [p.ability, p.value]));
  const cfg = CONFIG.ASPECTSOFPOWER?.summonEquipment ?? {};
  const durability = Math.max(1, Math.round(level * (cfg.durabilityPerLevel ?? 10)));

  return {
    name: tc.summonItemName,
    type: 'item',
    img: skill.img,
    system: {
      description: `<p><em>Conjured by ${skill.name}. Bound to ${actor.name}'s soul — it reforms on each summoning and returns to the soul when set down.</em></p>`,
      slot: 'weaponry',
      equipped: true,
      rarity,
      material: 'metal',
      weight: 1,
      tags: String(tc.summonItemTags ?? '').split(',').map(s => s.trim()).filter(Boolean),
      statBonuses: ABILITY_KEYS.map(a => ({ ability: a, value: parts.get(a) ?? 0 })),
      durability: { value: durability, max: durability },
      /* Soul-stuff takes no sockets: its power is intrinsic, and an augment
         seated in a banishable item would be destroyed with it. */
      augmentSlots: 0,
    },
    flags: { [SYS]: { summonedEquipment: {
      sourceSkillId: skill.id,
      casterLevel: level,
      rarity,
    } } },
  };
}

/**
 * The dispatch target: toggle the conjured item. Runs on the caster's own
 * client — creating and deleting embedded items on an owned actor needs no
 * GM routing.
 */
export async function executeEquipmentSummon(skillDoc, speaker, rollMode) {
  const actor = skillDoc.actor;
  if (!actor) return;
  const skill = skillDoc;

  const existing = findSummonedEquipment(actor, skill.id);
  if (existing.length) {
    await actor.deleteEmbeddedDocuments('Item', existing.map(i => i.id));
    ChatMessage.create({ speaker, rollMode,
      content: `<p><em>${existing[0].name} dissolves into threads of light and returns to ${actor.name}'s soul.</em></p>` });
    return;
  }

  const data = buildSummonedItemData(actor, skill);
  if (!data) return;

  /* One hand, one blade: stow whatever else is drawn. The banish hook only
     fires for OTHER summoned equipment, so stowing crafted gear is safe. */
  const drawn = actor.items.filter(i => i.type === 'item'
    && i.system?.slot === 'weaponry' && i.system?.equipped
    && !i.flags?.[SYS]?.summonedEquipment);
  if (drawn.length) {
    await actor.updateEmbeddedDocuments('Item',
      drawn.map(i => ({ _id: i.id, 'system.equipped': false })));
  }

  const [created] = await actor.createEmbeddedDocuments('Item', [data]);
  const total = data.system.statBonuses.reduce((s, b) => s + b.value, 0);
  ChatMessage.create({ speaker, rollMode,
    content: `<p><em>${actor.name} draws <strong>${created.name}</strong> out of their soul — `
      + `${total} points of edge, honed to level ${data.flags[SYS].summonedEquipment.casterLevel}.</em></p>` });
}

/**
 * UNEQUIPPING BANISHES — the soul-bound half of the contract. Runs on the
 * acting GM (world mutation from a document hook; every client sees the
 * update broadcast, exactly one may act on it).
 */
export function onUpdateItemBanishUnequipped(item, changes) {
  if (!isActingGM()) return;
  if (!item.flags?.[SYS]?.summonedEquipment) return;
  if (changes.system?.equipped !== false) return;
  item.delete();
  if (item.parent) {
    ChatMessage.create({
      content: `<p><em>${item.name} slips back into ${item.parent.name}'s soul as it leaves their hand.</em></p>`,
    });
  }
}

export function registerSummonEquipmentHooks() {
  Hooks.on('updateItem', onUpdateItemBanishUnequipped);
}
