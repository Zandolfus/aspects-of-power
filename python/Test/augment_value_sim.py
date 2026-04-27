"""
Augment value simulator for Aspects of Power.

Models the craft formula from module/documents/item.mjs (_handleCraftTag, _buildRollFormulas)
and measures the % improvement each augment type provides over a no-augment baseline.

Craft pipeline (generic skills, roll.type = ''):
    dmgRoll      = ((dice/100 + 1) * abilityMod) * diceBonus
    skillRoll    = round(dmgRoll) + skillModBonus      # skillModBonus from augments
    d100Pct      = (d100 + rarityFloor) / 100
    crafterRoll  = round(skillRoll * d100Pct)
    crafterCtrb  = round(crafterRoll * 0.5)
    materialCtrb = round(materialProgress * 0.5)
    totalProgress = materialCtrb + crafterCtrb + prepBonus + progressBonus

Augment value model: each augment is itself crafted using the standard pipeline. Most
augments derive their bonus value from MAGNIFIER_PCT of the crafter's craft roll
(specialist self-crafts the augment).

EXCEPTIONS:
- d100Bonus: flat per-grade (rarity tier), NOT magnifier-derived. Even +1 is significant.
- materialPotency: flat additive to material progress.
- maxProgressBoost: % bump to theoretical max craft cap.
"""
import random
import statistics
from dataclasses import dataclass, field
from typing import Callable, Optional

random.seed(42)

# -- Constants ----------------------------------------------------------------
N_SIMS = 20000
MAGNIFIER_PCT = 0.05
CRIT_SUCCESS_MULTIPLIER = 1.5  # if d100 >= crit_success_threshold, progress * this

# d100Bonus per rarity grade (flat values, NOT magnifier-derived).
D100_BONUS_BY_RARITY = {
    'common':    1,
    'uncommon':  2,
    'rare':      3,
    'epic':      4,
    'legendary': 5,
    'mythic':    6,
    'divine':    7,
}

# reworkDecayReduce per rarity grade (flat per-grade, hard-capped < 1 so denominator stays > 0).
REWORK_DECAY_REDUCE_BY_RARITY = {
    'common':    0.05,
    'uncommon':  0.10,
    'rare':      0.15,
    'epic':      0.20,
    'legendary': 0.25,
    'mythic':    0.30,
    'divine':    0.35,
}

# -- Crafter profiles (from in-game data, 2026-04-25) ------------------------
@dataclass
class CraftSkill:
    name: str
    dice_size: int
    dice_count: int
    ability_mod: int
    dice_bonus: float

    def roll(self) -> int:
        dice_total = sum(random.randint(1, self.dice_size) for _ in range(self.dice_count))
        return round(((dice_total / 100) + 1) * self.ability_mod * self.dice_bonus)

    def avg_roll(self) -> float:
        avg_dice = self.dice_count * (self.dice_size + 1) / 2
        return ((avg_dice / 100) + 1) * self.ability_mod * self.dice_bonus

@dataclass
class Crafter:
    name: str
    main_craft: CraftSkill
    prep_skill: Optional[CraftSkill] = None
    craft_type: str = 'smithing'  # 'smithing' / 'jewelry' / 'alchemy' (gates materialPreservation)

JOHN = Crafter(
    name='John (Smith, L47 prof)',
    main_craft=CraftSkill('Smithing', dice_size=6, dice_count=1, ability_mod=1136, dice_bonus=0.6),
    craft_type='smithing',
)
WILLY = Crafter(
    name='Willy (Jeweler, L43 prof)',
    main_craft=CraftSkill('Jewelcutting', dice_size=12, dice_count=1, ability_mod=904, dice_bonus=0.5),
    prep_skill=CraftSkill('Magnifier', dice_size=6, dice_count=1, ability_mod=563, dice_bonus=0.8),
    craft_type='jewelry',
)

