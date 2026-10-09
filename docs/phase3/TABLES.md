# Phase 3 tables: food and item value

Author: TABLES AUTHOR. Consumer: the model that writes `src/core/combat/food.ts` and `src/core/combat/values.ts`. Target: Bedrock Edition 1.21+/1.26.5x. Anything marked `(verify)` is a best guess to confirm with the Phase 3 probes. All ids carry the `minecraft:` prefix unless a column says otherwise (in FOOD, `returns_item` is also written without prefix; add `minecraft:`).

Transcription rules:
- Every table is one row per id. Do not merge rows, do not invent ids. A row with `{tier}` style patterns is expanded in the generated tables below; use the expanded rows.
- `-` means none. Numbers use `.` decimals.
- Values here are starting points: the architect/config may tune them, so export them as plain `const` tables.

---

## SECTION 1. Hunger mechanics (Bedrock, numbers only)

| quantity | value |
|---|---|
| hunger range | 0 to 20 (10 shanks, 2 points each) |
| saturation range | 0 up to current hunger (cap = hunger, never above 20); spawn value 5 |
| food gain rule | hunger = min(20, hunger + food.hunger); saturation = min(hunger_after, saturation + food.saturation) |
| exhaustion threshold | exhaustion >= 4.0: subtract 4.0, then saturation -1 (min 0); if saturation already 0, hunger -1 |
| regen, slow | hunger >= 18 and HP < max: +1 HP every 80 ticks (4 s), costs 6.0 exhaustion per HP |
| regen, fast (saturation-boosted) | hunger = 20 and saturation > 0 and HP < max: +1 HP every 10 ticks (0.5 s), costs 6.0 exhaustion per HP. Code this as `fast_regen_active = hunger === 20 && saturation > 0` (conservative; the Bedrock threshold of 18 is unverified) |
| saturation -> HP conversion | 1 saturation = 4 exhaustion = about 0.67 HP of fast regen (6 exhaustion per HP). Use `hp_from_saturation = saturation * 0.67` |
| no regen | hunger < 18: no natural regeneration |
| starvation | hunger = 0: -1 HP every 80 ticks. Easy stops at 10 HP, Normal stops at 1 HP (half heart), Hard kills (verify) |
| sprint threshold | can sprint only if hunger > 6 (hunger >= 7); sprint stops at hunger <= 6 |
| exhaustion: sprint | 0.1 per block sprinted |
| exhaustion: jump | 0.05 per jump; 0.2 per sprint-jump |
| exhaustion: attack | 0.1 per attack that is performed (verify: Bedrock charges on swing hit) |
| exhaustion: damage taken | 0.1 per damage event (verify) |
| exhaustion: mining | 0.005 per block broken |
| exhaustion: swimming | 0.01 per block |
| exhaustion: walking | 0 (Bedrock charges nothing for plain walking) |
| exhaustion: hunger effect | 0.025 per tick per effect level (verify). Level 1 for 30 s costs 15.0 exhaustion = about 3.75 hunger/saturation |
| eat duration, normal food | 32 ticks (1.6 s) |
| eat duration, dried_kelp | 16 ticks (0.8 s) |
| eat duration, honey_bottle | 40 ticks (2.0 s) |
| eat duration, potion/other drinkables | 32 ticks (not in FOOD table) |
| always edible at full hunger | golden_apple, enchanted_golden_apple, chorus_fruit. All other foods (including honey_bottle, D20) cannot be eaten while hunger = 20 |
| eating can be interrupted by | switching held slot, stopping use, dying; damage does not cancel it (verify) |
| hunger effect net values (use in starving ordering) | expected net = food.hunger - chance * 3.75 * effect_level * (seconds / 30). rotten_flesh: +4 hunger, +0.8 sat, effect -3.75 at 80%: expected net +1.0 (4 - 0.8 * 3.75). chicken: +2, +1.2, effect -3.75 at 30%: expected net +0.875 (2 - 0.3 * 3.75; -1.75 when the effect triggers). pufferfish: +1, +0.2, effect -5.6 (3 levels x 15 s, 100%): expected net -4.6 (1 - 1.0 * 3.75 * 3 * 0.5). This is why `avoid_order` ranks rotten_flesh (+1.0) before chicken (+0.875) |

Suggested decision inputs: `missing_hunger = 20 - hunger`; `can_sprint = hunger > 6`; `regen_active = hunger >= 18`.

---

## SECTION 2. FOOD table

Saturation column = **actual saturation points restored** (wiki value), not the modifier. Conversion used: saturation = hunger x modifier x 2 (e.g. cooked_beef 8 x 0.8 x 2 = 12.8).
Effect format: `effect:level:seconds:chance_percent`, multiple effects separated by `;`. Level is 1-based (`regeneration:2` = Regeneration II). Effect names are Bedrock ids. Pseudo-effects: `teleport` (chorus fruit, random teleport up to about 8 blocks, verify), `cure_poison` (removes poison), `varies` (suspicious_stew, effect depends on the flower and is unknown to the bot). Pseudo-effects (`teleport`, `cure_poison`, `varies`) use `level` 1 or 0 and `seconds` 0 as placeholders; code must ignore level and seconds for them.
`returns_item`: item left in inventory after eating (`bowl`, `glass_bottle`), else `-`.
Tag assignment rules used (so new rows can be added consistently): `avoid` = explicit harmful list; `emergency` = golden apples; `escape` = chorus_fruit; `topup` = non-avoid, non-emergency, non-raw, non-stew, hunger <= 6 and saturation <= 7.2 (cheap); `main` = hunger >= 5 and saturation >= 4.8 and not avoid/emergency; `raw` = cookable raw food (potato included; raw chicken is NOT `raw`, it is `avoid` only, so it is never eaten outside `starving`); `stew` = returns a bowl; `fast` = eat_ticks 16; `regen` = gives Regeneration.
Items that exist in the game but are deliberately NOT in the table: milk_bucket and potions (not food), cake and honey_block (placed blocks), golden_dandelion (animal feed, not edible by players; verify), any food added after 1.26.5 (verify).

