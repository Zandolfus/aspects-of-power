"""
Character Migration Script for Character_Creator4
Migrates characters from old CSV format to new system with history support.

COMPREHENSIVE MIGRATION FEATURES:
• Supports familiars and monsters that only use race levels
• Preserves stat source tracking (class/profession/race/item/blessing/free_points bonuses)
• Handles manual vs calculated character detection and preservation
• Supports reverse-engineered characters with base stats and current stats
• Maintains free points allocation and tracking
• Smart character type detection (single prompt only when race is 'monster' and ambiguous)
• Preserves validation status and creation history
• Uses proper Character_Creator4 history format (from_level/to_level, from_race_level/to_race_level)
• Works backwards from current class/profession for intelligent history creation
• Full compatibility with all Character_Creator4 character types and creation methods
"""

import csv
import os
import json
from typing import Dict, List, Optional, Any, Tuple
from Character_Creator import Character, ItemRepository, STATS, META_INFO, StatValidator
from tier_utils import (
    get_tier_for_level, get_available_classes_for_tier, get_available_professions_for_tier,
    validate_class_tier_combination, validate_profession_tier_combination
)
from game_data import DEFAULT_TIER_THRESHOLDS, races
from Item_Repo import items

def clear_screen():
    """Clear the terminal screen."""
    os.system('cls' if os.name == 'nt' else 'clear')

def print_colored(text: str, color: str = 'white', bold: bool = False):
    """Print colored text using ANSI escape codes."""
    colors = {
        'black': '30', 'red': '31', 'green': '32', 'yellow': '33',
        'blue': '34', 'magenta': '35', 'cyan': '36', 'white': '37'
    }
    
    bold_code = '1;' if bold else ''
    color_code = colors.get(color.lower(), '37')
    
    print(f"\033[{bold_code}{color_code}m{text}\033[0m")

def print_header(text: str):
    """Print a formatted header."""
    width = 80
    print()
    print_colored("=" * width, 'cyan', True)
    print_colored(text.center(width), 'cyan', True)
    print_colored("=" * width, 'cyan', True)
    print()

def print_subheader(text: str):
    """Print a formatted subheader."""
    width = 80
    print()
    print_colored("-" * width, 'green')
    print_colored(text.center(width), 'green', True)
    print_colored("-" * width, 'green')

def print_success(text: str):
    """Print a success message."""
    print_colored(f"✓ {text}", 'green')

def print_error(text: str):
    """Print an error message."""
    print_colored(f"✗ {text}", 'red')

def print_warning(text: str):
    """Print a warning message."""
    print_colored(f"⚠ {text}", 'yellow')

def print_info(text: str):
    """Print an informational message."""
    print_colored(f"ℹ {text}", 'blue')

def confirm_action(prompt: str = "Are you sure?") -> bool:
    """Prompt the user to confirm an action."""
    response = input(f"{prompt} (y/n): ").strip().lower()
    return response in ('y', 'yes')

def detect_csv_format(filename: str) -> Dict[str, Any]:
    """
    Detect the format of the CSV file and determine what migration is needed.
    
    Returns:
        Dict with format information and migration requirements
    """
    format_info = {
        "has_history_fields": False,
        "has_tier_thresholds": False,
        "has_validation_fields": False,
        "has_character_type": False,
        "fieldnames": [],
        "sample_rows": [],
        "migration_type": "unknown"
    }
    
    try:
        with open(filename, 'r', newline='', encoding='utf-8-sig') as file:
            reader = csv.DictReader(file)
            format_info["fieldnames"] = reader.fieldnames or []
            
            # Read a few sample rows
            for i, row in enumerate(reader):
                if i < 3:  # Get up to 3 sample rows
                    format_info["sample_rows"].append(row)
                else:
                    break
        
        fieldnames = format_info["fieldnames"]
        
        # Check for new system fields
        history_fields = ["class_history", "profession_history", "race_history"]
        format_info["has_history_fields"] = any(field in fieldnames for field in history_fields)
        
        format_info["has_tier_thresholds"] = "tier_thresholds" in fieldnames
        format_info["has_character_type"] = "Character Type" in fieldnames
        
        validation_fields = ["is_manual_character", "validation_status", "creation_history"]
        format_info["has_validation_fields"] = any(field in fieldnames for field in validation_fields)
        
        # Determine migration type
        if format_info["has_history_fields"] and format_info["has_tier_thresholds"]:
            format_info["migration_type"] = "new_system"  # Already new format
        elif all(field in fieldnames for field in META_INFO + STATS):
            format_info["migration_type"] = "old_system"  # Old format, needs migration
        else:
            format_info["migration_type"] = "custom"  # Custom format, needs manual mapping
            
    except Exception as e:
        print_error(f"Error analyzing CSV format: {e}")
        format_info["migration_type"] = "error"
    
    return format_info

def get_character_type_from_user(row: Dict[str, str], character_name: str, auto_process: bool = False) -> str:
    """
    Determine character type. Only ask user if there's no Character Type field
    and the race is 'monster' (which could be ambiguous).
    Returns: 'familiar', 'monster', or 'character'
    """
    # Check explicit character type field first
    char_type = row.get("Character Type", "").strip().lower()
    if char_type in ["familiar", "monster", "character"]:
        return char_type
    
    # Check if race is 'monster' - only then do we need to ask
    race_name = row.get("Race", "").strip().lower()
    if race_name == "monster":
        # If auto-processing, default to monster
        if auto_process:
            return "monster"
        
        # Ask the user since 'monster' race could be either a monster or familiar
        class_level = int(row.get("Class level", "0") or "0")
        profession_level = int(row.get("Profession level", "0") or "0")
        race_level = int(row.get("Race level", "0") or "0")
        
        print(f"\nAmbiguous Character Type for {character_name} (Race: {race_name}):")
        print(f"  Class Level: {class_level}")
        print(f"  Profession Level: {profession_level}")
        print(f"  Race Level: {race_level}")
        print("\nSince the race is 'monster', this could be:")
        print("  1. Regular Character (uses class/profession/race levels)")
        print("  2. Familiar (only uses race levels)")
        print("  3. Monster (only uses race levels)")
        
        while True:
            choice = input("What type of character is this? (1/2/3): ").strip()
            if choice == "1":
                return "character"
            elif choice == "2":
                return "familiar"
            elif choice == "3":
                return "monster"
            else:
                print_error("Please enter 1, 2, or 3")
    
    # Default to regular character for all other cases
    return "character"

