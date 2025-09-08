from typing import Dict, List, Optional, Tuple, Any
import math
import random
import csv
import os
import json
import datetime
from dataclasses import dataclass
from game_data import races, DEFAULT_TIER_THRESHOLDS
from tier_utils import (
    get_tier_for_level, get_next_tier_threshold, get_tier_range,
    get_class_gains, get_profession_gains, 
    validate_class_tier_combination, validate_profession_tier_combination
)

# Constants
STATS = ["vitality", "endurance", "strength", "dexterity", "toughness", 
         "intelligence", "willpower", "wisdom", "perception"]
META_INFO = ["Class", "Class level", "Race", "Profession", "Profession level", "Character Type"]  # NEW: Added Character Type
DERIVED_META = ["Race level", "Race rank"]  # Meta attributes that are derived/calculated automatically
TIER_HISTORY_META = ["tier_threshold", "class_history", "profession_history"]  # Tier change tracking

# NEW: Character types
CHARACTER_TYPES = ["character", "familiar", "monster"]
RACE_LEVELING_TYPES = ["familiar", "monster"]  # Types that level through race instead of class/profession

# Configuration (could be moved to a JSON config file)
STAT_MODIFIER_FORMULA = {
    "base_value": 6000,
    "exp_factor": -0.001,
    "offset": 500,
    "adjustment": -2265
}

class StatSource:
    """Enum-like class to track where stat points came from"""
    BASE = "base"
    CLASS = "class" 
    PROFESSION = "profession"
    RACE = "race"
    ITEM = "item"
    BLESSING = "blessing"
    FREE_POINTS = "free_points"

class CharacterDataManager:
    """
    Central manager for character data with proper encapsulation and state management.
    Handles stats and meta information with appropriate validation and dependencies.
    UPDATED: Added support for character types and race-only leveling
    """
    def __init__(self, stats: Optional[Dict[str, int]] = None, 
                 meta: Optional[Dict[str, Any]] = None,
                 tier_thresholds: Optional[List[int]] = None,
                 class_history: Optional[List[Dict[str, Any]]] = None,
                 profession_history: Optional[List[Dict[str, Any]]] = None,
                 race_history: Optional[List[Dict[str, Any]]] = None):
        # Initialize stats
        self._base_stats = {stat: 5 for stat in STATS}
        if stats:
            for stat, value in stats.items():
                if stat in STATS:
                    self._base_stats[stat] = value
        
        # Keep track of where stats came from for proper recalculation
        self._stat_sources = {
            stat: {StatSource.BASE: self._base_stats[stat]} for stat in STATS
        }
        
        # Initialize meta data with defaults
        self._meta = {info: "" for info in META_INFO}
        if meta:
            for key, value in meta.items():
                if key in META_INFO:
                    self._meta[key] = value
        
        # NEW: Set default character type if not specified
        if not self._meta.get("Character Type"):
            self._meta["Character Type"] = "character"
        
        # Initialize tier change tracking with character-specific thresholds
        self.tier_thresholds = tier_thresholds or DEFAULT_TIER_THRESHOLDS.copy()
        self.class_history = class_history or []
        self.profession_history = profession_history or []
        self.race_history = race_history or []
        
        # Initialize class history if character has a class but no history
        if self._meta.get("Class") and not self.class_history:
            self.class_history = [{
                "class": self._meta["Class"],
                "from_level": 1,
                "to_level": None
            }]
        
        # Initialize profession history if character has a profession but no history
        if self._meta.get("Profession") and not self.profession_history:
            self.profession_history = [{
                "profession": self._meta["Profession"],
                "from_level": 1,
                "to_level": None
            }]
        
        # Initialize race history if character has a race but no history
        if self._meta.get("Race") and not self.race_history:
            self.race_history = [{
                "race": self._meta["Race"],
                "from_race_level": 1,
                "to_race_level": None
            }]
        
        # Ensure numeric meta values are stored as strings for consistency
        for key in ["Class level", "Profession level"]:
            if self._meta[key] == "":
                self._meta[key] = "0"
            elif isinstance(self._meta[key], int):
                self._meta[key] = str(self._meta[key])
                
        # Apply race level if character is a familiar or monster.
        if self.is_race_leveling_type():
            self._meta["Race level"] = meta.get("Race level", 0)
        
        # Initialize derived meta values (but don't calculate race levels here)
        if "Race level" not in self._meta:
            self._meta["Race level"] = "0"
        if "Race rank" not in self._meta:
            self._meta["Race rank"] = ""
        
        # Calculate current stats from all sources
        self._current_stats = self._calculate_current_stats()
        
        # Calculate modifiers
        self._modifiers = self._calculate_modifiers()
    
    def _calculate_current_stats(self) -> Dict[str, int]:
        """Calculate current stats from all sources"""
        current = {stat: 0 for stat in STATS}
        
        # Sum up contributions from all sources
        for stat in STATS:
            current[stat] = sum(self._stat_sources[stat].values())
        
        return current
    
    def _calculate_modifiers(self) -> Dict[str, float]:
        """Calculate and return modifiers for all stats"""
        return {stat: self._calculate_modifier(value) 
                for stat, value in self._current_stats.items()}
    
    @staticmethod
    def _calculate_modifier(attribute: int) -> float:
        """Calculate modifier using the game's formula"""
        config = STAT_MODIFIER_FORMULA
        return int(round(
            (config["base_value"] / 
             (1 + math.exp(config["exp_factor"] * (attribute - config["offset"])))) + 
            config["adjustment"], 0
        ))
    
    def get_stat(self, stat: str) -> int:
        """Get a stat value"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        return self._current_stats[stat]
    
    def get_stat_modifier(self, stat: str) -> float:
        """Get a stat modifier"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        return self._modifiers[stat]
    
    def set_base_stat(self, stat: str, value: int) -> None:
        """Set a base stat value"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        
        # Update base value
        self._base_stats[stat] = value
        self._stat_sources[stat][StatSource.BASE] = value
        
        # Recalculate current stats and modifiers
        self._current_stats = self._calculate_current_stats()
        self._modifiers = self._calculate_modifiers()
    
    def add_stat(self, stat: str, value: int, source: str) -> None:
        """Add to a stat from a specific source"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        
        if source not in self._stat_sources[stat]:
            self._stat_sources[stat][source] = 0
        
        self._stat_sources[stat][source] += value
        
        # Recalculate current stats and modifiers
        self._current_stats = self._calculate_current_stats()
        self._modifiers = self._calculate_modifiers()
    
    def get_meta(self, key: str, default: Any = "") -> Any:
        """Get a meta attribute"""
        return self._meta.get(key, default)
    
    def set_meta(self, key: str, value: Any, force: bool = False) -> bool:
        """
        Set a meta attribute with validation
        Returns True if value was changed
        """
        # Validate key
        if key not in META_INFO and key not in DERIVED_META:
            raise ValueError(f"Invalid meta attribute: {key}")
        
        # Prevent direct modification of derived attributes unless forced
        if key in DERIVED_META and not force:
            raise ValueError(f"Cannot directly set derived attribute: {key}")
        
        # NEW: Validate character type
        if key == "Character Type" and value not in CHARACTER_TYPES:
            raise ValueError(f"Invalid character type: {value}. Must be one of: {CHARACTER_TYPES}")
        
        # Store old value for comparison
        old_value = self._meta.get(key, "")
        
        # Set new value
        self._meta[key] = value
        
        # Handle cascading updates if value changed
        changed = old_value != value
        return changed
    
    def get_all_stats(self) -> Dict[str, int]:
        """Get all current stats"""
        return self._current_stats.copy()
    
    def get_all_modifiers(self) -> Dict[str, float]:
        """Get all stat modifiers"""
        return self._modifiers.copy()
    
    def get_all_meta(self) -> Dict[str, Any]:
        """Get all meta attributes"""
        return self._meta.copy()
    
    def get_stat_sources(self, stat: str) -> Dict[str, int]:
        """Get the breakdown of where a stat's points came from"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        return self._stat_sources[stat].copy()
    
    def reset_stat_source(self, stat: str, source: str) -> None:
        """Reset a specific stat source to 0"""
        if stat not in STATS:
            raise ValueError(f"Invalid stat: {stat}")
        
        if source in self._stat_sources[stat]:
            self._stat_sources[stat][source] = 0
            
            # Recalculate current stats and modifiers
            self._current_stats = self._calculate_current_stats()
            self._modifiers = self._calculate_modifiers()
    
    def apply_item_stats(self, item_stats: Dict[str, int]) -> None:
        """Apply item bonuses to stats"""
        for stat, value in item_stats.items():
            if stat in STATS:
                self.add_stat(stat, value, StatSource.ITEM)
    
    def remove_item_stats(self, item_stats: Dict[str, int]) -> None:
        """Remove item bonuses from stats"""
        for stat, value in item_stats.items():
            if stat in STATS:
                self.add_stat(stat, -value, StatSource.ITEM)
    
    def get_class_at_level(self, level: int) -> Optional[str]:
        """Get the class that was active at a specific level"""
        for entry in self.class_history:
            if entry["from_level"] <= level:
                if entry["to_level"] is None or level <= entry["to_level"]:
                    return entry["class"]
        return None
    
    def get_profession_at_level(self, level: int) -> Optional[str]:
        """Get the profession that was active at a specific level"""
        for entry in self.profession_history:
            if entry["from_level"] <= level:
                if entry["to_level"] is None or level <= entry["to_level"]:
                    return entry["profession"]
        return None
    
    def get_race_at_race_level(self, race_level: int) -> Optional[str]:
        """Get the race that was active at a specific race level"""
        for entry in self.race_history:
            if entry["from_race_level"] <= race_level:
                if entry["to_race_level"] is None or race_level <= entry["to_race_level"]:
                    return entry["race"]
        return None
    
    def add_class_change(self, new_class: str, at_level: int):
        """Record a class change at a specific level"""
        # Close the current class entry
        if self.class_history:
            current_entry = self.class_history[-1]
            if current_entry["to_level"] is None:
                current_entry["to_level"] = at_level - 1
        
        # Add new class entry
        self.class_history.append({
            "class": new_class,
            "from_level": at_level,
            "to_level": None
        })
        
        # Update current class in meta
        self._meta["Class"] = new_class
    
    def add_profession_change(self, new_profession: str, at_level: int):
        """Record a profession change at a specific level"""
        # Close the current profession entry
        if self.profession_history:
            current_entry = self.profession_history[-1]
            if current_entry["to_level"] is None:
                current_entry["to_level"] = at_level - 1
        
        # Add new profession entry
        self.profession_history.append({
            "profession": new_profession,
            "from_level": at_level,
            "to_level": None
        })
        
        # Update current profession in meta
        self._meta["Profession"] = new_profession
        
    def add_race_change(self, new_race: str, at_race_level: int):
        """Record a race change at a specific race level"""
        # Close the current race entry
        if self.race_history:
            current_entry = self.race_history[-1]
            if current_entry["to_race_level"] is None:
                current_entry["to_race_level"] = at_race_level - 1
        
        # Add new race entry
        self.race_history.append({
            "race": new_race,
            "from_race_level": at_race_level,
            "to_race_level": None
        })
        
        # Update current race in meta
        self._meta["Race"] = new_race
    
    # NEW: Character type helper methods
    def is_familiar(self) -> bool:
        """Check if this character is a familiar"""
        return self.get_meta("Character Type") == "familiar"
    
    def is_monster(self) -> bool:
        """Check if this character is a monster"""
        return self.get_meta("Character Type") == "monster"
    
    def is_race_leveling_type(self) -> bool:
        """Check if this character type levels through race instead of class/profession"""
        return self.get_meta("Character Type") in RACE_LEVELING_TYPES
    
    def get_tier_for_level(self, level: int) -> int:
        """Get the tier number for a given level using this character's thresholds"""
        return get_tier_for_level(level, self.tier_thresholds)
    
    def get_next_tier_threshold(self, current_level: int) -> Optional[int]:
        """Get the next tier threshold for this character, or None if no more tiers"""
        return get_next_tier_threshold(current_level, self.tier_thresholds)
    
    def get_tier_range(self, tier: int) -> Tuple[int, int]:
        """Get the level range for a specific tier using this character's thresholds"""
        return get_tier_range(tier, self.tier_thresholds)
    
    def set_tier_thresholds(self, thresholds: List[int]) -> Tuple[bool, str]:
        """
        Set custom tier thresholds, replacing existing ones.
        Returns (success, message) with validation results.
        """
        # Validate new thresholds
        if not thresholds:
            return False, "Threshold list cannot be empty"
        
        # Check for duplicates and ensure they're positive
        if len(thresholds) != len(set(thresholds)):
            return False, "Duplicate thresholds not allowed"
        
        if any(t <= 0 for t in thresholds):
            return False, "All thresholds must be positive"
        
        # Check if any new thresholds conflict with character's current progression
        class_level = int(self.get_meta("Class level", "0"))
        profession_level = int(self.get_meta("Profession level", "0"))
        max_level = max(class_level, profession_level)
        
        sorted_thresholds = sorted(thresholds)
        
        # Find which tier the character is currently in with old thresholds
        old_tier = get_tier_for_level(max_level, self.tier_thresholds)
        new_tier = get_tier_for_level(max_level, sorted_thresholds)
        
        warning = ""
        if old_tier != new_tier:
            warning = f"Warning: Character's current tier will change from {old_tier} to {new_tier}"
        
        # Update thresholds
        old_thresholds = self.tier_thresholds.copy()
        self.tier_thresholds = sorted_thresholds
        
        success_msg = f"Thresholds updated from {old_thresholds} to {sorted_thresholds}"
        if warning:
            success_msg += f". {warning}"
        
        return True, success_msg
    
    def add_tier_threshold(self, threshold: int) -> bool:
        """
        Add a new tier threshold.
        Returns True if threshold was added, False if it already exists.
        """
        if threshold in self.tier_thresholds:
            return False
        
        self.tier_thresholds.append(threshold)
        self.tier_thresholds.sort()
        return True
    
    def remove_tier_threshold(self, threshold: int) -> Tuple[bool, str]:
        """
        Remove a tier threshold.
        Returns (success, message) indicating if removal was successful and why.
        """
        if threshold not in self.tier_thresholds:
            return False, f"Threshold {threshold} not found"
        
        # Check if character has already passed this threshold
        class_level = int(self.get_meta("Class level", "0"))
        profession_level = int(self.get_meta("Profession level", "0"))
        max_level = max(class_level, profession_level)
        
        if max_level >= threshold:
            return False, f"Cannot remove threshold {threshold}: character has already reached level {max_level}"
        
        self.tier_thresholds.remove(threshold)
        return True, f"Threshold {threshold} removed successfully"
    
    def validate_tier_thresholds_with_character(self) -> Dict[str, Any]:
        """
        Validate tier thresholds against character's current progression.
        Returns detailed analysis of potential issues.
        """
        class_level = int(self.get_meta("Class level", "0"))
        profession_level = int(self.get_meta("Profession level", "0"))
        
        result = {
            "valid": True,
            "warnings": [],
            "errors": [],
            "current_tiers": {
                "class": get_tier_for_level(class_level, self.tier_thresholds) if class_level > 0 else 0,
                "profession": get_tier_for_level(profession_level, self.tier_thresholds) if profession_level > 0 else 0
            },
            "progression_analysis": {}
        }
        
        # Check if current class/profession exist in their current tiers
        if class_level > 0:
            current_class = self.get_meta("Class", "")
            class_tier = result["current_tiers"]["class"]
            if not validate_class_tier_combination(current_class, class_tier):
                result["valid"] = False
                result["errors"].append(f"Current class '{current_class}' is not valid for tier {class_tier}")
        
        if profession_level > 0:
            current_profession = self.get_meta("Profession", "")
            profession_tier = result["current_tiers"]["profession"]
            if not validate_profession_tier_combination(current_profession, profession_tier):
                result["valid"] = False
                result["errors"].append(f"Current profession '{current_profession}' is not valid for tier {profession_tier}")
        
        # Analyze upcoming tier changes
        for level_type, current_level in [("Class", class_level), ("Profession", profession_level)]:
            if current_level > 0:
                next_threshold = get_next_tier_threshold(current_level, self.tier_thresholds)
                if next_threshold:
                    current_tier = get_tier_for_level(current_level, self.tier_thresholds)
                    next_tier = current_tier + 1
                    
                    result["progression_analysis"][level_type.lower()] = {
                        "current_level": current_level,
                        "current_tier": current_tier,
                        "next_threshold": next_threshold,
                        "next_tier": next_tier,
                        "levels_to_next_tier": next_threshold - current_level
                    }
        
        return result
    
    def apply_blessing(self, blessing_stats: Dict[str, int]) -> None:
        """Apply blessing bonuses to stats"""
        for stat, value in blessing_stats.items():
            if stat in STATS:
                self.add_stat(stat, value, StatSource.BLESSING)
    
    def remove_blessing(self, blessing_stats: Dict[str, int]) -> None:
        """Remove blessing bonuses from stats"""
        for stat, value in blessing_stats.items():
            if stat in STATS:
                self.add_stat(stat, -value, StatSource.BLESSING)