# -- Craft inputs (the knobs augments can modify) ----------------------------
@dataclass
class CraftInputs:
    crafter: Crafter
    material_progress: int = 500
    rarity_floor: int = 0
    skill_mod_bonus: int = 0          # craftSkillMod
    progress_bonus: int = 0           # craftProgress
    prep_bonus: int = 0               # prepBonus
    d100_bonus: int = 0               # d100Bonus (flat per-grade)
    d100_floor_threshold: int = 0     # d100Reroll: reroll if d100 <= this
    crit_fail_proc_pct: int = 0       # critFailReduce: % chance to fire when d100 <= 1, sets d100 to 2 AND saves material
    crit_success_threshold: int = 101 # critSuccessThreshold: d100 >= this is crit success (101 = impossible)
    material_preservation_pct: int = 0  # materialPreservation: % of materials kept on crit fail
    max_progress_cap: int = 999_999   # maxProgressBoost lifts this; most crafts don't hit it
    rework_decay_reduction: float = 0 # reworkDecayReduce: subtracted from denominator (slower decay), hard cap < 1

@dataclass
class CraftResult:
    progress: int
    crit_fail: bool
    crit_success: bool
    material_lost: bool   # True if crit fail and not preserved by augment

def simulate_craft(inputs: CraftInputs) -> CraftResult:
    skill_total = inputs.crafter.main_craft.roll()
    skill_roll = round(skill_total) + inputs.skill_mod_bonus

    d100 = random.randint(1, 100)
    if inputs.d100_floor_threshold > 0 and d100 <= inputs.d100_floor_threshold:
        d100 = random.randint(1, 100)

    original_crit_fail = (d100 <= 1)
    crit_fail_mitigated = False
    if original_crit_fail and inputs.crit_fail_proc_pct > 0:
        # Roll the proc: if it fires, set d100 to 2 (just barely not a failure) AND save material.
        if random.randint(1, 100) <= inputs.crit_fail_proc_pct:
            d100 = 2
            crit_fail_mitigated = True

    crit_success = (d100 >= inputs.crit_success_threshold)

    d100_adjusted = d100 + inputs.d100_bonus + inputs.rarity_floor
    d100_pct = max(0.01, d100_adjusted / 100)

    crafter_roll = round(skill_roll * d100_pct)
    crafter_ctrb = round(crafter_roll * 0.5)
    material_ctrb = round(inputs.material_progress * 0.5)
    progress = material_ctrb + crafter_ctrb + inputs.prep_bonus + inputs.progress_bonus

    if crit_success:
        progress = round(progress * CRIT_SUCCESS_MULTIPLIER)

    progress = min(progress, inputs.max_progress_cap)

    # Material loss: only on un-mitigated crit fail. critFailReduce mitigation saves material;
    # otherwise materialPreservation may save it (smith/jewel/tailor/leather only).
    material_lost = False
    if original_crit_fail and not crit_fail_mitigated:
        if inputs.crafter.craft_type in {'smithing', 'jewelry', 'tailoring', 'leatherworking'}:
            if random.randint(1, 100) > inputs.material_preservation_pct:
                material_lost = True
        else:
            # Alchemy / other: materials always lost on un-mitigated crit fail.
            material_lost = True

    return CraftResult(progress=progress, crit_fail=original_crit_fail, crit_success=crit_success, material_lost=material_lost)

def avg_craft(inputs: CraftInputs, n: int = N_SIMS) -> dict:
    results = [simulate_craft(inputs) for _ in range(n)]
    progs = [r.progress for r in results]
    return {
        'mean':         statistics.mean(progs),
        'stdev':        statistics.stdev(progs),
        'min':          min(progs),
        'p5':           sorted(progs)[int(n * 0.05)],
        'max':          max(progs),
        'crit_fail_rate':    sum(r.crit_fail for r in results) / n,
        'crit_succ_rate':    sum(r.crit_success for r in results) / n,
        'material_loss_rate':sum(r.material_lost for r in results) / n,
    }