def create_history_for_character(name: str, class_name: str, class_level: int, 
                                profession_name: str, profession_level: int,
                                race_name: str, race_level: int,
                                tier_thresholds: List[int],
                                prompt_user: bool = True,
                                character_type: str = "character") -> Dict[str, List]:
    """
    Create class, profession, and race history for a character.
    Updated to handle familiars and monsters that only use race levels.
    Uses correct Character_Creator4 format: from_level/to_level for class/profession,
    from_race_level/to_race_level for race.
    
    Returns:
        Dict with 'class_history', 'profession_history', and 'race_history' lists
    """
    # For familiars and monsters, only create race history
    if character_type in ["familiar", "monster"]:
        race_history = []
        if race_level > 0:
            race_history = [{
                "race": race_name,
                "from_race_level": 1,
                "to_race_level": None  # Current race, goes to end
            }]
        
        return {
            "class_history": [],
            "profession_history": [],
            "race_history": race_history
        }
    
    # Original logic for regular characters
    histories = {
        "class_history": [],
        "profession_history": [],
        "race_history": []
    }
    
    # Original logic for class/profession history
    
    # Create class history
    if class_level > 0 and class_name:
        if prompt_user and class_level > 1 and character_type == "character":
            max_tier = get_tier_for_level(class_level, tier_thresholds)
            if max_tier > 1:
                print_subheader(f"Class History for {name}")
                print(f"Character class level {class_level} spans {max_tier} tier(s)")
                print(f"Current class: {class_name}")
                
                # Automatically prompt for detailed history (no confirmation)
                histories["class_history"] = create_detailed_class_history(
                    class_name, class_level, tier_thresholds
                )
            else:
                # Single tier
                histories["class_history"] = [{
                    "class": class_name,
                    "from_level": 1,
                    "to_level": None
                }]
        else:
            # No prompting or level 1 - simple history
            histories["class_history"] = [{
                "class": class_name,
                "from_level": 1,
                "to_level": None
            }]
    
    # Create profession history
    if profession_level > 0 and profession_name:
        if prompt_user and profession_level > 1 and character_type == "character":
            max_tier = get_tier_for_level(profession_level, tier_thresholds)
            if max_tier > 1:
                print_subheader(f"Profession History for {name}")
                print(f"Character profession level {profession_level} spans {max_tier} tier(s)")
                print(f"Current profession: {profession_name}")
                
                # Automatically prompt for detailed history (no confirmation)
                histories["profession_history"] = create_detailed_profession_history(
                    profession_name, profession_level, tier_thresholds
                )
            else:
                # Single tier
                histories["profession_history"] = [{
                    "profession": profession_name,
                    "from_level": 1,
                    "to_level": None
                }]
        else:
            # No prompting or level 1 - simple history
            histories["profession_history"] = [{
                "profession": profession_name,
                "from_level": 1,
                "to_level": None
            }]
    
    # Create race history (always simple for now)
    if race_level > 0:
        if prompt_user and race_level > 5 and character_type == "character":  # Only prompt for higher race levels on regular characters
            print_subheader(f"Race History for {name}")
            print(f"Character race level: {race_level}")
            print(f"Current race: {race_name}")
            
            if confirm_action("Has this character changed races during progression?"):
                histories["race_history"] = create_detailed_race_history(
                    race_name, race_level
                )
            else:
                # Simple history - same race for all levels
                histories["race_history"] = [{
                    "race": race_name,
                    "from_race_level": 1,
                    "to_race_level": None  # Current race, goes to end
                }]
        else:
            # No prompting or low level - simple history
            histories["race_history"] = [{
                "race": race_name,
                "from_race_level": 1,
                "to_race_level": None  # Current race, goes to end
            }]
    
    return histories

def create_detailed_history(category: str, total_level: int, current_name: str, 
                          tier_thresholds: List[int], get_available_func) -> List[Dict]:
    """
    Create detailed history for a category (class or profession).
    Works backwards from highest tier, using current class/profession automatically.
    """
    history = []
    current_level = 1
    
    # Determine all tier ranges first
    tier_ranges = []
    while current_level <= total_level:
        current_tier = get_tier_for_level(current_level, tier_thresholds)
        
        # Find the maximum level for this tier
        next_tier_threshold = None
        for threshold in tier_thresholds:
            if threshold > current_level:
                next_tier_threshold = threshold
                break
        
        max_level_in_tier = min(total_level, next_tier_threshold - 1 if next_tier_threshold else total_level)
        
        tier_ranges.append({
            "tier": current_tier,
            "start_level": current_level,
            "end_level": max_level_in_tier,
            "level_count": max_level_in_tier - current_level + 1
        })
        
        current_level = max_level_in_tier + 1
    
    # If only one tier, use current class/profession for everything
    if len(tier_ranges) == 1:
        tier_range = tier_ranges[0]
        history.append({
            category: current_name,
            "from_level": tier_range["start_level"],
            "to_level": None  # Single entry goes to end
        })
        return history