| id | hunger | saturation | eat_ticks | effects | returns_item | tags |
|---|---|---|---|---|---|---|
| minecraft:apple | 4 | 2.4 | 32 | - | - | topup |
| minecraft:baked_potato | 5 | 6 | 32 | - | - | topup,main |
| minecraft:beetroot | 1 | 1.2 | 32 | - | - | topup |
| minecraft:beetroot_soup | 6 | 7.2 | 32 | - | bowl | main,stew |
| minecraft:bread | 5 | 6 | 32 | - | - | topup,main |
| minecraft:carrot | 3 | 3.6 | 32 | - | - | topup |
| minecraft:chorus_fruit | 4 | 2.4 | 32 | teleport:1:0:100 | - | escape |
| minecraft:cooked_beef | 8 | 12.8 | 32 | - | - | main |
| minecraft:cooked_chicken | 6 | 7.2 | 32 | - | - | topup,main |
| minecraft:cooked_cod | 5 | 6 | 32 | - | - | topup,main |
| minecraft:cooked_mutton | 6 | 9.6 | 32 | - | - | main |
| minecraft:cooked_porkchop | 8 | 12.8 | 32 | - | - | main |
| minecraft:cooked_rabbit | 5 | 6 | 32 | - | - | topup,main |
| minecraft:cooked_salmon | 6 | 9.6 | 32 | - | - | main |
| minecraft:cookie | 2 | 0.4 | 32 | - | - | topup |
| minecraft:dried_kelp | 1 | 0.6 | 16 | - | - | topup,fast |
| minecraft:enchanted_golden_apple | 4 | 9.6 | 32 | regeneration:5:30:100;absorption:4:120:100;resistance:1:300:100;fire_resistance:1:300:100 | - | emergency,regen |
| minecraft:glow_berries | 2 | 0.4 | 32 | - | - | topup |
| minecraft:golden_apple | 4 | 9.6 | 32 | regeneration:2:5:100;absorption:1:120:100 | - | emergency,regen |
| minecraft:golden_carrot | 6 | 14.4 | 32 | - | - | main |
| minecraft:honey_bottle | 6 | 1.2 | 40 | cure_poison:1:0:100 | glass_bottle | topup |
| minecraft:melon_slice | 2 | 1.2 | 32 | - | - | topup |
| minecraft:mushroom_stew | 6 | 7.2 | 32 | - | bowl | main,stew |
| minecraft:poisonous_potato | 2 | 1.2 | 32 | poison:1:4:60 | - | avoid |
| minecraft:potato | 1 | 0.6 | 32 | - | - | raw |
| minecraft:pufferfish | 1 | 0.2 | 32 | poison:2:60:100;hunger:3:15:100;nausea:1:15:100 | - | avoid |
| minecraft:pumpkin_pie | 8 | 4.8 | 32 | - | - | main |
| minecraft:rabbit_stew | 10 | 12 | 32 | - | bowl | main,stew |
| minecraft:beef | 3 | 1.8 | 32 | - | - | raw |
| minecraft:chicken | 2 | 1.2 | 32 | hunger:1:30:30 | - | avoid |
| minecraft:cod | 2 | 0.4 | 32 | - | - | raw |
| minecraft:mutton | 2 | 1.2 | 32 | - | - | raw |
| minecraft:porkchop | 3 | 1.8 | 32 | - | - | raw |
| minecraft:rabbit | 3 | 1.8 | 32 | - | - | raw |
| minecraft:salmon | 2 | 0.4 | 32 | - | - | raw |
| minecraft:rotten_flesh | 4 | 0.8 | 32 | hunger:1:30:80 | - | avoid |
| minecraft:spider_eye | 2 | 3.2 | 32 | poison:1:4:100 | - | avoid |
| minecraft:suspicious_stew | 6 | 7.2 | 32 | varies:0:0:100 | bowl | avoid,stew |
| minecraft:sweet_berries | 2 | 0.4 | 32 | - | - | topup |
| minecraft:tropical_fish | 1 | 0.2 | 32 | - | - | topup |

Verify list for Section 2: Bedrock effect durations/chances of `poisonous_potato` (4 s vs 5 s), `spider_eye` (4 s vs 5 s), `pufferfish` (poison II 60 s vs 20 s), `enchanted_golden_apple` (Regeneration V 30 s on Bedrock vs Regeneration II 20 s on Java), `golden_apple` absorption duration, `honey_bottle` saturation and eat time, `chorus_fruit` teleport radius, raw cod id (`minecraft:cod`; legacy `minecraft:fish` was renamed). Decided: honey_bottle is NOT always-edible (D20); it follows the normal hunger rules. Fallback when unprobed: treat poison/hunger durations and the chorus teleport radius as the table values; the ordering (pufferfish is never eaten unless starving, `hunger <= 2` and `hp >= 12`) does not depend on them.

---

## SECTION 3. Food selection rules (data)

Definitions for every rule below:
- `eligible(item)`: item is in FOOD, the bot holds >= 1, it is not part of the current task objective (do not eat the objective items, except in `emergency`), and `hunger < 20` unless the item is in `always_edible`. Two more exclusions: (1) an item tagged `avoid` is eligible only in the `starving` situation, through `avoid_order` (3.2), whatever its other tags; (2) reserved items (3.3) are eligible only in their named situation (`golden_carrot`: `pre_engage_heal` and `starving` only, so `topup` skips it even though it is tagged `main`; `golden_apple` and `enchanted_golden_apple`: `emergency`, or `starving` as the last choice; `chorus_fruit`: `escape_teleport`, or `starving` after `avoid`).
- `missing = 20 - hunger`. `sat_after(item) = min(min(20, hunger + item.hunger), saturation + item.saturation)`. `sat_gain(item) = sat_after(item) - saturation`.
- `item_value` = ITEM VALUE table (Section 4). Used only for tie-breaks (spend the cheapest item).
- Final tie-break for every rule: shortest `eat_ticks`, then alphabetical id.

### 3.1 Preference lists

| situation | trigger (suggested defaults, config owns them) | ordered tag preference (first tag with an eligible item wins) | pick rule inside the winning tag |
|---|---|---|---|
| topup | no threat within 24 blocks AND hunger <= 17 AND missing >= 2 (at the default `topupHungerMax = 17` the `missing >= topupMinMissing (2)` test is always true; it only matters if `topupHungerMax` is raised to 18 or more) | topup, main, raw | `fit_largest`: among items with `item.hunger <= missing`, max `item.hunger`; tie lowest `item_value`. If no item fits, `fit_smallest_overflow`: smallest `item.hunger`, only if overflow `(item.hunger - missing) <= 2`; else eat nothing |
| pre_engage_heal | about to engage or resume combat AND (hunger < 20 OR HP < max) AND time to contact >= eat_ticks + 20 | main, topup | `max_sat_gain`: max `sat_gain`; tie max `item.hunger`; tie lowest `item_value` |
| emergency | HP <= 6 (3 hearts) AND hostile within 16 blocks (or HP <= 4 any threat) | emergency, then fall through to pre_engage_heal | `fixed_order`: `enchanted_golden_apple` > `golden_apple`. Allowed even at hunger = 20 |
| starving | hunger <= 6 AND no eligible item in tags topup, main, raw  (or hunger = 0 and HP dropping) | topup, main, raw, avoid, emergency (no `stew` entry: every stew is tagged `main` or `avoid`, so it is covered) | non-avoid tags: `fit_largest` ignoring `missing` limit (max hunger). `avoid`: `avoid_order` below. `emergency` only if HP <= 6 and nothing else |
| escape_teleport | HP <= 6 AND melee threat within 3 blocks AND escape-rejoin is not available AND the bot holds no eligible item with tag `emergency` | escape | `fixed_order`: `chorus_fruit`. Never when in melee with eat_ticks not covered (see guard) |

