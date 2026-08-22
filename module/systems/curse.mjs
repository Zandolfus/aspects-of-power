/**
 * DREAD / CURSE ENGINE (design-dread-curse-engine, RULED 2026-08-21).
 *
 * Debuff effects are stamped with their source skill's tags at apply time
 * (_handleDebuffTag), and this module's verbs filter over that stamp:
 *
 *   spread-debuff   copy the anchor's matching debuffs to the other AOE
 *                   targets — full strength, remaining duration, each victim's
 *                   own immunity/veil gates still apply (they route through
 *                   the standard gmApplyDebuff). The anchor KEEPS its curses.
 *   transfer-debuff move one matching debuff off a targeted ally (or self)
 *                   onto a chosen enemy. A warded recipient means the curse
 *                   dissipates — the ally is still cleansed.
 *   consume-debuff  eat the matching debuffs wherever they sit and deposit
 *                   their remaining energy on the caster's curse meter.
 *
 * The meter: capacity = wil.mod + wis.mod (curseMeterCapacity). Every cast
 * carrying a fill tag channels fillScale x roll onto it; eating deposits the
 * eaten magnitude. It only DROPS via `vent-curse` (Curse Shot — everything,
 * one big shot, as flat damage) and `harness` (Harness Emotions — everything,
 * into a kindledDmgMod self-buff). Overflow = uncontrolled transformation
 * with a d100; at or under transformPermanentOn the change is PERMANENT.
 *
 * Client/GM split: meter writes and self-buffs land on the caster's OWN
 * actor (owner permission), so they run client-side. Anything touching a
 * different actor's effects (spread copies, transfer, non-owned consume)
 * routes through the `gmCurseOp` GM action below.
 */
import { curseMeterCapacity, curseEatenEnergy, curseFillAmount } from '../helpers/formulas.mjs';

function _cfg() {
  return CONFIG.ASPECTSOFPOWER?.curse ?? {};
}

/* -------------------------------------------- */
/*  Filtering                                    */
/* -------------------------------------------- */

/** The stamped tag this skill's verb matches (per-skill override → config). */
export function curseFilterTag(skill) {
  return skill.system?.tagConfig?.spreadFilterTag || (_cfg().spreadFilterTag ?? 'dread');
}

/**
 * Matching debuff effects on an actor. Stamped `system.tags` is the source
 * of truth; effects applied before the stamp shipped fall back to resolving
 * their origin item's live tags (async, so legacy Despairs still spread).
 */
export async function matchingCurseEffects(actor, filterTag) {
  const out = [];
  for (const e of actor?.effects ?? []) {
    if (e.disabled) continue;
    const stamped = e.system?.tags ?? [];
    if (stamped.length > 0) {
      if (stamped.includes(filterTag)) out.push(e);
      continue;
    }
    if (!e.origin) continue;
    const src = await fromUuid(e.origin).catch(() => null);
    if (src?.system?.tags?.includes?.(filterTag)) out.push(e);
  }
  return out;
}

/** Rounds a debuff still owes — the live countdown, else the authored span. */
export function remainingRounds(effect) {
  const r = effect.system?.roundsRemaining;
  if (Number.isFinite(r)) return Math.max(0, r);
  return Math.max(0, Number(effect.duration?.value ?? effect.duration?.rounds ?? 0));
}

/** Plain snapshot of an effect, serializable for the gmCurseOp socket hop. */
function _snapshotEffect(effect) {
  const obj = effect.toObject();
  return {
    id: effect.id,
    name: obj.name,
    img: obj.img,
    origin: obj.origin ?? '',
    changes: obj.changes ?? [],
    description: obj.description ?? '',
    system: obj.system ?? {},
    remaining: remainingRounds(effect),
  };
}

/* -------------------------------------------- */
/*  The curse meter                              */
/* -------------------------------------------- */

export function meterValue(actor) {
  return Math.max(0, Number(actor?.flags?.aspectsofpower?.curseMeter ?? 0));
}

export function meterCapacity(actor) {
  const ab = actor?.system?.abilities ?? {};
  return curseMeterCapacity(ab.willpower?.mod ?? 0, ab.wisdom?.mod ?? 0);
}