def create_detailed_race_history(current_race: str, race_level: int) -> List[Dict]:
    """Create detailed race history with race changes."""
    race_history = []
    available_races = list(races.keys())
    
    print("Available races:")
    for i, race in enumerate(available_races, 1):
        print(f"  {i}. {race}")
    
    race_level_start = 1
    while race_level_start <= race_level:
        print(f"\nRace from race level {race_level_start} to level ?")
        
        # Get race for this period
        while True:
            choice = input("Enter race (number or name): ").strip()
            
            # Try to parse as number first
            try:
                race_num = int(choice)
                if 1 <= race_num <= len(available_races):
                    period_race = available_races[race_num - 1]
                    break
                else:
                    print_error(f"Please enter a number between 1 and {len(available_races)}")
                    continue
            except ValueError:
                # Try to match by name
                period_race = choice.lower()
                if period_race in available_races:
                    break
                else:
                    print_error(f"Invalid race: {choice}")
                    continue
        
        # Get end level for this race (if not the last period)
        if race_level_start < race_level:
            while True:
                try:
                    end_input = input(f"Race {period_race} ends at race level (max {race_level}): ").strip()
                    race_level_end = int(end_input)
                    
                    if race_level_end < race_level_start:
                        print_error("End level must be >= start level.")
                        continue
                    elif race_level_end > race_level:
                        print_error(f"End level cannot exceed {race_level}.")
                        continue
                    
                    break
                except ValueError:
                    print_error("Please enter a valid integer.")
        else:
            race_level_end = None  # Current race
        
        # Add race history entry
        race_history.append({
            "race": period_race,
            "from_race_level": race_level_start,
            "to_race_level": race_level_end
        })
        
        if race_level_end is None:
            break
        else:
            race_level_start = race_level_end + 1
    
    return race_history

def create_detailed_class_history(current_class: str, class_level: int, 
                                 tier_thresholds: List[int]) -> List[Dict]:
    """Create detailed class history with tier changes."""
    class_history = []
    max_tier = get_tier_for_level(class_level, tier_thresholds)
    
    level_start = 1
    for tier in range(1, max_tier + 1):
        # Calculate level range for this tier
        if tier == 1:
            level_end = tier_thresholds[0] - 1 if tier_thresholds else class_level
        elif tier - 1 < len(tier_thresholds):
            level_end = min(tier_thresholds[tier - 1] - 1, class_level) if tier < len(tier_thresholds) + 1 else class_level
        else:
            level_end = class_level
        
        # Get available classes for this tier
        available_classes = get_available_classes_for_tier(tier)
        if not available_classes:
            print_error(f"No classes available for tier {tier}!")
            continue
        
        print(f"\nTier {tier} (levels {level_start}-{min(level_end, class_level)}):")
        print("Available classes:")
        for i, class_name in enumerate(available_classes, 1):
            print(f"  {i}. {class_name}")
        
        if tier == max_tier:
            tier_class = current_class
            print(f"Using current class: {tier_class}")
        else:
            while True:
                choice = input(f"Enter tier {tier} class (number or name): ").strip()
                
                # Try to parse as number first
                try:
                    choice_num = int(choice)
                    if 1 <= choice_num <= len(available_classes):
                        tier_class = available_classes[choice_num - 1]
                        break
                    else:
                        print_error(f"Please enter a number between 1 and {len(available_classes)}")
                        continue
                except ValueError:
                    # Try to match by name
                    tier_class = choice.lower()
                    if validate_class_tier_combination(tier_class, tier):
                        break
                    else:
                        print_error(f"Invalid tier {tier} class: {choice}")
                        continue
        
        class_history.append({
            "class": tier_class,
            "from_level": level_start,
            "to_level": min(level_end, class_level) if tier < max_tier else None
        })
        
        level_start = level_end + 1
    
    return class_history

def create_detailed_profession_history(current_profession: str, profession_level: int,
                                     tier_thresholds: List[int]) -> List[Dict]:
    """Create detailed profession history with tier changes."""
    profession_history = []
    max_tier = get_tier_for_level(profession_level, tier_thresholds)
    
    level_start = 1
    for tier in range(1, max_tier + 1):
        # Calculate level range for this tier
        if tier == 1:
            level_end = tier_thresholds[0] - 1 if tier_thresholds else profession_level
        elif tier - 1 < len(tier_thresholds):
            level_end = min(tier_thresholds[tier - 1] - 1, profession_level) if tier < len(tier_thresholds) + 1 else profession_level
        else:
            level_end = profession_level
        
        # Get available professions for this tier
        available_professions = get_available_professions_for_tier(tier)
        if not available_professions:
            print_error(f"No professions available for tier {tier}!")
            continue
        
        print(f"\nTier {tier} (levels {level_start}-{min(level_end, profession_level)}):")
        print("Available professions:")
        for i, profession_name in enumerate(available_professions, 1):
            print(f"  {i}. {profession_name}")
        
        if tier == max_tier:
            tier_profession = current_profession
            print(f"Using current profession: {tier_profession}")
        else:
            while True:
                choice = input(f"Enter tier {tier} profession (number or name): ").strip()
                
                # Try to parse as number first
                try:
                    choice_num = int(choice)
                    if 1 <= choice_num <= len(available_professions):
                        tier_profession = available_professions[choice_num - 1]
                        break
                    else:
                        print_error(f"Please enter a number between 1 and {len(available_professions)}")
                        continue
                except ValueError:
                    # Try to match by name
                    tier_profession = choice.lower()
                    if validate_profession_tier_combination(tier_profession, tier):
                        break
                    else:
                        print_error(f"Invalid tier {tier} profession: {choice}")
                        continue
        
        profession_history.append({
            "profession": tier_profession,
            "from_level": level_start,
            "to_level": min(level_end, profession_level) if tier < max_tier else None
        })
        
        level_start = level_end + 1
    
    return profession_history