# -- Rework sim (separate scenario for reworkDecayReduce) ---------------------
def simulate_rework_chain(crafter: Crafter, n_iterations: int = 5, decay_reduction: int = 0) -> float:
    """
    Iterative rework: each successive craft adds 1/(rework_count+1-decay_reduction)
    of its progress to the existing item, capped at maxProgress.
    Returns total cumulative progress over the chain.
    """
    inputs = CraftInputs(crafter=crafter)
    total = 0.0
    for i in range(n_iterations):
        denom = max(1, (i + 1) - decay_reduction)
        result = simulate_craft(inputs)
        total += result.progress / denom
    return total

def avg_rework_chain(crafter: Crafter, n: int = 2000, **kw) -> float:
    return statistics.mean(simulate_rework_chain(crafter, **kw) for _ in range(n))

# -- Augment value derivation -------------------------------------------------
def derive_magnifier_value(crafter: Crafter) -> int:
    typical = avg_craft(CraftInputs(crafter=crafter), n=2000)
    return max(1, round(typical['mean'] * MAGNIFIER_PCT))

# -- Augment definitions ------------------------------------------------------
@dataclass
class Augment:
    type_id: str
    label: str
    apply: Callable[[CraftInputs, float], CraftInputs]
    value_kind: str = 'magnifier'  # 'magnifier' / 'flat_per_rarity_d100' / 'flat_per_rarity_decay' / 'flat'
    flat_value: int = 0

def with_augment(inputs: CraftInputs, augment: Augment, value: int) -> CraftInputs:
    new_inputs = CraftInputs(**inputs.__dict__)
    return augment.apply(new_inputs, value)

AUGMENTS = [
    Augment('d100Bonus', 'd100 Bonus (flat per-grade)',
        lambda inp, v: setattr(inp, 'd100_bonus', inp.d100_bonus + v) or inp,
        value_kind='flat_per_rarity_d100'),
    Augment('craftProgress', 'Craft Progress (flat add)',
        lambda inp, v: setattr(inp, 'progress_bonus', inp.progress_bonus + v) or inp),
    Augment('prepBonus', 'Prep Bonus',
        lambda inp, v: setattr(inp, 'prep_bonus', inp.prep_bonus + v) or inp),
    Augment('materialPotency', 'Material Potency (flat to material)',
        lambda inp, v: setattr(inp, 'material_progress', inp.material_progress + v) or inp,
        value_kind='flat'),
    Augment('d100Reroll', 'd100 Reroll (<= threshold)',
        lambda inp, v: setattr(inp, 'd100_floor_threshold', max(inp.d100_floor_threshold, min(30, v))) or inp),
    Augment('critFailReduce', 'Crit Fail Reduce (% chance to proc on d100<=1, sets to 2 + saves mat)',
        lambda inp, v: setattr(inp, 'crit_fail_proc_pct', max(inp.crit_fail_proc_pct, min(100, v))) or inp),
    Augment('critSuccessThreshold', 'Crit Success Threshold (>= 100-N, hard floor 90)',
        lambda inp, v: setattr(inp, 'crit_success_threshold', max(90, 100 - min(10, v))) or inp),
    Augment('materialPreservation', 'Material Preservation (% on crit fail, smith/jewel only)',
        lambda inp, v: setattr(inp, 'material_preservation_pct', min(60, v * 3)) or inp),
    Augment('maxProgressBoost', 'Max Progress Boost (% lift to cap, capped scenario)',
        lambda inp, v: setattr(inp, 'max_progress_cap', round(inp.max_progress_cap * (1 + v / 100))) or inp),
    Augment('reworkDecayReduce', 'Rework Decay Reduce (per-grade, only meaningful in chain sim)',
        lambda inp, v: inp,  # rework augment is applied separately in the chain sim
        value_kind='flat_per_rarity_decay'),
]

