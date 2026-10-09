# S2b: decide(), commitment, targets, food choice, tactic selection, outcome stats

Owner of: `decide`, `Decision`, `BrainState`, `Commit`, `EngagementRecord`, `OutcomeStats`, `TacticStat`, `FoodSituation`, `FoodChoice`, `TerrainFacts`, `TacticFeedback`, and the `config.combat` keys of section 8.
Not owned (S2a exports, used here by name only): `computeDerived`, `scoreOptions`, `Derived`, `OptionScores`, `Knowledge`, `CombatConfig`, `Rng`, `FoodEntry`, `FoodTag`, `FoodEffect`, `hasUsableShield`, `ALWAYS_EDIBLE`, `EMERGENCY_FOODS`, `ATTACK_NEAR_BLOCKS`, `clamp`. Owned here and read by S2a: `criticalHp`, `switchMargin` (D3: one definition each, section 8).
Import rule (D22): `stats.ts` exports `evalCondition` and `CondEnv` and has **no import of `scoring.ts`**. `brain.ts` imports `scoring.ts` and `stats.ts`; `scoring.ts` imports `stats.ts`.
Builder: **B1** (`src/core/combat/brain.ts`, `src/core/combat/stats.ts`; pure, no `@minecraft/*`, no clock, no `Math.random`). Contract writer: every code block goes into the file named above it.

Conventions: distances in blocks, times in ticks (20/s), HP in points. "Pump" = 4 ticks. `now = p.now`. All `cfg.*` keys are `config.combat` keys (section 8 plus S1 section 10 plus S2a). Strict `<` for "below", `>=` for "at least". Functions never mutate their arguments; `decide` returns a new `BrainState`.

## 0. Interface assumptions (S2a, S1, S3, B2)

