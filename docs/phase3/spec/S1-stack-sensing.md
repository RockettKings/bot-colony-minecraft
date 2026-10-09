# S1: priority stack, BotController, executor pause/resume, sensing, classification, relevance, reflexes

Owner of: `Percept` (including the optional fields of D2 and D22), `SelfPercept`, `EntityPercept`, `Classification`, `Relevance`, `ObjectiveContext`, `LayerKind`, `BotStatusView`, `ControllerCarry`, `ControllerInit` (PHASE3-SPEC §4), the `TaskExecutor` pause/resume change (§4 "Executor contract change"), the Decision-to-runner combat executor (§3.7, D13) and `buildPercept` (§2.4a, D12).
Builders: **B1** (pure parts in `src/core/combat/sense.ts`), **B3** (`controller.ts`, `sensor.ts`, `percept.ts`, `combat-executor.ts`, `defend-executor.ts`, pause/resume in `gather-executor.ts` / `goto-executor.ts`, `runtime.ts`, `registry.ts`, and the new adapter file `src/game/adapter/sense.ts`, see §12).
Contract writer: every type and interface in code blocks below goes into the file named above the block.

Conventions used everywhere in this file:
- Distances are blocks, times are ticks (20 per second). `dist3(a, b)` = 3D Euclidean distance. "Pump" = one runtime interval (4 ticks).
- "Window" = `now - tick <= config.combat.provokeMemoryTicks`.
- Every `config.*` name is listed with its default in §10.
- Method names of the body are those of S3 §1 `BodyActions` / `BodyReads` (`CombatBody`). S1 never defines a body method.
- Block ids: `LAVA_IDS = ["minecraft:lava", "minecraft:flowing_lava"]`, `WATER_IDS = ["minecraft:water", "minecraft:flowing_water"]`, `FIRE_IDS = ["minecraft:fire", "minecraft:soul_fire"]`, `SCULK_NOISE_IDS = ["minecraft:sculk_sensor", "minecraft:calibrated_sculk_sensor", "minecraft:sculk_shrieker"]` (constants in `src/core/combat/sense.ts`).

---

## 1. Types (`src/core/combat/types.ts`, pure)

```ts
import type { BotId, PlayerId, TaskKind, Tick, Vec3 } from "../types.js";
import type { HomeRef } from "../colony/types.js"; // S5 §2: { dimensionId; pos } (pos = integer block corner)

// Declared elsewhere in this same file by their owners (not by S1): S2b: BrainState, Decision, OptionKind, FoodChoice,
// TerrainFacts, TacticFeedback; S2a: Knowledge; S3: MobEntry, TacticName.
// TerrainFacts (D2) has exactly { groundFlat; lowCeilingWithin8; coverWithin8; roofWithin10 }: boolean each.

export type LayerKind = "reflex" | "combat" | "task" | "idle";
export type Classification = "ignore" | "never_target" | "neutral_unprovoked" | "threat";
export type Relevance = "threatening_me" | "blocking_objective" | "irrelevant";
export type ReflexKind = "lava" | "drowning" | "warden" | "fire";
/** Sub-state of the combat layer (see §3). */
export type CombatPhase = "fight" | "calm" | "recover" | "handoff";

/** Plain-data item (structurally identical to the game's ItemStackView plus enchantment info). */
export interface ItemView {
  typeId: string;
  amount: number;
  maxAmount: number;
  /** Items with minecraft:durability only. */
  durability?: { damage: number; max: number };
  /** Sum of enchantment levels (minecraft:enchantable). 0 / absent = none. Kept for S2a's value formulas. */
  enchantLevelSum?: number;
  /** Per-enchantment levels; ids WITHOUT the "minecraft:" prefix (e.g. "sharpness"). S4a stores prefixed ids; its codec strips the prefix on read. S3 reads Sharpness, Protection, Unbreaking from here. */
  enchants?: ReadonlyArray<{ id: string; level: number }>;
  mending?: boolean;
}
export interface SlotItem extends ItemView {
  /** Inventory container index 0..35 (0..8 hotbar). */
  slot: number;
  /** (max - damage) / max, clamped 0..1. 1 for items without durability. */
  durabilityFrac: number;
}
export type ArmourSlot = "head" | "chest" | "legs" | "feet";
export interface EquippedItem {
  typeId: string;
  durabilityFrac: number;
  enchantLevelSum?: number;
  mending?: boolean;
}
export interface EquipmentView {
  head?: EquippedItem;
  chest?: EquippedItem;
  legs?: EquippedItem;
  feet?: EquippedItem;
  offhand?: EquippedItem;
  /** Derived from inventory[selectedSlot]; NEVER read through EquipmentSlot.Mainhand (API-MAP D3). */
  mainhand?: EquippedItem;
  selectedSlot: number;
  /** EntityEquippableComponent.totalArmor (API-MAP D3); 0 if unreadable. */
  totalArmor: number;
}
export interface InventorySummary {
  /** Every non-empty slot, ascending slot. */
  slots: SlotItem[];
  freeSlots: number;
  /** Slots whose typeId has a FOOD table row (`foodEntry(typeId) !== undefined`, src/core/combat/food.ts), ascending slot. */
  foods: SlotItem[];
  /** Slots holding a WEAPON_DAMAGE item (§6.5), ascending slot. */
  weapons: SlotItem[];
  /** Best weapon by §6.5 ranking; undefined = none. May equal equipment.selectedSlot. */
  bestWeaponSlot?: number;
  /** Inventory slot of the best `minecraft:shield` not equipped (highest durabilityFrac, then lowest slot). */
  shieldSlot?: number;
  /** Armour pieces lying in the inventory (not worn), ascending slot. */
  armour: Array<SlotItem & { armourSlot: ArmourSlot }>;
  /** Slot of a `minecraft:carved_pumpkin`, lowest slot. */
  pumpkinSlot?: number;
}
export interface EffectView {
  typeId: string; // e.g. "minecraft:poison"
  amplifier: number; // 0 = level I
  /** Remaining ticks. Reported value if config.combat.effectDurationCountsDown (default); else computed by the sensor (§5.2 step 2). */
  duration: number;
}
/** TABLES §4.4–4.5 outputs. Computed by values.ts (formulas owned by S2). */
export interface ValueSummary {
  gearValue: number;
  objectiveValue: number;
  otherCargoValue: number;
  otherCargoRaw: number;
  cargoValue: number;
  deathCost: number;
}
export interface DamageRecord {
  tick: Tick;
  cause: string; // EntityDamageCause value, e.g. "lava", "drowning", "entityAttack"
  amount: number;
  attackerId?: string;
}

export interface SelfPercept {
  id: BotId;
  name: string;
  dimensionId: string;
  pos: Vec3; // feet
  headPos: Vec3;
  velocity: Vec3;
  hp: number;
  maxHp: number; // 20 if unreadable
  /** 0..20. If the component is unreadable: 20 and hungerKnown = false. */
  hunger: number;
  /** If unreadable: 5 and hungerKnown = false. */
  saturation: number;
  hungerKnown: boolean;
  effects: EffectView[];
  inWater: boolean; // Entity.isInWater
  /** Block at floor(headPos) is in WATER_IDS. */
  headInWater: boolean;
  /** Block at floor(pos) or floor(headPos) is in LAVA_IDS. */
  inLava: boolean;
  /** Block at floor(pos) is in FIRE_IDS. */
  inFireBlock: boolean;
  onFire: boolean; // minecraft:onfire component present with onFireTicksRemaining > 0
  onFireTicks: number;
  onGround: boolean;
  isFalling: boolean;
  isClimbing: boolean;
  isSneaking: boolean;
  isSprinting: boolean;
  /** airSupply / (totalSupply * 20), clamped 0..1. undefined = unreadable (beta member). */
  airFrac?: number;
  inventory: InventorySummary;
  equipment: EquipmentView;
  values: ValueSummary;
  /** Most recent damage this bot took (any cause), from the hurt log. */
  lastDamage?: DamageRecord;
}

export interface EntityPercept {
  id: string;
  typeId: string;
  pos: Vec3; // feet, as of the last scan
  headPos: Vec3;
  velocity: Vec3;
  /** dist3(self.pos, pos), recomputed every pump from the current self.pos. */
  distance: number;
  hp?: number;
  maxHp?: number;
  families: string[];
  isBaby: boolean;
  isTamed: boolean;
  /** hasComponent("minecraft:is_ignited") (API-MAP A6, unverified meaning). */
  isIgnited: boolean;
  isCharged: boolean;
  /** Id of the entity it rides (jockeys, API-MAP A4). */
  ridingId?: string;
  /** Collision box (API-MAP A4 getAABB); S3 uses it for reach. */
  aabb?: { center: Vec3; extent: Vec3 };
  /** Entity.target?.id (beta, API-MAP A5). undefined = no target or unreadable. */
  targetId?: string;
  /** §5.4. */
  targetingMe: boolean;
  /** Last tick (in window) this entity damaged this bot. */
  hurtMeAtTick?: Tick;
  /** Last tick (in window) this bot damaged this entity. */
  hurtByMeAtTick?: Tick;
  /** §5.5. */
  provoked: boolean;
  /** Defend only: targets or (in window) hurt a protected player. false otherwise. */
  threatensProtected: boolean;
  /** The entity itself moved toward the bot's current position by >= config.combat.approachMinDelta since the previous scan (<= 20 ticks ago). The bot's own movement does not count (§5.3). */
  approaching: boolean;
  /** true = clear ray, or not ray-checked (losChecked = false). */
  lineOfSight: boolean;
  losChecked: boolean;
  /** Total light at its feet; spiders only. */
  lightLevel?: number;
  classification: Classification;
  relevance: Relevance;
  /** §6.4. The brain and S3 must never attack an entity with attackAllowed = false. */
  attackAllowed: boolean;
  /** §7.4. */
  inLeash: boolean;
  /** Entity.isInWater (D2; S2b condition mob_in_water). Optional: absent = false. */
  inWater?: boolean;
}

export interface WardenPercept {
  id: string;
  pos: Vec3;
  distance: number;
  targetingMe: boolean;
}

export interface OwnerPercept {
  id: PlayerId;
  name: string;
  online: boolean;
  /** Only when online and in the bot's dimension. */
  pos?: Vec3;
}
export interface EnvPercept {
  timeOfDay: number; // 0..23999
  /** `timeOfDay < 12000 || timeOfDay >= 23000`. An approximation: sun-burn and spider neutrality really depend on sky light; `skyLightAtBot` is authoritative for burning. */
  isDaylight: boolean;
  /** Dimension.getSkyLightLevel(self.headPos); 0 if unreadable. */
  skyLightAtBot: number;
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  /** Dimension.getWeather() === Thunder (beta; false if unreadable). */
  thunderstorm: boolean;
}

export interface Segment {
  a: Vec3;
  b: Vec3;
}

/** What an executor exposes so the controller can build the ObjectiveContext (§7). Positions are absolute. */
export type ObjectiveHint =
  | {
      kind: "gather";
      /** Center of the candidate block (phases approach/break/collect). */
      target?: Vec3;
      /** Center of the chest block. */
      chest: Vec3;
      /** Where the bot is walking now: candidate block center (approach/break/collect) or chest center (toChest/atChest). */
      heading?: Vec3;
      /** Items that count toward the task and how many are still needed (for ValueSummary). */
      items: { ids: readonly string[]; required: number };
    }
  | { kind: "goto"; target: Vec3 }
  | { kind: "defend"; center: Vec3; radius: number };

export type ObjectiveContext =
  | { kind: "gather"; anchor: Vec3; target?: Vec3; chest: Vec3; corridor?: Segment }
  | { kind: "goto"; anchor: Vec3; target: Vec3; corridor: Segment }
  | {
      kind: "defend";
      anchor: Vec3;
      center: Vec3;
      radius: number;
      /** Players (real and bots, excluding this bot) with dist3(pos, center) <= radius at the last scan. */
      protectedIds: string[];
      protectedPositions: Vec3[];
    }
  | { kind: "idle"; anchor: Vec3 };

export interface Percept {
  now: Tick;
  self: SelfPercept;
  /** Sorted by distance ascending. Includes players and passives (S3 needs friendlies for line-of-attack). */
  entities: EntityPercept[];
  objective: ObjectiveContext;
  /** HomeRef.pos is an integer block corner; consumers walking to it add 0.5 to x and z. */
  home?: HomeRef;
  owner?: OwnerPercept;
  env: EnvPercept;
  /** Nearest warden within config.combat.wardenSafeRadius, if any. */
  warden?: WardenPercept;
  /** Controller layer when the percept was built. */
  layer: LayerKind;
  taskKind?: TaskKind;
  /** The controller is in combat phase "recover" (§3). */
  recovering: boolean;
  /** `!escapePending && now >= escapeBlockedUntil` (§3.6). The brain must not pick escape_rejoin when false. */
  escapeAvailable: boolean;

  // ---- Optional additions requested by S2a / S2b (D2, D22). Each has a fallback when absent; §2.4a fills them.
  /** §5.6. Absent => S2b assumes groundFlat true and the other three false. */
  terrain?: TerrainFacts;
  /** CombatBody.canBlock() (S3). Absent => S2b assumes an offhand shield means true. */
  canBlock?: boolean;
  /** §5.3 step 10 (probe P14). Absent => false. */
  shieldDisabled?: boolean;
  /** ObjectiveHint.items.ids of the active or paused gather task (also while paused); from the carry right after an escape rejoin. Absent => []. */
  objectiveItemIds?: readonly string[];
  /** Outcome of the tactic runner that finished within the last pump (one pump only). Absent => none. */
  tacticFeedback?: TacticFeedback;
  /** The meal in progress (D22). Absent => S2a applies the full eat guard every pump. */
  eating?: { typeId: string; remainingTicks: number };
}

/** Block facts for pure cell tests (same shape as the game's BlockInfo). */
export interface BlockFacts {
  typeId: string;
  isAir: boolean;
  isSolid: boolean;
  isLiquid: boolean;
}
export type CellProbe = (pos: Vec3) => BlockFacts | undefined;

/** Pushed to the core as `botStatus` (S5 §5 shape wins, D25). S5 reads exactly layer, option, target.typeId, hp, maxHp, hunger, recovering, gear. */
export interface BotStatusView {
  layer: LayerKind;
  /** Last decision's option while layer === "combat"; "idle" otherwise. */
  option: OptionKind;
  /** Target of the last decision (combat layer only). */
  target?: { typeId: string; distance?: number };
  hp: number;
  maxHp: number;
  hunger: number; // 0..20
  /** combat phase "recover" (post-escape). */
  recovering: boolean;
  gear: { weaponTypeId?: string; armorPieces: number /* 0..4 */; hasShield: boolean; foodCount: number };
  // Extras for debugging and tests (S5 ignores them):
  combatPhase?: CombatPhase; // layer === "combat" only
  reflex?: ReflexKind; // layer === "reflex" only
  taskId?: string;
  taskPaused: boolean;
  /** Relevant threats (relevance !== "irrelevant") at the last scan. */
  threatCount: number;
}

/**
 * Carried across an escape-rejoin (§3.6; D26, S4b H2). No task and no progress travel here: the core owns the
 * task and re-emits `assign` on `botRejoined`.
 */
export interface ControllerCarry {
  brainState: BrainState;
  /** true: the new controller starts in combat phase "recover". */
  recover: boolean;
  /** ObjectiveHint.items.ids of the paused gather task (for Percept.objectiveItemIds until the re-assign arrives). */
  objectiveItemIds?: string[];
  /** Serialized OutcomeStats (S2b serializeStats). Optional. */
  stats?: string;
}
export interface ControllerInit {
  carry?: ControllerCarry;
  /** Serialized OutcomeStats from the snapshot (reload / summon path). Takes precedence over carry.stats. */
  stats?: string;
}
```

---

## 2. BotController (`src/game/bots/controller.ts`, B3)

One controller per live bot. It replaces `BotEntry.executor` / `lastProgress` in `runtime.ts` (§11) and owns the bot's `TaskExecutor`, the sensor, the reflex memory, the brain state and the combat executor (§3.7).

### 2.1 Dependencies

Method names of the body are those of S3 §1 `BodyActions` / `BodyReads`; S1 defines no body method. `CombatBody = WorkerBody & BodyActions & BodyReads` (D11) comes from `./ports.js`. Members this file uses directly: reflexes and controller: `stopMoving`, `stopBreaking`, `stopEating`, `lowerShield`, `setSneaking`, `setSprinting`, `moveToward(pos, speed, face?)`, `navigateToward(pos, speed)`, `jump`, `canBlock`, `shieldState`; the combat executor (§3.7) uses the rest.

```ts
import type { BotId, Task, TaskFailReason, TaskId, TaskKind, TaskProgress, Tick, Vec3 } from "../../core/types.js";
import type {
  BotStatusView, ControllerCarry, ControllerInit, LayerKind, ObjectiveContext, Percept, SelfPercept,
} from "../../core/combat/types.js";
import type { BrainState, Decision, FoodChoice, Knowledge, TacticFeedback } from "../../core/combat/types.js"; // S2a / S2b
import type { CombatConfig, Phase3Config } from "../../core/config.js";
import type { ProvocationMemory } from "../../core/combat/sense.js";
import type { HomeRef } from "../../core/colony/types.js"; // S5 §2
import type { TaskExecutor } from "./executor.js";
import type { CombatBody, SensePort, WorldPort } from "./ports.js";
import type { EquipmentManager } from "./body/equipment.js"; // S3 §5.3
import type { NoGoZone } from "./body/types.js"; // S3 §3.1

/** S3's tactic runners behind one facade; implemented by CombatExecutorImpl (§3.7). */
export interface CombatExecutor {
  /** Execute one pump of `decision`. Idempotent for a repeated identical decision (e.g. an eat in progress continues). */
  run(decision: Decision, percept: Percept, now: Tick): void;
  /** Stop all combat body activity: runner.stop(), eat.stop(), stop moving, lower shield, sneak off, sprint off, stop eating. */
  halt(): void;
  /** Forget internal state without touching the body (after death). */
  reset(): void;
  /** An eat started by run() has not completed or been abandoned yet. */
  busyEating(): boolean;
  /** The eat in progress, for Percept.eating. */
  eatingInfo(now: Tick): { typeId: string; remainingTicks: number } | undefined;
  /** Feedback of the runner that finished within the last pump (one pump only; repeated calls return the same object). */
  lastFeedback(now: Tick): TacticFeedback | undefined;
  /** Unexpired zones published by avoid_path_around. */
  activeNoGo(now: Tick): readonly NoGoZone[];
}

export type BrainFn = (p: Percept, s: BrainState, kb: Knowledge, cfg: CombatConfig, rng: Rng) => { decision: Decision; state: BrainState }; // = S2b decide (D30)

/** S4's snapshot service, as the controller uses it. */
export interface SnapshotHandle {
  /**
   * Start the escape flow for this bot (S4 owns everything after this call). `carry` is read by S4 right
   * before the disconnect. Returns false if S4 refuses (e.g. a flow is already running for this bot).
   */
  requestEscape(botId: BotId, now: Tick, carry: () => ControllerCarry): boolean;
  /** The bot can no longer escape (died, disposed) or the hand-off timed out. Idempotent. */
  abortEscape(botId: BotId, reason: "bot_died" | "disposed" | "timeout"): void;
}

/** Read-only colony facts, computed by the runtime once per pump. */
export interface ColonyLookup {
  home(): HomeRef | undefined;
  owner(botId: BotId): import("../../core/combat/types.js").OwnerPercept | undefined;
  /** Ids of every registered colony bot (including this one). */
  botIds(): ReadonlySet<string>;
}

/** How the controller talks back to the runtime. Same semantics as Phase 2's emitProgress / taskReport. */
export interface ControllerSink {
  progress(botId: BotId, taskId: TaskId, p: TaskProgress, now: Tick): void;
  done(botId: BotId, taskId: TaskId, now: Tick): void;
  failed(botId: BotId, taskId: TaskId, reason: TaskFailReason, now: Tick): void;
}

export interface ControllerDeps {
  botId: BotId;
  name: string;
  body: CombatBody;
  sense: SensePort; // §5.1
  world: () => WorldPort | undefined;
  brain: BrainFn; // S2b decide(); the controller passes the runtime's seeded Rng (deps.rng) as the 5th argument (D30)
  kb: Knowledge; // S2a
  newBrainState: () => BrainState; // S2b
  /** S2b onBotDeath(s, now, cfg) with cfg and kb closed over by the runtime: record the loss for outcome stats and clear commitment. */
  onBotDeath: (s: BrainState, now: Tick) => BrainState;
  /** S2b chooseFood bound with an empty FoodContext (no threats, escapeAvailable true): used for RECOVER and the signals of §3.7. */
  chooseFood: (situation: "pre_engage_heal" | "topup", self: SelfPercept) => FoodChoice | undefined;
  combat: CombatExecutor;
  /** S3 equipment manager of this bot. */
  equipment: Pick<EquipmentManager, "tick" | "markDirty" | "suspend" | "resume" | "report" | "ensureWeaponSelected">;
  /** createExecutor(EXECUTORS, task, contextFor(body)) bound by the runtime. */
  createExecutor: (task: Task) => TaskExecutor;
  snapshot: SnapshotHandle;
  provocation: ProvocationMemory; // shared by all controllers (§5.5)
  lookup: ColonyLookup;
  sink: ControllerSink;
  cfg: Phase3Config;
  /** Test counters (§11.1); undefined outside tests. */
  debug?: CombatDebug;
}
```

