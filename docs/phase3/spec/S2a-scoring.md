# S2a: derived quantities and option scores (`src/core/combat/scoring.ts`)

Owner of: `Knowledge`, `FoodEntry`, `FoodTag`, `FoodEffect`, `ItemValueEntry`, `ItemCategory`, `Rng`, `OptionScores`, `ThreatEval`, `Derived`, `computeDerived`, `scoreOptions`, `computeValueSummary`, `stackValue`, `hasUsableShield`, `botWeaponDamage`, and the `config.combat` keys of section 9.
Not owned (read only): `Percept`, `SelfPercept`, `EntityPercept`, `ValueSummary` (S1 section 1), `MobEntry`, `TacticName`, `Condition` (S3 section 2), `FoodSituation`, `FoodChoice`, `Commit`, `Decision` (S2b), and the S2b keys `criticalHp`, `switchMargin` (decision D3: one definition, owned by S2b).
Builder: **B1** (`scoring.ts`, pure: no `@minecraft/*`, no clock, no `Math.random`, no `Rng` call). **B2** transcribes the tables in sections 2 and 4 and the glue in `knowledge.ts`.

Conventions: distances in blocks, times in ticks (20/s), HP in points, one pump = 4 ticks. Every `cfg.*` is a `config.combat` key (S1 section 10, S2b section 8, section 9 here). Scores are finite numbers in about [0, 1.7]; a larger score wins; S2b masks and breaks ties. Functions never mutate their arguments and are deterministic for equal inputs.

**Decisions this file implements:** D1 (`Knowledge` has `mob`, `food`, `value`), D2 (reads the optional Percept fields `canBlock`, `shieldDisabled`, `objectiveItemIds`; `terrain`, `tacticFeedback` and `EntityPercept.inWater` are used by S2b only), D3 (reads `criticalHp`), D20 (sharpness is not modelled, section 3.2).

---

## 1. Public API

### 1.1 Shared data types (`src/core/combat/types.ts`, contract writer; S2a part)

```ts
export type Rng = () => number;                       // [0, 1). Defined here for S2b; scoring.ts never calls it.
export type OptionScores = Record<OptionKind, number>; // OptionKind: PHASE3-SPEC 4

export type FoodTag = "topup" | "main" | "raw" | "stew" | "avoid" | "emergency" | "escape" | "fast" | "regen";
/** One effect of TABLES 2 `effect:level:seconds:chance_percent`. `id` has no "minecraft:" prefix; pseudo ids: "teleport", "cure_poison", "varies". */
export interface FoodEffect { id: string; level: number; seconds: number; chancePct: number }
export interface FoodEntry {
  id: string;                    // "minecraft:cooked_beef"
  hunger: number;                // points restored
  saturation: number;            // points restored (TABLES 2 column, NOT the modifier)
  eatTicks: number;              // 32, dried_kelp 16, honey_bottle 40
  effects: FoodEffect[];         // [] if none. S2b tests poison with f.effects.some(e => e.id === "poison")
  returnsItem?: string;          // "minecraft:bowl" | "minecraft:glass_bottle"
  tags: FoodTag[];
}

export type ItemCategory = "ore" | "ingot" | "gem" | "gear" | "tool" | "weapon" | "armour" | "food" | "block_common" | "block_rare" | "mob_drop" | "misc";
export const GEAR_CATEGORIES: readonly ItemCategory[] = ["gear", "tool", "weapon", "armour"];   // TABLES 4.1: lost on death, counted in gearValue
export interface ItemValueEntry { id: string; valuePerItem: number; category: ItemCategory; notes?: string }  // one TABLES 4.6 row (patterns expanded)

/** The only door to the data tables. Built once by B2 (`createKnowledge`, section 1.2) and passed to every pure function. */
export interface Knowledge {
  /** MOBS entry; never undefined: exact id, then variant, then Phase 5 stub (S3 `stubToEntry`), then the default entry. = S3 `lookupMob`. */
  mob(typeId: string): MobEntry;
  /** FOOD row or undefined. = `foodEntry`. */
  food(typeId: string): FoodEntry | undefined;
  /** Base value of ONE item (TABLES 4.6 exact row, then pattern row, then rule 4.3.4 food, then rule 4.3.3 unknown).
   *  `maxAmount` (stack size) is used only for an unknown non-food id: > 1 gives 1, == 1 gives 5; omitted counts as stackable.
   *  No durability or enchant factor here. */
  value(typeId: string, maxAmount?: number): number;
  /** TABLES 4.6 category; foods not in the value table: "food"; unknown: "misc". */
  category(typeId: string): ItemCategory;
}
```

### 1.2 Glue (`src/core/combat/knowledge.ts`, new file, B2; the Reconciler adds it to the PHASE3-SPEC 6 ownership table)

```ts
import { lookupMob } from "./mobs.js"; import { foodEntry } from "./food.js"; import { itemValue, itemCategory } from "./values.js";
export function createKnowledge(mobs: MobKnowledge): Knowledge {
  return {
    mob: (id) => lookupMob(mobs, id),
    food: (id) => foodEntry(id),
    value: (id, maxAmount) => itemValue(id, maxAmount),
    category: (id) => itemCategory(id),
  };
}
export const KNOWLEDGE: Knowledge;   // createKnowledge(MOB_KNOWLEDGE); what the runtime passes to BrainFn
```

### 1.3 Exports of `scoring.ts` (fixed; S2b is written against these names)

```ts
export function computeDerived(p: Percept, kb: Knowledge, cfg: CombatConfig): Derived;
export function scoreOptions(p: Percept, d: Derived, kb: Knowledge, cfg: CombatConfig): OptionScores;

// helpers other modules may import
export function computeValueSummary(inv: InventorySummary, eq: EquipmentView, objective: { ids: readonly string[]; required: number } | undefined, kb: Knowledge, cfg: CombatConfig): ValueSummary;
export function stackValue(it: StackLike, kb: Knowledge, cfg: CombatConfig): number;
export function hasUsableShield(p: Percept, cfg: CombatConfig): boolean;      // = S2b `botHasShield`; S2b imports this one (no copy)
export function botWeaponDamage(s: SelfPercept, cfg: CombatConfig): number;   // section 3.2
export function armourReduction(totalArmor: number, cfg: CombatConfig): number;
export function mobSpeedBpt(typeId: string, entry: MobEntry, isBaby: boolean, cfg: CombatConfig): number;
export const MOB_ATTACK_INTERVAL_TICKS: Readonly<Record<string, number>>;     // section 2
export const SPEED_BY_CLASS: Readonly<Record<MoveSpeed, number>>;
export const SPEED_OVERRIDE: Readonly<Record<string, number>>;
export const ALWAYS_EDIBLE: readonly string[];
```
Import direction: `scoring.ts` imports `evalCondition`/`CondEnv` from `stats.ts` (flee_if evaluation). `stats.ts` and `brain.ts` must not be imported by `sense.ts`/`values.ts`; `stats.ts` must NOT import `scoring.ts` (no cycle). `brain.ts` imports both.

`computeValueSummary` replaces the S1 section 12 signature `computeValueSummary(inv, eq, objective?)`: it gains `kb` and `cfg` (S1 request, section 10). `StackLike = { typeId: string; amount: number; maxAmount?: number; durabilityFrac: number; enchantLevelSum?: number; mending?: boolean }` (`SlotItem` satisfies it).

### 1.4 `ThreatEval` and `Derived`

```ts
/** One threat-classified entity (classification === "threat", distance <= cfg.scanRadius), any relevance. */
export interface ThreatEval {
  id: string; typeId: string; mobId: string;           // mobId = MobEntry.id
  distance: number;
  relevance: Relevance; relevant: boolean;             // relevant = relevance !== "irrelevant"
  policy: EngagePolicy; moveClass: MoveSpeed; danger: number;
  ranged: boolean; explodes: boolean; lineOfSight: boolean; attackRange: number;   // attackRange = MobEntry.attack_range_blocks
  targetingMe: boolean; hurtMe: boolean; threatensProtected: boolean;              // hurtMe = hurtMeAtTick !== undefined
  attackable: boolean;                                 // attackAllowed && (inLeash || distance <= 3.5)   (S1 L1)
  hpNow: number; hpFrac: number;                       // e.hp ?? entry.hp ; clamp(hpNow / entry.hp, 0, 1)
  speedBpt: number;                                    // blocks per tick, section 3.1
  contactTicks: number;                                // ticks until it can hurt the bot
  proximity: number;                                   // 0..1
  threatLevel: number;                                 // section 3.3
  dpsPerTick: number;                                  // expected HP per tick after armour (0 for explodes)
  burst: number;                                       // expected explosion HP at the current distance (explodes only)
  killTicks: number;                                   // ticks the bot needs to kill it alone
  expectedDamage: number;                              // HP this mob deals before it dies (relevant mobs only, section 3.6)
  fleeIf: boolean;                                     // relevant && any MOBS flee_if condition holds
  eatContactTicks: number;                             // like contactTicks with the eat-guard speed floor
}
export interface FoodPick { typeId: string; slot: number; eatTicks: number; hunger: number; saturation: number }

export interface Derived {
  difficulty: Difficulty;                // Percept.env.difficulty, "peaceful" read as "normal"
  armourReduction: number;               // 0..cfg.armorReductionCap
  hpSafe: number;                        // max(self.hp, 1)
  threats: ThreatEval[];                 // ALL threat-classified entities, sorted by (contactTicks, id)
  totalThreat: number;                   // sum of threatLevel over relevant threats
  threatPressure: number;                // 1 - exp(-totalThreat)
  exposure: number;                      // max proximity over relevant threats, 0 if none
  botWeaponDamage: number;               // HP per hit
  botOffenceDps: number;                 // HP per second
  expectedIncomingDps: number;           // HP per second, relevant threats weighted by proximity
  timeToKillTicks: number;               // all attackable relevant threats, one after the other
  timeToDieTicks: number;                // hp / expectedIncomingDps in ticks; 6000 when the dps is 0
  hasUnkillable: boolean;                // some relevant threat is not attackable
  expectedDamage: number;                // HP lost if the bot fights everything relevant (section 3.6)
  damageRatio: number;                   // expectedDamage / hpSafe
  maxBurst: number;                      // largest explosion HP among relevant threats
  deathRisk: number;                     // 0..1, section 3.7
  lowHp: number;                         // 0..1, section 3.8
  urgency: number;                       // exposure * max(deathRisk, lowHp)
  escapeDrive: number;                   // exposure * max(lowHp, escapeRiskWeight * deathRisk)
  gearValue: number; objectiveValue: number; otherCargoValue: number; cargoValue: number; deathCost: number;   // copied from self.values
  valueWeight: number;                   // deathCost / (deathCost + escapeValueHalf), 0..1
  retreatEff: number;                    // 0..1, section 3.9
  avoidPressure: number;                 // 0..1, section 3.10
  hasUsableShield: boolean;
  fleeIfActive: boolean;                 // any relevant threat with fleeIf
  hunger: number;                        // self.hungerKnown ? self.hunger : 20
  starving: boolean; canRegen: boolean; hungerNeed: number; healWant: number;
  food: { heal?: FoodPick; topup?: FoodPick; starve?: FoodPick; emergency?: FoodPick };
  eatTicksRef: number;                   // eatTicks used for the safety test
  eatNeedTicks: number;                  // ticks of eating still to cover: eating.remainingTicks, else eatTicksRef
  eatMarginTicks: number;                // eatMidMealMarginTicks if eating, else eatSafetyMarginTicks
  minEatContactTicks: number;            // min eatContactTicks over all threats, Infinity if none
  canEatSafely: boolean;                 // minEatContactTicks > eatNeedTicks + eatMarginTicks
  canEatEmergency: boolean;              // not (melee threat within eatMeleeBlockDist and hp > emergencyHpAnyThreat)
  topupWanted: boolean; emergencyEatWanted: boolean;
}
```