def show_detailed_validation(character, validation_result):
    """
    Enhanced detailed validation display that handles all character types.
    Preserves all original detailed analysis for regular characters and adds race-leveling support.
    """
    print_subheader(f"Detailed Validation for {character.name}")
    
    char_type = character.data_manager.get_meta("Character Type", "character")
    validation_type = validation_result.get('validation_type', 'unknown')
    
    # Show overall validation status
    print(f"Character Type: {char_type}")
    print(f"Validation Type: {validation_type}")
    print(f"Overall Summary: {validation_result.get('overall_summary', 'No summary available')}")
    print()
    
    # Handle race-leveling characters (familiars/monsters) - NEW SECTION
    if validation_type == "race_leveling":
        print_colored("Race-Leveling Character Validation Details:", 'cyan', True)
        
        # Show basic character info
        race_level = character.data_manager.get_meta("Race level", "0")
        race = character.data_manager.get_meta("Race", "")
        print(f"Race: {race}")
        print(f"Race Level: {race_level}")
        print()
        
        # Show any class/profession level issues
        class_level = int(character.data_manager.get_meta("Class level", "0"))
        profession_level = int(character.data_manager.get_meta("Profession level", "0"))
        
        if class_level > 0:
            print_error(f"⚠ INVALID: {char_type.capitalize()}s should not have class levels (found: {class_level})")
        if profession_level > 0:
            print_error(f"⚠ INVALID: {char_type.capitalize()}s should not have profession levels (found: {profession_level})")
        
        # Show stat validation for race-leveling characters
        if validation_result.get("stat_discrepancies"):
            print_colored("Stat Issues:", 'red', True)
            for stat, issue in validation_result["stat_discrepancies"].items():
                if isinstance(issue, dict):
                    if "status" in issue:
                        status = issue["status"]
                        diff = issue.get("difference", 0)
                        print_error(f"  • {stat}: {status} by {abs(diff)} points")
                    else:
                        print_error(f"  • {stat}: {issue}")
                else:
                    print_error(f"  • {stat}: {issue}")
        
        # Show detailed stat allocation analysis for race-leveling characters
        if validation_result.get("details") and "stat_allocations" in validation_result["details"]:
            print_colored("Detailed Stat Allocation Analysis:", 'cyan', True)
            analysis = validation_result["details"]
            
            for stat in STATS:
                if stat in analysis["stat_allocations"]:
                    stat_analysis = analysis["stat_allocations"][stat]
                    base = stat_analysis.get("base", 0)
                    race_bonus = stat_analysis.get("race_bonus", 0)
                    item_bonus = stat_analysis.get("item_bonus", 0)
                    blessing_bonus = stat_analysis.get("blessing_bonus", 0)
                    free_points_used = stat_analysis.get("free_points_allocated", 0)
                    current = stat_analysis.get("current", 0)
                    discrepancy = stat_analysis.get("discrepancy", 0)
                    
                    # Build breakdown string for race-leveling characters
                    parts = [f"Base: {base}"]
                    if race_bonus > 0:
                        parts.append(f"Race: +{race_bonus}")
                    if item_bonus > 0:
                        parts.append(f"Items: +{item_bonus}")
                    if blessing_bonus > 0:
                        parts.append(f"Blessing: +{blessing_bonus}")
                    if free_points_used > 0:
                        parts.append(f"Free Points: +{free_points_used}")
                    
                    breakdown = " + ".join(parts)
                    print(f"{stat.capitalize()}: {breakdown} = {current}")
                    
                    # Show issues
                    if discrepancy < 0:
                        print_error(f"  ⚠ IMPOSSIBLE: {stat} needs {abs(discrepancy)} more points than available!")
                    elif discrepancy > 0:
                        print_warning(f"  ⚠ EXTRA: {stat} has {discrepancy} unexplained points")
        
        # Show free points info for race-leveling characters
        fp_info = validation_result.get("free_points", {})
        if fp_info:
            print()
            print_colored("Free Points Analysis:", 'yellow', True)
            expected = fp_info.get('expected_total', 0)
            spent = fp_info.get('spent', 0)
            current = fp_info.get('current', 0)
            difference = fp_info.get('difference', 0)
            
            print(f"Expected from race levels: {expected}")
            print(f"Used in stat allocation: {spent}")
            print(f"Remaining: {current}")
            print(f"Balance: {expected} - {spent} - {current} = {difference}")
            
            if difference > 0:
                print_error(f"⚠ MISSING: {char_type.capitalize()} is missing {difference} free points")
            else:
                print_error(f"⚠ EXCESS: {char_type.capitalize()} has {abs(difference)} excess free points")
        
        # Show current stat sources for race-leveling characters
        print()
        print_colored("Current Stat Sources:", 'cyan', True)
        for stat in STATS:
            sources = character.data_manager.get_stat_sources(stat)
            current = character.data_manager.get_stat(stat)
            
            # Build breakdown string
            source_parts = []
            for source, value in sources.items():
                if value > 0:
                    source_parts.append(f"{source}: {value}")
            
            if source_parts:
                source_str = " (" + " + ".join(source_parts) + ")"
                print(f"{stat.capitalize()}: {current}{source_str}")
            else:
                print(f"{stat.capitalize()}: {current}")
    
    # Handle regular characters (calculated, manual, reverse_engineered) - ORIGINAL DETAILED LOGIC
    else:
        # ORIGINAL: Show detailed stat breakdown if available
        if validation_result.get("details") and "stat_allocations" in validation_result["details"]:
            print_colored("Detailed Stat Allocation Analysis:", 'cyan', True)
            analysis = validation_result["details"]
            
            for stat in STATS:
                if stat in analysis["stat_allocations"]:
                    stat_analysis = analysis["stat_allocations"][stat]
                    base = stat_analysis.get("base", 0)
                    class_bonus = stat_analysis.get("class_bonus", 0)
                    profession_bonus = stat_analysis.get("profession_bonus", 0)
                    race_bonus = stat_analysis.get("race_bonus", 0)
                    free_points_used = stat_analysis.get("free_points_allocated", 0)
                    current = stat_analysis.get("current", 0)
                    discrepancy = stat_analysis.get("discrepancy", 0)
                    
                    # Build breakdown string
                    parts = [f"Base: {base}"]
                    if class_bonus > 0:
                        parts.append(f"Class: +{class_bonus}")
                    if profession_bonus > 0:
                        parts.append(f"Profession: +{profession_bonus}")
                    if race_bonus > 0:
                        parts.append(f"Race: +{race_bonus}")
                    if free_points_used > 0:
                        parts.append(f"Free Points: +{free_points_used}")
                    
                    breakdown = " + ".join(parts)
                    print(f"{stat.capitalize()}: {breakdown} = {current}")
                    
                    # Show issues
                    if discrepancy < 0:
                        print_error(f"  ⚠ IMPOSSIBLE: {stat} needs {abs(discrepancy)} more points than available!")
                    elif discrepancy > 0:
                        print_warning(f"  ⚠ UNUSED: {stat} has {discrepancy} excess points")
        
        # ORIGINAL: Show free points summary
        print()
        print_colored("Free Points Summary:", 'cyan', True)
        if validation_result.get("details"):
            analysis = validation_result["details"]
            total_expected = analysis.get("total_expected_free_points", 0)
            total_used = analysis.get("total_free_points_used", 0)
            remaining = analysis.get("remaining_free_points", 0)
            print(f"Total Expected: {total_expected}")
            print(f"Used in Allocation: {total_used}")
            print(f"Calculated Remaining: {remaining}")
            
            if remaining < 0:
                print_error(f"Character has {abs(remaining)} excess free points")
            else:
                print_error(f"Character is missing {remaining} free points")
        else:
            # Fallback if no detailed analysis available
            fp_info = validation_result.get("free_points", {})
            for key, value in fp_info.items():
                print(f"{key.replace('_', ' ').title()}: {value}")
        
        # ORIGINAL: Show current stat sources
        print()
        print_colored("Current Stat Sources:", 'cyan', True)
        for stat in STATS:
            sources = character.data_manager.get_stat_sources(stat)
            current = character.data_manager.get_stat(stat)
            
            # Build breakdown string
            source_parts = []
            for source, value in sources.items():
                if value > 0:
                    source_parts.append(f"{source}: {value}")
            
            if source_parts:
                source_str = " (" + " + ".join(source_parts) + ")"
                print(f"{stat.capitalize()}: {current}{source_str}")
            else:
                print(f"{stat.capitalize()}: {current}")
    
    print()
    input("Press Enter to continue...")

