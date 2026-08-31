/**
 * Combat log export (RULED 2026-08-31: "trim the chat nonsense and export
 * to a combat log" — journal destination, messages KEPT in the DB).
 *
 * The chat diet hides log-only classes (path adjustments, round-begins,
 * regen, movement declares, AI whispers) from the rendered chat; this
 * module is where they remain readable. Every combat stamps its start
 * time at combatStart; ending/deleting the combat exports one Journal
 * entry holding the COMPLETE ordered message record of the fight —
 * hidden classes, GM whispers and all, each row labelled.
 *
 * Manual export any time: `game.aspectsofpower.exportCombatLog()` (the
 * active combat) — useful mid-fight or for a combat ended before this
 * shipped (falls back to the last 4 hours when no start stamp exists).
 */

import { isActingGM } from '../helpers/gm.mjs';

const FLAG_NS = 'aspectsofpower';

function _flatten(msg) {
  const flavor = msg.flavor ? `<strong>${msg.flavor}</strong> ` : '';
  const speaker = msg.speaker?.alias ? `${msg.speaker.alias}: ` : '';
  const marks = [];
  if (msg.whisper?.length) marks.push('GM');
  if (msg.flags?.[FLAG_NS]?.logOnly) marks.push('log');
  const mark = marks.length ? ` <span style="opacity:0.6">[${marks.join(', ')}]</span>` : '';
  const t = new Date(msg.timestamp).toTimeString().slice(0, 8);
  return `<div style="margin:2px 0"><span style="opacity:0.6">[${t}]</span> `
    + `${speaker}${flavor}${msg.content}${mark}</div>`;
}

export async function exportCombatLog(combat = null) {
  combat = combat ?? game.combats.find(c => c.started) ?? game.combat;
  const startedAtMs = combat?.flags?.[FLAG_NS]?.startedAtMs
    ?? (Date.now() - 4 * 3600 * 1000);
  const endMs = Date.now();
  const rows = [...game.messages]
    .filter(m => m.timestamp >= startedAtMs && m.timestamp <= endMs)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(_flatten);
  if (!rows.length) {
    ui.notifications.warn('Combat log export: no messages in the window.');
    return null;
  }
  const sceneName = combat?.scene?.name ?? canvas.scene?.name ?? 'combat';
  const stamp = new Date(startedAtMs);
  const name = `Combat Log — ${sceneName} — ${stamp.toISOString().slice(0, 10)} `
    + `${stamp.toTimeString().slice(0, 5)}`;
  const entry = await JournalEntry.create({
    name,
    pages: [{
      name: `${rows.length} messages`,
      type: 'text',
      text: { format: 1, content: rows.join('\n') },
    }],
  });
  ui.notifications.info(`Combat log exported: ${name} (${rows.length} messages).`);
  return entry;
}

export function registerCombatLog() {
  // Stamp the fight's start so the export window is exact. Acting GM only
  // (a world write from a hook every client runs — standard 3).
  Hooks.on('combatStart', async (combat) => {
    if (!isActingGM()) return;
    try {
      await combat.update({ [`flags.${FLAG_NS}.startedAtMs`]: Date.now() });
    } catch (e) { console.warn('[combat-log] start stamp failed:', e); }
  });

  // Auto-export when the fight is ended/deleted — the moment the GM clicks
  // "End Combat" the journal appears; nothing to remember.
  Hooks.on('deleteCombat', async (combat) => {
    if (!isActingGM()) return;
    if (!combat.started) return;
    try { await exportCombatLog(combat); }
    catch (e) { console.warn('[combat-log] export failed:', e); }
  });
}