### 1.5 Requested Percept addition (S1 adds it, optional so S1's builders compile)

```ts
// Percept gains (the controller fills it from CombatBody.busyEating() and the active EatRequest; undefined when not eating):
eating?: { typeId: string; remainingTicks: number };
```
Fallback when absent: the full `eatTicksRef + eatSafetyMarginTicks` guard applies every pump (a meal in progress is dropped as soon as the guard fails). Nothing else from S1 is needed: `self.values` (ValueSummary) already exists, `env.difficulty` already exists.

---

## 2. Tables (constants in `scoring.ts`; all `(verify)`, all tunable by editing the table)

```ts
export const MOB_ATTACK_INTERVAL_TICKS: Readonly<Record<string, number>> = {   // ticks between two attacks at Normal; key = MobEntry.id
  "minecraft:zombie": 20, "minecraft:husk": 20, "minecraft:drowned": 20, "minecraft:zombie_villager_v2": 20,
  "minecraft:spider": 20, "minecraft:cave_spider": 20, "minecraft:skeleton": 40, "minecraft:stray": 40, "minecraft:bogged": 60,
  "minecraft:pillager": 60, "minecraft:creeper": 20 /* unused: explodes */, "minecraft:witch": 60, "minecraft:enderman": 20,
  "minecraft:slime": 30, "minecraft:magma_cube": 30, "minecraft:silverfish": 20, "minecraft:endermite": 20,
  "minecraft:phantom": 60, "minecraft:warden": 34,
};
export const ATTACK_INTERVAL_DEFAULT = 20;            // any other id, incl. "default" and stubs
export const SPEED_BY_CLASS: Readonly<Record<MoveSpeed, number>> = { slow: 0.20, normal: 0.28, fast: 0.35 };   // blocks per tick = 4.0 / 5.6 / 7.0 per s
export const SPEED_OVERRIDE: Readonly<Record<string, number>> = {
  "minecraft:slime": 0.10, "minecraft:magma_cube": 0.10, "minecraft:phantom": 0.45, "minecraft:enderman": 0.60,   // 0.60 includes teleports
};
export const ALWAYS_EDIBLE: readonly string[] = ["minecraft:golden_apple", "minecraft:enchanted_golden_apple", "minecraft:chorus_fruit", "minecraft:honey_bottle"];
export const EMERGENCY_FOODS: readonly string[] = ["minecraft:enchanted_golden_apple", "minecraft:golden_apple"];   // S2b 5.2 order
export const ATTACK_NEAR_BLOCKS = 3.5;                // S1 L1
```
Class speeds follow MOBS 1.2: `slow` is below the bot's sprint (0.28), `normal` equals it, `fast` exceeds it. Weapon damage is NOT a table here: use `weaponDamage` / `WEAPON_DAMAGE` (S1 6.5: fist 1 via `cfg.fistDamage`, wood and gold sword 4, stone 5, iron 6, diamond 7, netherite 8; axes 3/4/5/6/7 for wood and gold, stone, iron, diamond, netherite).

---

## 3. Derived quantities (formulas; the code in section 6 is the authority)

Sets: `T` = every entity with `classification === "threat"` and `distance <= cfg.scanRadius` (Derived.threats). `R` = the part of `T` with `relevance !== "irrelevant"`. `never_target`, `neutral_unprovoked` and `ignore` entities are not in `T`. Neutral and irrelevant entities only feed `avoidPressure` (3.10).

### 3.1 Per-mob movement, contact and proximity

| Quantity | Formula | Notes |
|---|---|---|
| `speedBpt` | `(SPEED_OVERRIDE[typeId] ?? SPEED_BY_CLASS[entry.move_speed]) * (e.isBaby ? cfg.babySpeedMult : 1)` | blocks per tick; baby 1.5x (MOBS zombie notes) |
| `reach` | `ranged && !e.lineOfSight ? cfg.noLosReach : entry.attack_range_blocks` | `ranged` = `special` has `ranged_projectile`; no LOS: the shooter must come closer |
| `contactTicks` | `max(0, distance - reach) / speedBpt` | 0 when already in reach |
| `proximity` | `clamp(1 - contactTicks / cfg.proxHorizonTicks, 0, 1)` | 1 = can hurt now, 0 = 60 or more ticks away |
| `exposure` | `max(proximity)` over `R`, 0 if `R` is empty | |
| `eatContactTicks` | `max(0, distance - eatReach) / max(speedBpt, cfg.eatGuardThreatSpeed / 20)`; `eatReach = ranged ? (LOS ? min(range, cfg.rangedEatReach) : cfg.noLosReach) : range` | the S2b eat-guard speed (5 b/s = 0.25 b/tick) is a floor: slow mobs count as 0.25 |

### 3.2 Bot offence

| Quantity | Formula |
|---|---|
| `botWeaponDamage` | `max(weaponDamage(mainhand) ?? 0, weaponDamage(inventory[bestWeaponSlot]) ?? 0, cfg.fistDamage)` (same as S2b `timeToKillTicks`). Unarmed = fist 1 (D14). |
| `botOffenceDps` | `botWeaponDamage * 20 / cfg.attackSpacingTicks * cfg.meleeHitRate` HP/s. Spacing 12 ticks = S3 `attackIntervalTicks` 10 rounded up to the 4-tick pump. Iron sword: `6 * 20 / 12 * 0.85 = 8.5`. |

Sharpness and other enchants are not modelled (`enchantLevelSum` mixes all enchants; D20 sets Bedrock sharpness at +1.25 per level, which only helps the bot). This keeps `timeToKill` conservative.

### 3.3 Threat level (per mob) and `totalThreat`

```
dEff        = max(0, distance - 0.5 * max(0, attack_range_blocks - 3))     // ranged mobs count as closer
falloff     = 1 / (1 + (dEff / cfg.threatHalfDist)^2)                      // 8 blocks -> 0.5
vuln        = clamp(cfg.botRefHp / hpSafe, cfg.botVulnMin, cfg.botVulnMax) // danger is rated for a full-HP (20) bot; 6 HP -> 3.0 (cap)
threatLevel = (danger / 10) * falloff * hpFrac * vuln                      // danger: MOBS 0..10; hpFrac: mob HP / entry HP
totalThreat = sum(threatLevel over R);   threatPressure = 1 - exp(-totalThreat)
```
Example: zombie (danger 2) at 4 blocks, bot 6 HP: `dEff = 4`, `falloff = 1/(1+0.25) = 0.8`, `vuln = min(3, 20/6) = 3`, `threatLevel = 0.2 * 0.8 * 1 * 3 = 0.48`.

### 3.4 Incoming damage

Armour: `armourReduction = min(cfg.armorReductionCap, max(0, totalArmor) * cfg.armorReductionPerPoint * cfg.armorTrust)`. Full iron (15 points): `15 * 0.04 * 0.8 = 0.48`. Bedrock gives 4 % per point; `armorTrust` 0.8 is a survival discount.

| Quantity | Formula |
|---|---|
| `rawHit` | `entry.attack_damage[difficulty]` (MOBS, before armour; Peaceful reads as Normal) |
| `hit` | `rawHit * (1 - armourReduction)`; `ignores_armor` mobs (warden): `rawHit` |
| `dpsPerTick` | `explodes ? 0 : hit / interval * (ranged ? cfg.rangedHitRate : cfg.mobMeleeUptime)`; `interval = MOB_ATTACK_INTERVAL_TICKS[entry.id] ?? 20`. Melee uptime 0.6 covers knockback and re-approach after the bot's hits. |
| `burst` (explodes only) | `rawHit * (isCharged ? cfg.chargedBurstMult : 1) * max(0, 1 - distance / blast) * (1 - armourReduction)`; `blast = cfg.blastReach * (isCharged ? 2 : 1)` (entity damage reaches about 6 blocks, MOBS creeper notes) |
| `expectedIncomingDps` | `20 * sum(dpsPerTick * proximity)` over `R`, HP per second |
| `timeToDieTicks` | `expectedIncomingDps > 0 ? hp * 20 / expectedIncomingDps : 6000` |
| `maxBurst` | `max(burst)` over `R`, 0 if none |

### 3.5 Time to kill

Per mob: `killTicks = ceil(hpNow / botWeaponDamage) * cfg.attackSpacingTicks / cfg.meleeHitRate + (ranged ? ceil(max(0, distance - cfg.ttkReach) / cfg.sprintBlocksPerTick) : 0)`. Melee mobs walk to the bot; ranged ones must be closed on. A zombie (20 HP) vs an iron sword: `ceil(20/6) = 4` hits, `4 * 12 / 0.85 = 56.47` ticks. `timeToKillTicks` = sum of `killTicks` over attackable members of `R`.

### 3.6 Expected damage of fighting everything relevant

Mobs are killed in arrival order. Sort `R` by `(contactTicks, id)`. Walk the list with a clock `t = 0`:
```
for each m in order:
  if m.attackable:  t += m.killTicks;  deadAt = t
  else:             deadAt = cfg.damageHorizonTicks            // cannot be killed: it keeps hitting for 200 ticks
  m.expectedDamage = m.dpsPerTick * max(0, deadAt - m.contactTicks)
expectedDamage = sum(m.expectedDamage);   damageRatio = expectedDamage / hpSafe
```
Three zombies at 4, 4.5 and 5 blocks (6 HP bot, iron armour): `dpsPerTick = 3 * 0.52 / 20 * 0.6 = 0.0468`; contact 10, 12.5, 15; `t` = 56.47, 112.94, 169.41; damage `0.0468 * (56.47 - 10) = 2.175`, `0.0468 * (112.94 - 12.5) = 4.70`, `0.0468 * (169.41 - 15) = 7.23`; `expectedDamage = 14.10`; `damageRatio = 14.10 / 6 = 2.35`.

### 3.7 Death risk

```
rTime     = expectedDamage > 0 ? sigmoid(cfg.riskSlope * (damageRatio - cfg.riskMid)) : 0     // slope 6, mid 0.9
rBurst    = maxBurst > 0       ? sigmoid(cfg.burstSlope * (maxBurst / hpSafe - cfg.burstMid)) : 0   // slope 8, mid 0.9
deathRisk = R is empty ? 0 : 1 - (1 - rTime) * (1 - rBurst)
```
`sigmoid(x) = 1 / (1 + e^-x)`. Meaning: the fight is a coin flip when it is expected to cost 90 % of the current HP. The example above: `sigmoid(6 * (2.35 - 0.9)) = sigmoid(8.7) = 1.000`.

### 3.8 Low HP, urgency, escape drive

```
lowHp       = clamp((cfg.lowHpStart - hp) / (cfg.lowHpStart - cfg.criticalHp), 0, 1)     // 14 -> 0 ... 6 -> 1   (criticalHp: S2b key, 6)
urgency     = exposure * max(deathRisk, lowHp)
escapeDrive = exposure * max(lowHp, cfg.escapeRiskWeight * deathRisk)
```
Both are 0 when no relevant threat can reach the bot within 60 ticks: a distant threat creates no urgency, so the bot can eat. `lowHp` at hp 6 = `(14 - 6) / (14 - 6) = 1`; at 10 = 0.5; at 12 = 0.25.

### 3.9 Retreat effectiveness

`retreatEff = min over t in T with contactTicks <= 2 * cfg.proxHorizonTicks of ( classEff(t.moveClass) * (t.ranged && t.lineOfSight ? cfg.retreatRangedMult : 1) )`, 1 if no such `t`. `classEff`: slow `retreatEffSlow` 1.0, normal 0.8, fast 0.5. A sprinting bot gains distance on slow mobs only (MOBS 1.2); arrows hit a bot running in the open.