class HealthManager:
    """Manages character health based on vitality stat"""
    
    def __init__(self, data_manager: CharacterDataManager):
        self.data_manager = data_manager
        self.max_health = self._calculate_max_health()
        self.current_health = self.max_health
    
    def _calculate_max_health(self) -> int:
        """Calculate max health based on vitality modifier"""
        return int(self.data_manager.get_stat_modifier("vitality"))
    
    def update_max_health(self) -> None:
        """Update max health based on current vitality modifier"""
        old_max = self.max_health
        self.max_health = self._calculate_max_health()
        
        # If max health increased, also increase current health by the same amount
        if self.max_health > old_max:
            self.current_health += (self.max_health - old_max)
        else:
            # Ensure current health doesn't exceed max
            self.current_health = min(self.current_health, self.max_health)
    
    def take_damage(self, damage: int) -> None:
        """Reduce character health by damage amount"""
        self.current_health = max(0, self.current_health - damage)
    
    def heal(self, amount: int) -> None:
        """Heal character by amount, not exceeding max health"""
        self.current_health = min(self.max_health, self.current_health + amount)
    
    def reset_health(self) -> None:
        """Reset current health to max health"""
        self.current_health = self.max_health
    
    def is_alive(self) -> bool:
        """Check if character is alive"""
        return self.current_health > 0

@dataclass
class Item:
    """Represents an equippable item"""
    name: str
    description: str
    stats: Dict[str, int]
    equipped: bool = False
    
    @property
    def equippable(self) -> bool:
        """Check if item can be equipped"""
        return bool(self.stats)
    
    def __str__(self) -> str:
        equipped_str = " [Equipped]" if self.equipped else ""
        return f"{self.name.title()}{equipped_str}: {self.description}"

class Inventory:
    """Manages character inventory and equipment"""
    
    def __init__(self, item_repository):
        self.items: List[Item] = []
        self.item_repository = item_repository
    
    def add_item(self, item_name: str) -> bool:
        """Add an item to inventory"""
        try:
            item_data = self.item_repository.get_item(item_name)
            if not item_data:
                return False
            
            item = Item(
                name=item_name,
                description=item_data["description"],
                stats=item_data["stats"].copy()
            )
            self.items.append(item)
            return True
        except Exception as e:
            print(f"Error adding item: {e}")
            return False
    
    def remove_item(self, item_name: str) -> bool:
        """Remove an item from inventory"""
        item = self.get_item(item_name)
        if item:
            if item.equipped:
                return False  # Can't remove equipped items
            self.items.remove(item)
            return True
        return False
    
    def get_item(self, name: str) -> Optional[Item]:
        """Get an item by name"""
        for item in self.items:
            if item.name.lower() == name.lower():
                return item
        return None
    
    def equip_item(self, item_name: str) -> Tuple[bool, Optional[Item]]:
        """Equip an item"""
        item = self.get_item(item_name)
        if item and item.equippable and not item.equipped:
            item.equipped = True
            return True, item
        return False, None
    
    def unequip_item(self, item_name: str) -> Tuple[bool, Optional[Item]]:
        """Unequip an item"""
        item = self.get_item(item_name)
        if item and item.equipped:
            item.equipped = False
            return True, item
        return False, None
    
    def get_equipped_items(self) -> List[Item]:
        """Get all equipped items"""
        return [item for item in self.items if item.equipped]
    
    def __str__(self) -> str:
        if not self.items:
            return "Empty"
        return "\n".join(str(item) for item in self.items)

class CombatSystem:
    """Handles combat mechanics"""
    
    def __init__(self, data_manager: CharacterDataManager, health_manager: HealthManager):
        self.data_manager = data_manager
        self.health_manager = health_manager
        self.finesse = False  # Set based on character class
    
    def set_finesse(self, value: bool) -> None:
        """Set whether character uses finesse in combat"""
        self.finesse = value
    
    @staticmethod
    def roll(dice: str) -> int:
        """Simulate dice roll (e.g., "2d6")"""
        num_dice, sides = map(int, dice.split("d"))
        return sum(random.randint(1, sides) for _ in range(num_dice))
    
    def calculate_hit_chance(self, target_data_manager: CharacterDataManager) -> Tuple[float, bool, int, float]:
        """Calculate chance to hit target"""
        roll = self.roll("1d20")
        
        # Calculate target's defense
        defense = int(round(
            target_data_manager.get_stat_modifier("dexterity") + 
            target_data_manager.get_stat_modifier("strength") * 0.3, 0
        ))
        
        # Calculate to-hit score
        to_hit = round(
            ((roll / 100) * 
             (self.data_manager.get_stat_modifier("dexterity") + 
              self.data_manager.get_stat_modifier("strength") * 0.6) + 
             self.data_manager.get_stat_modifier("dexterity") + 
             self.data_manager.get_stat_modifier("strength") * 0.6) * 0.911, 0
        )
        
        hit = to_hit >= defense
        return to_hit, hit, roll, defense
    
    def calculate_damage(self) -> Tuple[int, int]:
        """Calculate damage for an attack"""
        roll = self.roll("2d6")
        
        if not self.finesse:
            # Strength-based damage
            dmg = int(round(
                ((roll / 50) * self.data_manager.get_stat_modifier("strength") + 
                 self.data_manager.get_stat_modifier("strength")) * 0.5, 0
            ))
        else:
            # Finesse-based damage (strength + some dexterity)
            dmg = int(round(
                ((roll / 50) * 
                 (self.data_manager.get_stat_modifier("strength") + 
                  self.data_manager.get_stat_modifier("dexterity") * 0.25) + 
                 self.data_manager.get_stat_modifier("strength") + 
                 self.data_manager.get_stat_modifier("dexterity") * 0.25) * 0.6, 0
            ))
        
        return dmg, roll
    
    def attack(self, target) -> Tuple[bool, int, int]:
        """Perform attack against target"""
        # Calculate hit chance
        attack_score, hit, attack_roll, defense = self.calculate_hit_chance(target.data_manager)
        
        toughness = target.data_manager.get_stat_modifier("toughness")
        damage = 0
        net_damage = 0
        
        if hit:
            damage, dmg_roll = self.calculate_damage()
            net_damage = max(0, damage - toughness)
            
            if net_damage > 0:
                target.health_manager.take_damage(net_damage)
        
        return hit, damage, net_damage

