# S1: priority stack, BotController, executor pause/resume, sensing, classification, relevance, reflexes

Owner of: `Percept`, `SelfPercept`, `EntityPercept`, `Classification`, `Relevance`, `ObjectiveContext`, `LayerKind` (PHASE3-SPEC §4) and the `TaskExecutor` pause/resume change (§4 "Executor contract change").
Builders: **B1** (pure parts in `src/core/combat/sense.ts`), **B3** (`controller.ts`, `sensor.ts`, `defend-executor.ts`, pause/resume in `gather-executor.ts` / `goto-executor.ts`, `runtime.ts`, `registry.ts`, and the new adapter file `src/game/adapter/sense.ts`, see §12).
Contract writer: every type and interface in code blocks below goes into the file named above the block.

Conventions used everywhere in this file:
- Distances are blocks, times are ticks (20 per second). `dist3(a, b)` = 3D Euclidean distance. "Pump" = one runtime interval (4 ticks).
- "Window" = `now - tick <= config.combat.provokeMemoryTicks`.
- Every `config.*` name is listed with its default in §10.
- Block ids: `LAVA_IDS = ["minecraft:lava", "minecraft:flowing_lava"]`, `WATER_IDS = ["minecraft:water", "minecraft:flowing_water"]`, `FIRE_IDS = ["minecraft:fire", "minecraft:soul_fire"]`, `SCULK_NOISE_IDS = ["minecraft:sculk_sensor", "minecraft:calibrated_sculk_sensor", "minecraft:sculk_shrieker"]` (constants in `src/core/combat/sense.ts`).

---

## 1. Types (`src/core/combat/types.ts`, pure)

```ts
import type { BotId, PlayerId, Task, TaskKind, TaskProgress, Tick, Vec3 } from "../types.js";

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
  /** Sum of enchantment levels (minecraft:enchantable). 0 / absent = none. */
  enchantLevelSum?: number;
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
  duration: number; // ticks, as reported (API-MAP A10: count-down semantics unverified)
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
  /** Distance fell by >= config.combat.approachMinDelta since the previous scan (<= 20 ticks ago). */
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
}

export interface WardenPercept {
  id: string;
  pos: Vec3;
  distance: number;
  targetingMe: boolean;
}

export interface PlaceRef {
  dimensionId: string;
  pos: Vec3;
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
  /** timeOfDay < 12000 || timeOfDay >= 23000. */
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
  home?: PlaceRef;
  owner?: OwnerPercept;
  env: EnvPercept;
  /** Nearest warden within config.combat.wardenSafeRadius, if any. */
  warden?: WardenPercept;
  /** Controller layer when the percept was built. */
  layer: LayerKind;
  taskKind?: TaskKind;
  /** The controller is in combat phase "recover" (§3). */
  recovering: boolean;
  /** false while the snapshot service refused an escape (§3.6). The brain must not pick escape_rejoin then. */
  escapeAvailable: boolean;
}

/** Block facts for pure cell tests (same shape as the game's BlockInfo). */
export interface BlockFacts {
  typeId: string;
  isAir: boolean;
  isSolid: boolean;
  isLiquid: boolean;
}
export type CellProbe = (pos: Vec3) => BlockFacts | undefined;

/** Status for `!status` (S5 renders it). */
export interface GearPiece {
  typeId: string;
  durabilityPct: number; // round(durabilityFrac * 100)
}
export interface BotStatusView {
  botId: BotId;
  layer: LayerKind;
  combatPhase?: CombatPhase; // layer === "combat" only
  reflex?: ReflexKind; // layer === "reflex" only
  /** Last decision's option (combat layer only). */
  option?: string; // OptionKind (S2)
  /** typeId of the last decision's target, if any. */
  targetTypeId?: string;
  targetDistance?: number;
  hp: number;
  maxHp: number;
  hunger: number;
  gear: {
    weapon?: GearPiece; // mainhand if it is a weapon, else best weapon slot
    shield?: GearPiece; // offhand
    armour: Partial<Record<ArmourSlot, GearPiece>>;
    totalArmor: number;
  };
  taskId?: string;
  taskPaused: boolean;
  /** Relevant threats (relevance !== "irrelevant") at the last scan. */
  threatCount: number;
}

/** Carried across an escape-rejoin (§3.6). */
export interface ControllerCarry {
  task?: Task;
  progress?: TaskProgress;
  brainState: unknown; // BrainState (S2); typed as BrainState by the contract writer
}
```

---

## 2. BotController (`src/game/bots/controller.ts`, B3)

One controller per live bot. It replaces `BotEntry.executor` / `lastProgress` in `runtime.ts` (§11) and owns the bot's `TaskExecutor`, the sensor, the reflex memory, the brain state and the combat executor.

### 2.1 Dependencies

```ts
import type { BotId, Task, TaskFailReason, TaskId, TaskProgress, Tick, Vec3 } from "../../core/types.js";
import type { BotStatusView, ControllerCarry, LayerKind, Percept, SelfPercept } from "../../core/combat/types.js";
import type { BrainState, Decision } from "../../core/combat/types.js"; // S2
import type { MobKnowledge } from "../../core/combat/types.js"; // S3 shape
import type { Phase3Config } from "../../core/config.js";
import type { ProvocationMemory } from "../../core/combat/sense.js";
import type { TaskExecutor } from "./executor.js";
import type { SensePort, WorkerBody, WorldPort } from "./ports.js";

/** Subset of S3's BodyActions the controller's reflexes use. BodyActions must contain these exact members. */
export interface ReflexBody {
  stop(): void; // stopMoving
  stopBreaking(): void;
  stopUsingItem(): void;
  lowerShield(): void;
  setSneaking(on: boolean): void;
  setSprinting(on: boolean): void;
  /** Straight-line moveToLocation(pos, { faceTarget: true }) (API-MAP C). */
  moveTo(pos: Vec3): void;
  jump(): boolean;
}
export type ControllerBody = WorkerBody & ReflexBody;

/** S3's combat executor, as the controller uses it. */
export interface CombatExecutor {
  /** Execute one pump of `decision`. Idempotent for a repeated identical decision (e.g. an eat in progress continues). */
  run(decision: Decision, percept: Percept, now: Tick): void;
  /** Stop all combat body activity: stop moving, lower shield, stopUsingItem, sneak off, sprint off. */
  halt(): void;
  /** Forget internal state without touching the body (after death). */
  reset(): void;
  /** An eat started by run() has not completed or been abandoned yet. */
  busyEating(): boolean;
}

export type BrainFn = (p: Percept, s: BrainState, kb: MobKnowledge, cfg: Phase3Config) => { decision: Decision; brainState: BrainState };

/** S4's snapshot service, as the controller uses it. */
export interface SnapshotHandle {
  /**
   * Start the escape flow for this bot (S4 owns everything after this call). `carry` is read by S4 right
   * before the disconnect. Returns false if S4 refuses (e.g. a flow is already running for this bot).
   */
  requestEscape(botId: BotId, now: Tick, carry: () => ControllerCarry): boolean;
  /** The bot can no longer escape (died, disposed). Idempotent. */
  abortEscape(botId: BotId, reason: "bot_died" | "disposed"): void;
}

/** Read-only colony facts, computed by the runtime once per pump. */
export interface ColonyLookup {
  home(): import("../../core/combat/types.js").PlaceRef | undefined;
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
  body: ControllerBody;
  sense: SensePort; // §5.1
  world: () => WorldPort | undefined;
  brain: BrainFn; // S2 decide()
  kb: MobKnowledge;
  newBrainState: () => BrainState; // S2
  /** S2: record the loss for outcome stats and clear commitment. */
  onBotDeath: (s: BrainState, now: Tick) => BrainState;
  /** S2/TABLES §3: food typeId for a situation, or undefined. */
  chooseFood: (situation: "pre_engage_heal", self: SelfPercept) => string | undefined;
  combat: CombatExecutor;
  /** createExecutor(EXECUTORS, task, contextFor(body)) bound by the runtime. */
  createExecutor: (task: Task) => TaskExecutor;
  snapshot: SnapshotHandle;
  provocation: ProvocationMemory; // shared by all controllers (§5.5)
  lookup: ColonyLookup;
  sink: ControllerSink;
  cfg: Phase3Config;
}

export interface ControllerInit {
  /** Set by the runtime when this controller replaces one that escaped (§3.6). */
  carry?: ControllerCarry;
  /** Start in combat phase "recover" (escape rejoin only). */
  recover?: boolean;
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
  /** S4: the escape flow failed before the disconnect; the bot is still here. */
  onEscapeFailed(now: Tick): void;
  /** S4 reads this (through the callback given to requestEscape) right before the disconnect. */
  exportCarry(): ControllerCarry;

  /** Stop everything and never act again. §2.3. */
  dispose(reason: "removed" | "dismissed" | "escaped"): void;

  status(): BotStatusView;
  currentTaskId(): TaskId | undefined;
  layer(): LayerKind;
}
```

