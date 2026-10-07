// Shared contracts (Phase 1 + Phase 2). Everything under src/core/ is pure TypeScript:
// it must never import @minecraft/* so it can be unit-tested in Node.
// Changing anything in this file is a cross-job change — coordinate before editing.

// ---------- primitives ----------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A coordinate as typed by a player: absolute (`10`) or relative to the sender (`~`, `~-3`). */
export interface Coord {
  value: number;
  relative: boolean;
}

export interface CoordTriple {
  x: Coord;
  y: Coord;
  z: Coord;
}

/** Game ticks (20 per second). The core never reads a clock; time arrives on events. */
export type Tick = number;

export type PlayerId = string;
export type BotId = string;
export type TaskId = string;

export interface PlayerRef {
  id: PlayerId;
  name: string;
}

/** Sender of a command, with the position needed to resolve `~` coords and `!come`. */
export interface Sender extends PlayerRef {
  pos: Vec3;
}

// ---------- commands (produced by src/core/commands, consumed by src/core/colony) ----------

export type Command =
  | { kind: "help"; topic?: string }
  | { kind: "status"; bot?: string }
  | { kind: "spawn"; name?: string }
  | { kind: "goto"; target: CoordTriple; count: number }
  | { kind: "come"; count: number }
  | { kind: "stop"; bot?: string }
  | { kind: "override" }
  | { kind: "queue" }
  // Phase 2
  /** `!gather <item> [amount] [bots]`. `item` is already resolved through src/core/items.ts. */
  | { kind: "gather"; item: ResourceKey; amount: number; count: number }
  /** `!chest` (show) / `!chest set` (register the chest the sender looks at / stands next to). */
  | { kind: "chest"; action: "show" | "set" };

export type CommandKind = Command["kind"];

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; error: string; usage?: string };

// ---------- tasks ----------

export type TaskStatus = "queued" | "active" | "paused" | "done" | "failed" | "cancelled";

export interface GotoTask {
  id: TaskId;
  kind: "goto";
  target: Vec3; // absolute, already resolved
  issuer: PlayerRef;
  createdAt: Tick;
}

/**
 * Phase 2: gather `amount` of a resource and deliver it to `chest`.
 * Tasks are immutable values; progress lives in the core's per-bot record (fed by `taskProgress` events)
 * and is folded into `delivered` only when a running task is requeued (preempted / bot left).
 */
export interface GatherTask {
  id: TaskId;
  kind: "gather";
  item: ResourceKey;
  /** Total this task must deliver (one bot's share of the player's request). */
  amount: number;
  /** Already delivered by earlier runs of this task (0 when new; set on requeue). Executor starts from here. */
  delivered: number;
  /** Where to search: the sender's position when the command was given. Fixed for the task's lifetime. */
  origin: Vec3;
  /** Deposit chest, captured when the task was created. */
  chest: ChestRef;
  issuer: PlayerRef;
  createdAt: Tick;
}

/** Every task kind. Adding a kind = extend this union + register an executor in src/game/bots/registry.ts. */
export type Task = GotoTask | GatherTask;
export type TaskKind = Task["kind"];
export type TaskOf<K extends TaskKind> = Extract<Task, { kind: K }>;

export type TaskFailReason =
  | "unreachable"
  | "timeout"
  | "bot_died"
  | "bot_removed"
  | "error"
  // Phase 2 (gather)
  | "no_source" // nothing (more) to gather within the scan radius of the task origin
  | "no_chest" // the task's chest is gone, unloaded, not a container, or can't be reached
  | "no_tool" // the resource needs a tool the bot can't get (inventory, chest, or crafting)
  | "inventory_full"; // can't deposit: the chest is full (and the bot's inventory is too)

/** Latest progress of a running task, reported by its executor. Absolute (includes GatherTask.delivered). */
export type TaskProgress = { kind: "gather"; delivered: number; held: number };

// ---------- colony chest (Phase 2) ----------

/** A container block in the world. `pos` = integer block coordinates. `dimensionId` e.g. "minecraft:overworld". */
export interface ChestRef {
  dimensionId: string;
  pos: Vec3;
}

export interface ItemCount {
  typeId: string; // e.g. "minecraft:oak_log"
  amount: number;
}

/** Why `!chest set` found no chest. */
export type ChestLocateFailure = "none_found" | "no_player" | "error";