# -- Reporting ----------------------------------------------------------------
def run_sim_for_crafter(crafter: Crafter):
    print(f'\n{"="*100}\n{crafter.name}\n{"="*100}')
    print(f'Main craft: {crafter.main_craft.name} (d{crafter.main_craft.dice_size} x mod {crafter.main_craft.ability_mod} x {crafter.main_craft.dice_bonus})')
    print(f'Avg skill roll: {crafter.main_craft.avg_roll():.1f}  |  Craft type: {crafter.craft_type}')

    baseline_inputs = CraftInputs(crafter=crafter)
    baseline = avg_craft(baseline_inputs)
    print(f'\nBaseline (no augment):')
    print(f'  mean={baseline["mean"]:.1f}  stdev={baseline["stdev"]:.1f}  min={baseline["min"]}  p5={baseline["p5"]}  max={baseline["max"]}')
    print(f'  crit_fail_rate={baseline["crit_fail_rate"]*100:.2f}%  material_loss_rate={baseline["material_loss_rate"]*100:.2f}%')

    magnifier_value = derive_magnifier_value(crafter)
    print(f'\nMagnifier-derived augment value (at {MAGNIFIER_PCT*100:.0f}% of craft roll): {magnifier_value}')

    base_matloss_per_100 = baseline['material_loss_rate'] * 100
    print(f'\n--- Standard scenario (no progress cap) ---')
    print(f'{"Augment":<55} {"Value":>7} {"Mean":>9} {"Stdev":>8} {"p5":>6} {"D Mean %":>10} {"D Stdev %":>11} {"MatLoss/100":>12} {"D MatLoss/100":>15}')
    print('-' * 150)

    rows = []
    for aug in AUGMENTS:
        if aug.value_kind == 'flat_per_rarity_d100':
            for rarity, val in D100_BONUS_BY_RARITY.items():
                rows.append(_run_one(aug, baseline_inputs, baseline, val, label_suffix=f' [{rarity}]'))
        elif aug.value_kind == 'flat_per_rarity_decay':
            # reworkDecayReduce only matters in the chain sim — skip in standard scenario.
            continue
        else:
            val = aug.flat_value if (aug.value_kind == 'flat' and aug.flat_value > 0) else magnifier_value
            rows.append(_run_one(aug, baseline_inputs, baseline, val))

    rows.sort(key=lambda r: -r['delta_pct'])
    for row in rows:
        print(f'{row["label"]:<55} {row["value"]:>7} {row["mean"]:>9.1f} {row["stdev"]:>8.1f} {row["p5"]:>6} '
              f'{row["delta_pct"]:>+9.2f}% {row["delta_stdev_pct"]:>+10.2f}% '
              f'{row["matloss_per_100"]:>11.2f}  {row["delta_matloss_per_100"]:>+13.2f}')

    # ── Capped scenario: progress cap = baseline_mean * 1.1, makes maxProgressBoost meaningful.
    cap = round(baseline['mean'] * 1.1)
    print(f'\n--- Capped scenario (max_progress_cap = {cap}, ~110% of baseline mean) ---')
    capped_inputs = CraftInputs(crafter=crafter, max_progress_cap=cap)
    capped_baseline = avg_craft(capped_inputs)
    print(f'Capped baseline: mean={capped_baseline["mean"]:.1f}  stdev={capped_baseline["stdev"]:.1f}  p5={capped_baseline["p5"]}  max={capped_baseline["max"]}')
    print(f'(Without augment, {sum(1 for _ in range(2000) if simulate_craft(capped_inputs).progress >= cap)/2000*100:.1f}% of crafts hit the cap)')
    print(f'\n{"Augment":<55} {"Value":>7} {"Mean":>9} {"Stdev":>8} {"p5":>6} {"D Mean %":>10}')
    print('-' * 110)

    capped_rows = []
    for aug in AUGMENTS:
        if aug.value_kind == 'flat_per_rarity_d100':
            val = D100_BONUS_BY_RARITY['divine']
            label_suffix = ' [divine]'
        elif aug.value_kind == 'flat_per_rarity_decay':
            continue
        else:
            val = aug.flat_value if (aug.value_kind == 'flat' and aug.flat_value > 0) else magnifier_value
            label_suffix = ''
        aug_inputs = with_augment(capped_inputs, aug, val)
        aug_result = avg_craft(aug_inputs)
        delta_pct = (aug_result['mean'] - capped_baseline['mean']) / capped_baseline['mean'] * 100
        capped_rows.append({
            'label': aug.label + label_suffix,
            'value': val,
            'mean': aug_result['mean'],
            'stdev': aug_result['stdev'],
            'p5': aug_result['p5'],
            'delta_pct': delta_pct,
        })
    capped_rows.sort(key=lambda r: -r['delta_pct'])
    for row in capped_rows:
        print(f'{row["label"]:<55} {row["value"]:>7} {row["mean"]:>9.1f} {row["stdev"]:>8.1f} {row["p5"]:>6} {row["delta_pct"]:>+9.2f}%')

    # Rework chain scenario for reworkDecayReduce — per-grade.
    print(f'\nIterative rework scenario (5 iterations):')
    base_chain = avg_rework_chain(crafter, decay_reduction=0)
    print(f'  Baseline (no augment) - chain total: {base_chain:.1f}')
    print(f'  {"Grade":<10} {"Reduction":>10} {"Chain":>9} {"Delta":>10}')
    print(f'  {"-"*45}')
    for rarity, reduction in REWORK_DECAY_REDUCE_BY_RARITY.items():
        chain = avg_rework_chain(crafter, decay_reduction=reduction)
        delta_pct = (chain - base_chain) / base_chain * 100
        print(f'  {rarity:<10} {reduction:>10.2f} {chain:>9.1f} {delta_pct:>+9.2f}%')

    # ── Option A (revised): cap = "what the craft would output if crafter rolled d100=100" ─
    # cap = material × 0.5 + skill_roll × 0.5 + bonuses  (i.e., 100% d100 instead of actual roll)
    # Each rework adds round(crafterRoll / (reworkCount + 2)), capped at headroom.
    # Headroom is always skill_roll × 0.5 × (1 − d100_pct), independent of material strength.
    print(f'\nOption A (revised): crafts-to-max-out-item (cap = perfect-d100 craft outcome):')
    print(f'  {"Material":>10} {"Mean Cap":>10} {"Mean Crafts":>13} {"Median":>8} {"P90":>6} {"Avg Final %":>13}')
    print(f'  {"-"*70}')

    def simulate_to_max_v2(crafter, material_progress=500, max_attempts=50, divisor_offset=2):
        """Cap is set per-craft based on the initial skill_roll. Run reworks toward the cap.
        divisor for nth rework = (n - 1) + divisor_offset."""
        skill_roll = crafter.main_craft.roll()
        d100 = random.randint(1, 100)
        crafter_roll = round(skill_roll * d100 / 100)
        material_ctrb = round(material_progress * 0.5)
        crafter_ctrb = round(crafter_roll * 0.5)
        progress = material_ctrb + crafter_ctrb
        cap = round(material_progress * 0.5) + round(skill_roll * 1.0 * 0.5)
        crafts = 1

        if progress >= cap:
            return crafts, progress, cap

        for rework_count in range(max_attempts):
            divisor = rework_count + divisor_offset
            re_skill = crafter.main_craft.roll()
            re_d100 = random.randint(1, 100)
            re_crafter = round(re_skill * re_d100 / 100)
            headroom = cap - progress
            if headroom <= 0:
                break
            add = min(round(re_crafter / divisor), headroom)
            progress += add
            crafts += 1
            if progress >= cap:
                break
        return crafts, progress, cap

    print(f'  {"Offset":>8} {"Material":>10} {"Mean Crafts":>13} {"Median":>8} {"P90":>6}')
    print(f'  {"-"*55}')
    for offset in [3, 4, 5, 6]:
        for mat in [500]:  # one material strength to compare offsets cleanly
            results = [simulate_to_max_v2(crafter, material_progress=mat, divisor_offset=offset) for _ in range(2000)]
            crafts_list = [r[0] for r in results]
            crafts_sorted = sorted(crafts_list)
            median = crafts_sorted[len(crafts_sorted) // 2]
            p90 = crafts_sorted[int(len(crafts_sorted) * 0.9)]
            print(f'  {offset:>8} {mat:>10} {statistics.mean(crafts_list):>13.2f} {median:>8} {p90:>6}')

    # ── Option B unbounded saturation analysis ─────────────────────────────
    # New rework rules: crafter-only contribution (no material, no 50/50), divisor = reworkCount + 2.
    # Initial craft P0 = material × 0.5 + crafter × 0.5 + bonuses.
    # Each rework adds (crafter + bonuses) / divisor.
    # No cap = harmonic series, diverges slowly.
    print(f'\nOption B saturation analysis (no maxProgress cap, crafter-only reworks):')
    initial_inputs = CraftInputs(crafter=crafter)
    initial_p0 = avg_craft(initial_inputs, n=5000)['mean']
    print(f'  P0 (initial craft avg): {initial_p0:.1f}')

    # Simulate unbounded reworks. Each rework: contribution = crafterRoll only (no material, no halving).
    def simulate_rework_only(crafter, prior_count):
        skill_total = crafter.main_craft.roll()
        skill_roll = round(skill_total)
        d100 = random.randint(1, 100)
        d100_pct = d100 / 100
        crafter_roll = round(skill_roll * d100_pct)
        divisor = prior_count + 2
        return round(crafter_roll / divisor)

    print(f'  {"Reworks":>8} {"Total Prog":>11} {"% of P0":>9} {"Last Add":>9}')
    print(f'  {"-"*42}')
    breakpoints = [1, 3, 5, 10, 20, 50, 100, 500]
    n_runs = 2000
    for target_n in breakpoints:
        progs = []
        last_adds = []
        for _ in range(n_runs):
            prog = simulate_craft(initial_inputs).progress
            last = 0
            for i in range(target_n):
                add = simulate_rework_only(crafter, prior_count=i)
                prog += add
                if i == target_n - 1:
                    last = add
            progs.append(prog)
            last_adds.append(last)
        avg_total = statistics.mean(progs)
        avg_last = statistics.mean(last_adds)
        pct_of_p0 = (avg_total / initial_p0) * 100
        print(f'  {target_n:>8} {avg_total:>11.1f} {pct_of_p0:>8.0f}% {avg_last:>9.1f}')

def _run_one(aug, baseline_inputs, baseline, value, label_suffix=''):
    aug_inputs = with_augment(baseline_inputs, aug, value)
    aug_result = avg_craft(aug_inputs)
    return {
        'label': aug.label + label_suffix,
        'value': value,
        'mean': aug_result['mean'],
        'stdev': aug_result['stdev'],
        'p5': aug_result['p5'],
        'delta_pct': (aug_result['mean'] - baseline['mean']) / baseline['mean'] * 100 if baseline['mean'] > 0 else 0,
        'delta_stdev_pct': (aug_result['stdev'] - baseline['stdev']) / baseline['stdev'] * 100 if baseline['stdev'] > 0 else 0,
        'matloss_per_100': aug_result['material_loss_rate'] * 100,
        'delta_matloss_per_100': (aug_result['material_loss_rate'] - baseline['material_loss_rate']) * 100,
    }

if __name__ == '__main__':
    print(f'Augment Value Simulator -- {N_SIMS:,} sims per scenario')
    print(f'Magnifier conversion: {MAGNIFIER_PCT*100:.0f}% of craft roll -> augment value')
    print(f'd100Bonus uses flat-per-grade values (not magnifier).')
    print(f'Crit success multiplier: {CRIT_SUCCESS_MULTIPLIER}x progress when d100 >= threshold.')

    for crafter in [JOHN, WILLY]:
        run_sim_for_crafter(crafter)
