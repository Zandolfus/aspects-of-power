/**
 * Pure-function regression tests — run in plain node (no Foundry):
 *   node tests/run_pure_tests.mjs
 *
 * Expected values are GOLDEN NUMBERS pulled from the live world
 * (migration/local/golden_baseline.json + live-fired chat cards), not
 * hand-derived — per the house get-the-math-from-the-game rule. If a test
 * fails after an intentional formula change, re-pull the golden numbers and
 * update BOTH together in one commit.
 */
import {
  houseHitFormula, hybridAbilityMod, weaponStatBlend, spellDamageRef,
  spellInvestDamage, strikeInvestDamage, infusionDamage, investSelfDamage,
  effectiveDodgeValue, splitEvenlyWithRemainder,
} from '../module/helpers/formulas.mjs';

const CFG = {
  meleeBlend: { strFloor: 0.30, slope: 0.70, weightOffset: 40, weightSpan: 180 },
  rangedBlend: { perFloor: 0.05, slope: 0.55, weightOffset: 50, weightSpan: 200 },
  spellTierFactors: { basic: 2, high: 4, greater: 8, major: 25, grand: 50 },
  defenseTuning: { dodgeBasisDiv: 1.1, scrambleStackPct: 0.15 },
};

let failures = 0;
function eq(name, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

// House hit grammar — string must match the golden fixture formulas verbatim.
eq('houseHitFormula(321)', houseHitFormula(321), '((((d20/100)*(321))+(321)))');

// Weapon blends — live-verified spellstrike hit blends (2026-07-03 fires):
// Aiden longsword wt100 str149 dex518 → 321; John wt100 str288 dex218 → 255.
eq('blend Aiden sword', weaponStatBlend(100, { str: 149, dex: 518 }, false, CFG).blend, 321);
eq('blend John sword', weaponStatBlend(100, { str: 288, dex: 218 }, false, CFG).blend, 255);
eq('blend label melee', weaponStatBlend(100, { str: 1, dex: 1 }, false, CFG).label, 'Str/Dex');
// Ranged: wt130 bow, dex518 per236 → perW=0.05+0.55×(80/200)=0.27 → 518×0.73+236×0.27=441.9→442.
eq('blend ranged bow', weaponStatBlend(130, { dex: 518, per: 236 }, true, CFG).blend, 442);
// Weight clamping: below offset → floor weights.
eq('blend clamp low', weaponStatBlend(10, { str: 100, dex: 200 }, false, CFG).blend, Math.round(100 * 0.30 + 200 * 0.70));

// Hybrid ability mod (item.mjs _buildRollFormulas 710-717 semantics).
const abilities = { intelligence: { mod: 759 }, dexterity: { mod: 518 } };
eq('hybrid pure', hybridAbilityMod(abilities, { abilities: 'intelligence', statType: 'pure' }), 759);
eq('hybrid 70/30', hybridAbilityMod(abilities, { abilities: 'intelligence', statType: 'hybrid', secondaryAbility: 'dexterity', primaryWeight: 0.7, secondaryWeight: 0.3 }), Math.round(759 * 0.7 + 518 * 0.3));

// Spell damage ref — the 65f8a42 fix constant. E grade factor 10 → 20.
eq('spellDamageRef E', spellDamageRef(10, CFG), 20);

// Infusion — live-verified dac55a5 re-fire: Aiden int759 coef0.7 32 mana ref20 → 584.
eq('infusion Aiden 32', infusionDamage(759, 0.7, 32, 20), 584);
// Pre-fix reproduction: coef 1, 120 mana vs own-base 20 → 1086 (the original live fire).
eq('infusion legacy repro', infusionDamage(759, 1.0, 120, 20), 1086);

// Strike invest — live-verified Cross Wind strike: blend321 ×0.9 mult ×1.0 windup, 9 stam / 1 base → 448.
eq('strike Aiden CW', strikeInvestDamage(321, 0.9, 1.0, 9, 1), 448);

// Spell invest — live-verified spell-tier fix ladder (int759, mult 0.5 inferior… use exact ladder):
// From 65f8a42 verify: basic 584 at safe invest. basic: tierBase 20, wisCap 20+238×0.05≈32 → int759×mult×(32/20)^0.2.
// With mult chosen so result 584: 584 = 759×m×1.0985 → m≈0.7005 → uncommon 0.7. Check:
eq('spell basic uncommon', spellInvestDamage(759, 0.7, 32, 20), 584);

// Self-damage: linear past safe ceiling. Aiden CW test fire: blend321, 9 invested, base 1, safe 4 → excess 4 → 321×(4/4)=321 (live: 321 self-damage).
eq('selfDamage Aiden CW', investSelfDamage(321, 9, 1, 4), 321);
eq('selfDamage none', investSelfDamage(321, 5, 1, 4), 0);

// Effective dodge value: def 400, div 1.1, 2 stacks → (400/1.1)×0.7 = 254.54…
eq('dodge value', Math.round(effectiveDodgeValue({ system: { defense: { melee: { value: 400 } } } }, 'melee', 2, CFG.defenseTuning)), 255);

// Even split with remainder.
eq('split 10/3', splitEvenlyWithRemainder(10, ['a', 'b', 'c']), { a: 3, b: 3, c: 4 });
eq('split exact', splitEvenlyWithRemainder(9, ['a', 'b', 'c']), { a: 3, b: 3, c: 3 });
eq('split single', splitEvenlyWithRemainder(7, ['x']), { x: 7 });
eq('split empty', splitEvenlyWithRemainder(7, []), {});

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll pure-function tests pass.');