Guards (apply to every situation except where noted):
- `eat_guard`: start eating only if no hostile is within `eat_ticks / 20 * threat_speed + 2` blocks (suggested threat_speed 5 blocks/s), otherwise retreat first. The comparison is strict: the bot eats only if every hostile has `distance > threshold`; at `distance == threshold` it does not eat. Example: `32 / 20 * 5 + 2 = 10` blocks, so a zombie at exactly 10.0 blocks blocks a normal meal. At runtime the S2a `canEatSafely` rule (stricter, D23) replaces this threshold; this line is the data default. `emergency` and `escape_teleport` may start with the threat closer, but not while a melee mob is already within 2 blocks unless HP <= 4.
- Poison guard: items with `poison` need HP >= 8 and no threat within 16 blocks (poison cannot kill but leaves 1 HP).
- `always_edible`: golden_apple, enchanted_golden_apple, chorus_fruit. `honey_bottle` is not always edible: it follows the normal hunger rules (cannot be eaten at hunger = 20; D20).
- Return items: after eating a `stew`, `returns_item` bowl lands in inventory (junk value 0.1, do not treat as cargo loss).

### 3.2 avoid_order (starving only; first = eat first)

| rank | id | condition |
|---|---|---|
| 1 | minecraft:rotten_flesh | none (net about +1 after hunger effect) |
| 2 | minecraft:chicken | none |
| 3 | minecraft:spider_eye | HP >= 8 (poison) |
| 4 | minecraft:poisonous_potato | HP >= 8 (poison, 60% chance) |
| 5 | minecraft:suspicious_stew | HP >= 12 (unknown effects, may include wither/blindness) |
| 6 | minecraft:pufferfish | HP >= 12 AND hunger <= 2 (last resort: poison II + hunger III + nausea) |

### 3.3 never_eat_unless_starving (hard list)

`minecraft:rotten_flesh`, `minecraft:chicken`, `minecraft:spider_eye`, `minecraft:poisonous_potato`, `minecraft:pufferfish`, `minecraft:suspicious_stew`.
Reserved items (only in the named situation, otherwise never eaten): `minecraft:golden_apple`, `minecraft:enchanted_golden_apple` -> emergency (or starving as the very last choice); `minecraft:chorus_fruit` -> escape_teleport (or starving as the very last choice, after avoid); `minecraft:golden_carrot` -> allowed in pre_engage_heal and starving only, never topup (valuable for brewing).
Milk bucket and potions are not food. They have value rows in 4.6 (`milk_bucket` 13, `potion` 3) but no bot uses them in Phase 3.

### 3.4 Machine-readable copy

```json
{
  "pickRules": {
    "fit_largest": "among eligible with hunger <= missing choose max hunger; tie lowest item_value; tie shortest eat_ticks; tie alphabetical id",
    "fit_smallest_overflow": "if none fit: choose min hunger if (hunger - missing) <= 2 else none",
    "max_sat_gain": "choose max sat_gain; tie max hunger; tie lowest item_value; tie alphabetical id",
    "fixed_order": "first id in list that the bot holds",
    "avoid_order": "per table 3.2, respecting the condition"
  },
  "situations": {
    "topup": {
      "tags": [
        "topup",
        "main",
        "raw"
      ],
      "pick": "fit_largest",
      "fallbackPick": "fit_smallest_overflow"
    },
    "pre_engage_heal": {
      "tags": [
        "main",
        "topup"
      ],
      "pick": "max_sat_gain"
    },
    "emergency": {
      "tags": [
        "emergency"
      ],
      "pick": "fixed_order",
      "order": [
        "minecraft:enchanted_golden_apple",
        "minecraft:golden_apple"
      ],
      "then": "pre_engage_heal"
    },
    "starving": {
      "tags": [
        "topup",
        "main",
        "raw",
        "avoid",
        "emergency"
      ],
      "pick": "fit_largest",
      "ignoreMissing": true,
      "avoidOrder": [
        "minecraft:rotten_flesh",
        "minecraft:chicken",
        "minecraft:spider_eye",
        "minecraft:poisonous_potato",
        "minecraft:suspicious_stew",
        "minecraft:pufferfish"
      ]
    },
    "escape_teleport": {
      "tags": [
        "escape"
      ],
      "pick": "fixed_order",
      "order": [
        "minecraft:chorus_fruit"
      ]
    }
  },
  "neverEatUnlessStarving": [
    "minecraft:rotten_flesh",
    "minecraft:chicken",
    "minecraft:spider_eye",
    "minecraft:poisonous_potato",
    "minecraft:pufferfish",
    "minecraft:suspicious_stew"
  ],
  "alwaysEdible": [
    "minecraft:golden_apple",
    "minecraft:enchanted_golden_apple",
    "minecraft:chorus_fruit"
  ],
  "suggestedThresholds": {
    "topupHungerMax": 17,
    "topupMinMissing": 2,
    "emergencyHp": 6,
    "emergencyHpAnyThreat": 4,
    "starvingHunger": 6,
    "poisonMinHp": 8,
    "eatGuardThreatSpeed": 5,
    "eatGuardMargin": 2,
    "preEngageContactMarginTicks": 20
  }
}
```

---

## SECTION 4. ITEM VALUE table

### 4.1 Scale

- `value_per_item` is the worth of ONE item unit. Roughly logarithmic: each rarity step is about x3 to x5.
- Anchors: 0.1 = trash block (dirt, cobblestone); 0.5 = log; 1 = coal / copper ingot; 4 = iron ingot; 6 = gold ingot; 15 = emerald; 40 = diamond; 150 = netherite ingot; 250 = nether star / elytra / enchanted golden apple.
- Gear is priced as materials (count x unit); netherite piece = diamond piece + 150. Gear values can exceed 100 (diamond chestplate 320, netherite chestplate 470).
- Stack value = `value_per_item * count * durability_factor * enchant_multiplier`.
- Category `gear` set (counts toward gearValue, lost on death): `tool`, `weapon`, `armour`, `gear`. Everything else is cargo.

### 4.2 Constants