class LevelSystem:
    """
    Manages character leveling and progression
    UPDATED: Added support for race-only leveling for familiars and monsters
    """
    
    def __init__(self, data_manager: CharacterDataManager):
        self.data_manager = data_manager
        self.free_points = 0
    
    def level_up(self, level_type: str, target_level: int) -> bool:
        """Level up character in specified category"""
        # NEW: Handle race level up for familiars/monsters
        if level_type.lower() == "race":
            return self.race_level_up(target_level)
        
        if level_type.lower() not in ["class", "profession"]:
            raise ValueError("Invalid level type. Must be 'Class', 'Profession', or 'Race'.")
            
        # NEW: Prevent class/profession leveling for familiars and monsters
        if self.data_manager.is_race_leveling_type():
            print(f"Error: {self.data_manager.get_meta('Character Type').capitalize()}s cannot level up in {level_type}.")
            print("Use race level up instead.")
            return False
            
        try:
            current_level = int(self.data_manager.get_meta(f"{level_type} level", "0"))
        except ValueError:
            print(f"Warning: Invalid {level_type} level value.")
            return False
            
        if target_level <= current_level:
            print(f"{level_type} is already at or above level {target_level}.")
            return False
            
        print(f"Leveling up {level_type} from {current_level} to {target_level}")
        
        # Apply level-up effects for each level gained
        for level in range(current_level + 1, target_level + 1):
            # Update the level
            self.data_manager.set_meta(f"{level_type} level", str(level))
            
            # Apply appropriate stat changes
            if level_type.lower() == "class":
                self._apply_class_level_up(level)
            elif level_type.lower() == "profession":
                self._apply_profession_level_up(level)
        
        # Update race level after class/profession level changes (only for regular characters)
        if not self.data_manager.is_race_leveling_type():
            self._update_race_level()
        
        return True
    
    def race_level_up(self, target_level: int) -> bool:
        """
        NEW: Level up race level directly for familiars and monsters
        """
        try:
            current_race_level = int(self.data_manager.get_meta("Race level", "0"))
        except ValueError:
            print("Warning: Invalid race level value.")
            return False
            
        if target_level <= current_race_level:
            print(f"Race is already at or above level {target_level}.")
            return False
            
        print(f"Leveling up race from {current_race_level} to {target_level}")
        
        # Update race level
        self.data_manager.set_meta("Race level", str(target_level), force=True)
        
        # Apply race level-up effects for each level gained
        self._apply_race_level_up(current_race_level, target_level)
        
        # Update race rank
        self._update_race_rank(target_level)
        
        return True
    
    def _apply_class_level_up(self, level: int) -> None:
        """Apply stat increases for class level-up using character's tier system"""
        # Get the class that was active at this level
        class_name = self.data_manager.get_class_at_level(level)
        if not class_name:
            print(f"Warning: No class found for level {level}.")
            return
        
        class_name = class_name.lower()
        
        # Get the tier for this level using character's thresholds
        tier = self.data_manager.get_tier_for_level(level)
        
        # Get gains from the appropriate tier
        gains = get_class_gains(class_name, tier)
        if not gains:
            print(f"Warning: No gains found for class '{class_name}' in tier {tier}.")
            return
        
        # Apply the stat gains
        for stat, gain in gains.items():
            if stat == "free_points":
                self.free_points += gain
            elif stat in STATS:
                self.data_manager.add_stat(stat, gain, StatSource.CLASS)
    
    def _apply_profession_level_up(self, level: int) -> None:
        """Apply stat increases for profession level-up using character's tier system"""
        # Get the profession that was active at this level
        profession = self.data_manager.get_profession_at_level(level)
        if not profession:
            print(f"Warning: No profession found for level {level}.")
            return
        
        profession = profession.lower()
        
        # Get the tier for this level using character's thresholds
        tier = self.data_manager.get_tier_for_level(level)
        
        # Get gains from the appropriate tier
        gains = get_profession_gains(profession, tier)
        if not gains:
            print(f"Warning: No gains found for profession '{profession}' in tier {tier}.")
            return
        
        # Apply the stat gains
        for stat, gain in gains.items():
            if stat == "free_points":
                self.free_points += gain
            elif stat in STATS:
                self.data_manager.add_stat(stat, gain, StatSource.PROFESSION)
    
    def _update_race_level(self, skip_free_points: bool = False, apply_bonuses: bool = True) -> None:
        """
        Update race level based on class and profession level
        UPDATED: Only for regular characters, not familiars/monsters
        """
        # NEW: Skip auto-calculation for race-leveling types (familiars/monsters)
        if self.data_manager.is_race_leveling_type():
            return
        
        try:
            class_level = int(self.data_manager.get_meta("Class level", "0"))
            profession_level = int(self.data_manager.get_meta("Profession level", "0"))
            total_level = class_level + profession_level
            new_race_level = total_level // 2
            
            # Get current race level for comparison
            current_race_level = int(self.data_manager.get_meta("Race level", "0"))
            
            # Update race level
            self.data_manager.set_meta("Race level", str(new_race_level), force=True)
            self._update_race_rank(new_race_level)
            
            # Apply race level-up effects if level increased
            if apply_bonuses and new_race_level > current_race_level:
                self._apply_race_level_up(current_race_level, new_race_level, skip_free_points)
        except ValueError:
            print("Warning: Invalid level values detected.")
    
    def _apply_race_level_up(self, from_level: int, to_level: int, skip_free_points: bool = False) -> None:
        """Apply stat changes for race level-up using race history"""
        if not self.data_manager.race_history:
            # No race history, use current race for all levels
            current_race = self.data_manager.get_meta("Race", "").lower()
            if current_race:
                self._apply_race_bonuses_for_range(current_race, from_level, to_level, skip_free_points)
            return
        
        # Apply bonuses based on race history
        for level in range(from_level + 1, to_level + 1):
            race_at_level = self.data_manager.get_race_at_race_level(level)
            if race_at_level:
                self._apply_race_bonuses_for_level(race_at_level.lower(), level, skip_free_points)
    
    def _apply_race_bonuses_for_level(self, race_name: str, race_level: int, skip_free_points: bool = False) -> None:
        """Apply race bonuses for a specific level and race"""
        if race_name not in races:
            print(f"Warning: Race '{race_name}' not found in race data.")
            return
        
        race_data = races.get(race_name, {})
        rank_ranges = race_data.get("rank_ranges", [])
        
        if not rank_ranges:
            print(f"Warning: No rank ranges defined for race '{race_name}'.")
            return
        
        # Find applicable range for this level
        applicable_range = None
        for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
            if range_data["min_level"] <= race_level <= range_data["max_level"]:
                applicable_range = range_data
                break
        
        if not applicable_range:
            return
        
        # Update race rank if provided (use the most recent rank)
        if "rank" in applicable_range:
            self.data_manager.set_meta("Race rank", applicable_range["rank"], force=True)
        
        # Apply stat gains
        for stat, gain in applicable_range["stats"].items():
            if stat == "free_points":
                if not skip_free_points:
                    self.free_points += gain
            elif stat in STATS:
                self.data_manager.add_stat(stat, gain, StatSource.RACE)
                
    def _apply_race_bonuses_for_range(self, race_name: str, from_level: int, to_level: int, skip_free_points: bool = False) -> None:
        """Apply race bonuses for a range of levels (fallback for no history)"""
        for level in range(from_level + 1, to_level + 1):
            self._apply_race_bonuses_for_level(race_name, level, skip_free_points)
    
    def _update_race_rank(self, race_level: int) -> None:
        """Update race rank label based on race level (NO stat bonuses applied)."""
        race = self.data_manager.get_meta("Race", "").lower()
        if not race or race_level < 0:
            self.data_manager.set_meta("Race rank", "", force=True)
            return
        
        if race not in races:
            print(f"Warning: Race '{race}' not found in race data.")
            return
        
        race_data = races.get(race, {})
        rank_ranges = race_data.get("rank_ranges", [])
        
        if not rank_ranges:
            print(f"Warning: No rank ranges defined for race '{race}'.")
            return
        
        # Find the appropriate rank for this level
        for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
            if range_data["min_level"] <= race_level <= range_data["max_level"]:
                if "rank" in range_data:
                    self.data_manager.set_meta("Race rank", range_data["rank"], force=True)
                    print(f"Race rank updated to: {range_data['rank']}")
                    return
        
        # If no matching range found, clear the rank
        self.data_manager.set_meta("Race rank", "", force=True)
        print(f"No matching rank range found for race level {race_level}")
    
    def change_class(self, new_class: str, at_level: int) -> bool:
        """
        Change character's class name and record the change in history.
        Validates against available tiers dynamically.
        Returns True if successful, False otherwise.
        """
        # NEW: Prevent class changes for familiars and monsters
        if self.data_manager.is_race_leveling_type():
            print(f"Error: {self.data_manager.get_meta('Character Type').capitalize()}s cannot have classes.")
            return False
        
        # Determine what tier this level corresponds to
        tier = self.data_manager.get_tier_for_level(at_level)
        
        # Validate that new_class exists in the appropriate tier
        if not validate_class_tier_combination(new_class, tier):
            print(f"Invalid class '{new_class}' for tier {tier} at level {at_level}")
            return False
            
        # Record the class change in history
        old_class = self.data_manager.get_meta("Class", "")
        self.data_manager.add_class_change(new_class, at_level)
        
        if old_class != new_class:
            print(f"Class changed from {old_class} to {new_class} at level {at_level}")
                
        return True
    
    def change_profession(self, new_profession: str, at_level: int) -> bool:
        """
        Change character's profession name and record the change in history.
        Validates against available tiers dynamically.
        Returns True if successful, False otherwise.
        """
        # NEW: Prevent profession changes for familiars and monsters
        if self.data_manager.is_race_leveling_type():
            print(f"Error: {self.data_manager.get_meta('Character Type').capitalize()}s cannot have professions.")
            return False
        
        # Determine what tier this level corresponds to
        tier = self.data_manager.get_tier_for_level(at_level)
        
        # Validate that new_profession exists in the appropriate tier
        if not validate_profession_tier_combination(new_profession, tier):
            print(f"Invalid profession '{new_profession}' for tier {tier} at level {at_level}")
            return False
            
        # Record the profession change in history
        old_profession = self.data_manager.get_meta("Profession", "")
        self.data_manager.add_profession_change(new_profession, at_level)
        
        if old_profession != new_profession:
            print(f"Profession changed from {old_profession} to {new_profession} at level {at_level}")
                
        return True
    
    def change_race(self, new_race: str, at_race_level: int = None) -> bool:
        """
        Change character's race and recalculate race bonuses.
        
        Args:
            new_race: The new race name
            at_race_level: The race level at which the change occurs (defaults to current + 1)
        
        Returns:
            True if successful, False otherwise.
        """
        old_race = self.data_manager.get_meta("Race", "")
        
        if old_race == new_race:
            return False
        
        # Determine the race level for the change
        if at_race_level is None:
            current_race_level = int(self.data_manager.get_meta("Race level", "0"))
            at_race_level = current_race_level + 1
        
        # Validate that the new race exists
        if new_race.lower() not in races:
            print(f"Error: Race '{new_race}' not found in race data.")
            return False
        
        # Reset all race stat bonuses
        for stat in STATS:
            self.data_manager.reset_stat_source(stat, StatSource.RACE)
        
        # Record the race change in history
        self.data_manager.add_race_change(new_race, at_race_level)
        
        # Recalculate and apply race bonuses using the new history
        current_race_level = int(self.data_manager.get_meta("Race level", "0"))
        if current_race_level > 0:
            self._apply_race_level_up(0, current_race_level)
        
        print(f"Race changed from {old_race} to {new_race} at race level {at_race_level}")
        return True
    
    def recalculate_race_levels(self, skip_free_points: bool = False) -> None:
        """
        Recalculate race levels from scratch.
        
        Args:
            skip_free_points: If True, don't modify free points (used when loading characters)
        
        This method:
        1. Resets all race stat bonuses to zero
        2. Resets race level and rank  
        3. Recalculates race level based on current class/profession levels (or keeps manual for familiars/monsters)
        4. Reapplies appropriate race stat bonuses
        5. Optionally adds race free points (skipped when loading)
        """
        # Reset all race bonuses
        for stat in STATS:
            self.data_manager.reset_stat_source(stat, StatSource.RACE)
        
        # For regular characters, reset and recalculate race level
        if not self.data_manager.is_race_leveling_type():
            self.data_manager.set_meta("Race level", "0", force=True)
            self.data_manager.set_meta("Race rank", "", force=True)
            # Recalculate race level (pass skip_free_points flag)
            self._update_race_level(skip_free_points=skip_free_points)
        else:
            # For familiars/monsters, keep current race level but reapply bonuses
            current_race_level = int(self.data_manager.get_meta("Race level", "0"))
            if current_race_level > 0:
                self._apply_race_level_up(0, current_race_level, skip_free_points)
                self._update_race_rank(current_race_level)
    
    def allocate_free_points(self, stat: str, amount: int) -> bool:
        """Allocate free points to a specific stat"""
        if stat not in STATS:
            print(f"Invalid stat: {stat}")
            return False
            
        if amount <= 0:
            print(f"Amount must be positive. Got: {amount}")
            return False
            
        if amount > self.free_points:
            print(f"Not enough free points. Have: {self.free_points}, Need: {amount}")
            return False
        
        # Apply the points
        self.data_manager.add_stat(stat, amount, StatSource.FREE_POINTS)
        self.free_points -= amount
        return True
    
    def allocate_free_points_with_debt(self, stat: str, amount: int, allow_debt: bool = False) -> bool:
        """
        Allocate free points to a specific stat with optional debt allowance.
        
        Args:
            stat: The stat to increase
            amount: Number of points to allocate  
            allow_debt: If True, allows going into negative free points
            
        Returns:
            True if successful, False otherwise
        """
        if stat not in STATS:
            print(f"Invalid stat: {stat}")
            return False
            
        if amount <= 0:
            print(f"Amount must be positive. Got: {amount}")
            return False
        
        if not allow_debt and amount > self.free_points:
            print(f"Not enough free points. Have: {self.free_points}, Need: {amount}")
            print("Use allow_debt=True to allocate into negative balance")
            return False
        
        # Apply the points
        self.data_manager.add_stat(stat, amount, StatSource.FREE_POINTS)
        self.free_points -= amount
    
        if self.free_points < 0:
            print(f"Warning: Free point balance is now negative: {self.free_points}")
        
        return True
    
    def allocate_random(self) -> None:
        """Randomly allocate all free points"""
        while self.free_points > 0:
            stat = random.choice(STATS)
            self.allocate_free_points(stat, 1)

