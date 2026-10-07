// Executor contract + registry types (architect-owned). NO @minecraft imports.
// The runtime creates one executor per `assign` effect through an ExecutorRegistry keyed by task kind,
// so later phases add task kinds without touching the runtime core (src/game/bots/registry.ts holds the table).
import type { Task, TaskFailReason, TaskId, TaskKind, TaskOf, TaskProgress, Tick } from "../../core/types.js";
import type { WorkerBody, WorldPort } from "./ports.js";

export type StepResult =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "failed"; reason: TaskFailReason };

export interface TaskExecutor {
  readonly taskId: TaskId;
  readonly task: Task;
  /**
   * Called once per pump (every 4 ticks). Returns a terminal result at most once; after that (or after
   * cancel) it returns running forever and never touches the body again.
   */
  step(now: Tick): StepResult;
  /** Stop everything the body is doing for this task (movement, breaking). Idempotent; no report follows. */
  cancel(): void;
  /**
   * Latest progress, or undefined for tasks without progress (goto). The runtime compares it after every
   * step and emits `taskProgress` on change, before emitting the step's report (if any).
   */
  progress(): TaskProgress | undefined;
}

/** Cost-aware knobs for gathering (prototype). All distances in blocks, times in ticks. */
export interface GatherConfig {
  /** Horizontal half-size of the scan box around the task origin. */
  scanRadius: number;
  /** Vertical half-size of the scan box around the task origin (clamped to the world's -64..319). */
  scanHalfHeight: number;
  /** Y-layers scanned per pump (time slicing; one layer = (2r+1)^2 blocks). */
  scanLayersPerPump: number;
  /** Time budget per task run. When exceeded the bot deposits what it holds, then fails with "timeout". */
  maxTaskTicks: Tick;
  /** Consecutive candidate failures (unreachable / unbreakable) before the task fails "unreachable". */
  maxConsecutiveFailures: number;
  /** Max distance from the bot's eyes (feet + 1.62) to a block center for breaking / using a table. */
  breakReach: number;
  /** Max horizontal distance from the bot's feet to a container block center for transfers (|dy| <= 2). */
  containerReach: number;
  /** Radius around a broken block in which matching drops are walked to. */
  pickupRadius: number;
  /** Give up walking to a drop after this long. */
  pickupTimeoutTicks: Tick;
  /** Wait after a block breaks before looking for its drops. */
  dropSettleTicks: Tick;
  /** Go deposit when free inventory slots drop to this many (and no partial yield stack has room). */
  reserveSlots: number;
  /** Search radius for an existing crafting table near the bot. */
  tableSearchRadius: number;
}

export const DEFAULT_GATHER_CONFIG: GatherConfig = {
  scanRadius: 16,
  scanHalfHeight: 8,
  scanLayersPerPump: 2,
  maxTaskTicks: 12_000, // 10 min
  maxConsecutiveFailures: 5,
  breakReach: 4.5,
  containerReach: 2.5,
  pickupRadius: 4,
  pickupTimeoutTicks: 100,
  dropSettleTicks: 8,
  reserveSlots: 1,
  tableSearchRadius: 4,
};

export interface ExecutorContext {
  body: WorkerBody;
  /**
   * The bot's dimension, resolved lazily (goto never calls it). undefined = the dimension can't be read;
   * an executor that needs the world then fails with "error".
   */
  world(): WorldPort | undefined;
  gather: GatherConfig;
}

export type ExecutorFactory<K extends TaskKind> = (task: TaskOf<K>, ctx: ExecutorContext) => TaskExecutor;

/** Exactly one factory per task kind: adding a Task kind without a factory is a compile error. */
export type ExecutorRegistry = { readonly [K in TaskKind]: ExecutorFactory<K> };

export function createExecutor(registry: ExecutorRegistry, task: Task, ctx: ExecutorContext): TaskExecutor {
  // TS can't correlate registry[task.kind] with task's narrowed type; the mapped type guarantees it.
  const factory = registry[task.kind] as unknown as (t: Task, c: ExecutorContext) => TaskExecutor;
  return factory(task, ctx);
}