Config keys live under `config.combat.<camelCase of the name>` (S2a section 9 owns them and may rename; B2 `values.ts` / S2a must read them from `config`, not from literals). The four rows marked "const" are plain `const`s inside `values.ts` behind `kb.value` (S2a), not config.

| name | value | where |
|---|---|---|
| OBJ_FULL | 1000 | `config.combat.objFull` |
| OTHER_CARGO_CAP | 900  (must stay below OBJ_FULL) | `config.combat.otherCargoCap` |
| ENCHANT_PER_LEVEL | 0.10 | `config.combat.enchantPerLevel` |
| ENCHANT_MENDING_BONUS | 0.50 | `config.combat.enchantMendingBonus` |
| ENCHANT_MULT_CAP | 3.0 | `config.combat.enchantMultCap` |
| DURABILITY_FLOOR | 0.25 | `config.combat.durabilityFloor` |
| UNKNOWN_VALUE_STACKABLE | 1  (maxStackSize > 1) | const in `values.ts` |
| UNKNOWN_VALUE_UNSTACKABLE | 5  (maxStackSize = 1) | const in `values.ts` |
| FOOD_VALUE_PER_HUNGER | 0.25 | const in `values.ts` |
| FOOD_AVOID_VALUE | 0.1 | const in `values.ts` |
| ENCHANTED_BOOK_BASE | 20 | `config.combat.enchantedBookBase` |
| ENCHANTED_BOOK_PER_LEVEL | 10 | `config.combat.enchantedBookPerLevel` |
| ENCHANTED_BOOK_MENDING (mending +50 once) | 50 | `config.combat.enchantedBookMending` |

### 4.3 Modifier rules

1. **Enchantments**: `enchant_multiplier = min(ENCHANT_MULT_CAP, 1 + ENCHANT_PER_LEVEL * sum(levels) + (ENCHANT_MENDING_BONUS if mending))`. `sum(levels)` excludes Mending's level; Mending contributes only `ENCHANT_MENDING_BONUS` (Protection IV + Unbreaking III + Mending: sum 7, multiplier `1 + 0.7 + 0.5 = 2.2`). Applies to tool, weapon, armour, shield, bow, crossbow, trident, elytra, mace, fishing_rod. Not to books (use `ENCHANTED_BOOK_BASE + ENCHANTED_BOOK_PER_LEVEL * sum(levels)`, plus 50 if mending).
2. **Damaged gear**: `durability_factor = max(DURABILITY_FLOOR, (maxDurability - damage) / maxDurability)` for items with a durability component. Others: 1. A broken-looking item still keeps 25% (repair cost).
3. **Unknown item** (no row matches): `UNKNOWN_VALUE_STACKABLE` or `UNKNOWN_VALUE_UNSTACKABLE`.
4. **Food** not listed explicitly: `FOOD_VALUE_PER_HUNGER * food.hunger`, or `FOOD_AVOID_VALUE` if tagged `avoid`. Overrides in the table below win.
5. **Matching order**: exact id row first, then pattern rows, then rules 4 and 3.

### 4.4 OBJECTIVE BONUS (dominates)

Inputs: `objectiveItems` (set of item ids that count toward the current task, e.g. `RESOURCES[key].yields`), `requiredAmount` = amount STILL needed (task amount minus already deposited), `held` = sum of counts in the bot inventory for ids in `objectiveItems`.

```
progress           = requiredAmount > 0 ? min(held, requiredAmount) / requiredAmount : 0
objectiveValue    = OBJ_FULL * progress                       // 0 .. 1000, linear
surplus items     = held - requiredAmount (if > 0) are valued as ordinary cargo using their table value
otherCargoRaw     = sum(stack values of non-objective, non-gear stacks) + surplus
otherCargoValue   = min(OTHER_CARGO_CAP, otherCargoRaw)       // never exceeds 900
cargoValue        = objectiveValue + otherCargoValue
```

For tasks `goto`, `defend` and `idle` there are no objective items: `objectiveValue = 0` and the escape decision is made on gear and cargo value alone (Example 4 is this case; unit test `value-no-objective`).

Guarantee: if `held >= requiredAmount` then `objectiveValue = 1000 > 900 >= otherCargoValue`, so full objective progress outranks any non-objective cargo. Partial progress is modest and linear. Objective items are NOT also counted in `otherCargoRaw` (no double count). Gear never goes into cargo (see 4.5).

### 4.5 DEATH COST (inputs only)

```
gearValue   = sum over EQUIPPED slots (head, chest, legs, feet, offhand) and INVENTORY stacks (all 36 slots, 0..35,
              which include the held mainhand item exactly once)
              whose category is tool | weapon | armour | gear, of stackValue (enchant and durability applied)
              // Never add `mainhand` separately: it aliases the selected hotbar slot.
cargoValue  = objectiveValue + otherCargoValue          // from 4.4
deathCost   = gearValue + cargoValue                    // what is lost if the bot dies and drops/loses everything
```

Output inputs to the architect's escape formula: `gearValue`, `objectiveValue`, `otherCargoValue`, `otherCargoRaw`, `cargoValue`, `deathCost`. Note: the escape path (snapshot -> respawn -> restore) keeps everything, so the architect compares `deathCost` against the risk of dying, not against escape cost.

### 4.6 Value table

Columns: `id | value_per_item | category | notes`. Categories: ore, ingot, gem, gear, tool, weapon, armour, food, block_common, block_rare, mob_drop, misc.