class CharacterSerializer:
    """Handles saving and loading characters with factory method support."""
    
    @staticmethod
    def save_to_csv(character, filename: str, mode: str = "a") -> bool:
        """Save character with validation status and creation history."""
        try:
            # Define fields for the CSV
            fieldnames = ["Name"]
            
            # Add meta fields
            fieldnames += META_INFO + DERIVED_META
            
            # Add tier history fields
            fieldnames += ["tier_thresholds", "class_history", "profession_history", "race_history"]
            
            # Add manual character tracking
            fieldnames += ["is_manual_character", "manual_base_stats", "manual_current_stats"]
            
            # Add validation and conversion tracking
            fieldnames += ["validation_status", "creation_history"]
            
            # Add stat fields
            fieldnames += STATS
            
            # Add modifier fields
            fieldnames += [f"{stat}_modifier" for stat in STATS]
            
            # Add stat source fields
            for source in [StatSource.BASE, StatSource.CLASS, StatSource.PROFESSION, 
                           StatSource.RACE, StatSource.ITEM, StatSource.BLESSING, 
                           StatSource.FREE_POINTS]:
                fieldnames += [f"{stat}_{source}" for stat in STATS]
            
            # Add free points
            fieldnames += ["free_points"]
            
            # Check if file exists and handle existing data
            existing_data = []
            character_exists = False
            file_exists = os.path.exists(filename)
            
            if file_exists:
                with open(filename, "r", newline="") as file:
                    reader = csv.DictReader(file)
                    for row in reader:
                        if "Name" in row and row["Name"] == character.name:
                            character_exists = True
                        else:
                            existing_data.append(row)
            
            write_mode = "w" if character_exists or not file_exists or mode == "w" else "a"
            
            with open(filename, write_mode, newline="") as file:
                writer = csv.DictWriter(file, fieldnames=fieldnames)
                if write_mode == "w":
                    writer.writeheader()
                    for row in existing_data:
                        writer.writerow(row)
                
                # Get data for current character
                stats = character.data_manager.get_all_stats()
                meta = character.data_manager.get_all_meta()
                modifiers = character.data_manager.get_all_modifiers()
                
                # Create row dictionary
                row = {"Name": character.name}
                
                # Add meta data
                for key, value in meta.items():
                    row[key] = value
                
                # Add tier history data
                row["tier_thresholds"] = json.dumps(character.data_manager.tier_thresholds)
                row["class_history"] = json.dumps(character.data_manager.class_history)
                row["profession_history"] = json.dumps(character.data_manager.profession_history)
                row["race_history"] = json.dumps(character.data_manager.race_history)
                
                # Add manual character data
                row["is_manual_character"] = character.is_manual_character
                row["manual_base_stats"] = json.dumps(character.manual_base_stats or {})
                row["manual_current_stats"] = json.dumps(character.manual_current_stats or {})
                
                # Add validation and creation data
                row["validation_status"] = character.validation_status
                row["creation_history"] = json.dumps(character.creation_history or {})
                
                # Add current stats
                for stat, value in stats.items():
                    row[stat] = value
                
                # Add modifiers
                for stat, value in modifiers.items():
                    row[f"{stat}_modifier"] = value
                
                # Add stat sources
                for stat in STATS:
                    sources = character.data_manager.get_stat_sources(stat)
                    for source in [StatSource.BASE, StatSource.CLASS, StatSource.PROFESSION, 
                                    StatSource.RACE, StatSource.ITEM, StatSource.BLESSING, 
                                    StatSource.FREE_POINTS]:
                        row[f"{stat}_{source}"] = sources.get(source, 0)
                
                # Add free points
                row["free_points"] = character.level_system.free_points
                
                writer.writerow(row)
            
            print(f"Character '{character.name}' {'updated' if character_exists else 'saved'} to {filename}")
            return True
        except Exception as e:
            print(f"Error saving character: {e}")
            return False
    
    @staticmethod
    def load_from_csv(filename: str, character_name: str, item_repository=None):
        """Load character from CSV file using appropriate factory method."""
        try:
            if not os.path.exists(filename):
                print(f"File not found: {filename}")
                return None
                
            with open(filename, "r", newline="") as file:
                reader = csv.DictReader(file)
                
                for row in reader:
                    if "Name" in row and row["Name"].lower() == character_name.lower():
                        # Found the character
                        
                        # Extract meta info (including derived meta)
                        meta = {}
                        for key in META_INFO + DERIVED_META:
                            if key in row:
                                meta[key] = row[key]
                        
                        # Ensure Character Type is set
                        if "Character Type" not in meta or not meta["Character Type"]:
                            meta["Character Type"] = "character"  # Default for legacy characters
                        
                        # Extract tier history
                        tier_thresholds = [25]  # Default
                        if "tier_thresholds" in row and row["tier_thresholds"]:
                            try:
                                tier_thresholds = json.loads(row["tier_thresholds"])
                            except json.JSONDecodeError:
                                print("Warning: Invalid tier thresholds data, using default ([25]).")
                        
                        class_history = []
                        if "class_history" in row and row["class_history"]:
                            try:
                                class_history = json.loads(row["class_history"])
                            except json.JSONDecodeError:
                                print("Warning: Invalid class history data.")
                        
                        profession_history = []
                        if "profession_history" in row and row["profession_history"]:
                            try:
                                profession_history = json.loads(row["profession_history"])
                            except json.JSONDecodeError:
                                print("Warning: Invalid profession history data.")
                                
                        race_history = []
                        if "race_history" in row and row["race_history"]:
                            try:
                                race_history = json.loads(row["race_history"])
                            except json.JSONDecodeError:
                                print("Warning: Invalid race history data.")
                                
                        creation_history = None
                        if "creation_history" in row and row["creation_history"]:
                            try:
                                creation_history = json.loads(row["creation_history"])
                            except json.JSONDecodeError:
                                print("Warning: Invalid creation history data.")
                                
                        validation_status = row.get("validation_status", "unvalidated")
                        
                        # Check if this is a manual character
                        is_manual = False
                        manual_base_stats = None
                        manual_current_stats = None
                        
                        if "is_manual_character" in row:
                            is_manual = row["is_manual_character"].lower() in ["true", "1", "yes"]
                        
                        if is_manual:
                            # Load manual character data
                            if "manual_base_stats" in row and row["manual_base_stats"]:
                                try:
                                    manual_base_stats = json.loads(row["manual_base_stats"])
                                except json.JSONDecodeError:
                                    print("Warning: Invalid manual base stats data.")
                            
                            if "manual_current_stats" in row and row["manual_current_stats"]:
                                try:
                                    manual_current_stats = json.loads(row["manual_current_stats"])
                                except json.JSONDecodeError:
                                    print("Warning: Invalid manual current stats data.")
                        
                        # Extract free points
                        free_points = 0
                        if "free_points" in row:
                            try:
                                free_points = int(row["free_points"])
                            except ValueError:
                                print("Warning: Invalid free points value.")
                        
                        # Extract stat sources
                        stat_sources = {}
                        for stat in STATS:
                            stat_sources[stat] = {}
                            for source in [StatSource.BASE, StatSource.CLASS, StatSource.PROFESSION, 
                                           StatSource.RACE, StatSource.ITEM, StatSource.BLESSING, 
                                           StatSource.FREE_POINTS]:
                                source_key = f"{stat}_{source}"
                                if source_key in row:
                                    try:
                                        stat_sources[stat][source] = int(row[source_key])
                                    except ValueError:
                                        print(f"Warning: Invalid source value for {source_key}: {row[source_key]}")
                                        stat_sources[stat][source] = 0
                        
                        # Extract base stats from stat_sources
                        base_stats = {}
                        for stat in STATS:
                            if stat in stat_sources and StatSource.BASE in stat_sources[stat]:
                                base_stats[stat] = stat_sources[stat][StatSource.BASE]
                            else:
                                base_stats[stat] = 5  # Default base value
                        
                        # Create character using appropriate factory method
                        if is_manual and manual_base_stats and manual_current_stats:
                            # Reverse-engineered manual character
                            character = Character.create_reverse_engineered(
                                name=row["Name"],
                                base_stats=manual_base_stats,
                                current_stats=manual_current_stats,
                                meta=meta,
                                free_points=free_points,
                                tier_thresholds=tier_thresholds,
                                class_history=class_history,
                                profession_history=profession_history,
                                race_history=race_history,
                                item_repository=item_repository
                            )
                        elif is_manual:
                            # Custom manual character
                            # Use current stats as final stats
                            current_stats = {}
                            for stat in STATS:
                                if stat in row:
                                    try:
                                        current_stats[stat] = int(row[stat])
                                    except ValueError:
                                        current_stats[stat] = 5
                                else:
                                    current_stats[stat] = 5
                            
                            character = Character.create_manual(
                                name=row["Name"],
                                stats=current_stats,
                                meta=meta,
                                free_points=free_points,
                                tier_thresholds=tier_thresholds,
                                class_history=class_history,
                                profession_history=profession_history,
                                item_repository=item_repository
                            )
                        else:
                            # Regular calculated character - need to reconstruct with stat sources
                            character = Character.create_calculated(
                                name=row["Name"],
                                stats=base_stats,
                                meta=meta,
                                tier_thresholds=tier_thresholds,
                                class_history=class_history,
                                profession_history=profession_history,
                                race_history=race_history,
                                item_repository=item_repository
                            )
                            
                            # Apply loaded stat sources (excluding race which gets recalculated)
                            character._apply_stat_sources_for_loading(stat_sources)
                        
                        # Set loaded validation status and creation history
                        character.validation_status = validation_status
                        character.creation_history = creation_history
                        
                        print(f"Character '{character_name}' loaded from {filename}")
                        print(f"Character Type: {meta.get('Character Type', 'character')}")
                        print(f"Validation status: {validation_status}")
                        if creation_history:
                            print(f"Originally created as: {creation_history.get('original_creation_method', 'unknown')}")
                        
                        return character
                
                print(f"Character '{character_name}' not found in {filename}")
                return None
        except Exception as e:
            print(f"Error loading character: {e}")
            return None

