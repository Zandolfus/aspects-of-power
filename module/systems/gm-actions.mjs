/**
 * GM-routed action executor — the big payload.type switch, extracted VERBATIM
 * from documents/item.mjs (refactor 2026-07-03, ~710 lines). Runs ONLY on a
 * GM client: reached via AspectsofPowerItem.executeGmAction (a static
 * delegate kept for API stability) either directly when the user is a GM or
 * through the 'system.aspects-of-power' socket listener in the entry file.
 *
 * Handlers mutate world state (effects, pools, regions, trades) — additions
 * here must stay serializable-payload-in, no instance state.
 */
import { EquipmentSystem } from './equipment.mjs';

export async function executeGmAction(payload) {
    const msgWhisper = payload.whisperGM ? { whisper: payload.whisperGM } : {};
    switch (payload.type) {

      case 'gmCreateAoeRegion': {
        // Companion to the player-side _gmCreateRegion helper. Creates the
        // requested Region on the named scene and emits the new region's UUID
        // back via the same socket so the requester can resolve their promise.
        // The response includes targetUserId so non-requesting clients can
        // skip handler attach/detach work for an event that doesn't concern them.
        const respond = (regionUuid, error = null) => {
          game.socket.emit('system.aspects-of-power', {
            type: 'aoeRegionCreated',
            requestId: payload.requestId,
            targetUserId: payload.requesterId ?? null,
            regionUuid,
            error,
          });
        };
        const scene = game.scenes.get(payload.sceneId);
        if (!scene) { respond(null, 'Scene not found'); return; }
        try {
          const [region] = await scene.createEmbeddedDocuments('Region', [payload.regionData]);
          respond(region?.uuid ?? null);
        } catch (e) {
          console.error('[gmCreateAoeRegion] failed:', e);
          respond(null, String(e?.message ?? e));
        }
        return;
      }

      case 'gmDeleteAoeRegion': {
        // Cast-cancellation cleanup. Player can't delete regions they don't
        // own; GM does it on their behalf. Fire-and-forget — no response.
        const scene = game.scenes.get(payload.sceneId);
        if (!scene) return;
        try {
          await scene.deleteEmbeddedDocuments('Region', [payload.regionId]);
        } catch (e) {
          console.warn('[gmDeleteAoeRegion] failed:', e);
        }
        return;
      }

      case 'gmApplyRestoration': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const resource    = payload.resource ?? 'health';
        const pool        = target.system[resource];
        const resLabel    = resource.charAt(0).toUpperCase() + resource.slice(1);

        // Health restoration; overflows into overhealth only if skill opts in.
        if (resource === 'health') {
          const newHealth   = Math.min(pool.max, pool.value + payload.amount);
          const healthGain  = newHealth - pool.value;
          const excess      = payload.amount - healthGain;
          const updateData  = { 'system.health.value': newHealth };
          let ohGain = 0;

          if (excess > 0 && payload.overhealth && target.system.overhealth) {
            const oh       = target.system.overhealth;
            const ohCap    = oh.cap ?? (pool.max * 2);
            const newOh    = Math.min(ohCap, oh.value + excess);
            ohGain         = newOh - oh.value;
            updateData['system.overhealth.value'] = newOh;
          }

          await target.update(updateData);
          const ohNote = ohGain > 0 ? ` (+${ohGain} overhealth)` : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> restores <strong>${healthGain}</strong> ${resLabel}${ohNote}. `
                   + `${resLabel}: ${newHealth} / ${pool.max}</p>`,
          });
        } else if (resource === 'barrier') {
          // Barrier creation via ActiveEffect.
          const barrierValue = payload.amount;
          const affinities   = payload.barrierAffinities ?? [];
          const source       = payload.barrierSource ?? '';
          const affText = affinities.length > 0 ? ` (${affinities.join(', ')})` : '';

          // Check for existing barrier effect.
          const existingEffect = target.effects.find(e =>
            !e.disabled && e.system?.effectType === 'barrier'
          );

          // Prompt the target's owner to accept. If the target is an NPC, GM decides.
          const owners = Object.entries(target.ownership ?? {})
            .filter(([uid, level]) => level >= 3 && uid !== 'default')
            .map(([uid]) => uid);
          const playerOwner = owners.find(uid => {
            const u = game.users.get(uid);
            return u?.active && !u.isGM;
          });

          // Build confirmation prompt content.
          const existingNote = existingEffect
            ? `<p class="hint">This will replace the current barrier (${existingEffect.system?.barrierData?.value ?? 0} / ${existingEffect.system?.barrierData?.max ?? 0}).</p>`
            : '';
          const promptContent = `<p>Apply a <strong>${barrierValue}</strong> HP barrier${affText} from <strong>${source}</strong>?</p>${existingNote}`;

          let accepted = false;
          if (playerOwner) {
            // Send prompt to the player via socket and wait for response.
            const requestId = foundry.utils.randomID();
            accepted = await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                cleanup();
                resolve(true); // Default accept on timeout (30s).
              }, 30000);

              const handler = (response) => {
                if (response.type !== 'barrierPromptResponse' || response.requestId !== requestId) return;
                cleanup();
                resolve(response.accepted);
              };

              const cleanup = () => {
                clearTimeout(timeout);
                game.socket.off('system.aspects-of-power', handler);
              };

              game.socket.on('system.aspects-of-power', handler);
              game.socket.emit('system.aspects-of-power', {
                type: 'barrierPrompt',
                targetUserId: playerOwner,
                targetName: target.name,
                promptContent,
                requestId,
              });
            });
          } else {
            // GM-owned target (NPC) — prompt the GM directly.
            accepted = await foundry.applications.api.DialogV2.confirm({
              window: { title: `Barrier — ${target.name}` },
              content: promptContent,
              yes: { label: 'Accept', icon: 'fas fa-shield-alt' },
              no: { label: 'Decline' },
            });
          }

          if (!accepted) {
            ChatMessage.create({
              speaker: payload.speaker, ...msgWhisper,
              content: `<p><strong>${target.name}</strong> declined the barrier.</p>`,
            });
            return;
          }

          // Deduct caster's resource cost now that barrier was accepted.
          if (payload.casterActorUuid && payload.casterCost) {
            const caster = await fromUuid(payload.casterActorUuid);
            if (caster) {
              const res = payload.casterResource ?? 'mana';
              const curVal = caster.system[res]?.value ?? 0;
              await caster.update({ [`system.${res}.value`]: Math.max(0, curVal - payload.casterCost) });
            }
          }

          // Remove existing barrier effect if present.
          if (existingEffect) {
            await existingEffect.delete();
          }

          // Create barrier ActiveEffect. For reforming shells (Mana Shell),
          // `origin` ties the effect to the source skill so sustain-end
          // teardown drops it, and barrierData carries everything the
          // apply-damage reform branch needs (cost, payer, resource, the
          // sustain marker's skill id for reverse teardown).
          await target.createEmbeddedDocuments('ActiveEffect', [{
            name: `Barrier: ${source}`,
            img: 'icons/magic/defensive/shield-barrier-glowing-blue.webp',
            disabled: false,
            type: 'base',
            ...(payload.originUuid ? { origin: payload.originUuid } : {}),
            system: {
              effectType: 'barrier',
              effectCategory: 'temporary',
              barrierData: {
                value: barrierValue,
                max: barrierValue,
                affinities,
                source,
                ...(payload.barrierReform ? {
                  reform: true,
                  reformCost: payload.reformCost ?? 0,
                  reformResource: payload.casterResource ?? 'mana',
                  casterActorUuid: payload.casterActorUuid ?? null,
                  sourceSkillId: payload.sourceSkillId ?? null,
                } : {}),
              },
            },
          }]);

          const replaced = existingEffect ? ' (replaced existing barrier)' : '';
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> gains a <strong>${barrierValue}</strong> point barrier${affText}${replaced}.</p>`,
          });
        } else {
          const newValue    = Math.min(pool.max, pool.value + payload.amount);
          const actualGain  = newValue - pool.value;
          await target.update({ [`system.${resource}.value`]: newValue });
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> restores <strong>${actualGain}</strong> ${resLabel}. `
                   + `${resLabel}: ${newValue} / ${pool.max}</p>`,
          });
        }
        break;
      }

      case 'gmApplyBuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        // System overrides (e.g. Stormstride's movementSpeedMultiplier).
        // Applied verbatim to the effect's `system` fields on create/update.
        const sysOverrides = payload.systemOverrides ?? {};
        const hasSysOverrides = Object.keys(sysOverrides).length > 0;

        const existing = target.effects.find(
          e => e.origin === payload.originUuid && e.name === payload.effectName
        );

        if (existing && !existing.disabled) {
          if (payload.stackable) {
            // Stackable: merge new values into the existing effect's changes.
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of payload.changes) {
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
              if (match) {
                match.value = Number(match.value) + Number(incoming.value);
              } else {
                merged.push({ ...incoming });
              }
            }
            // Duration becomes the maximum of what's remaining vs. the new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);
            const updateData = {
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            };
            if (hasSysOverrides) updateData.system = sysOverrides;
            await existing.update(updateData);
            const mergedTotal = merged.reduce((sum, c) => sum + Number(c.value), 0);
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p>Buff on <strong>${target.name}</strong> stacked (total +${mergedTotal}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // Non-stackable: keep higher total.
            const newTotal = payload.changes.reduce((sum, c) => sum + Number(c.value), 0);
            const currentTotal = (existing.changes ?? []).reduce((sum, c) => sum + Number(c.value), 0);
            if (newTotal > currentTotal || hasSysOverrides) {
              const updateData = {
                changes: payload.changes,
                'duration.rounds': payload.duration,
                'duration.startRound': startRound,
                'duration.startTurn': startTurn,
              };
              if (hasSysOverrides) updateData.system = sysOverrides;
              await existing.update(updateData);
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p>Buff on <strong>${target.name}</strong> ${newTotal > currentTotal ? `upgraded (total +${newTotal}, was +${currentTotal})` : 'refreshed'}.</p>`,
              });
            } else {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p>Existing buff on <strong>${target.name}</strong> is stronger (+${currentTotal}). No change.</p>`,
              });
            }
          }
        } else {
          // No existing active effect (or disabled) — create new.
          if (existing?.disabled) {
            const updateData = {
              disabled: false,
              changes: payload.changes,
              'duration.rounds': payload.duration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            };
            if (hasSysOverrides) updateData.system = sysOverrides;
            await existing.update(updateData);
          } else {
            const createData = {
              name:   payload.effectName,
              img:    payload.img,
              origin: payload.originUuid,
              type:   'base',
              duration: { rounds: payload.duration, startRound, startTurn },
              disabled: false,
              changes: payload.changes,
            };
            if (hasSysOverrides) createData.system = sysOverrides;
            await target.createEmbeddedDocuments('ActiveEffect', [createData]);
          }
          const statSummary = payload.changes.map(c => {
            const attr = c.key.replace('system.', '').replace('.value', '');
            return `${attr} +${c.value}`;
          }).join(', ');
          // Reaction-config overrides (Phase E) are under-the-hood — don't
          // render them in the player-facing buff chat (they're not "×N"
          // multipliers and confuse the summary).
          const REACTION_CFG_KEYS = new Set(['reactionTrigger', 'reactionAttackType', 'reactionSkillId']);
          // Weapon-buff overrides render as a clean player-facing line, not raw
          // field names ("weaponBuffDamage ×79" → "+79 fire on strikes").
          const WEAPONBUFF_KEYS = new Set(['weaponBuffDamage', 'weaponBuffAffinities']);
          const HIDDEN_KEYS = new Set([...REACTION_CFG_KEYS, ...WEAPONBUFF_KEYS]);
          const visibleOverrides = Object.entries(sysOverrides)
            .filter(([k]) => !HIDDEN_KEYS.has(k));
          const sysSummary = visibleOverrides.map(([k, v]) => `${k} ×${v}`).join(', ');
          const reactionSummary = Object.keys(sysOverrides).some(k => REACTION_CFG_KEYS.has(k))
            ? `triggers ${sysOverrides.reactionTrigger}-reaction` : '';
          const weaponBuffSummary = (sysOverrides.weaponBuffDamage ?? 0) > 0
            ? `+${sysOverrides.weaponBuffDamage} ${(sysOverrides.weaponBuffAffinities ?? []).join('/') || 'weapon'} on strikes`
            : '';
          const fullSummary = [statSummary, sysSummary, weaponBuffSummary, reactionSummary].filter(Boolean).join('; ') || 'effect';
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> buffed: ${fullSummary} for ${payload.duration} rounds.</p>`,
          });
        }
        break;
      }

      case 'gmApplyRepair': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const materials = payload.materials ?? [];
        const restored = await EquipmentSystem.repairAllEquipped(target, payload.amount, materials);
        const matLabel = materials.length > 0
          ? materials.map(m => game.i18n.localize(CONFIG.ASPECTSOFPOWER.materialTypes[m] ?? m)).join(', ')
          : 'all';
        ChatMessage.create({
          speaker: payload.speaker, ...msgWhisper,
          content: `<p><strong>${payload.skillName}</strong> repairs <strong>${target.name}</strong>'s ${matLabel} equipment `
                 + `(+${restored} durability distributed across matching gear).</p>`,
        });
        break;
      }

      case 'gmApplyDebuff': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // ── Immunity check ──
        const debuffTypeCheck = payload.effectData?.system?.debuffType ?? 'none';
        const isImmune = target.isImmuneTo?.(debuffTypeCheck) || target.system?.collectedTags?.has?.(`${debuffTypeCheck}-immune`);
        if (isImmune) {
          ChatMessage.create({
            speaker: payload.speaker, ...msgWhisper,
            content: `<p><strong>${target.name}</strong> is immune to <strong>${game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffTypeCheck] ?? debuffTypeCheck)}</strong>!</p>`,
          });
          break;
        }

        // ── Resistance check — reduce duration ──
        if (payload.effectData && payload.duration) {
          const resistance = target.getResistance?.(debuffTypeCheck) ?? 0;
          if (resistance > 0 && payload.effectData.system?.debuffDamage) {
            // Flat reduction to debuff strength (break threshold).
            payload.effectData.system.debuffDamage = Math.max(0, payload.effectData.system.debuffDamage - resistance);
            if (payload.effectData.system.debuffDamage <= 0) {
              ChatMessage.create({
                speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> resists <strong>${game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffTypeCheck] ?? debuffTypeCheck)}</strong> entirely! (resistance: ${resistance})</p>`,
              });
              break;
            }
          }
        }

        // ── CC-through-veil — mind/soul debuff potency reduced by veil ──
        // Per design-archetype-defense-gap.md: veil is the magical-effect
        // mitigation layer. Mind/soul-targeting debuffs (sleep, charm, fear…)
        // have their potency (debuffDamage) flat-reduced by the target's
        // veil; fully absorbed = "warded", effect never applies. Mirrors
        // resistance semantics exactly: only debuffDamage is reduced (stat
        // changes stay full on partial), message only on full negation.
        // Physical-lane debuffs (melee/ranged targetDefense) are untouched.
        // Marks (Feint, Marked for Death) are tactical setups, NOT CC potency
        // — veil must NOT ward them, or a feint vs a veiled foe applies nothing
        // and the next strike has no mark to consume (live bug 2026-06-14).
        const _isMark = (payload.effectData?.system?.markedDamageBonus ?? 0) > 0
          || (payload.effectData?.system?.markedAttackMultiplier ?? 0) > 0;
        if (['mind', 'soul'].includes(payload.targetDefense) &&
            payload.effectData?.system?.debuffDamage > 0 && !_isMark) {
          const veil = target.system.defense?.veil?.value ?? 0;
          if (veil > 0) {
            payload.effectData.system.debuffDamage = Math.max(0, payload.effectData.system.debuffDamage - veil);
            if (payload.effectData.system.debuffDamage <= 0) {
              ChatMessage.create({
                speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> is warded against <strong>${game.i18n.localize(CONFIG.ASPECTSOFPOWER.debuffTypes[debuffTypeCheck] ?? debuffTypeCheck)}</strong>! (veil: ${veil})</p>`,
              });
              break;
            }
          }
        }

        const combat = game.combat;
        const startRound = combat?.round ?? 0;
        const startTurn  = combat?.turn ?? 0;

        // Apply strategy depends on debuff category:
        //   - Singleton mental (charm/fear/taunt/enraged): caster-agnostic
        //     search by debuffType. Existing → refresh-with-max. "You're
        //     either charmed or not"; the strongest wins.
        //   - Stackable physical (skill flag stackable=true): always create
        //     a parallel effect with its own duration. Foundry sums their
        //     `changes` natively (ADD mode), DoTs tick per-effect, oldest
        //     expires first dropping its contribution to the aggregate.
        //     Replaces the legacy "merge + stack value + refresh duration"
        //     model which was an infinite-damage source (refreshing
        //     duration while damage stacked forever).
        //   - Non-stackable physical (skill flag stackable=false): search
        //     by origin+name (same caster, same skill). Existing → refresh-
        //     with-max. Different casters' versions remain parallel.
        if (payload.effectData) {
          const debuffTypeForApply = payload.effectData?.system?.debuffType;
          const singletons = CONFIG.ASPECTSOFPOWER.singletonDebuffs ?? [];
          const isSingleton = singletons.includes(debuffTypeForApply);

          let existing = null;
          if (isSingleton) {
            // Caster-agnostic: any active effect with same debuffType.
            existing = target.effects.find(e =>
              e.system?.debuffType === debuffTypeForApply && !e.disabled
            );
          } else if (!payload.stackable) {
            // Same-source: caster's same skill.
            existing = target.effects.find(e =>
              e.origin === payload.originUuid &&
              e.name === payload.effectName &&
              !e.disabled
            );
          }
          // Stackable physical: existing stays null → always create parallel.

          if (existing) {
            // ── Refresh-with-max ──
            // For each stat change key: keep the larger-magnitude value
            // (incoming "wins" if its absolute value is bigger).
            const merged = [...(existing.changes ?? [])].map(c => ({ ...c }));
            for (const incoming of (payload.effectData.changes ?? [])) {
              const match = merged.find(m => m.key === incoming.key && m.type === incoming.type);
              if (match) {
                if (Math.abs(Number(incoming.value)) > Math.abs(Number(match.value))) {
                  match.value = incoming.value;
                }
              } else {
                merged.push({ ...incoming });
              }
            }

            // Duration: max of remaining-on-existing vs new application.
            const existingRemaining = ((existing.duration?.startRound ?? 0) + (existing.duration?.rounds ?? 0)) - startRound;
            const newDuration = Math.max(existingRemaining, payload.duration);

            const updateData = {
              changes: merged,
              'duration.rounds': newDuration,
              'duration.startRound': startRound,
              'duration.startTurn': startTurn,
            };

            const existingSys = existing.system ?? {};
            const incomingSys = payload.effectData.system ?? {};
            const newDebuffDamage = Math.max(existingSys.debuffDamage ?? 0, incomingSys.debuffDamage ?? 0);

            // Reset breakProgress + roundsAfflicted: fresh affliction
            // overwhelms accumulated break-momentum (per design-movement-modes).
            const systemUpdate = { debuffDamage: newDebuffDamage, breakProgress: 0, roundsAfflicted: 0 };

            // DoT: keep the larger damage of existing vs incoming.
            if (incomingSys.dot || existingSys.dot) {
              systemUpdate.dot = true;
              systemUpdate.dotDamage = Math.max(existingSys.dotDamage ?? 0, incomingSys.dotDamage ?? 0);
              systemUpdate.dotDamageType = incomingSys.dotDamageType || existingSys.dotDamageType;
              systemUpdate.applierActorUuid = incomingSys.applierActorUuid || existingSys.applierActorUuid;
              updateData.description = `Deals <strong>${systemUpdate.dotDamage}</strong> ${systemUpdate.dotDamageType} damage per round (bypasses armor &amp; veil; reduced by Toughness).`;
            }

            updateData.system = systemUpdate;
            await existing.update(updateData);

            const refreshReason = isSingleton ? 'singleton-refresh' : 'same-source refresh';
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p>Debuff on <strong>${target.name}</strong> refreshed (${refreshReason}, strength ${newDebuffDamage}) for ${newDuration} rounds.</p>`,
            });
          } else {
            // No existing — create new effect. Use nested duration object for v14.
            if (!payload.effectData.duration) payload.effectData.duration = {};
            payload.effectData.duration.startRound = startRound;
            payload.effectData.duration.startTurn = startTurn;
            await target.createEmbeddedDocuments('ActiveEffect', [payload.effectData]);

            if (payload.statSummary) {
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> debuffed: ${payload.statSummary} for ${payload.duration} rounds.</p>`,
              });
            }

            // Blind: apply Foundry blind status to disable token vision.
            const dType = payload.effectData.system?.debuffType;
            if (dType === 'blind') {
              const tokens = target.getActiveTokens();
              for (const t of tokens) {
                if (!t.document.hasStatusEffect('blind')) {
                  await t.document.toggleActiveEffect({ id: 'blind', name: 'Blind', img: 'icons/svg/blind.svg' }, { active: true });
                }
              }
            }

            // Dismembered: force-unequip items in the disabled slot.
            const dSlot = payload.effectData.system?.dismemberedSlot;
            if (dType === 'dismembered' && dSlot) {
              const equippedInSlot = target.items.filter(
                i => i.type === 'item' && i.system.equipped && i.system.slot === dSlot
              );
              for (const equippedItem of equippedInSlot) {
                await EquipmentSystem.unequip(equippedItem);
              }
              const slotLabel = game.i18n.localize(`ASPECTSOFPOWER.Equip.Slot.${dSlot}`) || dSlot;
              ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
                content: `<p><strong>${target.name}</strong> loses use of <strong>${slotLabel}</strong> slot!</p>`,
              });
            }
          }
        }

        // Immediate DoT damage (bypasses armor/veil AND barrier, but not DR).
        // Pre-existing wounds bypass barriers — routes through: Overhealth → HP.
        if (payload.dotDamage > 0) {
          const dotDR = target.system.defense?.dr?.value ?? 0;
          let remaining = Math.max(0, payload.dotDamage - dotDR);
          const updateData = {};
          const parts = [];

          // Overhealth absorbs first (DoTs bypass barrier).
          const overhealth = target.system.overhealth;
          if (remaining > 0 && overhealth.value > 0) {
            const absorbed = Math.min(overhealth.value, remaining);
            remaining -= absorbed;
            updateData['system.overhealth.value'] = overhealth.value - absorbed;
            parts.push(`Overhealth: −${absorbed}`);
          }

          // Remaining hits HP.
          const health = target.system.health;
          const newHealth = Math.max(0, health.value - remaining);
          updateData['system.health.value'] = newHealth;
          if (remaining > 0) parts.push(`Health: −${remaining}`);

          await target.update(updateData);

          const mitigated = Math.max(0, payload.dotDamage - dotDR);
          const breakdown = parts.length ? ` (${parts.join(', ')})` : '';
          ChatMessage.create({
            whisper: ChatMessage.getWhisperRecipients('GM'),
            content: `<p><strong>${target.name}</strong> takes <strong>${mitigated}</strong> `
                   + `${payload.dotDamageType} damage from ${payload.effectName} (DR: −${dotDR})${breakdown}. `
                   + `Health: ${newHealth} / ${health.max}`
                   + `${newHealth === 0 ? ' &mdash; <em>Incapacitated!</em>' : ''}</p>`,
          });
        }

        // ── Chilled → Frozen threshold transformation ──
        // After applying a chilled stack, sum debuffDamage across all
        // active chilled effects. If the total meets or exceeds the
        // target's dexterity mod (i.e. would drive effectiveDex to 0),
        // transform: delete all chilled stacks, spawn Frozen. Per
        // design-player-augments.md — confirmed UX: replace, don't layer.
        const applyDType = payload.effectData?.system?.debuffType;
        if (applyDType === 'chilled') {
          const chillStacks = target.effects.filter(e =>
            !e.disabled && e.system?.debuffType === 'chilled'
          );
          const chillTotal = chillStacks.reduce(
            (s, e) => s + (Number(e.system?.debuffDamage) || 0), 0
          );
          const dexMod = target.system.abilities?.dexterity?.mod ?? 0;
          if (chillTotal >= dexMod && chillTotal > 0) {
            // Delete chilled stacks.
            await target.deleteEmbeddedDocuments('ActiveEffect',
              chillStacks.map(e => e.id));
            // Spawn Frozen if not already frozen.
            const existingFrozen = target.effects.find(e =>
              !e.disabled && e.system?.debuffType === 'frozen'
            );
            const frozenDuration = 2;
            if (existingFrozen) {
              await existingFrozen.update({
                'duration.rounds':     frozenDuration,
                'duration.startRound': startRound,
                'duration.startTurn':  startTurn,
              });
            } else {
              await target.createEmbeddedDocuments('ActiveEffect', [{
                name: 'Frozen',
                img:  'icons/magic/water/snowflake-ice-blue.webp',
                origin: payload.effectData?.origin ?? '',
                duration: { rounds: frozenDuration, startRound, startTurn },
                system: {
                  debuffType:       'frozen',
                  debuffDamage:     0,
                  casterActorUuid:  payload.effectData?.system?.casterActorUuid ?? '',
                  tags:             ['ice', 'frozen'],
                },
              }]);
            }
            ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
              content: `<p><strong>${target.name}</strong> is <strong>Frozen</strong>! `
                     + `(${chillStacks.length} chill stacks × ${Math.round(chillTotal/chillStacks.length)} dex ≥ ${dexMod} dex mod)</p>`,
            });
          }
        }
        break;
      }

      case 'gmApplyCleanse': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;

        // Find all magical debuffs on the target, sorted strongest (highest debuffDamage) first.
        const magicalDebuffs = target.effects
          .filter(e => {
            if (e.disabled) return false;
            const sys = e.system;
            if (!sys?.debuffType || sys.debuffType === 'none') return false;
            return sys.magicType === 'magical';
          })
          .sort((a, b) =>
            (b.system?.debuffDamage ?? 0) - (a.system?.debuffDamage ?? 0)
          );

        if (magicalDebuffs.length === 0) {
          ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
            content: `<p><em>${game.i18n.localize('ASPECTSOFPOWER.Cleanse.noDebuffs')}</em></p>`,
          });
          break;
        }

        // Distribute cleanse roll total across debuffs as breakProgress.
        let budget = payload.rollTotal;
        const results = [];
        for (const effect of magicalDebuffs) {
          if (budget <= 0) break;
          const sys = effect.system;
          const threshold = sys.debuffDamage ?? 0;
          const previousProgress = sys.breakProgress ?? 0;
          const typeName = game.i18n.localize(
            CONFIG.ASPECTSOFPOWER.debuffTypes[sys.debuffType] ?? sys.debuffType
          );

          // Add full budget to this effect's progress.
          const newProgress = previousProgress + budget;

          if (newProgress >= threshold && threshold > 0) {
            // Cleansed! Remove the effect, carry over excess.
            const excess = newProgress - threshold;
            budget = excess;
            await effect.delete();
            results.push(`<strong>${typeName}</strong> ${game.i18n.localize('ASPECTSOFPOWER.Cleanse.cleansed')} <strong>${target.name}</strong>! [${newProgress} / ${threshold}]`);
          } else {
            // Partial progress — consume entire budget.
            await effect.update({ 'system.breakProgress': newProgress });
            budget = 0;
            results.push(`${game.i18n.localize('ASPECTSOFPOWER.Cleanse.progress')} <strong>${typeName}</strong>: [${newProgress} / ${threshold}]`);
          }
        }

        ChatMessage.create({ speaker: payload.speaker, ...msgWhisper,
          content: `<p><strong>${payload.skillName}</strong> cleanses <strong>${target.name}</strong> (roll: ${payload.rollTotal}):</p>`
                 + `<ul>${results.map(r => `<li>${r}</li>`).join('')}</ul>`,
        });
        break;
      }

      case 'gmUpdateDefensePool': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const defKey = payload.defKey;
        if (!['melee', 'ranged', 'mind', 'soul'].includes(defKey)) return;
        await target.update({ [`system.defense.${defKey}.pool`]: payload.newPool });
        break;
      }

      case 'gmConsumeReaction': {
        const target = await fromUuid(payload.targetActorUuid);
        if (!target) return;
        const reactions = target.system.reactions;
        if (reactions && reactions.value > 0) {
          await target.update({ 'system.reactions.value': reactions.value - 1 });
        }
        break;
      }

      case 'gmExecuteTrade': {
        const { TradingSystem } = await import('../systems/trading.mjs');
        await TradingSystem._performTransfer(payload);
        break;
      }
    }
}