### 2.2 Class signature

```ts
export class BotController {
  readonly botId: BotId;
  constructor(deps: ControllerDeps, init: ControllerInit | undefined, now: Tick);

  /** Once per pump for a live (valid, not dead) bot. §2.4. */
  tick(now: Tick): void;

  /** Colony `assign` effect. §2.5. */
  assign(task: Task, now: Tick): void;
  /** Colony `cancel` effect. No report follows. §2.5. */
  cancel(taskId: TaskId, now: Tick): void;

  /** Runtime entityDie for this bot. Returns the id of the task that must be reported failed("bot_died"). */
  onDeath(now: Tick): TaskId | undefined;
  /** S4: the escape flow failed before the disconnect; the bot is still here. T17. */
  onEscapeFailed(now: Tick): void;
  /** S4 reads this (through the callback given to requestEscape) right before the disconnect. §3.6. */
  exportCarry(): ControllerCarry;
  /** S4 brackets every leave / restore flow of this bot: true suspends its EquipmentManager, false resumes it (S3 CR-5). */
  setFlowActive(on: boolean): void;

  /** Stop everything and never act again. §2.3. */
  dispose(reason: "removed" | "dismissed" | "escaped"): void;

  status(): BotStatusView;
  currentTaskId(): TaskId | undefined;
  layer(): LayerKind;
  /** Last tick the layer was not "idle" or a task was assigned (S4b BotDirectory.lastActiveTick). */
  lastActiveTick(): Tick;
}
```

Private state (exact names, B3). All initial values are concrete; the "Reset on death" column is applied by `onDeath` (§2.5):

| Field | Type | Initial | Reset on death |
|---|---|---|---|
| `layerKind` | `LayerKind` | `"idle"`; `"combat"` when `init.carry` is set | `"idle"` |
| `phase` | `CombatPhase \| undefined` | `"recover"` when `init.carry` is set, else `undefined` | `undefined` |
| `calmSince` | `Tick \| undefined` | `undefined` | `undefined` |
| `calmEnterAt` | `Tick \| undefined` | `undefined` | `undefined` |
| `episodeHadThreat` | `boolean` | `false` | `false` |
| `needsRecover` | `boolean` | `init.carry?.recover === true` | `false` |
| `recoverSince` | `Tick \| undefined` | `now` when `init.carry` is set, else `undefined` | `undefined` |
| `escapePending` | `boolean` | `false` | `false` |
| `escapeBlockedUntil` | `Tick` | `0` | `0` |
| `handoffAt` | `Tick` | `0` | `0` |
| `executor` | `TaskExecutor \| undefined` | `undefined` (never built from a carry, D26) | `undefined` |
| `lastProgress` | `TaskProgress \| undefined` | `undefined` | `undefined` |
| `frozenObjective` | `ObjectiveContext \| undefined` | `undefined` | `undefined` |
| `lastObjective` | `ObjectiveContext \| undefined` | `undefined` | `undefined` |
| `nextScanAt` | `Tick` | `0` | `0` |
| `reflexMem` | `ReflexMemory` (§9.1) | `{}` | `{}` |
| `reflexKindActive` | `ReflexKind \| undefined` | `undefined` | `undefined` |
| `reflexTimers` | `{ lavaSearch?: Tick; shoreSearch?: Tick; fireSearch?: Tick; wardenPick?: Tick }` | `{}` | `{}` |
| `reflexDest` | `Vec3 \| undefined` | `undefined` | `undefined` |
| `waterNearby` | `boolean` | `false` | `false` |
| `fireWaterCell` | `Vec3 \| undefined` | `undefined` | `undefined` |
| `brainState` | `BrainState` | §3.6 constructor rule 1, else `newBrainState()` | `onBotDeath(brainState, now)` |
| `lastDecision` | `Decision \| undefined` | `undefined` | `undefined` |
| `lastEatDecision` | `Decision \| undefined` | `undefined` | `undefined` |
| `carriedItemIds` | `readonly string[]` | `init.carry?.objectiveItemIds ?? []` | `[]` |
| `sensor` | `Sensor` (§5.2) | new | `sensor.reset()` |
| `breadcrumbs` | `Vec3[]` (ring, newest last) | `[]` | `[]` |
| `lastBreadcrumbTick` | `Tick` | `-1000000` | `-1000000` |
| `lastActiveAt` | `Tick` | `now` | unchanged |
| `flowActive` | `boolean` | `false` | unchanged |
| `lastSelf` | `SelfPercept \| undefined` | `undefined` | `undefined` |
| `disposed` | `boolean` | `false` | unchanged |

### 2.3 Lifecycle

