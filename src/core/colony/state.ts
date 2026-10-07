// Internal mutable state of the colony core. Not exported outside src/core/colony.
import type {
  BotId,
  ChestRef,
  PlayerId,
  PlayerRef,
  ResourceKey,
  Task,
  TaskId,
  TaskProgress,
  Tick,
  Vec3,
} from "../types.js";

export interface BotRecord {
  id: BotId;
  name: string;
  /** Registration order; used for deterministic iteration and tie-breaks. */
  seq: number;
  task?: Task;
  /** Latest progress of `task` (only when the report's taskId matched). Cleared whenever `task` changes. */
  progress?: TaskProgress;
}

export interface PendingSpawn {
  name: string;
  requestedBy: PlayerId;
}

/** What to create for one bot once an offer is accepted (ids/issuer/createdAt are added then). */
export type TaskSpec =
  | { kind: "goto"; target: Vec3 }
  | { kind: "gather"; item: ResourceKey; amount: number; origin: Vec3; chest: ChestRef };

/** A pending multi-bot request (goto/come/gather): one spec per bot, assigned in order. */
export interface TaskOffer {
  kind: "task";
  owner: PlayerRef;
  createdAt: Tick;
  specs: TaskSpec[];
}

export interface StopOffer {
  kind: "stop";
  owner: PlayerRef;
  createdAt: Tick;
  botId: BotId;
  /** Kept so the reply can name the bot even if it has left since. */
  botName: string;
  taskId: TaskId;
}

export type Offer = TaskOffer | StopOffer;

export interface ColonyState {
  /** Map preserves insertion (= registration) order. */
  bots: Map<BotId, BotRecord>;
  nextBotSeq: number;
  pendingSpawns: PendingSpawn[];
  /** Waiting tasks, head first. */
  queue: Task[];
  /** At most one offer per player. */
  offers: Map<PlayerId, Offer>;
  /** Tick of each player's last cooldown-checked accepted command. */
  lastCommandAt: Map<PlayerId, Tick>;
  nextTaskNum: number;
  /** The registered colony chest (Phase 2; in memory only until Phase 8). */
  chest?: ChestRef;
}

export function createState(): ColonyState {
  return {
    bots: new Map(),
    nextBotSeq: 0,
    pendingSpawns: [],
    queue: [],
    offers: new Map(),
    lastCommandAt: new Map(),
    nextTaskNum: 1,
  };
}