/**
 * Deposit curse energy on an actor's meter, announcing the new level.
 * Overflow (>= capacity) triggers the uncontrolled transformation: the
 * stored energy discharges into the change (meter resets to 0), a d100
 * decides permanence ("A 1 makes the transformation permanent and remains
 * uncontrollable"), and an enraged-semantics control-loss effect lands.
 * The transformation's FORM is table territory — the engine provides the
 * trigger, the roll, the control loss, and the permanence flag.
 */
export async function addCurseEnergy(actor, amount, { speaker, rollMode, sourceName = '' } = {}) {
  if (!_cfg().enabled || !actor || amount <= 0) return;
  const cap = meterCapacity(actor);
  if (cap <= 0) return;
  const cur = meterValue(actor);
  const next = cur + Math.round(amount);

  if (next < cap) {
    await actor.update({ 'flags.aspectsofpower.curseMeter': next });
    ChatMessage.create({
      speaker, rollMode,
      content: `<p><em>Curse energy on ${actor.name}: <strong>${next} / ${cap}</strong>`
             + `${sourceName ? ` (+${Math.round(amount)} from ${sourceName})` : ''}.</em></p>`,
    });
    return;
  }

  // ── OVERFLOW: uncontrolled transformation ──
  await actor.update({ 'flags.aspectsofpower.curseMeter': 0 });
  const d100 = await new Roll('1d100').evaluate();
  await d100.toMessage({
    speaker,
    flavor: `${actor.name} — Curse Overflow: transformation check (${_cfg().transformPermanentOn ?? 1} = permanent)`,
  });
  const permanent = d100.total <= (_cfg().transformPermanentOn ?? 1);
  if (permanent) {
    await actor.update({ 'flags.aspectsofpower.curseTransformPermanent': true });
  }
  await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: 'Uncontrolled Transformation',
    img: 'icons/svg/terror.svg',
    origin: actor.uuid,
    type: 'base',
    disabled: false,
    // No duration: the change holds until the table resolves it (or forever,
    // on the 1). Control loss rides the enraged debuff semantics.
    system: {
      debuffType: 'enraged',
      debuffDamage: cap,
      casterActorUuid: actor.uuid,
      magicType: 'magical',
      tags: ['curse'],
    },
    description: permanent
      ? 'The curse energy has fused with its vessel. The transformation is permanent and remains uncontrollable.'
      : 'Stored curse energy has overwhelmed its vessel. The transformation is uncontrolled until the energy dissipates.',
  }]);
  ChatMessage.create({
    speaker,
    content: `<p><strong>${actor.name}</strong> overflows with curse energy (${next} against a capacity of ${cap}) `
           + `and undergoes an <strong>uncontrolled transformation</strong>!`
           + `${permanent ? ' The d100 shows a natural low — <strong>the change is PERMANENT.</strong>' : ''}</p>`,
  });
}

/** Empty the meter, returning what was vented. */
export async function ventAllCurse(actor) {
  const cur = meterValue(actor);
  if (cur > 0) await actor.update({ 'flags.aspectsofpower.curseMeter': 0 });
  return cur;
}

/**
 * Meter fill on cast (fill ruling: "all curse casts + eating"). Fires once
 * per cast from roll()'s two cost-deduction tails. Vent skills are excluded
 * — a vent empties the vessel; its own casting does not refill it.
 */
export async function onCurseCast(skill, rollTotal, speaker, rollMode) {
  const cfg = _cfg();
  if (!cfg.enabled || !skill?.actor) return;
  const tags = skill.system?.tags ?? [];
  if (tags.includes('vent-curse') || tags.includes('harness')) return;
  if (!(cfg.fillTags ?? ['dread', 'curse']).some(t => tags.includes(t))) return;
  const amount = curseFillAmount(rollTotal, cfg.fillScale ?? 0.1);
  if (amount <= 0) return;
  await addCurseEnergy(skill.actor, amount, { speaker, rollMode, sourceName: skill.name });
}

/* -------------------------------------------- */
/*  Verbs (client side)                          */
/* -------------------------------------------- */