| id | value_per_item | category | notes |
|---|---|---|---|
| minecraft:dirt | 0.1 | block_common |  |
| minecraft:grass_block | 0.1 | block_common |  |
| minecraft:coarse_dirt | 0.1 | block_common |  |
| minecraft:podzol | 0.1 | block_common |  |
| minecraft:mycelium | 0.1 | block_common |  |
| minecraft:sand | 0.1 | block_common |  |
| minecraft:red_sand | 0.1 | block_common |  |
| minecraft:gravel | 0.1 | block_common |  |
| minecraft:cobblestone | 0.1 | block_common |  |
| minecraft:stone | 0.1 | block_common |  |
| minecraft:deepslate | 0.1 | block_common |  |
| minecraft:cobbled_deepslate | 0.1 | block_common |  |
| minecraft:andesite | 0.1 | block_common |  |
| minecraft:diorite | 0.1 | block_common |  |
| minecraft:granite | 0.1 | block_common |  |
| minecraft:tuff | 0.1 | block_common |  |
| minecraft:netherrack | 0.1 | block_common |  |
| minecraft:sandstone | 0.1 | block_common |  |
| minecraft:red_sandstone | 0.1 | block_common |  |
| minecraft:clay | 0.1 | block_common |  |
| minecraft:mud | 0.1 | block_common |  |
| minecraft:stone_bricks | 0.1 | block_common |  |
| minecraft:blackstone | 0.1 | block_common |  |
| minecraft:end_stone | 0.1 | block_common |  |
| minecraft:flint | 0.2 | misc |  |
| minecraft:clay_ball | 0.2 | misc |  |
| minecraft:oak_log | 0.5 | block_common |  |
| minecraft:stripped_oak_log | 0.5 | block_common |  |
| minecraft:oak_planks | 0.15 | block_common |  |
| minecraft:oak_sapling | 0.3 | misc |  |
| minecraft:spruce_log | 0.5 | block_common |  |
| minecraft:stripped_spruce_log | 0.5 | block_common |  |
| minecraft:spruce_planks | 0.15 | block_common |  |
| minecraft:spruce_sapling | 0.3 | misc |  |
| minecraft:birch_log | 0.5 | block_common |  |
| minecraft:stripped_birch_log | 0.5 | block_common |  |
| minecraft:birch_planks | 0.15 | block_common |  |
| minecraft:birch_sapling | 0.3 | misc |  |
| minecraft:jungle_log | 0.5 | block_common |  |
| minecraft:stripped_jungle_log | 0.5 | block_common |  |
| minecraft:jungle_planks | 0.15 | block_common |  |
| minecraft:jungle_sapling | 0.3 | misc |  |
| minecraft:acacia_log | 0.5 | block_common |  |
| minecraft:stripped_acacia_log | 0.5 | block_common |  |
| minecraft:acacia_planks | 0.15 | block_common |  |
| minecraft:acacia_sapling | 0.3 | misc |  |
| minecraft:dark_oak_log | 0.5 | block_common |  |
| minecraft:stripped_dark_oak_log | 0.5 | block_common |  |
| minecraft:dark_oak_planks | 0.15 | block_common |  |
| minecraft:dark_oak_sapling | 0.3 | misc |  |
| minecraft:mangrove_log | 0.5 | block_common |  |
| minecraft:stripped_mangrove_log | 0.5 | block_common |  |
| minecraft:mangrove_planks | 0.15 | block_common |  |
| minecraft:mangrove_propagule | 0.3 | misc |  |
| minecraft:cherry_log | 0.5 | block_common |  |
| minecraft:stripped_cherry_log | 0.5 | block_common |  |
| minecraft:cherry_planks | 0.15 | block_common |  |
| minecraft:cherry_sapling | 0.3 | misc |  |
| minecraft:pale_oak_log | 0.5 | block_common |  |
| minecraft:stripped_pale_oak_log | 0.5 | block_common |  |
| minecraft:pale_oak_planks | 0.15 | block_common |  |
| minecraft:pale_oak_sapling | 0.3 | misc |  |
| minecraft:bamboo_planks | 0.15 | block_common |  |
| minecraft:crimson_stem | 0.5 | block_common | nether wood |
| minecraft:warped_stem | 0.5 | block_common | nether wood |
| minecraft:stick | 0.05 | misc |  |
| minecraft:charcoal | 0.8 | misc |  |
| minecraft:coal | 1 | ore |  |
| minecraft:coal_ore | 1.2 | ore | silk touch only |
| minecraft:deepslate_coal_ore | 1.2 | ore | silk touch only |
| minecraft:coal_block | 9 | block_rare | 9 coal |
| minecraft:raw_copper | 0.8 | ore |  |
| minecraft:copper_ore | 1 | ore | silk touch only |
| minecraft:deepslate_copper_ore | 1 | ore | silk touch only |
| minecraft:raw_copper_block | 7.2 | block_rare | 9 raw_copper |
| minecraft:copper_ingot | 1 | ingot |  |
| minecraft:copper_nugget | 0.1 | ingot |  |
| minecraft:copper_block | 9 | block_rare | 9 copper_ingot |
| minecraft:raw_iron | 3 | ore |  |
| minecraft:iron_ore | 3.5 | ore | silk touch only |
| minecraft:deepslate_iron_ore | 3.5 | ore | silk touch only |
| minecraft:raw_iron_block | 27 | block_rare | 9 raw_iron |
| minecraft:iron_ingot | 4 | ingot |  |
| minecraft:iron_nugget | 0.4 | ingot |  |
| minecraft:iron_block | 36 | block_rare | 9 iron_ingot |
| minecraft:raw_gold | 5 | ore |  |
| minecraft:gold_ore | 5.5 | ore | silk touch only |
| minecraft:deepslate_gold_ore | 5.5 | ore | silk touch only |
| minecraft:nether_gold_ore | 1.5 | ore | drops 2-6 gold nuggets |
| minecraft:raw_gold_block | 45 | block_rare | 9 raw_gold |
| minecraft:gold_ingot | 6 | ingot |  |
| minecraft:gold_nugget | 0.7 | ingot |  |
| minecraft:gold_block | 54 | block_rare | 9 gold_ingot |
| minecraft:redstone | 1.5 | gem |  |
| minecraft:redstone_ore | 1.8 | ore | silk touch only |
| minecraft:deepslate_redstone_ore | 1.8 | ore | silk touch only |
| minecraft:redstone_block | 13.5 | block_rare | 9 redstone |
| minecraft:lapis_lazuli | 2 | gem |  |
| minecraft:lapis_ore | 2.5 | ore | silk touch only |
| minecraft:deepslate_lapis_ore | 2.5 | ore | silk touch only |
| minecraft:lapis_block | 18 | block_rare | 9 lapis_lazuli |
| minecraft:quartz | 2 | gem | nether quartz |
| minecraft:quartz_ore | 2.5 | ore | silk touch only; Bedrock id is quartz_ore (verify) |
| minecraft:quartz_block | 8 | block_rare | 4 quartz |
| minecraft:amethyst_shard | 2 | gem |  |
| minecraft:amethyst_block | 8 | block_rare | 4 amethyst_shard |
| minecraft:emerald | 15 | gem |  |
| minecraft:emerald_ore | 17 | ore | silk touch only |
| minecraft:deepslate_emerald_ore | 17 | ore | silk touch only |
| minecraft:emerald_block | 135 | block_rare | 9 emerald |
| minecraft:diamond | 40 | gem |  |
| minecraft:diamond_ore | 45 | ore | silk touch only |
| minecraft:deepslate_diamond_ore | 45 | ore | silk touch only |
| minecraft:diamond_block | 360 | block_rare | 9 diamond |
| minecraft:ancient_debris | 35 | ore | 1 debris smelts to 1 scrap |
| minecraft:netherite_scrap | 30 | ingot |  |
| minecraft:netherite_ingot | 150 | ingot | design value (4 scrap + 4 gold_ingot = 144) |
| minecraft:netherite_block | 1350 | block_rare | 9 netherite_ingot |
| minecraft:obsidian | 2 | block_rare |  |
| minecraft:crying_obsidian | 4 | block_rare |  |
| minecraft:glowstone | 3 | block_rare |  |
| minecraft:enchanting_table | 100 | block_rare |  |
| minecraft:ender_chest | 30 | block_rare |  |
| minecraft:beacon | 600 | block_rare |  |
| minecraft:anvil | 40 | block_rare |  |
| minecraft:crafting_table | 0.6 | block_common |  |
| minecraft:chest | 0.6 | block_common |  |
| minecraft:barrel | 0.6 | block_common |  |
| minecraft:furnace | 1 | block_common |  |
| minecraft:rotten_flesh | 0.1 | mob_drop | also avoid-food |
| minecraft:bone | 0.3 | mob_drop |  |
| minecraft:bone_meal | 0.1 | misc |  |
| minecraft:string | 0.5 | mob_drop |  |
| minecraft:gunpowder | 2 | mob_drop |  |
| minecraft:spider_eye | 0.3 | mob_drop | also avoid-food |
| minecraft:feather | 0.3 | mob_drop |  |
| minecraft:leather | 1 | mob_drop |  |
| minecraft:rabbit_hide | 0.5 | mob_drop |  |
| minecraft:rabbit_foot | 5 | mob_drop |  |
| minecraft:ink_sac | 0.5 | mob_drop |  |
| minecraft:glow_ink_sac | 1 | mob_drop |  |
| minecraft:slime_ball | 1 | mob_drop |  |
| minecraft:phantom_membrane | 3 | mob_drop |  |
| minecraft:arrow | 0.2 | weapon | ammo; counted as weapon but stackable |
| minecraft:spectral_arrow | 0.5 | weapon | ammo |
| minecraft:ender_pearl | 8 | mob_drop |  |
| minecraft:ender_eye | 14 | misc | Bedrock id is ender_eye (verify) |
| minecraft:blaze_rod | 8 | mob_drop |  |
| minecraft:blaze_powder | 4 | misc |  |
| minecraft:ghast_tear | 25 | mob_drop |  |
| minecraft:magma_cream | 3 | mob_drop |  |
| minecraft:shulker_shell | 30 | mob_drop |  |
| minecraft:nautilus_shell | 40 | misc |  |
| minecraft:heart_of_the_sea | 150 | misc |  |
| minecraft:echo_shard | 20 | misc |  |
| minecraft:nether_star | 250 | misc |  |
| minecraft:breeze_rod | 10 | mob_drop |  |
| minecraft:heavy_core | 100 | misc |  |
| minecraft:turtle_scute | 6 | mob_drop |  |
| minecraft:armadillo_scute | 5 | mob_drop |  |
| minecraft:experience_bottle | 6 | misc |  |
| minecraft:name_tag | 25 | misc |  |
| minecraft:saddle | 30 | misc |  |
| minecraft:lead | 3 | misc |  |
| minecraft:enchanted_book | 20 | misc | base value; add 10 per enchant level via rule 4.3.1 (mending +50) |
| minecraft:book | 1 | misc |  |
| minecraft:wind_charge | 1 | weapon |  |
| minecraft:golden_apple | 45 | food | emergency food; design value (8 gold ingots = 48) |
| minecraft:enchanted_golden_apple | 250 | food | cannot be crafted, loot only |
| minecraft:golden_carrot | 8 | food |  |
| minecraft:honey_bottle | 1.5 | food |  |
| minecraft:milk_bucket | 13 | tool | not food; bucket 12 + milk; unused in Phase 3 |
| minecraft:potion | 3 | misc | not food; any potion; unused in Phase 3 |
| minecraft:shield | 6 | gear | 6 planks + 1 iron |
| minecraft:bow | 3 | weapon |  |
| minecraft:crossbow | 8 | weapon |  |
| minecraft:trident | 80 | weapon | rare drop (drowned) |
| minecraft:mace | 200 | weapon |  |
| minecraft:totem_of_undying | 100 | gear |  |
| minecraft:elytra | 250 | gear | unreplaceable |
| minecraft:turtle_helmet | 40 | armour | 5 turtle_scute |
| minecraft:fishing_rod | 2 | tool |  |
| minecraft:shears | 8 | tool | 2 iron |
| minecraft:flint_and_steel | 5 | tool |  |
| minecraft:bucket | 12 | tool | 3 iron |
| minecraft:water_bucket | 13 | tool |  |
| minecraft:lava_bucket | 14 | tool |  |
| minecraft:leather_helmet | 5 | armour |  |
| minecraft:leather_chestplate | 8 | armour |  |
| minecraft:leather_leggings | 7 | armour |  |
| minecraft:leather_boots | 4 | armour |  |
| minecraft:chainmail_helmet | 12.5 | armour | loot/trade only |
| minecraft:chainmail_chestplate | 20 | armour | loot/trade only |
| minecraft:chainmail_leggings | 17.5 | armour | loot/trade only |
| minecraft:chainmail_boots | 10 | armour | loot/trade only |
| minecraft:golden_helmet | 30 | armour |  |
| minecraft:golden_chestplate | 48 | armour |  |
| minecraft:golden_leggings | 42 | armour |  |
| minecraft:golden_boots | 24 | armour |  |
| minecraft:copper_helmet | 5 | armour | (verify exists) |
| minecraft:copper_chestplate | 8 | armour | (verify exists) |
| minecraft:copper_leggings | 7 | armour | (verify exists) |
| minecraft:copper_boots | 4 | armour | (verify exists) |
| minecraft:iron_helmet | 20 | armour |  |
| minecraft:iron_chestplate | 32 | armour |  |
| minecraft:iron_leggings | 28 | armour |  |
| minecraft:iron_boots | 16 | armour |  |
| minecraft:diamond_helmet | 200 | armour |  |
| minecraft:diamond_chestplate | 320 | armour |  |
| minecraft:diamond_leggings | 280 | armour |  |
| minecraft:diamond_boots | 160 | armour |  |
| minecraft:netherite_helmet | 350 | armour | diamond piece + netherite_ingot |
| minecraft:netherite_chestplate | 470 | armour | diamond piece + netherite_ingot |
| minecraft:netherite_leggings | 430 | armour | diamond piece + netherite_ingot |
| minecraft:netherite_boots | 310 | armour | diamond piece + netherite_ingot |
| minecraft:wooden_sword | 0.4 | weapon |  |
| minecraft:wooden_pickaxe | 0.6 | tool |  |
| minecraft:wooden_axe | 0.6 | tool |  |
| minecraft:wooden_shovel | 0.2 | tool |  |
| minecraft:wooden_hoe | 0.4 | tool |  |
| minecraft:stone_sword | 0.4 | weapon |  |
| minecraft:stone_pickaxe | 0.6 | tool |  |
| minecraft:stone_axe | 0.6 | tool |  |
| minecraft:stone_shovel | 0.2 | tool |  |
| minecraft:stone_hoe | 0.4 | tool |  |
| minecraft:copper_sword | 2 | weapon | (verify exists) |
| minecraft:copper_pickaxe | 3 | tool | (verify exists) |
| minecraft:copper_axe | 3 | tool | (verify exists) |
| minecraft:copper_shovel | 1 | tool | (verify exists) |
| minecraft:copper_hoe | 2 | tool | (verify exists) |
| minecraft:golden_sword | 12 | weapon |  |
| minecraft:golden_pickaxe | 18 | tool |  |
| minecraft:golden_axe | 18 | tool |  |
| minecraft:golden_shovel | 6 | tool |  |
| minecraft:golden_hoe | 12 | tool |  |
| minecraft:iron_sword | 8 | weapon |  |
| minecraft:iron_pickaxe | 12 | tool |  |
| minecraft:iron_axe | 12 | tool |  |
| minecraft:iron_shovel | 4 | tool |  |
| minecraft:iron_hoe | 8 | tool |  |
| minecraft:diamond_sword | 80 | weapon |  |
| minecraft:diamond_pickaxe | 120 | tool |  |
| minecraft:diamond_axe | 120 | tool |  |
| minecraft:diamond_shovel | 40 | tool |  |
| minecraft:diamond_hoe | 80 | tool |  |
| minecraft:netherite_sword | 230 | weapon | diamond piece + netherite_ingot |
| minecraft:netherite_pickaxe | 270 | tool | diamond piece + netherite_ingot |
| minecraft:netherite_axe | 270 | tool | diamond piece + netherite_ingot |
| minecraft:netherite_shovel | 190 | tool | diamond piece + netherite_ingot |
| minecraft:netherite_hoe | 230 | tool | diamond piece + netherite_ingot |
| minecraft:wooden_spear | 0.4 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:stone_spear | 0.4 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:copper_spear | 2 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:golden_spear | 12 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:iron_spear | 8 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:diamond_spear | 80 | weapon | (verify exists in 1.26; value = sword value) |
| minecraft:netherite_spear | 230 | weapon | (verify exists in 1.26) |

