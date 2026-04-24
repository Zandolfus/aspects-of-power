"""
Multi-tier game data structure with character-specific thresholds
Pure data repository - no functions
"""

# Default tier thresholds for new characters (can be customized per character)
DEFAULT_TIER_THRESHOLDS = [25, 100, 200]

# Organize class gains by tier
class_gains = {
    1: {  # Tier 1
        "mage": {
            "intelligence": 2,
            "willpower": 2,
            "wisdom": 1,
            "perception": 1,
            "free_points": 2,
        },
        "healer": {
            "willpower": 2,
            "wisdom": 2,
            "intelligence": 1,
            "perception": 1,
            "free_points": 2,
        },
        "archer": {
            "perception": 2,
            "dexterity": 2,
            "endurance": 1,
            "vitality": 1,
            "free_points": 2,
        },
        "heavy warrior": {
            "strength": 2,
            "vitality": 2,
            "endurance": 1,
            "toughness": 1,
            "free_points": 2,
        },
        "medium warrior": {
            "strength": 2,
            "dexterity": 2,
            "endurance": 1,
            "vitality": 1,
            "free_points": 2,
        },
        "light warrior": {
            "dexterity": 2,
            "endurance": 2,
            "vitality": 1,
            "strength": 1,
            "free_points": 2,
        },
    },
    2: {  # Tier 2
        "thunder puppet's shadow": {
            "dexterity": 5,
            "strength": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "astral aetherologist": {
            "intelligence": 5,
            "willpower": 4,
            "wisdom": 3,
            "perception": 2,
            "free_points": 4
        },
        "glamourweaver": {
            "wisdom": 5,
            "intelligence": 4,
            "willpower": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "waywatcher": {
            "perception": 5,
            "dexterity": 4,
            "wisdom": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "glade guardian": {
            "dexterity": 5,
            "strength": 4,
            "toughness": 3,
            "wisdom": 2,
            "free_points": 4,
        },
        "sniper": {
            "perception": 5,
            "dexterity": 4,
            "endurance": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "augur": {"wisdom": 6, "willpower": 6, "vitality": 6, "free_points": 4},
        "monk": {
            "dexterity": 5,
            "strength": 4,
            "toughness": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "spearman": {
            "strength": 5,
            "dexterity": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "knife artist": {
            "dexterity": 5,
            "perception": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "bloodmage": {
            "intelligence": 5,
            "wisdom": 4,
            "vitality": 3,
            "willpower": 2,
            "free_points": 4,
        },
        "aspiring blade of light": {
            "strength": 5,
            "dexterity": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "beginner assassin": {
            "dexterity": 5,
            "strength": 4,
            "perception": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "hydromancer": {
            "intelligence": 5,
            "willpower": 4,
            "vitality": 3,
            "perception": 2,
            "free_points": 4,
        },
        "clergyman": {
            "wisdom": 5,
            "willpower": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "swashbuckler": {
            "strength": 5,
            "dexterity": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "witch of ages": {
            "willpower": 5,
            "intelligence": 4,
            "wisdom": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "curse eater": {
            "willpower": 5,
            "perception": 4,
            "vitality": 3,
            "dexterity": 2,
            "free_points": 4,
        },
        "fireborne": {
            "intelligence": 5,
            "willpower": 4,
            "vitality": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "windcaller": {
            "intelligence": 5,
            "perception": 4,
            "wisdom": 3,
            "willpower": 2,
            "free_points": 4,
        },
        "overwatch": {
            "perception": 5,
            "dexterity": 4,
            "endurance": 3,
            "strength": 2,
            "free_points": 4,
        },
        "blood warden": {
            "vitality": 5,
            "strength": 4,
            "dexterity": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "windservant": {
            "intelligence": 5,
            "dexterity": 4,
            "willpower": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "ice maiden": {
            "intelligence": 5,
            "willpower": 4,
            "wisdom": 3,
            "dexterity": 2,
            "free_points": 4,
        },
        "paramedic": {
            "wisdom": 5,
            "willpower": 4,
            "dexterity": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "treewalker": {
            "perception": 5,
            "dexterity": 4,
            "endurance": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "triage healer": {
            "wisdom": 5,
            "willpower": 4,
            "perception": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "sandman": {
            "dexterity": 5,
            "willpower": 4,
            "intelligence": 3,
            "strength": 2,
            "free_points": 4,
        },
        "pyroclast magus": {
            "intelligence": 5,
            "willpower": 4,
            "vitality": 3,
            "perception": 2,
            "free_points": 4,
        },
    },
}

# Organize profession gains by tier
profession_gains = {
    1: {  # Tier 1
        "beginner jeweler of the elements": {
            "wisdom": 2,
            "dexterity": 2,
            "vitality": 1,
            "perception": 1,
            "free_points": 2,
        },
        "beginner smith of the moonshadow": {
            "strength": 2,
            "perception": 2,
            "vitality": 1,
            "intelligence": 1,
            "free_points": 2,
        },
        "justiciar": {
            "free_points": 8
        },
        "judge": {
            "free_points": 8
        },
        "magistrate": {
            "free_points": 8
        },
        "advocate": {
            "free_points": 8
        },
        "gatherer": {
            "strength": 2,
            "perception": 2,
            "dexterity": 1,
            "endurance": 1,
            "free_points": 2,
        },
        "chef": {
            "dexterity": 2,
            "perception": 2,
            "strength": 1,
            "endurance": 1,
            "free_points": 2,
        },
        "student trapper of the asrai": {
            "perception": 2,
            "dexterity": 2,
            "vitality": 1,
            "endurance": 1,
            "free_points": 2,
        },
        "pickpocket": {
            "perception": 2,
            "dexterity": 2,
            "strength": 1,
            "endurance": 1,
            "free_points": 2,
        },
        "novice tailor": {
            "dexterity": 2,
            "perception": 2,
            "wisdom": 1,
            "willpower": 1,
            "free_points": 2,
        },
        "builder": {
            "strength": 2,
            "dexterity": 2,
            "endurance": 1,
            "intelligence": 1,
            "free_points": 2,
        },
        "windlord's keeper": {
            "intelligence": 2,
            "dexterity": 2,
            "willpower": 1,
            "toughness": 1,
            "free_points": 2,
        },
        "beginner leatherworker of the cosmos": {
            "dexterity": 2,
            "willpower": 2,
            "strength": 1,
            "intelligence": 1,
            "free_points": 2,
        },
        "seed of new life": {
            "willpower": 2,
            "wisdom": 2,
            "perception": 1,
            "vitality": 1,
            "free_points": 2,
        },
        "vanguard of new growth": {
            "perception": 2,
            "vitality": 2,
            "strength": 1,
            "toughness": 1,
            "free_points": 2,
        },
        "student shaper of the asrai": {
            "dexterity": 2,
            "perception": 2,
            "willpower": 1,
            "wisdom": 1,
            "free_points": 2,
        },
        "alchemist of flame's heart": {
            "wisdom": 2,
            "perception": 2,
            "willpower": 1,
            "intelligence": 1,
            "free_points": 2,
        },
        "drums of war, largo": {
            "strength": 2,
            "dexterity": 2,
            "willpower": 1,
            "wisdom": 1,
            "free_points": 2,
        },
        "drums of war, largo": {
            "strength": 2,
            "dexterity": 2,
            "willpower": 1,
            "wisdom": 1,
            "free_points": 2,
        },
        "novice witch-wright of iron and ice": {
            "intelligence": 2,
            "wisdom": 2,
            "willpower": 1,
            "vitality": 1,
            "free_points": 2,
        },
        "beast-speaker": {
            "vitality": 2,
            "wisdom": 2,
            "endurance": 1,
            "dexterity": 1,
            "free_points": 2,
        },
        "student blood alchemist": {
            "wisdom": 2,
            "vitality": 2,
            "willpower": 1,
            "perception": 1,
            "free_points": 2,
        },        
        "demonic butler": {
            "free_points": 8,
        },
    },
    2: {  # Tier 2
        "crusher": {
            "strength": 6,
            "dexterity": 4,
            "endurance": 4,
            "free_points": 4,
        },
        "chef for the masses": {
            "perception": 5,
            "dexterity": 4,
            "strength": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "trapper of the asrai": {
            "perception": 5,
            "dexterity": 4,
            "vitality": 3,
            "endurance": 2,
            "free_points": 4,
        },
        "thief": {
            "dexterity": 5,
            "perception": 4,
            "endurance": 3,
            "strength": 2,
            "free_points": 4,
        },
        "tailor of ingenuity": {
            "dexterity": 5,
            "perception": 4,
            "wisdom": 3,
            "willpower": 2,
            "free_points": 4,
        },
        "architect": {
            "strength": 5,
            "dexterity": 4,
            "endurance": 3,
            "willpower": 2,
            "free_points": 4,
        },
        "drums of war, andante": {
            "strength": 5,
            "dexterity": 4,
            "willpower": 3,
            "wisdom": 2,
            "free_points": 4,
        },
        "student leatherworker of the cosmos": {
            "dexterity": 5,
            "willpower": 4,
            "strength": 3,
            "intelligence": 2,
            "free_points": 4,
        },
        "witch-wright of iron and ice": {
            "intelligence": 5,
            "wisdom": 4,
            "willpower": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "beast-tamer": {
            "vitality": 5,
            "wisdom": 4,
            "endurance": 3,
            "dexterity": 2,
            "free_points": 4,
        },
        "windlord's bonded": {
            "intelligence": 5,
            "dexterity": 4,
            "willpower": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "true vanguard of new growth": {
            "perception": 5,
            "vitality": 4,
            "strength": 3,
            "toughness": 2,
            "free_points": 4,
        },
        "sapling of new life": {
            "willpower": 5,
            "wisdom": 4,
            "perception": 3,
            "vitality": 2,
            "free_points": 4,
        },
        "high judge": {
            "free_points": 18,
        },
        "high justiciar": {
            "free_points": 18
        },
        "high magistrate": {
            "free_points": 18
        },
        "high advocate": {
            "free_points": 18
        },
        "mana-jeweler of the elements": {
            "willpower": 5,
            "wisdom": 4,
            "intelligence": 3,
            "vitality": 2,
            "free_points": 4
        },
        "shaper of the asrai": {
            "dexterity": 5,
            "perception": 4,
            "willpower": 3,
            "wisdom": 2,
            "free_points": 4,
        },
        "blazing alchemist of flame's heart": {
            "wisdom": 5,
            "perception": 4,
            "willpower": 3,
            "intelligence": 2,
            "free_points": 4,
        },
        "witch-wright of jewels": {
            "wisdom": 5,
            "dexterity": 4,
            "vitality": 3,
            "perception": 2,
            "free_points": 4,
        },
        "proficient smith of the moonshadow": {
            "strength": 5,
            "perception": 4,
            "vitality": 3,
            "intelligence": 2,
            "free_points": 4,
        },        
        "head demonic butler": {
            "free_points": 8,
        },
        "field smith of the moonshadow": {
            "intelligence": 5,
            "willpower": 4,
            "perception": 3,
            "strength": 2,
            "free_points": 4,
        },
        "blood alchemist": {
            "wisdom": 5,
            "vitality": 4,
            "willpower": 3,
            "perception": 2,
            "free_points": 4,
        },
    },
}

# Race data remains the same as it's not tier-based
races = {
    "human": {
        "rank_ranges": [
            {
                "min_level": 0,
                "max_level": 9,
                "stats": {
                    "dexterity": 1,
                    "strength": 1,
                    "vitality": 1,
                    "endurance": 1,
                    "toughness": 1,
                    "willpower": 1,
                    "wisdom": 1,
                    "intelligence": 1,
                    "perception": 1,
                    "free_points": 1,
                },
                "rank": "G",
            },
            {
                "min_level": 10,
                "max_level": 24,
                "stats": {
                    "dexterity": 1,
                    "strength": 1,
                    "vitality": 1,
                    "endurance": 1,
                    "toughness": 1,
                    "willpower": 1,
                    "wisdom": 1,
                    "intelligence": 1,
                    "perception": 1,
                    "free_points": 2,
                },
                "rank": "F",
            },
            {
                "min_level": 25,
                "max_level": 99,
                "stats": {
                    "dexterity": 2,
                    "strength": 2,
                    "vitality": 2,
                    "endurance": 2,
                    "toughness": 2,
                    "willpower": 2,
                    "wisdom": 2,
                    "intelligence": 2,
                    "perception": 2,
                    "free_points": 5,
                },
                "rank": "E",
            },
            {
                "min_level": 100,
                "max_level": 1000,
                "stats": {
                    "dexterity": 6,
                    "strength": 6,
                    "vitality": 6,
                    "endurance": 6,
                    "toughness": 6,
                    "willpower": 6,
                    "wisdom": 6,
                    "intelligence": 6,
                    "perception": 6,
                    "free_points": 15,
                },
                "rank": "D",
            },
        ]
    },
    "half-asrai": {
        "rank_ranges": [
            {
                "min_level": 0,
                "max_level": 9,
                "stats": {
                    "dexterity": 2,
                    "toughness": 2,
                    "wisdom": 2,
                    "perception": 2,
                    "free_points": 2,
                },
                "rank": "G",
            },
            {
                "min_level": 10,
                "max_level": 24,
                "stats": {
                    "dexterity": 2,
                    "toughness": 2,
                    "wisdom": 2,
                    "perception": 2,
                    "free_points": 3,
                },
                "rank": "F",
            },
            {
                "min_level": 25,
                "max_level": 99,
                "stats": {
                    "dexterity": 4,
                    "toughness": 4,
                    "wisdom": 4,
                    "perception": 4,
                    "free_points": 7,
                },
                "rank": "E",
            },
        ]
    },
    "asrai": {
        "rank_ranges": [
            {
                "min_level": 0,
                "max_level": 24,
                "stats": {
                    "dexterity": 3,
                    "toughness": 2,
                    "wisdom": 2,
                    "perception": 2,
                    "vitality": 2,
                },
                "rank": "F",
            },
            {
                "min_level": 24,
                "max_level": 99,
                "stats": {
                    "dexterity": 5,
                    "toughness": 4,
                    "wisdom": 4,
                    "perception": 4,
                    "vitality": 4,
                },
                "rank": "E",
            }
        ]
    },
    "monster": {
        "rank_ranges": [
            {
                "min_level": 0,
                "max_level": 24,
                "stats": {"free_points": 42},
                "rank": "F",
            },
            {
                "min_level": 25,
                "max_level": 99,
                "stats": {"free_points": 63},
                "rank": "E",
            },
        ]
    },    
    "juvenile astral elf": {
        "rank_ranges": [
            {
                "min_level": 25,
                "max_level": 99,
                "stats": {
                    "willpower": 3,
                    "perception": 3,
                    "intelligence": 3,
                    "vitality": 3,
                    "dexterity": 3,
                    "wisdom": 3,
                    "free_points": 5,
                    },
                "rank": "E",
            },
        ]
    },
    "demon": {
        "rank_ranges": [
            {
                "min_level": 0,
                "max_level": 24,
                "stats": {
                    "strength": 2,
                    "dexterity": 2,
                    "wisdom": 2,
                    "intelligence": 2,
                    "willpower": 2,
                    "perception": 1,
                },
                "rank": "F",
            },
            {
                "min_level": 24,
                "max_level": 99,
                "stats": {
                    "strength": 3,
                    "dexterity": 3,
                    "wisdom": 3,
                    "intelligence": 3,
                    "willpower": 3,
                    "perception": 3,
                    "free_points": 5,
                },
                "rank": "E",
            }
        ]
    },
}