### 3.10 Avoid pressure (the "avoid instead" signal)

`avoidPressure = max over e in p.entities of clamp(1 - e.distance / radius(e), 0, 1)`, over entities that satisfy `a` or `b`, and not `ignore`/`never_target`, with `radius(e) = cfg.backOffRadius[typeId] ?? cfg.backOffRadiusDefault` and `radius > 0` (a radius of 0 never counts):
- a. `classification === "neutral_unprovoked"` (an unprovoked enderman, wolf, spider in daylight);
- b. `classification === "threat"` and (`relevance === "irrelevant"` or `kb.mob(typeId).engage_policy === "avoid"`), except `engage_policy === "flee"` (those feed `flee`).

Defaults: enderman 16, creeper 8, warden 30, phantom 0, others 6 (S3 `avoidRadius`, MOBS `avoid_path_around`). Enderman at 10 blocks: `1 - 10/16 = 0.375`.

### 3.11 Food and `canEatSafely`

`hunger = self.hungerKnown ? self.hunger : 20`. `starving = self.hungerKnown && hunger <= cfg.starvingHunger`. `canRegen = hunger >= 18` (TABLES 1: natural regen; also true when hunger is unknown). `hungerNeed = hungerKnown ? clamp((cfg.topupHungerMax - hunger) / (cfg.topupHungerMax - cfg.starvingHunger), 0, 1) : 0` (17 -> 0, 6 -> 1).

Food picks (`Derived.food`; an estimate for scoring only, S2b `chooseFood` makes the real choice with its guards). Only stacks in `inventory.foods` with `amount >= 1` and a FOOD row; `edible = hunger < 20 || typeId in ALWAYS_EDIBLE`; objective ids (`p.objectiveItemIds ?? []`) are skipped except for `starve` and `emergency`; "plain" = no tag `avoid`, `emergency`, `escape`.
- `heal`: S2b `pre_engage_heal`: the first tag of `[main, topup]` with an edible plain item; in it max `satGain` (`min(min(20, hunger + f.hunger), saturation + f.saturation) - saturation`), ties max `f.hunger`, then lower `kb.value`, then typeId.
- `topup`: any edible plain item with tag `topup`, `main` or `raw`, except `minecraft:golden_carrot`; pick max `f.hunger`, tie typeId.
- `starve`: any edible item without tag `emergency`/`escape` (avoid items allowed); pick max `f.hunger`, tie typeId.
- `emergency`: the first held of `EMERGENCY_FOODS`.

```
eatTicksRef        = (food.heal ?? food.starve ?? food.topup)?.eatTicks ?? 32
eatNeedTicks       = p.eating ? p.eating.remainingTicks : eatTicksRef
eatMarginTicks     = p.eating ? cfg.eatMidMealMarginTicks : cfg.eatSafetyMarginTicks           // 6 : 20
minEatContactTicks = min(eatContactTicks) over ALL of T (relevance ignored), Infinity if T is empty
canEatSafely       = minEatContactTicks > eatNeedTicks + eatMarginTicks                        // strict
```
A full meal (32 ticks) needs the nearest threat to be 52 ticks from contact: a zombie (floor speed 0.25) needs `distance > 2 + 52 * 0.25 = 15` blocks. This is the same or stricter than S2b's guards (normal guard 10 blocks, `pre_engage_heal` contact 13 blocks); where S2b refuses a meal S2a scored as safe, S2b masks `eat` and the next-best option runs.
`canEatEmergency = !(T has a melee (non-ranged) mob with distance <= cfg.eatMeleeBlockDist && hp > cfg.emergencyHpAnyThreat)` (S2b 5.2 emergency guard).
`topupWanted = hungerKnown && hunger <= cfg.topupHungerMax && 20 - hunger >= cfg.topupMinMissing && T is empty && food.topup !== undefined` (S2b trigger 5).
`emergencyEatWanted = food.emergency !== undefined && canEatEmergency && ((hp <= cfg.emergencyHp && some t in T has distance <= cfg.emergencyHostileRange) || (hp <= cfg.emergencyHpAnyThreat && T nonempty))` (S2b triggers 1).
`healWant = (food.heal !== undefined || canRegen || (starving && food.starve !== undefined)) ? max(lowHp, starving ? 1 : 0) : 0`. The bot only wants to recover if eating or natural regeneration can actually do it.

### 3.12 Cargo, gear, objective and death cost

Read from `self.values` (S1 `ValueSummary`, filled by the sensor with `computeValueSummary`, section 4). `valueWeight = deathCost / (deathCost + cfg.escapeValueHalf)` (half weight at 300). Iron kit alone (110): `110/410 = 0.268`; full objective 1000 plus kit: `1110/1410 = 0.787`.

---

## 4. Item, gear, cargo and objective value (TABLES 4; `computeValueSummary`)

Constants: `objFull` 1000, `otherCargoCap` 900 (must stay below `objFull`), `enchantPerLevel` 0.10, `enchantMendingBonus` 0.50, `enchantMultCap` 3.0, `durabilityFloor` 0.25, `enchantedBookBase` 20, `enchantedBookPerLevel` 10, `enchantedBookMending` 50 (all in section 9). The unknown-item and food constants (`UNKNOWN_VALUE_STACKABLE` 1, `UNKNOWN_VALUE_UNSTACKABLE` 5, `FOOD_VALUE_PER_HUNGER` 0.25, `FOOD_AVOID_VALUE` 0.1) are plain consts inside `values.ts` behind `kb.value`.

```ts
export function stackValue(it: StackLike, kb: Knowledge, cfg: CombatConfig): number {
  const lv = it.enchantLevelSum ?? 0;
  if (it.typeId === "minecraft:enchanted_book")
    return it.amount * (cfg.enchantedBookBase + cfg.enchantedBookPerLevel * lv + (it.mending ? cfg.enchantedBookMending : 0));
  const gear = GEAR_CATEGORIES.includes(kb.category(it.typeId));
  const mult = gear ? Math.min(cfg.enchantMultCap, 1 + cfg.enchantPerLevel * lv + (it.mending ? cfg.enchantMendingBonus : 0)) : 1;
  const dur = Math.max(cfg.durabilityFloor, it.durabilityFrac);            // durabilityFrac is 1 for items without durability
  return kb.value(it.typeId, it.maxAmount) * it.amount * dur * mult;
}

export function computeValueSummary(
  inv: InventorySummary, eq: EquipmentView, objective: { ids: readonly string[]; required: number } | undefined,
  kb: Knowledge, cfg: CombatConfig,
): ValueSummary {
  const ids = new Set(objective?.ids ?? []);
  const required = objective?.required ?? 0;                               // amount STILL needed (task amount minus delivered)
  let gearValue = 0;
  for (const k of ["head", "chest", "legs", "feet", "offhand"] as const) { // mainhand is an inventory slot: counted below, never twice
    const w = eq[k];
    if (w) gearValue += stackValue({ typeId: w.typeId, amount: 1, durabilityFrac: w.durabilityFrac, enchantLevelSum: w.enchantLevelSum, mending: w.mending }, kb, cfg);
  }
  let held = 0, objRaw = 0, otherRaw = 0;
  for (const it of inv.slots) {
    const v = stackValue(it, kb, cfg);
    if (ids.has(it.typeId)) { held += it.amount; objRaw += v; }            // objective items are never also gear or other cargo
    else if (GEAR_CATEGORIES.includes(kb.category(it.typeId))) gearValue += v;
    else otherRaw += v;
  }
  const progress = required > 0 ? Math.min(held, required) / required : 0;
  const objectiveValue = cfg.objFull * progress;                           // 0..1000, linear
  const surplusValue = held > 0 ? Math.max(0, held - required) * (objRaw / held) : 0;   // surplus at the mean table value
  const otherCargoRaw = otherRaw + surplusValue;
  const otherCargoValue = Math.min(cfg.otherCargoCap, otherCargoRaw);
  const cargoValue = objectiveValue + otherCargoValue;
  return { gearValue, objectiveValue, otherCargoValue, otherCargoRaw, cargoValue, deathCost: gearValue + cargoValue };
}
```
Checks against TABLES 5: Example 4 (3 diamonds, 32 dirt, full iron, iron sword at 50 %): other `120 + 3.2 = 123.2`; gear `96 + 8 * 0.5 = 100`; `deathCost = 223.2`. Example 5 (16 `raw_iron` required 16, held 16, 3 diamonds, 20 cobblestone): `objectiveValue = 1000 * 16/16 = 1000`, other `120 + 2 = 122`. Holding 5: `1000 * 5/16 = 312.5`. Example 6 (80 logs, required 64): `1000`, surplus `16 * 0.5 = 8`.
Reference bot used in section 7: iron sword 8 + shield 6 + iron armour (20 + 32 + 28 + 16 = 96) = `gearValue 110`, nothing enchanted, full durability.

---

## 5. Option scores

`scoreOptions` returns nine finite numbers. S2b masks impossible options (-Infinity) and applies hysteresis; S2a returns 0 for an option that cannot apply and never returns NaN or Infinity (a final pass sets any non-finite value to 0). Notation: `x` = exposure, `u` = urgency, `rho` = deathRisk, `R`, `T` as in section 3.

| Option | Formula | Typical range |
|---|---|---|
| `attack` | `max over m in R, attackable, policyFactor(m) > 0 of need(m) * policyFactor(m) * (1 - rho)^attackRiskExp * hpFactor`; 0 if none. `need`: `threatensProtected` 1.1 (`needProtect`), `threatening_me` 1.0 (`needThreat`), `blocking_objective` 0.6 (`needBlock`). `hpFactor = attackHpFloor + (1 - attackHpFloor) * (1 - lowHp)` (0.2 at 6 HP or less, 1.0 at 14 HP or more) | 0 to 1.1 |
| `shield` | `hasUsableShield && inbound ? shieldBase + shieldGain * max(u, threatPressure) : 0`. `inbound` = some `m` in `R` with (`targetingMe` or `hurtMe` or `distance <= shieldPersonalDist`) and (ranged: `lineOfSight && distance <= attackRange`; melee: `distance <= shieldReach`) | 0.25 to 0.75 |
| `back_off` | `backOffWeight * avoidPressure^2` | 0 to 0.9 |
| `retreat` | `T empty ? 0 : retreatEff * max(u, unsafeEat, forcedRetreat, burstFear)` where `unsafeEat = (healWant > 0 && !canEatSafely) ? unsafeEatDrive * healWant : 0`; `forcedRetreat = max(fleeIfScore * proximity)` over fleeIf mobs of policy `engage`/`engage_if_blocking`; `burstFear = max(burstRetreatWeight * clamp(burst / hpSafe, 0, 1.2))` over exploding mobs in `R` | 0 to 1.1 |
| `eat` | `max(topup, heal, starve, emergency)`: `topup = topupWanted ? topupBase + topupGain * hungerNeed : 0`; `heal = (food.heal && canEatSafely) ? eatGain * lowHp : 0`; `starve = (starving && food.starve && canEatSafely) ? starveScore : 0`; `emergency = emergencyEatWanted ? emergencyEatScore : 0` | 0 to 1.3 |
| `flee` | `max(forcedFlee, policyFlee, urgFlee)`: `forcedFlee = max(fleeIfScore * proximity)` over fleeIf mobs of policy `avoid`/`flee`; `policyFlee = fleePolicyScore` if some `m` in `T` has policy `flee` and `distance <= fleePolicyRadius`; `urgFlee = (R nonempty && every m in R has policy avoid or flee) ? fleeUrgencyWeight * u : 0` | 0 to 1.2 |
| `escape_rejoin` | `p.escapeAvailable ? escapeDrive * (escapeBase + escapeGain * valueWeight) : 0` | 0 to 1.95 |
| `resume_task` | `p.taskKind !== undefined ? resumeBase * (1 - x) : 0` | 0 to 0.5 |
| `idle` | `p.taskKind === undefined ? idleBase * (1 - x) : 0` | 0 to 0.1 |