Pattern rows (apply after exact rows, in this order):

| id pattern | value_per_item | category | notes |
|---|---|---|---|
| `minecraft:*_log`, `minecraft:*_wood`, `minecraft:stripped_*_wood` | 0.5 | block_common | any wood species not listed above |
| `minecraft:*_planks`, `minecraft:*_slab`, `minecraft:*_stairs`, `minecraft:*_fence`, `minecraft:*_door` | 0.15 | block_common | wood and stone derivatives |
| `minecraft:*_sapling`, `minecraft:*_leaves` | 0.3 | misc | |
| `minecraft:*_ore` not listed above | 2 | ore | |
| `minecraft:raw_*` not listed above | 2 | ore | |
| `minecraft:*_wool`, `minecraft:*_carpet`, `minecraft:*_concrete`, `minecraft:*_terracotta`, `minecraft:*_glass` | 0.2 | block_common | |
| `minecraft:*_spawn_egg`, `minecraft:*_banner_pattern`, `minecraft:music_disc_*` | 20 | misc | rare novelties |
| any FOOD id not above | `0.25 x hunger`, or 0.1 if tagged `avoid` | food | rule 4.3.4 |

Verify list for Section 4: existence and ids of copper tools/armour and spears in 1.26 (rows marked); ancient debris and netherite chain; Bedrock ids `quartz_ore`, `ender_eye`, `mangrove_propagule`; every numeric value is a design choice, not a game fact. Decision: keep every row marked `(verify exists)`; an id that does not exist in the game is never matched, so a stale row is harmless.