/**
 * Canonical resource keys accepted by `!gather` (after alias resolution). The table that defines them
 * (source blocks, counted items, tools) is RESOURCES in src/core/items.ts.
 */
export type ResourceKey =
  | "log"
  | "oak_log"
  | "spruce_log"
  | "birch_log"
  | "jungle_log"
  | "acacia_log"
  | "dark_oak_log"
  | "mangrove_log"
  | "cherry_log"
  | "pale_oak_log"
  | "cobblestone"
  | "dirt"
  | "sand"
  | "gravel";

// ---------- colony core events (game -> core) ----------

export type ColonyEvent =
  | { kind: "command"; now: Tick; sender: Sender; command: Command }
  | { kind: "botRegistered"; now: Tick; botId: BotId; name: string }
  | { kind: "botRemoved"; now: Tick; botId: BotId; reason: string }
  | { kind: "spawnFailed"; now: Tick; name: string; requestedBy: PlayerId; reason: string }
  | { kind: "taskReport"; now: Tick; botId: BotId; taskId: TaskId; outcome: "done" }
  | { kind: "taskReport"; now: Tick; botId: BotId; taskId: TaskId; outcome: "failed"; reason: TaskFailReason }
  | { kind: "tick"; now: Tick }
  // Phase 2
  /** Running task's progress changed. The runtime sends it (only on change) BEFORE any report for that task. */
  | { kind: "taskProgress"; now: Tick; botId: BotId; taskId: TaskId; progress: TaskProgress }
  /** Answer to a `locateChest` effect. */
  | { kind: "chestLocated"; now: Tick; requestedBy: PlayerId; chest: ChestRef }
  | { kind: "chestLocateFailed"; now: Tick; requestedBy: PlayerId; reason: ChestLocateFailure }
  /** Answer to an `inspectChest` effect. `items` undefined = unreadable (gone, unloaded, not a container). */
  | { kind: "chestInspected"; now: Tick; to: PlayerId; chest: ChestRef; items: ItemCount[] | undefined };

// ---------- colony core effects (core -> game) ----------

export type Effect =
  /** Send text. `to: "all"` broadcasts. `from` set = spoken by that bot, else by the colony. */
  | { kind: "reply"; to: PlayerId | "all"; from?: BotId; text: string }
  /** Start executing a task. The bot was idle (or was just cancelled by a preceding effect). */
  | { kind: "assign"; botId: BotId; task: Task }
  /** Stop the bot's current task immediately. */
  | { kind: "cancel"; botId: BotId; taskId: TaskId; reason: "stopped" | "preempted" }
  /** Spawn a new bot near a position. Game answers with botRegistered or spawnFailed. */
  | { kind: "spawn"; name: string; near: Vec3; requestedBy: PlayerId }
  // Phase 2
  /**
   * Find the chest for `!chest set`: the container block the (online) player is looking at (≤ 6 blocks),
   * else the nearest container within 4 blocks of `near` (the sender's position) in the player's dimension
   * (overworld if the player is offline / a GameTest sender). Game answers chestLocated / chestLocateFailed.
   */
  | { kind: "locateChest"; requestedBy: PlayerId; near: Vec3 }
  /** Read the chest's contents for `!chest`. Game answers chestInspected. */
  | { kind: "inspectChest"; to: PlayerId; chest: ChestRef };

// ---------- read model ----------

export type BotState = "idle" | "busy";

export interface BotView {
  id: BotId;
  name: string;
  state: BotState;
  task?: Task;
  /** Latest progress of `task` (Phase 2; absent for goto or before the first report). */
  progress?: TaskProgress;
}

export interface ColonySnapshot {
  bots: BotView[];
  queued: Task[]; // waiting for a free bot, oldest first
  pendingOffers: number;
  /** The registered colony chest (Phase 2). */
  chest?: ChestRef;
}

export interface ColonyConfig {
  prefix: string; // "!"
  maxBots: number; // 3
  offerTtlTicks: Tick; // 600 (30 s)
  commandCooldownTicks: Tick; // 20 (1 s) per player
  defaultBotNamePrefix: string; // "Bot-"
}

export const DEFAULT_CONFIG: ColonyConfig = {
  prefix: "!",
  maxBots: 3,
  offerTtlTicks: 600,
  commandCooldownTicks: 20,
  defaultBotNamePrefix: "Bot-",
};