`policyFactor(m)`: `engage` 1; `engage_if_blocking` 1 if `targetingMe || hurtMe || relevance === "blocking_objective"` else 0 (a creeper merely standing near is never initiated against); `avoid`: `avoidAttackFactor` (0.6) if `relevance === "blocking_objective" && danger <= avoidAttackMaxDanger` (5), else `corneredFactor` (0.5) if `targetingMe && speedBpt >= SPEED_BY_CLASS.normal && distance <= corneredDist` (cannot be outrun and is on top of the bot: MOBS 1.3 "use tactics only when escape is not possible"), else 0; `flee` 0.
`finishExempt(m)`: `R.length === 1 && m.attackable && m.hpFrac <= fleeIfFinishFrac` (0.2). A fleeIf mob that is nearly dead and alone does not force a withdrawal.

### 5.1 Gates (brief item 3), where each is enforced

| Rule | Where | Effect |
|---|---|---|
| `never_target`, `neutral_unprovoked`, `ignore` | `T` excludes them (classification is not `threat`) | attack 0; they can raise `avoidPressure` (neutral only) |
| `irrelevant` | `R` excludes it | attack 0; `avoidPressure` raises `back_off` when it is closer than its radius; otherwise `resume_task` |
| `attackAllowed === false` or outside leash and farther than 3.5 | `attackable` | attack 0 for that mob; it still counts for risk, shield, retreat, flee |
| engage policy `flee` | `policyFactor` 0, `policyFlee` | attack 0, `flee` 1.2 within 32 blocks |
| engage policy `avoid` | `policyFactor` | attack only if blocking and danger <= 5 (x0.6), or cornered (x0.5); else 0 |
| `flee_if` holds | `fleeIf` | the withdrawal option is forced up: `retreat` (mobs that fight) or `flee` (mobs with policy avoid/flee) get `1.1 * proximity`, a distant mob forces nothing |

`flee_if` mapping: MOBS 1.2 says flee_if switches to `retreat_and_regen`, `sprint_away` or `flee_sneak` "per the entry's tactics". The brain has two options for that: `retreat` runs `retreat_and_regen`, `flee` runs `sprint_away`/`flee_sneak` (S2b `TACTIC_CLASS`). Rule: policy `engage`/`engage_if_blocking` entries map to `retreat` (they never list `sprint_away`), policy `avoid`/`flee` entries map to `flee`.

### 5.2 Escape rule (ROADMAP "Return and escape rules"; no cooldown anywhere)

`escape_rejoin = escapeDrive * (0.35 + 1.6 * valueWeight)`. `escapeDrive` is high only with a relevant threat in reach and (low HP or a lethal fight). `valueWeight` is `deathCost / (deathCost + 300)`, and `deathCost` includes `objectiveValue` (up to 1000), which is why objective cargo dominates:

| deathCost | valueWeight | multiplier `0.35 + 1.6 * vw` | escape at drive 1.0 | local withdrawal score (forced retreat) | wins |
|---|---|---|---|---|---|
| 113 (kit + 3 dirt) | 0.274 | 0.79 | 0.79 | 1.1 | retreat |
| 300 | 0.500 | 1.15 | 1.15 | 1.1 | escape (barely) |
| 610 (kit + 500 of rares) | 0.670 | 1.42 | 1.42 | 1.1 | escape |
| 1110 (kit + 64/64 diamonds) | 0.787 | 1.61 | 1.61 | 1.1 | escape |

So "low HP plus cheap cargo" fights or retreats locally, "low HP plus objective or valuable cargo" escapes. There is no time term: the score does not know when the last escape was. `p.escapeAvailable === false` (the snapshot service refused, S1 3.6) gives 0, and the brain re-runs without it.

### 5.3 How retreat, eat, fight emerge (no script)

1. HP low, threats close: `canEatSafely` is false, so `eat` is 0 (heal) and `retreat` is high (`unsafeEat = 0.8 * healWant`, `forcedRetreat`, `urgency`). Retreat wins.
2. The retreat opens the distance (slow mobs lose ground at 0.28 vs 0.20 b/tick). When the nearest threat is more than `eatNeedTicks + 20` ticks from contact, `canEatSafely` turns true, `urgency` falls to 0 (exposure 0) and `eat = 1.3 * lowHp` beats `resume_task` (0.5) and `retreat` (0). Eat wins.
3. Eating raises HP (fast regen with saturation). `lowHp` falls, `hpFactor` and `(1 - rho)^1.5` rise, `eat` falls to 0, `attack` rises above `retreat` once the fight is affordable. Attack wins. If the threats arrive mid-meal, `canEatSafely` turns false (section 7, example 3) and the earlier rows apply again.
4. Emergency food (golden apple) bypasses the safety margin (`emergencyEatScore` 1.2 beats `retreat` at most 1.1) unless a melee mob is within 2 blocks.

---

## 6. Reference implementation (`src/core/combat/scoring.ts`; helper bodies are authoritative)