S2b reads exactly **two fields of `Derived`**: `d.canEatSafely` and `d.canEatEmergency` (D23: the eat guard is S2a's, S2b has no eat-distance threshold of its own). Everything else in `d` is only passed to `scoreOptions(p, d, kb, cfg)`. Target ordering uses its own `timeToKillTicks` (section 4). `kb` is S2a's `Knowledge` (D1); S2b uses its members `mob`, `food` and `value` exactly as S2a defines them (S2a 1.1), through three one-line aliases:

```ts
// brain.ts, private
const mobOf = (kb: Knowledge, typeId: string): MobEntry => kb.mob(typeId);              // = lookupMob(..., typeId) (S3 2.3); never undefined
const foodOf = (kb: Knowledge, typeId: string): FoodEntry | undefined => kb.food(typeId); // = foodEntry(typeId) (food.ts)
const valueOf = (kb: Knowledge, typeId: string): number => kb.value(typeId);              // per-item base value (S2a 1.1: `value(typeId, maxAmount?)`, one argument is valid)
```
`FoodEntry` fields read (S2a 1.1): `id, hunger, saturation, eatTicks, tags: FoodTag[], effects: FoodEffect[], returnsItem?`. `FoodTag` and `FoodEffect` are S2a's types (`FoodTag = "topup"|"main"|"raw"|"stew"|"avoid"|"emergency"|"escape"|"fast"|"regen"`). Imports: `weaponDamage` (S1 6.5), `WEAPON_DAMAGE`, `dist3` (S1 7.2), `Condition`, `MobEntry`, `TacticName` (S3 2); from `scoring.ts` (brain.ts only): `hasUsableShield`, `ALWAYS_EDIBLE`, `EMERGENCY_FOODS`, `ATTACK_NEAR_BLOCKS`.

**Percept additions requested from S1** (all optional so S1's builders compile unchanged; section 9 has the owner list):

```ts
export interface TerrainFacts {            // computed by B3 from world() with S3 scan helpers, cached <= 20 ticks
  groundFlat: boolean;                     // MOBS "ground_flat"
  hasCoverWithin8: boolean;
  hasLowCeilingWithin8: boolean;
  hasRoofWithin10: boolean;
}
export interface TacticFeedback {          // controller fills from the finished TacticRunner, for ONE pump
  tactic: TacticName;
  targetId?: string;
  status: "done" | "failed";
  reason: string;                          // TacticRunner.reason
  tick: Tick;
}
// Percept gains:
//   terrain?: TerrainFacts;                missing => groundFlat true, the other three false
//   canBlock?: boolean;                    CombatBody.canBlock() (S3 CR-3); missing => offhand shield present
//   shieldDisabled?: boolean;              S1 P14; missing => false
//   objectiveItemIds?: readonly string[];  ObjectiveHint.items.ids of the paused/active gather task; missing => []
//   tacticFeedback?: TacticFeedback;
// EntityPercept gains:
//   inWater?: boolean;                     missing => false
```

---

## 1. Public API

```ts
// src/core/combat/types.ts (S2b part). OptionKind is in the contract writer's types.ts (PHASE3-SPEC 4):
// "attack"|"shield"|"back_off"|"retreat"|"eat"|"flee"|"escape_rejoin"|"resume_task"|"idle"
export type FoodSituation = "topup" | "pre_engage_heal" | "emergency" | "starving" | "escape_teleport";
export interface FoodChoice { typeId: string; slot: number; eatTicks: number; situation: FoodSituation; emergency: boolean }

export interface Decision {
  option: OptionKind;
  targetId?: string;            // attack/shield/back_off: the target; retreat/flee/escape_rejoin: the primary threat (display only)
  tactic?: TacticName;          // set for attack, shield, back_off, retreat, flee when a target exists (section 6.3)
  foodTypeId?: string;          // eat only
  foodSlot?: number;            // eat only: inventory slot (S3 EatRequest.slot)
  eatMode?: "normal" | "emergency"; // eat only (S3 EatRequest.mode)
  moveTo?: Vec3;                // retreat only: home.pos if home.dimensionId === self.dimensionId, else owner.pos if defined, else undefined
  scores: OptionScores;         // raw scoreOptions output (debug)
  masked: OptionKind[];         // options forced to -Infinity this pump (debug)
  reason: string;               // short code, section 3.4 (debug, shown by !status debug)
}

export interface Commit {
  option: OptionKind;
  targetId?: string;
  since: Tick;
  /** End of the minimum-commit window. The option stays committed after `until` until a switch passes section 3.2. */
  until: Tick;
  /** Score of `option` at the last pump (debug only; the switch rule uses the CURRENT pump's score). */
  score: number;
  /** eat only: sticky food choice. */
  food?: FoodChoice;
}
export interface ActiveTactic { name: TacticName; targetId: string; mobKey: string; since: Tick; condFalseSince?: Tick }

export type EngagementOutcome = "win" | "loss" | "abandon";
export interface EngagementRecord {
  mobKey: string;               // MobEntry.id of the target ("default" for unknown mobs)
  targetId: string;
  tactic: TacticName;
  startTick: Tick;
  startHp: number;
  damageTaken: number;          // sum of HP drops between pumps since start
  lastHp: number;
  lastSeenTick: Tick;           // last pump the target was in p.entities
  lastDist: number;
  lastHpFrac?: number;          // target hp/maxHp at last sight, if known
  hit: boolean;                 // true once the target's hurtByMeAtTick >= startTick was seen
  clean: boolean;               // false once > cfg.statsMaxHostiles threats were within cfg.countRadius
  offSince?: Tick;              // first pump of the current stretch with option resume_task/idle
}

export interface TacticStat {   // accumulators; n === wins + losses
  n: number; wins: number; losses: number; damageTaken: number; ticks: number; abandons: number;
}
export interface OutcomeStats {
  version: 1;
  mobs: Record<string, Partial<Record<TacticName, TacticStat>>>;   // key = MobEntry.id
  skipped: number;              // engagements that ended win/loss but were not clean
}

export interface BrainState {
  version: 1;
  lastTick?: Tick;              // tick of the previous decide()
  lastHp?: number;
  commit?: Commit;
  tactic?: ActiveTactic;
  engagement?: EngagementRecord;
  banned: Partial<Record<TacticName, Tick>>;  // tactic -> banned until (exclusive)
  eatBanUntil: Tick;
  lastFeedbackTick: Tick;       // tick of the last TacticFeedback consumed
  stats: OutcomeStats;
}
```

Provocation memory: the skeleton lists it under `BrainState`, but S1 5.5 keeps one shared `ProvocationMemory` (it must see other bots' hits). `BrainState` therefore has **no** provocation field; `EntityPercept.provoked` is the only input. (Reconciler: update PHASE3-SPEC 4.)

```ts
// src/core/combat/brain.ts
export function newBrainState(): BrainState;     // { version:1, banned:{}, eatBanUntil:0, lastFeedbackTick:-1, stats:{version:1,mobs:{},skipped:0} }
export function decide(p: Percept, s: BrainState, kb: Knowledge, cfg: CombatConfig, rng: Rng): { decision: Decision; state: BrainState };
/** ControllerDeps.onBotDeath. Records a loss for the open engagement (if clean), clears commit/tactic/engagement/eat ban/bans. */
export function onBotDeath(s: BrainState, now: Tick, cfg: CombatConfig): BrainState;
export function chooseFood(situation: FoodSituation, self: SelfPercept, ctx: FoodContext, kb: Knowledge, cfg: CombatConfig): FoodChoice | undefined;
export interface FoodContext {
  objectiveItemIds: readonly string[];
  /** Threat-classified entities (any relevance) with distance <= cfg.scanRadius, nearest first, as {distance, typeId}. Empty = none. Same set as S2a's Derived.threats. */
  threats: ReadonlyArray<{ distance: number; typeId: string }>;
  escapeAvailable: boolean;
  /** = Derived.canEatSafely (S2a 3.11, D23). The only distance/time guard of the normal, pre_engage_heal and starving situations. */
  canEatSafely: boolean;
  /** = Derived.canEatEmergency (S2a 3.11, D23). The guard of the emergency and escape_teleport situations. */
  canEatEmergency: boolean;
}
export function selectTarget(p: Percept, kb: Knowledge, cfg: CombatConfig, option: OptionKind, prevTargetId: string | undefined): EntityPercept | undefined;
export function timeToKillTicks(e: EntityPercept, p: Percept, kb: Knowledge, cfg: CombatConfig): number;

// src/core/combat/stats.ts
export function evalCondition(c: Condition, env: CondEnv): boolean;     // + `export interface CondEnv` (section 6.1); S2a imports both; stats.ts never imports scoring.ts (D22)
export function makeCondEnv(p: Percept, e: EntityPercept, entry: MobEntry, cfg: CombatConfig, botHasShield: boolean): CondEnv;   // section 6.1
export function allowedTactics(entry: MobEntry, env: CondEnv, option: OptionKind, bans: BrainState["banned"], now: Tick): TacticName[];
export function selectTactic(p: Percept, s: BrainState, kb: Knowledge, cfg: CombatConfig, rng: Rng, option: OptionKind, target: EntityPercept, botHasShield: boolean): { tactic: TacticName | undefined; explored: boolean };
export function utilityOf(stat: TacticStat | undefined, rank: number, cfg: CombatConfig): number;
export function recordOutcome(st: OutcomeStats, mobKey: string, tactic: TacticName, o: EngagementOutcome, damage: number, ticks: number, clean: boolean, cfg: CombatConfig): OutcomeStats;
export function serializeStats(st: OutcomeStats): string;       // section 6.5
export function parseStats(json: string | undefined): OutcomeStats;   // never throws; invalid => fresh
```

`ControllerDeps.brain` (S1 `BrainFn`, no rng) is bound by the runtime: `(p, s, kb, cfg) => { const r = decide(p, s, kb, cfg, rng); return { decision: r.decision, brainState: r.state }; }` with the runtime's seeded `Rng`. `kb` is S2a's `KNOWLEDGE` (knowledge.ts). `chooseFood` dep: `(sit, self) => chooseFood(sit, self, { objectiveItemIds: [], threats: [], escapeAvailable: true, canEatSafely: true, canEatEmergency: true }, kb, cfg)?.typeId` (used only for RECOVER, where no threat is near, so both guards are true).

---

## 2. `decide()` algorithm

Every step is deterministic; `rng` is called in exactly one place (section 6.3 step 5).

1. **Copy.** `s = structuredCopy(s0)`. `now = p.now`, `self = p.self`.
2. **Upkeep.**
   a. Accounting: `if (s.engagement) { s.engagement.damageTaken += max(0, s.engagement.lastHp - self.hp); s.engagement.lastHp = self.hp; }`. `s.lastHp = self.hp`.
   b. Feedback: `fb = p.tacticFeedback`. If `fb && fb.tick > s.lastFeedbackTick`: `s.lastFeedbackTick = fb.tick`; if `fb.status === "failed"`: `s.banned[fb.tactic] = now + cfg.tacticBanTicks`; if `s.tactic?.name === fb.tactic`: `s.tactic = undefined` (also for `"done"`).
   c. Drop expired bans (`banned[t] <= now`).
   d. Gap: `gap = s.lastTick === undefined ? 0 : now - s.lastTick`. If `gap > cfg.commitStaleTicks` or `p.layer === "reflex"`: `interrupt = "reflex_gap"` (the brain was not running: reflex, handoff or dispose). If `gap > cfg.engageGapTicks`: end the engagement as `abandon` (section 6.4 rule A8).
3. `d = computeDerived(p, kb, cfg)`; `raw = scoreOptions(p, d, kb, cfg)`.
4. **Sets.** `threats` = entities with `classification === "threat"` and `relevance !== "irrelevant"`. `attackable` = threats with `attackAllowed` and (`inLeash` or `distance <= ATTACK_NEAR_BLOCKS` (3.5)) (S1 L1); identical to S2a's `ThreatEval.attackable`.
5. **Food.** `food = chooseEat(p, s, d, kb, cfg)` (section 5.1) or `undefined` when `now < s.eatBanUntil`.
6. **Hard interrupts** (section 3.3), in order; the first that fires sets `interrupt` and clears `s.commit` (the engagement is not touched, it ends by its own rules).
7. **Masks.** `m = copy of raw`, `masked = []`. Set `m[k] = -Infinity` (and push `k`) when:

   | Option | Masked when |
   |---|---|
   | any | `!Number.isFinite(raw[k])` and `raw[k] !== -Infinity` (NaN, +Infinity) |
   | attack | `attackable.length === 0`; or critical mask (below) |
   | shield | `!hasUsableShield(p, cfg)` or `p.shieldDisabled === true` or `threats.length === 0` |
   | back_off | `threats.length === 0` |
   | eat | `food === undefined` |
   | escape_rejoin | `p.escapeAvailable === false` |
   | resume_task | `p.taskKind === undefined`; or critical mask |
   | idle | `p.taskKind !== undefined`; or critical mask |

   Critical mask: `self.hp <= cfg.criticalHp` and some `threats[i].distance <= cfg.criticalThreatRange` (16). It masks attack, resume_task and idle.
8. **Pick** (section 3.2): `fallback = p.taskKind ? "resume_task" : "idle"`; `best = argmaxOption(m, fallback)`; `chosen = s.commit ? holdOrSwitch(s.commit, m, best, now, cfg) : best`.
9. **Target.** `target = selectTarget(p, kb, cfg, chosen, s.commit?.option === chosen ? s.commit.targetId : undefined)` (section 4). If `chosen === "attack"` and `target` is undefined (cannot happen after the mask; defensive): `m.attack = -Infinity` and redo steps 8-9 once.
10. **Tactic** (section 6.3): if `target` and `chosen` has a tactic class: `{tactic} = selectTactic(...)`; update `s.tactic`.
11. **Food on the decision:** if `chosen === "eat"`: `fc = food` (`chooseEat` already returns the sticky choice of a committed meal, section 5.1); set `foodTypeId, foodSlot, eatMode = fc.emergency ? "emergency" : "normal"`. `stillHeld(self, fc)` = `self.inventory.slots` has `slot === fc.slot` with `typeId === fc.typeId` (used by `chooseEat`). If the sticky food is gone, `chooseEat` falls through to a fresh choice.
12. **Commit update** (section 3.1): new `Commit` when `chosen !== s.commit?.option` or no commit; else refresh `score`, `targetId`, `food`.
13. **Engagement update** (section 6.4).
14. `moveTo` for `retreat`; `s.lastTick = now`; build `Decision` (`reason` per 3.4); return `{ decision, state: s }`.

**Shield predicate (D22).** S2b has no copy of `botHasShield`: it imports `hasUsableShield(p, cfg)` from `scoring.ts` (S2a 6; same body as the former local function, ignores `shieldDisabled`). `CondEnv.botHasShield = hasUsableShield(p, cfg)`, computed once in `brain.ts` and passed down (`stats.ts` cannot import `scoring.ts`, so `selectTactic` receives it as a parameter, section 1).

---

## 3. Commitment and hysteresis

### 3.1 Minimum commit ticks (`cfg.minCommitTicks`)

When a new option is committed at tick `now`: `until = now + minCommitTicks[option]`; for `eat`: `until = now + max(36, food.eatTicks + 4)`.

| Option | Ticks | Why |
|---|---|---|
| attack | 24 | two attack spacings (12) |
| shield | 20 | raise delay 5 plus one block/counter cycle |
| back_off | 16 | S3 `hit_and_back_off` back-step is 10 ticks |
| retreat | 60 | 3 s to gain distance before re-deciding |
| eat | 36 | 32-tick meal plus margin; recomputed from the food |
| flee | 80 | warden/avoid mobs: do not turn back |
| escape_rejoin | 4 | the controller hands off at once (S1 3.6) |
| resume_task | 0 | exempt (below) |
| idle | 0 | exempt (below) |

### 3.2 Switch rule

```ts
export const TIE_ORDER: readonly OptionKind[] = ["escape_rejoin","flee","retreat","eat","shield","back_off","attack","resume_task","idle"];
const TIE_EPS = 1e-9;
export function argmaxOption(m: OptionScores, fallback: OptionKind): OptionKind {
  let best: OptionKind | undefined; let bestV = -Infinity;
  for (const k of TIE_ORDER) {                      // earlier in TIE_ORDER wins ties
    const v = m[k];
    if (!(v > -Infinity)) continue;                 // skips -Infinity and NaN
    if (best === undefined || v > bestV + TIE_EPS) { best = k; bestV = v; }
  }
  return best ?? fallback;
}
export function holdOrSwitch(cur: Commit, m: OptionScores, best: OptionKind, now: Tick, cfg: CombatConfig): OptionKind {
  if (best === cur.option) return cur.option;
  const curScore = m[cur.option];
  if (!(curScore > -Infinity)) return best;                         // committed option became infeasible
  if (cur.option === "resume_task" || cur.option === "idle") return best;   // calm options never hold anything back
  const bypassWindow = best === "escape_rejoin" || best === "flee";
  if (now < cur.until && !bypassWindow) return cur.option;          // inside the minimum-commit window
  const threshold = curScore + Math.abs(curScore) * cfg.switchMargin;   // = curScore * (1 + margin) for curScore >= 0
  return m[best] > threshold ? best : cur.option;                   // strict >; ties stay
}
```
Notes: the margin compares the CURRENT pump's score of the committed option, not a stored one. For `curScore < 0` the threshold is `curScore * (1 - margin)` (less negative), so "better by 15 %" keeps its meaning. Scores are used as given; S2a's scale does not matter.

### 3.3 Hard interrupts (each clears `s.commit`; the pick that follows is a plain argmax, no hysteresis)

| # | Code | Condition |
|---|---|---|
| H1 | `critical_hp` | `self.hp <= cfg.criticalHp` and a threat is within `cfg.criticalThreatRange`. Also applies the critical mask (step 7), so attack/resume/idle cannot be picked. |
| H2 | `target_gone` | `s.commit` exists, `s.commit.option` is `attack`, `shield` or `back_off`, `s.commit.targetId` is defined, and no entity in `p.entities` has that id with `classification === "threat"` (for `attack` additionally `attackAllowed`). |
| H3 | `eat_interrupted` | `s.commit?.option === "eat"`, `s.commit.food?.emergency !== true`, and some threat (any relevance) is within `cfg.eatInterruptDist` (3) of the bot. Also sets `s.eatBanUntil = now + cfg.eatRetryTicks`. |
| H4 | `reflex_gap` | step 2d. |
| H5 | `infeasible` | `m[s.commit.option] === -Infinity` after masking (step 7 runs before the pick). Handled inside `holdOrSwitch`. |

Order H1, H2, H3, H4 (the first match names `interrupt`; all matching ones are applied). An S1 reflex or an escape handoff always produces H4 on the next brain pump because the brain did not run.

### 3.4 `Decision.reason` codes
`"interrupt:<code>"` when an interrupt fired this pump; else `"held_window"` (window hold), `"held_margin"` (margin hold), `"switch"` (switch passed), `"fresh"` (no commit), `"same"` (best equals the committed option).

---

## 4. Target selection

```ts
export function timeToKillTicks(e: EntityPercept, p: Percept, kb: Knowledge, cfg: CombatConfig): number {
  const mainhand = p.self.equipment.mainhand ? weaponDamage(p.self.equipment.mainhand.typeId) : undefined;
  const bestSlot = p.self.inventory.bestWeaponSlot === undefined ? undefined
    : weaponDamage(p.self.inventory.slots.find(i => i.slot === p.self.inventory.bestWeaponSlot)?.typeId ?? "");
  const dmg = Math.max(mainhand ?? 0, bestSlot ?? 0, cfg.fistDamage);          // fistDamage = 1
  const hp = e.hp ?? mobOf(kb, e.typeId).hp;
  const hits = Math.ceil(hp / dmg);
  const approach = Math.ceil(Math.max(0, e.distance - cfg.ttkReach) / cfg.sprintBlocksPerTick);
  return hits * cfg.attackSpacingTicks + approach;                              // 12 ticks per hit (S3 1.2)
}
```
S2a's own time-to-kill may differ in detail; this function is authoritative only for ordering targets.

`selectTarget(p, kb, cfg, option, prevTargetId)`:
1. Candidate set `C`: for `option === "attack"` the `attackable` list (step 4); for `shield`, `back_off`, `retreat`, `flee`, `escape_rejoin`, `eat`, `resume_task`, `idle` the `threats` list (display/orientation only; `eat`, `resume_task`, `idle` return `undefined` at once). Entities with `distance > cfg.scanRadius` are dropped.
2. `C` empty: `undefined`.
3. Tier of each entity: **0** if `typeId === "minecraft:creeper"` and `distance <= cfg.creeperPriorityDist` (4); else **1** if `relevance === "threatening_me"`; else **2** (`blocking_objective`). Interpretation of the brief's list: the creeper rule pre-empts the other two tiers.
4. Order within a tier:
   - tier 0: `distance` ascending, then `id` ascending (string compare).
   - tier 1: `timeToKillTicks` ascending, then `distance`, then `id`.
   - tier 2: `distance` ascending, then `timeToKillTicks`, then `id`.
5. `best` = first of the sorted list.
6. **Stickiness:** `prev = C.find(e => e.id === prevTargetId)`. If `prev` and `prev.id !== best.id` and `tierOf(best) >= tierOf(prev)`: return `prev`. Otherwise return `best`. (Only a strictly better tier displaces the current target: a creeper closing inside 4 blocks, or a mob that starts threatening the bot while the current target is merely blocking.)
7. **Leash (S1 7.4):** enforced by `attackable` (L1). L2 and L3 live in S3 movement; the brain only guarantees it never selects an attack target that is outside the leash and farther than 3.5 blocks. `blocking_objective` mobs outside the leash are therefore never attack candidates.

---

## 5. Food choice

### 5.1 `chooseEat` and the situation chain

```ts
function chooseEat(p: Percept, s: BrainState, d: Derived, kb: Knowledge, cfg: CombatConfig): FoodChoice | undefined {
  if (p.now < s.eatBanUntil || p.self.inventory.foods.length === 0) return undefined;
  // D22: a committed meal skips the new-meal guard. S2a already scored `eat` with the shorter mid-meal margin (S2a 3.11), so the
  // food is simply kept while it is still held; H3 (threat within eatInterruptDist) is the only interrupt.
  const sticky = s.commit?.option === "eat" ? s.commit.food : undefined;
  if (sticky && stillHeld(p.self, sticky)) return sticky;
  const ctx: FoodContext = {
    objectiveItemIds: p.objectiveItemIds ?? [],
    threats: p.entities.filter(e => e.classification === "threat" && e.distance <= cfg.scanRadius).map(e => ({ distance: e.distance, typeId: e.typeId })), // already distance-sorted
    escapeAvailable: p.escapeAvailable,
    canEatSafely: d.canEatSafely,            // D23
    canEatEmergency: d.canEatEmergency,      // D23
  };
  for (const sit of triggeredSituations(p, ctx, kb, cfg)) {   // fixed order below
    const c = chooseFood(sit, p.self, ctx, kb, cfg);
    if (c) return c;
  }
  return undefined;
}
function stillHeld(self: SelfPercept, fc: FoodChoice): boolean {
  return self.inventory.slots.some(i => i.slot === fc.slot && i.typeId === fc.typeId);
}
```
`triggeredSituations` returns, in this order, every situation whose trigger holds (`H` = `self.hp`, `hunger = self.hungerKnown ? self.hunger : 20`, `missing = 20 - hunger`, `T16` = a threat with `distance <= cfg.emergencyHostileRange` (16), `Tany` = any threat in `ctx.threats`):

| Order | Situation | Trigger |
|---|---|---|
| 1 | emergency | `H <= cfg.emergencyHp` (6) and `T16`; or `H <= cfg.emergencyHpAnyThreat` (4) and `Tany` |
| 2 | escape_teleport | `H <= cfg.emergencyHp` and a melee threat within 3.0 and `!p.escapeAvailable` and no emergency food held (`enchanted_golden_apple`, `golden_apple`) |
| 3 | starving | `self.hungerKnown` and `hunger <= cfg.starvingHunger` (6) and no eligible item with tag topup/main/raw (eligibility of 5.2, ignoring `missing`); or `hunger === 0` and `self.lastDamage?.cause === "starve"` and `p.now - self.lastDamage.tick <= 100` |
| 4 | pre_engage_heal | (a threat with `relevance !== "irrelevant"` within 24, or `p.recovering`) and (`hunger < 20` or `H < self.maxHp`) |
| 5 | topup | `Tany` is false and `hunger <= cfg.topupHungerMax` (17) and `missing >= cfg.topupMinMissing` (2) |

Melee threat = `!mobOf(kb, typeId).special.includes("ranged_projectile")`. The emergency fall-through to `pre_engage_heal` of TABLES 3.1 is the chain itself (situation 4 follows 1).

### 5.2 `chooseFood(situation, self, ctx, kb, cfg)`

Shared definitions (`hunger` and `missing` as above; `sat` = `self.saturation`):
- `held(typeId)` = lowest-slot stack in `self.inventory.foods` with that typeId. The returned `slot` is that stack's slot.
- `eligible(item)`: `foodOf` exists; `amount >= 1`; `item.typeId` not in `ctx.objectiveItemIds` (waived for `emergency`, `starving`); and `hunger < 20` or typeId in S2a's `ALWAYS_EDIBLE` (imported, not redefined: `golden_apple, enchanted_golden_apple, chorus_fruit, honey_bottle`). If `!self.hungerKnown`, `hunger` is taken as 20 (only always-edible foods are eligible).
- `satGain(f) = min(min(20, hunger + f.hunger), sat + f.saturation) - sat` (TABLES 3).
- **Never-in-these-tags rule:** `topup` and `pre_engage_heal` ignore items tagged `avoid`, `emergency`, `escape`. `topup` additionally excludes `minecraft:golden_carrot` (TABLES 3.3).
- **Tie-break for every pick** (after the rule's own keys): lower `valueOf`, then shorter `eatTicks`, then alphabetical typeId.
- **Guards (D23).** There is no distance threshold in S2b. The old thresholds (`eatGuardMargin` 2 blocks, `preEngageContactMarginTicks` 20 ticks, and the `dn > eatTicks / 20 * 5 + 2` test) are removed; the speed floor `eatGuardThreatSpeed` and the margins live in S2a 3.11.
  - normal, `pre_engage_heal`, `starving`: `ctx.canEatSafely` (S2a `Derived.canEatSafely`: `minEatContactTicks > eatNeedTicks + eatMarginTicks`, i.e. the nearest threat is more than 52 ticks from contact for a 32-tick meal).
  - emergency / escape_teleport: `ctx.canEatEmergency` (S2a: no melee threat within `cfg.eatMeleeBlockDist` (2.0) unless `self.hp <= cfg.emergencyHpAnyThreat` (4)).
  - poison items (`f.effects.some(e => e.id === "poison")`): additionally `self.hp >= cfg.poisonMinHp` (8) and no threat in `ctx.threats` within 16 (this guard is S2b's own; S2a does not model poison).
  - `canEatSafely` uses S2a's reference meal length (`eatTicksRef`, normally 32); a food with a longer `eatTicks` (honey_bottle 40) is accepted on the same test (Q10).
- Result: `{ typeId, slot, eatTicks: f.eatTicks, situation, emergency: situation === "emergency" || situation === "escape_teleport" }`. A candidate failing its guard makes that situation return `undefined` (no second-best is tried).

Per situation:

| Situation | Procedure |
|---|---|
| topup | `for tag of [topup, main, raw]`: `L = eligible items having tag` (after the exclusions). First tag with `L.length > 0` wins; stop looking at later tags. In `L`: `fit = L.filter(f.hunger <= missing)`; if `fit` non-empty pick max `f.hunger` (tie-break above). Else the smallest `f.hunger` item `g`: use it only if `g.hunger - missing <= 2`; else return `undefined`. |
| pre_engage_heal | `for tag of [main, topup]`: first tag with an eligible item wins. Pick max `satGain`; tie max `f.hunger`; then the shared tie-break. |
| emergency | First held of `EMERGENCY_FOODS` (S2a: `[enchanted_golden_apple, golden_apple]`, fixed order). Eligible ignoring hunger and objective ids. Guard `canEatEmergency`. |
| starving | In order: (1) tags `topup, main, raw` by `fit_largest` ignoring `missing` (max `f.hunger`); (2) tag `stew` (excluding items also tagged `avoid`) max `f.hunger`; (3) `AVOID_ORDER` first held whose condition holds: rotten_flesh (none), chicken (none), spider_eye (HP >= 8), poisonous_potato (HP >= 8), suspicious_stew (HP >= 12), pufferfish (HP >= 12 and hunger <= 2); (4) `chorus_fruit`; (5) the emergency list, only if `self.hp <= cfg.emergencyHp`. First step that yields an item wins. Guard `canEatSafely`. |
| escape_teleport | `chorus_fruit` if held. |

---

## 6. Tactic selection and outcome stats

### 6.1 Condition evaluation

```ts
export interface CondEnv {
  p: Percept; e: EntityPercept; entry: MobEntry; cfg: CombatConfig;
  hostile12: number;     // entities with classification "threat", relevance !== "irrelevant", distance <= cfg.countRadius (12), including e (= S2a 3.1)
  sameType12: number;    // of those, with e.typeId
  botHasShield: boolean; // = hasUsableShield(p, cfg), computed by brain.ts and passed in (stats.ts does not import scoring.ts)
}
export function makeCondEnv(p: Percept, e: EntityPercept, entry: MobEntry, cfg: CombatConfig, botHasShield: boolean): CondEnv {
  const near = p.entities.filter(x => x.classification === "threat" && x.relevance !== "irrelevant" && x.distance <= cfg.countRadius);
  return { p, e, entry, cfg, botHasShield, hostile12: near.length, sameType12: near.filter(x => x.typeId === e.typeId).length };
}
export function evalCondition(c: Condition, env: CondEnv): boolean {
  switch (c.kind) {
    case "and": return c.terms.every(t => evalCondition(t, env));
    case "or":  return c.terms.some(t => evalCondition(t, env));
    case "bool": { const v = evalBool(c.atom, env); return c.negated ? !v : v; }
    case "num":  return evalNum(c.atom, c.n, env);
  }
}
```
`hp = env.p.self.hp`; `terrain = env.p.terrain` (missing: `groundFlat` true, others false); `hasEffect(id)` as S1 9.2.

| Bool atom | True iff |
|---|---|
| always | true |
| mob_in_water | `e.inWater === true` |
| bot_in_water | `self.inWater` |
| mob_is_baby | `e.isBaby` |
| mob_hissing | `e.isIgnited` or (`e.typeId === "minecraft:creeper"` and `e.distance < cfg.hissProxyDist` (3)) |
| mob_aggroed_on_bot | `e.targetingMe` |
| mob_has_los | `e.lineOfSight` |
| bot_has_shield | `env.botHasShield` |
| bot_shield_disabled | `p.shieldDisabled === true` |
| has_cover_within_8 / has_low_ceiling_within_8 / has_roof_within_10 / ground_flat | `terrain.hasCoverWithin8` / `hasLowCeilingWithin8` / `hasRoofWithin10` / `groundFlat` |
| mob_is_diving | `e.velocity.y < -0.1` and horizontal distance (x,z) from bot to `e.pos` `< 8` |
| is_daylight / is_thunderstorm | `p.env.isDaylight` / `p.env.thunderstorm` |
| mob_charged | `e.isCharged` |
| mob_size_large / medium / small | only for `minecraft:slime`, `minecraft:magma_cube`; else false. By `mh = e.maxHp ?? e.hp`: large `mh >= 9`, medium `3 <= mh < 9`, small `mh < 3`. If `mh` is undefined use the box: `w = 2 * aabb.extent.x`; large `w >= 1.5`, medium `0.75 <= w < 1.5`, small `w < 0.75`; no box: large |
| target_is_objective_blocker | `e.relevance === "blocking_objective"` |

| Num atom (`n`) | True iff |
|---|---|
| hp_below / hp_at_least | `hp < n` / `hp >= n` |
| dist_below / dist_at_least | `e.distance < n` / `>= n` |
| count_at_least | `env.sameType12 >= n` |
| hostile_count_at_least | `env.hostile12 >= n` |
| poisoned_and_hp_below / slowed_and_hp_below / wither_and_hp_below | effect `minecraft:poison` / `minecraft:slowness` / `minecraft:wither` active and `hp < n` |
| shield_durability_below_pct | a shield is held (offhand or `shieldSlot`) and `round(durabilityFrac * 100) < n` |
| armor_durability_below_pct | at least one of `equipment.head/chest/legs/feet` exists and the lowest `round(durabilityFrac * 100) < n` |

### 6.2 Allowed tactics

Option to tactic class (the tactics a decision with that option may run); `shield_hold` appears in two classes on purpose (as a fight tactic under `attack`, as the defensive stance under `shield`):

```ts
export const TACTIC_CLASS: Record<OptionKind, readonly TacticName[]> = {
  attack:   ["melee_crit","melee_strafe","hit_and_back_off","rush_kill","knockback_then_retreat","low_ceiling_fight","shield_advance_zigzag","swoop_counter","shield_hold","break_line_of_sight"],
  shield:   ["shield_hold"],
  back_off: ["avoid_path_around","take_cover_overhead"],
  retreat:  ["retreat_and_regen"],
  flee:     ["flee_sneak","sprint_away"],
  eat: [], escape_rejoin: [], resume_task: [], idle: [],
};
export const TACTIC_FALLBACK: Partial<Record<OptionKind, TacticName>> = {
  attack: "melee_strafe", shield: "shield_hold", back_off: "avoid_path_around", retreat: "retreat_and_regen", flee: "sprint_away",
};
```
`allowedTactics(entry, env, option, bans, now)`: walk `entry.tactics` in MOBS order (index = rank); keep a rule `r` iff `r.name` is in `TACTIC_CLASS[option]`, `evalCondition(r.when, env)`, `!(bans[r.name] > now)`, and the gear/terrain gate holds:

| Tactic | Gate |
|---|---|
| shield_hold, shield_advance_zigzag, swoop_counter | `env.botHasShield` and `p.shieldDisabled !== true` |
| break_line_of_sight | `terrain.hasCoverWithin8` |
| take_cover_overhead | `terrain.hasRoofWithin10` |
| low_ceiling_fight | `terrain.hasLowCeilingWithin8` |
| knockback_then_retreat | `!e.isCharged` |

Duplicates (same name twice) keep the first. The result is rank-ordered, best first. Melee weapons are not gated (S2a scores `attack` low without one).

### 6.3 `selectTactic`

`entry = mobOf(kb, target.typeId)`, `mobKey = entry.id`, `env = makeCondEnv(p, target, entry, cfg, botHasShield)` (`botHasShield` is the last parameter of `selectTactic`).
1. `cls = TACTIC_CLASS[option]`; empty: return `{ tactic: undefined, explored: false }`.
2. **Keep:** if `s.tactic` has `targetId === target.id`, `s.tactic.name` is in `cls`, it is not banned, and either its rule's `when` holds or has been false for `< cfg.tacticGraceTicks` (20) (`condFalseSince` bookkeeping; a tactic whose gate fails counts as "false"): return it, no rng.
3. `allowed = allowedTactics(...)`. Empty: `{ tactic: TACTIC_FALLBACK[option], explored: false }` (the fallback is not banned-checked).
4. `option !== "attack"` or `allowed.length === 1`: `{ tactic: allowed[0], explored: false }` (no rng, no stats).
5. **Epsilon-greedy over utility** (`option === "attack"`, `allowed.length >= 2`):
   ```ts
   const u = allowed.map((t, rank) => utilityOf(s.stats.mobs[mobKey]?.[t], rank, cfg));
   let g = 0; for (let i = 1; i < u.length; i++) if (u[i] > u[g] + 1e-9) g = i;      // ties: lowest rank
   const r1 = rng();                                                                 // ALWAYS drawn here, exactly once
   const mayExplore = r1 < cfg.statsEpsilon && p.self.hp >= cfg.exploreMinHp && entry.danger <= cfg.exploreMaxDanger && env.hostile12 <= cfg.statsMaxHostiles;
   if (!mayExplore) return { tactic: allowed[g], explored: false };
   const others = allowed.filter((_, i) => i !== g);
   const r2 = rng();                                                                 // drawn only when exploring
   return { tactic: others[Math.floor(r2 * others.length)], explored: true };
   ```
6. The caller stores `s.tactic = { name, targetId: target.id, mobKey, since: now }` when the name or target changed.

**Utility and priors** (`cfg.stats*`):
```ts
export function utilityOf(stat: TacticStat | undefined, rank: number, cfg: CombatConfig): number {
  if (!stat || stat.n < cfg.statsMinSamples) return Math.max(cfg.statsPriorFloor, cfg.statsPriorTop - cfg.statsPriorStep * rank);  // prior from rank order
  const winRate = stat.wins / stat.n;
  const normDamage = Math.min(1, (stat.damageTaken / stat.n) / cfg.statsNormDamage);
  const normTicks = Math.min(1, (stat.ticks / stat.n) / cfg.statsNormTicks);
  return winRate - cfg.statsLambda * normDamage - cfg.statsMu * normTicks;
}
```
Defaults: min samples 3, prior 0.60 - 0.10 x rank (floor 0.05), lambda 0.5, mu 0.2, norms 20 HP and 600 ticks. `rank` is the index in the **allowed** list, not in the MOBS list.

### 6.4 Engagement start and end rules (executed at step 13; `E` = `s.engagement`)

An engagement is one (target, tactic) fight. It is recorded only if it ends `win` or `loss` and `E.clean`.

**Start:** after the decision is built, if `chosen === "attack"`, `target` and `tactic` are defined and `E === undefined`: `E = { mobKey, targetId, tactic, startTick: now, startHp: self.hp, damageTaken: 0, lastHp: self.hp, lastSeenTick: now, lastDist: target.distance, lastHpFrac, hit: false, clean: hostile12 <= cfg.statsMaxHostiles }`.

**Per-pump refresh** (when `E` exists, before the end test): `t = p.entities.find(e => e.id === E.targetId)`. If `t`: `lastSeenTick = now`, `lastDist = t.distance`, `lastHpFrac = t.hp !== undefined && t.maxHp ? t.hp / t.maxHp : undefined`, and `hit ||= t.hurtByMeAtTick !== undefined && t.hurtByMeAtTick >= E.startTick`. `clean &&= hostile12 <= cfg.statsMaxHostiles` (counted with `threats` within `countRadius`). Option bookkeeping: `offSince` is set to `now` on the first pump whose chosen option is `resume_task` or `idle`, and cleared on any other option.

**End tests**, in this order, first match ends `E` (then, if `chosen === "attack"` and rules A6/A7 ended it, a new engagement starts in the same pump):

| # | Outcome | Condition | damage / ticks recorded |
|---|---|---|---|
| W | win | target absent: `now - E.lastSeenTick >= cfg.winAbsentTicks` (8) and `E.lastDist <= cfg.winMaxDistance` (8) and `E.hit` and (the entry's `special` has neither `teleports` nor `hides_in_blocks`, or `E.lastHpFrac !== undefined && E.lastHpFrac <= cfg.winHiderHpFrac` (0.25)) | `E.damageTaken`; `E.lastSeenTick - E.startTick` |
| L1 | loss | bot death: `onBotDeath` | `E.damageTaken + E.lastHp`; `now - E.startTick` |
| L2 | loss | `chosen` in `{retreat, flee, escape_rejoin}`, target still present (`now - E.lastSeenTick < 8`) and `E.damageTaken >= cfg.minLossDamage` (2) | `E.damageTaken`; `now - E.startTick` |
| A1 | abandon | same as L2 but `E.damageTaken < cfg.minLossDamage` | - |
| A2 | abandon | `E.offSince !== undefined && now - E.offSince >= cfg.abandonCalmTicks` (40) | - |
| A3 | abandon | target present but `classification !== "threat"` or `!attackAllowed` | - |
| A4 | abandon | target present, `!inLeash` and `distance > 3.5` | - |
| A5 | abandon | target absent and not W (far, or never hit, or a teleporter not low) | - |
| A6 | abandon | `chosen === "attack"` and `target.id !== E.targetId` | - |
| A7 | abandon | `chosen === "attack"` and `tactic !== E.tactic` | - |
| A8 | abandon | gap `> cfg.engageGapTicks` (40), or `now - E.startTick > cfg.engageMaxTicks` (1200) | - |

`eat`, `shield` and `back_off` options keep `E` open (they are part of the fight). Abandon increments `abandons` of the tactic's stat (diagnostics only, never part of `n`).

**Update rule** (`recordOutcome`): for `win`/`loss` and `clean`:
```ts
st' = clone(st); a = st'.mobs[mobKey] ??= {}; t = a[tactic] ??= { n:0, wins:0, losses:0, damageTaken:0, ticks:0, abandons:0 };
t.n += 1; if (o === "win") t.wins += 1; else t.losses += 1;
t.damageTaken += damage; t.ticks += ticks;
if (t.n > cfg.statsDecayN) { for (const k of ["n","wins","losses","damageTaken","ticks"] as const) t[k] *= cfg.statsDecayFactor; }   // 30, 0.5
```
`win`/`loss` but not clean: `st.skipped += 1`. `abandon`: `t.abandons += 1` (stat created if missing, clean or not). Damage and ticks are rounded to 1 decimal when stored.

### 6.5 JSON shape (`serializeStats`; S4a stores the string opaquely, per bot, inside the snapshot record)

```json
{"v":1,"s":2,"m":{"minecraft:zombie":{"melee_crit":[5,4,1,39,1652,2],"hit_and_back_off":[2,2,0,4.5,240,0]}}}
```
`v` = version (1), `s` = `skipped`, `m` = mobs; each tactic value is the tuple `[n, wins, losses, damageTaken, ticks, abandons]`. Numbers are finite. `parseStats` accepts it only if `v === 1`, every tuple has six finite numbers `>= 0`, tactic names are in `TACTIC_NAMES`; any violation drops that entry (a broken top level returns a fresh `OutcomeStats`). Size: at most 20 mobs x 15 tactics x about 40 bytes, below 12 KB.

---

## 7. Worked examples

Defaults from section 8 apply. `m` = scores after masking. Pump = 4 ticks.

**E1. Commitment holds (window, then margin).**
Commit `{attack, since 100, until 124}`.
- `now = 112`: `m = {attack 0.50, retreat 0.78, flee 0.30, ...}`. `best = retreat`. `112 < 124` and retreat is not escape/flee, so hold `attack` (`held_window`) although 0.78 is 56 % above 0.50.
- `now = 128`: `m = {attack 0.60, retreat 0.68}`. Window over. `threshold = 0.60 + |0.60| x 0.15 = 0.69`. `0.68 > 0.69` is false: hold (`held_margin`). With `retreat = 0.70`: `0.70 > 0.69`, switch.
- Negative scores: `attack -0.20`, `retreat -0.10`: `threshold = -0.20 + 0.20 x 0.15 = -0.17`; `-0.10 > -0.17`, switch.

**E2. Switch fires.**
`now = 140`, commit `{attack, since 100, until 124}`, `m = {attack 0.55, retreat 0.70, flee 0.40, eat 0.30}`. `best = retreat`. Window over. `threshold = 0.55 + 0.55 x 0.15 = 0.6325`; `0.70 > 0.6325`: switch. New commit `{retreat, since 140, until 140 + 60 = 200}`. `tactic = retreat_and_regen`, `moveTo = home.pos` (same dimension). Then at `now = 144`, `m = {retreat 0.52, attack 0.80}`: `144 < 200`, window holds `retreat`; only `flee`/`escape_rejoin` could bypass it.

**E3. Hard interrupts.**
(a) `now = 164`, `hp = 5`, a zombie at 3.0, commit `{attack, since 160, until 184}` (inside the window). Raw: attack 0.90, retreat 0.50, flee 0.45, eat 0.40 (a zombie at 3.0 makes `d.canEatSafely` false, so `chooseEat` returns `undefined` and eat is masked), shield 0.30, back_off 0.20, resume_task 0.10, escape_rejoin 0.35 but `escapeAvailable = false` so masked. H1: `5 <= 6` and threat within 16: commit cleared; critical mask hides attack and resume_task. `m = {retreat 0.50, flee 0.45, shield 0.30, back_off 0.20}`. Pick `retreat` (`interrupt:critical_hp`), new commit until 224.
(b) `now = 200`, `hp = 18`, commit `{attack, targetId "z1"}`; `z1` died and is absent. H2 fires; commit cleared; normal argmax picks `attack` (0.70) with `selectTarget` returning a new zombie `z2`.
(c) `now = 212`, commit `{eat, food bread (non-emergency), until 236}`, a zombie at 2.6 (`<= 3`). H3 fires: commit cleared, `eatBanUntil = 212 + 20 = 232`, eat is masked until tick 232.
(d) `now = 344`, `lastTick = 300` (a lava reflex ran): `gap = 44 > 20` so H4 (`reflex_gap`); `44 > 40` so the engagement ends A8 (abandon).

**E4. Target choice among 3 mobs.**
Bot: iron sword (6 damage). `attackSpacingTicks 12`, `ttkReach 2.5`, `sprintBlocksPerTick 0.28`. All three are attackable and in the leash.

| Mob | typeId | dist | relevance | hp | hits = ceil(hp/6) | approach = ceil((dist-2.5)/0.28) | ttk = 12 x hits + approach | Tier |
|---|---|---|---|---|---|---|---|---|
| Z | zombie | 2.9 | threatening_me | 20 | 4 | ceil(0.4/0.28) = ceil(1.43) = 2 | 48 + 2 = 50 | 1 |
| S | skeleton | 9.0 | threatening_me | 20 | 4 | ceil(6.5/0.28) = ceil(23.2) = 24 | 48 + 24 = 72 | 1 |
| C | creeper | 4.5 | blocking_objective | 20 | 4 | - | - | 2 (4.5 > 4) |

Order: tier 1 by ttk (Z 50, S 72), then tier 2 (C). Target = Z. Variants: creeper at 3.8 blocks becomes tier 0 and is picked first (and displaces a sticky Z, since tier 0 < tier 1). Skeleton with 5 hp: hits 1, ttk = 12 + 24 = 36 < 50, so S first. Creeper still at 4.5 while Z is the current target: Z stays.

**E5. Food choice per situation** (guards come from S2a `Derived`: `canEatSafely` needs the nearest threat more than `32 + 20 = 52` ticks from contact at the floor speed 0.25 blocks/tick; a zombie has reach 2, so that is more than 15.0 blocks).
- *topup:* hunger 14, sat 2, hp 20, no threat; 5 bread (slot 0), 2 cooked_beef (1), 1 golden_apple (2). Trigger: `14 <= 17`, `missing = 6 >= 2`. Tag `topup` has bread (tags topup, main); cooked_beef is `main` only; golden_apple is `emergency`. First tag with items: `topup`. `bread.hunger 5 <= 6`: eat bread, slot 0. Result hunger 19, sat `min(19, 2 + 6) = 8`. Variant: hunger 17, missing 3: bread 5 > 3, no fit; smallest in the tag = bread, overflow `5 - 3 = 2 <= 2`: eat bread. (An item with `hunger - missing > 2` is never eaten as topup.)
- *pre_engage_heal:* hunger 14, sat 2, hp 12/20, zombies targeting at 20 blocks. Tag `main` first: bread (gain `min(min(20, 19), 2 + 6) - 2 = 8 - 2 = 6`), cooked_beef (`min(min(20, 22), 2 + 12.8) - 2 = 14.8 - 2 = 12.8`). Pick cooked_beef. Guard `ctx.canEatSafely` = `d.canEatSafely`: `minEatContactTicks = (20 - 2) / 0.25 = 72 > 52`, true, passes. At 12 blocks: `(12 - 2) / 0.25 = 40 > 52` false, so `canEatSafely` is false and the situation returns `undefined`. Boundary: a zombie at exactly 15.0 gives `52 > 52` false (strict); at 15.1 gives `52.4 > 52`, true.
- *emergency:* hp 6, hunger 14, three zombies at 10: triggers (1) and (4). Emergency list: golden_apple (EGA not held). `d.canEatEmergency` true (no melee within 2): allowed. `eatMode = emergency`. With a zombie at 1.5 and hp 6: `d.canEatEmergency` false (melee within 2 and `6 > 4`): emergency returns `undefined`; situation 4 fails its guard too; eat is masked.
- *starving:* hunger 3, hp 14, 3 rotten_flesh, 1 spider_eye, 2 chicken, 1 pufferfish, no threats. Trigger (3): nothing in topup/main/raw. Steps 1-2 empty; AVOID_ORDER: rotten_flesh first. Later (hunger 7): still `<= 6`? No (7 > 6), the starving trigger ends and the bot stops eating junk. Pufferfish never (needs hp >= 12 and hunger <= 2 and everything above exhausted).
- *escape_teleport:* hp 4, zombie at 1, `escapeAvailable = false`, 1 chorus_fruit, 1 cooked_beef, no golden apple. Triggers: (1) `4 <= 6` and threat within 16, but the emergency list is empty so `undefined`; (2) holds; chorus_fruit guard `d.canEatEmergency`: melee within 2 but `hp 4 > 4` is false, so true, allowed. Result chorus_fruit, `emergency = true`.

**E6. Tactic choice with stats (rng shown).**
Zombie (adult, `ground_flat`, 1 zombie in 12 blocks, no shield). Entry order: melee_crit (`not_mob_is_baby AND ground_flat AND count_at_least: 1`: true), melee_strafe (`mob_is_baby`: false), shield_hold (`count_at_least: 3`: false, and gated), hit_and_back_off (`always`: true). `allowed = [melee_crit (rank 0), hit_and_back_off (rank 1)]`.
Stats: melee_crit `{n 4, wins 3, losses 1, damage 36, ticks 1600}`: winRate 0.75; avgDamage 9 so normDamage `9/20 = 0.45`; avgTicks 400 so normTicks `400/600 = 0.6667`; `U = 0.75 - 0.5 x 0.45 - 0.2 x 0.6667 = 0.75 - 0.225 - 0.1333 = 0.3917`. hit_and_back_off `n = 2 < 3`: prior rank 1 = `0.60 - 0.10 = 0.50`. Greedy `g = hit_and_back_off`.
- `rng() = 0.62`: `0.62 >= 0.10`, exploit: **hit_and_back_off**.
- `rng() = 0.04` then `0.77`: `0.04 < 0.10`, hp 20 >= 14, zombie danger 2 <= 6, hostile12 1 <= 2: explore. `others = [melee_crit]`, `floor(0.77 x 1) = 0`: **melee_crit** (`explored = true`).
- `rng() = 0.04` with hp 10 < 14: exploration suppressed, `r2` not drawn: **hit_and_back_off**.
Single-allowed case: skeleton at 9 blocks, bot has a 90 % shield, cover within 8, 1 skeleton: `break_line_of_sight` (`not_bot_has_shield AND ...`) false; `shield_advance_zigzag` (`bot_has_shield AND dist_at_least: 6`) true; `melee_strafe` (`dist_below: 4`) false; `shield_hold` (`count_at_least: 2`) false. `allowed.length === 1`: tactic chosen, **no rng call**.

**E7. Engagement lifecycle and update.**
Tick 200: option `attack`, zombie `z9` (20 hp), tactic melee_crit, bot hp 20. `E = {startTick 200, startHp 20, clean true}`. Tick 216: bot hp 17 so `damageTaken = 3`; `z9.hurtByMeAtTick = 212` so `hit = true`. Tick 252: last pump `z9` seen, `lastDist 2.2`. Tick 260: absent since 252, `260 - 252 = 8 >= 8`, `2.2 <= 8`, `hit`, zombie is not a teleporter: **win**, damage 3, ticks `252 - 200 = 52`. Stat before `{n 4, w 3, l 1, dmg 36, ticks 1600}` after `{n 5, w 4, l 1, dmg 39, ticks 1652}`; `n <= 30`, no decay. New utility: winRate 0.8; `39/5/20 = 0.39`; `1652/5/600 = 0.5507`; `U = 0.8 - 0.195 - 0.1101 = 0.4949`.
Loss: same fight but at tick 240 the chosen option becomes `retreat` with `damageTaken = 9 >= 2` and `z9` still seen: **loss**, damage 9, ticks 40. With `damageTaken = 1`: abandon (A1).
Decay: a stat reaching `n = 31 > 30` is multiplied by 0.5 (`n 15.5`).
Not clean: a fight where 3 skeletons were within 12 blocks (`3 > 2`) ends in a win: `skipped += 1`, no stat change.

**E8. Tie-break.** `m = {retreat 0.40, eat 0.40, attack 0.40}`, no commit: all equal within 1e-9; `TIE_ORDER` visits retreat before eat before attack, `v > bestV + eps` never replaces the first: **retreat**. With a commit on `attack` (window over) and `best = retreat` equal to `attack`: `0.40 > 0.46` false, `attack` stays.

---

## 8. Config keys (S2b)

Merged into `config.combat` (`CombatConfig`). Bias: survival first (large `criticalHp`, long retreat/flee commits, exploration only when safe).

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `switchMargin` | 0.15 | fraction | New option must beat the committed one by this fraction of its current score |
| `minCommitTicks` | `{attack:24, shield:20, back_off:16, retreat:60, eat:36, flee:80, escape_rejoin:4, resume_task:0, idle:0}` | ticks | Section 3.1 |
| `commitStaleTicks` | 20 | ticks | Brain gap that clears the commitment (reflex/handoff happened) |
| `criticalHp` | 6 | HP | H1 threshold and critical mask |
| `criticalThreatRange` | 16 | blocks | A threat this close makes `criticalHp` bite |
| `eatInterruptDist` | 3 | blocks | A threat this close interrupts a non-emergency meal (H3) |
| `eatRetryTicks` | 20 | ticks | `eat` ban after H3 |
| `creeperPriorityDist` | 4 | blocks | Creeper this close is target tier 0 |
| `scanRadius` | 24 | blocks | (S1) target candidates farther than this are dropped |
| `attackSpacingTicks` | 12 | ticks | Time per hit in `timeToKillTicks` (S3 1.2) |
| `ttkReach` | 2.5 | blocks | Distance at which the approach ends in `timeToKillTicks` |
| `sprintBlocksPerTick` | 0.28 | blocks/tick | 5.6 b/s (MOBS 1.1) |
| `fistDamage` | 1 | HP | Damage without a weapon |
| `shieldMinDurabilityFrac` | 0.10 | fraction | Below this the shield does not count as `bot_has_shield` |
| `countRadius` | 12 | blocks | Radius of `count_at_least` and `hostile_count_at_least` |
| `hissProxyDist` | 3 | blocks | `mob_hissing` proxy distance (mirror `config.body.hissProxyDist`) |
| `topupHungerMax` | 17 | hunger | Topup trigger (TABLES 3.4) |
| `topupMinMissing` | 2 | hunger | Topup trigger |
| `emergencyHp` | 6 | HP | Emergency food trigger (with a hostile in range) |
| `emergencyHpAnyThreat` | 4 | HP | Emergency trigger with any threat; also the melee-within-2 override |
| `emergencyHostileRange` | 16 | blocks | "Hostile within 16" |
| `starvingHunger` | 6 | hunger | Starving trigger |
| `poisonMinHp` | 8 | HP | Minimum HP to eat poison items |
| `eatGuardThreatSpeed` | 5 | blocks/s | Floor on a threat's speed in S2a's `eatContactTicks` (read by S2a, D23) |
| `eatMeleeBlockDist` | 2 | blocks | Emergency/escape eat refused with a melee threat this close (hp > 4); read by S2a `canEatEmergency` |
| `statsEpsilon` | 0.10 | probability | Exploration rate |
| `statsMinSamples` | 3 | count | Samples before measured stats replace the prior |
| `statsPriorTop` | 0.60 | utility | Prior of rank 0 |
| `statsPriorStep` | 0.10 | utility | Prior drop per rank |
| `statsPriorFloor` | 0.05 | utility | Lowest prior |
| `statsLambda` | 0.5 | weight | Damage weight in the utility |
| `statsMu` | 0.2 | weight | Time weight in the utility |
| `statsNormDamage` | 20 | HP | Damage normaliser |
| `statsNormTicks` | 600 | ticks | Duration normaliser |
| `statsDecayN` | 30 | count | `n` above this halves the accumulators |
| `statsDecayFactor` | 0.5 | factor | Decay multiplier |
| `statsMaxHostiles` | 2 | count | More threats than this within `countRadius` make an engagement not clean |
| `exploreMinHp` | 14 | HP | No exploration below this HP |
| `exploreMaxDanger` | 6 | 0-10 | No exploration against mobs with a higher MOBS danger |
| `tacticBanTicks` | 200 | ticks | A tactic that failed (S3 feedback) is banned this long |
| `tacticGraceTicks` | 20 | ticks | A running tactic whose `when` turned false is kept this long |
| `winAbsentTicks` | 8 | ticks | Target missing this long counts as dead |
| `winMaxDistance` | 8 | blocks | ... only if last seen this close |
| `winHiderHpFrac` | 0.25 | fraction | Teleporters/hiders count as dead only below this hp fraction |
| `minLossDamage` | 2 | HP | Flee after less damage than this is an abandon |
| `abandonCalmTicks` | 40 | ticks | Calm options this long end the engagement |
| `engageGapTicks` | 40 | ticks | Brain gap that abandons the engagement |
| `engageMaxTicks` | 1200 | ticks | Hard cap on one engagement |

Collision rule: if S1 or S2a already define a key with one of these names, the Reconciler keeps one definition and the one default above. D3: `criticalHp` and `switchMargin` are defined here only (S2a reads `criticalHp`). Removed by D23: `eatGuardMargin`, `preEngageContactMarginTicks` (nothing reads them; S2a owns `eatSafetyMarginTicks` 20 and `eatMidMealMarginTicks` 6). The type of this table is `CombatConfigS2b` (`CombatConfig = CombatConfigS1 & CombatConfigS2b & CombatConfigS2a`, S2a 9.1); the contract writer creates it.

---

## 9. Requests to other sections

| To | Request |
|---|---|
| S1 / contract writer | Add the optional Percept and EntityPercept fields of section 0 (`terrain`, `canBlock`, `shieldDisabled`, `objectiveItemIds`, `tacticFeedback`, `EntityPercept.inWater`). |
| S1 / B3 | Compute `TerrainFacts` from the world (S3 `scan.ts` helpers) at most every 20 ticks while in combat; fill `tacticFeedback` from the finished `TacticRunner` (`reason`) for one pump; fill `objectiveItemIds` from `ObjectiveHint.items.ids` (also while paused). |
| S1 | Bind `BrainFn` to `decide` as shown in section 1; `BrainState` has no provocation field. |
| S2a | Done by S2a (checked in the revision pass): `Knowledge` exports `mob`, `food`, `value` (D1); `FoodEntry` has `tags` and `effects`; `hasUsableShield`, `ALWAYS_EDIBLE`, `EMERGENCY_FOODS`, `ATTACK_NEAR_BLOCKS` are exported from `scoring.ts`; `Derived.canEatSafely` / `canEatEmergency` are the eat guards (D23). S2a does not define `FoodSituation`, `FoodChoice`, `Commit`, `Decision`. |
| S3 | `Decision.eatMode` and `foodSlot` map to `EatRequest.mode`/`slot`. `TacticRunner.reason` is the feedback reason; a runner that returns `failed` on its first step must still be reported once. |
| S4a | Store `serializeStats(state.stats)` as an opaque string per bot; call `parseStats` on restore. |
| S6 | Test cases in section 11. |

## 10. Open questions (fallbacks chosen)

| # | Question | Fallback |
|---|---|---|
| Q1 | S2a's `Knowledge` member names were unknown while S2a was written in parallel. | Resolved (D1): `kb.mob`, `kb.food`, `kb.value` as S2a 1.1 defines them; `mobOf`/`foodOf`/`valueOf` are one-line aliases. |
| Q2 | The brief lists "creeper within 4" after "threatening_me". | Creeper within 4 is tier 0 and pre-empts (section 4). |
| Q3 | Bedrock gives no signal that a target died. | Win = target gone for 8 ticks after being hit within 8 blocks; teleporters/hiders need a low last hp. Mis-attributions only skew stats, never behaviour. |
| Q4 | Stats from fights with many mobs are noisy. | Not recorded when more than 2 threats were within 12 blocks (`skipped`). |
| Q5 | `criticalHp` and `switchMargin` may also exist in S2a. | Resolved (D3): single definition here (section 8); S2a only reads `criticalHp`. |
| Q6 | Tactic runner failure is invisible to a pure brain. | `Percept.tacticFeedback` plus a 200-tick ban; without it (`undefined`) a failing tactic is retried each reselection. |
| Q7 | `ground_flat` and the other terrain atoms are not in S1's Percept. | `Percept.terrain?`; missing means `groundFlat` true and cover/ceiling/roof false. |
| Q8 | Stats are per bot, so each bot learns alone. | Accepted for Phase 3; Phase 8 merges logs offline. |
| Q9 | `hunger` unreadable (`hungerKnown = false`). | Treated as 20: only always-edible foods are eaten. |
| Q10 | `Derived.canEatSafely` is computed for S2a's reference meal (`eatTicksRef`: the heal, starve or topup pick, default 32 ticks), not for the food S2b finally picks. | Accepted (D23 forbids a second threshold). The error is at most 8 ticks (honey_bottle 40 vs 32) and in the safe direction for dried_kelp (16). |
| Q11 | A committed meal bypasses the guard in `chooseEat`. | Intended (D22): S2a scores `eat` with the mid-meal margin when `Percept.eating` is set; H3 stays the hard interrupt. Without `Percept.eating`, S2a falls back to the full margin and its `eat` score drops to 0, so the brain leaves `eat` after the commit window. |

## 11. Test cases for S6 / TC-B1

- `argmaxOption`: tie order (E8), all `-Infinity` gives the fallback, NaN skipped.
- `holdOrSwitch`: E1/E2 numbers, negative scores, calm options exempt, escape/flee bypass the window, infeasible committed option.
- `decide`: H1 to H4 (E3), critical mask, masks table row by row, `reason` codes, no mutation of the input state, `eat` ban after H3, sticky food, `minCommitTicks` eat uses `eatTicks + 4` (dried_kelp: `max(36, 20) = 36`).
- `selectTarget`: E4 incl. variants and stickiness, leash exclusion (17 blocks, blocking), tie by id.
- `chooseFood`: E5 plus topup with `hunger 20` (nothing except always-edible), objective item excluded, guard injected through `FoodContext.canEatSafely` / `canEatEmergency` (false gives `undefined` for normal, pre_engage_heal and starving; `canEatEmergency` false gives `undefined` for emergency and escape_teleport), an end-to-end boundary through `computeDerived` (zombie at 15.0 fails, 15.1 passes), committed meal returned by `chooseEat` without the guard, `golden_carrot` never topup, honey bottle at hunger 20.
- `evalCondition`: every atom row; `OR`/`AND` precedence (S3 2.2 round-trip strings); slime sizes by hp and by box.
- `selectTactic`: E6 with scripted `rng`, `rng` call counts (0, 1 or 2), bans, grace period, fallback tactic.
- Engagement: E7 win/loss/abandon rules A1-A8, clean flag, decay at `n > 30`, `onBotDeath` loss `damageTaken + lastHp`.
- `serializeStats`/`parseStats`: round-trip, rejects `v: 2`, drops an entry with a negative number or an unknown tactic.

---

## Revision log (review pass 1)

No review file exists for S2b (`docs/phase3/reviews/S2b-*.md`); this pass applies DECISIONS rows D1, D3, D22, D23 and aligns the S2a names with the revised S2a.

- D1: applied (section 0: `kb.mob`, `kb.food`, `kb.value` are exactly S2a 1.1's `Knowledge` members; `value(typeId, maxAmount?)` is called with one argument; Q1 resolved; the "Reconciler maps" wording removed; `FoodEntry`/`FoodTag`/`FoodEffect` read from S2a, `effects` added to the fields read; section 9 S2a row rewritten as done)
- D3: applied (header and section 8 collision rule: `criticalHp` and `switchMargin` have one definition here, S2a reads `criticalHp`; Q5 resolved)
- D22 shield: applied (local `botHasShield` removed; `hasUsableShield` imported from `scoring.ts`; the shield mask uses it; `CondEnv.botHasShield` is passed in)
- D22 committed meal: applied (`chooseEat` returns the sticky `s.commit.food` while `stillHeld`, before any guard; step 11 simplified; Q11)
- D22 stats.ts: applied (`evalCondition` and `CondEnv` exported from `stats.ts`; new `makeCondEnv`; `selectTactic` gains the parameter `botHasShield: boolean` because `stats.ts` cannot import `scoring.ts`; header import rule; `hostile12` defined as S2a 3.1)
- D23: applied (`FoodContext` gains `canEatSafely` and `canEatEmergency`; `chooseEat(p, s, d, kb, cfg)` fills them from `Derived`; section 5.2 guards replaced; keys `eatGuardMargin` and `preEngageContactMarginTicks` removed from section 8, `eatGuardThreatSpeed` and `eatMeleeBlockDist` kept because S2a reads them; E5 and E3(a) arithmetic redone with the 52-tick rule; section 11 chooseFood test updated; the RECOVER `chooseFood` dep passes both guards as true; Q10 records that `canEatSafely` uses S2a's reference meal length)
- S2a name alignment: `computeDerived(p, kb, cfg)` and `scoreOptions(p, d, kb, cfg)` match S2a 1.3; `Derived.canEatSafely` / `canEatEmergency` are the only two fields read (section 0 says so); `ALWAYS_EDIBLE`, `EMERGENCY_FOODS`, `ATTACK_NEAR_BLOCKS` imported instead of redefined; `FoodContext.threats` filtered by `cfg.scanRadius` to equal S2a's `Derived.threats` set
- Requested of others: the S1 and contract-writer revisers use `CombatConfigS2b` as the interface name of section 8 and take `makeCondEnv` / the new `selectTactic` parameter into the brain wiring; any other document that mentions `eatGuardMargin` or `preEngageContactMarginTicks` must drop them
