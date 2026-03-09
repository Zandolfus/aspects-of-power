"""
Tier utility functions for character progression system.
Pure utility functions that operate on game data without side effects.
"""
from typing import List, Optional, Dict, Tuple
from game_data import class_gains, profession_gains

def get_tier_for_level(level: int, tier_thresholds: List[int]) -> int:
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
    return list(class_gains.get(tier, {}).keys())

def get_available_professions_for_tier(tier: int) -> List[str]:
    return list(profession_gains.get(tier, {}).keys())

def get_class_gains(class_name: str, tier: int) -> Dict[str, int]:
    return class_gains.get(tier, {}).get(class_name.lower(), {})

def get_profession_gains(profession_name: str, tier: int) -> Dict[str, int]:
    return profession_gains.get(tier, {}).get(profession_name.lower(), {})