```ts
import type { CombatConfig, Derived, Difficulty, EngagePolicy, EntityPercept, FoodEntry, FoodPick, Knowledge, MobEntry, MoveSpeed,
  OptionScores, Percept, SelfPercept, SlotItem, ThreatEval } from "./types.js";
import { evalCondition, type CondEnv } from "./stats.js";
import { weaponDamage } from "./sense.js";
// The constants of section 2 (MOB_ATTACK_INTERVAL_TICKS, ATTACK_INTERVAL_DEFAULT, SPEED_BY_CLASS, SPEED_OVERRIDE, ALWAYS_EDIBLE, EMERGENCY_FOODS, ATTACK_NEAR_BLOCKS) are declared in this same file.

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const byContact = (a: ThreatEval, b: ThreatEval): number => a.contactTicks - b.contactTicks || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function armourReduction(totalArmor: number, cfg: CombatConfig): number {
  return Math.min(cfg.armorReductionCap, Math.max(0, totalArmor) * cfg.armorReductionPerPoint * cfg.armorTrust);
}
export function botWeaponDamage(s: SelfPercept, cfg: CombatConfig): number {
  const main = s.equipment.mainhand ? weaponDamage(s.equipment.mainhand.typeId) : undefined;
  const slot = s.inventory.bestWeaponSlot === undefined ? undefined
    : weaponDamage(s.inventory.slots.find(i => i.slot === s.inventory.bestWeaponSlot)?.typeId ?? "");
  return Math.max(main ?? 0, slot ?? 0, cfg.fistDamage);
}
export function mobSpeedBpt(typeId: string, entry: MobEntry, isBaby: boolean, cfg: CombatConfig): number {
  return (SPEED_OVERRIDE[typeId] ?? SPEED_BY_CLASS[entry.move_speed]) * (isBaby ? cfg.babySpeedMult : 1);
}
export function hasUsableShield(p: Percept, cfg: CombatConfig): boolean {   // identical to S2b botHasShield
  const inv = p.self.inventory, off = p.self.equipment.offhand;
  const offShield = off?.typeId === "minecraft:shield";
  const slotItem = inv.shieldSlot === undefined ? undefined : inv.slots.find(i => i.slot === inv.shieldSlot);
  const frac = offShield ? off!.durabilityFrac : slotItem?.durabilityFrac;
  return frac !== undefined && frac >= cfg.shieldMinDurabilityFrac && (p.canBlock ?? offShield);   // shieldDisabled is tested separately
}

interface Globals { diff: Difficulty; red: number; botDmg: number; vuln: number; shield: boolean; hostile12: number; sameType12: ReadonlyMap<string, number> }

function evalThreat(e: EntityPercept, p: Percept, kb: Knowledge, cfg: CombatConfig, g: Globals): ThreatEval {
  const entry = kb.mob(e.typeId);
  const ranged = entry.special.includes("ranged_projectile"), explodes = entry.special.includes("explodes");
  const speedBpt = mobSpeedBpt(e.typeId, entry, e.isBaby, cfg);
  const reach = ranged && !e.lineOfSight ? cfg.noLosReach : entry.attack_range_blocks;
  const contactTicks = Math.max(0, e.distance - reach) / speedBpt;
  const eatReach = ranged ? (e.lineOfSight ? Math.min(entry.attack_range_blocks, cfg.rangedEatReach) : cfg.noLosReach) : entry.attack_range_blocks;
  const eatContactTicks = Math.max(0, e.distance - eatReach) / Math.max(speedBpt, cfg.eatGuardThreatSpeed / 20);
  const hpNow = e.hp ?? entry.hp, hpFrac = clamp(hpNow / entry.hp, 0, 1);
  const rawHit = entry.attack_damage[g.diff];
  const hit = entry.special.includes("ignores_armor") ? rawHit : rawHit * (1 - g.red);
  const interval = MOB_ATTACK_INTERVAL_TICKS[entry.id] ?? ATTACK_INTERVAL_DEFAULT;
  const dpsPerTick = explodes ? 0 : hit / interval * (ranged ? cfg.rangedHitRate : cfg.mobMeleeUptime);
  const attackable = e.attackAllowed && (e.inLeash || e.distance <= ATTACK_NEAR_BLOCKS);
  const killTicks = Math.ceil(hpNow / g.botDmg) * cfg.attackSpacingTicks / cfg.meleeHitRate
    + (ranged ? Math.ceil(Math.max(0, e.distance - cfg.ttkReach) / cfg.sprintBlocksPerTick) : 0);
  const dEff = Math.max(0, e.distance - 0.5 * Math.max(0, entry.attack_range_blocks - 3));
  const threatLevel = entry.danger / 10 / (1 + (dEff / cfg.threatHalfDist) ** 2) * hpFrac * g.vuln;
  const blast = cfg.blastReach * (e.isCharged ? 2 : 1);
  const burst = explodes ? rawHit * (e.isCharged ? cfg.chargedBurstMult : 1) * Math.max(0, 1 - e.distance / blast) * (1 - g.red) : 0;
  const relevant = e.relevance !== "irrelevant";
  const env: CondEnv = { p, e, entry, cfg, hostile12: g.hostile12, sameType12: g.sameType12.get(e.typeId) ?? 0, botHasShield: g.shield };
  return {
    id: e.id, typeId: e.typeId, mobId: entry.id, distance: e.distance, relevance: e.relevance, relevant,
    policy: entry.engage_policy, moveClass: entry.move_speed, danger: entry.danger,
    ranged, explodes, lineOfSight: e.lineOfSight, attackRange: entry.attack_range_blocks,
    targetingMe: e.targetingMe, hurtMe: e.hurtMeAtTick !== undefined, threatensProtected: e.threatensProtected,
    attackable, hpNow, hpFrac, speedBpt, contactTicks, proximity: clamp(1 - contactTicks / cfg.proxHorizonTicks, 0, 1),
    threatLevel, dpsPerTick, burst, killTicks, expectedDamage: 0,
    fleeIf: relevant && entry.flee_if.some(c => evalCondition(c, env)), eatContactTicks,
  };
}

function pickFoods(p: Percept, kb: Knowledge, hunger: number, cfg: CombatConfig): Derived["food"] {
  const s = p.self, obj = p.objectiveItemIds ?? [];
  const rows: Array<{ i: SlotItem; f: FoodEntry }> = [];
  for (const i of s.inventory.foods) { const f = kb.food(i.typeId); if (f && i.amount >= 1) rows.push({ i, f }); }
  const pick = (r: { i: SlotItem; f: FoodEntry }): FoodPick => ({ typeId: r.i.typeId, slot: r.i.slot, eatTicks: r.f.eatTicks, hunger: r.f.hunger, saturation: r.f.saturation });
  const edible = (r: { i: SlotItem }) => hunger < 20 || ALWAYS_EDIBLE.includes(r.i.typeId);
  const plain = (r: { f: FoodEntry }) => !r.f.tags.some(t => t === "avoid" || t === "emergency" || t === "escape");
  const free = (r: { i: SlotItem }) => !obj.includes(r.i.typeId);
  const gain = (f: FoodEntry) => Math.min(Math.min(20, hunger + f.hunger), s.saturation + f.saturation) - s.saturation;
  const best = (rs: typeof rows, cmp: (a: typeof rows[0], b: typeof rows[0]) => number) =>
    rs.length === 0 ? undefined : pick([...rs].sort((a, b) => cmp(a, b) || (a.i.typeId < b.i.typeId ? -1 : 1))[0]);
  let heal: FoodPick | undefined;
  for (const tag of ["main", "topup"] as const) {
    const pool = rows.filter(r => edible(r) && plain(r) && free(r) && r.f.tags.includes(tag));
    if (pool.length > 0) { heal = best(pool, (a, b) => gain(b.f) - gain(a.f) || b.f.hunger - a.f.hunger || kb.value(a.i.typeId) - kb.value(b.i.typeId)); break; }
  }
  const byHunger = (a: { f: FoodEntry }, b: { f: FoodEntry }) => b.f.hunger - a.f.hunger;
  return {
    heal,
    topup: best(rows.filter(r => edible(r) && plain(r) && free(r) && r.i.typeId !== "minecraft:golden_carrot"
      && r.f.tags.some(t => t === "topup" || t === "main" || t === "raw")), byHunger),
    starve: best(rows.filter(r => edible(r) && !r.f.tags.some(t => t === "emergency" || t === "escape")), byHunger),
    emergency: EMERGENCY_FOODS.map(id => rows.find(r => r.i.typeId === id)).filter(r => r !== undefined).map(r => pick(r!))[0],
  };
}

export function computeDerived(p: Percept, kb: Knowledge, cfg: CombatConfig): Derived {
  const s = p.self;
  const difficulty: Difficulty = p.env.difficulty === "peaceful" ? "normal" : p.env.difficulty;
  const red = armourReduction(s.equipment.totalArmor, cfg);
  const botDmg = botWeaponDamage(s, cfg);
  const hpSafe = Math.max(s.hp, 1);
  const shield = hasUsableShield(p, cfg);
  const raw = p.entities.filter(e => e.classification === "threat" && e.distance <= cfg.scanRadius);
  const near = raw.filter(e => e.relevance !== "irrelevant" && e.distance <= cfg.countRadius);
  const sameType12 = new Map<string, number>();
  for (const e of near) sameType12.set(e.typeId, (sameType12.get(e.typeId) ?? 0) + 1);
  const g: Globals = { diff: difficulty, red, botDmg, shield, hostile12: near.length, sameType12,
    vuln: clamp(cfg.botRefHp / hpSafe, cfg.botVulnMin, cfg.botVulnMax) };
  const threats = raw.map(e => evalThreat(e, p, kb, cfg, g)).sort(byContact);
  const rel = threats.filter(t => t.relevant);

  // 3.6 sequential damage
  let clock = 0, expectedDamage = 0, hasUnkillable = false;
  for (const m of rel) {
    if (m.attackable) clock += m.killTicks; else hasUnkillable = true;
    m.expectedDamage = m.dpsPerTick * Math.max(0, (m.attackable ? clock : cfg.damageHorizonTicks) - m.contactTicks);
    expectedDamage += m.expectedDamage;
  }
  const exposure = rel.reduce((a, m) => Math.max(a, m.proximity), 0);
  const expectedIncomingDps = 20 * rel.reduce((a, m) => a + m.dpsPerTick * m.proximity, 0);
  const maxBurst = rel.reduce((a, m) => Math.max(a, m.burst), 0);
  const damageRatio = expectedDamage / hpSafe;
  const rTime = expectedDamage > 0 ? sigmoid(cfg.riskSlope * (damageRatio - cfg.riskMid)) : 0;
  const rBurst = maxBurst > 0 ? sigmoid(cfg.burstSlope * (maxBurst / hpSafe - cfg.burstMid)) : 0;
  const deathRisk = rel.length === 0 ? 0 : 1 - (1 - rTime) * (1 - rBurst);
  const lowHp = clamp((cfg.lowHpStart - s.hp) / (cfg.lowHpStart - cfg.criticalHp), 0, 1);
  const totalThreat = rel.reduce((a, m) => a + m.threatLevel, 0);
  const v = s.values, valueWeight = v.deathCost / (v.deathCost + cfg.escapeValueHalf);

  // 3.9, 3.10
  const classEff: Record<MoveSpeed, number> = { slow: cfg.retreatEffSlow, normal: cfg.retreatEffNormal, fast: cfg.retreatEffFast };
  const retreatEff = threats.filter(t => t.contactTicks <= 2 * cfg.proxHorizonTicks)
    .reduce((a, t) => Math.min(a, classEff[t.moveClass] * (t.ranged && t.lineOfSight ? cfg.retreatRangedMult : 1)), 1);
  let avoidPressure = 0;
  for (const e of p.entities) {
    const neutral = e.classification === "neutral_unprovoked";
    const policy = e.classification === "threat" ? kb.mob(e.typeId).engage_policy : undefined;
    const thr = policy !== undefined && policy !== "flee" && (e.relevance === "irrelevant" || policy === "avoid");
    if (!neutral && !thr) continue;
    const radius = cfg.backOffRadius[e.typeId] ?? cfg.backOffRadiusDefault;
    if (radius > 0) avoidPressure = Math.max(avoidPressure, clamp(1 - e.distance / radius, 0, 1));
  }

  // 3.11 food
  const hunger = s.hungerKnown ? s.hunger : 20;
  const starving = s.hungerKnown && hunger <= cfg.starvingHunger;
  const canRegen = hunger >= 18;
  const hungerNeed = s.hungerKnown ? clamp((cfg.topupHungerMax - hunger) / (cfg.topupHungerMax - cfg.starvingHunger), 0, 1) : 0;
  const food = pickFoods(p, kb, hunger, cfg);
  const healWant = (food.heal !== undefined || canRegen || (starving && food.starve !== undefined)) ? Math.max(lowHp, starving ? 1 : 0) : 0;
  const eatTicksRef = (food.heal ?? food.starve ?? food.topup)?.eatTicks ?? 32;
  const eatNeedTicks = p.eating ? p.eating.remainingTicks : eatTicksRef;
  const eatMarginTicks = p.eating ? cfg.eatMidMealMarginTicks : cfg.eatSafetyMarginTicks;
  const minEatContactTicks = threats.reduce((a, t) => Math.min(a, t.eatContactTicks), Infinity);
  const meleeNear = threats.some(t => !t.ranged && t.distance <= cfg.eatMeleeBlockDist);
  const canEatEmergency = !(meleeNear && s.hp > cfg.emergencyHpAnyThreat);
  return {
    difficulty, armourReduction: red, hpSafe, threats, totalThreat, threatPressure: 1 - Math.exp(-totalThreat), exposure,
    botWeaponDamage: botDmg, botOffenceDps: botDmg * 20 / cfg.attackSpacingTicks * cfg.meleeHitRate,
    expectedIncomingDps, timeToKillTicks: clock,
    timeToDieTicks: expectedIncomingDps > 0 ? s.hp * 20 / expectedIncomingDps : 6000,
    hasUnkillable, expectedDamage, damageRatio, maxBurst, deathRisk, lowHp,
    urgency: exposure * Math.max(deathRisk, lowHp),
    escapeDrive: exposure * Math.max(lowHp, cfg.escapeRiskWeight * deathRisk),
    gearValue: v.gearValue, objectiveValue: v.objectiveValue, otherCargoValue: v.otherCargoValue, cargoValue: v.cargoValue, deathCost: v.deathCost,
    valueWeight, retreatEff, avoidPressure, hasUsableShield: shield && p.shieldDisabled !== true, fleeIfActive: rel.some(m => m.fleeIf),
    hunger, starving, canRegen, hungerNeed, healWant, food, eatTicksRef, eatNeedTicks, eatMarginTicks, minEatContactTicks,
    canEatSafely: minEatContactTicks > eatNeedTicks + eatMarginTicks, canEatEmergency,
    topupWanted: s.hungerKnown && hunger <= cfg.topupHungerMax && 20 - hunger >= cfg.topupMinMissing && threats.length === 0 && food.topup !== undefined,
    emergencyEatWanted: food.emergency !== undefined && canEatEmergency
      && ((s.hp <= cfg.emergencyHp && threats.some(t => t.distance <= cfg.emergencyHostileRange)) || (s.hp <= cfg.emergencyHpAnyThreat && threats.length > 0)),
  };
}

function policyFactor(m: ThreatEval, cfg: CombatConfig): number {
  switch (m.policy as EngagePolicy) {
    case "engage": return 1;
    case "engage_if_blocking": return m.targetingMe || m.hurtMe || m.relevance === "blocking_objective" ? 1 : 0;
    case "avoid":
      if (m.relevance === "blocking_objective" && m.danger <= cfg.avoidAttackMaxDanger) return cfg.avoidAttackFactor;
      if (m.targetingMe && m.speedBpt >= SPEED_BY_CLASS.normal && m.distance <= cfg.corneredDist) return cfg.corneredFactor;
      return 0;
    default: return 0;                                           // "flee"
  }
}

export function scoreOptions(p: Percept, d: Derived, kb: Knowledge, cfg: CombatConfig): OptionScores {
  void kb;                                                       // reserved; keeps noUnusedParameters quiet
  const rel = d.threats.filter(t => t.relevant);
  const out: OptionScores = { attack: 0, shield: 0, back_off: 0, retreat: 0, eat: 0, flee: 0, escape_rejoin: 0, resume_task: 0, idle: 0 };

  const hpFactor = cfg.attackHpFloor + (1 - cfg.attackHpFloor) * (1 - d.lowHp);
  for (const m of rel) {
    const pf = m.attackable ? policyFactor(m, cfg) : 0;
    if (pf === 0) continue;
    const need = m.threatensProtected ? cfg.needProtect : m.relevance === "threatening_me" ? cfg.needThreat : cfg.needBlock;
    out.attack = Math.max(out.attack, need * pf * Math.pow(1 - d.deathRisk, cfg.attackRiskExp) * hpFactor);
  }

  const inbound = rel.some(m => (m.targetingMe || m.hurtMe || m.distance <= cfg.shieldPersonalDist)
    && (m.ranged ? m.lineOfSight && m.distance <= m.attackRange : m.distance <= cfg.shieldReach));
  if (d.hasUsableShield && inbound) out.shield = cfg.shieldBase + cfg.shieldGain * Math.max(d.urgency, d.threatPressure);

  out.back_off = cfg.backOffWeight * d.avoidPressure * d.avoidPressure;

  let forcedRetreat = 0, forcedFlee = 0, burstFear = 0;
  for (const m of rel) {
    if (m.explodes) burstFear = Math.max(burstFear, cfg.burstRetreatWeight * clamp(m.burst / d.hpSafe, 0, 1.2));
    if (!m.fleeIf || (rel.length === 1 && m.attackable && m.hpFrac <= cfg.fleeIfFinishFrac)) continue;
    const w = cfg.fleeIfScore * m.proximity;
    if (m.policy === "avoid" || m.policy === "flee") forcedFlee = Math.max(forcedFlee, w); else forcedRetreat = Math.max(forcedRetreat, w);
  }
  const unsafeEat = d.healWant > 0 && !d.canEatSafely ? cfg.unsafeEatDrive * d.healWant : 0;
  out.retreat = d.threats.length === 0 ? 0 : d.retreatEff * Math.max(d.urgency, unsafeEat, forcedRetreat, burstFear);

  const policyFlee = d.threats.some(t => t.policy === "flee" && t.distance <= cfg.fleePolicyRadius) ? cfg.fleePolicyScore : 0;
  const urgFlee = rel.length > 0 && rel.every(m => m.policy === "avoid" || m.policy === "flee") ? cfg.fleeUrgencyWeight * d.urgency : 0;
  out.flee = Math.max(forcedFlee, policyFlee, urgFlee);

  out.escape_rejoin = p.escapeAvailable ? d.escapeDrive * (cfg.escapeBase + cfg.escapeGain * d.valueWeight) : 0;

  out.eat = Math.max(
    d.topupWanted ? cfg.topupBase + cfg.topupGain * d.hungerNeed : 0,
    d.food.heal && d.canEatSafely ? cfg.eatGain * d.lowHp : 0,
    d.starving && d.food.starve && d.canEatSafely ? cfg.starveScore : 0,
    d.emergencyEatWanted ? cfg.emergencyEatScore : 0);

  out.resume_task = p.taskKind !== undefined ? cfg.resumeBase * (1 - d.exposure) : 0;
  out.idle = p.taskKind === undefined ? cfg.idleBase * (1 - d.exposure) : 0;

  for (const k of Object.keys(out) as Array<keyof OptionScores>) if (!Number.isFinite(out[k])) out[k] = 0;
  return out;
}
```
Notes for B1: `kb` is unused in `scoreOptions` today (kept in the signature so scores can read mob data later without an API change). The function `hasUsableShield` is S2b's `botHasShield` word for word (it does not look at `shieldDisabled`, so the MOBS atoms `bot_has_shield` and `bot_shield_disabled` stay independent); `Derived.hasUsableShield` additionally requires `p.shieldDisabled !== true`. `computeDerived` copies `s.values`; it never recomputes cargo.

