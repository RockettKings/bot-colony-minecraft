// Shared contracts for Phase 1. Everything under src/core/ is pure TypeScript:
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
  | { kind: "queue" };

export type CommandKind = Command["kind"];

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; error: string; usage?: string };

// ---------- tasks ----------

export type TaskStatus = "queued" | "active" | "paused" | "done" | "failed" | "cancelled";

/** Phase 1 has exactly one task kind. New kinds extend this union in later phases. */
export interface GotoTask {
  id: TaskId;
  kind: "goto";
  target: Vec3; // absolute, already resolved
  issuer: PlayerRef;
  createdAt: Tick;
}

export type Task = GotoTask;

export type TaskFailReason = "unreachable" | "timeout" | "bot_died" | "bot_removed" | "error";

// ---------- colony core events (game -> core) ----------

export type ColonyEvent =
  | { kind: "command"; now: Tick; sender: Sender; command: Command }
  | { kind: "botRegistered"; now: Tick; botId: BotId; name: string }
  | { kind: "botRemoved"; now: Tick; botId: BotId; reason: string }
  | { kind: "spawnFailed"; now: Tick; name: string; requestedBy: PlayerId; reason: string }
  | { kind: "taskReport"; now: Tick; botId: BotId; taskId: TaskId; outcome: "done" }
  | { kind: "taskReport"; now: Tick; botId: BotId; taskId: TaskId; outcome: "failed"; reason: TaskFailReason }
  | { kind: "tick"; now: Tick };

// ---------- colony core effects (core -> game) ----------

export type Effect =
  /** Send text. `to: "all"` broadcasts. `from` set = spoken by that bot, else by the colony. */
  | { kind: "reply"; to: PlayerId | "all"; from?: BotId; text: string }
  /** Start executing a task. The bot was idle (or was just cancelled by a preceding effect). */
  | { kind: "assign"; botId: BotId; task: Task }
  /** Stop the bot's current task immediately. */
  | { kind: "cancel"; botId: BotId; taskId: TaskId; reason: "stopped" | "preempted" }
  /** Spawn a new bot near a position. Game answers with botRegistered or spawnFailed. */
  | { kind: "spawn"; name: string; near: Vec3; requestedBy: PlayerId };

// ---------- read model ----------

export type BotState = "idle" | "busy";

export interface BotView {
  id: BotId;
  name: string;
  state: BotState;
  task?: Task;
}

export interface ColonySnapshot {
  bots: BotView[];
  queued: Task[]; // waiting for a free bot, oldest first
  pendingOffers: number;
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
