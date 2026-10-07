// Gather executor (Job 5): drives one WorkerBody through scan -> approach -> break -> collect -> deposit
// until the task's amount is delivered. Imperative shell around gather-logic.ts / crafting.ts.
// NO @minecraft imports (enforced by test/boundaries.test.ts): only ports, so it's tested against fakes.
// State machine: docs/PHASE2-SPEC.md §"Gather executor".
import type { GatherTask, TaskId, TaskProgress, Tick } from "../../core/types.js";
import type { ExecutorContext, StepResult, TaskExecutor } from "./executor.js";

export type GatherPhase =
  | "start" // first step: resolve world, position, resource; decide whether a tool must be fetched first
  | "toChest" // walking to the chest (purpose: deposit | fetch tool | fetch logs)
  | "atChest" // container transfers (deposit yields; withdraw tool / logs)
  | "craft" // crafting chain for a wooden pickaxe (incl. placing a table)
  | "scan" // time-sliced block search around task.origin
  | "approach" // walking to a stand cell for the chosen block
  | "break" // breaking the block (polling until it's gone)
  | "collect" // waiting for / walking to drops
  | "finished"; // terminal (reported or cancelled)

export class GatherExecutor implements TaskExecutor {
  readonly taskId: TaskId;

  constructor(
    readonly task: GatherTask,
    private readonly ctx: ExecutorContext,
  ) {
    this.taskId = task.id;
  }

  step(now: Tick): StepResult {
    void now;
    void this.ctx;
    throw new Error("TODO(phase-2): GatherExecutor.step");
  }

  cancel(): void {
    // TODO(phase-2): stop breaking + stop moving; idempotent.
  }

  progress(): TaskProgress | undefined {
    // TODO(phase-2)
    return { kind: "gather", delivered: this.task.delivered, held: 0 };
  }

  /** Current phase (for tests and logs). */
  phase(): GatherPhase {
    return "start"; // TODO(phase-2)
  }
}