class StatValidator:
    """
    Comprehensive validation and stat analysis system.
    Handles validation for calculated characters, custom manual characters, 
    reverse-engineered manual characters, and familiars/monsters.
    UPDATED: Added support for familiar/monster validation
    """
    
    def __init__(self, character):
        """
        Initialize the validator with a character.
        
        Args:
            character: The character to validate
        """
        self.character = character
    
    def validate(self) -> Dict[str, Any]:
        """
        Main validation entry point.
        Performs validation and updates character's validation status.
        Includes auto-correction for missing free points.
        """
        # NEW: Handle validation for familiars/monsters
        if self.character.data_manager.is_race_leveling_type():
            result = self._validate_race_leveling_character()
        elif self.character.is_manual_character:
            result = self._validate_manual_character()
        else:
            result = self._validate_calculated_character()
        
        # Auto-correct missing free points for progression-based characters
        correction_applied, points_added, correction_message = self.auto_correct_free_points()
        
        if correction_applied:
            result["free_points_auto_corrected"] = True
            result["free_points_added"] = points_added
            result["auto_correction_message"] = correction_message
            
            # Re-validate after correction to update validation status
            if self.character.data_manager.is_race_leveling_type():
                updated_result = self._validate_race_leveling_character()
            elif self.character.is_manual_character:
                updated_result = self._validate_manual_character()
            else:
                updated_result = self._validate_calculated_character()
            
            # Merge the updated results but keep the auto-correction info
            updated_result["free_points_auto_corrected"] = True
            updated_result["free_points_added"] = points_added
            updated_result["auto_correction_message"] = correction_message
            result = updated_result
        else:
            result["free_points_auto_corrected"] = False
            result["free_points_added"] = 0
            result["auto_correction_message"] = correction_message
        
        # Update character's validation status based on final results
        self.character.validation_status = "valid" if result["valid"] else "invalid"
        
        return result
    
    def auto_correct_free_points(self) -> Tuple[bool, int, str]:
        """
        Auto-correct missing free points for progression-based characters.
        
        Returns:
            Tuple of (correction_applied, points_added, message)
        """
        # Only auto-correct for characters that follow progression rules
        if (self.character.is_manual_character and 
            not (self.character.manual_base_stats and self.character.manual_current_stats)):
            # Custom manual character - don't auto-correct
            return False, 0, "Custom manual character - no auto-correction applied"
        
        # Calculate expected free points
        if self.character.data_manager.is_race_leveling_type():
            # Familiar/monster - only race bonuses
            expected_remaining = self._calculate_expected_race_free_points()
        elif self.character.is_manual_character:
            # Reverse-engineered manual character
            base_stats = self.character.manual_base_stats
            current_stats = self.character.manual_current_stats
            analysis = self.reverse_engineer_stat_allocation(base_stats, current_stats)
            expected_remaining = analysis["remaining_free_points"]
        else:
            # Calculated character
            validation_result = self._validate_calculated_character()
            if "free_points" not in validation_result:
                return False, 0, "Unable to determine expected free points"
            
            fp_info = validation_result["free_points"]
            expected_total = fp_info.get("expected_total", 0)
            spent = fp_info.get("spent", 0)
            expected_remaining = expected_total - spent
        
        current_remaining = self.character.level_system.free_points
        
        if expected_remaining > current_remaining:
            # Character is missing free points - auto-correct
            points_to_add = expected_remaining - current_remaining
            self.character.level_system.free_points = expected_remaining
            
            return True, points_to_add, f"Added {points_to_add} missing free points (from {current_remaining} to {expected_remaining})"
        elif expected_remaining < current_remaining:
            # Character has excess free points - auto-correct
            points_to_add = expected_remaining - current_remaining
            self.character.level_system.free_points = expected_remaining
            
            return True, points_to_add, f"Removed {points_to_add} excess free points (from {current_remaining} to {expected_remaining})"
        else:
            # Character has correct or excess free points
            return False, 0, "No free point correction needed"
    
    def _calculate_expected_race_free_points(self) -> int:
        """Calculate expected free points from race bonuses only (for familiars/monsters)"""
        race_level = int(self.character.data_manager.get_meta("Race level", "0"))
        if race_level <= 0:
            return 0
        
        total_free_points = 0
        
        if self.character.data_manager.race_history:
            # Use race history
            for level in range(1, race_level + 1):
                race_at_level = self.character.data_manager.get_race_at_race_level(level)
                if race_at_level and race_at_level.lower() in races:
                    race_data = races[race_at_level.lower()]
                    rank_ranges = race_data.get("rank_ranges", [])
                    
                    for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                        if range_data["min_level"] <= level <= range_data["max_level"]:
                            total_free_points += range_data.get("stats", {}).get("free_points", 0)
                            break
        else:
            # Fallback to current race for all levels
            race_name = self.character.data_manager.get_meta("Race", "").lower()
            if race_name and race_name in races:
                race_data = races[race_name]
                rank_ranges = race_data.get("rank_ranges", [])
                
                for level in range(1, race_level + 1):
                    for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                        if range_data["min_level"] <= level <= range_data["max_level"]:
                            total_free_points += range_data.get("stats", {}).get("free_points", 0)
                            break
        
        # Calculate how many free points should remain
        current_stats = self.character.data_manager.get_all_stats()
        stat_sources = {stat: self.character.data_manager.get_stat_sources(stat) for stat in STATS}
        
        free_points_spent = 0
        for stat in STATS:
            sources = stat_sources[stat]
            if StatSource.FREE_POINTS in sources:
                free_points_spent += sources[StatSource.FREE_POINTS]
        
        return total_free_points - free_points_spent
    
    def _validate_race_leveling_character(self) -> Dict[str, Any]:
        """
        ENHANCED: Validate a familiar or monster that levels through race only.
        Now includes detailed free points analysis like regular characters.
        
        Returns:
            Validation results for race-leveling character with full free points analysis
        """
        result = {
            "valid": True,
            "stat_discrepancies": {},
            "free_points": {},
            "overall_summary": "",
            "details": {},
            "validation_type": "race_leveling"
        }
        
        character_type = self.character.data_manager.get_meta("Character Type")
        
        # 1. Validate that they don't have class/profession levels
        class_level = int(self.character.data_manager.get_meta("Class level", "0"))
        profession_level = int(self.character.data_manager.get_meta("Profession level", "0"))
        
        if class_level > 0:
            result["valid"] = False
            result["stat_discrepancies"]["class_level"] = f"{character_type.capitalize()}s should not have class levels"
        
        if profession_level > 0:
            result["valid"] = False
            result["stat_discrepancies"]["profession_level"] = f"{character_type.capitalize()}s should not have profession levels"
        
        # 2. Validate race level and race bonuses
        race_level = int(self.character.data_manager.get_meta("Race level", "0"))
        if race_level <= 0:
            result["stat_discrepancies"]["race_level"] = f"{character_type.capitalize()} must have a race level"
            result["valid"] = False
        
        # 3. ENHANCED: Calculate detailed expected stats from race bonuses (like regular characters)
        expected_race_stats = self._get_race_stats()
        base_stats = self._get_base_stats()
        item_stats = self._get_item_stats()
        blessing_stats = self._get_blessing_stats()
        
        # Calculate expected free points from race progression
        expected_free_points = expected_race_stats.get("free_points", 0)
        
        # Calculate expected base stats (without free point allocation)
        expected_base_stats = {}
        for stat in STATS:
            expected_base_stats[stat] = (
                base_stats.get(stat, 5) +
                expected_race_stats.get(stat, 0) +
                item_stats.get(stat, 0) +
                blessing_stats.get(stat, 0)
            )
        
        # Get actual stats and their sources
        actual_stats = self.character.data_manager.get_all_stats()
        stat_sources = {stat: self.character.data_manager.get_stat_sources(stat) for stat in STATS}
        
        # Calculate free points spent on stats
        free_points_spent = 0
        for stat in STATS:
            sources = stat_sources[stat]
            if StatSource.FREE_POINTS in sources:
                free_points_spent += sources[StatSource.FREE_POINTS]
        
        # ENHANCED: Provide detailed free points analysis (same as regular characters)
        current_remaining = max(0, self.character.level_system.free_points)
        total_expected = expected_free_points
        total_accounted = free_points_spent + current_remaining
        difference = total_expected - total_accounted
        
        result["free_points"] = {
            "expected_total": total_expected,
            "spent": free_points_spent,
            "current": current_remaining,
            "difference": difference,
            "free_points_match": difference == 0
        }
        
        # Mark as invalid if free points don't balance
        if difference != 0:
            result["valid"] = False
        
        # 4. ENHANCED: Check discrepancies for each stat (like regular characters)
        for stat in STATS:
            # Expected value from all sources except free points
            expected_base = expected_base_stats[stat]
            
            # Actual value
            actual = actual_stats[stat]
            
            # Free points used for this stat
            free_points_used = stat_sources[stat].get(StatSource.FREE_POINTS, 0)
            
            # Expected total including free points
            expected_total = expected_base + free_points_used
            
            # Check if there's a discrepancy
            if actual != expected_total:
                diff = actual - expected_total
                result["valid"] = False
                result["stat_discrepancies"][stat] = {
                    "expected_base": expected_base,
                    "free_points_used": free_points_used,
                    "expected_total": expected_total,
                    "actual": actual,
                    "difference": diff,
                    "status": "over_allocated" if diff > 0 else "under_allocated"
                }
        
        # 5. ENHANCED: Store detailed information for reference (like regular characters)
        result["details"] = {
            "base_stats": base_stats,
            "race_stats": expected_race_stats,
            "item_stats": item_stats,
            "blessing_stats": blessing_stats,
            "expected_base_stats": expected_base_stats,
            "actual_stats": actual_stats,
            "stat_sources": stat_sources,
            "stat_allocations": {}  # Add detailed stat allocation analysis
        }
        
        # Add detailed stat allocation analysis for each stat
        for stat in STATS:
            result["details"]["stat_allocations"][stat] = {
                "base": base_stats.get(stat, 5),
                "class_bonus": 0,  # Familiars/monsters have no class bonuses
                "profession_bonus": 0,  # Familiars/monsters have no profession bonuses
                "race_bonus": expected_race_stats.get(stat, 0),
                "item_bonus": item_stats.get(stat, 0),
                "blessing_bonus": blessing_stats.get(stat, 0),
                "free_points_allocated": stat_sources[stat].get(StatSource.FREE_POINTS, 0),
                "expected_total": expected_base_stats[stat] + stat_sources[stat].get(StatSource.FREE_POINTS, 0),
                "current": actual_stats[stat],
                "discrepancy": actual_stats[stat] - (expected_base_stats[stat] + stat_sources[stat].get(StatSource.FREE_POINTS, 0))
            }
        
        # 6. ENHANCED: Create detailed human-readable summary
        if result["valid"]:
            result["overall_summary"] = f"{character_type.capitalize()} follows race progression rules correctly"
        else:
            errors = []
            if any("level" in key for key in result["stat_discrepancies"]):
                errors.append("inappropriate class/profession levels")
            if any("level" not in key for key in result["stat_discrepancies"]):
                stat_issues = [k for k in result['stat_discrepancies'] if 'level' not in k]
                errors.append(f"{len(stat_issues)} stat issues")
            if difference != 0:
                if difference > 0:
                    errors.append(f"missing {difference} free points")
                else:
                    errors.append(f"{abs(difference)} excess free points")
            result["overall_summary"] = f"{character_type.capitalize()} has problems: {', '.join(errors)}"
        
        return result
    
    def _validate_manual_character(self) -> Dict[str, Any]:
        """
        Validate manual character - routes to custom or reverse-engineered validation.
        
        Returns:
            Validation results appropriate for the manual character type
        """
        # Check if we have reverse engineering data
        if self.character.manual_base_stats and self.character.manual_current_stats:
            # This character should follow progression rules
            return self._validate_reverse_engineered_character()
        else:
            # This is a completely custom character - minimal validation
            return self._validate_custom_character()
    
    def _validate_custom_character(self) -> Dict[str, Any]:
        """
        Validate a completely custom character with minimal checks.
        
        Returns:
            Basic validation results for custom character
        """
        result = {
            "valid": True,
            "stat_discrepancies": {},
            "free_points": "N/A - Custom Character",
            "overall_summary": "Custom character - no progression validation performed",
            "details": {},
            "validation_type": "custom_manual"
        }
        
        # Only basic sanity checks
        warnings = []
        errors = []
        
        # 1. Check race level calculation (only thing that should be calculated for regular characters)
        if not self.character.data_manager.is_race_leveling_type():
            class_level = int(self.character.data_manager.get_meta("Class level", "0"))
            profession_level = int(self.character.data_manager.get_meta("Profession level", "0"))
            expected_race_level = (class_level + profession_level) // 2
            actual_race_level = int(self.character.data_manager.get_meta("Race level", "0"))
            
            if expected_race_level != actual_race_level:
                errors.append(f"Race level calculation error: expected {expected_race_level}, actual {actual_race_level}")
                result["valid"] = False
        
        # 2. Basic stat sanity checks
        for stat in STATS:
            value = self.character.data_manager.get_stat(stat)
            if value < 0:
                errors.append(f"{stat} cannot be negative: {value}")
                result["valid"] = False
            elif value > 10000:  # Very generous upper limit
                warnings.append(f"{stat} is extremely high: {value}")
        
        # 3. Check free points are non-negative
        if self.character.level_system.free_points < 0:
            errors.append(f"Free points cannot be negative: {self.character.level_system.free_points}")
            result["valid"] = False
        
        # Store detailed validation results
        result["custom_validation"] = {
            "race_level_correct": True,  # Skip for race-leveling types
            "stats_reasonable": all(0 <= self.character.data_manager.get_stat(stat) <= 10000 for stat in STATS),
            "free_points_valid": self.character.level_system.free_points >= 0,
            "warnings": warnings,
            "errors": errors
        }
        
        # Summary
        if errors:
            result["valid"] = False
            result["overall_summary"] = f"Custom character has {len(errors)} error(s)"
        elif warnings:
            result["overall_summary"] = f"Custom character OK with {len(warnings)} warning(s)"
        else:
            result["overall_summary"] = "Custom character - all basic checks passed"
        
        return result
    
    def _validate_reverse_engineered_character(self) -> Dict[str, Any]:
        """
        Validate a reverse-engineered manual character with full progression validation.
        
        Returns:
            Complete validation results including reverse engineering analysis
        """
        result = {
            "valid": True,
            "stat_discrepancies": {},
            "free_points": {},
            "overall_summary": "",
            "details": {},
            "validation_type": "reverse_engineered_manual"
        }
        
        base_stats = self.character.manual_base_stats
        current_stats = self.character.manual_current_stats
        
        # Perform reverse engineering analysis
        analysis = self.reverse_engineer_stat_allocation(base_stats, current_stats)
        
        # Validate that the character's actual stats match the provided current stats
        calculated_stats = self.character.data_manager.get_all_stats()
        stat_discrepancies = {}
        
        for stat in STATS:
            expected = current_stats.get(stat, 0)
            actual = calculated_stats.get(stat, 0)
            
            if expected != actual:
                result["valid"] = False
                stat_discrepancies[stat] = {
                    "provided_current": expected,
                    "calculated_current": actual,
                    "difference": actual - expected
                }
        
        result["stat_discrepancies"] = stat_discrepancies
        
        # Validate free points math
        expected_remaining = analysis["remaining_free_points"]
        actual_remaining = self.character.level_system.free_points
        
        result["free_points"] = {
            "expected_total": analysis["total_expected_free_points"],
            "used_in_allocation": analysis["total_free_points_used"],
            "calculated_remaining": expected_remaining,
            "actual_remaining": actual_remaining,
            "free_points_match": expected_remaining == actual_remaining
        }
        
        if expected_remaining != actual_remaining:
            result["valid"] = False
        
        # Check for impossible allocations (negative requirements)
        for stat, stat_analysis in analysis["stat_allocations"].items():
            if stat_analysis["discrepancy"] < 0:
                result["valid"] = False
                if stat not in stat_discrepancies:
                    stat_discrepancies[stat] = {}
                stat_discrepancies[stat]["impossible_allocation"] = stat_analysis["discrepancy"]
        
        result["details"] = analysis
        
        # Generate summary
        if result["valid"]:
            result["overall_summary"] = "Reverse-engineered character follows progression rules correctly"
        else:
            errors = []
            if stat_discrepancies:
                errors.append(f"{len(stat_discrepancies)} stat issues")
            if not result["free_points"]["free_points_match"]:
                errors.append("free points mismatch")
            result["overall_summary"] = f"Reverse-engineered character has problems: {', '.join(errors)}"
        
        return result
    
    def _validate_calculated_character(self) -> Dict[str, Any]:
        """
        Validate a character with calculated stats using unified progression validation.
        Uses the same reliable logic as reverse-engineered validation but adapted for calculated characters.
        
        Returns:
            Complete validation results for calculated character
        """
        # Initialize result dictionary
        result = {
            "valid": True,
            "stat_discrepancies": {},
            "free_points": {
                "current": self.character.level_system.free_points,
                "expected_total": 0,
                "spent": 0,
                "difference": 0
            },
            "overall_summary": "",
            "details": {},
            "validation_type": "calculated"
        }
        
        # Get base stats from stat sources (not manual data)
        base_stats = {}
        for stat in STATS:
            sources = self.character.data_manager.get_stat_sources(stat)
            base_stats[stat] = sources.get(StatSource.BASE, 5)
        
        # Get current stats
        actual_stats = self.character.data_manager.get_all_stats()
        
        # Use the proven reverse engineering analysis approach
        analysis = self.reverse_engineer_stat_allocation(base_stats, actual_stats)
        
        # Extract expected bonuses (uses correct race history)
        expected_bonuses = analysis["expected_bonuses"]
        
        # Calculate free points information
        result["free_points"]["expected_total"] = analysis["total_expected_free_points"]
        result["free_points"]["spent"] = analysis["total_free_points_used"]
        result["free_points"]["difference"] = analysis["remaining_free_points"]
        
        # Check for stat discrepancies using the detailed analysis
        for stat in STATS:
            stat_analysis = analysis["stat_allocations"][stat]
            
            # Check for impossible allocations (negative free points required)
            if stat_analysis["discrepancy"] < 0:
                result["valid"] = False
                result["stat_discrepancies"][stat] = {
                    "base": stat_analysis["base"],
                    "class_bonus": stat_analysis["class_bonus"],
                    "profession_bonus": stat_analysis["profession_bonus"],
                    "race_bonus": stat_analysis["race_bonus"],
                    "expected_from_progression": stat_analysis["expected_from_progression"],
                    "actual": stat_analysis["current"],
                    "free_points_allocated": stat_analysis["free_points_allocated"],
                    "impossible_requirement": abs(stat_analysis["discrepancy"]),
                    "status": "impossible_allocation"
                }
        
        # Check overall free points balance
        if analysis["remaining_free_points"] != self.character.level_system.free_points:
            result["valid"] = False
            result["free_points"]["actual_remaining"] = self.character.level_system.free_points
            result["free_points"]["calculated_remaining"] = analysis["remaining_free_points"]
        
        # Store detailed breakdown for backward compatibility
        result["details"] = {
            "base_stats": {stat: analysis["stat_allocations"][stat]["base"] for stat in STATS},
            "class_stats": expected_bonuses["class"].copy(),
            "profession_stats": expected_bonuses["profession"].copy(),
            "race_stats": expected_bonuses["race"].copy(),
            "item_stats": self._get_item_stats(),
            "blessing_stats": self._get_blessing_stats(),
            "expected_bonuses": expected_bonuses,
            "stat_allocations": analysis["stat_allocations"],
            "actual_stats": actual_stats
        }
        
        # Add free points to stat breakdowns for compatibility
        result["details"]["class_stats"]["free_points"] = expected_bonuses["class_free_points"]
        result["details"]["profession_stats"]["free_points"] = expected_bonuses["profession_free_points"]
        result["details"]["race_stats"]["free_points"] = expected_bonuses["race_free_points"]
        
        # Create human-readable summary
        result["overall_summary"] = self._create_calculated_summary(result)
        
        return result
    
    def calculate_expected_bonuses(self) -> Dict[str, Any]:
        """
        Calculate expected stat bonuses from class/profession/race progression.
        UPDATED: Now uses race history for race bonus calculations and handles familiars/monsters.
        """
        bonuses = {
            "class": {stat: 0 for stat in STATS},
            "profession": {stat: 0 for stat in STATS}, 
            "race": {stat: 0 for stat in STATS},
            "class_free_points": 0,
            "profession_free_points": 0,
            "race_free_points": 0
        }
        
        # For familiars/monsters, only calculate race bonuses
        if self.character.data_manager.is_race_leveling_type():
            race_level = int(self.character.data_manager.get_meta("Race level", "0"))
            if race_level > 0:
                if self.character.data_manager.race_history:
                    # Use race history
                    for level in range(1, race_level + 1):
                        race_at_level = self.character.data_manager.get_race_at_race_level(level)
                        if race_at_level and race_at_level.lower() in races:
                            race_data = races[race_at_level.lower()]
                            rank_ranges = race_data.get("rank_ranges", [])
                            
                            for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                                if range_data["min_level"] <= level <= range_data["max_level"]:
                                    for stat, gain in range_data.get("stats", {}).items():
                                        if stat == "free_points":
                                            bonuses["race_free_points"] += gain
                                        elif stat in STATS:
                                            bonuses["race"][stat] += gain
                                    break
                else:
                    # Fallback to current race for all levels
                    race_name = self.character.data_manager.get_meta("Race", "").lower()
                    if race_name and race_name in races:
                        race_data = races[race_name]
                        rank_ranges = race_data.get("rank_ranges", [])
                        
                        for level in range(1, race_level + 1):
                            for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                                if range_data["min_level"] <= level <= range_data["max_level"]:
                                    for stat, gain in range_data.get("stats", {}).items():
                                        if stat == "free_points":
                                            bonuses["race_free_points"] += gain
                                        elif stat in STATS:
                                            bonuses["race"][stat] += gain
                                    break
            return bonuses
        
        # Calculate class bonuses (unchanged)
        class_level = int(self.character.data_manager.get_meta("Class level", "0"))
        if class_level > 0:
            for level in range(1, class_level + 1):
                class_name = self.character.data_manager.get_class_at_level(level)
                if class_name:
                    tier = self.character.data_manager.get_tier_for_level(level)
                    gains = get_class_gains(class_name, tier)
                    for stat, gain in gains.items():
                        if stat == "free_points":
                            bonuses["class_free_points"] += gain
                        elif stat in STATS:
                            bonuses["class"][stat] += gain
        
        # Calculate profession bonuses (unchanged)
        profession_level = int(self.character.data_manager.get_meta("Profession level", "0"))
        if profession_level > 0:
            for level in range(1, profession_level + 1):
                profession_name = self.character.data_manager.get_profession_at_level(level)
                if profession_name:
                    tier = self.character.data_manager.get_tier_for_level(level)
                    gains = get_profession_gains(profession_name, tier)
                    for stat, gain in gains.items():
                        if stat == "free_points":
                            bonuses["profession_free_points"] += gain
                        elif stat in STATS:
                            bonuses["profession"][stat] += gain
        
        # Calculate race bonuses using race history
        race_level = int(self.character.data_manager.get_meta("Race level", "0"))
        if race_level > 0:
            if self.character.data_manager.race_history:
                # Use race history
                for level in range(1, race_level + 1):
                    race_at_level = self.character.data_manager.get_race_at_race_level(level)
                    if race_at_level and race_at_level.lower() in races:
                        race_data = races[race_at_level.lower()]
                        rank_ranges = race_data.get("rank_ranges", [])
                        
                        for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                            if range_data["min_level"] <= level <= range_data["max_level"]:
                                for stat, gain in range_data.get("stats", {}).items():
                                    if stat == "free_points":
                                        bonuses["race_free_points"] += gain
                                    elif stat in STATS:
                                        bonuses["race"][stat] += gain
                                break
            else:
                # Fallback to current race for all levels
                race_name = self.character.data_manager.get_meta("Race", "").lower()
                if race_name and race_name in races:
                    race_data = races[race_name]
                    rank_ranges = race_data.get("rank_ranges", [])
                    
                    for level in range(1, race_level + 1):
                        for range_data in sorted(rank_ranges, key=lambda x: x["min_level"]):
                            if range_data["min_level"] <= level <= range_data["max_level"]:
                                for stat, gain in range_data.get("stats", {}).items():
                                    if stat == "free_points":
                                        bonuses["race_free_points"] += gain
                                    elif stat in STATS:
                                        bonuses["race"][stat] += gain
                                break
        
        return bonuses
    
    def reverse_engineer_stat_allocation(self, base_stats: Dict[str, int], 
                                       current_stats: Dict[str, int]) -> Dict[str, Any]:
        """
        Reverse-engineer how stats were allocated based on base and current stats.
        
        Args:
            base_stats: The character's base stats before any bonuses
            current_stats: The character's final stats after all bonuses
            
        Returns:
            Dictionary containing allocation analysis and validation data
        """
        expected_bonuses = self.calculate_expected_bonuses()
        
        # Calculate total expected free points
        total_expected_free_points = (
            expected_bonuses["class_free_points"] + 
            expected_bonuses["profession_free_points"] + 
            expected_bonuses["race_free_points"]
        )
        
        # Analyze each stat
        allocation_analysis = {
            "stat_allocations": {},
            "total_free_points_used": 0,
            "expected_bonuses": expected_bonuses,
            "total_expected_free_points": total_expected_free_points
        }
        
        total_free_points_used = 0
        
        for stat in STATS:
            base = base_stats.get(stat, 5)
            current = current_stats.get(stat, base)
            
            # Calculate expected from progression bonuses
            expected_from_progression = (
                base + 
                expected_bonuses["class"].get(stat, 0) + 
                expected_bonuses["profession"].get(stat, 0) + 
                expected_bonuses["race"].get(stat, 0)
            )
            
            # The difference must be from free points, items, or blessings
            free_points_allocated = current - expected_from_progression
            
            allocation_analysis["stat_allocations"][stat] = {
                "base": base,
                "class_bonus": expected_bonuses["class"].get(stat, 0),
                "profession_bonus": expected_bonuses["profession"].get(stat, 0),
                "race_bonus": expected_bonuses["race"].get(stat, 0),
                "expected_from_progression": expected_from_progression,
                "current": current,
                "free_points_allocated": max(0, free_points_allocated),  # Can't be negative
                "discrepancy": free_points_allocated if free_points_allocated < 0 else 0
            }
            
            if free_points_allocated > 0:
                total_free_points_used += free_points_allocated
        
        allocation_analysis["total_free_points_used"] = total_free_points_used
        allocation_analysis["remaining_free_points"] = total_expected_free_points - total_free_points_used
        
        return allocation_analysis
    
    def _create_calculated_summary(self, result: Dict[str, Any]) -> str:
        """Create a human-readable summary of calculated character validation results."""
        if result["valid"]:
            return "Character stats are valid. All stats are properly allocated."
        
        summary_parts = []
        
        # Summarize stat discrepancies
        if result["stat_discrepancies"]:
            over_allocated = {}
            under_allocated = {}
            
            for stat, info in result["stat_discrepancies"].items():
                if info["difference"] > 0:
                    over_allocated[stat] = info["difference"]
                else:
                    under_allocated[stat] = abs(info["difference"])
            
            if over_allocated:
                over_text = ", ".join(f"{stat}: +{points}" for stat, points in over_allocated.items())
                summary_parts.append(f"Over-allocated stats: {over_text}")
            
            if under_allocated:
                under_text = ", ".join(f"{stat}: -{points}" for stat, points in under_allocated.items())
                summary_parts.append(f"Under-allocated stats: {under_text}")
        
        # Summarize free points discrepancy
        free_points_diff = result["free_points"]["difference"]
        if free_points_diff != 0:
            if free_points_diff > 0:
                summary_parts.append(
                    f"Free points discrepancy: {free_points_diff} unaccounted for. "
                    f"Expected total: {result['free_points']['expected_total']}, "
                    f"Spent: {result['free_points']['spent']}, "
                    f"Current: {result['free_points']['current']}"
                )
            else:
                summary_parts.append(
                    f"Free points discrepancy: {abs(free_points_diff)} too many spent. "
                    f"Expected total: {result['free_points']['expected_total']}, "
                    f"Spent: {result['free_points']['spent']}, "
                    f"Current: {result['free_points']['current']}"
                )
        
        return "\n".join(summary_parts)
    
    def _get_base_stats(self) -> Dict[str, int]:
        """Get the base stats (usually 5 for each stat)."""
        base_stats = {}
        for stat in STATS:
            stat_sources = self.character.data_manager.get_stat_sources(stat)
            base_stats[stat] = stat_sources.get("base", 5)
        return base_stats
    
    def _get_class_stats(self) -> Dict[str, int]:
        """Calculate total stat bonuses from class levels."""
        stats = {stat: 0 for stat in STATS}
        stats["free_points"] = 0
        
        class_level = int(self.character.data_manager.get_meta("Class level", "0"))
        if class_level <= 0:
            return stats
        
        # Apply stat gains for each level based on the class active at that level
        for level in range(1, class_level + 1):
            class_name = self.character.data_manager.get_class_at_level(level)
            if not class_name:
                continue
                
            # Get the tier for this level
            tier = self.character.data_manager.get_tier_for_level(level)
            
            # Get gains for this class and tier
            gains = get_class_gains(class_name, tier)
            
            # Apply the gains
            for stat, gain in gains.items():
                if stat in stats:
                    stats[stat] += gain
        
        return stats
    
    def _get_profession_stats(self) -> Dict[str, int]:
        """Calculate total stat bonuses from profession levels."""
        stats = {stat: 0 for stat in STATS}
        stats["free_points"] = 0
        
        profession_level = int(self.character.data_manager.get_meta("Profession level", "0"))
        if profession_level <= 0:
            return stats
        
        # Apply stat gains for each level based on the profession active at that level
        for level in range(1, profession_level + 1):
            profession_name = self.character.data_manager.get_profession_at_level(level)
            if not profession_name:
                continue
                
            # Get the tier for this level
            tier = self.character.data_manager.get_tier_for_level(level)
            
            # Get gains for this profession and tier
            gains = get_profession_gains(profession_name, tier)
            
            # Apply the gains
            for stat, gain in gains.items():
                if stat in stats:
                    stats[stat] += gain
        
        return stats
    
    def _get_race_stats(self) -> Dict[str, int]:
        """Calculate total stat bonuses from race levels."""
        stats = {stat: 0 for stat in STATS}
        stats["free_points"] = 0
        
        race_name = self.character.data_manager.get_meta("Race", "").lower()
        race_level = int(self.character.data_manager.get_meta("Race level", "0"))
        
        if not race_name or race_level <= 0 or race_name not in races:
            return stats
        
        race_data = races[race_name]
        rank_ranges = race_data.get("rank_ranges", [])
        
        if not rank_ranges:
            return stats

        # Sort ranges by min_level for correct application (matches LevelSystem behavior)
        sorted_ranges = sorted(rank_ranges, key=lambda x: x["min_level"])

        # For each level, find the applicable rank range and apply stats
        for level in range(1, race_level + 1):
            for range_data in sorted_ranges:
                if range_data["min_level"] <= level <= range_data["max_level"]:
                    for stat, gain in range_data.get("stats", {}).items():
                        if stat in stats:  # Explicit check for valid stats including free_points
                            stats[stat] += gain
                    break
        
        return stats
    
    def _get_item_stats(self) -> Dict[str, int]:
        """Calculate total stat bonuses from equipped items."""
        stats = {stat: 0 for stat in STATS}
        
        for item in self.character.inventory.get_equipped_items():
            for stat, value in item.stats.items():
                if stat in STATS:
                    stats[stat] += value
        
        return stats
    
    def _get_blessing_stats(self) -> Dict[str, int]:
        """Calculate total stat bonuses from blessings."""
        stats = {stat: 0 for stat in STATS}
        
        if hasattr(self.character, 'blessing') and self.character.blessing:
            for stat, value in self.character.blessing.items():
                if stat in STATS:
                    stats[stat] += value
        
        return stats