Private state (exact names, B3):

| Field | Type | Initial |
|---|---|---|
| `layerKind` | `LayerKind` | `"idle"` (or see init) |
| `phase` | `CombatPhase \| undefined` | `undefined` |
| `calmSince` | `Tick \| undefined` | `undefined` |
| `episodeHadThreat` | `boolean` | `false` |
| `needsRecover` | `boolean` | `init.recover === true` |
| `recoverSince` | `Tick \| undefined` | `undefined` |
| `escapePending` | `boolean` | `false` |
| `escapeBlockedUntil` | `Tick` | `0` |
| `executor` | `TaskExecutor \| undefined` | from carry |
| `lastProgress` | `TaskProgress \| undefined` | `carry.progress` |
| `frozenObjective` | `ObjectiveContext \| undefined` | `undefined` |
| `reflexMem` | `ReflexMemory` (§9.1) | `{}` |
| `brainState` | `BrainState` | `carry.brainState ?? newBrainState()` |
| `lastDecision` | `Decision \| undefined` | `undefined` |
| `sensor` | `Sensor` (§5) | new |
| `breadcrumbs` | `Vec3[]` (ring, newest last) | `[]` |
| `disposed` | `boolean` | `false` |

### 2.3 Lifecycle

| Event | Who calls | Controller action |
|---|---|---|
| `botRegistered` (spawn, adopt) | runtime `register()` | `new BotController(deps, undefined, now)`; layer `idle`. |
| Rejoin after `!summon` / `!dismiss` / Save & Quit restore | runtime, when S4's flow registers the bot again | `new BotController(deps, undefined, now)`; layer `idle`. |
| Rejoin after an escape | runtime, when S4 reports the escaped bot respawned | `new BotController(deps, { carry, recover: true }, now)` (§3.6). |
| `botRemoved` (invalid, couldn't respawn) | runtime `removeBot()` | `dispose("removed")` then drop. |
| `!dismiss` / idle self-dismiss | S4 service, after the snapshot is written | `dispose("dismissed")` then drop. |
| Escape completed (bot disconnected) | S4 service | `dispose("escaped")` then drop. |

`dispose(reason)`:
1. If `disposed`: return. Set `disposed = true`.
2. If `executor`: `executor.cancel()` (no report), `executor = undefined`.
3. `combat.halt()`; `body.setSneaking(false)`.
4. If `escapePending` and `reason !== "escaped"`: `snapshot.abortEscape(botId, "disposed")`.

The core requeues the task on `botRemoved` (Phase 2 behaviour, unchanged). For `"escaped"`, the task is carried (§3.6); identity mapping between the old and new entity is S4's.

### 2.4 `tick(now)` algorithm

Every step is inside one `try`; on a throw: `logError`, `combat.halt()`, and return (the runtime's per-bot isolation stays).

1. If `disposed`: return.
2. `hint = executor?.objectiveHint()`.
3. `self = sensor.readSelf(now, hint)` (§5.2). If `undefined`: return (the runtime removes invalid bots).
4. Breadcrumbs: if `layerKind !== "reflex"` and `now % config.combat.breadcrumbEveryTicks < 4` and (`breadcrumbs` is empty or `dist3(last, self.pos) >= 2`): push `self.pos`; keep the newest `config.combat.breadcrumbMax`.
5. Scan: if `now >= nextScanAt`: `sensor.scan(now, self, protectedIdsOf(objective))` (§5.3); `nextScanAt = now + (layerKind === "combat" || layerKind === "reflex" ? config.combat.combatScanEveryTicks : config.combat.scanEveryTicks)`. Otherwise `sensor.refreshDistances(self.pos)`.
6. Objective: if `frozenObjective` is set, `objective = frozenObjective`; if it is `defend`, replace `protectedIds`/`protectedPositions` with the sensor's latest players-in-zone. Else `objective = buildObjective(hint, self.pos, sensor.playersInZone(hint), cfg)` (§7.1).
7. `annotate(sensor.entities, objective, cfg)` (§7.3): fills `relevance`, `inLeash`, `attackAllowed`.
8. Warden escape (bypasses the brain): if `sensor.warden` and `warden.targetingMe` and `warden.distance <= config.combat.wardenEscapeRadius` and not `escapePending` and `now >= escapeBlockedUntil`: `beginEscape(now)` (§3.6). Continue.
9. Reflex: `{ active, mem } = stepReflex(reflexMem, reflexInputs(self, sensor.warden, now), now, cfg)` (§9); `reflexMem = mem`.
   - If `active`: if `layerKind !== "reflex"`: `enterReflex(now)`. Then `runReflex(active, self, now)` (§9.3). Also the escalation rule of §9.4. Return.
   - Else if `layerKind === "reflex"`: `exitReflex(now)`.
10. If `escapePending`: return (handoff: no brain, no task; the body was halted in `beginEscape`).
11. Brain: `percept = buildPercept(...)`; `{ decision, brainState } = brain(percept, brainState, kb, cfg)`. If `decision.option === "escape_rejoin"`:
    - `beginEscape(now)`; if it returned true: return.
    - Else rebuild the percept with `escapeAvailable = false` and call `brain` once more; use that result.
    Store `lastDecision = decision`.
12. `isCombat = decision.option !== "resume_task" && decision.option !== "idle"`; `relevantThreat = entities.some(e => e.classification === "threat" && e.relevance !== "irrelevant")`.
13. Dispatch on `layerKind` exactly as the transition table in §3.2 (rows T1–T14). In short:
    - `idle` / `task` with `isCombat`: `enterCombat(now)`, `combat.run(decision, percept, now)`.
    - `task` without `isCombat`: `stepExecutor(now)` (§2.6).
    - `idle` without `isCombat`: nothing.
    - `combat`: per phase (§3.2).

Helpers (private, exact behaviour):
- `enterCombat(now)`: `frozenObjective ??= objective` (the one built in step 6); if `executor` and not `executor.isPaused()`: `executor.pause(now)`; `layerKind = "combat"`; `phase = "fight"`; `calmSince = undefined`; `episodeHadThreat = relevantThreat`.
- `leaveCombat(now)`: `combat.halt()`; `frozenObjective = undefined`; `episodeHadThreat = false`; `phase = undefined`; `calmSince = undefined`; if `executor`: `executor.resume(now)`, `layerKind = "task"`; else `layerKind = "idle"`.
- `enterReflex(now)`: `frozenObjective ??= objective`; if `executor` and not paused: `executor.pause(now)`; `combat.halt()`; `body.stopBreaking()`; `layerKind = "reflex"`.
- `exitReflex(now)`: `body.stop()`; `body.setSneaking(false)`; `body.setSprinting(false)`; `layerKind = "combat"`; `phase = escapePending ? "handoff" : "calm"`; `calmSince = now`; `episodeHadThreat = true`.

### 2.5 Colony effects routed through the controller

`assign(task, now)`:
1. If `executor`: log a warning (as Phase 2 does) and `executor.cancel()`.
2. `executor = createExecutor(task)`; `lastProgress = undefined`.
3. If `layerKind === "combat"` or `"reflex"`: `executor.pause(now)` immediately (it is never stepped until `leaveCombat`). If `frozenObjective` is set, rebuild it from the new executor's hint and the frozen `anchor` (keep the anchor).
4. Else `layerKind = "task"`.

`cancel(taskId, now)`:
1. If `executor?.taskId !== taskId`: return.
2. `executor.cancel()`; `executor = undefined`; `lastProgress = undefined`.
3. If `layerKind === "task"`: `layerKind = "idle"`. In `combat` / `reflex`: stay; `leaveCombat` later goes to `idle`. If `frozenObjective` is set: replace it with `{ kind: "idle", anchor: frozenObjective.anchor }`.

`onDeath(now)`:
1. `id = executor?.taskId`; `executor = undefined` (no `cancel()`: the body is dead; same as Phase 2); `lastProgress = undefined`.
2. `combat.reset()`; `reflexMem = {}`; `frozenObjective = undefined`; `phase = undefined`; `needsRecover = false`; `layerKind = "idle"`.
3. If `escapePending`: `snapshot.abortEscape(botId, "bot_died")`; `escapePending = false`.
4. `brainState = onBotDeath(brainState, now)`.
5. Return `id`. The runtime emits `taskReport failed bot_died` for it (existing death path). The runtime does not tick the controller while the bot is dead (`respawnAt` set); after respawn the controller continues in `idle`.

### 2.6 `stepExecutor(now)` (moved from `runtime.stepBot`, semantics unchanged)

1. `r = executor.step(now)`; if it throws: `logError`, `executor.cancel()`, `r = failed("error")`.
2. `p = executor.progress()` (catch → skip). If `p` and it differs from `lastProgress` (same comparison as Phase 2 `sameProgress`): `lastProgress = {...p}`; `sink.progress(botId, taskId, {...p}, now)`.
3. If `r.kind === "running"`: return.
4. `executor = undefined`; `lastProgress = undefined`; `layerKind = "idle"`; `sink.done(...)` or `sink.failed(..., r.reason, ...)`.

Progress is only emitted after a `step()`. A paused executor's progress cannot change, so nothing is lost.

### 2.7 `status()`

Built from the latest `self`, `lastDecision` and sensor:
- `layer = layerKind`; `combatPhase = phase` when `layer === "combat"`; `reflex = reflexMem.kind` when `layer === "reflex"`.
- `option = lastDecision?.option` and `targetTypeId`/`targetDistance` from the entity with `id === lastDecision?.targetId` (only while `layer === "combat"`).
- `hp`, `maxHp`, `hunger` from `self`.
- `gear.weapon`: `equipment.mainhand` if its typeId is in `WEAPON_DAMAGE`, else the `bestWeaponSlot` item, else absent. `gear.shield = equipment.offhand` if it is `minecraft:shield`. `gear.armour` from `equipment.head/chest/legs/feet`. `durabilityPct = Math.round(durabilityFrac * 100)`.
- `taskId = executor?.taskId`; `taskPaused = executor?.isPaused() ?? false`; `threatCount` = relevant threats at the last scan.
- Before the first `tick` (no `self` yet): `hp = 20`, `maxHp = 20`, `hunger = 20`, empty gear.

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
- I3. `frozenObjective !== undefined` exactly when `layerKind` is `combat` or `reflex`.
- I4. The brain runs only when not in REFLEX and not `escapePending`.
- I5. `combat.run()` is called only in FIGHT and RECOVER.

### 3.2 Transition table

"Brain combat" = `isCombat` (§2.4 step 12). "Brain calm" = option is `resume_task` or `idle`. Reflex rows are evaluated before brain rows every pump.

| # | State | Event / trigger | Guard | Action | Next |
|---|---|---|---|---|---|
| T1 | any except HANDOFF-without-reflex-need | reflex trigger (§9.2) | – | `enterReflex(now)`; `runReflex` | REFLEX(k) |
| T2 | REFLEX(k) | higher-priority trigger | – | switch kind; `runReflex` | REFLEX(k') |
| T3 | REFLEX(k) | exit condition of k (§9.2), no other trigger | – | `exitReflex(now)` | HANDOFF if `escapePending`, else CALM |
| T4 | IDLE | brain combat | – | `enterCombat`; `combat.run` | FIGHT |
| T5 | TASK | brain combat (e.g. threat appears while gathering) | – | `enterCombat` (pauses executor); `combat.run` | FIGHT |
| T6 | TASK | brain calm | – | `stepExecutor` | TASK, or IDLE on done/failed |
| T7 | FIGHT | brain combat | – | `combat.run`; `episodeHadThreat ||= relevantThreat` | FIGHT |
| T8 | FIGHT | brain calm | – | `combat.halt()`; `calmSince = now` | CALM |
| T9 | CALM | brain combat | – | `phase = "fight"`; `calmSince = undefined`; `combat.run` | FIGHT |
| T10 | CALM | brain calm | `relevantThreat` | `calmSince = now` (restart the wait) | CALM |
| T11 | CALM | brain calm | no relevant threat and `now - calmSince >= need`, `need = episodeHadThreat ? config.combat.resumeCalmTicks : 0`, and `needsRecover` | `phase = "recover"`; `recoverSince = now` | RECOVER |
| T12 | CALM | brain calm | same as T11 but not `needsRecover` | `leaveCombat(now)` (resumes executor) | TASK if executor else IDLE |
| T13 | RECOVER | brain combat, option ≠ `eat` | – | `phase = "fight"`; `combat.run` (`needsRecover` stays true) | FIGHT |
| T14 | RECOVER | otherwise | – | `runRecover(now)` (§3.5) | RECOVER, or via `leaveCombat` to TASK / IDLE |
| T15 | any non-REFLEX | brain picks `escape_rejoin` | `requestEscape` returns true | `beginEscape` (§3.6) | HANDOFF |
| T16 | any | warden targeting me within `wardenEscapeRadius` (§2.4 step 8) | not `escapePending`, `now >= escapeBlockedUntil` | `beginEscape` | HANDOFF (or REFLEX(warden) with `escapePending`) |
| T17 | HANDOFF | `onEscapeFailed(now)` | – | `escapePending = false`; `escapeBlockedUntil = now + config.combat.escapeRetryTicks`; `phase = "calm"`; `calmSince = now` | CALM |
| T18 | HANDOFF | S4 disconnects the bot | – | `dispose("escaped")` | (gone) |
| T19 | any | colony `cancel` for the current task (incl. during combat) | task id matches | `executor.cancel()`; drop it; TASK → IDLE, others stay | same layer |
| T20 | any | colony `assign` | – | §2.5; paused at once unless IDLE/TASK | TASK if it was IDLE/TASK, else same |
| T21 | any | bot death | – | `onDeath` (§2.5): task fails `bot_died` through the existing path | IDLE (after respawn) |
| T22 | any | `dispose` | – | §2.3 | (gone) |

Cases the task list asked about, by row:
- Threat appears while gathering: T5. The gather executor is paused (§4.2), the combat executor fights.
- Fight ends: T8 then T12 after `resumeCalmTicks` with no relevant threat.
- Executor finishes while paused: impossible (I1). `GatherExecutor.step()` and `GotoExecutor.step()` additionally return `running` without touching the body if called while paused (§4.1, defensive).
- Task cancelled by the colony during combat: T19. The bot keeps fighting; when calm it goes to IDLE.
- Bot death during combat: T21.
- `escape_rejoin` chosen: T15, then §3.6.

### 3.3 Brain eating without threats (topup)

`eat` is a combat option. A topup eat in TASK goes T5 → FIGHT. Because no relevant threat was seen, `episodeHadThreat` is false and T12's `need` is 0: the task resumes on the first calm pump after the eat completes.

### 3.4 Objective freezing

The ObjectiveContext is built from the executor's hint while in IDLE/TASK, and frozen on entering combat or a reflex (I3). Chasing therefore never drags the corridor or anchor with the bot, and the leash (§7.4) is measured from where the fight started.

### 3.5 RECOVER (`runRecover(now)`)

Only entered after an escape rejoin (`needsRecover`). Each pump in RECOVER (after the brain returned calm or `eat`):
1. If `self.hp >= config.combat.recoverHp`: `needsRecover = false`; `leaveCombat(now)`. Done.
2. If `combat.busyEating()`: `combat.run(lastEatDecision, percept, now)` (continue); return.
3. `food = decision.option === "eat" && decision.foodTypeId ? decision.foodTypeId : chooseFood("pre_engage_heal", self)`.
4. If `food`: `lastEatDecision = { option: "eat", foodTypeId: food }` (other Decision fields per S2 defaults); `combat.run(lastEatDecision, percept, now)`; return.
5. No food: if `self.hunger >= 18` (natural regen, TABLES §1) and `now - recoverSince < config.combat.recoverMaxTicks`: `combat.halt()` once (stand still); return.
6. Otherwise (no food and no regen, or timed out): `needsRecover = false`; `leaveCombat(now)`.

### 3.6 Escape hand-off (S4 owns the flow)

`beginEscape(now): boolean`:
1. `ok = snapshot.requestEscape(botId, now, () => this.exportCarry())`.
2. If `!ok`: `escapeBlockedUntil = now + config.combat.escapeRetryTicks`; return false.
3. `escapePending = true`. If `layerKind` is not `reflex`: `enterCombat(now)` if not already in combat, then `phase = "handoff"`; `combat.halt()`; `body.stopBreaking()`. The executor stays paused (never cancelled: the core still sees the task as active). Return true.

`exportCarry()` returns `{ task, progress, brainState }`:
- `task`: `executor?.task`. For a gather task: `{ ...task, delivered: progress.delivered }` (immutably rebuilt) so the new executor starts from the delivered count. `held` items come back with the snapshot restore.
- `progress`: `executor?.progress()`.

After the rejoin, the runtime constructs `new BotController(deps, { carry, recover: true }, now)`:
1. `brainState = carry.brainState`.
2. If `carry.task`: `executor = createExecutor(carry.task)`; `executor.pause(now)`; `lastProgress = carry.progress`.
3. `layerKind = "combat"`; `phase = "recover"`; `recoverSince = now`; `needsRecover = true`; `episodeHadThreat = false`; `frozenObjective = buildObjective(executor?.objectiveHint(), <first readable self.pos>)` (built on the first tick).
4. RECOVER runs (§3.5): eat/regen until `hp >= recoverHp` or no food, then the task resumes (`executor.resume`).

---

## 4. TaskExecutor change (`src/game/bots/executor.ts`, contract writer)

```ts
import type { ObjectiveHint } from "../../core/combat/types.js";

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
}

export interface ExecutorContext {
  body: WorkerBody;
  world(): WorldPort | undefined;
  gather: GatherConfig;
  /** Phase 3 (DefendExecutor). */
  defend: DefendConfig; // = config.defend (§10)
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
- Ground snap (lazy, cached per waypoint, re-done when a waypoint's bad mark expires): for `y` from `floor(center.y) + groundSearchUp` down to `floor(center.y) - groundSearchDown`, cell `c = (floor(x), y, floor(z))`; the first `isStandable(probe, c, false)` (§8.1) gives the waypoint `feetIn(c)`. None → the waypoint is bad.
- Start index `k0`: the waypoint whose angle is nearest to `atan2(bot.z - center.z, bot.x - center.x)`.
- Direction: increasing `k` (wrapping), skipping bad waypoints.

State machine:

| State | Event | Guard | Action | Next |
|---|---|---|---|---|
| start | step | `ctx.world()` undefined | – | failed `error` |
| start | step | bot position unreadable for 200 ticks | – | failed `timeout` |
| start | step | position readable | compute geometry, `k = k0`; `walker = new Walker(body, wp[k])` | walk |
| walk | walker `walking` | – | – | walk |
| walk | walker `arrived` | – | `body.stop()`; `dwellUntil = now + dwellTicks` | dwell |
| walk | walker `timeout` / `unreachable`, or `wp[k]` bad | – | `bad[k] = now + badWaypointRetryTicks`; `k = nextGood(k)`; new walker | walk |
| walk/dwell | – | every waypoint bad | `walker = new Walker(body, snapped center)` (center itself snapped like a waypoint; if that fails too: stand still) ; `holdUntil = now + allBadWaitTicks` | hold |
| dwell | step | `now >= dwellUntil` | `k = nextGood(k)`; new walker | walk |
| hold | step | `now >= holdUntil` | clear all `bad` marks and snaps | walk (from the nearest waypoint) |
| any | `pause(now)` | – | `body.stop()`; remember `pausedAt` | paused |
| paused | `resume(now)` | – | `walker = undefined`; next step: `k = nearest good waypoint to the bot`; new walker; shift `dwellUntil`, `holdUntil`, bad marks by `now - pausedAt` | walk |
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
  ridingId?: string;
  /** Entity.target?.id. undefined = no target, unreadable, or the beta member is gone. */
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
  airSupply?: number; // EntityBreathableComponent.airSupply (beta)
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
| `airSupply`, `totalSupply` | `getComponent('minecraft:breathable')` `.airSupply` (beta) / `.totalSupply` (d.ts S:10877) | undefined |
| `feetBlockId`, `headBlockId` | `dimension.getBlock(floor(v))?.typeId` (G) | undefined |
| `inventory`, `selectedSlot` | `getComponent('minecraft:inventory').container.getItem(i)` (D1), `selectedSlotIndex` (C) | `[]` ×36 undefined, 0 |
| `equipment` | `getComponent('minecraft:equippable').getEquipment(Head/Chest/Legs/Feet/Offhand)` (D3). **Never `Mainhand`.** | undefined pieces |
| `totalArmor` | `equippable.totalArmor` (D3) | 0 |
| `ItemView.durability` | `getComponent('minecraft:durability')` `damage`, `maxDurability` (D4) | absent |
| `ItemView.enchantLevelSum`, `mending` | `getComponent('minecraft:enchantable').getEnchantments()` sum of `level`; `mending` = any `type.id === "mending"` or `"minecraft:mending"` (D4) | absent |
| Entity `families` | `getComponent('minecraft:type_family').getTypeFamilies()` (A2); cache per `typeId` in a module `Map` | `[]` |
| Entity `isTamed` | `hasComponent('minecraft:is_tamed') \|\| getComponent('minecraft:tameable')?.isTamed === true` (A7) | false |
| Entity `isBaby` / `isIgnited` / `isCharged` | `hasComponent('minecraft:is_baby' / 'minecraft:is_ignited' / 'minecraft:is_charged')` (A6, A7) | false |
| Entity `ridingId` | `getComponent('minecraft:riding')?.entityRidingOn?.id` (A4) | undefined |
| Entity `targetId` | `e.target?.id` (A5, beta: one wrapper function `targetIdOf(e)`) | undefined |
| Entity `aabb` | `getAABB()` (A4) | undefined |
| `lineOfSight` | `dimension.getBlockFromRay(o, d/|d|, { maxDistance: |d|, includeLiquidBlocks: false, includePassableBlocks: false })`, LoS iff undefined (A8) | undefined |
| `env` | `world.getTimeOfDay()`, `dimension.getSkyLightLevel(head)`, `world.getDifficulty()`, `dimension.getWeather()` (A9) | 6000, 0, "normal", false |

`scanEntities(center, radius, max)` exactly:
```ts
dim.getEntities({ location: center, maxDistance: radius, closest: max, excludeTypes: EXCLUDED_ENTITY_TYPES })
```
then for each `e`: skip if `e.id === bot.id`; skip if `!e.isValid`; read every field inside a per-entity `try` (a throw skips that entity); skip if there is no `minecraft:health` component or `hp <= 0`.

`EXCLUDED_ENTITY_TYPES` (constant in `adapter/sense.ts`): `minecraft:item`, `xp_orb`, `xp_bottle`, `arrow`, `snowball`, `egg`, `ender_pearl`, `eye_of_ender_signal`, `fireball`, `small_fireball`, `dragon_fireball`, `wither_skull`, `wither_skull_dangerous`, `splash_potion`, `lingering_potion`, `thrown_trident`, `fishing_hook`, `shulker_bullet`, `llama_spit`, `wind_charge_projectile`, `breeze_wind_charge_projectile`, `fireworks_rocket`, `falling_block`, `tnt`, `tnt_minecart`, `minecart`, `chest_minecart`, `hopper_minecart`, `command_block_minecart`, `boat`, `chest_boat`, `leash_knot`, `painting`, `area_effect_cloud`, `lightning_bolt`, `evocation_fang`, `ender_crystal`, `armor_stand` (all with the `minecraft:` prefix).

Hurt events (also in `adapter/sense.ts`):
```ts
/** Subscribes world.afterEvents.entityHurt (API-MAP B) once. Calls `cb` only when the victim or the attacker is a minecraft:player. */
export function subscribeHurts(cb: (r: HurtRecord) => void): void;
```
Per event: `victim = ev.hurtEntity`, `attacker = ev.damageSource.damagingEntity` (for projectiles this is the shooter). Build `HurtRecord` (§5.5) reading `id`/`typeId` (readable when invalid) and `location` of the victim (try; else undefined). Drop the event unless `victim.typeId === "minecraft:player" || attacker?.typeId === "minecraft:player"`.

### 5.2 `Sensor` class (`src/game/bots/sensor.ts`, B3, engine-free)

```ts
export class Sensor {
  constructor(botId: BotId, name: string, sense: SensePort, provocation: ProvocationMemory, lookup: ColonyLookup, deps: { cfg: Phase3Config });
  /** Every pump. */
  readSelf(now: Tick, hint: ObjectiveHint | undefined): SelfPercept | undefined;
  /** Every config.combat.scanEveryTicks / combatScanEveryTicks. */
  scan(now: Tick, self: SelfPercept, protectedIds: ReadonlySet<string>): void;
  /** Between scans: distance = dist3(selfPos, e.pos) for every entity and the warden. */
  refreshDistances(selfPos: Vec3): void;
  /** Players in the defend zone at the last scan (empty unless hint.kind === "defend"). */
  playersInZone(hint: ObjectiveHint | undefined): PlayerView[];
  readonly entities: EntityPercept[];
  readonly warden: WardenPercept | undefined;
  readonly env: EnvPercept;
}
```

`readSelf(now, hint)`:
1. `raw = sense.readSelf()`; undefined → return undefined.
2. `hunger = raw.hunger ?? 20`, `saturation = raw.saturation ?? 5`, `hungerKnown = raw.hunger !== undefined && raw.saturation !== undefined`.
3. Booleans: `headInWater = WATER_IDS.includes(raw.headBlockId)`, `inLava = LAVA_IDS.includes(raw.feetBlockId) || LAVA_IDS.includes(raw.headBlockId)`, `inFireBlock = FIRE_IDS.includes(raw.feetBlockId)`, `onFire = raw.onFireTicks > 0`.
4. `airFrac = raw.airSupply !== undefined && raw.totalSupply ? clamp(raw.airSupply / (raw.totalSupply * 20), 0, 1) : undefined`.
5. `inventory = summarizeInventory(raw.inventory)` and `equipment = equipmentView(raw.equipment, raw.inventory, raw.selectedSlot, raw.totalArmor)` (pure, §6.5).
6. `values = computeValueSummary(inventory, equipment, hint?.kind === "gather" ? hint.items : undefined)` (values.ts, B2; formulas TABLES §4.4–4.5, owned by S2).
7. `lastDamage = provocation.lastDamageTo(botId)` (§5.5).

### 5.3 `scan(now, self, protectedIds)`

1. `raws = sense.scanEntities(self.pos, cfg.combat.scanRadius, cfg.combat.maxEntities)`, sorted by `dist3(self.pos, r.pos)` ascending.
2. `wardens = sense.findType("minecraft:warden", self.pos, cfg.combat.wardenSafeRadius)`; nearest → `warden = { id, pos, distance, targetingMe: r.targetId === botId || provocation.lastHurt(r.id, botId, since) !== undefined }`, else undefined.
3. `since = now - cfg.combat.provokeMemoryTicks`; `bots = lookup.botIds()`.
4. For each raw `r`:
   - `distance = dist3(self.pos, r.pos)`.
   - `prev = prevDist.get(r.id)`; `approaching = prev !== undefined && now - prev.tick <= 20 && prev.dist - distance >= cfg.combat.approachMinDelta`.
   - `hurtMeAtTick = provocation.lastHurt(r.id, botId, since)`; `hurtByMeAtTick = provocation.lastHurt(botId, r.id, since)`.
   - `provoked` per §5.5.
   - `lightLevel = r.typeId === "minecraft:spider" ? sense.lightAt(r.pos) : undefined`.
   - `classification = classify({ typeId, families, isTamed, isBaby }, { provoked, lightLevel }, cfg.combat)` (§6).
   - `targetingMe` per §5.4.
   - `threatensProtected = (r.targetId !== undefined && protectedIds.has(r.targetId)) || provocation.lastHurtAny(r.id, protectedIds, since) !== undefined`.
   - Placeholders until `annotate` (§7.3): `relevance = "irrelevant"`, `inLeash = true`, `attackAllowed = false`.
5. Line of sight: walk the list in distance order; for the first `cfg.combat.maxLosRaysPerScan` entities whose classification is `threat` or `neutral_unprovoked`: `los = sense.lineOfSight(self.headPos, r.headPos)`; `lineOfSight = los ?? true`; `losChecked = los !== undefined`. Every other entity: `lineOfSight = true`, `losChecked = false`.
6. `prevDist` = map of this scan's `{ dist, tick: now }` per id (entities not seen this scan are dropped).
7. If `hint.kind === "defend"`: `zonePlayers = sense.playersNear(hint.center, hint.radius)` minus this bot; else `[]`.
8. `env = sense.env(self.headPos)`.

Entity validity: the sensor stores only plain data; no engine handle survives a pump (API-MAP safe-usage rule 3). An entity that vanished simply isn't in the next scan. Between scans, `refreshDistances` keeps distances honest against the bot's own movement only.

### 5.4 `targetingMe`

```
targetingMe =
     r.targetId === botId                                     // Entity.target (beta, API-MAP A5)
  || hurtMeAtTick !== undefined                               // hurt me within provokeMemoryTicks
  || (classification === "threat" && distance <= cfg.combat.approachRadius && approaching)
```

### 5.5 Provocation memory (`src/core/combat/sense.ts`, pure, shared)

One instance lives in the runtime; `subscribeHurts` feeds it; every controller's sensor reads it. (S2's `BrainState` does **not** hold provocation memory.)

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

export class ProvocationMemory {
  constructor(maxRecords: number); // cfg.combat.hurtLogMax
  record(r: HurtRecord): void; // append; drop the oldest beyond maxRecords
  prune(now: Tick, keepTicks: Tick): void; // drop records with now - tick > keepTicks
  /** Latest tick >= since where attackerId damaged victimId. */
  lastHurt(attackerId: string, victimId: string, since: Tick): Tick | undefined;
  /** Latest tick >= since where attackerId damaged any of victimIds. */
  lastHurtAny(attackerId: string, victimIds: ReadonlySet<string>, since: Tick): Tick | undefined;
  /** Latest tick >= since where a minecraft:player (bot or human) damaged victimId. */
  lastHurtByPlayer(victimId: string, since: Tick): Tick | undefined;
  /** Latest tick >= since where a player damaged an entity of `typeId` whose victimPos is within `radius` of `pos`. */
  lastPlayerHurtOfTypeNear(typeId: string, pos: Vec3, radius: number, since: Tick): Tick | undefined;
  /** Latest record with victimId (any cause). */
  lastDamageTo(victimId: string): DamageRecord | undefined;
}
```

The runtime calls `prune(now, max(cfg.combat.provokeMemoryTicks, 200))` once per pump.

`provoked` for entity `r` seen by bot `B` (protected set `P`, colony bots `C`), all `since = now - provokeMemoryTicks`:
```
provoked =
     lastHurt(r.id, B, since)                 // it hurt me
  || lastHurtAny(r.id, P ∪ C, since)          // it hurt a protected player or any colony bot
  || lastHurtByPlayer(r.id, since)            // any player or bot hurt it (it retaliates)
  || (GROUP_AGGRO.has(r.typeId)
      && lastPlayerHurtOfTypeNear(r.typeId, r.pos, cfg.combat.groupAggroRadius, since))
  (each term: !== undefined)
```
`GROUP_AGGRO = { "minecraft:zombie_pigman", "minecraft:wolf", "minecraft:bee" }` (MOBS §2.2: group/pack aggro).

---

## 6. Classification (`src/core/combat/sense.ts`, pure, B1)

### 6.1 Lists (constants in `src/core/combat/mobs.ts`, B2 transcribes exactly these from MOBS §2)

```ts
export const NEVER_TARGET_ALWAYS: ReadonlySet<string>;   // MOBS 2.1 "always":
// player, villager_v2, villager, wandering_trader, iron_golem, snow_golem, copper_golem, allay, npc, armor_stand
export const NEVER_TARGET_IF_TAMED: ReadonlySet<string>; // MOBS 2.1 "only_if_tamed" (informational; §6.2 rule 2 checks every entity)
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
```

### 6.2 `classify`

```ts
export interface ClassifyFacts {
  typeId: string;
  families: readonly string[];
  isTamed: boolean;
  isBaby: boolean;
}
export interface ClassifyContext {
  provoked: boolean;
  /** Spiders only; undefined = unknown. */
  lightLevel?: number;
}
export function classify(e: ClassifyFacts, ctx: ClassifyContext, cfg: CombatConfig): Classification;
```

Rules, first match wins:
1. `e.typeId === "minecraft:player"` or `e.families.includes("player")` → `never_target`. (Players, including every colony bot, ALWAYS.)
2. `NEVER_TARGET_ALWAYS.has(typeId)` → `never_target`.
3. `e.isTamed` → `never_target` (any entity type).
4. `typeId === "minecraft:zombie_pigman"` (zombified piglin): `ctx.provoked ? "threat" : "neutral_unprovoked"`. Never hit first: a `neutral_unprovoked` entity is never relevant (§7.3) and never `attackAllowed` (§6.4), even when it blocks the objective.
5. `typeId === "minecraft:spider"`: `ctx.provoked` → `threat`; else `ctx.lightLevel !== undefined && ctx.lightLevel >= cfg.spiderNeutralLight` → `neutral_unprovoked`; else `threat` (unknown light = hostile).
6. `NEUTRAL_UNTIL_PROVOKED_IDS.has(typeId)`: `ctx.provoked ? "threat" : "neutral_unprovoked"`.
7. `IGNORE_IDS.has(typeId)` → `ignore`.
8. `mobEntry(typeId) !== undefined` (MOBS §3 and §4 entries including `variants`; lookup in mobs.ts) → `threat`.
9. `e.families.includes("monster")` → `threat` (MOBS §6 default entry applies).
10. Otherwise → `ignore`.

### 6.3 Notes
- Name-tagged hostiles stay hostile (MOBS 2.1).
- Babies: same classification as adults.
- A wild wolf attacking a hostile mob is `neutral_unprovoked` (never a target). A tamed one is `never_target`.

### 6.4 `attackAllowed`

```ts
export function attackAllowed(typeId: string, c: Classification): boolean;
```
`true` iff `c === "threat"` and `!NEUTRAL_NEVER_HIT.has(typeId)` and the MOBS entry's engage policy is not `flee` (warden, piglin_brute, ravager, elder_guardian, wither, ender_dragon). An entity with `attackAllowed === false` may still be fled from, shielded against, or avoided.

### 6.5 Inventory helpers (pure, `sense.ts`)

```ts
export const WEAPON_DAMAGE: Readonly<Record<string, number>> = {
  "minecraft:wooden_sword": 4, "minecraft:golden_sword": 4, "minecraft:stone_sword": 5,
  "minecraft:iron_sword": 6, "minecraft:diamond_sword": 7, "minecraft:netherite_sword": 8,
  "minecraft:wooden_axe": 3, "minecraft:golden_axe": 3, "minecraft:stone_axe": 4,
  "minecraft:iron_axe": 5, "minecraft:diamond_axe": 6, "minecraft:netherite_axe": 7,
}; // MOBS §1.1 (golden_axe: verify)
export function weaponDamage(typeId: string): number | undefined;
/** "_helmet"/"turtle_helmet" → head, "_chestplate" → chest, "_leggings" → legs, "_boots" → feet; else undefined. */
export function armourSlotOf(typeId: string): ArmourSlot | undefined;
export function durabilityFrac(v: ItemView): number; // durability ? clamp((max - damage) / max, 0, 1) : 1
export function summarizeInventory(slots: ReadonlyArray<ItemView | undefined>): InventorySummary;
export function equipmentView(
  eq: { head?: ItemView; chest?: ItemView; legs?: ItemView; feet?: ItemView; offhand?: ItemView },
  slots: ReadonlyArray<ItemView | undefined>, selectedSlot: number, totalArmor: number,
): EquipmentView;
```
`bestWeaponSlot`: among weapon slots with `max - damage > 1` (or no durability): max `weaponDamage`, tie max `durabilityFrac`, tie lowest slot. S3's equipment manager decides what is actually equipped and must use `weaponDamage` for its own ranking (one table).

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
| defend | zone (center, radius) | – | `center` | `radius + defendLeashExtra` |
| idle | – | – | `anchor` | `leashBlocks` |

```ts
export function objectivePoints(o: ObjectiveContext): Vec3[];
export function leashPoints(o: ObjectiveContext): Vec3[];
export function leashLimit(o: ObjectiveContext, cfg: CombatConfig): number;
```

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

### 7.4 Leash

```ts
export function leashDistance(pos: Vec3, o: ObjectiveContext): number; // min dist3(pos, P) over leashPoints(o)
export function withinLeash(pos: Vec3, o: ObjectiveContext, cfg: CombatConfig): boolean; // leashDistance <= leashLimit
export function nearestLeashPoint(pos: Vec3, o: ObjectiveContext): Vec3;
```
`annotate` sets `e.inLeash = withinLeash(e.pos, o, cfg)`.

Leash rules (S2 scoring and S3 movement must follow them):
- L1. The brain may pick `attack` on a target only if `target.attackAllowed` and (`target.inLeash` or `target.distance <= 3.5`).
- L2. S3 never issues a move whose destination has `withinLeash(dest) === false`. If the bot itself is outside the leash and no `threatening_me` entity is within 3.5 blocks, S3 moves toward `nearestLeashPoint(self.pos)` instead of chasing.
- L3. Retreat/flee/escape movement is exempt from the leash.

---

## 8. Cell helpers (pure, `sense.ts`)

### 8.1 `isStandable`

```ts
export function isStandable(probe: CellProbe, cell: Vec3, allowWaterFeet: boolean): boolean;
```
`cell` is integer. `below = probe(cell - y1)`, `feet = probe(cell)`, `head = probe(cell + y1)`. True iff all three are defined and:
- `below.isSolid && !below.isLiquid && !LAVA_IDS.includes(below.typeId)` and not in `SCULK_NOISE_IDS`;
- for `feet` and `head`: `!isSolid`, not lava, not fire; `isLiquid` allowed only when `allowWaterFeet` and the id is in `WATER_IDS` (head may be water only for the fire reflex search, never for drowning).

### 8.2 `nearestCell`

```ts
/** Rings r = 1..maxR around `from` (integer), dy in dys; first `accept(cell)` by increasing r, then |dy|, then x, then z. */
export function nearestCell(from: Vec3, maxR: number, dys: readonly number[], accept: (cell: Vec3) => boolean): Vec3 | undefined;
```
Ring `r` = cells with `max(|dx|, |dz|) === r`. Budget: callers cap `maxR` at 6 (≤ 13×13 cells × dys).

---

## 9. Reflexes

Reflexes bypass the brain's scoring entirely. Priority (higher preempts lower): **lava > drowning > warden > fire**. A lower-priority trigger never preempts an active higher one.

### 9.1 Pure part (`sense.ts`)

```ts
export interface ReflexMemory {
  kind?: ReflexKind;
  since?: Tick;
  /** First tick of the current uninterrupted "exit condition holds" stretch. */
  clearSince?: Tick;
  headInWaterSince?: Tick;
}
export interface ReflexInputs {
  self: SelfPercept;
  warden?: WardenPercept;
  /** Fire reflex only: a water cell was found within fireWaterSearchRadius at the last search (controller fills it). */
  waterNearby: boolean;
}
export function stepReflex(mem: ReflexMemory, inp: ReflexInputs, now: Tick, cfg: CombatConfig): { active?: ReflexKind; mem: ReflexMemory };
```

`headInWaterSince` bookkeeping: if `self.headInWater`: `headInWaterSince ??= now`; else `headInWaterSince = undefined`.

### 9.2 Triggers and exits

`hasEffect(id)` = `self.effects.some(e => e.typeId === id)`. `recentCause(c, n)` = `self.lastDamage?.cause === c && now - self.lastDamage.tick <= n`.

| Kind | Trigger (enter) | Exit (all must hold continuously for the stated time) |
|---|---|---|
| lava | `self.inLava` or `recentCause("lava", 10)` | `!self.inLava` and not `recentCause("lava", 10)` for `cfg.lavaExitTicks` (20) |
| drowning | (`headInWaterSince !== undefined` and `now - headInWaterSince >= cfg.drownHeadTicks` (200)) or (`self.airFrac !== undefined && self.airFrac <= cfg.drownAirFrac` (0.4)) or `recentCause("drowning", 40)` | `!self.headInWater` for `cfg.drownExitTicks` (60) |
| warden | (`warden !== undefined` and `warden.distance <= cfg.wardenFleeRadius` (32)) or `hasEffect("minecraft:darkness")` | `warden === undefined` (none within `wardenSafeRadius` 48) and no darkness effect, for `cfg.wardenClearTicks` (200) |
| fire | `self.onFire` and `!self.inWater` and `!hasEffect("minecraft:fire_resistance")` and (`self.inFireBlock` or `inp.waterNearby`) | `!self.onFire` or `self.inWater` or (`!self.inFireBlock` and `!inp.waterNearby`); immediate (0 ticks) |

Algorithm of `stepReflex`:
1. Compute the trigger set `T` (rows above).
2. If `mem.kind` is set:
   - If some `k ∈ T` has higher priority than `mem.kind`: switch: `kind = k`, `since = now`, `clearSince = undefined`; return active `k`.
   - If the exit condition of `mem.kind` holds now: `clearSince ??= now`; if `now - clearSince >= exitTicks(kind)`: clear `kind/since/clearSince`, then fall to step 3. Else return active `mem.kind`.
   - Else `clearSince = undefined`; return active `mem.kind`.
3. If `T` is empty: return no reflex. Else `kind = highest priority in T`, `since = now`; return it.

### 9.3 Reflex actions (controller, `runReflex(kind, self, now)`)

On every reflex pump: `body.stopBreaking()` and `body.stopUsingItem()` and `body.lowerShield()` on the first pump of a kind (when `since === now`).

**lava**
1. Every 20 ticks (and on entry): `dest = nearestCell(floor(self.pos), 5, [0, 1, -1, 2], c => isStandable(probe, c, true))`, preferring a cell whose feet block is water: run the search twice, first with `accept = standable && feet is water` and `maxR = 3`, then plain standable with `maxR = 5`.
2. If `dest`: `body.setSprinting(true)`; `body.moveTo(feetIn(dest))`; `body.jump()` every pump.
3. If none: `body.jump()` every pump and `body.moveTo(self.pos + 3·(unit vector toward the newest breadcrumb that is not lava))`; with no breadcrumb, `moveTo(self.pos + (0, 1, 0))`.

**drowning**
1. Every pump: `body.jump()` (swim up).
2. Every 20 ticks: `shore = nearestCell(floor(self.pos), 6, [0, 1, 2, -1], c => isStandable(probe, c, false))`; if found: `body.moveTo(feetIn(shore))`.

**warden** (sneak away; MOBS warden + `flee_sneak`)
1. Entry: `body.setSprinting(false)`; `body.setSneaking(true)`.
2. Exception: if `warden.targetingMe && warden.distance > cfg.wardenEscapeRadius`: `body.setSneaking(false)`; `body.setSprinting(true)` (MOBS `sprint_away`). Otherwise sneaking stays on. (Targeting within `wardenEscapeRadius` triggers the escape in §2.4 step 8.)
3. Every `cfg.wardenRepathTicks` (40), or when within 2 blocks of the current flee point, pick a flee point `F`:
   - With a warden position `W`: from `breadcrumbs`, newest to oldest, the first `B` with `dist3(B, W) >= dist3(self.pos, W) + 4` and `dist3(B, self.pos) >= 8` and the cell at `floor(B)` not in `SCULK_NOISE_IDS` (feet or below). If none: for the 8 compass directions `d` (N, NE, E, … at 45°), `P = self.pos + 12·d`, snapped with the ground search of §4.4 (`groundSearchUp` 4, `groundSearchDown` 6) around `P`; skip unsnappable points and points whose feet/below block is in `SCULK_NOISE_IDS`; pick the max `dist3(P, W)`; tie: the first in N, NE, E, SE, S, SW, W, NW order.
   - Darkness only (no `W`): the oldest breadcrumb with `dist3(B, self.pos) >= 8` (walk back the way it came). None → stand still (sneaking is silent).
4. `body.navigateTo(F)` (pathfinding; the speed while sneaking is a probe item, P6).

**fire**
1. Every 20 ticks the controller searches `water = nearestCell(floor(self.pos), cfg.fireWaterSearchRadius, [0, -1, 1], c => WATER_IDS.includes(probe(c)?.typeId ?? ""))` and sets `waterNearby` for the next `stepReflex` (also computed when not in a reflex while `self.onFire`).
2. If `water`: `body.moveTo(feetIn(water))`.
3. Else if `self.inFireBlock`: `dest = nearestCell(floor(self.pos), 3, [0, 1, -1], c => isStandable(probe, c, false))`; `body.moveTo(feetIn(dest))` if found.

`probe` = `(p) => deps.world()?.blockAt(p)`.

### 9.4 Escalation to escape (survival bias, no cooldown)

While a reflex is active, call `beginEscape(now)` (if not `escapePending` and `now >= escapeBlockedUntil`) when:
- lava: `now - since >= cfg.lavaEscapeTicks` (60);
- drowning: `now - since >= cfg.drownEscapeTicks` (300) and `self.hp <= 10`;
- warden: the §2.4 step 8 rule.

The reflex keeps moving the body until S4 disconnects the bot.

---

## 10. Config keys (S1)

`config.combat` (contract writer merges into `Phase3Config` in `src/core/config.ts`; `CombatConfig` = this object):

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `scanEveryTicks` | 8 | ticks | Full entity scan cadence in IDLE / TASK |
| `combatScanEveryTicks` | 4 | ticks | Full entity scan cadence in combat / reflex (every pump) |
| `scanRadius` | 24 | blocks | Entity scan radius around the bot's feet |
| `maxEntities` | 32 | count | `closest` cap of the entity query |
| `maxLosRaysPerScan` | 8 | count | Line-of-sight rays per scan (nearest threat/neutral first) |
| `provokeMemoryTicks` | 300 | ticks | Window for hurt-based provocation and the `targetingMe` fallback |
| `hurtLogMax` | 512 | records | Size cap of the shared ProvocationMemory |
| `groupAggroRadius` | 16 | blocks | Group anger radius for GROUP_AGGRO types (verify) |
| `approachRadius` | 6 | blocks | "Approaching while hostile" counts as targeting within this distance |
| `approachMinDelta` | 0.3 | blocks | Distance drop between scans that counts as approaching |
| `spiderNeutralLight` | 12 | light level | Spider is neutral at or above this light at its feet (verify) |
| `personalSpace` | 4 | blocks | A visible hostile this close is `threatening_me` |
| `objectiveRadius` | 6 | blocks | A hostile this close to an objective point is `blocking_objective` |
| `corridorHalfWidth` | 3 | blocks | A hostile this close to the path corridor is `blocking_objective` |
| `corridorMaxLen` | 16 | blocks | Corridor segment length cap from the anchor |
| `leashBlocks` | 16 | blocks | Max distance of a chased target from the nearest leash point |
| `defendLeashExtra` | 4 | blocks | Defend leash = zone radius + this |
| `resumeCalmTicks` | 60 | ticks | Calm time without relevant threat before the task resumes (only if the episode saw a threat) |
| `recoverHp` | 16 | HP | RECOVER ends when HP reaches this |
| `recoverMaxTicks` | 1200 | ticks | Max natural-regen wait in RECOVER without food |
| `escapeRetryTicks` | 200 | ticks | After S4 refuses an escape, don't request again for this long |
| `breadcrumbEveryTicks` | 20 | ticks | Breadcrumb sampling period |
| `breadcrumbMax` | 30 | count | Breadcrumbs kept (newest) |
| `wardenFleeRadius` | 32 | blocks | Warden within this → warden reflex |
| `wardenSafeRadius` | 48 | blocks | Warden query radius; reflex exits when none within it |
| `wardenClearTicks` | 200 | ticks | Warden-free and darkness-free time to exit |
| `wardenEscapeRadius` | 10 | blocks | Warden targeting the bot within this → escape-rejoin |
| `wardenRepathTicks` | 40 | ticks | Flee point re-pick period |
| `lavaExitTicks` | 20 | ticks | Out of lava this long to exit |
| `lavaEscapeTicks` | 60 | ticks | Still in the lava reflex after this → escape-rejoin |
| `drownHeadTicks` | 200 | ticks | Head under water this long → drowning reflex |
| `drownAirFrac` | 0.4 | fraction | Air supply at or below this → drowning reflex (if readable) |
| `drownExitTicks` | 60 | ticks | Head out of water this long to exit |
| `drownEscapeTicks` | 300 | ticks | Drowning reflex this long and HP ≤ 10 → escape-rejoin |
| `fireWaterSearchRadius` | 4 | blocks | Water search radius for the fire reflex |

`config.defend` (`DefendConfig`, §4.4):

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

---

## 11. Runtime wiring (`src/game/runtime.ts`, B3)

- `BotEntry` becomes `{ controller: BotController; body: ControllerBody; name; respawnAt?; respawnAttempts }`; `executor` and `lastProgress` move into the controller.
- `start()`: create one `ProvocationMemory(cfg.combat.hurtLogMax)`; `subscribeHurts(r => provocation.record(r))` inside `guard(...)`.
- `register(body, sense)`: build `ControllerDeps` (sink = emit `taskProgress` / `taskReport` events exactly as Phase 2's `emitProgress` / `stepBot`), `new BotController(deps, undefined, now)`.
- `pump()`: unchanged lifecycle pass; then `provocation.prune(...)`; compute the `ColonyLookup` values once; for each live bot `controller.tick(t)` (replaces `stepBot`).
- `assign` effect → `controller.assign(task, now())`; `cancel` effect → `controller.cancel(taskId, now())`.
- `onEntityDie` → `id = controller.onDeath(t)`; emit `taskReport failed bot_died` for `id` if defined (unchanged path).
- `removeBot` → `controller.dispose("removed")`.
- `contextFor(body)` adds `defend: DEFAULT_CONFIG.defend`.
- `ColonyRuntime.botStatus(botId): BotStatusView | undefined` → `controller.status()` (S5 uses it for `!status`).
- Spawn/adopt need a `SensePort`: `spawnBot` / `wrapSimulatedPlayer` additionally return `sense: createSensePort(p, name)` (contract writer changes `SpawnResult` to `{ ok: true; body; sense }`).

---

## 12. File ownership additions

| File | Owner | Note |
|---|---|---|
| `src/game/adapter/sense.ts` (new) | B3 | `createSensePort`, `subscribeHurts`, `EXCLUDED_ENTITY_TYPES`. Imports `@minecraft/server` only. |
| `src/core/combat/sense.ts` | B1 | Everything marked "pure, sense.ts" in this file |
| `src/core/combat/mobs.ts` lists of §6.1 | B2 | Exact contents above |
| `src/core/combat/values.ts` `computeValueSummary(inv, eq, objective?)` | B2 (formulas S2) | Signature fixed here |

---

## 13. Test cases for S6 to adopt (TC-B1 / TC-B3)

- classify: player → never_target; tamed wolf → never_target; wild wolf unprovoked → neutral_unprovoked, provoked → threat; zombie_pigman unprovoked next to the gather target → neutral_unprovoked and relevance irrelevant; spider at light 15 → neutral, at light 4 → threat, light unknown → threat; cow → ignore; unknown `monster` → threat; provoked bee → threat with `attackAllowed = false`; warden → threat, `attackAllowed = false`.
- relevance: zombie 3 blocks away with LoS → threatening_me; same behind a wall (los false, losChecked) → not via personal space; zombie 5 blocks from the target block → blocking_objective; zombie 2.5 blocks off the corridor middle → blocking; 4 blocks off → irrelevant; corridor truncated at 16 blocks; defend zone membership; `distPointSegment` with a zero-length segment.
- leash: target 17 blocks from every leash point → `inLeash = false`; defend uses radius + 4.
- reflex: priority lava > drowning > warden > fire; warden exit only after 200 continuous clear ticks (a warden reappearing at tick 150 resets the timer); drowning by head timer at exactly 200 ticks.
- controller: T5 pauses the gather executor and `step` is not called while paused (I1); T8→T12 resumes after 60 ticks; a threat at tick 30 of CALM restarts the wait; T19 cancel during combat leaves FIGHT and goes to IDLE after calm; T21 death reports `bot_died` once; topup eat resumes with 0 wait; assign during combat creates a paused executor; escape refusal re-runs the brain with `escapeAvailable = false`; carry rebuild sets `delivered`.
- executors: GatherExecutor pause in `break` stops breaking, keeps `delivered`/`held`, resume → `scan` with the candidate not blacklisted; pause in `collect` resumes in `collect`; deadline shifted by the paused time; GotoExecutor resume re-paths; DefendExecutor never reports done, skips bad waypoints, waypoint count `max(4, ceil(2π·rp/6))`.

---

## 14. Open questions and risks (with chosen fallbacks)

| # | Risk | Chosen fallback |
|---|---|---|
| R1 | `Entity.target` (beta) may not report a SimulatedPlayer, or may disappear (probe P8) | `targetingMe` also uses hurt-within-window and approaching-within-6 (§5.4); the adapter returns undefined on any throw |
| R2 | `airSupply` is beta and its unit is not documented | `airFrac` assumes ticks (`totalSupply` seconds × 20); the head-in-water timer and the `drowning` damage cause trigger the reflex independently |
| R3 | Whether `jump()` makes a SimulatedPlayer swim up, and whether sneaking slows `navigateToLocation` (probe P6) | Drowning also walks to the nearest shore cell; drowning and lava escalate to escape-rejoin (§9.4) |
| R4 | The new entity after an escape-rejoin has a new id | Identity mapping is S4's; S1 only defines the carry and the recover start (§3.6) |
| R5 | Unfiltered `entityHurt` fires often (burning mobs) | The adapter drops events where neither side is a player before building a record; memory capped at 512 and pruned per pump |
| R6 | The 32-closest cap can be filled by passives near farms | Accepted for Phase 3; `maxEntities` is config |
| R7 | Entity positions are up to 8 ticks stale in IDLE/TASK | Scans run every pump once in combat; reflexes use self data read every pump |
| R8 | Spider light threshold and group-aggro radius are unverified | Config keys `spiderNeutralLight` (12) and `groupAggroRadius` (16); unknown light = hostile |
| R9 | Terrain atoms of the MOBS condition grammar (`ground_flat`, `has_low_ceiling_within_8`, `has_cover_within_8`, `has_roof_within_10`) are not computed by S1 | S2/S3 compute them from `world()`; if they need them in the Percept, they add a `terrain` field (S1 defines no name for it) |
| R10 | Paths during the warden flee may cross sculk blocks (only the destination cell is checked) | Accepted; sneaking makes walking over sensors silent |
| R11 | `is_ignited` meaning is unverified (probe P7) | `isIgnited` is reported raw; MOBS `dist_below: 3` proxy is S2/S3's |
