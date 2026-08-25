/**
 * IMPLEMENT IDENTITIES beyond wand/staff (ruled 2026-08-24).
 *
 * TOME — "seize spells out of the air as a reaction — up to a
 * damage/healing cap based on the quality of the tome." A held book
 * (weaponry slot, `tome` tag). Its Seize Spell reaction (weaponTagGrants)
 * catches an incoming magic working whose rolled magnitude fits under the
 * tome's cap; the working is BOUND into the tome and can be released once
 * as the holder's own action. Bindings DECAY when combat ends — seized
 * power is borrowed, never kept (ruled). Attempting to seize a working
 * OVER the cap fails AND destabilizes anything already bound: the held
 * magic detonates on the holder after a short delay (ruled: "all the held
 * magic explodes after a short duration, plus it fails").
 *
 * Cap = progress x rarity multiplier (ruled: "based on item progress but
 * rarity should play into it") — tomeSeizeCap in helpers/formulas.mjs.
 * Live anchor 2026-08-24: masterwork gear runs ~900-1000 progress, so an
 * epic masterwork tome (x2.6) catches a base-cost major (~2600 raw) while
 * a grand (~4258) needs legendary quality.
 *
 * WEAVE — "affinity swap catalysts" (ruled). A WORN implement (tailoring
 * content — the one implement that leaves both hands free). It carries
 * affinities woven in at craft (`wovenAffinities`); the wearer attunes to
 * one (`weaveAttuned`) and their magic casts carry THAT affinity through
 * the whole downstream pipeline (affinity resists, DR-strip matching,
 * barrier affinities, buff typing). Rarity gates how many woven
 * affinities the weave honours (weave.affinitySlotsByRarity) — the slice
 * is enforced at READ time, so an over-woven item simply ignores its
 * excess threads.
 *
 * Binding state lives in flags['aspects-of-power'].tomeBound (hyphen
 * namespace: document payload, not engine combat state) and is written
 * ONLY via the gmTomeState GM action — the reaction resolves on the
 * attacker's client, which does not own the defender's tome (code
 * standard 16).
 */

import { tomeSeizeCap } from '../helpers/formulas.mjs';
import { typingFromTags } from './affinity.mjs';

const FLAG_SCOPE = 'aspects-of-power';

/* -------------------------------------------- */
/*  Tome                                         */
/* -------------------------------------------- */

/** The actor's equipped tome (weaponry slot, `tome` tag). Best cap wins. */
export function equippedTome(actor) {
  let best = null, bestCap = -1;
  for (const item of actor?.items ?? []) {
    if (item.type !== 'item' || !item.system?.equipped) continue;
    if ((item.system?.slot ?? '') !== 'weaponry') continue;
    if (!(item.system?.tags ?? []).includes('tome')) continue;
    const cap = tomeSeizeCapFor(item);
    if (cap > bestCap) { best = item; bestCap = cap; }
  }
  return best;
}

/** Seize cap for one tome item: progress x rarity multiplier (formulas). */
export function tomeSeizeCapFor(item) {
  const cfg = CONFIG.ASPECTSOFPOWER?.tome ?? {};
  const mult = cfg.capRarityMult?.[item?.system?.rarity ?? ''] ?? 0;
  return tomeSeizeCap(item?.system?.progress ?? 0, mult);
}

/**
 * The tome's current binding, or null. LAZY DECAY: a binding stamped in a
 * combat that is no longer the active one has already faded — report null
 * (the stale flag is cleaned up by the next gmTomeState write; reads never
 * mutate, so any client can call this).
 */
export function tomeBinding(item) {
  const b = item?.flags?.[FLAG_SCOPE]?.tomeBound;
  if (!b?.amount) return null;
  if (!b.combatId || b.combatId !== game.combat?.id) return null;
  return b;
}

/* -------------------------------------------- */
/*  Weave                                        */
/* -------------------------------------------- */

/**
 * The affinities a weave actually offers: its woven list sliced to the
 * rarity's slot count. Enforcement at read time — no craft-side clamp to
 * forget.
 */
export function weaveOfferedAffinities(item) {
  const cfg = CONFIG.ASPECTSOFPOWER?.weave ?? {};
  const slots = cfg.affinitySlotsByRarity?.[item?.system?.rarity ?? ''] ?? 0;
  return (item?.system?.wovenAffinities ?? []).slice(0, Math.max(0, slots));
}

/**
 * The actor's equipped, ATTUNED weave — any slot (a weave is worn, not
 * held; this is the whole point of the vestment implement). Returns null
 * unless the attuned affinity is one the weave actually offers.
 */
export function equippedAttunedWeave(actor) {
  for (const item of actor?.items ?? []) {
    if (item.type !== 'item' || !item.system?.equipped) continue;
    if (!(item.system?.tags ?? []).includes('weave')) continue;
    const att = item.system?.weaveAttuned ?? '';
    if (att && weaveOfferedAffinities(item).includes(att)) return item;
  }
  return null;
}

/**
 * The affinities a CAST carries: the skill's own, unless the caster wears
 * an attuned weave and the skill is a magic cast — then the attuned
 * affinity REPLACES them wholesale, so resist matching, DR-strip, barrier
 * typing and buff typing all agree on what the spell now is.
 */
export function castAffinities(skill) {
  // DERIVED FROM TAGS (ruled 2026-08-24). `system.affinities` is no longer
  // read for typing: it was a denormalised copy of the affinity subset of
  // tags, synced only by the sheet's toggle handler, so any skill authored by
  // import/migration/compendium had the tag and not the array (116 of them),
  // and three encodings existed side by side. Tags are the authored truth;
  // this projects them. Verified lossless before the switch: 184/184 skills
  // reproduced exactly, 0 spurious gains.
  const own = [...typingFromTags(skill?.system?.tags ?? [])];
  if (!skill?.actor) return own;
  // A released binding carries the SEIZED working's affinities — the
  // spell is still whoever's it was; the tome only redirects it.
  if ((skill.system?.tags ?? []).includes('release-binding')) {
    const held = tomeBinding(equippedTome(skill.actor));
    if (held?.affinities?.length) return [...held.affinities];
  }
  const type = skill?.system?.roll?.type ?? '';
  if (!['magic', 'magic_melee'].includes(type)) return own;
  const weave = equippedAttunedWeave(skill.actor);
  if (!weave) return own;
  return [weave.system.weaveAttuned];
}