---

## SECTION 5. Worked examples

### Example 1: topup, no threats
State: hunger 14, saturation 2, HP 20/20, inventory 5 `bread`, 2 `cooked_beef`, 1 `golden_apple`. No hostile within 24 blocks.
- Situation: topup (hunger <= 17, missing = 6).
- Tag `topup` has eligible: bread (hunger 5 <= 6). cooked_beef is `main` only.
- `fit_largest`: bread (5 <= 6). **Eat `minecraft:bread`** (32 ticks). Result hunger 19, saturation min(19, 2+6) = 8.
- golden_apple is `emergency`, never chosen here.

### Example 2: same bot, HP 6, zombies 10 blocks away
State: hunger 14, saturation 2, HP 6/20, 3 zombies at 10 blocks.
- HP <= 6 and hostile within 16 -> situation `emergency`.
- Eat guard: the normal guard threshold is `32 / 20 * 5 + 2 = 10` blocks; the zombies are at 10 blocks and eating needs `distance > threshold` (strict, 10.0 is not > 10), so a normal meal is blocked. `emergency` may start with a closer threat: contact in about 10 / 5 = 2 s = 40 ticks, eat_ticks = 32, so the apple finishes before contact (margin 8 ticks; emergency may start with a smaller margin than the normal 20). No melee mob is within 2 blocks, so the emergency exception applies.
- `fixed_order`: enchanted_golden_apple (not held), golden_apple (held). **Eat `minecraft:golden_apple`** (Regeneration II 5 s, Absorption I 120 s).
- After the apple is eaten the state is hunger min(20, 14+4) = 18, saturation min(18, 2+9.6) = 11.6. After the threat is handled or if there are 2+ s of space: `pre_engage_heal` picks by sat_gain from that state: cooked_beef (`sat_after = min(min(20, 18+8), 11.6+12.8) = min(20, 24.4) = 20`, gain 20 - 11.6 = 8.4) beats bread (`sat_after = min(min(20, 18+5), 11.6+6) = 17.6`, gain 6.0). So the next meal is `cooked_beef`.
- If HP were 12 instead (not emergency): pre_engage_heal directly picks `cooked_beef` from the original state (hunger 14, saturation 2): cooked_beef `sat_after = min(20, 2+12.8) = 14.8`, gain 12.8; bread `min(19, 2+6) = 8`, gain 6.