def migrate_character_row(row: Dict[str, str], tier_thresholds: List[int], 
                         prompt_for_history: bool, item_repository, auto_process: bool = False, 
                         character_type: str = "character") -> Tuple[Optional[Character], str]:
    """
    Migrate a single character row from old format to new system.
    Character type is now determined before calling this function.
    
    Args:
        row: CSV row data
        tier_thresholds: Tier threshold levels
        prompt_for_history: Whether to prompt for detailed history
        item_repository: Item repository instance
        auto_process: Whether to auto-process (defaults ambiguous monster races to 'monster')
        character_type: Character type (already determined)
        
    Returns:
        Tuple of (Character instance or None if migration failed, character_type)
    """
    try:
        name = row.get("Name", "").strip()
        if not name:
            print_error("No character name found")
            return None, "unknown"
        
        # Use the character type that was already determined (shown in main loop)
        
        # Extract stats and determine character type
        stats = {}
        for stat in STATS:
            stats[stat] = int(row.get(stat, "0") or "0")
        
        # Check if this is a manual character (has manual character data or stat sources)
        is_manual = row.get("is_manual_character", "").strip().lower() == "true"
        has_stat_sources = any(f"{stat}_{source}" in row for stat in STATS for source in ["class", "profession", "race", "item", "blessing", "free_points"])
        has_base_stats = any(f"{stat}_base" in row for stat in STATS)
        
        # Extract free points
        free_points = int(row.get("Free points", "0") or "0")
        
        # Extract basic character data
        race = row.get("Race", "").strip()
        race_level = int(row.get("Race level", "0") or "0")
        
        # Extract class/profession data (may be 0 for familiars/monsters)
        class_name = row.get("Class", "").strip()
        class_level = int(row.get("Class level", "0") or "0")
        profession_name = row.get("Profession", "").strip()
        profession_level = int(row.get("Profession level", "0") or "0")
        
        # Create histories
        histories = create_history_for_character(
            name, class_name, class_level, profession_name, profession_level,
            race, race_level, tier_thresholds, prompt_for_history, character_type
        )
        
        # Create character based on type and available data
        if character_type == "familiar":
            print_info(f"Creating familiar: {name}")
            
            # Handle familiars like regular characters to preserve exact stats
            current_stats = stats  # These are the current stats we want to preserve
            
            # Determine base stats for familiars
            if has_base_stats:
                # Use explicit base stats if available
                base_stats = {}
                for stat in STATS:
                    base_key = f"{stat}_base"
                    base_stats[stat] = int(row.get(base_key, "5") or "5")
                print_info("Using explicit base stats from CSV")
            else:
                # Default to standard base stats since we don't have them
                base_stats = {stat: 5 for stat in STATS}
                print_info("No base stats found - using default base stats of 5")
                print_warning("Familiar will be reverse-engineered to preserve current stats")
            
            # Create meta for familiar
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
            
            # Use reverse engineering to preserve the familiar's exact current stats
            character = Character.create_reverse_engineered(
                name=name,
                base_stats=base_stats,
                current_stats=current_stats,
                meta=meta,
                free_points=free_points,
                tier_thresholds=tier_thresholds,
                class_history=[],  # Familiars have no class history
                profession_history=[],  # Familiars have no profession history
                race_history=histories["race_history"],
                item_repository=item_repository
            )
            
            character.level_system._update_race_rank(race_level)
            
        elif character_type == "monster":
            print_info(f"Creating monster: {name}")
            
            # Handle monsters like regular characters to preserve exact stats
            current_stats = stats  # These are the current stats we want to preserve
            
            # Determine base stats for monsters
            if has_base_stats:
                # Use explicit base stats if available
                base_stats = {}
                for stat in STATS:
                    base_key = f"{stat}_base"
                    base_stats[stat] = int(row.get(base_key, "5") or "5")
                print_info("Using explicit base stats from CSV")
            else:
                # Default to standard base stats since we don't have them
                base_stats = {stat: 5 for stat in STATS}
                print_info("No base stats found - using default base stats of 5")
                print_warning("Monster will be reverse-engineered to preserve current stats")
            
            # Create meta for monster
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
            
            # Use reverse engineering to preserve the monster's exact current stats
            character = Character.create_reverse_engineered(
                name=name,
                base_stats=base_stats,
                current_stats=current_stats,
                meta=meta,
                free_points=free_points,
                tier_thresholds=tier_thresholds,
                class_history=[],  # Monsters have no class history
                profession_history=[],  # Monsters have no profession history
                race_history=histories["race_history"],
                item_repository=item_repository
            )
            
            character.level_system._update_race_rank(race_level)
            
        else:
            # Regular character - use reverse engineering by default to preserve original stats
            print_info(f"Creating character: {name}")
            
            # Use current stats as the target (what we want to preserve)
            current_stats = stats
            
            # Determine base stats
            if has_base_stats:
                # Use explicit base stats if available
                base_stats = {}
                for stat in STATS:
                    base_key = f"{stat}_base"
                    base_stats[stat] = int(row.get(base_key, "5") or "5")
            else:
                # Default to standard base stats if not provided
                base_stats = {stat: 5 for stat in STATS}
                print_info("No explicit base stats found - using default base stats of 5")
            
            meta = {
                "Character Type": "character",
                "Race": race,
                "Race level": str(race_level),
                "Class": class_name,
                "Class level": str(class_level),
                "Profession": profession_name,
                "Profession level": str(profession_level),
                "Race rank": row.get("Race rank", "")
            }
            
            # Use reverse engineering to preserve original stat allocation
            if is_manual:
                # For explicit manual characters, use manual creation if we have the right data
                if "manual_current_stats" in row:
                    try:
                        manual_current_stats = json.loads(row["manual_current_stats"])
                        character = Character.create_reverse_engineered(
                            name=name,
                            base_stats=base_stats,
                            current_stats=manual_current_stats,
                            meta=meta,
                            free_points=free_points,
                            tier_thresholds=tier_thresholds,
                            class_history=histories["class_history"],
                            profession_history=histories["profession_history"],
                            race_history=histories["race_history"],
                            item_repository=item_repository
                        )
                    except (json.JSONDecodeError, KeyError):
                        # Fall back to standard reverse engineering
                        character = Character.create_reverse_engineered(
                            name=name,
                            base_stats=base_stats,
                            current_stats=current_stats,
                            meta=meta,
                            free_points=free_points,
                            tier_thresholds=tier_thresholds,
                            class_history=histories["class_history"],
                            profession_history=histories["profession_history"],
                            race_history=histories["race_history"],
                            item_repository=item_repository
                        )
                else:
                    # Standard reverse engineering for manual characters
                    character = Character.create_reverse_engineered(
                        name=name,
                        base_stats=base_stats,
                        current_stats=current_stats,
                        meta=meta,
                        free_points=free_points,
                        tier_thresholds=tier_thresholds,
                        class_history=histories["class_history"],
                        profession_history=histories["profession_history"],
                        race_history=histories["race_history"],
                        item_repository=item_repository
                    )
            else:
                # Use reverse engineering to preserve original stat allocation
                character = Character.create_reverse_engineered(
                    name=name,
                    base_stats=base_stats,
                    current_stats=current_stats,
                    meta=meta,
                    free_points=free_points,
                    tier_thresholds=tier_thresholds,
                    class_history=histories["class_history"],
                    profession_history=histories["profession_history"],
                    race_history=histories["race_history"],
                    item_repository=item_repository
                )
        
        # Reverse engineering automatically handles stat source allocation, so no need for manual application
        
        # Preserve validation status if available
        if "validation_status" in row:
            character.validation_status = row["validation_status"]
        
        # Preserve creation history if available
        if "creation_history" in row and row["creation_history"]:
            try:
                character.creation_history = json.loads(row["creation_history"])
            except json.JSONDecodeError:
                pass
        
        print_success(f"Successfully migrated {name} ({character_type})")
        return character, character_type
        
    except Exception as e:
        print_error(f"Error migrating character {name}: {e}")
        return None, "unknown"