class Character:
    """
    Main character class with factory methods for different creation types.
    Use factory methods instead of calling constructor directly.
    UPDATED: Added support for familiars and monsters
    """
    
    def __init__(self, name: str, stats: Dict[str, int], meta: Dict[str, str], 
                 free_points: int = 0, tier_thresholds: Optional[List[int]] = None,
                 class_history: Optional[List[Dict[str, Any]]] = None,
                 profession_history: Optional[List[Dict[str, Any]]] = None,
                 race_history: Optional[List[Dict[str, Any]]] = None,
                 item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        Private constructor - use factory methods instead.
        UPDATED: Added race_history parameter
        """
        self.name = name
        
        # Initialize manual character attributes
        self.is_manual_character = False
        self.manual_base_stats = None
        self.manual_current_stats = None
        
        # Initialize validation status
        self.validation_status = "unvalidated"
        
        # Initialize creation history for converted characters
        self.creation_history = None
        
        # Initialize all systems (UPDATED: added race_history)
        self.data_manager = CharacterDataManager(
            stats, meta, tier_thresholds, class_history, profession_history, race_history
        )
        self.health_manager = HealthManager(self.data_manager)
        self.inventory = Inventory(item_repository)
        self.combat_system = CombatSystem(self.data_manager, self.health_manager)
        self.level_system = LevelSystem(self.data_manager)
        
        # Set free points
        self.level_system.free_points = free_points
        
        # Set finesse based on class
        self._update_finesse()
        
        # Apply blessing if provided
        if blessing:
            self.add_blessing(blessing)
    
    @classmethod
    def create_calculated(cls, name: str, stats: Dict[str, int], meta: Dict[str, str],
                         tier_thresholds: Optional[List[int]] = None,
                         class_history: Optional[List[Dict[str, Any]]] = None,
                         profession_history: Optional[List[Dict[str, Any]]] = None,
                         race_history: Optional[List[Dict[str, Any]]] = None,
                         item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        Create a character with calculated progression bonuses.
        UPDATED: Added race_history parameter
        """
        character = cls(
            name=name,
            stats=stats,
            meta=meta,
            tier_thresholds=tier_thresholds,
            class_history=class_history,
            profession_history=profession_history,
            race_history=race_history,
            item_repository=item_repository,
            blessing=blessing
        )
        
        # Apply calculations if character has levels
        character._calculate_and_apply_level_stats()
        
        return character
    
    @classmethod
    def create_manual(cls, name: str, stats: Dict[str, int], meta: Dict[str, str],
                     free_points: int = 0, tier_thresholds: Optional[List[int]] = None,
                     class_history: Optional[List[Dict[str, Any]]] = None,
                     profession_history: Optional[List[Dict[str, Any]]] = None,
                     item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        Create a custom manual character with no progression calculations.
        Stats are used as-is, only race level is calculated for regular characters.
        UPDATED: Added support for familiars/monsters
        """
        character = cls(
            name=name,
            stats=stats,
            meta=meta,
            free_points=free_points,
            tier_thresholds=tier_thresholds,
            class_history=class_history,
            profession_history=profession_history,
            item_repository=item_repository,
            blessing=blessing
        )
        
        # Mark as manual character
        character.is_manual_character = True
        
        # For regular characters, calculate race level
        # For familiars/monsters, race level is set manually
        if not character.data_manager.is_race_leveling_type():
            character.level_system._update_race_level(apply_bonuses=True)
        
        return character
    
    @classmethod
    def create_reverse_engineered(cls, name: str, base_stats: Dict[str, int], 
                                 current_stats: Dict[str, int], meta: Dict[str, str],
                                 free_points: int = 0, tier_thresholds: Optional[List[int]] = None,
                                 class_history: Optional[List[Dict[str, Any]]] = None,
                                 profession_history: Optional[List[Dict[str, Any]]] = None,
                                 race_history: Optional[List[Dict[str, Any]]] = None,
                                 item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        Create a manual character that follows progression rules via reverse engineering.
        Base stats and current stats are used to calculate stat allocation.
        UPDATED: Added race_history parameter
        """
        character = cls(
            name=name,
            stats=base_stats,  # Start with base stats
            meta=meta,
            free_points=free_points,
            tier_thresholds=tier_thresholds,
            class_history=class_history,
            profession_history=profession_history,
            race_history=race_history,
            item_repository=item_repository,
            blessing=blessing
        )
        
        # Mark as manual character and store reverse engineering data
        character.is_manual_character = True
        character.manual_base_stats = base_stats
        character.manual_current_stats = current_stats
        
        # Perform reverse engineering
        character._setup_reverse_engineering(base_stats, current_stats, free_points)
        
        return character
    
    @classmethod
    def create_familiar(cls, name: str, race: str, race_level: int, stats: Dict[str, int],
                       tier_thresholds: Optional[List[int]] = None,
                       race_history: Optional[List[Dict[str, Any]]] = None,
                       item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        NEW: Create a familiar that levels through race levels only.
        
        Args:
            name: Familiar's name
            race: Familiar's race
            race_level: Current race level
            stats: Base stats
            tier_thresholds: Custom tier thresholds (optional)
            race_history: Race change history (optional)
            item_repository: Item repository (optional)
            blessing: Blessing stats (optional)
        """
        meta = {
            "Character Type": "familiar",
            "Race": race,
            "Race level": str(race_level),
            "Class": "",
            "Class level": "0",
            "Profession": "",
            "Profession level": "0",
            "Race rank": ""
        }
        
        character = cls(
            name=name,
            stats=stats,
            meta=meta,
            tier_thresholds=tier_thresholds,
            race_history=race_history,
            item_repository=item_repository,
            blessing=blessing
        )
        
        # Apply race level bonuses
        character.data_manager.set_meta("Race level", str(race_level), force=True)
        character._calculate_and_apply_level_stats()
        
        return character
    
    @classmethod
    def create_monster(cls, name: str, race: str, race_level: int, stats: Dict[str, int],
                      tier_thresholds: Optional[List[int]] = None,
                      race_history: Optional[List[Dict[str, Any]]] = None,
                      item_repository=None, blessing: Optional[Dict[str, int]] = None):
        """
        NEW: Create a monster that levels through race levels only.
        
        Args:
            name: Monster's name
            race: Monster's race
            race_level: Current race level
            stats: Base stats
            tier_thresholds: Custom tier thresholds (optional)
            race_history: Race change history (optional)
            item_repository: Item repository (optional)
            blessing: Blessing stats (optional)
        """
        meta = {
            "Character Type": "monster",
            "Race": race,
            "Race level": str(race_level),
            "Class": "",
            "Class level": "0",
            "Profession": "",
            "Profession level": "0",
            "Race rank": ""
        }
        
        character = cls(
            name=name,
            stats=stats,
            meta=meta,
            tier_thresholds=tier_thresholds,
            race_history=race_history,
            item_repository=item_repository,
            blessing=blessing
        )
        
        # Apply race level bonuses
        character.data_manager.set_meta("Race level", str(race_level), force=True)
        character._calculate_and_apply_level_stats()
        
        return character
    
    @classmethod
    def load_from_file(cls, filename: str, character_name: str, item_repository=None):
        """Load character from CSV file."""
        return CharacterSerializer.load_from_csv(filename, character_name, item_repository)
    
    def _setup_reverse_engineering(self, base_stats: Dict[str, int], 
                                 current_stats: Dict[str, int], provided_free_points: int):
        """Set up character using reverse engineering analysis."""
        
        # 1. Calculate race level only (no bonuses) for regular characters
        if not self.data_manager.is_race_leveling_type():
            self.level_system._update_race_level(apply_bonuses=False)
        
        # 2. Use StatValidator to perform reverse engineering
        validator = StatValidator(self)
        analysis = validator.reverse_engineer_stat_allocation(base_stats, current_stats)
        
        # 3. Apply the calculated stat allocations
        self._apply_reverse_engineering_results(analysis, provided_free_points)
    
    def _apply_reverse_engineering_results(self, analysis: Dict[str, Any], provided_free_points: int):
        """Apply the results of reverse engineering to the character."""
        expected_bonuses = analysis["expected_bonuses"]
        
        # Apply calculated bonuses
        for stat in STATS:
            class_bonus = expected_bonuses["class"].get(stat, 0)
            profession_bonus = expected_bonuses["profession"].get(stat, 0)
            race_bonus = expected_bonuses["race"].get(stat, 0)
            
            if class_bonus > 0:
                self.data_manager.add_stat(stat, class_bonus, StatSource.CLASS)
            if profession_bonus > 0:
                self.data_manager.add_stat(stat, profession_bonus, StatSource.PROFESSION)
            if race_bonus > 0:
                self.data_manager.add_stat(stat, race_bonus, StatSource.RACE)
        
        # Apply free point allocations
        for stat, stat_analysis in analysis["stat_allocations"].items():
            free_points_allocated = stat_analysis["free_points_allocated"]
            if free_points_allocated > 0:
                self.data_manager.add_stat(stat, free_points_allocated, StatSource.FREE_POINTS)
        
        # Set remaining free points
        self.level_system.free_points = analysis["remaining_free_points"]
        
        # Update health
        self.health_manager.update_max_health()
    
    def _calculate_and_apply_level_stats(self):
        """
        Calculate and apply stat gains based on current class/profession/race levels.
        UPDATED: Handle familiars/monsters that only use race levels
        """
        if self.data_manager.is_race_leveling_type():
            # For familiars/monsters, only apply race level gains
            race_level = int(self.data_manager.get_meta("Race level", "0"))
            if race_level > 0:
                self.level_system._apply_race_level_up(0, race_level)
                self.level_system._update_race_rank(race_level)
        else:
            # For regular characters, apply class/profession/race gains
            # Apply class level gains
            class_level = int(self.data_manager.get_meta("Class level", "0"))
            if class_level > 0:
                for level in range(1, class_level + 1):
                    self.level_system._apply_class_level_up(level)
            
            # Apply profession level gains
            profession_level = int(self.data_manager.get_meta("Profession level", "0"))
            if profession_level > 0:
                for level in range(1, profession_level + 1):
                    self.level_system._apply_profession_level_up(level)
            
            # Update race level after class/profession calculations
            self.level_system._update_race_level()
        
        # Update health
        self.health_manager.update_max_health()
    
    def _apply_stat_sources_for_loading(self, stat_sources: Dict[str, Dict[str, int]]) -> None:
        """Apply stat sources when loading a character (existing logic)."""
        # Apply all stat sources EXCEPT race bonuses
        for stat in STATS:
            if stat in stat_sources:
                for source, value in stat_sources[stat].items():
                    if source in [StatSource.FREE_POINTS, StatSource.BLESSING, StatSource.ITEM]:
                        self.data_manager.add_stat(stat, value, source)
        
        # Recalculate race bonuses but don't touch free points
        self.level_system.recalculate_race_levels(skip_free_points=True)
        
        # Update health after all stats are applied
        self.health_manager.update_max_health()
        
        # Update free points
        self.level_system.free_points = self.level_system.free_points - sum(stat_data['free_points'] for stat_data in stat_sources.values())
    
    def _update_finesse(self) -> None:
        """Update finesse setting based on class."""
        class_name = self.data_manager.get_meta("Class", "").lower()
        self.combat_system.set_finesse(class_name in ["light warrior", "thunder puppet's shadow"])
    
    # NEW: Helper methods for character types
    def is_familiar(self) -> bool:
        """Check if this character is a familiar"""
        return self.data_manager.is_familiar()
    
    def is_monster(self) -> bool:
        """Check if this character is a monster"""
        return self.data_manager.is_monster()
    
    def is_race_leveling_type(self) -> bool:
        """Check if this character type levels through race instead of class/profession"""
        return self.data_manager.is_race_leveling_type()
    
    # All the existing methods remain the same
    def update_meta(self, key: str, value: Any) -> bool:
        """Update meta information with validation and cascading updates."""
        if key not in META_INFO:
            print(f"Invalid meta info: {key}")
            return False
        
        if key in DERIVED_META:
            print(f"Cannot directly update {key} as it is a derived attribute.")
            return False
        
        old_value = self.data_manager.get_meta(key)
        
        try:
            changed = self.data_manager.set_meta(key, value)
            
            if changed:
                if key == "Class":
                    self._update_finesse()
                    class_level = int(self.data_manager.get_meta("Class level", "0"))
                    if class_level > 0:
                        self.level_system.change_class(value, 1)
                
                elif key == "Profession":
                    profession_level = int(self.data_manager.get_meta("Profession level", "0"))
                    if profession_level > 0:
                        self.level_system.change_profession(value, 1)
                
                elif key == "Race":
                    self.level_system.change_race(value)
                
                elif key in ["Class level", "Profession level"]:
                    # Only update race level for regular characters
                    if not self.data_manager.is_race_leveling_type():
                        self.level_system._update_race_level()
            
            self.health_manager.update_max_health()
            return True
        except ValueError as e:
            print(f"Error updating meta: {e}")
            return False
    
    def update_stat(self, stat: str, value: int) -> bool:
        """Update a base stat directly."""
        try:
            self.data_manager.set_base_stat(stat, value)
            self.health_manager.update_max_health()
            return True
        except ValueError as e:
            print(f"Error updating stat: {e}")
            return False
    
    def level_up(self, level_type: str, target_level: int) -> bool:
        """Level up character in specified category."""
        result = self.level_system.level_up(level_type, target_level)
        if result:
            self.health_manager.update_max_health()
        return result
    
    def change_class(self, new_class: str, at_level: int) -> bool:
        """Change character's class name and record in history."""
        success = self.level_system.change_class(new_class, at_level)
        if success:
            self._update_finesse()
        return success
    
    def change_profession(self, new_profession: str, at_level: int) -> bool:
        """Change character's profession name and record in history."""
        return self.level_system.change_profession(new_profession, at_level)
    
    def change_race(self, new_race: str) -> bool:
        """Change character's race."""
        return self.level_system.change_race(new_race)
    
    def change_race_at_level(self, new_race: str, at_race_level: int) -> bool:
        """
        Change character's race at a specific race level and record in history.
        
        Args:
            new_race: The new race name
            at_race_level: The race level at which the change occurs
        
        Returns:
            True if successful, False otherwise.
        """
        return self.level_system.change_race(new_race, at_race_level)
    
    def equip_item(self, item_name: str) -> bool:
        """Equip an item and apply its stats."""
        success, item = self.inventory.equip_item(item_name)
        if success and item:
            self.data_manager.apply_item_stats(item.stats)
            self.health_manager.update_max_health()
            return True
        return False
    
    def unequip_item(self, item_name: str) -> bool:
        """Unequip an item and remove its stats."""
        success, item = self.inventory.unequip_item(item_name)
        if success and item:
            self.data_manager.remove_item_stats(item.stats)
            self.health_manager.update_max_health()
            return True
        return False
    
    def add_blessing(self, blessing_stats: Dict[str, int]) -> None:
        """Add a blessing with stat bonuses."""
        if not blessing_stats:
            return
        
        self.blessing = blessing_stats.copy()
        self.data_manager.apply_blessing(blessing_stats)
        self.health_manager.update_max_health()
    
    def remove_blessing(self) -> None:
        """Remove current blessing if any."""
        if hasattr(self, 'blessing') and self.blessing:
            self.data_manager.remove_blessing(self.blessing)
            self.blessing = None
            self.health_manager.update_max_health()
    
    def attack(self, target) -> Tuple[bool, int, int]:
        """Perform attack on another character."""
        return self.combat_system.attack(target)
    
    def allocate_free_points(self, stat: str, amount: int) -> bool:
        """Allocate free points to a specific stat."""
        success = self.level_system.allocate_free_points(stat, amount)
        if success:
            self.health_manager.update_max_health()
        return success
    
    def allocate_random(self) -> None:
        """Randomly allocate all free points."""
        self.level_system.allocate_random()
        self.health_manager.update_max_health()
    
    def recalculate_race_levels(self) -> None:
        """Recalculate race levels from scratch."""
        self.level_system.recalculate_race_levels()
        self.health_manager.update_max_health()
    
    def save(self, filename: str, mode: str = "a") -> bool:
        """Save character to file."""
        return CharacterSerializer.save_to_csv(self, filename, mode)
    
    def validate_stats(self) -> Dict[str, Any]:
        """
        Validate character stats and automatically convert manual characters if valid.
        
        Returns:
            Validation results including conversion information
        """
        validator = StatValidator(self)
        result = validator.validate()
        
        # Auto-convert manual characters that pass validation (but not familiars/monsters)
        if (self.is_manual_character and 
            self.manual_base_stats and 
            self.manual_current_stats and
            not self.is_race_leveling_type() and  # Don't auto-convert familiars/monsters
            result["valid"]):
            
            conversion_success = self._convert_to_calculated()
            result["converted_to_calculated"] = conversion_success
            
            if conversion_success:
                result["conversion_message"] = "Manual character automatically converted to calculated character"
        else:
            result["converted_to_calculated"] = False
        
        return result
    
    def _convert_to_calculated(self) -> bool:
        """
        Convert a validated manual character to calculated character.
        Archives original manual data in creation_history.
        
        Returns:
            True if conversion successful, False otherwise
        """
        if not self.is_manual_character:
            return False  # Already calculated
        
        if not self.manual_base_stats or not self.manual_current_stats:
            return False  # No manual data to convert
        
        # Archive manual creation data
        self.creation_history = {
            "original_creation_method": "manual_reverse_engineered",
            "original_base_stats": self.manual_base_stats.copy(),
            "original_current_stats": self.manual_current_stats.copy(),
            "converted_at": datetime.datetime.now().isoformat(),
            "conversion_reason": "passed_validation"
        }
        
        # Convert to calculated character
        self.is_manual_character = False
        self.manual_base_stats = None
        self.manual_current_stats = None
        
        return True
    
    def get_creation_info(self) -> Dict[str, Any]:
        """Get information about how this character was created."""
        character_type = self.data_manager.get_meta("Character Type", "character")
        
        if self.creation_history:
            return {
                "current_type": f"calculated {character_type} (converted)",
                "original_type": self.creation_history["original_creation_method"],
                "converted_at": self.creation_history["converted_at"],
                "conversion_reason": self.creation_history["conversion_reason"]
            }
        elif self.is_manual_character:
            if self.manual_base_stats and self.manual_current_stats:
                return {"current_type": f"manual {character_type} (reverse-engineered)", "validated": self.validation_status}
            else:
                return {"current_type": f"manual {character_type} (custom)", "validated": self.validation_status}
        else:
            return {"current_type": f"calculated {character_type}", "validated": self.validation_status}
    
    def __str__(self) -> str:
        """String representation of character."""
        meta = self.data_manager.get_all_meta()
        stats = self.data_manager.get_all_stats()
        modifiers = self.data_manager.get_all_modifiers()
        
        # Format meta info
        meta_str = ", ".join(f"{key}: {value}" for key, value in meta.items())
        
        # Format stats
        stats_str = []
        for stat in STATS:
            sources = self.data_manager.get_stat_sources(stat)
            current = stats[stat]
            modifier = modifiers[stat]
            
            if len(sources) > 1:
                source_str = " (" + " + ".join(f"{source}: {value}" for source, value in sources.items() if source != StatSource.BASE and value != 0) + ")"
                stats_str.append(f"{stat}: {sources.get(StatSource.BASE, 0)}{source_str} = {current} (modifier: {modifier})")
            else:
                stats_str.append(f"{stat}: {current} (modifier: {modifier})")

        stats_display = ", ".join(stats_str)
        
        # ENHANCED: Format free points info with status indication
        free_points = self.level_system.free_points
        if free_points > 0:
            free_points_str = f"\nFree points: {free_points} available"
        elif free_points == 0:
            free_points_str = f"\nFree points: 0 (none available)"
        else:
            free_points_str = f"\nFree points: {free_points} (overspent - negative balance)"
        
        # Format blessing info
        blessing_str = ""
        if hasattr(self, 'blessing') and self.blessing:
            blessing_details = ", ".join(f"{stat}: +{value}" for stat, value in self.blessing.items())
            blessing_str = f"\nBlessing: {blessing_details}"
        
        return (
            f"Character: {self.name}\n"
            f"Info: {meta_str}\n"
            f"Stats: {stats_display}\n"
            f"Health: {self.health_manager.current_health}/{self.health_manager.max_health}"
            f"{free_points_str}"
            f"{blessing_str}\n"
            f"Inventory: {self.inventory}"
        )

class ItemRepository:
    """Repository of all available items"""
    
    def __init__(self, items_data: Dict = None):
        self.items = items_data or {}
    
    def get_item(self, item_name: str) -> Optional[Dict]:
        """Get item data by name"""
        return self.items.get(item_name.lower())
    
    def add_item(self, name: str, description: str, stats: Dict[str, int]) -> None:
        """Add a new item to the repository"""
        self.items[name.lower()] = {
            "description": description,
            "stats": stats
        }
    
    def remove_item(self, item_name: str) -> bool:
        """Remove an item from the repository"""
        if item_name.lower() in self.items:
            del self.items[item_name.lower()]
            return True
        return False
    
    def save_to_json(self, filename: str) -> bool:
        """Save item repository to JSON file"""
        try:
            with open(filename, 'w') as f:
                json.dump(self.items, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving items: {e}")
            return False
    
    @classmethod
    def load_from_json(cls, filename: str):
        """Load item repository from JSON file"""
        try:
            with open(filename, 'r') as f:
                items_data = json.load(f)
            return cls(items_data)
        except Exception as e:
            print(f"Error loading items: {e}")
            return cls()
    
    def list_items(self) -> List[str]:
        """Get list of all item names"""
        return list(self.items.keys())
    
    def __str__(self) -> str:
        """String representation of item repository"""
        if not self.items:
            return "No items available"
        
        result = []
        for name, data in self.items.items():
            stats_str = ", ".join(f"{stat}: +{val}" for stat, val in data["stats"].items()) if data["stats"] else "No stats"
            result.append(f"{name.title()}: {data['description']} ({stats_str})")
        
        return "\n".join(result)