### Example 3: starving
State: hunger 3, HP 14, inventory: 3 `rotten_flesh`, 1 `spider_eye`, 2 `chicken`, 1 `pufferfish`. No safe food.
- Situation `starving` (hunger <= 6, no eligible topup/main/raw item; the 2 `chicken` are tagged `avoid` only, not `raw`, so they do not make `starving` false).
- avoid_order: rotten_flesh first (no condition). **Eat `minecraft:rotten_flesh`** (+4 hunger, hunger effect 80% 30 s). Repeat while hunger <= 6; then chicken, then spider_eye (HP >= 8 ok), pufferfish never (needs HP >= 12 and hunger <= 2).

### Example 4: cargo and gear value
State: 3 `diamond`, 32 `dirt`; equipped full iron armour (undamaged, unenchanted) and an `iron_sword` at 50% durability (not objective items, no task).
- diamonds: 3 x 40 = 120. dirt: 32 x 0.1 = 3.2. otherCargoRaw = 123.2; otherCargoValue = min(900, 123.2) = 123.2.
- armour: helmet 20 + chestplate 32 + leggings 28 + boots 16 = 96. iron_sword: 8 x max(0.25, 0.5) = 4. gearValue = 100.
- objectiveValue = 0 (no task; same for `goto`, `defend`, `idle`: no objective items, so the decision rests on gear and cargo value alone). The held `iron_sword` is one inventory slot and is counted once. cargoValue = 123.2. deathCost = 100 + 123.2 = 223.2.
- Same bot with the chestplate enchanted Protection IV + Unbreaking III + Mending: sum levels 7, mult = min(3, 1 + 0.7 + 0.5) = 2.2 -> chestplate 70.4, gearValue 138.4.

### Example 5: objective dominance (iron)
Task: gather 16 `iron_ore` (objectiveItems = `minecraft:raw_iron`, requiredAmount 16, 0 deposited). Bot holds 16 `raw_iron`, 3 `diamond`, 20 `cobblestone`.
- progress = min(16, 16)/16 = 1.0; objectiveValue = 1000.
- otherCargoRaw = 120 + 2.0 = 122 -> otherCargoValue 122. cargoValue = 1122.
- Holding only 5 raw_iron: objectiveValue = 1000 x 5/16 = 312.5. The diamonds (120) are worth less than that partial progress; even 900 worth of other cargo cannot beat 1000 of full progress.

### Example 6: objective dominance (logs)
Task: gather 64 `oak_log` (requiredAmount 64, 0 deposited). Bot holds 64 `oak_log` -> objectiveValue = 1000 (top). Holds 10 -> 1000 x 10/64 = 156.25 (modest). Holds 80 -> objectiveValue 1000 and the 16 surplus logs count as ordinary cargo 16 x 0.5 = 8. If 40 were already deposited and the task is now at 24 required: holding 24 -> 1000, holding 12 -> 500.

### Example 7: escape teleport
State: HP 4, hunger 18, two skeleton archers + a zombie in melee at 1 block, no home reachable (escape-rejoin unavailable), inventory has 1 `chorus_fruit`, 1 `cooked_beef`.
- Trigger: HP <= 6, melee within 3 blocks, no escape-rejoin -> `escape_teleport`. **Eat `minecraft:chorus_fruit`** (random teleport up to about 8 blocks, 32 ticks; HP <= 4 so the in-melee guard is relaxed).
- Not chosen: cooked_beef (not in the escape tag list).

---

## Revision log (review pass 1)

Note: an earlier reviser was interrupted; each finding below was re-checked against the text. "applied (earlier)" = already present, verified; the rest were applied in this pass.

DECISIONS: D20 (honey_bottle follows normal hunger rules): applied (earlier) in section 1 always-edible row, 3.1 `always_edible`, 3.4 JSON `alwaysEdible`, section 2 verify list; no `honey_bottle` always-edible entry remains.

- TABLES--completeness#1: changed (earlier). Milk bucket/potion note added to 3.3 and rows added to 4.6; values are `milk_bucket` 13 (bucket 12 + milk) and `potion` 3, not the 2 the finding suggests, since the bucket itself has value 12. Unused in Phase 3.
- TABLES--completeness#2: changed (earlier). Config keys added in 4.2 as `config.combat.<camelCase>` (precision#7 wins over `config.value.*`; one key scheme only).
- TABLES--completeness#3: applied (4.4 sentence earlier; Example 4 now names goto/defend/idle and states the held sword is counted once).
- TABLES--completeness#4: applied (earlier in 3.1/Example 2; wording cleaned in this pass to a strict `distance > threshold` rule: at 10.0 blocks the bot does not eat).
- TABLES--consistency#1: applied (earlier). 4.5 `gearValue` counts mainhand once via the 36 inventory slots; never added separately.
- TABLES--game-api#1: applied (earlier). Honey removed from every always-edible list (section 1, 3.1, 3.4); verify list says "decided".
- TABLES--game-api#2: applied (earlier). Fallback sentence added to the Section 2 verify list (also corrected to the 3.2 pufferfish rule: `hunger <= 2` and `hp >= 12`).
- TABLES--logic#1: applied (earlier). Chicken tag is `avoid` only; `eligible()` admits `avoid` items only in `starving`.
- TABLES--logic#2: applied (earlier). `golden_carrot` exclusion from `topup` in `eligible()` item (2).
- TABLES--logic#3: applied (earlier). Same as consistency#1.
- TABLES--logic#4: applied (earlier). 4.3.1 excludes mending's level from the sum (2.2 example).
- TABLES--logic#5: applied (earlier). Example 2 recomputed after the apple (8.4 vs 6.0).
- TABLES--logic#6: changed. Unused `stew` tag removed from the `starving` row and the 3.4 JSON; `emergency` kept (used in 3.3 as last choice). The `missing >= 2` clause is KEPT with an explanatory note (precision#5 wins: S2b lists `topupMinMissing`).
- TABLES--precision#1: applied (earlier). Chicken row tags `avoid`; `eligible()` rule added; Example 3 now notes why `starving` holds.
- TABLES--precision#2: applied (earlier). Same as consistency#1.
- TABLES--precision#3: applied (earlier). Expected-net formula and chicken +0.875 in section 1.
- TABLES--precision#4: applied (earlier). `fast_regen_active = hunger === 20 && saturation > 0`.
- TABLES--precision#5: applied (earlier). Note in 3.1 `topup` trigger.
- TABLES--precision#6: applied (earlier). `escape_teleport` trigger uses "holds no eligible item with tag `emergency`".
- TABLES--precision#7: applied (earlier). 4.2 table has config key column (`config.combat.*`; four constants stay plain `const`s in `values.ts`).
- TABLES--precision#8: applied (earlier). golden_apple and netherite_ingot notes say "design value".
- TABLES--precision#9: applied (earlier). Decision added to the Section 4 verify list.
- TABLES--precision#10: applied (earlier). Pseudo-effect placeholder sentence added to Section 2.