---

## 7. Worked examples

**Reference bot** (all examples unless stated): iron sword in the main hand (`botWeaponDamage 6`), shield in the offhand (durability 1.0, `canBlock` true), full iron armour (`totalArmor 15`, `armourReduction = 15 * 0.04 * 0.8 = 0.48`), HP max 20, difficulty Normal, `gearValue 110`, food only where stated, `escapeAvailable` true, task `gather`, all mobs full HP and with line of sight, `targetingMe` true unless stated. Defaults of section 9. Scores are in the order attack, shield, back_off, retreat, eat, flee, escape_rejoin, resume_task, idle, rounded to 3 decimals; `raw` = the S2a output (S2b masks afterwards).

| # | Situation | Winner |
|---|---|---|
| 1 | HP 6/20, 3 zombies at 4 blocks, steak | retreat |
| 2 | same, zombies at 20 blocks | eat |
| 3 | mid-meal, zombie closes to 2 blocks | attack (and variants) |
| 4 | holds 64/64 requested diamonds, HP 5, 2 skeletons | escape_rejoin |
| 5 | HP 5, only dirt, 1 zombie | retreat |
| 6 | creeper at 2.5 blocks while gathering | attack (HP 20), retreat (HP 12) |
| 7 | irrelevant zombie at 12 blocks while gathering | resume_task |
| 8 | defend task, zombie targets a player in the zone | attack |
| 9 | enderman, neutral and unprovoked | resume_task (attack 0) |
| 10 | after the meal of 1 and 2: HP 20, 3 zombies at 6 to 8 | attack |
| 11 | emergency: HP 6, 3 zombies at 10, golden apple + steak | eat (golden apple) |
| 12 | top-up: hunger 14, no threats, bread | eat |

### Example 1: HP 6, 3 zombies at 4.0 / 4.5 / 5.0 blocks, 1 cooked_beef (hunger 14, saturation 2)
- Per zombie: `hit = 3 * 0.52 = 1.56`, `dpsPerTick = 1.56 / 20 * 0.6 = 0.0468`; `contactTicks = (d - 2) / 0.20 = 10 / 12.5 / 15`; `proximity = 1 - 10/60 = 0.833 / 0.792 / 0.750`; `killTicks = ceil(20/6) * 12 / 0.85 = 56.47`; `threatLevel = 0.2 * falloff * 1 * 3` with falloff `0.8 / 0.760 / 0.719` gives 0.480 / 0.456 / 0.431, `totalThreat 1.367`, `threatPressure 0.745`.
- Sequential damage: 2.175 + 4.701 + 7.226 = **14.10**; `damageRatio = 14.10 / 6 = 2.35`; `deathRisk = sigmoid(6 * (2.35 - 0.9)) = 1.000`. `timeToKill = 169.4` ticks, `expectedIncomingDps = 20 * 0.0468 * (0.833 + 0.792 + 0.75) = 2.22`, `timeToDie = 6 * 20 / 2.22 = 54.0` ticks.
- `lowHp = 1`, `exposure 0.833`, `urgency 0.833`. `canEatSafely`: `minEatContactTicks = (4 - 2) / 0.25 = 8`; `8 > 32 + 20` is false. `healWant 1` (steak is a heal food), `unsafeEat = 0.8`. `fleeIf` true (zombie `hp_below: 8`): `forcedRetreat = 1.1 * 0.833 = 0.917`. `valueWeight = 110/410 = 0.268`, `escape = 0.833 * (0.35 + 1.6 * 0.268) = 0.649`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.000 | 0.667 | 0.000 | **0.917** | 0.000 | 0.000 | 0.649 | 0.083 | 0.000 |

Retreat wins. attack is `1 * pf * (1 - 1.0)^1.5 * 0.2 = 0`.

### Example 2: same bot, zombies at 20.0 / 20.5 / 21.0 blocks
- `contactTicks = 90 / 92.5 / 95`, so `proximity 0`, `exposure 0`, `urgency 0`, `escapeDrive 0`. `deathRisk` (fight total) `= sigmoid(6 * (4.439/6 - 0.9)) = 0.277` (later arrivals cut the damage to 4.44).
- `minEatContactTicks = (20 - 2) / 0.25 = 72 > 32 + 20`: `canEatSafely` true. `heal` = cooked_beef (`main`, edible: hunger 14 < 20). `eat = 1.3 * lowHp 1 = 1.3`. `resume_task = 0.5 * (1 - 0) = 0.5`. `retreat = 1.0 * max(0, 0, forcedRetreat 1.1 * 0 = 0, 0) = 0`. `attack = 1 * 1 * (1 - 0.277)^1.5 * 0.2 = 0.123`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.123 | 0.000 | 0.000 | 0.000 | **1.300** | 0.000 | 0.000 | 0.500 | 0.000 |

Eat wins. S2b `chooseEat` must also pass: its `pre_engage_heal` contact test needs `20 / 5 * 20 = 80 >= 52`, true.

### Example 3: mid-meal, a zombie closes to 2 blocks (HP 10, hunger 14, saturation 2, cooked_beef, `p.eating = { cooked_beef, remainingTicks: 16 }`)
- 3a. Zombie at 2.0: `eatContactTicks = (2 - 2) / 0.25 = 0`; `eatNeedTicks 16`, `eatMarginTicks 6`; `0 > 22` false, so `canEatSafely` false and `heal = 0`. `lowHp = (14 - 10) / 8 = 0.5`; zombie `contactTicks 0`, `exposure 1`; `damage = 0.0468 * 56.47 = 2.64`, `damageRatio 0.264`, `deathRisk = sigmoid(6 * (0.264 - 0.9)) = 0.022`. `attack = 1 * (0.978)^1.5 * (0.2 + 0.8 * 0.5) = 0.968 * 0.6 = 0.581`. `shield = 0.25 + 0.5 * max(0.5, 0.314) = 0.500`; `retreat = max(urgency 0.5, unsafeEat 0.8 * 0.5 = 0.4) = 0.500`; `escape = 0.5 * (0.35 + 1.6 * 0.268) = 0.390`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| **0.581** | 0.500 | 0.000 | 0.500 | 0.000 | 0.000 | 0.390 | 0.000 | 0.000 |

The meal is abandoned and the bot fights (S2b H3 also fires: a threat within 3 blocks interrupts a non-emergency meal).
- 3b. Zombie still at 9.0, `remainingTicks 10`: `eatContactTicks = (9 - 2) / 0.25 = 28 > 10 + 6 = 16`, safe: `eat = 1.3 * 0.5 = 0.650` beats `attack 0.593`, `resume_task 0.292`, `retreat 0.208`. The meal is finished. Without the `eating` field the guard is `28 > 32 + 20` (false): eat 0 and the bot would drop the meal (Open question Q3).

### Example 4: 64/64 requested diamonds, HP 5, 2 skeletons at 10 and 11 blocks (hunger 18, no food)
- Values: `objectiveValue = 1000 * min(64, 64) / 64 = 1000`; diamonds are objective items (never also other cargo), surplus 0; `deathCost = 110 + 1000 = 1110`, `valueWeight = 1110 / 1410 = 0.787`.
- Skeleton: `hit 1.56`, `dpsPerTick = 1.56 / 40 * 0.6 = 0.0234`; in range (10 <= 15, LOS) so `contactTicks 0`, `proximity 1`. `killTicks = 56.47 + ceil((10 - 2.5) / 0.28) = 56.47 + 27 = 83.47` and `56.47 + ceil(8.5 / 0.28) = 56.47 + 31 = 87.47`. Damage `0.0234 * 83.47 + 0.0234 * 170.94 = 1.953 + 4.000 = 5.953`; `damageRatio = 5.953 / 5 = 1.19`; `deathRisk = sigmoid(6 * (1.19 - 0.9)) = 0.851`.
- `lowHp = clamp((14 - 5) / 8) = 1`, `escapeDrive = 1 * max(1, 0.8 * 0.851) = 1`, `escape = 1 * (0.35 + 1.6 * 0.787) = 1.610`. `retreatEff = 0.8 * 0.8 = 0.64` (normal speed, shooters with LOS); `forcedRetreat = 1.1` (skeleton `hp_below: 8`), `retreat = 0.64 * 1.1 = 0.704`. `shield = 0.25 + 0.5 * max(1, 0.838) = 0.750`. `attack = (1 - 0.851)^1.5 * 0.2 = 0.011`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.011 | 0.750 | 0.000 | 0.704 | 0.000 | 0.000 | **1.610** | 0.000 | 0.000 |

escape_rejoin wins by 115 % over the next option. With `escapeAvailable = false` it is 0 and `shield 0.750` wins (S2b then masks it anyway).

### Example 5: HP 5, 32 dirt only, 1 zombie at 3 blocks (hunger 18, no food)
- `otherCargoRaw = 32 * 0.1 = 3.2`, `deathCost = 110 + 3.2 = 113.2`, `valueWeight = 0.274`. Zombie: `contactTicks 5`, `proximity 0.917`, damage `0.0468 * (56.47 - 5) = 2.41`, `damageRatio 0.48`, `deathRisk = sigmoid(6 * (0.48 - 0.9)) = 0.075`.
- `lowHp 1`, `urgency 0.917`. `escape = 0.917 * (0.35 + 1.6 * 0.274) = 0.723`. `forcedRetreat = 1.1 * 0.917 = 1.008`; `retreat = 1.0 * max(0.917, 0.8, 1.008) = 1.008`. `attack = 1 * (0.925)^1.5 * 0.2 = 0.178`. `shield = 0.25 + 0.5 * 0.917 = 0.708`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.178 | 0.708 | 0.000 | **1.008** | 0.000 | 0.000 | 0.723 | 0.042 | 0.000 |