/**
 * spread-debuff: project the anchor's matching debuffs onto every OTHER
 * target the AOE caught. Runs at AOE dispatch; the skill's own authored
 * debuff still lands on everyone through the normal tag loop.
 */
export async function handleSpread(skill, anchorToken, victimTokens, speaker, rollMode) {
  if (!anchorToken?.actor) {
    ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no anchor target — nothing to project.</em></p>` });
    return;
  }
  const filterTag = curseFilterTag(skill);
  const effects = await matchingCurseEffects(anchorToken.actor, filterTag);
  if (effects.length === 0) {
    ChatMessage.create({ speaker, rollMode,
      content: `<p><em>${skill.name}: nothing festering in ${anchorToken.document?.name ?? anchorToken.name} to project.</em></p>` });
    return;
  }
  const victims = victimTokens.filter(t => t?.actor && t.id !== anchorToken.id);
  if (victims.length === 0) {
    ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no one else caught in the wave.</em></p>` });
    return;
  }
  await skill._gmAction({
    type: 'gmCurseOp', op: 'spread',
    victimUuids: victims.map(t => t.actor.uuid),
    effects: effects.map(_snapshotEffect),
    targetDefense: skill.system?.roll?.targetDefense || 'mind',
    speaker, rollMode,
  });
  ChatMessage.create({ speaker, rollMode,
    content: `<p><strong>${skill.name}</strong> projects <strong>${effects.length}</strong> `
           + `curse${effects.length > 1 ? 's' : ''} festering in `
           + `<strong>${anchorToken.document?.name ?? anchorToken.name}</strong> onto `
           + `${victims.length} nearby target${victims.length > 1 ? 's' : ''}.</p>` });
}

/**
 * transfer-debuff: lift one matching curse off the targeted ally (or self)
 * and place it on a chosen recipient. Dialogs run on the caster's client;
 * the move itself is GM-side.
 */
export async function handleTransfer(skill, targetToken, speaker, rollMode) {
  const bearerToken = targetToken ?? skill.actor?.getActiveTokens()[0] ?? null;
  if (!bearerToken?.actor) {
    ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no target to lift a curse from.</em></p>` });
    return;
  }
  const filterTag = curseFilterTag(skill);
  const effects = await matchingCurseEffects(bearerToken.actor, filterTag);
  if (effects.length === 0) {
    ChatMessage.create({ speaker, rollMode,
      content: `<p><em>${skill.name}: no matching curse on ${bearerToken.document?.name ?? bearerToken.name}.</em></p>` });
    return;
  }

  // Pick the curse (auto when there is only one).
  let chosen = effects[0];
  if (effects.length > 1) {
    const opts = effects.map(e => `<option value="${e.id}">${e.name} (${remainingRounds(e)} rounds left)</option>`).join('');
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: 'Transfer Curse — choose the curse' },
      content: `<div class="form-group"><label>Curse to move:</label><select name="curse">${opts}</select></div>`,
      buttons: [
        { action: 'confirm', label: 'Transfer', default: true,
          callback: (event, button) => button.form.elements.curse?.value || null },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
    });
    if (!picked) return;
    chosen = effects.find(e => e.id === picked) ?? chosen;
  }

  // Pick the recipient: a second user target wins; otherwise choose from
  // the other tokens on the scene, nearest first.
  let recipient = [...(game.user.targets ?? [])].find(t => t.id !== bearerToken.id && t.actor) ?? null;
  if (!recipient) {
    const origin = bearerToken.center ?? { x: 0, y: 0 };
    const candidates = (canvas.tokens?.placeables ?? [])
      .filter(t => t.actor && t.id !== bearerToken.id && t.actor.uuid !== skill.actor?.uuid)
      .sort((a, b) => Math.hypot(a.center.x - origin.x, a.center.y - origin.y)
                    - Math.hypot(b.center.x - origin.x, b.center.y - origin.y));
    if (candidates.length === 0) {
      ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no recipient available.</em></p>` });
      return;
    }
    const opts = candidates.map(t => `<option value="${t.id}">${t.document.name}</option>`).join('');
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: 'Transfer Curse — choose the recipient' },
      content: `<div class="form-group"><label>Curse jumps to:</label><select name="rcpt">${opts}</select></div>`,
      buttons: [
        { action: 'confirm', label: 'Transfer', default: true,
          callback: (event, button) => button.form.elements.rcpt?.value || null },
        { action: 'cancel', label: 'Cancel', callback: () => null },
      ],
      close: () => null,
    });
    if (!picked) return;
    recipient = canvas.tokens.get(picked) ?? null;
  }
  if (!recipient?.actor) return;

  await skill._gmAction({
    type: 'gmCurseOp', op: 'transfer',
    bearerUuid: bearerToken.actor.uuid,
    effectId: chosen.id,
    recipientUuid: recipient.actor.uuid,
    effect: _snapshotEffect(chosen),
    targetDefense: skill.system?.roll?.targetDefense || 'mind',
    speaker, rollMode,
  });
}

