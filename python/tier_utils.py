"""
Tier utility functions for character progression system.
Pure utility functions that operate on game data without side effects.
"""
from typing import List, Optional, Dict, Tuple
from game_data import class_gains, profession_gains

def get_tier_for_level(level: int, tier_thresholds: List[int]) -> int:
    """Get the tier number for a given level using character's thresholds"""
    if level < 1:
        return 0
    
    tier = 1
    for threshold in sorted(tier_thresholds):
        if level >= threshold:
            tier += 1
        else:
            break
    return tier

def get_available_classes_for_tier(tier: int) -> List[str]:
    """Get all available classes for a specific tier"""
    return list(class_gains.get(tier, {}).keys())

def get_available_professions_for_tier(tier: int) -> List[str]:
    """Get all available professions for a specific tier"""
    return list(profession_gains.get(tier, {}).keys())

def get_class_gains(class_name: str, tier: int) -> Dict[str, int]:
    """Get stat gains for a specific class and tier"""
    return class_gains.get(tier, {}).get(class_name.lower(), {})

def get_profession_gains(profession_name: str, tier: int) -> Dict[str, int]:
    """Get stat gains for a specific profession and tier"""
    return profession_gains.get(tier, {}).get(profession_name.lower(), {})

def get_tier_range(tier: int, tier_thresholds: List[int]) -> Tuple[int, int]:
    """Get the level range for a specific tier using character's thresholds"""
    sorted_thresholds = sorted(tier_thresholds)
    
    if tier == 1:
        return (1, sorted_thresholds[0] - 1 if sorted_thresholds else 999)
    elif tier - 2 < len(sorted_thresholds):
        start = sorted_thresholds[tier - 2]
        end = sorted_thresholds[tier - 1] - 1 if tier - 1 < len(sorted_thresholds) else 999
        return (start, end)
    else:
        # Beyond defined thresholds
        start = sorted_thresholds[-1] if sorted_thresholds else 1
        return (start, 999)

def get_next_tier_threshold(current_level: int, tier_thresholds: List[int]) -> Optional[int]:
    """Get the next tier threshold level, or None if no more tiers"""
    for threshold in sorted(tier_thresholds):
        if current_level < threshold:
            return threshold
    return None

def validate_class_tier_combination(class_name: str, tier: int) -> bool:
    """Check if a class exists in a specific tier"""
    return class_name.lower() in class_gains.get(tier, {})

def validate_profession_tier_combination(profession_name: str, tier: int) -> bool:
    """Check if a profession exists in a specific tier"""
    return profession_name.lower() in profession_gains.get(tier, {})

def get_max_available_tier_for_classes() -> int:
    """Get the highest tier number that has classes defined"""
    return max(class_gains.keys()) if class_gains else 1

def get_max_available_tier_for_professions() -> int:
    """Get the highest tier number that has professions defined"""
    return max(profession_gains.keys()) if profession_gains else 1

def get_all_available_tiers() -> List[int]:
    """Get all tiers that have either classes or professions defined"""
    class_tiers = set(class_gains.keys())
    profession_tiers = set(profession_gains.keys())
    return sorted(class_tiers.union(profession_tiers))

def validate_tier_thresholds(tier_thresholds: List[int]) -> bool:
    """Validate that tier thresholds are reasonable"""
    if not tier_thresholds:
        return True
    
    # Check that thresholds are positive and in ascending order
    sorted_thresholds = sorted(tier_thresholds)
    return (
        all(threshold > 0 for threshold in tier_thresholds) and
        tier_thresholds == sorted_thresholds and
        len(tier_thresholds) == len(set(tier_thresholds))  # No duplicates
    )

def suggest_tier_thresholds(max_level: int, num_tiers: int = 3) -> List[int]:
    """Suggest balanced tier thresholds for a given max level and number of tiers"""
    if num_tiers <= 1:
        return []
    
    # Distribute tiers somewhat evenly, but front-load the early tiers
    thresholds = []
    for i in range(1, num_tiers):
        # Use a slightly curved distribution - earlier tiers are smaller
        ratio = (i / num_tiers) ** 0.8
        threshold = int(max_level * ratio)
        threshold = max(threshold, i * 5)  # Minimum 5 levels per tier
        thresholds.append(threshold)
    
    return thresholds

def get_tier_summary(tier_thresholds: List[int]) -> Dict[int, Dict[str, any]]:
    """Get a summary of what each tier covers"""
    summary = {}
    max_tier = len(tier_thresholds) + 1
    
    for tier in range(1, max_tier + 1):
        level_range = get_tier_range(tier, tier_thresholds)
        summary[tier] = {
            "level_range": level_range,
            "available_classes": get_available_classes_for_tier(tier),
            "available_professions": get_available_professions_for_tier(tier),
            "level_span": level_range[1] - level_range[0] + 1 if level_range[1] != 999 else "unlimited"
        }
    
    return summary