Retreat wins; escape is 28 % lower because the cargo is cheap.

### Example 6: creeper at 2.5 blocks, targeting the bot, while gathering
- `rawHit 43`, `burst = 43 * (1 - 2.5 / 6) * 0.52 = 13.04`; `contactTicks 0` (reach 3), `exposure 1`; no melee dps (explodes). `engage_if_blocking` and `targetingMe`: `policyFactor 1`; `killTicks 56.47`.
- HP 20: `rBurst = sigmoid(8 * (13.04 / 20 - 0.9)) = 0.121`, `deathRisk 0.121`, `attack = 1 * (0.879)^1.5 * 1.0 = 0.824`, `burstFear = 0.9 * 0.652 = 0.587`, `retreat = 0.8 * max(0.121, 0.587) = 0.470`, `shield = 0.25 + 0.5 * 0.421 = 0.461`, `escape = 0.097 * 0.779 = 0.075`.

| HP | attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|---|
| 20 | **0.824** | 0.461 | 0.000 | 0.470 | 0.000 | 0.000 | 0.075 | 0.000 | 0.000 |
| 12 | 0.063 | 0.658 | 0.000 | **0.783** | 0.000 | 0.000 | 0.509 | 0.000 | 0.000 |

At HP 20 the burst is survivable, so attack wins and S2b picks `knockback_then_retreat` (MOBS creeper). At HP 12 the same burst is `13.04 / 12 = 1.09` of the HP (`rBurst 0.817`, `attack = 0.183^1.5 * 0.8 = 0.063`), so retreat wins.

### Example 7: irrelevant zombie at 12 blocks while gathering (HP 20, hunger 20)
- `R` is empty: `exposure 0`, `deathRisk 0`, `urgency 0`. The zombie is in `T` (`minEatContactTicks = 40`) but irrelevant. `avoidPressure = max(0, 1 - 12 / 6) = 0` (radius 6). `resume_task = 0.5 * 1 = 0.5`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | **0.500** | 0.000 |

### Example 8: defend task, a zombie targets a player in the zone (zombie at 7.0, `threatensProtected` true, relevance `blocking_objective`, `targetingMe` false)
- `contactTicks = (7 - 2) / 0.2 = 25`, `proximity = 1 - 25/60 = 0.583`; damage `0.0468 * (56.47 - 25) = 1.47`, `deathRisk = sigmoid(6 * (0.074 - 0.9)) = 0.007`. `need = 1.1` (`needProtect`), `attack = 1.1 * 1 * (0.993)^1.5 * 1.0 = 1.089`. `resume_task = 0.5 * (1 - 0.583) = 0.208`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| **1.089** | 0.000 | 0.000 | 0.004 | 0.000 | 0.000 | 0.003 | 0.208 | 0.000 |

`shield` is 0 here: `inbound` needs `targetingMe`, `hurtMe` or `distance <= 4`.

### Example 9: enderman at 10 blocks, neutral and unprovoked (HP 20)
- Classification `neutral_unprovoked`: not in `T`, so no `ThreatEval`, no `attackable`: **attack 0**. It feeds `avoidPressure = 1 - 10/16 = 0.375`; `back_off = 0.9 * 0.375^2 = 0.127`. `resume_task 0.5`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.000 | 0.000 | 0.127 | 0.000 | 0.000 | 0.000 | 0.000 | **0.500** | 0.000 |

At 3 blocks `avoidPressure = 0.8125`, `back_off = 0.594` beats `resume_task` (`0.5 * (1 - 0) = 0.5`): the bot backs away from the enderman, never at it. (A provoked enderman is `threat`, policy `avoid`: `attack` only if blocking with danger <= 5, which never holds for danger 8, or cornered, section 5.)

### Example 10: after examples 1 and 2 (the retreat opened the gap, the meal restored HP): HP 20, hunger 20, 3 zombies at 6 / 7 / 8 blocks, no food left
- Fast regen 14 HP at 1 HP per 10 ticks is about 140 ticks. `contactTicks 20 / 25 / 30`; damage `1.707 + 4.116 + 6.524 = 12.35`, `damageRatio 0.617`, `deathRisk = sigmoid(6 * (0.617 - 0.9)) = 0.155`; `lowHp 0`, `hpFactor 1`. `attack = 1 * (0.845)^1.5 = 0.777`; `urgency = 0.667 * 0.155 = 0.103`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| **0.777** | 0.395 | 0.000 | 0.103 | 0.000 | 0.000 | 0.064 | 0.167 | 0.000 |

Examples 1, 2, 10 are the retreat, eat, fight chain with no scripted transition.

### Example 11: emergency food (HP 6, hunger 14, saturation 2, 3 zombies at 10 / 10.5 / 11, 1 golden_apple + 1 cooked_beef)
- `emergencyEatWanted`: golden apple held, `canEatEmergency` (no melee within 2), `hp 6 <= 6` and a threat within 16. `emergency = 1.2`. `canEatSafely`: `minEatContactTicks = (10 - 2) / 0.25 = 32 > 52` false, so `heal = 0`. `unsafeEat = 0.8`, `forcedRetreat = 1.1 * 0.333 = 0.367`, `retreat = 0.8`.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.000 | 0.000 | 0.000 | 0.800 | **1.200** | 0.000 | 0.260 | 0.333 | 0.000 |

(S2b `chooseFood("emergency")` returns the golden apple; this matches S2b example E5.)

### Example 12: top-up (HP 20, hunger 14, saturation 2, 5 bread, no threats)
- `topupWanted`: `14 <= 17`, `20 - 14 = 6 >= 2`, `T` empty, bread is `topup`. `hungerNeed = (17 - 14) / 11 = 0.273`; `eat = 0.55 + 0.35 * 0.273 = 0.645` beats `resume_task 0.5`. At hunger 17: `0.55 + 0 = 0.55` still wins; at hunger 18 `topupWanted` is false.

| attack | shield | back_off | retreat | eat | flee | escape_rejoin | resume_task | idle |
|---|---|---|---|---|---|---|---|---|
| 0.000 | 0.000 | 0.000 | 0.000 | **0.645** | 0.000 | 0.000 | 0.500 | 0.000 |

---

## 8. What S2b and the others consume

| Consumer | Uses | Contract |
|---|---|---|
| S2b `decide` | `computeDerived(p, kb, cfg)` once per pump, then `scoreOptions(p, d, kb, cfg)` | Returns `OptionScores`; S2b reads no `Derived` field (its S2b section 0). S2b masks, applies `criticalHp`, `switchMargin`, commitment. |
| S2b `mobOf` / `foodOf` / `valueOf` | `kb.mob`, `kb.food`, `kb.value` (D1) | `kb.value(typeId)` with one argument is valid. |
| S2b `botHasShield` | `hasUsableShield` | Same body, word for word; S2b imports it instead of keeping a copy. |
| S1 sensor | `computeValueSummary(inv, eq, objective, kb, cfg)` into `SelfPercept.values` | `objective = { ids: hint.items.ids, required: hint.items.required }` from the executor's `ObjectiveHint` (gather only); `undefined` otherwise. Recomputed on every inventory or equipment change, at most once per scan. |
| S1 `classify` | not S2a | `T` relies on `classification === "threat"`; S2a never reclassifies. |
| B2 | `createKnowledge`, tables of sections 2 and 4 | `KNOWLEDGE` is the object the runtime passes to `BrainFn`. |

---

## 9. Config keys (S2a)

### 9.1 Type (`CombatConfig` is the union of S1 section 10, S2b section 8 and this interface; the contract writer merges them)

```ts
export interface CombatConfigS2a {
  // damage model
  armorReductionPerPoint: number; armorTrust: number; armorReductionCap: number;
  meleeHitRate: number; mobMeleeUptime: number; rangedHitRate: number;
  chargedBurstMult: number; blastReach: number; damageHorizonTicks: number; noLosReach: number;
  proxHorizonTicks: number; threatHalfDist: number; botRefHp: number; botVulnMin: number; botVulnMax: number;
  // risk and HP
  riskSlope: number; riskMid: number; burstSlope: number; burstMid: number; lowHpStart: number;
  // value (TABLES 4.2) and escape
  objFull: number; otherCargoCap: number; enchantPerLevel: number; enchantMendingBonus: number; enchantMultCap: number;
  durabilityFloor: number; enchantedBookBase: number; enchantedBookPerLevel: number; enchantedBookMending: number;
  escapeValueHalf: number; escapeBase: number; escapeGain: number; escapeRiskWeight: number;
  // option weights
  needThreat: number; needBlock: number; needProtect: number; attackRiskExp: number; attackHpFloor: number;
  avoidAttackMaxDanger: number; avoidAttackFactor: number; corneredFactor: number; corneredDist: number;
  shieldBase: number; shieldGain: number; shieldReach: number; shieldPersonalDist: number;
  backOffWeight: number; backOffRadius: Readonly<Record<string, number>>; backOffRadiusDefault: number;
  retreatEffSlow: number; retreatEffNormal: number; retreatEffFast: number; retreatRangedMult: number;
  unsafeEatDrive: number; burstRetreatWeight: number;
  fleeIfScore: number; fleePolicyScore: number; fleePolicyRadius: number; fleeUrgencyWeight: number; fleeIfFinishFrac: number;
  eatGain: number; topupBase: number; topupGain: number; starveScore: number; emergencyEatScore: number;
  eatSafetyMarginTicks: number; eatMidMealMarginTicks: number; rangedEatReach: number; babySpeedMult: number;
  resumeBase: number; idleBase: number;
}
```
Keys read but owned elsewhere: S1 `scanRadius`; S2b `criticalHp`, `attackSpacingTicks`, `ttkReach`, `sprintBlocksPerTick`, `fistDamage`, `countRadius`, `shieldMinDurabilityFrac`, `topupHungerMax`, `topupMinMissing`, `starvingHunger`, `emergencyHp`, `emergencyHpAnyThreat`, `emergencyHostileRange`, `eatGuardThreatSpeed`, `eatMeleeBlockDist` (all defaults in S2b section 8).