| Event | Who calls | Controller action |
|---|---|---|
| `botRegistered` (spawn, adopt) | runtime `register()` | `new BotController(deps, undefined, now)`; layer `idle`. |
| Rejoin after `!summon` / `!dismiss` / Save & Quit restore | runtime, when S4's flow registers the bot again | `new BotController(deps, init, now)` with `init = { stats }` if the snapshot has stats, else `undefined`; layer `idle`. |
| Rejoin after an escape | runtime, when S4 reports the escaped bot respawned | `new BotController(deps, { carry, stats }, now)` (§3.6): layer `combat`, phase `recover`, no executor. |
| `botRemoved` (invalid, couldn't respawn) | runtime `removeBot()` | `dispose("removed")` then drop. |
| `!dismiss` / idle self-dismiss | S4 service, after the snapshot is written | `dispose("dismissed")` then drop. |
| Escape completed (bot disconnected) | S4 service | `dispose("escaped")` then drop. |
| `dismissBot` requested while `escapePending` | S4 / core | `dispose("dismissed")` runs `abortEscape(botId, "disposed")` (step 4). Whether the core refuses such a dismiss is S5's decision (S5 Q11); S1 is safe either way. |

`dispose(reason)`:
1. If `disposed`: return. Set `disposed = true`.
2. If `executor`: `executor.cancel()` (no report), `executor = undefined`.
3. `combat.halt()`; `body.setSneaking(false)`; if `reason === "dismissed"`: `debug.dismisses++`.
4. If `escapePending` and `reason !== "escaped"`: `snapshot.abortEscape(botId, "disposed")`.

The core requeues the task on `botRemoved` (Phase 2 behaviour, unchanged). For `"escaped"`, the task stays in the core record (§3.6); identity mapping between the old and new entity is S4's.

`setFlowActive(on)`: `flowActive = on`; `on ? equipment.suspend() : equipment.resume()`. `lastActiveTick()` returns `lastActiveAt` (set to `now` at every pump where `layerKind !== "idle"` and in `assign`).

### 2.4 `tick(now)` algorithm

Every step is inside one `try`; on a throw: `logError`, `combat.halt()`, and return (the runtime's per-bot isolation stays).

1. If `disposed`: return.
2. `hint = executor?.objectiveHint()`.
3. `self = sensor.readSelf(now, hint)` (§5.2). If `undefined`: return (the runtime removes invalid bots). `lastSelf = self`.
4. Breadcrumbs: if `layerKind !== "reflex"` and `now - lastBreadcrumbTick >= cfg.combat.breadcrumbEveryTicks` and (`breadcrumbs` is empty or `dist3(last, self.pos) >= 2`): push `self.pos`, `lastBreadcrumbTick = now`; keep the newest `cfg.combat.breadcrumbMax`.
5. Scan: if `now >= nextScanAt`: `sensor.scan(now, self, protectedIdsOf(frozenObjective ?? lastObjective))` (§5.3, §7.1); `nextScanAt = now + (layerKind === "combat" || layerKind === "reflex" ? cfg.combat.combatScanEveryTicks : cfg.combat.scanEveryTicks)`. Otherwise `sensor.refreshDistances(self.pos)`.
6. Objective: if `frozenObjective` is set, `objective = frozenObjective`; if it is `defend`, replace `protectedIds`/`protectedPositions` with the sensor's latest players-in-zone. Else if `layerKind === "combat"` (a controller created in RECOVER has no frozen objective yet): `frozenObjective = objective = { kind: "idle", anchor: self.pos }`. Else `objective = buildObjective(hint, self.pos, sensor.playersInZone(hint), cfg.combat)` (§7.1). At the end of the step `lastObjective = objective`.
7. `annotate(sensor.entities, objective, cfg.combat)` (§7.3): fills `relevance`, `inLeash`, `attackAllowed`. Derive `relevantThreat = entities.some(e => e.classification === "threat" && e.relevance !== "irrelevant")` and `threatening = entities.some(e => e.classification === "threat" && e.relevance === "threatening_me")`.
8. Equipment: unless `layerKind === "reflex"`, or `flowActive`, or (`phase === "recover"` and `combat.busyEating()`): `equipment.tick(now, { threatsNear: count of entities with classification "threat" and distance <= cfg.body.equipBusyThreatDist, fighting: layerKind === "combat" && phase === "fight" })`.
9. `waterNearby` maintenance (§9.3 preamble).
10. Watchdog and warden escape (these bypass the brain):
    - If `escapePending` and `now - handoffAt > cfg.combat.handoffTimeoutTicks`: T17b (`snapshot.abortEscape(botId, "timeout")`; `failEscape(now)`).
    - If `sensor.warden` and `warden.targetingMe` and `warden.distance <= cfg.combat.wardenEscapeRadius`: `beginEscape(now)` (§3.6; it refuses while `escapePending` or `now < escapeBlockedUntil`). Continue either way.
11. Reflex: `{ active, mem } = stepReflex(reflexMem, { self, warden: sensor.warden, waterNearby }, now, cfg.combat)` (§9); `reflexMem = mem`.
    - If `active`: if `layerKind !== "reflex"`: `enterReflex(now)`. Then `runReflex(active, self, now)` (§9.3). Then the escalation rule of §9.4. Return.
    - Else if `layerKind === "reflex"`: `exitReflex(now)`.
12. If `escapePending`: return (handoff: no brain, no task; the body was halted in `beginEscape`).
13. Brain:
    - `avail = escapeAvailable(now)` (§3.6: `!escapePending && now >= escapeBlockedUntil`); `percept = buildPercept(...)` with `escapeAvailable: avail` (§2.4a); `r1 = brain(percept, brainState, kb, cfg.combat)`.
    - If `r1.decision.option === "escape_rejoin"`: `lastDecision = r1.decision`; if `beginEscape(now)` returns true: `brainState = r1.brainState`; `debug.decisions[escape_rejoin]++`; return. Otherwise discard `r1.brainState`, rebuild the percept with `escapeAvailable = false`, `r2 = brain(...)`, `brainState = r2.brainState`, `decision = r2.decision`.
    - Else `brainState = r1.brainState`, `decision = r1.decision`.
    - `lastDecision = decision`; `debug.decisions[decision.option]++`.
14. `isCombat = decision.option !== "resume_task" && decision.option !== "idle"`.
15. Dispatch on `layerKind` exactly as the transition table in §3.2 (rows T4 to T14). In short:
    - `idle` / `task` with `isCombat`: `enterCombat(now)`, `combat.run(decision, percept, now)`.
    - `task` without `isCombat`: `stepExecutor(now)` (§2.6).
    - `idle` without `isCombat`: nothing.
    - `combat`: per phase (§3.2).
    At the end: if `layerKind !== "idle"`: `lastActiveAt = now`. In `combat` with `shieldState() === "up"`: `debug.shieldUpTicks += 4`.

Helpers (private, exact behaviour):
- `enterCombat(now)`: `frozenObjective ??= objective` (the one built in step 6); if `executor` and not `executor.isPaused()`: `executor.pause(now)`; `layerKind = "combat"`; `phase = "fight"`; `calmSince = undefined`; `calmEnterAt = undefined`; `episodeHadThreat = relevantThreat`.
- `leaveCombat(now)`: `combat.halt()`; `frozenObjective = undefined`; `episodeHadThreat = false`; `phase = undefined`; `calmSince = undefined`; `calmEnterAt = undefined`; `lastEatDecision = undefined`; if `executor`: `executor.setAvoidZones?.(combat.activeNoGo(now), now)`, `executor.resume(now)`, `layerKind = "task"`; else `layerKind = "idle"`.
- `enterReflex(now)`: `frozenObjective ??= objective`; if `executor` and not paused: `executor.pause(now)`; `combat.halt()`; `body.stopBreaking()`; `reflexKindActive = undefined` (forces the "new kind" preamble of §9.3); `layerKind = "reflex"`.
- `exitReflex(now)`: `body.stopMoving()`; `body.setSneaking(false)`; `body.setSprinting(false)`; `reflexKindActive = undefined`; `reflexDest = undefined`; `layerKind = "combat"`; `phase = escapePending ? "handoff" : "calm"`; `calmSince = now`; `calmEnterAt = now`; `episodeHadThreat = true`.
- `protectedIdsOf(o)` is defined in §7.1.

### 2.4a `buildPercept` (`src/game/bots/percept.ts`, B3; D12)

```ts
export interface PerceptCtx {
  now: Tick;
  self: SelfPercept;
  sensor: Sensor;
  objective: ObjectiveContext;
  lookup: ColonyLookup;
  botId: BotId;
  layer: LayerKind;
  phase: CombatPhase | undefined;
  taskKind: TaskKind | undefined;
  escapeAvailable: boolean;
  /** hint items ids of the active or paused gather task, else carriedItemIds, else []. */
  objectiveItemIds: readonly string[];
  tacticFeedback: TacticFeedback | undefined;
  eating: { typeId: string; remainingTicks: number } | undefined;
  /** relevantThreat of step 7. */
  wantTerrain: boolean;
  cfg: Phase3Config;
}
/** `reads` is the controller's CombatBody viewed as BodyReads plus canBlock(). Pure assembly; never throws. */
export function buildPercept(reads: BodyReads & Pick<BodyActions, "canBlock">, world: WorldPort, ctx: PerceptCtx): Percept;
```

Assembly, one row per `Percept` field. Every read is wrapped in `try`; the listed default applies on a throw (always the safe one). `SelfPercept` and `EntityPercept` fields are filled earlier by the sensor (§5.2, §5.3; per-field adapter fallbacks in the §5.1 table).

| `Percept` field | Source | Default on throw / unreadable |
|---|---|---|
| `now` | `ctx.now` | – |
| `self` | `ctx.self` (this pump's `readSelf`) | – (the pump already returned in step 3) |
| `entities` | `[...ctx.sensor.entities]` (annotated in step 7, sorted by distance) | `[]` |
| `objective` | `ctx.objective` | `{ kind: "idle", anchor: self.pos }` |
| `home` | `ctx.lookup.home()` (`pos` is the integer block corner: consumers add 0.5 to x and z when walking) | omitted |
| `owner` | `ctx.lookup.owner(ctx.botId)` | omitted |
| `env` | `ctx.sensor.env` | `{ timeOfDay: 6000, isDaylight: true, skyLightAtBot: 0, difficulty: "normal", thunderstorm: false }` |
| `warden` | `ctx.sensor.warden` | omitted |
| `layer` | `ctx.layer` | – |
| `taskKind` | `ctx.taskKind` (`executor?.task.kind`) | omitted |
| `recovering` | `ctx.layer === "combat" && ctx.phase === "recover"` | `false` |
| `escapeAvailable` | `ctx.escapeAvailable` | `false` |
| `terrain` | if `ctx.wantTerrain && ctx.cfg.combat.terrainEnabled`: `ctx.sensor.terrain(now, self, p => world.blockAt(p))` (§5.6) | omitted (S2b: `groundFlat` true, the rest false) |
| `canBlock` | `reads.canBlock()` | omitted (S2b: offhand shield present) |
| `shieldDisabled` | `ctx.sensor.shieldDisabled(now)` | `false` |
| `objectiveItemIds` | `ctx.objectiveItemIds` | `[]` |
| `tacticFeedback` | `ctx.tacticFeedback` (`combat.lastFeedback(now)`) | omitted |
| `eating` | `ctx.eating` (`combat.eatingInfo(now)`) | omitted (S2a: full eat guard every pump) |

`EntityPercept.inWater` comes from `RawEntity.inWater` (default `false`). The caller (step 13) computes `objectiveItemIds = hint?.kind === "gather" ? hint.items.ids : carriedItemIds` using the executor's hint also while the executor is paused.

### 2.5 Colony effects routed through the controller

`assign(task, now)`:
1. `lastActiveAt = now`. If `executor?.taskId === task.id`: replace it silently (no warning) with `executor.cancel()` (H4: the re-emitted `assign` after an escape or an idempotent re-assign). Else if `executor`: log a warning (as Phase 2 does) and `executor.cancel()`.
2. `executor = createExecutor(task)`; `lastProgress = undefined`; `carriedItemIds = []`.
3. If `layerKind === "combat"` or `"reflex"`: `executor.pause(now)` immediately (it is never stepped until `leaveCombat`). If `frozenObjective` is set, rebuild it from the new executor's hint and the frozen `anchor` (keep the anchor).
4. Else `layerKind = "task"`.

`cancel(taskId, now)`:
1. If `executor?.taskId !== taskId`: return.
2. `executor.cancel()`; `executor = undefined`; `lastProgress = undefined`.
3. If `layerKind === "task"`: `layerKind = "idle"`. In `combat` / `reflex`: stay; `leaveCombat` later goes to `idle`. If `frozenObjective` is set: replace it with `{ kind: "idle", anchor: frozenObjective.anchor }`.

`onDeath(now)`:
1. `id = executor?.taskId`; `executor = undefined` (no `cancel()`: the body is dead; same as Phase 2); `lastProgress = undefined`.
2. `combat.reset()`; `sensor.reset()`; reset every field marked in the "Reset on death" column of §2.2 (including `breadcrumbs`, `escapeBlockedUntil`, `reflexMem`, `frozenObjective`, `needsRecover`, `phase`, `layerKind = "idle"`).
3. If `escapePending`: `snapshot.abortEscape(botId, "bot_died")`; `escapePending = false`.
4. `brainState = onBotDeath(brainState, now)`.
5. Return `id`. The runtime emits `taskReport failed bot_died` for it (existing death path). The runtime does not tick the controller while the bot is dead (`respawnAt` set); after respawn the controller continues in `idle`, and the runtime marks the equipment manager dirty (`markDirty("spawn")`, §11 step 8).

### 2.6 `stepExecutor(now)` (moved from `runtime.stepBot`, semantics unchanged)

1. `r = executor.step(now)`; if it throws: `logError`, `executor.cancel()`, `r = failed("error")`.
2. `p = executor.progress()` (catch → skip). If `p` and it differs from `lastProgress` (same comparison as Phase 2 `sameProgress`): `lastProgress = {...p}`; `sink.progress(botId, taskId, {...p}, now)`.
3. If `r.kind === "running"`: return.
4. `executor = undefined`; `lastProgress = undefined`; `layerKind = "idle"`; `sink.done(...)` or `sink.failed(..., r.reason, ...)`.

Progress is only emitted after a `step()`. A paused executor's progress cannot change, so nothing is lost.

### 2.7 `status()` (S5 shape, D25)

Built from the latest `lastSelf`, `lastDecision` and sensor. Fills the fields S5 §5 reads, plus the optional debug fields:
- `layer = layerKind`; `option = layerKind === "combat" ? (lastDecision?.option ?? "idle") : "idle"`; `reflex = reflexMem.kind` when `layer === "reflex"`; `combatPhase = phase` when `layer === "combat"`.
- `target` = `{ typeId, distance }` of the entity with `id === lastDecision?.targetId` (only while `layer === "combat"` and the entity is in the last scan), else absent.
- `hp`, `maxHp`, `hunger` from `lastSelf`. `recovering = layerKind === "combat" && phase === "recover"`.
- `gear.weaponTypeId`: `equipment.mainhand.typeId` if it is a key of `WEAPON_DAMAGE`, else the item at `inventory.bestWeaponSlot`, else absent. `gear.armorPieces`: the count of defined `equipment.head/chest/legs/feet` (0..4). `gear.hasShield`: `equipment.offhand?.typeId === "minecraft:shield"`. `gear.foodCount`: the sum of `amount` over `inventory.foods`.
- `taskId = executor?.taskId`; `taskPaused = executor?.isPaused() ?? false`; `threatCount` = relevant threats (`relevance !== "irrelevant"`) at the last scan.
- Before the first `tick` (no `lastSelf` yet): `hp = 20`, `maxHp = 20`, `hunger = 20`, `option = "idle"`, `recovering = false`, `gear = { armorPieces: 0, hasShield: false, foodCount: 0 }`.

---

## 3. Priority stack state machine

### 3.1 States

| State | `layerKind` | `phase` | Executor | Body owner |
|---|---|---|---|---|
| IDLE | `idle` | – | none | nobody (bot stands) |
| TASK | `task` | – | running (`step()` each pump) | executor |
| FIGHT | `combat` | `fight` | paused or none | combat executor |
| CALM | `combat` | `calm` | paused or none | nobody (halted) |
| RECOVER | `combat` | `recover` | paused or none | controller → combat executor (eat) |
| HANDOFF | `combat` | `handoff` | paused or none | S4 snapshot service |
| REFLEX(k) | `reflex` | – | paused or none | controller reflex runner |

Invariants (unit-tested):
- I1. `executor.step()` is called only in TASK.
- I2. In every other state with an executor, `executor.isPaused() === true`.
- I3. `frozenObjective !== undefined` exactly when `layerKind` is `combat` or `reflex`. A controller created in RECOVER (escape rejoin) sets it on its first tick (§2.4 step 6).
- I4. The brain runs only when not in REFLEX and not `escapePending`.
- I5. `combat.run()` is called only in FIGHT and RECOVER.

### 3.2 Transition table

"Brain combat" = `isCombat` (§2.4 step 14). "Brain calm" = option is `resume_task` or `idle`. "Threatening" = some entity with `classification === "threat"` and `relevance === "threatening_me"` at the last scan. Only threatening entities hold CALM (D27): a `blocking_objective` threat that the leash forbids attacking must not deadlock the task. `need = episodeHadThreat ? config.combat.resumeCalmTicks : 0`. Reflex rows are evaluated before brain rows every pump.

| # | State | Event / trigger | Guard | Action | Next |
|---|---|---|---|---|---|
| T1 | any (including HANDOFF) | reflex trigger (§9.2) | – | `enterReflex(now)`; `runReflex` | REFLEX(k) |
| T2 | REFLEX(k) | higher-priority trigger | – | switch kind; `runReflex` | REFLEX(k') |
| T3 | REFLEX(k) | exit condition of k (§9.2), no other trigger | – | `exitReflex(now)` | HANDOFF if `escapePending`, else CALM |
| T4 | IDLE | brain combat | – | `enterCombat`; `combat.run` | FIGHT |
| T5 | TASK | brain combat (e.g. threat appears while gathering) | – | `enterCombat` (pauses executor); `combat.run` | FIGHT |
| T6 | TASK | brain calm | – | `stepExecutor` | TASK, or IDLE on done/failed |
| T7 | FIGHT | brain combat | – | `combat.run`; `episodeHadThreat ||= relevantThreat` | FIGHT |
| T8 | FIGHT | brain calm | – | `combat.halt()`; `calmSince = now`; `calmEnterAt = now` | CALM |
| T9 | CALM | brain combat | – | `phase = "fight"`; `calmSince = undefined`; `calmEnterAt = undefined`; `combat.run` | FIGHT |
| T10 | CALM | brain calm | Threatening and `now - calmEnterAt < config.combat.calmMaxTicks` | `calmSince = now` (restart the wait) | CALM |
| T10a | CALM | brain calm | not Threatening and `now - calmSince < need` | none (the pump does nothing) | CALM |
| T10b | CALM | brain calm | Threatening and `now - calmEnterAt >= config.combat.calmMaxTicks` (forced resume) | as T11 if `needsRecover`, else as T12 | RECOVER, or TASK / IDLE |
| T11 | CALM | brain calm | not Threatening, `now - calmSince >= need`, and `needsRecover` | `phase = "recover"`; `recoverSince = now`; `calmSince = undefined`; `calmEnterAt = undefined` | RECOVER |
| T12 | CALM | brain calm | not Threatening, `now - calmSince >= need`, not `needsRecover` | `leaveCombat(now)` (resumes executor) | TASK if executor else IDLE |
| T13 | RECOVER | brain combat, option ≠ `eat` | – | `phase = "fight"`; `combat.run` (`needsRecover` stays true) | FIGHT |
| T14 | RECOVER | otherwise | – | `runRecover(now, decision, percept)` (§3.5) | RECOVER, or via `leaveCombat` to TASK / IDLE |
| T15 | any non-REFLEX | brain picks `escape_rejoin` | `beginEscape` returns true | `beginEscape` (§3.6) | HANDOFF |
| T16 | any | warden targeting me within `wardenEscapeRadius` (§2.4 step 10) | `escapeAvailable` | `beginEscape` | HANDOFF (or REFLEX(warden) with `escapePending`) |
| T17 | HANDOFF | `onEscapeFailed(now)` | – | `failEscape(now)` (§3.6) | CALM |
| T17b | HANDOFF | `now - handoffAt > config.combat.handoffTimeoutTicks` (checked in §2.4 step 10, in any layer) | `escapePending` | `snapshot.abortEscape(botId, "timeout")`; `failEscape(now)` | CALM |
| T18 | HANDOFF | S4 disconnects the bot | – | `dispose("escaped")` | (gone) |
| T19 | any | colony `cancel` for the current task (incl. during combat) | task id matches | `executor.cancel()`; drop it; TASK → IDLE, others stay | same layer |
| T20 | any | colony `assign` | – | §2.5; paused at once unless IDLE/TASK | TASK if it was IDLE/TASK, else same |
| T21 | any | bot death | – | `onDeath` (§2.5): task fails `bot_died` through the existing path | IDLE (after respawn) |
| T22 | any | `dispose` | – | §2.3 | (gone) |

Cases the task list asked about, by row:
- Threat appears while gathering: T5. The gather executor is paused (§4.2), the combat executor fights.
- Fight ends: T8 then T12 after `resumeCalmTicks` with no threatening entity. If a threatening entity keeps the bot in CALM, T10b forces the resume after `calmMaxTicks` (600).
- Executor finishes while paused: impossible (I1). `GatherExecutor.step()` and `GotoExecutor.step()` additionally return `running` without touching the body if called while paused (§4.1, defensive).
- Task cancelled by the colony during combat: T19. The bot keeps fighting; when calm it goes to IDLE.
- Bot death during combat: T21.
- `escape_rejoin` chosen: T15, then §3.6.

### 3.3 Brain eating without threats (topup)

`eat` is a combat option. A topup eat in TASK goes T5 → FIGHT. Because no relevant threat was seen, `episodeHadThreat` is false and `need` is 0: the task resumes on the first calm pump after the eat completes (T8 then T12).

### 3.4 Objective freezing

The ObjectiveContext is built from the executor's hint while in IDLE/TASK, and frozen on entering combat or a reflex (I3). Chasing therefore never drags the corridor or anchor with the bot, and the leash (§7.4) is measured from where the fight started.

### 3.5 RECOVER (`runRecover(now, decision, percept)`)

Only entered after an escape rejoin (`needsRecover`). Each pump in RECOVER (after the brain returned calm or `eat`), with `self = percept.self`:
1. If `self.hp >= config.combat.recoverHp`: `needsRecover = false`; `leaveCombat(now)`. Done.
2. If `lastEatDecision !== undefined` and `combat.busyEating()`: `combat.run(lastEatDecision, percept, now)` (continue); return.
3. `food`: if `decision.option === "eat"` and `decision.foodSlot !== undefined` and `decision.foodTypeId !== undefined`: `{ typeId: decision.foodTypeId, slot: decision.foodSlot, emergency: decision.eatMode === "emergency" }`; else `deps.chooseFood("pre_engage_heal", self)` (an S2b `FoodChoice`, or undefined).
4. If `food`: `lastEatDecision = { option: "eat", foodTypeId: food.typeId, foodSlot: food.slot, eatMode: food.emergency ? "emergency" : "normal", scores: {}, masked: [], reason: "recover" }`; `combat.run(lastEatDecision, percept, now)`; return.
5. No food: if `self.hunger >= 18` (natural regen, TABLES §1) and `now - recoverSince < config.combat.recoverMaxTicks`: `combat.halt()` (idempotent; stand still); return.
6. Otherwise (no food and no regen, or timed out): `needsRecover = false`; `leaveCombat(now)`.

`lastEatDecision` is cleared in `leaveCombat`.

### 3.6 Escape hand-off (S4 owns the flow)

`escapeAvailable(now) = !escapePending && now >= escapeBlockedUntil` (also the value of `Percept.escapeAvailable`).

`beginEscape(now): boolean`:
1. If `!escapeAvailable(now)`: return false.
2. `ok = snapshot.requestEscape(botId, now, () => this.exportCarry())`.
3. If `!ok`: `escapeBlockedUntil = now + config.combat.escapeRetryTicks`; return false.
4. `escapePending = true`; `handoffAt = now`; `debug.escapes++`. If `layerKind` is not `reflex`: `enterCombat(now)` if not already in combat, then `phase = "handoff"`; `combat.halt()`; `body.stopBreaking()`. The executor stays paused (never cancelled: the core still sees the task as active). Return true.

Every caller treats `false` as "no escape: stay in FIGHT / REFLEX".

`failEscape(now)` (T17, T17b; the controller sets the phase, the reflex layer never does): `escapePending = false`; `escapeBlockedUntil = now + config.combat.escapeRetryTicks`; if `layerKind === "combat"`: `phase = "calm"`, `calmSince = now`, `calmEnterAt = now`. In a reflex the phase is set by `exitReflex`. The throttle applies only after a refused or failed request; a completed escape has no cooldown (ROADMAP), and the brain may pick `escape_rejoin` again as soon as `escapeAvailable` is true.

`exportCarry()` (D26, hand-off H2) returns `{ brainState, recover: true, objectiveItemIds }`:
- `brainState`: the current `brainState`.
- `objectiveItemIds`: `[...hint.items.ids]` from `executor?.objectiveHint()` when its kind is `gather`; otherwise `carriedItemIds` if non-empty; otherwise omitted.
- No task and no progress travel in the carry. The task stays assigned in the core record; the core re-emits `assign` on `botRejoined` (S5 §4.7), with `delivered` folded in by the core (S4b H3). `held` items come back with the snapshot restore.

After the rejoin, the runtime constructs `new BotController(deps, { carry, stats }, now)` (`stats` = the snapshot's serialized stats, if any). The constructor:
1. `brainState = carry.brainState`, then `commit = undefined`, `tactic = undefined`, `engagement = undefined` (entity ids changed). If `init.stats ?? carry.stats` is defined: `brainState = { ...brainState, stats: parseStats(init.stats ?? carry.stats) }` (S2b).
2. No executor is built. `executor = undefined`.
3. `layerKind = "combat"`; `phase = "recover"`; `recoverSince = now`; `needsRecover = carry.recover`; `episodeHadThreat = false`; `carriedItemIds = carry.objectiveItemIds ?? []`. `frozenObjective` is built on the first tick as `{ kind: "idle", anchor: <first readable self.pos> }` (I3).
4. RECOVER runs (§3.5): eat / regen until `hp >= recoverHp` or no food. The core's `assign` (S5 §4.7) arrives at any time: the controller creates the executor with `createExecutor(task)` and, because the layer is `combat`, pauses it at once (§2.5; if an executor with the same task id exists it is replaced silently, H4). When RECOVER ends, `leaveCombat` resumes the executor, or goes to IDLE if none arrived.

### 3.7 Combat executor (`src/game/bots/combat-executor.ts`, B3; D13, D15)

The controller's `CombatExecutor` (§2.1) maps a `Decision` to S3's runners (`TacticRunner`, `EatRunner`) and body calls. S3 provides the runners only (S3 §3.5).

Constructor deps: `{ body, world, cfg, kb, equipment, chooseFood, provocation, botId, frozenObjective, log, debug }` where `body: CombatBody` is the counting wrapper of §11.1, `world: () => WorldPort | undefined`, `cfg: Phase3Config`, `kb: Knowledge`, `frozenObjective: () => ObjectiveContext | undefined`. Private state: `runner?: TacticRunner`, `runnerKey?: string` (`"<tactic>:<targetId>"`), `eat?: EatRunner`, `eatKey?: string` (`"<slot>:<typeId>"`), `eatStartedAt`, `eatTicks`, `noGo: NoGoZone[]` (max 8), `feedback?: TacticFeedback`, `fightTicks = 0`.

`run(decision, percept, now)`:
1. If `world()` is undefined: `halt()`; return.
2. `target = percept.entities.find(e => e.id === decision.targetId)`.
3. If `decision.option !== "eat"` and `eat` is set: `eat.stop()`; `eat = undefined`. If `decision.option === "eat"` and `runner` is set: `runner.stop()`; `runner = undefined`.
4. Dispatch:

| `decision.option` | Needs | Action each pump | Notes |
|---|---|---|---|
| `attack` | `decision.tactic`, `target`, `target.attackAllowed` | `useRunner(decision.tactic, target)` | If a need is missing: `halt()` and log once. `equipment.ensureWeaponSelected()` runs before the runner's `start` |
| `shield` | `decision.tactic`, `target` | `useRunner(decision.tactic, target)` | Works against `attackAllowed = false` targets |
| `back_off` | `decision.tactic`, `target` | `useRunner(decision.tactic, target)` | |
| `retreat` | – | `decision.tactic && target`: `useRunner(decision.tactic, target)`. Else `decision.moveTo`: every 20 ticks `body.navigateToward(decision.moveTo, 1.0)`. Else `body.stopMoving()` | `moveTo` is home or owner (S2b), walking target already block-centred |
| `flee` | – | `decision.tactic && target`: `useRunner(decision.tactic, target)`; else `body.stopMoving()` | |
| `eat` | `decision.foodSlot`, `decision.foodTypeId` | `useEat({ slot: foodSlot, typeId: foodTypeId, eatTicks: kb.food(foodTypeId)?.eatTicks ?? 32, mode: decision.eatMode ?? "normal" })` | Missing need: `halt()` |
| `escape_rejoin`, `resume_task`, `idle` | – | `halt()` and log (the controller never passes them) | Escape is handled in §2.4 step 13 |

`useRunner(tactic, target)`: `key = tactic + ":" + target.id`. If `runner` and `runnerKey === key`: `st = runner.step(now)`; `running` → return; `done` / `failed` → `finishRunner(st, now)`. Otherwise `runner?.stop()`, then `startTactic(tactic, target, now)`. `start` and the first `step` never happen in the same pump.

`startTactic(tactic, target, now)`: `equipment.ensureWeaponSelected()` (result ignored; D14 unarmed fallback) for options `attack` and `back_off`; `r = createTactic(tactic)`; `ok = r.start(ctx)` with `ctx` from the table below. If `ok`: `runner = r`, `runnerKey = key`, add `tactic` to `debug.tactics` if absent. If not `ok`: `r.reason` is set and nothing changed: `feedback = { tactic, targetId: target.id, status: "failed", reason: r.reason ?? "start_failed", tick: now }`, then `fallbackChain(tactic, target, r.handoff, now)`.

`finishRunner(st, now)`: `feedback = { tactic: runner.tactic, targetId, status: st, reason: runner.reason ?? "", tick: now }`; `hand = runner.handoff`; `runner.stop()`; `runner = undefined`; `equipment.markDirty("fight_end")`. Then: if `st === "failed"`: `fallbackChain(tactic, target, hand, now)`. If `st === "done"` and `hand` is defined: `startTactic(hand, target, now)` once (advisory; the brain replaces it next pump if it chooses otherwise).

`fallbackChain(failed, target, handoff, now)` (D15): candidates in order: `handoff` (if defined), then `hit_and_back_off` (only if `target.attackAllowed`), then `avoid_path_around`, then `sprint_away`; skip `failed` and any candidate already tried this chain. The first candidate whose `start` returns true becomes the runner (its feedback is not reported; the original failure is). If none starts: `body.stopMoving()`. One chain per pump; no recursion.

`useEat(req)`: `key = req.slot + ":" + req.typeId`. If `eat` and `eatKey === key`: `st = eat.step(now)`; `running` → return; `done` → `debug.eats++`; `equipment.ensureWeaponSelected()`; `eat = undefined`. `interrupted` / `failed` → `eat = undefined` (the brain decides next pump). Otherwise: `eat = new EatRunner()`; `ok = eat.start({ body, threats: () => threatViews(), log }, req)`; on success `eatKey = key`, `eatStartedAt = now`, `eatTicks = req.eatTicks`; on failure `eat = undefined`, log `eat.reason`, `body.stopMoving()`.

Other members:
- `halt()`: `runner?.stop(); runner = undefined; eat?.stop(); eat = undefined; body.stopMoving(); body.lowerShield(); body.setSneaking(false); body.setSprinting(false); body.stopEating()`.
- `reset()`: forget `runner`, `eat`, `noGo`, `feedback` without any body call.
- `busyEating()`: `eat !== undefined`. `eatingInfo(now)`: `eat ? { typeId, remainingTicks: max(0, eatStartedAt + eatTicks - now) } : undefined`.
- `lastFeedback(now)`: `feedback` if `now - feedback.tick <= 4` (one pump), else undefined. Repeated calls in the same pump return the same object (S2b dedupes on `tick`).
- `activeNoGo(now)`: `noGo.filter(z => z.expiresAt > now)`.
- Fight bookkeeping: `fightTicks += 4` per `run` with a runner; at every 400: `equipment.markDirty("fight_end")` (S3 §5.3).

`TacticContext` / `MobView` / `TacticSignals` sources (S3 §3.1 defines the fields; `S = body.self()`; `percept` = this pump's Percept):

| Field | Source |
|---|---|
| `ctx.body`, `ctx.world`, `ctx.cfg` | the counting `CombatBody`; `world()`; `cfg.body` |
| `ctx.entry` | `kb.mob(target?.typeId ?? "minecraft:warden")` |
| `ctx.targetId` / `ctx.awayFrom` | `target?.id`; `percept.warden?.pos` for `flee_sneak`, else `target?.pos` |
| `ctx.mob(id)` | `e = body.entity(id)`; undefined or `!e.valid` → undefined. Else a `MobView`: `pos`, `eye`, `vel`, `aabb`, `isBaby`, `charged`, `inWater` from `e`; `distance = dist3(S.pos, e.pos)`; `reach = reachDistance(S.eye, e.aabb)`; `hasLos = !rayBlocked(world, S.eye, e.eye)`; `aggroed` = the percept entity's `targetingMe` (false if absent); `hissing = e.ignited === true \|\| (cfg.combat.hissProxyEnabled && typeId === "minecraft:creeper" && distance < cfg.combat.hissProxyDist)`; `diving = e.vel.y < -0.1 && distXZ(S.pos, e.pos) < 8`; `ranged` / `flying` = `kb.mob(typeId).special` includes `ranged_projectile` / `flying` |
| `ctx.threats()` | every percept entity with `classification === "threat"` and `distance <= 24`, nearest first, as `MobView` via `ctx.mob` |
| `ctx.signals()` | `hostileCountNear` / `sameTypeCount12`: threat entities within `cfg.combat.countRadius`; `shieldDurabilityPct`: round(100 × `durabilityFrac`) of the offhand shield, else of the inventory shield at `shieldSlot`, else undefined; `shieldDisabled`: `percept.shieldDisabled ?? false`; `poisoned` / `slowed` / `darkness`: effects `minecraft:poison` / `minecraft:slowness` / `minecraft:darkness`; `canRegen`: `self.hunger >= 18 \|\| chooseFood("pre_engage_heal", self) !== undefined`; `reengageHp = cfg.combat.recoverHp`; `fleeHp`: as the S3 §3.1 comment; `hitDamage = entry.attack_damage[difficulty]` (`peaceful` → `normal`); `unarmed = !(equipment.report()?.hasWeapon ?? true)` |
| `ctx.mobAttackedAt(id)` | `provocation.lastHit(id, botId, now - cfg.combat.provokeMemoryTicks)` |
| `ctx.leashDistance(pos)` / `ctx.leashBlocks` | `leashDistance(pos, frozenObjective)` (undefined if none) / `leashLimit(frozenObjective, cfg.combat)` |
| `ctx.home` / `ctx.owner` | `percept.home` in the bot's dimension as `{ x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 }` / `percept.owner?.pos` |
| `ctx.isNeverTarget(typeId)` | `NEVER_TARGET_ALWAYS.has(typeId)` |
| `ctx.publishNoGo(z)` | replace the zone with the same `mobId`, append, drop expired, keep the newest 8 |
| `ctx.equip` | `{ ensureWeaponSelected: () => equipment.ensureWeaponSelected() }` |
| `ctx.chooseFood()` | `f = deps.chooseFood("pre_engage_heal", self)`; `f && { slot: f.slot, typeId: f.typeId, eatTicks: f.eatTicks }` |
| `ctx.log(msg)` | the runtime's `[colony]` logger |

---

## 4. TaskExecutor change (`src/game/bots/executor.ts`, contract writer)

```ts
import type { ObjectiveHint } from "../../core/combat/types.js";
import type { NoGoZone } from "./body/types.js"; // S3 §3.1

export interface TaskExecutor {
  readonly taskId: TaskId;
  readonly task: Task;
  step(now: Tick): StepResult;
  cancel(): void;
  progress(): TaskProgress | undefined;
  /**
   * Phase 3. Stop every body action of this task (movement, breaking, using) and keep all progress.
   * Idempotent. No-op on a settled (finished/cancelled) executor. Never reports.
   */
  pause(now: Tick): void;
  /**
   * Phase 3. Leave the paused state and re-plan from the bot's current position on the next step().
   * No-op if not paused or settled. Never touches the body itself (the next step() does).
   */
  resume(now: Tick): void;
  isPaused(): boolean;
  /** Phase 3. What the bot is working toward right now (§1 ObjectiveHint). undefined = nothing yet. */
  objectiveHint(): ObjectiveHint | undefined;
  /**
   * Phase 3, optional. Zones published by S3's avoid_path_around (`NoGoZone`). The controller calls it with
   * `combat.activeNoGo(now)` right before `resume(now)` (§2.4 `leaveCombat`). GatherExecutor implements it (§4.2);
   * GotoExecutor and DefendExecutor ignore it. Never touches the body.
   */
  setAvoidZones?(zones: readonly NoGoZone[], now: Tick): void;
}

export interface ExecutorContext {
  body: WorkerBody;
  world(): WorldPort | undefined;
  gather: GatherConfig;
  /** Phase 3 (DefendExecutor). */
  defend: DefendConfig; // = config.defend (§10)
  /** Phase 3, optional. Called by GatherExecutor after each settled chest deposit or withdrawal (marks the snapshot dirty, §11 step 10). */
  onChestTransfer?(): void;
}
```

### 4.1 Invariants (all executors)

- P1. `pause` while paused: no-op. `resume` while not paused: no-op.
- P2. While paused, `step(now)` returns `{ kind: "running" }` and makes no body call. (The controller never calls it; this is defensive.)
- P3. `progress()` returns the same value before `pause`, during the pause, and right after `resume` (progress only changes inside `step`).
- P4. `cancel()` works in every state, including paused; afterwards `isPaused()` is irrelevant and `step` never reports.
- P5. Paused time never counts against an executor deadline: on `resume(now)`, every absolute deadline is shifted by `now - pausedAt`.
- P6. `pause` on an executor that has not had its first `step` yet is legal (assign during combat). Its first real step happens after `resume`.

Each executor stores `private pausedAt: Tick | undefined` (`isPaused() = pausedAt !== undefined`).

### 4.2 GatherExecutor

`pause(now)`:
1. If `settled` or paused: return.
2. `pausedAt = now`; `pausedPhase = this.ph`.
3. `stopBreakingIfNeeded()`; `body.stop()`.
4. Nothing else changes: `delivered`, `lastInv`, `blacklist`, `failures`, `pendingFailure`, `gatheringLogs`, `logsTarget`, `tableAt`, `chestPurpose` are kept.

`resume(now)`:
1. If `settled` or not paused: return.
2. `shift = now - pausedAt`; `deadline += shift` (if finite); `pausedAt = undefined`.
3. Re-plan by `pausedPhase`:

| Paused in | On resume | Why |
|---|---|---|
| `start` | stay `start` | Nothing happened yet. |
| `scan` | `resetScan()` | Full re-scan from `task.origin`; ranking uses the current position. |
| `approach`, `break` | `cand = undefined` (NOT blacklisted, `failures` unchanged), `walker = undefined`, `arrivedAt = undefined`, `breaking = false`; `resetScan()` | Drop the candidate; the re-scan finds it again if still valid. |
| `collect` | stay `collect` with `settleUntil = now`, `collectUntil = now + cfg.pickupTimeoutTicks`, `dropId = undefined` | The drops are on the ground near `cand.block`; walking back to them keeps the items. |
| `toChest`, `atChest` | `goToChest(chestPurpose)` (new walker, `chestRetries = 0`) | Re-path to the same chest. |
| `craft` | stay `craft`; `placedTableAt` kept; `craftPumps` kept | Crafting doesn't move; continue the chain. |

4. The same `task.origin` and `task.chest` are used (they're on the immutable task).
5. The table must cover every member of the `Ph` union in `gather-executor.ts`; the builder reports a mismatch. Any other `Ph` member (including `done` / settled) is left as it is on resume, and `resume` throws no error for it.

`setAvoidZones(zones, now)`: store `avoid = zones.filter(z => z.expiresAt > now)`. While `scan` ranks candidate blocks, skip (do not blacklist, do not count as a failure) any candidate whose block center is within `z.radius` of `z.center` for a zone `z` with `z.expiresAt > now`. Zones never apply to the chest walk, to `collect`, or to `craft`. If every candidate is skipped the executor behaves as if the scan found nothing (its existing "no candidate" path).

`onChestTransfer`: call `ctx.onChestTransfer?.()` right after a deposit or withdrawal is settled (Phase 2's `settleTransfer` path).

`step(now)`: first line after `if (this.settled) return RUNNING;` is `if (this.pausedAt !== undefined) return RUNNING;`.

`objectiveHint()`:
```ts
{
  kind: "gather",
  target: (ph is "approach" | "break" | "collect") && cand ? blockCenter(cand.block) : undefined,
  chest: blockCenter(task.chest.pos),
  heading: ph is "toChest" | "atChest" ? blockCenter(task.chest.pos)
         : (ph is "approach" | "break" | "collect") && cand ? blockCenter(cand.block) : undefined,
  items: { ids: this.res.yields, required: Math.max(0, task.amount - this.delivered) },
}
```
Return `undefined` when `settled`.

### 4.3 GotoExecutor

`pause(now)`: if settled or paused return; `pausedAt = now`; `body.stop()`; if `state`: `state.navigating = false`.

`resume(now)`: if settled or not paused return; `shift = now - pausedAt`; `pausedAt = undefined`; if `state`: `state.deadline += shift`; `state.lastProgressAt = now`; `state.navigating = false` (the next `decide` returns `navigate`, i.e. a re-path from the current position). `bestDist` is kept. If `firstStepAt` is set: `firstStepAt += shift`.

`objectiveHint()`: `{ kind: "goto", target: task.target }` (undefined when settled).

`step`: paused guard as in §4.2.

### 4.4 DefendExecutor patrol (`src/game/bots/defend-executor.ts`, B3)

S5 defines `DefendTask` (`{ id, kind: "defend", center: Vec3, radius: number, issuer, createdAt }`). S1 defines how it is executed. Fighting is not the executor's job: the controller's combat layer handles every hostile in the zone (relevance §7.3). The executor only patrols.

```ts
export interface DefendConfig {
  patrolStepBlocks: number;
  patrolRadiusFrac: number;
  minPatrolRadius: number;
  dwellTicks: Tick;
  badWaypointRetryTicks: Tick;
  groundSearchUp: number;
  groundSearchDown: number;
  allBadWaitTicks: Tick;
  startPositionTimeoutTicks: Tick;
}

export class DefendExecutor implements TaskExecutor {
  constructor(task: DefendTask, ctx: ExecutorContext);
  // TaskExecutor members; progress() returns undefined.
}
```

Geometry (computed on the first step):
- `rp = clamp(round(task.radius * cfg.patrolRadiusFrac), cfg.minPatrolRadius, task.radius)`; if `task.radius < cfg.minPatrolRadius`, `rp = task.radius`.
- `n = max(4, ceil(2π · rp / cfg.patrolStepBlocks))`.
- Waypoint `k` (0..n-1): `θk = 2πk / n`; `xz = (center.x + rp·cos θk, center.z + rp·sin θk)`.
- Ground snap (lazy, cached per waypoint, re-done when a waypoint's bad mark expires): `snapToGround(probe, x, z, floor(center.y), groundSearchUp, groundSearchDown)` (§8.3). None → the waypoint is bad.
- Start index `k0`: the waypoint whose angle is nearest to `atan2(bot.z - center.z, bot.x - center.x)`.
- Direction: increasing `k` (wrapping), skipping bad waypoints.

State machine:

| State | Event | Guard | Action | Next |
|---|---|---|---|---|
| start | step | `ctx.world()` undefined | – | failed `error` |
| start | step | bot position unreadable for `startPositionTimeoutTicks` | – | failed `timeout` |
| start | step | position readable | compute geometry, `k = k0`; `walker = new Walker(body, wp[k])` | walk |
| walk | walker `walking` | – | – | walk |
| walk | walker `arrived` | – | `body.stop()`; `dwellUntil = now + dwellTicks` | dwell |
| walk | walker `timeout` / `unreachable`, or `wp[k]` bad | – | `bad[k] = now + badWaypointRetryTicks`; `k = nextGood(k)`; new walker | walk |
| walk/dwell | – | every waypoint bad | `walker = new Walker(body, snapped center)` (center itself snapped like a waypoint; if that fails too: stand still) ; `holdUntil = now + allBadWaitTicks` | hold |
| dwell | step | `now >= dwellUntil` | `k = nextGood(k)`; new walker | walk |
| hold | step | `now >= holdUntil` | clear all `bad` marks and snaps | walk (from the nearest waypoint) |
| any | `pause(now)` | – | `body.stop()`; remember `pausedAt` | paused |
| paused | `resume(now)` | – | `pausedAt = undefined`; `walker = undefined`; shift only the `bad[]` marks by `now - pausedAt`; next step: `k = nearest good waypoint to the bot`, new walker | walk |
| any | `cancel()` | – | `body.stop()`; settled | (settled) |

It never returns `done`. It runs until cancelled (`!stop`, preempted) or the bot dies/leaves.
`objectiveHint()` = `{ kind: "defend", center: task.center, radius: task.radius }`.
Registry: `defend: (task, ctx) => new DefendExecutor(task, ctx)` in `registry.ts`.

---

## 5. Sensor

### 5.1 SensePort (`src/game/bots/ports.ts` addition; implemented in `src/game/adapter/sense.ts`)

`sense.ts` imports only `@minecraft/server` (never gametest); it takes the bot as a `Player`.

```ts
import type { Vec3 } from "../../core/types.js";
import type { EffectView, EnvPercept, ItemView } from "../../core/combat/types.js";

export interface RawEntity {
  id: string;
  typeId: string;
  pos: Vec3;
  headPos: Vec3;
  velocity: Vec3;
  hp?: number;
  maxHp?: number;
  families: string[];
  isTamed: boolean;
  isBaby: boolean;
  isIgnited: boolean;
  isCharged: boolean;
  /** Entity.isInWater (false if unreadable). */
  inWater: boolean;
  ridingId?: string;
  /** Entity.target?.id. undefined = no target, unreadable, the beta member is gone, or combat.useTargetApi is false. */
  targetId?: string;
  aabb?: { center: Vec3; extent: Vec3 };
}

export interface RawSelf {
  dimensionId: string;
  pos: Vec3;
  headPos: Vec3;
  velocity: Vec3;
  hp: number;
  maxHp: number;
  hunger?: number;
  saturation?: number;
  effects: EffectView[];
  inWater: boolean;
  onGround: boolean;
  isFalling: boolean;
  isClimbing: boolean;
  isSneaking: boolean;
  isSprinting: boolean;
  onFireTicks: number; // 0 when the component is absent
  airSupply?: number; // minecraft:breathable airSupply (beta)
  totalSupply?: number; // seconds
  feetBlockId?: string; // block at floor(pos)
  headBlockId?: string; // block at floor(headPos)
  /** 36 slots; undefined = empty. */
  inventory: ReadonlyArray<ItemView | undefined>;
  selectedSlot: number;
  equipment: { head?: ItemView; chest?: ItemView; legs?: ItemView; feet?: ItemView; offhand?: ItemView };
  totalArmor: number;
}

export interface PlayerView {
  id: string;
  name: string;
  pos: Vec3;
}

export interface SensePort {
  /** undefined = the bot is invalid or its location/health can't be read. */
  readSelf(): RawSelf | undefined;
  /** §5.3 query. Excludes the bot itself. [] on failure. */
  scanEntities(center: Vec3, radius: number, max: number): RawEntity[];
  /** Entities of one type within radius (used for minecraft:warden). [] on failure. */
  findType(typeId: string, center: Vec3, radius: number): RawEntity[];
  /** API-MAP A8 recipe. undefined = threw. */
  lineOfSight(fromHead: Vec3, toHead: Vec3): boolean | undefined;
  /** Dimension.getLightLevel (API-MAP A9). undefined = threw / unloaded. */
  lightAt(pos: Vec3): number | undefined;
  /** Dimension.getPlayers({ location: center, maxDistance: radius }) (API-MAP A1), including bots. */
  playersNear(center: Vec3, radius: number): PlayerView[];
  env(headPos: Vec3): EnvPercept;
  /** Player.getItemCooldown(category) (API-MAP C6, S:18239). 0 when the category is "" or the call throws. Used only if combat.shieldDisabledSource === "cooldown_api". */
  shieldCooldownTicks(category: string): number;
}
```

Adapter API per field (all wrapped in try/catch, rate-limited `[colony]` logs, documented fallback):

| Field | API (API-MAP section) | Fallback on throw / absent |
|---|---|---|
| `pos`, `headPos`, `velocity` | `location`, `getHeadLocation()`, `getVelocity()` (A4) | `readSelf` returns undefined if `location` fails; head = pos + (0, 1.62, 0); velocity 0 |
| `hp`, `maxHp` | `getComponent('minecraft:health').currentValue / effectiveMax` (A3) | `readSelf` undefined if hp unreadable; maxHp 20 |
| `hunger`, `saturation` | `player.hunger`, `player.saturation` `.currentValue` (A11) | undefined |
| `effects` | `getEffects()` → `{typeId, amplifier, duration}` (A10) | `[]` |
| `inWater`, `onGround`, `isFalling`, `isClimbing`, `isSneaking`, `isSprinting` | Entity props (A4) | false |
| `onFireTicks` | `getComponent('minecraft:onfire')?.onFireTicksRemaining` (A4) | 0 |
| `airSupply`, `totalSupply` | `getComponent('minecraft:breathable')`: `.airSupply` (writable, beta, S:10883) / `.totalSupply` (S:10955); API-MAP A13 (row added by D20; unverified); either read can throw | undefined (then `airFrac` is undefined and only the head-in-water timer and the `drowning` cause drive the reflex) |
| `feetBlockId`, `headBlockId` | `dimension.getBlock(floor(v))?.typeId` (G) | undefined |
| `inventory`, `selectedSlot` | `getComponent('minecraft:inventory').container.getItem(i)` (D1), `selectedSlotIndex` (C) | `[]` ×36 undefined, 0 |
| `equipment` | `getComponent('minecraft:equippable').getEquipment(Head/Chest/Legs/Feet/Offhand)` (D3). **Never `Mainhand`.** | undefined pieces |
| `totalArmor` | `equippable.totalArmor` (D3) | 0 |
| `ItemView.durability` | `getComponent('minecraft:durability')` `damage`, `maxDurability` (D4) | absent |
| `ItemView.enchants`, `enchantLevelSum`, `mending` | `getComponent('minecraft:enchantable').getEnchantments()` (D4): `enchants` = `{ id: type.id with a leading "minecraft:" removed, level }`; `enchantLevelSum` = sum of `level`; `mending` = any `id === "mending"` | absent |
| Entity `families` | `getComponent('minecraft:type_family').getTypeFamilies()` (A2); cache per `typeId` in a module `Map` | `[]` |
| Entity `isTamed` | `hasComponent('minecraft:is_tamed') \|\| getComponent('minecraft:tameable')?.isTamed === true` (A7) | false |
| Entity `isBaby` / `isIgnited` / `isCharged` | `hasComponent('minecraft:is_baby' / 'minecraft:is_ignited' / 'minecraft:is_charged')` (A6, A7) | false |
| Entity `inWater` | `Entity.isInWater` (A4) | false |
| Entity `ridingId` | `getComponent('minecraft:riding')?.entityRidingOn?.id` (A4) | undefined |
| Entity `targetId` | `e.target?.id` (A5, beta: one wrapper function `targetIdOf(e)`; returns undefined without reading when `combat.useTargetApi` is false) | undefined |
| Entity `aabb` | `getAABB()` (A4) | undefined |
| `lineOfSight` | `dimension.getBlockFromRay(o, d/|d|, { maxDistance: |d|, includeLiquidBlocks: false, includePassableBlocks: false })`, LoS iff undefined (A8) | undefined |
| `env` | `world.getTimeOfDay()`, `dimension.getSkyLightLevel(head)`, `world.getDifficulty()`, `dimension.getWeather()` (A9) | `{ timeOfDay: 6000, isDaylight: true, skyLightAtBot: 0, difficulty: "normal", thunderstorm: false }` |

`scanEntities(center, radius, max)` exactly:
```ts
dim.getEntities({ location: center, maxDistance: radius, closest: max, excludeTypes: EXCLUDED_ENTITY_TYPES })
```
then for each `e`: skip if `e.id === bot.id`; skip if `!e.isValid`; read every field inside a per-entity `try` (a throw skips that entity); skip if there is no `minecraft:health` component or `hp <= 0`.

`EXCLUDED_ENTITY_TYPES` (constant in `adapter/sense.ts`): `minecraft:item`, `xp_orb`, `xp_bottle`, `arrow`, `snowball`, `egg`, `ender_pearl`, `eye_of_ender_signal`, `fireball`, `small_fireball`, `dragon_fireball`, `wither_skull`, `wither_skull_dangerous`, `splash_potion`, `lingering_potion`, `thrown_trident`, `fishing_hook`, `shulker_bullet`, `llama_spit`, `wind_charge_projectile`, `breeze_wind_charge_projectile`, `fireworks_rocket`, `falling_block`, `tnt`, `tnt_minecart`, `minecart`, `chest_minecart`, `hopper_minecart`, `command_block_minecart`, `boat`, `chest_boat`, `leash_knot`, `painting`, `area_effect_cloud`, `lightning_bolt`, `evocation_fang`, `ender_crystal`, `armor_stand` (all with the `minecraft:` prefix).

Hurt and hit events (also in `adapter/sense.ts`):
```ts
/** Subscribes world.afterEvents.entityHurt (API-MAP B) once. Calls `cb` only when the victim or the attacker is a minecraft:player. */
export function subscribeHurts(cb: (r: HurtRecord) => void): void;
/** Subscribes world.afterEvents.entityHitEntity (API-MAP B) once. Calls `cb` only when hitEntity is a minecraft:player. */
export function subscribeHits(cb: (h: HitRecord) => void): void;
```
Per hurt event: `victim = ev.hurtEntity`, `attacker = ev.damageSource.damagingEntity`; if the attacker's `typeId` is in `EXCLUDED_ENTITY_TYPES` (a projectile), use the owner of `ev.damageSource.damagingProjectile` if readable, else leave `attacker` undefined and keep the record (victim player); API-MAP P17 decides whether the shooter is ever reported. Build `HurtRecord` (§5.5) reading `id`/`typeId` (readable when invalid) and `location` of the victim (try; else undefined). Drop the event unless `victim.typeId === "minecraft:player" || attacker?.typeId === "minecraft:player"`.
Per hit event: `HitRecord = { attackerId: ev.damagingEntity.id, victimId: ev.hitEntity.id, tick: system.currentTick }`; drop it unless `ev.hitEntity.typeId === "minecraft:player"`. A shield-blocked melee hit fires `entityHitEntity` even when no `entityHurt` follows, which is why S3's `mobAttackedAt` reads the hit log.

### 5.2 `Sensor` class (`src/game/bots/sensor.ts`, B3, engine-free)

```ts
export class Sensor {
  constructor(botId: BotId, name: string, sense: SensePort, provocation: ProvocationMemory, lookup: ColonyLookup, deps: { cfg: Phase3Config; kb: Knowledge });
  /** Every pump. */
  readSelf(now: Tick, hint: ObjectiveHint | undefined): SelfPercept | undefined;
  /** Every config.combat.scanEveryTicks / combatScanEveryTicks. */
  scan(now: Tick, self: SelfPercept, protectedIds: ReadonlySet<string>): void;
  /** Between scans: distance = dist3(selfPos, e.pos) for every entity and the warden; re-sorts entities. */
  refreshDistances(selfPos: Vec3): void;
  /** Players in the defend zone at the last scan (empty unless hint.kind === "defend"). */
  playersInZone(hint: ObjectiveHint | undefined): PlayerView[];
  /** §5.6. Cached for terrainEveryTicks; undefined when terrainEnabled is false or nothing was computed yet. */
  terrain(now: Tick, self: SelfPercept, probe: CellProbe): TerrainFacts | undefined;
  /** Percept.shieldDisabled (§5.3 step 10). */
  shieldDisabled(now: Tick): boolean;
  /** After death: forget previous positions, caches and the shield-disabled mark. */
  reset(): void;
  readonly entities: EntityPercept[];
  readonly warden: WardenPercept | undefined;
  readonly env: EnvPercept;
}
```

`readSelf(now, hint)`:
1. `raw = sense.readSelf()`; undefined → return undefined.
2. Effects: `effects = raw.effects`. If `cfg.combat.effectDurationCountsDown` is false: keep a map `effectSeen: typeId → { initial, seenAt }`; for each effect, if the typeId is absent from the map or its reported `duration > initial` (re-applied), store `{ initial: duration, seenAt: now }`; report `duration = max(0, initial - (now - seenAt))`; delete map entries for typeIds no longer present.
3. `hunger = raw.hunger ?? 20`, `saturation = raw.saturation ?? 5`, `hungerKnown = raw.hunger !== undefined && raw.saturation !== undefined`.
4. Booleans: `headInWater = WATER_IDS.includes(raw.headBlockId)`, `inLava = LAVA_IDS.includes(raw.feetBlockId) || LAVA_IDS.includes(raw.headBlockId)`, `inFireBlock = FIRE_IDS.includes(raw.feetBlockId)`, `onFire = raw.onFireTicks > 0`.
5. `airFrac = raw.airSupply !== undefined && raw.totalSupply ? clamp(raw.airSupply / (raw.totalSupply * 20), 0, 1) : undefined`.
6. `inventory = summarizeInventory(raw.inventory, cfg.body.preserveRemainingPoints)` and `equipment = equipmentView(raw.equipment, raw.inventory, raw.selectedSlot, raw.totalArmor)` (pure, §6.5).
7. `values = computeValueSummary(inventory, equipment, hint?.kind === "gather" ? { ids: hint.items.ids, required: hint.items.required } : undefined, deps.kb, cfg.combat)` (values.ts, B2; formulas TABLES §4.4–4.5, owned by S2a §4; recomputed at most once per scan, cached otherwise).
8. `lastDamage = provocation.lastDamageTo(botId)` (§5.5).

### 5.3 `scan(now, self, protectedIds)`

1. `raws = sense.scanEntities(self.pos, cfg.combat.scanRadius, cfg.combat.maxEntities)`, sorted by `dist3(self.pos, r.pos)` ascending, ties by `id` ascending.
2. `env = sense.env(self.headPos)` (before classification: `classify` needs `env.isDaylight`).
3. `since = now - cfg.combat.provokeMemoryTicks`; `bots = lookup.botIds()`.
4. `wardens = sense.findType("minecraft:warden", self.pos, cfg.combat.wardenSafeRadius)`; nearest → `warden = { id, pos, distance, targetingMe: r.targetId === botId || provocation.lastHurt(r.id, botId, since) !== undefined }`, else undefined.
5. For each raw `r`:
   - `distance = dist3(self.pos, r.pos)`.
   - `prev = prevSeen.get(r.id)`; `approaching = prev !== undefined && now - prev.tick <= 20 && dist3(prev.pos, self.pos) - distance >= cfg.combat.approachMinDelta`. This is the entity's own displacement toward the bot's current position: the bot walking toward a stationary mob does not count (the previous position is measured against the same bot position, so only the mob's own movement changes the difference).
   - `hurtMeAtTick = provocation.lastHurt(r.id, botId, since)`; `hurtByMeAtTick = provocation.lastHurt(botId, r.id, since)`.
   - `provoked` per §5.5.
   - `lightLevel = r.typeId === "minecraft:spider" ? sense.lightAt(r.pos) : undefined`.
   - `classification = classify({ typeId, families, isTamed, isBaby }, { provoked, isDaylight: env.isDaylight, lightLevel }, cfg.combat)` (§6).
   - `targetingMe` per §5.4. `inWater = r.inWater`.
   - `threatensProtected = (r.targetId !== undefined && protectedIds.has(r.targetId)) || provocation.lastHurtAny(r.id, protectedIds, since) !== undefined`.
   - Placeholders until `annotate` (§7.3): `relevance = "irrelevant"`, `inLeash = true`, `attackAllowed = false`.
6. Line of sight: walk the list in distance order; for the first `cfg.combat.maxLosRaysPerScan` entities whose classification is `threat` or `neutral_unprovoked`: `los = sense.lineOfSight(self.headPos, r.headPos)`; `lineOfSight = los ?? true`; `losChecked = los !== undefined`. Every other entity: `lineOfSight = true`, `losChecked = false`.
7. `prevSeen` = map of this scan's `{ pos: r.pos, tick: now }` per id (entities not seen this scan are dropped).
8. If `hint.kind === "defend"`: `zonePlayers = sense.playersNear(hint.center, hint.radius)` minus this bot; else `[]`.
9. `entities` = the built list, sorted by `distance` ascending, ties by `id` ascending; `env` stored.
10. Shield-disabled inference (only when `cfg.combat.shieldDisabledSource === "inferred"`): for each raw whose `typeId` is in `AXE_WIELDER_IDS`: `t = provocation.lastHurt(r.id, botId, since)`; if `t !== undefined`: `shieldDisabledUntil = max(shieldDisabledUntil, t + cfg.body.shieldDisableTicks)`. `shieldDisabled(now)` is `now < shieldDisabledUntil` when inferred, and `sense.shieldCooldownTicks(cfg.combat.shieldCooldownCategory) > 0` when `"cooldown_api"`. The inference assumes the shield was raised at the hit, which errs toward not relying on the shield.

Entity validity: the sensor stores only plain data; no engine handle survives a pump (API-MAP safe-usage rule 3). An entity that vanished simply isn't in the next scan. Between scans, `refreshDistances` keeps distances honest against the bot's own movement only, then re-sorts `entities` by `distance` ascending, ties by `id` ascending, so `entities[0]` is always the nearest.

### 5.4 `targetingMe`

```
targetingMe =
     r.targetId === botId                                     // Entity.target (beta, API-MAP A5)
  || hurtMeAtTick !== undefined                               // hurt me within provokeMemoryTicks
  || (classification === "threat" && distance <= cfg.combat.approachRadius && approaching)
```

### 5.5 Provocation memory (`src/core/combat/sense.ts`, pure, shared)

One instance lives in the runtime; `subscribeHurts` and `subscribeHits` feed it; every controller's sensor reads it. (S2's `BrainState` does **not** hold provocation memory; the brain reads `EntityPercept.provoked`, D4.)

```ts
export interface HurtRecord {
  tick: Tick;
  victimId: string;
  victimTypeId: string;
  victimPos?: Vec3;
  attackerId?: string;
  attackerTypeId?: string;
  cause: string; // EntityDamageCause
  damage: number;
}
export interface HitRecord {
  tick: Tick;
  attackerId: string;
  victimId: string;
}

export class ProvocationMemory {
  constructor(maxRecords: number); // cfg.combat.hurtLogMax, applied to the hurt log and to the hit log separately
  record(r: HurtRecord): void; // append; drop the oldest beyond maxRecords
  recordHit(h: HitRecord): void; // append; drop the oldest beyond maxRecords
  prune(now: Tick, keepTicks: Tick): void; // drop records (both logs) with now - tick > keepTicks
  /** Latest tick >= since where attackerId damaged victimId. */
  lastHurt(attackerId: string, victimId: string, since: Tick): Tick | undefined;
  /** Latest tick >= since where attackerId damaged any of victimIds. */
  lastHurtAny(attackerId: string, victimIds: ReadonlySet<string>, since: Tick): Tick | undefined;
  /** Latest tick >= since where a minecraft:player (bot or human) damaged victimId. */
  lastHurtByPlayer(victimId: string, since: Tick): Tick | undefined;
  /** Latest tick >= since where a player damaged an entity of `typeId` whose victimPos is within `radius` of `pos`. */
  lastPlayerHurtOfTypeNear(typeId: string, pos: Vec3, radius: number, since: Tick): Tick | undefined;
  /** Latest tick >= since of a melee hit attempt by attackerId on victimId (hit log; includes shield-blocked hits). S3's mobAttackedAt(mobId) = lastHit(mobId, botId, now - provokeMemoryTicks). */
  lastHit(attackerId: string, victimId: string, since: Tick): Tick | undefined;
  /** Latest record with victimId (any cause). */
  lastDamageTo(victimId: string): DamageRecord | undefined;
}
```

The runtime calls `prune(now, max(cfg.combat.provokeMemoryTicks, 200))` once per pump. A record at tick `t` is kept while `now - t <= keepTicks` and counts for a query while `t >= since`.

`provoked` for entity `r` seen by bot `B` (protected set `P`, colony bots `C`), all `since = now - provokeMemoryTicks`:
```
provoked =
     lastHurt(r.id, B, since)                 // it hurt me
  || lastHurtAny(r.id, P ∪ C, since)          // it hurt a protected player or any colony bot
  || lastHurtByPlayer(r.id, since)            // any player or bot hurt it (it retaliates)
  || (r.targetId === B && !NEUTRAL_NEVER_HIT.has(r.typeId))   // it is attacking me now
  || (GROUP_AGGRO.has(r.typeId)
      && lastPlayerHurtOfTypeNear(r.typeId, r.pos, cfg.combat.groupAggroRadius, since))
  (each lastX term: !== undefined)
```
`GROUP_AGGRO = { "minecraft:zombie_pigman", "minecraft:wolf", "minecraft:bee" }` (MOBS §2.2: group/pack aggro). A neutral mob that targets the bot is therefore fought back (`threat`), except the `NEUTRAL_NEVER_HIT` mobs, which keep their avoid / flee handling.

### 5.6 Terrain facts (`Percept.terrain`, D2)

`TerrainFacts` (type owned by S2b §0) has exactly the four fields the MOBS condition table reads: `groundFlat`, `lowCeilingWithin8`, `coverWithin8`, `roofWithin10` (all `boolean`). S1 computes them in `src/core/combat/sense.ts`:

```ts
/** feet = floor(self.pos). Counts every probe call; when `budget` runs out the remaining atoms take their fallback (groundFlat true, the others false). */
export function computeTerrain(probe: CellProbe, feet: Vec3, budget: number): TerrainFacts;
```
`y0 = feet.y`; a "column" `(x, z)` has cells `at = probe(x, y0, z)`, `up1 = probe(x, y0 + 1, z)`, `below = probe(x, y0 - 1, z)`; an undefined probe result never proves anything (it is skipped). Order of evaluation, with early exit on the first proof:
1. `groundFlat`: columns with `dx, dz ∈ [-3, 3]` (49 columns, at most 147 probes). Violation: `below` defined and `!below.isSolid`, or `at` solid and `up1` defined and not solid (a step up). `groundFlat = no violation` (MOBS: no ledge or slope within 3 blocks of the fight spot).
2. `coverWithin8`: columns with `dx, dz ∈ {-8, -6, …, 8}` excluding `(0, 0)`: true if `at` and `up1` are both solid (a 2-high block face). S3 `findCover` does the exact search; this atom is only the gate.
3. `lowCeilingWithin8`: same grid: true if `below` is solid, `at` and `up1` are non-solid and `probe(x, y0 + 2, z)` is solid (a 2-high space).
4. `roofWithin10`: columns with `dx, dz ∈ {-10, -8, …, 10}`: true if `at` and `up1` are non-solid and some `probe(x, y0 + k, z)`, `k = 2..6`, is solid.

The Sensor caches the result for `cfg.combat.terrainEveryTicks` (20) and returns undefined when `terrainEnabled` is false. The controller asks for it only while a relevant threat exists (§2.4a); otherwise the field is absent and S2b's fallbacks apply. Worked example: a bot on a flat grass field with a 1-block-wide trunk at `dx = 6, dz = 0` (solid at `y0` and `y0 + 1`) and leaves (solid) at `y0 + 4` for `dx = 4..8`, `dz = -2..2`. Step 1: all 49 columns have solid `below` and non-solid `at` → `groundFlat = true` (147 probes). Step 2: grid column `(6, 0)` has `at` and `up1` solid → `coverWithin8 = true`. Step 3: no grid column has a solid cell at `y0 + 2` → `lowCeilingWithin8 = false` (81 columns × at most 4 probes = 324). Step 4: grid column `(8, 0)` has `at`, `up1` non-solid and a solid cell at `y0 + 4` → `roofWithin10 = true`. The total stays below `terrainBlockBudget` (1600).

---

## 6. Classification (`src/core/combat/sense.ts`, pure, B1)

### 6.1 Lists (constants in `src/core/combat/mobs.ts`, B2 transcribes exactly these from MOBS §2)

```ts
export const NEVER_TARGET_ALWAYS: ReadonlySet<string>;   // MOBS 2.1 "always":
// player, villager_v2, villager, wandering_trader, iron_golem, snow_golem, copper_golem, allay, npc, armor_stand
export const NEVER_TARGET_IF_TAMED: ReadonlySet<string>; // MOBS 2.1 "only_if_tamed" (informational; §6.2 rule 3 checks every entity)
export const NEUTRAL_UNTIL_PROVOKED_IDS: ReadonlySet<string>;
// enderman, zombie_pigman, bee, wolf, polar_bear, llama, trader_llama, spider, piglin, goat, dolphin, panda, fox, pufferfish
// (cave_spider is NOT here: always hostile. iron_golem is NOT here: NEVER_TARGET.)
export const IGNORE_IDS: ReadonlySet<string>;            // MOBS 2.3, all 27 ids
```
(All ids carry the `minecraft:` prefix.)

In `sense.ts`:
```ts
/** Neutral mobs the bot never hits even when provoked: it only avoids/flees (MOBS 2.2 "never: hit"/"response: ignore/move away/sprint_away"). */
export const NEUTRAL_NEVER_HIT: ReadonlySet<string>;
// bee, llama, trader_llama, dolphin, panda, fox, pufferfish, polar_bear, goat
export const GROUP_AGGRO: ReadonlySet<string>; // §5.5
/** MOBS entries with engage_policy `flee` (the bot never fights them). Must equal the set of MOBS ids whose engage_policy is flee. */
export const FLEE_ONLY_IDS: ReadonlySet<string> = new Set([
  "minecraft:warden", "minecraft:piglin_brute", "minecraft:ravager",
  "minecraft:elder_guardian", "minecraft:wither", "minecraft:ender_dragon",
]);
/** Mobs whose melee hit disables a raised shield (axe wielders). Used by the inferred shield-disabled rule, §5.3 step 10. */
export const AXE_WIELDER_IDS: ReadonlySet<string> = new Set(["minecraft:vindicator", "minecraft:piglin_brute"]);
```

### 6.2 `classify`

```ts
export interface ClassifyFacts {
  typeId: string;
  families: readonly string[];
  isTamed: boolean;
  isBaby: boolean;
}
export interface ClassifyCtx {
  provoked: boolean;
  /** EnvPercept.isDaylight at scan time (D18). */
  isDaylight: boolean;
  /** Spiders only; undefined = unknown. Total light at the spider's feet (API-MAP A9, probe P15). */
  lightLevel?: number;
}
export function classify(e: ClassifyFacts, ctx: ClassifyCtx, cfg: CombatConfig): Classification;
```

Rules, first match wins:
1. `e.typeId === "minecraft:player"` or `e.families.includes("player")` → `never_target`. (Players, including every colony bot, ALWAYS.)
2. `NEVER_TARGET_ALWAYS.has(typeId)` → `never_target`.
3. `e.isTamed` → `never_target` (any entity type).
4. `typeId === "minecraft:zombie_pigman"` (zombified piglin): `ctx.provoked ? "threat" : "neutral_unprovoked"`. Never hit first: a `neutral_unprovoked` entity is never relevant (§7.3) and never `attackAllowed` (§6.4), even when it blocks the objective.
5. `typeId === "minecraft:spider"`: `ctx.provoked` → `threat`; else `ctx.isDaylight && ctx.lightLevel !== undefined && ctx.lightLevel >= cfg.spiderNeutralLight` → `neutral_unprovoked`; else `threat` (night, or unknown light = hostile). A night spider under open sky can report a high total light, so the daylight guard is mandatory (D18).
6. `NEUTRAL_UNTIL_PROVOKED_IDS.has(typeId)`: `ctx.provoked ? "threat" : "neutral_unprovoked"`.
7. `IGNORE_IDS.has(typeId)` → `ignore`.
8. `mobEntry(typeId) !== undefined` (MOBS §3 and §4 entries including `variants`; lookup in mobs.ts) → `threat`.
9. `e.families.includes("monster")` → `threat` (MOBS §6 default entry applies).
10. Otherwise → `ignore`.

### 6.3 Notes
- Name-tagged hostiles stay hostile (MOBS 2.1).
- Babies: same classification as adults.
- A wild wolf attacking a hostile mob is `neutral_unprovoked` (never a target). A tamed one is `never_target`. A wild wolf that targets the bot is `provoked` (§5.5) and becomes `threat`.

### 6.4 `attackAllowed`

```ts
export function attackAllowed(typeId: string, c: Classification): boolean;
```
`true` iff `c === "threat"` and `!NEUTRAL_NEVER_HIT.has(typeId)` and `!FLEE_ONLY_IDS.has(typeId)`. An entity with `attackAllowed === false` may still be fled from, shielded against, or avoided. It is the **only** gate on attacking: the combat executor (§3.7) starts an attacking tactic only when the target's `attackAllowed` is true on that pump, and S3's `attackTarget` re-checks the never-target list independently. Players, villagers, golems and tamed pets classify as `never_target`, so `attackAllowed` is false for them.

### 6.5 Inventory helpers (pure, `sense.ts`)

```ts
/** Attack damage in HP (MOBS §1.1; copper from S3 §5.1; may be changed by playtest). The single weapon table: S2a and S3 import it. */
export const WEAPON_DAMAGE: Readonly<Record<string, number>> = {
  "minecraft:wooden_sword": 4, "minecraft:golden_sword": 4, "minecraft:stone_sword": 5, "minecraft:copper_sword": 5,
  "minecraft:iron_sword": 6, "minecraft:diamond_sword": 7, "minecraft:netherite_sword": 8,
  "minecraft:wooden_axe": 3, "minecraft:golden_axe": 3, "minecraft:stone_axe": 4, "minecraft:copper_axe": 4,
  "minecraft:iron_axe": 5, "minecraft:diamond_axe": 6, "minecraft:netherite_axe": 7,
  "minecraft:wooden_pickaxe": 2, "minecraft:golden_pickaxe": 2, "minecraft:stone_pickaxe": 3, "minecraft:copper_pickaxe": 3,
  "minecraft:iron_pickaxe": 4, "minecraft:diamond_pickaxe": 5, "minecraft:netherite_pickaxe": 6,
  "minecraft:wooden_shovel": 1, "minecraft:golden_shovel": 1, "minecraft:stone_shovel": 2, "minecraft:copper_shovel": 2,
  "minecraft:iron_shovel": 3, "minecraft:diamond_shovel": 4, "minecraft:netherite_shovel": 5,
};
export function weaponDamage(typeId: string): number | undefined;
/** Rank of the tool kind: sword 3, axe 2, pickaxe 1, shovel 0.5; undefined if not in WEAPON_DAMAGE. */
export function weaponKind(typeId: string): number | undefined;
/** weaponDamage + 1.25 × level of enchant id "sharpness" in item.enchants (Bedrock, D20). undefined if not a weapon. */
export function weaponScore(item: ItemView): number | undefined;
/** "_helmet"/"turtle_helmet" → head, "_chestplate" → chest, "_leggings" → legs, "_boots" → feet; else undefined. */
export function armourSlotOf(typeId: string): ArmourSlot | undefined;
export function durabilityFrac(v: ItemView): number; // durability ? clamp((max - damage) / max, 0, 1) : 1
export function summarizeInventory(slots: ReadonlyArray<ItemView | undefined>, preserveRemainingPoints: number): InventorySummary;
export function equipmentView(
  eq: { head?: ItemView; chest?: ItemView; legs?: ItemView; feet?: ItemView; offhand?: ItemView },
  slots: ReadonlyArray<ItemView | undefined>, selectedSlot: number, totalArmor: number,
): EquipmentView;
```
`bestWeaponSlot`: among weapon slots that are usable (no durability, or `durability.max - durability.damage > preserveRemainingPoints`; the caller passes `cfg.body.preserveRemainingPoints`, default 2): max `weaponScore`; tie higher `weaponKind`; tie more remaining durability points (`max - damage`; no durability counts as infinite); tie lowest slot. S3's equipment manager decides what is actually equipped and uses this table and `weaponScore` for its own ranking (one table; S3 §5.1 holds no copy).

---

## 7. Objective relevance (pure, `sense.ts`)

### 7.1 Building the ObjectiveContext

```ts
export function buildObjective(
  hint: ObjectiveHint | undefined,
  botPos: Vec3,
  zonePlayers: ReadonlyArray<{ id: string; pos: Vec3 }>,
  cfg: CombatConfig,
): ObjectiveContext;
export function truncSegment(a: Vec3, b: Vec3, maxLen: number): Segment;
```
- `truncSegment(a, b, L)`: `d = dist3(a, b)`; if `d <= L` → `{ a, b }`; else `{ a, b: a + (b - a) · (L / d) }`.
- `hint` undefined → `{ kind: "idle", anchor: botPos }`.
- gather → `{ kind, anchor: botPos, target: hint.target, chest: hint.chest, corridor: hint.heading ? truncSegment(botPos, hint.heading, cfg.corridorMaxLen) : undefined }`.
- goto → `{ kind, anchor: botPos, target: hint.target, corridor: truncSegment(botPos, hint.target, cfg.corridorMaxLen) }`.
- defend → `{ kind, anchor: botPos, center, radius, protectedIds: zonePlayers ids, protectedPositions: zonePlayers positions }`.

| Kind | Objective points (blocking) | Corridor | Leash points | Leash limit |
|---|---|---|---|---|
| gather | `target` (if any), `chest` | `anchor → heading` (≤ 16) if heading | objective points + `anchor` | `leashBlocks` |
| goto | `target` | `anchor → target` (≤ 16) | `target`, `anchor` | `leashBlocks` |
| defend | none (rule 3 of `relevanceOf` handles the zone) | – | `center` | `radius + defendLeashExtra` |
| idle | none | – | `anchor` | `leashBlocks` |

```ts
/** gather: [target?, chest] (undefined omitted); goto: [target]; defend: []; idle: []. */
export function objectivePoints(o: ObjectiveContext): Vec3[];
/** gather: [target?, chest, anchor]; goto: [target, anchor]; defend: [center]; idle: [anchor]. */
export function leashPoints(o: ObjectiveContext): Vec3[];
export function leashLimit(o: ObjectiveContext, cfg: CombatConfig): number;
```
`protectedIdsOf(o: ObjectiveContext | undefined): ReadonlySet<string>` = `new Set(o?.kind === "defend" ? o.protectedIds : [])` (used by the scan, §2.4 step 5).

### 7.2 Geometry

```ts
export function dist3(a: Vec3, b: Vec3): number;
/** Distance from p to segment [a, b]. */
export function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number;
```
`distPointSegment`: `ab = b - a`; `L2 = ab·ab`; if `L2 < 1e-9` return `dist3(p, a)`; `t = clamp(((p - a)·ab) / L2, 0, 1)`; `c = a + t·ab`; return `dist3(p, c)`. All distances 3D.

### 7.3 `relevanceOf` and `annotate`

```ts
export function relevanceOf(e: EntityPercept, o: ObjectiveContext, cfg: CombatConfig): Relevance;
/** Sets relevance, inLeash and attackAllowed on every entity (mutates in place). */
export function annotate(entities: EntityPercept[], o: ObjectiveContext, cfg: CombatConfig): void;
```

`relevanceOf`, first match wins:
1. `e.classification !== "threat"` → `irrelevant`.
2. `threatening_me` if `e.targetingMe` or `e.hurtByMeAtTick !== undefined` (I hit it, it will come for me) or (`e.distance <= cfg.personalSpace` and `e.lineOfSight`).
3. `o.kind === "defend"`: `blocking_objective` if `dist3(e.pos, o.center) <= o.radius` or `e.threatensProtected`; else `irrelevant`.
4. `blocking_objective` if `dist3(e.pos, P) <= cfg.objectiveRadius` for any `P` in `objectivePoints(o)`.
5. `blocking_objective` if `o.corridor` and `distPointSegment(e.pos, o.corridor.a, o.corridor.b) <= cfg.corridorHalfWidth`.
6. `irrelevant`.

`annotate` sets, per entity: `relevance = relevanceOf(...)`, `inLeash = withinLeash(e.pos, o, cfg)`, `attackAllowed = attackAllowed(e.typeId, e.classification)` (§6.4).

### 7.4 Leash

```ts
export function leashDistance(pos: Vec3, o: ObjectiveContext): number; // min dist3(pos, P) over leashPoints(o)
export function withinLeash(pos: Vec3, o: ObjectiveContext, cfg: CombatConfig): boolean; // leashDistance <= leashLimit
export function nearestLeashPoint(pos: Vec3, o: ObjectiveContext): Vec3;
```

Leash rules (S2 scoring and S3 movement must follow them):
- L1. The brain may pick `attack` on a target only if `target.attackAllowed` and (`target.inLeash` or `target.distance <= cfg.combat.leashOverrideDist`).
- L2. S3 never issues a move whose destination has `withinLeash(dest) === false`. If the bot itself is outside the leash and no `threatening_me` entity is within `cfg.combat.leashOverrideDist` blocks, S3 moves toward `nearestLeashPoint(self.pos)` instead of chasing.
- L3. Retreat/flee/escape movement is exempt from the leash.

---

## 8. Cell helpers (pure, `sense.ts`)

```ts
export const HARMFUL_FLOOR_IDS: readonly string[] = [
  "minecraft:magma", "minecraft:campfire", "minecraft:soul_campfire", "minecraft:cactus",
  "minecraft:sweet_berry_bush", "minecraft:wither_rose", "minecraft:powder_snow",
];
/** Center of the cell's floor: { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }. The only way S1 turns a cell into a walking target. */
export function feetIn(cell: Vec3): Vec3;
```

### 8.1 `isStandable`

```ts
export function isStandable(probe: CellProbe, cell: Vec3, allowWaterFeet: boolean): boolean;
```
`cell` is integer. `below = probe(cell - y1)`, `feet = probe(cell)`, `head = probe(cell + y1)`. True iff all three are defined and:
- `below`: `isSolid && !isLiquid`, its id is not in `LAVA_IDS`, `SCULK_NOISE_IDS` or `HARMFUL_FLOOR_IDS`;
- `feet`: `!isSolid`; its id is not in `LAVA_IDS`, `FIRE_IDS` or `HARMFUL_FLOOR_IDS`; `isLiquid` is allowed only if `allowWaterFeet` and its id is in `WATER_IDS`;
- `head`: `!isSolid` and `!isLiquid` (water is never allowed in the head cell, for any caller); its id is not in `LAVA_IDS`, `FIRE_IDS` or `HARMFUL_FLOOR_IDS`.

### 8.2 `nearestCell`

```ts
export function nearestCell(from: Vec3, maxR: number, dys: readonly number[], accept: (cell: Vec3) => boolean): Vec3 | undefined;
```
`from` is integer. Visit order, first `accept` wins: increasing `r` from 1 to `maxR` (`r = 0` is never visited); then the index of `dy` in `dys` (so `[0, 1, -1, 2]` means +0, +1, -1, +2 in that order); then `dx` ascending (`-r..r`); then `dz` ascending (`-r..r`). Only cells with `max(|dx|, |dz|) === r` are visited; the candidate is `(from.x + dx, from.y + dy, from.z + dz)`. Budget: callers cap `maxR` at 6 (at most 13×13 cells × `dys.length` probes).

### 8.3 `snapToGround`

```ts
/** Cell (floor(x), y, floor(z)) for y from floor(centerY) + up down to floor(centerY) - down; the first isStandable(probe, c, false) gives feetIn(c). undefined = none. */
export function snapToGround(probe: CellProbe, x: number, z: number, centerY: number, up: number, down: number): Vec3 | undefined;
```
Used by the DefendExecutor (§4.4, `centerY` = `floor(task.center.y)`) and by the warden reflex (§9.3, `centerY` = `floor(self.pos.y)`).

---

## 9. Reflexes

Reflexes bypass the brain's scoring entirely. Priority (higher preempts lower): **lava > drowning > warden > fire**. A lower-priority trigger never preempts an active higher one. Body method names are those of S3 §1 `BodyActions` (S1 defines no body method).

### 9.1 Pure part (`sense.ts`)

```ts
export interface ReflexMemory {
  kind?: ReflexKind;
  since?: Tick;
  /** First tick of the current uninterrupted "exit condition holds" stretch. */
  clearSince?: Tick;
  headInWaterSince?: Tick;
  /** First tick of the current uninterrupted hazard stretch of `kind` (lava: self.inLava; drowning: self.headInWater). undefined = not in the hazard now. D28. */
  hazardSince?: Tick;
}
export interface ReflexInputs {
  self: SelfPercept;
  warden?: WardenPercept;
  /** Fire reflex only: a water cell was found within fireWaterSearchRadius at the last search (§9.3 "waterNearby"). */
  waterNearby: boolean;
}
export function stepReflex(mem: ReflexMemory, inp: ReflexInputs, now: Tick, cfg: CombatConfig): { active?: ReflexKind; mem: ReflexMemory };
/** D28. True only after a continuous hazard: see §9.4. */
export function reflexEscalates(mem: ReflexMemory, self: SelfPercept, now: Tick, cfg: CombatConfig): boolean;
```

`headInWaterSince` bookkeeping: if `self.headInWater`: `headInWaterSince ??= now`; else `headInWaterSince = undefined`.

### 9.2 Triggers and exits

`hasEffect(id)` = `self.effects.some(e => e.typeId === id)`. `recentCause(c, n)` = `self.lastDamage?.cause === c && now - self.lastDamage.tick <= n`.

| Kind | Trigger (enter) | Exit (all must hold continuously for the stated time) |
|---|---|---|
| lava | `self.inLava` or `recentCause("lava", 10)` | `!self.inLava` and not `recentCause("lava", 10)` for `cfg.lavaExitTicks` (20) |
| drowning | `recentCause("drowning", 40)`, or (`self.headInWater` and not `hasEffect("minecraft:water_breathing")` and not `hasEffect("minecraft:conduit_power")` and ((`headInWaterSince !== undefined` and `now - headInWaterSince >= cfg.drownHeadTicks` (200)) or (`self.airFrac !== undefined && self.airFrac <= cfg.drownAirFrac` (0.4)))) | `!self.headInWater` for `cfg.drownExitTicks` (60) |
| warden | (`warden !== undefined` and `warden.distance <= cfg.wardenFleeRadius` (32)) or `hasEffect("minecraft:darkness")` | `warden === undefined` (none within `wardenSafeRadius` 48) and no darkness effect, for `cfg.wardenClearTicks` (200) |
| fire | `self.onFire` and `!self.inWater` and `!hasEffect("minecraft:fire_resistance")` and (`self.inFireBlock` or `inp.waterNearby`) | `!self.onFire` or `self.inWater` or (`!self.inFireBlock` and `!inp.waterNearby`); immediate (0 ticks) |

The air term needs `headInWater`: a mis-scaled or stale `airFrac` can neither start the reflex nor hold it (the exit looks at `headInWater` only).

Algorithm of `stepReflex` (`hazardNow(k)` = `k === "lava" ? self.inLava : k === "drowning" ? self.headInWater : false`; `touchHazard(k)` = `hazardSince = hazardNow(k) ? (hazardSince ?? now) : undefined`):
1. Compute the trigger set `T` (rows above) and the `headInWaterSince` bookkeeping.
2. If `mem.kind` is set:
   - If some `k ∈ T` has higher priority than `mem.kind`: switch: `kind = k`, `since = now`, `clearSince = undefined`, `hazardSince = undefined`, then `touchHazard(k)`; return active `k`.
   - If the exit condition of `mem.kind` holds now: `clearSince ??= now`; if `now - clearSince >= exitTicks(kind)`: clear `kind/since/clearSince/hazardSince`, then fall to step 3. Else `touchHazard(kind)` and return active `mem.kind`.
   - Else `clearSince = undefined`, `touchHazard(kind)`, return active `mem.kind`.
3. If `T` is empty: return no reflex. Else `kind = highest priority in T`, `since = now`, `clearSince = undefined`, `hazardSince = undefined`, `touchHazard(kind)`; return it.

### 9.3 Reflex actions (controller, `runReflex(kind, self, now)`)

`probe` = `(p) => deps.world()?.blockAt(p)`.

**Preamble (every pump).**
- *Periodic actions.* "Every N ticks" means: run when `reflexTimers.<name> === undefined || now - reflexTimers.<name> >= N`, then set `reflexTimers.<name> = now`. A search stores its result in `reflexDest`; between searches the action `moveToward(reflexDest, 1.0, true)` repeats every pump.
- *New kind.* When `kind !== reflexKindActive` (first pump of a kind, including a switch): clear `reflexTimers` and `reflexDest`; `reflexKindActive = kind`; `body.stopBreaking()`; `body.stopEating()`; `body.lowerShield()`.
- *waterNearby maintenance* (runs in `tick` step 9 before `stepReflex`, in every layer): if `!self.onFire || self.inWater`: `waterNearby = false`, `fireWaterCell = undefined`. Else every 20 ticks (`reflexTimers.fireSearch`): `fireWaterCell = nearestCell(floor(self.pos), cfg.fireWaterSearchRadius, [0, -1, 1], c => WATER_IDS.includes(probe(c)?.typeId ?? ""))`; `waterNearby = fireWaterCell !== undefined`.

**lava**
1. Every 20 ticks (`lavaSearch`, and on entry): `dest = nearestCell(floor(self.pos), 3, [0, 1, -1, 2], c => isStandable(probe, c, true) && WATER_IDS.includes(probe(c)?.typeId ?? "")) ?? nearestCell(floor(self.pos), 5, [0, 1, -1, 2], c => isStandable(probe, c, true))`; `reflexDest = dest ? feetIn(dest) : undefined`.
2. If `reflexDest`: `body.setSprinting(true)`; `body.moveToward(reflexDest, 1.0, true)`; `body.jump()` every pump.
3. If none: `body.jump()` every pump and `B` = the newest breadcrumb with `probe(floor(B))?.typeId` not in `LAVA_IDS` and `dist3(B, self.pos) >= 2`; `body.moveToward(self.pos + 3·unit(B - self.pos), 1.0, true)`. With no such breadcrumb: `body.moveToward(self.pos + (0, 1, 0), 1.0, true)`.

**drowning**
1. Every pump: `body.jump()` (swim up).
2. Every 20 ticks (`shoreSearch`): `shore = nearestCell(floor(self.pos), 6, [0, 1, 2, -1], c => isStandable(probe, c, false))`; `reflexDest = shore ? feetIn(shore) : undefined`. If `reflexDest`: `body.moveToward(reflexDest, 1.0, true)` every pump.

**warden** (sneak away; MOBS warden + `flee_sneak`)
1. Every pump: if `warden?.targetingMe && warden.distance > cfg.wardenEscapeRadius`: `body.setSneaking(false)`; `body.setSprinting(true)` (MOBS `sprint_away`). Otherwise `body.setSprinting(false)`; `body.setSneaking(true)`. Darkness only (no `warden`) takes the second branch. (Targeting within `wardenEscapeRadius` triggers the escape in §2.4 step 10.)
2. Every `cfg.wardenRepathTicks` (40, `wardenPick`), or when within 2 blocks of the current flee point, pick a flee point `F`:
   - With a warden position `W`: from `breadcrumbs`, newest to oldest, the first `B` with `dist3(B, W) >= dist3(self.pos, W) + 4` and `dist3(B, self.pos) >= 8` and the cell at `floor(B)` (feet or below) not in `SCULK_NOISE_IDS`. If none: for the 8 compass directions `d` (N, NE, E, … at 45°), `P = self.pos + 12·d`, snapped with `snapToGround(probe, P.x, P.z, floor(self.pos.y), cfg.defend.groundSearchUp, cfg.defend.groundSearchDown)`; skip unsnappable points and points whose feet/below block is in `SCULK_NOISE_IDS`; pick the max `dist3(P, W)`; tie: the first in N, NE, E, SE, S, SW, W, NW order.
   - Darkness only (no `W`): the oldest breadcrumb with `dist3(B, self.pos) >= 8` (walk back the way it came). None → stand still (sneaking is silent).
3. After a pick: `body.navigateToward(F, 1.0)` (pathfinding; the speed while sneaking is a probe item, P6).

**fire**
1. Uses `fireWaterCell` / `waterNearby` of the maintenance step. If `fireWaterCell`: `body.moveToward(feetIn(fireWaterCell), 1.0, true)` every pump.
2. Else if `self.inFireBlock`: every 20 ticks (`fireSearch`) `dest = nearestCell(floor(self.pos), 3, [0, 1, -1], c => isStandable(probe, c, false))`; `reflexDest = dest ? feetIn(dest) : undefined`; if `reflexDest`: `body.moveToward(reflexDest, 1.0, true)` every pump.

### 9.4 Escalation to escape (survival bias, no cooldown)

While `layerKind === "reflex"` and not `escapePending`, after `runReflex`, `beginEscape(now)` (§3.6, which refuses while `escapeAvailable` is false) is called when:
- lava or drowning: `reflexEscalates(reflexMem, self, now, cfg)`;
- warden: the §2.4 step 10 rule, or `now - reflexMem.since >= cfg.wardenReflexMaxTicks` (1200); if `beginEscape` returns false in the second case, `reflexMem.since = now` and the flee continues.

`reflexEscalates` (pure): `mem.hazardSince !== undefined` and
- `mem.kind === "lava"`: `now - mem.hazardSince >= cfg.lavaEscapeTicks` (20);
- `mem.kind === "drowning"`: `now - mem.hazardSince >= cfg.drownEscapeTicks` (300) and `self.hp <= 10`;
- otherwise false.

The clock is the **continuous** hazard stretch (D28), not the reflex age: the exit needs 20 clear ticks, so the reflex age would exceed 20 on every ordinary lava touch. Worked example (pumps 4 ticks apart, `lavaEscapeTicks = 20`): in lava at ticks 100, 104, 108 (`hazardSince = 100`), out at 112 (`hazardSince = undefined`), in again at 116 (`hazardSince = 116`) and still in at 136: `136 - 116 = 20 >= 20` → escalate. The same bot that left lava at tick 112 for good never escalates (12 ticks continuous).

The reflex keeps moving the body until S4 disconnects the bot.

---

## 10. Config keys (S1)

`config.combat` (contract writer merges into `Phase3Config` in `src/core/config.ts`). The type of this table is `CombatConfigS1`; `CombatConfig = CombatConfigS1 & CombatConfigS2b & CombatConfigS2a` = `Phase3Config["combat"]` (S2a §9.1, D30). S1 owns every key in this table; S2a, S2b and S3 only read them (S2b deletes its duplicate `scanRadius` row).

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `scanEveryTicks` | 8 | ticks | Full entity scan cadence in IDLE / TASK |
| `combatScanEveryTicks` | 4 | ticks | Full entity scan cadence in combat / reflex (every pump) |
| `scanRadius` | 24 | blocks | Entity scan radius around the bot's feet |
| `maxEntities` | 32 | count | `closest` cap of the entity query |
| `maxLosRaysPerScan` | 8 | count | Line-of-sight rays per scan (nearest threat/neutral first) |
| `provokeMemoryTicks` | 300 | ticks | Window for hurt-based provocation and the `targetingMe` fallback |
| `hurtLogMax` | 512 | records | Size cap of the shared ProvocationMemory (hurt log and hit log each) |
| `groupAggroRadius` | 16 | blocks | Group anger radius for GROUP_AGGRO types (may be changed by playtest) |
| `approachRadius` | 6 | blocks | "Approaching while hostile" counts as targeting within this distance |
| `approachMinDelta` | 0.4 | blocks | The entity's own displacement toward the bot between two scans that counts as approaching (§5.3). Scans are 4 or 8 ticks apart; a walking zombie covers about 0.9 to 1.7 blocks in that time |
| `spiderNeutralLight` | 12 | light level | Spider is neutral in daylight at or above this light at its feet (may be changed by probe P15 and playtest) |
| `personalSpace` | 4 | blocks | A visible hostile this close is `threatening_me` |
| `objectiveRadius` | 6 | blocks | A hostile this close to an objective point is `blocking_objective` |
| `corridorHalfWidth` | 3 | blocks | A hostile this close to the path corridor is `blocking_objective` |
| `corridorMaxLen` | 16 | blocks | Corridor segment length cap from the anchor |
| `leashBlocks` | 16 | blocks | Max distance of a chased target from the nearest leash point |
| `leashOverrideDist` | 3.5 | blocks | A target this close to the bot stays attackable outside the leash (L1, L2) |
| `defendLeashExtra` | 4 | blocks | Defend leash = zone radius + this |
| `resumeCalmTicks` | 60 | ticks | Calm time without a `threatening_me` entity before the task resumes (only if the episode saw a threat) |
| `calmMaxTicks` | 600 | ticks | Longest stay in CALM; after it the task is forced to resume even while a `threatening_me` entity remains (D27) |
| `recoverHp` | 16 | HP | RECOVER ends when HP reaches this |
| `recoverMaxTicks` | 1200 | ticks | Max natural-regen wait in RECOVER without food |
| `escapeRetryTicks` | 200 | ticks | After S4 refuses an escape or the flow fails before the disconnect, don't request again for this long (throttle only; a successful escape has no cooldown, ROADMAP) |
| `handoffTimeoutTicks` | 400 | ticks | HANDOFF longer than this is aborted like a failed escape (T17b) |
| `breadcrumbEveryTicks` | 20 | ticks | Breadcrumb sampling period |
| `breadcrumbMax` | 30 | count | Breadcrumbs kept (newest) |
| `wardenFleeRadius` | 32 | blocks | Warden within this → warden reflex |
| `wardenSafeRadius` | 48 | blocks | Warden query radius; reflex exits when none within it |
| `wardenClearTicks` | 200 | ticks | Warden-free and darkness-free time to exit |
| `wardenEscapeRadius` | 10 | blocks | Warden targeting the bot within this → escape-rejoin |
| `wardenRepathTicks` | 40 | ticks | Flee point re-pick period |
| `wardenReflexMaxTicks` | 1200 | ticks | A warden reflex older than this tries an escape-rejoin; if refused it restarts its clock |
| `lavaExitTicks` | 20 | ticks | Out of lava this long to exit |
| `lavaEscapeTicks` | 20 | ticks | **Continuous** lava contact this long → escape-rejoin (D17, D28). Lava kills an unarmoured 20 HP bot in about 50 ticks, so 60 was lethal |
| `drownHeadTicks` | 200 | ticks | Head under water this long → drowning reflex |
| `drownAirFrac` | 0.4 | fraction | Air supply at or below this with the head under water → drowning reflex (if readable) |
| `drownExitTicks` | 60 | ticks | Head out of water this long to exit |
| `drownEscapeTicks` | 300 | ticks | **Continuous** head-under-water this long and HP ≤ 10 → escape-rejoin |
| `fireWaterSearchRadius` | 4 | blocks | Water search radius for the fire reflex |
| `terrainEnabled` | true | bool | false: `Percept.terrain` is never set (S2b fallbacks apply) |
| `terrainEveryTicks` | 20 | ticks | Minimum spacing between two terrain computations (§5.6) |
| `terrainBlockBudget` | 1600 | count | Max `probe` calls per terrain computation |
| `useTargetApi` | true | bool | false: the adapter never reads `Entity.target`; `targetId` is always undefined (S6 probe `target`) |
| `effectDurationCountsDown` | true | bool | false: the sensor replaces `EffectView.duration` by `initial - (now - firstSeenTick)` (§5.2 step 2) (S6 probe `hunger`) |
| `shieldDisabledSource` | `"inferred"` | `"inferred" \| "cooldown_api"` | How `Percept.shieldDisabled` is derived (§5.3 step 10) (S6 probe `shielddisabled`) |
| `shieldCooldownCategory` | `""` | string | Category passed to `Player.getItemCooldown` when `shieldDisabledSource === "cooldown_api"` |

Keys read from other groups: `config.body.shieldDisableTicks` (S6, 100), `config.body.equipBusyThreatDist` (S3, 6), `config.combat.countRadius`, `hissProxyEnabled`, `hissProxyDist`, `fleeDefaultHp` (S2b/S3).

`config.defend` (`DefendConfig`, §4.4). `Phase3Config` gains `defend: DefendConfig` (the Lead adds it to PHASE3-SPEC §4); the executor reads it through `ExecutorContext.defend`:

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `patrolStepBlocks` | 6 | blocks | Arc length between patrol waypoints |
| `patrolRadiusFrac` | 0.6 | fraction | Patrol circle radius = zone radius × this |
| `minPatrolRadius` | 3 | blocks | Lower clamp of the patrol radius |
| `dwellTicks` | 60 | ticks | Wait at each waypoint |
| `badWaypointRetryTicks` | 1200 | ticks | A failed waypoint is skipped for this long |
| `groundSearchUp` | 4 | blocks | Ground snap search above the center Y |
| `groundSearchDown` | 6 | blocks | Ground snap search below the center Y |
| `allBadWaitTicks` | 200 | ticks | Hold at the center before retrying when every waypoint failed |
| `startPositionTimeoutTicks` | 200 | ticks | Bot position unreadable this long at `start` → failed `timeout` |

---

## 11. Runtime wiring (`src/game/runtime.ts`, B3)

`BotEntry` becomes `{ controller: BotController; body: CombatBody; equipment: EquipmentManager; name; respawnAt?; respawnAttempts; lastStatusKey?: string; lastStatusAt: Tick }`; `executor` and `lastProgress` move into the controller. Numbered in call order; every line lives in `runtime.ts` unless a file is named.

**Startup** (`start()`, each line inside `guard(...)`):
1. `initBodyEvents()` once (S3 §1, `adapter/body.ts`).
2. `provocation = new ProvocationMemory(cfg.combat.hurtLogMax)`; `subscribeHurts(r => provocation.record(r))` and `subscribeHits(h => provocation.recordHit(h))` (`adapter/sense.ts`, §5.1, §5.5).
3. One subscription per engine event, fanned out here (no other module subscribes on its own). `entityItemPickup` for a bot id → `entry.equipment.markDirty("pickup")` and `snapshot.markDirty(name, "pickup", now)`. `playerInventoryItemChange` for a bot id, only when `cfg.snapshot.inventoryEvent === "all"` → `snapshot.markDirty(name, "inventory", now)` (S4a §6.1).
4. `lookup: ColonyLookup` = `{ home: () => colony.home(), owner: id => ownerPercept(id), botIds: () => set of registered bot ids }`. `ownerPercept` maps the record's `owner` (`PlayerRef`) to `{ id, name, online, pos? }`: `online` and `pos` from the player list; `pos` only if the owner is in the bot's dimension. Recomputed once per pump (step 10), not per call.
5. `combatDebugs: Map<lowerName, CombatDebug>` (§11.1).

**Per bot** (`register(rawPlayer, name, worker)`: spawn, adopt, rejoin after summon or escape):
6. `sense = createSensePort(rawPlayer, name)`; `spawnBot` / `wrapSimulatedPlayer` additionally return it (the contract writer changes `SpawnResult` to `{ ok: true; body; sense }`).
7. `body = wrapCombatBody(rawPlayer, name, worker, cfg.body)` (`adapter/body.ts`).
8. `equipment = new EquipmentManager({ body, world, cfg: cfg.body, colonyChest: () => colony.chest(), notify: n => emit({ kind: "botNotice", now: t, name, botId, notice: n }), onChanged: () => snapshot.markDirty(name, "equip", t), botName: name })`; `equipment.markDirty("spawn")`. After a restore the S4 service calls `markDirty("rejoin")` (S3 CR-5).
9. `new BotController(deps, init, now)` with `ControllerDeps` built from the above (`sink` emits `taskProgress` / `taskReport` exactly as Phase 2's `emitProgress` / `stepBot`; `brain` is the `decide` binding of S2b §1; `chooseFood` and `onBotDeath` as in §2.1). `init` is `{ carry }` for an escape rejoin and `{ stats }` for a reload / summon rejoin that has stored stats, otherwise `undefined` (§2.3). Then `snapshot.markDirty(name, "spawn", now)`.
10. `contextFor(body)` adds `defend: cfg.defend` and `onChestTransfer: () => snapshot.markDirty(name, "chest", t)`; `GatherExecutor` calls `ctx.onChestTransfer?.()` after each settled deposit or withdrawal (§4.2).

**Per pump** (`pump()`, order fixed):
11. Lifecycle pass (unchanged Phase 2 code); `provocation.prune(t, max(cfg.combat.provokeMemoryTicks, 200))`; compute the `ColonyLookup` values once.
12. For each live bot: `controller.tick(t)` (replaces `stepBot`). The equipment manager is ticked inside the controller (§2.4 step 8).
13. The snapshot service pump (S4b §3) runs after all controllers.
14. `botStatus` push, per live controller: `view = controller.status()`; `key = JSON.stringify([view.layer, view.option, view.target?.typeId, Math.round(view.hp), Math.round(view.hunger), view.recovering, view.gear])`. Emit `{ kind: "botStatus", now: t, botId, status: view }` when (`key !== entry.lastStatusKey` and `t - entry.lastStatusAt >= cfg.colony.statusPushTicks`) or `t - entry.lastStatusAt >= cfg.colony.statusHeartbeatTicks`; then store `lastStatusKey = key`, `lastStatusAt = t`. The core only reads info newer than `statusStaleTicks` (S5 §5).

**Events and effects:**
15. `assign` effect → `controller.assign(task, now())`; `cancel` effect → `controller.cancel(taskId, now())`.
16. `onEntityDie` → `id = controller.onDeath(t)`; emit `taskReport failed bot_died` for `id` if defined (unchanged path).
17. `removeBot` → `controller.dispose("removed")`.
18. `ColonyRuntime.botStatus(botId): BotStatusView | undefined` → `controller.status()`.
19. `BotDirectory` (S4b §1.2) for the snapshot service: `layerOf` → `controller.layer()`; `taskIdOf` → `controller.currentTaskId()`; `lastActiveTick` → `controller.lastActiveTick()`; `dispose(botId, reason)` → `controller.dispose(reason)`; `onEscapeFailed` → `controller.onEscapeFailed(now)`; `registerRejoined(bot, init, now)` → steps 6 to 9 with `init`; the service brackets every leave / restore flow of a bot with `controller.setFlowActive(true)` and `setFlowActive(false)` (§2.2), which suspends and resumes that bot's `EquipmentManager` (S3 CR-5).
20. Test hooks, **TEST-ONLY** (compiled only when `__TEST__` is defined; S6 C3): `testReset(): void` and `combatDebug(botName: string): CombatDebug`.

### 11.1 `CombatDebug` (S6 C4, `src/game/bots/controller.ts`)

```ts
export interface CombatDebug {
  attackCalls: Record<string, number>; // per target entity id: attackTarget results "hit" or "cooldown"
  guardRejects: number;                // attackTarget results "invalid", "out_of_reach", "no_los"
  shieldUpTicks: number;               // +4 for every pump where body.shieldState() === "up"
  eats: number;                        // +1 per EatRunner "done"
  escapes: number;                     // +1 per beginEscape that returned true
  dismisses: number;                   // +1 per dispose("dismissed")
  decisions: Partial<Record<OptionKind, number>>; // +1 per final decision of tick() step 13
  tactics: TacticName[];               // unique, order of first start
}
```
The controller increments these through `deps.debug` (the runtime's entry of `combatDebugs`, keyed by lowercase bot name so it survives a rejoin; `undefined` outside tests). `attackCalls` / `guardRejects` are counted by a wrapper around `body.attackTarget` that the controller passes to the combat executor. Counters that S4 / S6 add (`excludedDropped`, `summons`) are owned by those sections.

---

## 12. File ownership additions

| File | Owner | Note |
|---|---|---|
| `src/game/adapter/sense.ts` (new) | B3 | `createSensePort`, `subscribeHurts`, `subscribeHits`, `EXCLUDED_ENTITY_TYPES`. Imports `@minecraft/server` only. |
| `src/game/bots/sensor.ts`, `controller.ts`, `percept.ts` (`buildPercept`, new), `combat-executor.ts` (new, §3.7), `defend-executor.ts` | B3 | |
| `src/core/combat/sense.ts` | B1 | Everything marked "pure, sense.ts" in this file, including `computeTerrain`, `snapToGround`, `reflexEscalates`, `stepReflex` |
| `src/core/combat/mobs.ts` lists of §6.1 | B2 | Exact contents above |
| `src/core/combat/values.ts` `computeValueSummary(inv, eq, objective, kb, cfg)` | B2 (formulas S2a §4) | Signature fixed by S2a (D22): `objective?: { ids: readonly string[]; required: number }` |
| `src/core/combat/knowledge.ts` (S2a, D22) | B2 | `Knowledge` (`kb.mob`, `kb.food`, `kb.value`); built by the runtime and passed as `ControllerDeps.kb` / `Sensor` deps |

---

## 13. Test cases for S6 to adopt (TC-B1 / TC-B3)

- classify: player → never_target; tamed wolf → never_target; wild wolf unprovoked → neutral_unprovoked, provoked → threat; wild wolf with `targetId === botId` → threat; zombie_pigman unprovoked next to the gather target → neutral_unprovoked and relevance irrelevant; spider in daylight at light 15 → neutral, in daylight at light 4 → threat, at night (`isDaylight = false`) at light 15 → threat, light unknown → threat; cow → ignore; unknown `monster` → threat; provoked bee → threat with `attackAllowed = false`; warden → threat, `attackAllowed = false`.
- `TC-B1-attackAllowed-protected`: `attackAllowed` is false for player, villager, iron golem, tamed wolf, tamed cat (all classify to `never_target`) and for a threat in `FLEE_ONLY_IDS`; the combat executor never calls `attackTarget` for an entity whose `attackAllowed` is false on that pump.
- relevance: zombie 3 blocks away with LoS → threatening_me; same behind a wall (los false, losChecked) → not via personal space; zombie 5 blocks from the target block → blocking_objective; zombie 2.5 blocks off the corridor middle → blocking; 4 blocks off → irrelevant; corridor truncated at 16 blocks; defend zone membership; `distPointSegment` with a zero-length segment; `objectivePoints` per kind (§7.1).
- `TC-B1-leash-L1/L2/L3`: target 17 blocks from every leash point → `inLeash = false`; exactly 16 → true; defend uses radius + 4; a target at 3.5 blocks stays attackable outside the leash, at 3.6 does not.
- `TC-B1-provocation-expiry`: a record at tick `t` counts at `now = t + 300` and not at `t + 301`; `lastHit` likewise; the cap drops the oldest record.
- `TC-B1-nearestCell-blocked`: ring order, `dys` order and tie order of §8.2; a ring with only unloaded cells returns undefined. `TC-B1-isStandable-lava-above`: lava in the head cell → false; magma below → false; water feet with `allowWaterFeet` → true, water head → false.
- `TC-B1-approaching`: a bot walking 3 blocks toward a stationary zombie → `approaching = false`; a zombie moving 1 block toward a stationary bot → true.
- `TC-B1-terrain`: `computeTerrain` on a flat 7×7 floor → `groundFlat` true; a 2-deep hole at 3 blocks → false; cover / low ceiling / roof atoms against hand-built grids; the probe budget is never exceeded and the result stays deterministic.
- reflex: priority lava > drowning > warden > fire; warden exit only after 200 continuous clear ticks (a warden reappearing at tick 150 resets the timer); drowning by head timer at exactly 200 ticks; drowning does not trigger with Water Breathing; `TC-B3-reflex-exit`: each §9.2 exit fires at its numeric threshold (lava 20, drowning 60, warden 200, fire 0); `TC-B1-reflex-escalation` (D28): in lava for 12 ticks, out for 4, in again for 12 → no escalation (continuous run 12 < 20); in lava for 20 continuous ticks → `reflexEscalates` true; a lava reflex that resolved in 16 ticks never escalates.
- controller: T5 pauses the gather executor and `step` is not called while paused (I1); T8→T12 resumes after 60 ticks; a `threatening_me` entity at tick 30 of CALM restarts the wait; a `blocking_objective` threat outside the leash does not (D27); T10b forces the resume at 600 ticks in CALM; T19 cancel during combat leaves FIGHT and goes to IDLE after calm; T21 death reports `bot_died` once; topup eat resumes with 0 wait; assign during combat creates a paused executor; escape refusal re-runs the brain with `escapeAvailable = false` and discards the first brain state; escape rejoin builds a controller in RECOVER with no executor, and the later `assign` creates a paused one (D26); `assign` with the same task id replaces silently (H4); `TC-B3-recover-enter-exit`: RECOVER ends at `hp >= recoverHp`, at timeout and when food and regen are both unavailable; `TC-B3-freeze-objective`: the corridor and anchor do not move while chasing (I3); `TC-B3-priority-order`: a reflex pre-empts COMBAT, COMBAT pre-empts TASK; `TC-B3-percept-throw-defaults`: each unreadable source of §2.4a yields its listed default; `TC-B3-handoff-timeout`: 401 ticks in HANDOFF calls `abortEscape(…, "timeout")` and goes to CALM; `TC-B3-escape-retry`: after `onEscapeFailed` the next escape request is made no earlier than `escapeRetryTicks` later (and the brain runs with `escapeAvailable = false` in between); `TC-B3-combat-exec`: each row of the §3.7 table starts the listed runner or body call, a failed `start` follows handoff then the D15 fallback order, and feedback is visible for exactly one pump.
- executors: GatherExecutor pause in `break` stops breaking, keeps `delivered`/`held`, resume → `scan` with the candidate not blacklisted; pause in `collect` resumes in `collect`; deadline shifted by the paused time; `setAvoidZones` makes the scan skip candidates inside an active zone; GotoExecutor resume re-paths; DefendExecutor never reports done, skips bad waypoints, waypoint count `max(4, ceil(2π·rp/6))`.

---

## 14. Open questions and risks (with chosen fallbacks)

| # | Risk | Chosen fallback |
|---|---|---|
| R1 | `Entity.target` (beta) may not report a SimulatedPlayer, or may disappear (probe P8) | `targetingMe` also uses hurt-within-window and approaching-within-6 (§5.4); the adapter returns undefined on any throw; `combat.useTargetApi = false` disables the read |
| R2 | `airSupply` is beta and its unit is not documented; the API-MAP row for `minecraft:breathable` is unverified (D20) | `airFrac` assumes ticks (`totalSupply` seconds × 20); the drowning trigger needs `headInWater`, so a wrong unit cannot hold the reflex on; if the row is dropped `airFrac` stays undefined and the head-in-water timer plus the `drowning` damage cause remain |
| R3 | Whether `jump()` makes a SimulatedPlayer swim up, and whether sneaking slows `navigateToward` (probe P6) | Drowning also walks to the nearest shore cell; drowning and lava escalate to escape-rejoin (§9.4) |
| R4 | The new entity after an escape-rejoin has a new id | Identity mapping is S4's; S1 only defines the carry and the recover start (§3.6) |
| R5 | Unfiltered `entityHurt` fires often (burning mobs) | The adapter drops events where neither side is a player before building a record; memory capped at 512 and pruned per pump |
| R6 | The 32-closest cap can be filled by passives near farms | Accepted for Phase 3; `maxEntities` is config |
| R7 | Entity positions are up to 8 ticks stale in IDLE/TASK | Scans run every pump once in combat; reflexes use self data read every pump |
| R8 | Spider light semantics (total light vs sky light) and the group-aggro radius are unverified (probe P15) | Spiders are neutral only when `isDaylight && lightLevel >= spiderNeutralLight` (D18); unknown light = hostile; keys `spiderNeutralLight` (12) and `groupAggroRadius` (16) |
| R9 | Terrain atoms of the MOBS condition grammar | Closed by D2: the sensor computes `Percept.terrain` (§5.6); with `terrainEnabled = false` or a failure the field is absent and S2b applies its fallbacks (`groundFlat` true, the other three false) |
| R10 | Paths during the warden flee may cross sculk blocks (only the destination cell is checked) | Accepted; sneaking makes walking over sensors silent |
| R11 | `is_ignited` meaning is unverified (probe P7) | `isIgnited` is reported raw; MOBS `dist_below: 3` proxy is S2/S3's |
| R12 | Shield-disabled state may not be readable (probe P14) | `shieldDisabledSource = "inferred"`: after a hit by an axe wielder the shield counts as disabled for `body.shieldDisableTicks` (§5.3 step 10) |
| R13 | A refused or failed escape could be retried every pump | `escapeRetryTicks` throttle after a refusal or a failed flow; no throttle after a completed escape (ROADMAP: no cooldown) |
| R14 | S4 may not answer a hand-off (flow stuck) | `handoffTimeoutTicks` (400) aborts through `abortEscape(botId, "timeout")` (S4 must treat it as idempotent) and the controller returns to CALM |
| R15 | Copper tool damage values (1.21.9+) are guesses | Kept from S3 §5.1 (copper sword 5, axe 4, pickaxe 3, shovel 2); playtest may change them |

---

## Revision log (review pass 1)

Decisions applied (DECISIONS.md, binding):
- D2: applied (§1 optional `Percept.terrain/canBlock/shieldDisabled/objectiveItemIds/tacticFeedback`, `EntityPercept.inWater`; §5.6 `computeTerrain`; §2.4a fills them). Field names of `TerrainFacts` follow D2 and MOBS (`coverWithin8`, `lowCeilingWithin8`, `roofWithin10`, `groundFlat`); S2b §0 currently writes `hasCoverWithin8` etc., so the S2b reviser must align.
- D4: applied (ProvocationMemory stays in S1, §5.5; brain reads `EntityPercept.provoked`).
- D11: applied (`ReflexBody`/`ControllerBody` deleted; `CombatBody` from S3; member list in §2.1).
- D12: applied (`buildPercept` §2.4a; §11 rewritten with snapshot dirty hooks, `botStatus` push, `botNotice` wiring).
- D13: applied (§3.7 Decision to runner/body table, failure handling, D15 fallback chain).
- D17: applied (`lavaEscapeTicks` 20). D18: applied (`ClassifyCtx.isDaylight`, spider rule, P15 referenced in R8). D20: applied (breadcrumb row cites API-MAP A13 with an undefined fallback; sharpness is S3's; honey_bottle is S3's).
- D21 H2/H4: applied (`ControllerCarry`/`ControllerInit` per S4b §11.1; `assign` replaces a same-id executor silently).
- D22: applied (`Percept.eating`; `computeValueSummary(inv, eq, objective, kb, cfg)`; `knowledge.ts` row in §12). The S2b/Lead parts of D22 are not S1's.
- D25: applied (`BotStatusView` is S5's shape). D26: applied (no task in the carry; one owner, the core). D27: applied (CALM holds only for `threatening_me`; `calmMaxTicks` 600; T10/T10a/T10b). D28: applied (`hazardSince`, `reflexEscalates`, §9.4 worked example).

S1-stack-sensing--precision.md:
- #1: changed (T10b added; `calmEnterAt`; hold guard is `threatening_me` only per D27, so the deadlock cannot occur; `calmMaxTicks` is in `config.combat`)
- #2: applied (T10a) / #3: applied (T1 says "any (including HANDOFF)") / #4: applied (`nextScanAt`, `lastObjective`, `protectedIdsOf` in §7.1)
- #5: applied (private-state table is complete, with a reset-on-death column) / #6: applied (`runRecover(now, decision, percept)`, `lastEatDecision` built field by field)
- #7: applied (`escapeAvailable` formula in §3.6 and step 13) / #8: applied (r1/r2 brain-state handling in step 13) / #9: applied (`FLEE_ONLY_IDS`, checked against MOBS engage_policy flee)
- #10: applied / #11: applied (`HARMFUL_FLOOR_IDS`) / #12: applied (nearestCell order) / #13: applied (warden sneak/sprint rule every pump)
- #14: applied (timer rule, `reflexTimers`, `reflexDest`) / #15: applied / #16: applied / #17: applied (`snapToGround` with `centerY`)
- #18: applied (water breathing and conduit power) / #19: applied (`lastBreadcrumbTick`) / #20: changed (superseded by D26: `exportCarry` has no task) / #21: applied (steps reordered)
- #22: applied (`leashOverrideDist`) / #23: applied / #24: applied (Ph caption and rule) / #25: applied (`startPositionTimeoutTicks`, resume shifts only `bad[]`)
- #26: applied ("verify" removed in three places) / #27: applied (`waterNearby` reset when not burning)

S1-stack-sensing--consistency.md:
- #1: applied (D25) / #2: applied (D26) / #3: applied (`Knowledge`, `CombatConfig` in `BrainFn`) / #4: applied (2-arg bound `onBotDeath`)
- #5: changed (uses S2b's existing `FoodChoice` instead of a new local type; the S2b binding line 151 must return the `FoodChoice`, not `.typeId`)
- #6: applied (`setAvoidZones`, `activeNoGo`, called in `leaveCombat`) / #7: applied (`subscribeHits`, `HitRecord`, `recordHit`, `lastHit`) / #8: applied (`equipment` dep, tick at step 8, fan-out in §11)
- #9: applied (`ItemView.enchants`; S3 renames its `EquipmentView` itself) / #10: skipped (no S1 change: S1 already applies `hunger ?? 20`, `saturation ?? 5`; S3 and S6 must align to `undefined`)
- #11: applied (single `WEAPON_DAMAGE` with pickaxes, shovels, copper; usable means above `preserveRemainingPoints`) / #12: applied (`HomeRef`)
- #13: changed (Phase3Config gains `defend`: stated in §10 for the Lead; `colony` keys are S5's) / #14: applied (four S6 keys in §10; `testReset`/`combatDebug`/`CombatDebug` in §11) / #15: applied (S3 names everywhere)
- #16: skipped (S1 keeps `approachRadius` 6; the API-MAP line is for its reviser) / #17: applied (S1 owns `scanRadius`; S2b deletes its row)

S1-stack-sensing--game-api.md:
- #1: applied / #2: applied / #3: applied / #4: applied (copper rows, no "verify") / #5: applied (projectile shooter rule, P17) / #6: applied (`isDaylight` comment) / #7: changed ("verify" replaced by "may be changed by probe P15 and playtest")

S1-stack-sensing--logic.md:
- #1: applied (D28; `hazardSince` is stricter than `clearSince`, because a short gap shorter than the exit time must also reset the clock) / #2: applied (D27)
- #3: changed (the air term needs `headInWater`; the exit stays `!headInWater` for 60 ticks, because "airFrac undefined" as an exit would flicker the reflex off and on)
- #4: applied (entity displacement; `approachMinDelta` 0.4) / #5: applied (`targetId === botId` provokes) / #6: applied
- #7: changed (D26/H4: the rejoin builds no executor; `assign` with the same id replaces silently) / #8: changed (I3 holds from the first tick; idle objective built in step 6)
- #9: skipped (T17 never ran in the reflex layer; the controller already owns the phase; clarified in `failEscape`) / #10: applied / #11: applied (`onDeath` reset column)
- #12: applied (`wardenReflexMaxTicks`) / #13: skipped (T1 is a reflex trigger row; relevance classes do not apply) / #14: applied

S1-stack-sensing--completeness.md:
- #1: changed (§2.4a table; `protectedIdsOf` follows precision #4 and the Defend-only doc comment; `feetIn` is a position helper, not a material)
- #2: applied / #3: applied / #4: applied (§11 rewritten) / #5: applied (D2)
- #6: changed (D2 wins: S2b's atoms, fallbacks and `terrainEnabled` key; sensor computes them)
- #7: skipped (superseded by D25: S5's current `BotStatusView` replaced the list the finding quotes)
- #8: skipped (conflicts with ROADMAP/S4b: the throttle applies after a refusal or a failed flow only; a completed escape has no cooldown; test `TC-B3-escape-retry` added)
- #9: applied (`handoffTimeoutTicks`, T17b, abortEscape reason `"timeout"`) / #10: applied (§13) / #11: applied (re-sort)
- #12: skipped (`defendLeashExtra` stays in `config.combat` with value 4, read by S2a/S3 under that name; `config.defend` documented in §10)
- #13: applied (`attackAllowed` as the only gate; `TC-B1-attackAllowed-protected`)
- #14: skipped (a new S5 message id is not decidable here; S5 Q11 is open; `dispose` already aborts the escape safely)

Hand-offs to other documents (not edits here):
- S4b: `ControllerInit = { carry?, stats? }` and `ControllerCarry = { brainState, recover, objectiveItemIds?, stats? }` are now in S1 §1; S4b must call `controller.setFlowActive(true|false)` around every leave/restore flow; treat `abortEscape(botId, "timeout")` as idempotent; `lastActiveTick()` exists on the controller.
- S2b: `TerrainFacts` field names (D2); the runtime `chooseFood` binding returns a `FoodChoice` (not `.typeId`); delete the `scanRadius` row; provocation stays out of `BrainState`.
- S3: rename its `EquipmentView` to `EquippedStacks`; delete its weapon table copy (use S1 `WEAPON_DAMAGE`, `weaponScore`); adapter returns `hunger`/`saturation` as undefined on a failed read; `ctx.mobAttackedAt` reads `ProvocationMemory.lastHit`.
- S6: `saturation` fallback text; new keys of §10; probe P15 (light) and the `CombatDebug` shape of §11.1.
- API-MAP: row A13 (`minecraft:breathable`), the `entityHitEntity` use (row exists), probe P15, probe P17.
