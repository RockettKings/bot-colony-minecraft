// Internal mutable state of the colony core. Not exported outside src/core/colony.
import type { BotId, PlayerId, PlayerRef, Task, TaskId, Tick, Vec3 } from "../types.js";

export interface BotRecord {
  id: BotId;
  name: string;
  /** Registration order; used for deterministic iteration and tie-breaks. */
  seq: number;
  task?: Task;
}

export interface PendingSpawn {
  name: string;
  requestedBy: PlayerId;
}

export interface GotoOffer {
  kind: "goto";
  owner: PlayerRef;
  createdAt: Tick;
  target: Vec3;
  count: number;
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

export type Offer = GotoOffer | StopOffer;

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