### 9.2 Table. Bias: survival first (armour trusted at 80 %, enemies rated for the bot's current HP, long escape range, eating needs 52 ticks of clearance).

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `armorReductionPerPoint` | 0.04 | fraction/point | Damage cut per armour point (Bedrock 4 %) |
| `armorTrust` | 0.8 | factor | Discount on the armour cut (verify the real cut) |
| `armorReductionCap` | 0.8 | fraction | Largest damage cut counted |
| `meleeHitRate` | 0.85 | fraction | Share of the bot's swings that land; divides kill speed |
| `mobMeleeUptime` | 0.6 | fraction | Share of time a melee mob attacks (knockback, re-approach) |
| `rangedHitRate` | 0.6 | fraction | Share of arrows that hit a moving bot |
| `chargedBurstMult` | 2.0 | factor | Charged creeper damage multiplier (blast reach also doubles) |
| `blastReach` | 6 | blocks | Distance at which a creeper blast reaches the bot (damage falls linearly to 0) |
| `damageHorizonTicks` | 200 | ticks | A mob the bot cannot kill keeps hitting for this long in `expectedDamage` |
| `noLosReach` | 2 | blocks | Reach assumed for a ranged mob without line of sight (and for the eat guard) |
| `proxHorizonTicks` | 60 | ticks | Contact time at which proximity reaches 0 |
| `threatHalfDist` | 8 | blocks | Distance at which the threat falloff is 0.5 |
| `botRefHp` | 20 | HP | HP the MOBS danger values are rated for |
| `botVulnMin` / `botVulnMax` | 0.5 / 3.0 | factor | Clamp of `botRefHp / hp` in `threatLevel` |
| `riskSlope` | 6 | per ratio | Steepness of the fight-risk logistic |
| `riskMid` | 0.9 | HP ratio | `expectedDamage / hp` at which `deathRisk` is 0.5 |
| `burstSlope` / `burstMid` | 8 / 0.9 | per ratio / HP ratio | Same for explosion damage / hp |
| `lowHpStart` | 14 | HP | `lowHp` is 0 at this HP and 1 at `criticalHp` (6) |
| `objFull` | 1000 | value | `objectiveValue` at full progress (TABLES OBJ_FULL) |
| `otherCargoCap` | 900 | value | Cap of non-objective cargo; must stay below `objFull` |
| `enchantPerLevel` / `enchantMendingBonus` / `enchantMultCap` | 0.10 / 0.50 / 3.0 | factor | Gear value multiplier (TABLES 4.3) |
| `durabilityFloor` | 0.25 | fraction | Worn gear keeps at least this share of its value |
| `enchantedBookBase` / `enchantedBookPerLevel` / `enchantedBookMending` | 20 / 10 / 50 | value | Enchanted book price |
| `escapeValueHalf` | 300 | value | `deathCost` at which `valueWeight` is 0.5 |
| `escapeBase` | 0.35 | score | Escape multiplier at zero value |
| `escapeGain` | 1.6 | score | Escape multiplier gain at `valueWeight` 1 |
| `escapeRiskWeight` | 0.8 | factor | Weight of `deathRisk` in `escapeDrive` (low HP weighs 1.0) |
| `needThreat` | 1.0 | score | Attack need of a mob that targets or threatens the bot |
| `needBlock` | 0.6 | score | Attack need of a mob that only blocks the objective |
| `needProtect` | 1.1 | score | Attack need of a mob that threatens a protected player (defend) |
| `attackRiskExp` | 1.5 | exponent | `(1 - deathRisk)^exp` in attack |
| `attackHpFloor` | 0.2 | factor | Attack multiplier at `lowHp` 1 |
| `avoidAttackMaxDanger` | 5 | 0-10 | Highest danger an `avoid` mob may be attacked at when it blocks |
| `avoidAttackFactor` | 0.6 | factor | Attack multiplier for a blocking `avoid` mob |
| `corneredFactor` | 0.5 | factor | Attack multiplier for an `avoid` mob that is on the bot and cannot be outrun |
| `corneredDist` | 4 | blocks | "On the bot" distance for the cornered rule |
| `shieldBase` / `shieldGain` | 0.25 / 0.5 | score | Shield = base + gain * max(urgency, threatPressure) |
| `shieldReach` | 8 | blocks | Melee mob this close can make the shield inbound |
| `shieldPersonalDist` | 4 | blocks | An untargeting mob this close also makes the shield inbound |
| `backOffWeight` | 0.9 | score | Back-off = weight * avoidPressure^2 |
| `backOffRadius` | `{ "minecraft:enderman": 16, "minecraft:creeper": 8, "minecraft:warden": 30, "minecraft:phantom": 0 }` | blocks | Avoid radius per type (S3 `avoidRadius`); 0 = never |
| `backOffRadiusDefault` | 6 | blocks | Avoid radius of every other type |
| `retreatEffSlow` / `retreatEffNormal` / `retreatEffFast` | 1.0 / 0.8 / 0.5 | factor | How well running works against a mob of that speed class |
| `retreatRangedMult` | 0.8 | factor | Extra retreat penalty against a shooter with line of sight |
| `unsafeEatDrive` | 0.8 | score | Retreat drive when healing is wanted but eating is unsafe |
| `burstRetreatWeight` | 0.9 | score | Retreat drive per burst/HP ratio |
| `fleeIfScore` | 1.1 | score | Forced withdrawal when a MOBS `flee_if` holds (times proximity) |
| `fleePolicyScore` | 1.2 | score | Flee score near an `engage_policy: flee` mob |
| `fleePolicyRadius` | 32 | blocks | Distance within which a flee-policy mob drives `flee` |
| `fleeUrgencyWeight` | 0.5 | factor | Flee drive per urgency against avoid/flee mobs only |
| `fleeIfFinishFrac` | 0.2 | fraction | A lone attackable mob at or below this HP fraction does not force a withdrawal |
| `eatGain` | 1.3 | score | Eat (heal) = gain * lowHp |
| `topupBase` / `topupGain` | 0.55 / 0.35 | score | Top-up eat = base + gain * hungerNeed; base is above `resumeBase` |
| `starveScore` | 0.9 | score | Eat score when starving and safe |
| `emergencyEatScore` | 1.2 | score | Eat score for an emergency golden apple |
| `eatSafetyMarginTicks` | 20 | ticks | Clearance beyond the meal before contact (new meal) |
| `eatMidMealMarginTicks` | 6 | ticks | Same, for a meal already in progress |
| `rangedEatReach` | 10 | blocks | A shooter this close with line of sight blocks a meal |
| `babySpeedMult` | 1.5 | factor | Baby mob speed multiplier |
| `resumeBase` | 0.5 | score | Resume-task score with no exposure |
| `idleBase` | 0.1 | score | Idle score with no exposure and no task |

---

## 10. Requests to other sections

| To | Request |
|---|---|
| S1 / contract writer | Add `Percept.eating?: { typeId: string; remainingTicks: number }` (section 1.5), filled from the combat body's meal state. Change the S1 section 12 signature to `computeValueSummary(inv, eq, objective, kb, cfg)` (section 4); call it from the sensor with `objective = { ids: hint.items.ids, required: hint.items.required }`. |
| S1 | `SelfPercept.values` stays required; `ValueSummary` fields are exactly those S2a section 4 returns. |
| S2b | `evalCondition` and `CondEnv` must be exported from `stats.ts`, and `stats.ts` must not import `scoring.ts`. Import `hasUsableShield` instead of re-implementing `botHasShield`. In `chooseEat`, a committed meal (`s.commit.option === "eat"` with `stillHeld` food) should bypass the new-meal guard (`dn > eatTicks / 20 * 5 + 2`), otherwise step 7 masks `eat` mid-meal although S2a scored it safe with the shorter `eatMidMealMarginTicks`. `FoodEntry.effects` is `FoodEffect[]`: test poison with `f.effects.some(e => e.id === "poison")`. |
| S3 | `retreat` runs `retreat_and_regen`, `flee` runs `sprint_away`/`flee_sneak` (as S2b `TACTIC_CLASS`); S3 needs no change. `config.body.avoidRadius` and `config.combat.backOffRadius` must carry the same values (S3 uses its own for pathing). |
| Reconciler / PHASE3-SPEC | Add `knowledge.ts` to the B2 file list. PHASE3-SPEC 4: `Decision` lives in S2b, `Knowledge` and `Derived` in S2a. |
| S6 | Cases of section 11. |

## 11. Open questions (fallbacks chosen)

| # | Question | Fallback |
|---|---|---|
| Q1 | Mob speeds, attack intervals, melee uptime and armour discount are guesses. | Tables in section 2 and keys in 9.2, all `(verify)`; Phase 3 outcome logs and probe P3 recalibrate. Mispricing only shifts the retreat/fight boundary. |
| Q2 | MOBS `avoid` says "never initiate; use tactics only when escape is not possible", the brief says attack only if blocking and danger <= threshold. | Both: blocking and danger <= 5 (x0.6), plus a narrow cornered case (targeting, not slower than the bot, within 4 blocks: x0.5). Without the cornered case an enderman on top of the bot could never be fought. |
| Q3 | `Percept` has no meal-in-progress signal. | Optional `eating` field (1.5). Absent: a meal is dropped as soon as the new-meal guard (52 ticks of clearance) fails. |
| Q4 | `flee_if` names `retreat_and_regen`, `sprint_away` and `flee_sneak`; the brain has `retreat` and `flee`. | Mobs with policy `engage`/`engage_if_blocking` force `retreat`; `avoid`/`flee` force `flee` (section 5.1). |
| Q5 | No option "rest before resuming" exists for a calm bot at low HP. | `eat` covers recovery when food exists (score up to 1.3 beats `resume_task` 0.5); with no food and no threat the bot resumes (S1 RECOVER only follows an escape). |
| Q6 | Sequential-kill damage assumes mobs arrive in contact order and are killed in that order; S2b picks targets differently. | `expectedDamage` is an estimate for risk only; being too pessimistic by a factor under 2 is accepted. |
| Q7 | Sharpness and other enchants raise the bot's damage but `enchantLevelSum` cannot isolate them. | Ignored (D20); weapon damage comes from `weaponDamage` of the item type. |
| Q8 | `canEatSafely` is stricter than S2b's guard (about 15 vs 10 blocks for a zombie). | Accepted: S2b masks `eat` when its guard fails, S2a never lets `eat` win when its own guard fails. The stricter rule wins for new meals. |
| Q9 | The escape multiplier at deathCost 300 only barely beats a forced retreat (1.15 vs 1.1). | Intended crossover near 300; tune `escapeGain` / `escapeValueHalf`. |
| Q10 | The default hostile entry has `danger 6`, policy `avoid` and range 3. | Used unchanged: an unknown mob is never attacked (6 > `avoidAttackMaxDanger` 5) unless it is cornering the bot (section 5). |
| Q11 | Slimes and magma cubes split on death; the children's kill time is not modelled. | Ignored; the outcome logs (S2b) capture the real cost per tactic. |

## 12. Test cases for S6 / TC-B1

- `armourReduction`: 0 armour 0; 15 gives 0.48; 25 gives the cap 0.8.
- `botWeaponDamage`: unarmed 1; iron sword in hand 6; best weapon in a slot 6 while the hand is empty; wooden axe 3.
- `computeValueSummary`: the five TABLES 5 checks of section 4 (223.2; 1000 and 122; 312.5; logs 1000 + 8; enchanted chestplate 70.4); mainhand not counted twice; an objective item never counts as gear; `required 0` makes all held objective items ordinary cargo; `otherCargoCap` binds at 900.
- `computeDerived`: examples 1 to 12 of section 7, field by field (`expectedDamage 14.10`, `deathRisk 0.851`, `burst 13.04`, `avoidPressure 0.375`, `minEatContactTicks 8 / 72 / 28`, `valueWeight 0.268 / 0.787`).
- `computeDerived` edge cases: no entities (everything 0, `timeToDieTicks 6000`, `canEatSafely` true); `hungerKnown false` (hunger 20, `topupWanted` false, only always-edible foods picked); an unkillable mob (warden, `attackAllowed` false) sets `hasUnkillable` and uses the 200-tick horizon; baby zombie speed 0.30; Peaceful reads as Normal.
- `scoreOptions`: examples 1 to 12 (all nine scores, 3 decimals); `neutral_unprovoked`/`never_target`/`ignore` entities never produce attack; irrelevant threat gives attack 0; `engage_policy flee` gives attack 0 and flee 1.2 within 32 blocks; avoid mob blocking with danger 4 gives x0.6, danger 8 gives 0, cornered gives x0.5; `escapeAvailable false` gives escape 0; no NaN or Infinity for `hp 0` or an empty percept; scoring is deterministic (two calls equal); inputs are not mutated.
- Escape rule: sweep `deathCost` 113, 300, 610, 1110 at HP 5 with the same 2 skeletons: winner retreat, escape, escape, escape (section 5.2 table).
- Emergence: sequence examples 1, 2, 10 with `argmax`: retreat, eat, attack.
- No cooldown: two consecutive calls with identical inputs return identical escape scores (no hidden state).