def migrate_characters_csv(input_file: str, output_file: str = None):
    """
    Main migration function to convert characters from old format to new system.
    Updated for Character_Creator4 with familiar/monster support.
    
    Args:
        input_file: Path to input CSV file
        output_file: Path to output CSV file (defaults to input_file with _migrated suffix)
    """
    clear_screen()
    print_header("Character Migration Tool v4")
    print_info("Updated for Character_Creator4 with familiar and monster support")
    
    # Check if input file exists
    if not os.path.exists(input_file):
        print_error(f"Input file {input_file} does not exist.")
        return
    
    # Set up output file
    if not output_file:
        base_name = os.path.splitext(input_file)[0]
        output_file = f"{base_name}_migrated_v4.csv"
    
    # Initialize item repository
    try:
        item_repository = ItemRepository(items)
    except Exception as e:
        print_warning(f"Error initializing item repository: {e}")
        item_repository = ItemRepository({})
    
    # Analyze input file format
    print_info("Analyzing input file format...")
    format_info = detect_csv_format(input_file)
    
    print_subheader("File Format Analysis")
    print(f"Migration type: {format_info['migration_type']}")
    print(f"Has history fields: {format_info['has_history_fields']}")
    print(f"Has tier thresholds: {format_info['has_tier_thresholds']}")
    print(f"Has validation fields: {format_info['has_validation_fields']}")
    print(f"Has character type field: {format_info['has_character_type']}")
    
    if format_info['migration_type'] == "new_system":
        print_info("File is already in new system format. No migration needed.")
        return
    elif format_info['migration_type'] == "error":
        print_error("Could not analyze file format.")
        return
    elif format_info['migration_type'] == "custom":
        print_warning("Custom format detected. Manual field mapping may be required.")
        print("Available fields:", ", ".join(format_info['fieldnames']))
        if not confirm_action("Continue with migration?"):
            return
    
    # Get migration settings
    print_subheader("Migration Settings")
    
    # Tier thresholds
    print_info("Tier thresholds determine when characters can access new tiers.")
    print(f"Default tier thresholds: {DEFAULT_TIER_THRESHOLDS}")
    
    if confirm_action("Use default tier thresholds for all characters?"):
        tier_thresholds = DEFAULT_TIER_THRESHOLDS.copy()
    else:
        while True:
            try:
                threshold_input = input("Enter custom tier thresholds (comma-separated): ").strip()
                tier_thresholds = [int(x.strip()) for x in threshold_input.split(',')]
                tier_thresholds = sorted(list(set(tier_thresholds)))
                break
            except ValueError:
                print_error("Please enter valid integers separated by commas.")
    
    print_success(f"Using tier thresholds: {tier_thresholds}")
    
    # History prompting (only relevant for regular characters)
    print_info("For regular characters with multiple tiers, you can specify detailed history.")
    print_info("Note: You'll only be asked about character type if race is 'monster' and no Character Type field exists.")
    print_info("Detailed history allows you to specify:")
    print_info("• Different classes/professions for different level ranges (tiers)")
    print_info("• Race changes during progression (for race level > 5)")
    print_info("Familiars and monsters only use race levels, so detailed history prompting doesn't apply to them.")
    prompt_for_history = confirm_action("Do you want to be prompted to enter detailed class/profession/race history for regular characters?")
    
    if prompt_for_history:
        print_warning("You will be prompted for each regular character that spans multiple tiers.")
        print_warning("You will also be prompted for race changes on characters with race level > 5.")
        print_info("You can choose to skip detailed history for individual characters.")
    else:
        print_info("All regular characters will use simple history (current class/profession/race for all levels).")
    
    # Start migration
    print_subheader("Starting Migration")
    
    # Count total characters for progress tracking
    try:
        with open(input_file, 'r', newline='', encoding='utf-8-sig') as file:
            reader = csv.DictReader(file)
            total_characters = sum(1 for row in reader if row.get("Name", "").strip())
        
        print_info(f"Found {total_characters} characters to potentially migrate")
        if not confirm_action("Start migration?"):
            print_info("Migration cancelled")
            return
            
    except Exception as e:
        print_warning(f"Could not count characters: {e}")
        if not confirm_action("Continue anyway?"):
            return
    
    migrated_characters = []
    errors = []
    skipped_characters = []
    auto_process_remaining = False
    character_type_counts = {"character": 0, "familiar": 0, "monster": 0}
    validation_issues = []
    
    try:
        with open(input_file, 'r', newline='', encoding='utf-8-sig') as file:
            reader = csv.DictReader(file)
            
            for row_num, row in enumerate(reader, start=2):
                character_name = row.get("Name", f"Row {row_num}").strip()
                
                if not character_name or character_name == f"Row {row_num}":
                    print_warning(f"Skipping row {row_num}: no character name")
                    continue
                
                print(f"\n--- Processing {character_name} (Row {row_num}) ---")
                
                # Show character preview
                class_name = row.get("Class", "").strip()
                class_level = row.get("Class level", "0").strip()
                profession_name = row.get("Profession", "").strip()
                profession_level = row.get("Profession level", "0").strip()
                race_name = row.get("Race", "").strip()
                race_level = row.get("Race level", "0").strip()
                
                print_info(f"Preview: {class_name} {class_level}, {profession_name} {profession_level}, {race_name} (Race Level {race_level})")
                
                # Check if we should auto-process (option 4 was chosen earlier)
                if auto_process_remaining:
                    print_info(f"Auto-processing {character_name}")
                else:
                    # Ask if user wants to process this character
                    print("Options:")
                    print("  1. Process this character")
                    print("  2. Skip this character")
                    print("  3. Skip this character and all remaining characters")
                    print("  4. Process this character and all remaining characters")
                    
                    while True:
                        choice = input("Choose option (1-4): ").strip()
                        if choice in ["1", "2", "3", "4"]:
                            break
                        print_error("Please enter 1, 2, 3, or 4")
                    
                    if choice == "2":
                        print_warning(f"Skipping {character_name}")
                        skipped_characters.append(character_name)
                        continue
                    elif choice == "3":
                        print_warning(f"Skipping {character_name} and all remaining characters")
                        skipped_characters.append(character_name)
                        break
                    elif choice == "4":
                        print_info(f"Processing {character_name} and auto-processing all remaining characters")
                        auto_process_remaining = True
                    # choice == "1" or "4" continues to processing
                
                # Determine character type early to decide on history prompting
                character_type = get_character_type_from_user(row, character_name, auto_process_remaining)
                if not auto_process_remaining:
                    print_info(f"Character type: {character_type}")
                
                # Determine if we should prompt for history (only for regular characters)
                should_prompt = prompt_for_history and character_type == "character" and not auto_process_remaining
                
                character, char_type = migrate_character_row(
                    row, tier_thresholds, should_prompt, item_repository, auto_process_remaining, character_type
                )
                
                if character:
                    # Validate ALL character types (not just regular characters)
                    print_info(f"Validating migrated {char_type}...")
                    validation_result = character.validate_stats()
                    
                    # For regular characters, also check for impossible free point usage
                    if char_type == "character":
                        fp_info = validation_result.get("free_points", {})
                        total_expected = fp_info.get('expected_total', 0)
                        used_in_allocation = fp_info.get('used_in_allocation', 0)
                        has_impossible_usage = used_in_allocation > total_expected
                    else:
                        # For familiars and monsters, free point issues are handled differently
                        has_impossible_usage = False
                    
                    if validation_result["valid"] and not has_impossible_usage:
                        print_success(f"✓ {char_type.capitalize()} validation passed")
                    else:
                        print_warning(f"⚠ {char_type.capitalize()} validation issues detected")
                        validation_issues.append(character_name)
                        
                        # Show stat discrepancies for all character types
                        if validation_result.get("stat_discrepancies"):
                            print_error("Validation problems found:")
                            for field, issue in validation_result["stat_discrepancies"].items():
                                if isinstance(issue, dict) and "impossible_allocation" in issue:
                                    discrepancy = issue["impossible_allocation"]
                                    print_error(f"  {field}: impossible allocation of {abs(discrepancy)} points")
                                else:
                                    print_error(f"  {field}: {issue}")
                        
                        # Show free point issues (context depends on character type)
                        if has_impossible_usage or (validation_result.get("free_points", {}).get("discrepancy", 0) != 0):
                            fp_info = validation_result.get("free_points", {})
                            if char_type == "character":
                                print_error(f"  Free Points Expected: {fp_info.get('expected_total', 0)}")
                                print_error(f"  Free Points Used: {fp_info.get('used_in_allocation', 0)}")
                                print_error(f"  Free Points Remaining: {fp_info.get('remaining', 0)}")
                            elif char_type in ["familiar", "monster"]:
                                # For race-leveling types, show different free point information
                                remaining = fp_info.get('remaining', 0)
                                if remaining != 0:
                                    print_error(f"  Free Points Issue: Should have 0 remaining, but has {remaining}")
                        
                        # Handle validation failures based on auto-processing mode
                        if not auto_process_remaining:
                            print("Options:")
                            print("  1. Continue migration anyway (character will be marked as invalid)")
                            print("  2. Skip this character")
                            print("  3. Show detailed validation information")
                            
                            while True:
                                choice = input("Choose option (1-3): ").strip()
                                if choice == "1":
                                    print_info(f"Continuing with invalid {char_type} (will be marked as invalid)")
                                    break
                                elif choice == "2":
                                    print_warning(f"Skipping {char_type} {character_name} due to validation issues")
                                    skipped_characters.append(character_name)
                                    character = None  # Don't add to migrated list
                                    break
                                elif choice == "3":
                                    show_detailed_validation(character, validation_result)
                                    continue
                                else:
                                    print_error("Please enter 1, 2, or 3")
                        else:
                            print_warning(f"Auto-processing: continuing with invalid {char_type} (will be marked as invalid)")

                    if character:  # Only add if not skipped due to validation issues
                        migrated_characters.append(character)
                        character_type_counts[char_type] += 1
                        print_success(f"Added {character.name} to migration list")
                else:
                    print_error(f"Failed to migrate {character_name}")
                    errors.append(character_name)
    
    except Exception as e:
        print_error(f"Error reading input file: {e}")
        return
    
    # Save migrated characters
    if migrated_characters:
        print_subheader("Saving Migrated Characters")
        saved_count = 0
        
        for character in migrated_characters:
            try:
                success = character.save(output_file, mode="a" if saved_count > 0 else "w")
                if success:
                    saved_count += 1
                else:
                    print_error(f"Failed to save {character.name}")
                    errors.append(character.name)
            except Exception as e:
                print_error(f"Error saving {character.name}: {e}")
                errors.append(character.name)
        
        print_success(f"Successfully migrated {saved_count} characters to {output_file}")
    
    # Summary
    print_subheader("Migration Summary")
    print_success(f"Successfully migrated: {len(migrated_characters)} characters")
    
    # Show character type breakdown
    if any(character_type_counts.values()):
        print_info("Character type breakdown:")
        for char_type, count in character_type_counts.items():
            if count > 0:
                print(f"  {char_type.capitalize()}s: {count}")
    
    if skipped_characters:
        print_info(f"Skipped by user: {len(skipped_characters)} characters")
        if len(skipped_characters) <= 10:  # Show names if not too many
            print("Skipped characters:", ", ".join(skipped_characters))
        else:
            print(f"Skipped characters: {', '.join(skipped_characters[:10])}, ... and {len(skipped_characters) - 10} more")
    
    if errors:
        print_error(f"Errors encountered: {len(errors)} characters")
        if len(errors) <= 10:  # Show names if not too many
            print("Failed characters:", ", ".join(errors))
        else:
            print(f"Failed characters: {', '.join(errors[:10])}, ... and {len(errors) - 10} more")
    
    if validation_issues:
        print_warning(f"Validation issues: {len(validation_issues)} characters")
        print_info("These characters were migrated but have invalid stat allocations:")
        if len(validation_issues) <= 10:  # Show names if not too many
            print("Characters with issues:", ", ".join(validation_issues))
        else:
            print(f"Characters with issues: {', '.join(validation_issues[:10])}, ... and {len(validation_issues) - 10} more")
        print_info("These characters may need manual review and correction.")
    
    if migrated_characters:
        print_info(f"Migrated characters saved to: {output_file}")
    else:
        print_warning("No characters were migrated.")
        if skipped_characters:
            print_info("All characters were either skipped or had errors.")

def main():
    """Main function for the migration script."""
    clear_screen()
    print_header("Character Migration Tool v4")
    print_info("This tool migrates characters from old CSV format to Character_Creator4 with support for:")
    print_info("• Regular characters with class/profession/race progression")
    print_info("• Familiars that only level through race levels")
    print_info("• Monsters that only level through race levels")
    print_info("• Smart character type detection (only asks when race is 'monster' and no type field exists)")
    print()
    
    # Get input file
    input_file = input("Enter path to input CSV file: ").strip()
    if not input_file.endswith('.csv'):
        input_file += '.csv'
    
    # Get output file (optional)
    output_file = input("Enter path to output CSV file (or press Enter for auto-generated name): ").strip()
    if output_file and not output_file.endswith('.csv'):
        output_file += '.csv'
    
    if not output_file:
        output_file = None  # Will be auto-generated
    
    # Run migration
    migrate_characters_csv(input_file, output_file)
    
    print("\nMigration complete!")
    input("Press Enter to exit...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nMigration cancelled.")
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        input("Press Enter to exit...")