/**
 * consume-debuff: eat the matching curses off the target (ally, enemy, or
 * self — "either target, same payoff") and deposit their remaining energy
 * on the caster's meter. Eating too much IS the side effect: the deposit
 * can overflow the meter.
 */
export async function handleConsume(skill, targetToken, speaker, rollMode) {
  const bearerToken = targetToken ?? skill.actor?.getActiveTokens()[0] ?? null;
  if (!bearerToken?.actor) {
    ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no target to feed on.</em></p>` });
    return;
  }
  const filterTag = curseFilterTag(skill);
  const effects = await matchingCurseEffects(bearerToken.actor, filterTag);
  if (effects.length === 0) {
    ChatMessage.create({ speaker, rollMode,
      content: `<p><em>${skill.name}: nothing on ${bearerToken.document?.name ?? bearerToken.name} to consume.</em></p>` });
    return;
  }
  const energy = curseEatenEnergy(effects.map(e => ({
    changes: e.toObject().changes ?? [],
    dotDamage: e.system?.dotDamage ?? 0,
    remaining: remainingRounds(e),
  })));

  if (bearerToken.actor.isOwner) {
    await bearerToken.actor.deleteEmbeddedDocuments('ActiveEffect', effects.map(e => e.id));
  } else {
    await skill._gmAction({
      type: 'gmCurseOp', op: 'deleteEffects',
      targetActorUuid: bearerToken.actor.uuid,
      effectIds: effects.map(e => e.id),
      speaker, rollMode,
    });
  }
  ChatMessage.create({ speaker, rollMode,
    content: `<p><strong>${skill.actor.name}</strong> devours ${effects.length} `
           + `curse${effects.length > 1 ? 's' : ''} from `
           + `<strong>${bearerToken.document?.name ?? bearerToken.name}</strong>: `
           + `+${energy} curse energy.</p>` });
  await addCurseEnergy(skill.actor, energy, { speaker, rollMode, sourceName: skill.name });
}

/**
 * harness: vent the ENTIRE meter into a self-buff — outgoing-damage bonus
 * = harnessScale x (vented / capacity) for harnessDuration rounds, carried
 * on the kindledDmgMod channel (affinity-less = boosts everything, which is
 * the point: emotions made nigh-tangible empower her whole kit).
 */
export async function handleHarness(skill, speaker, rollMode) {
  const actor = skill.actor;
  if (!actor) return;
  const cap = meterCapacity(actor);
  const vented = await ventAllCurse(actor);
  if (vented <= 0 || cap <= 0) {
    ChatMessage.create({ speaker, rollMode, content: `<p><em>${skill.name}: no curse energy to harness.</em></p>` });
    return;
  }
  const cfg = _cfg();
  const scale = skill.system?.tagConfig?.harnessScale || cfg.harnessScale || 0.5;
  const dur = Math.max(1, Math.round(skill.system?.tagConfig?.harnessDuration || cfg.harnessDuration || 3));
  const mod = Math.round(scale * (vented / cap) * 100) / 100;

  const stale = actor.effects.filter(e => (e.system?.kindledDmgMod ?? 0) > 0 && e.origin === skill.uuid);
  if (stale.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stale.map(e => e.id));
  await actor.createEmbeddedDocuments('ActiveEffect', [{
    name: `${skill.name} — Harnessed`,
    img: skill.img,
    origin: skill.uuid,
    type: 'base',
    disabled: false,
    duration: { value: dur, type: 'rounds' },
    system: {
      kindledDmgMod: mod,
      affinities: [...(skill.system?.affinities ?? [])],
      casterActorUuid: actor.uuid,
      tags: ['curse'],
    },
  }]);
  ChatMessage.create({ speaker, rollMode,
    content: `<p><strong>${actor.name}</strong> harnesses ${vented} curse energy into tangible emotion: `
           + `<strong>+${Math.round(mod * 100)}%</strong> damage for ${dur} rounds.</p>` });
}

/* -------------------------------------------- */
/*  GM-side op dispatcher                        */
/* -------------------------------------------- */

/**
 * gmCurseOp — the cross-actor half. Spread and transfer route every landing
 * through the standard gmApplyDebuff (per-victim immunity, veil ward,
 * refresh-with-max dedupe against a direct cast of the same curse, and the
 * on-apply DoT tick — a copy is a fresh application in every respect).
 */
export async function gmCurseOp(payload, executeGmAction) {
  const applyOne = async (eff, victimUuid) => {
    const system = foundry.utils.deepClone(eff.system ?? {});
    system.roundsRemaining = eff.remaining;
    await executeGmAction({
      type: 'gmApplyDebuff',
      targetActorUuid: victimUuid,
      effectName: eff.name,
      originUuid: eff.origin,
      stackable: false,
      effectData: {
        name: eff.name,
        img: eff.img,
        origin: eff.origin,
        type: 'base',
        disabled: false,
        changes: foundry.utils.deepClone(eff.changes ?? []),
        description: eff.description,
        duration: { rounds: eff.remaining },
        system,
      },
      dotDamage: system.dot ? (system.dotDamage ?? 0) : 0,
      dotDamageType: system.dotDamageType ?? 'physical',
      duration: eff.remaining,
      statSummary: (eff.changes ?? [])
        .map(c => `${String(c.key).replace(/^system\./, '').replace(/\.value$/, '')} ${c.value}`)
        .join(', ') || null,
      targetDefense: payload.targetDefense ?? 'mind',
      speaker: payload.speaker,
      whisperGM: payload.whisperGM,
    });
  };

  switch (payload.op) {
    case 'spread': {
      for (const victimUuid of payload.victimUuids ?? []) {
        for (const eff of payload.effects ?? []) {
          if ((eff.remaining ?? 0) <= 0) continue;
          await applyOne(eff, victimUuid);
        }
      }
      break;
    }
    case 'transfer': {
      const bearer = await fromUuid(payload.bearerUuid);
      if ((payload.effect?.remaining ?? 0) > 0) {
        await applyOne(payload.effect, payload.recipientUuid);
      }
      // The lift happens regardless of whether the landing was warded —
      // a warded recipient means the curse dissipates, the ally is still
      // cleansed (design-dread-curse-engine).
      if (bearer?.effects?.get?.(payload.effectId)) {
        await bearer.deleteEmbeddedDocuments('ActiveEffect', [payload.effectId]);
      }
      const recipient = await fromUuid(payload.recipientUuid);
      ChatMessage.create({
        speaker: payload.speaker,
        ...(payload.whisperGM ? { whisper: payload.whisperGM } : {}),
        content: `<p><strong>${payload.effect?.name ?? 'Curse'}</strong> is lifted from `
               + `<strong>${bearer?.name ?? 'the bearer'}</strong> and jumps to `
               + `<strong>${recipient?.name ?? 'the recipient'}</strong>.</p>`,
      });
      break;
    }
    case 'deleteEffects': {
      const target = await fromUuid(payload.targetActorUuid);
      if (!target) return;
      const ids = (payload.effectIds ?? []).filter(id => target.effects.get(id));
      if (ids.length) await target.deleteEmbeddedDocuments('ActiveEffect', ids);
      break;
    }
  }
}
