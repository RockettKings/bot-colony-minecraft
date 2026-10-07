// Goto executor: drives one bot body towards one target. Imperative shell around executor-logic.ts.
import type { GotoTask, TaskFailReason, TaskId, Tick } from "../../core/types.js";
import type { BotBody } from "../adapter/index.js";
import { logInfo } from "../log.js";
import { classifyNav, decide, initGotoState, onNavResult, timeoutTicks, type GotoState } from "./executor-logic.js";

export type StepResult =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "failed"; reason: TaskFailReason };

export class GotoExecutor {
  readonly taskId: TaskId;
  private state: GotoState | undefined;
  /** Tick of the first step; bounds the wait for a readable start position. */
  private firstStepAt: Tick | undefined;
  /** Cancelled or reported a terminal result. A settled executor never moves the body or reports again. */
  private settled = false;

  constructor(
    private readonly body: BotBody,
    readonly task: GotoTask,
  ) {
    this.taskId = task.id;
  }

  /** Call once per pump. Starts navigation on the first step. Returns a terminal result at most once. */
  step(now: Tick): StepResult {
    if (this.settled) return { kind: "running" };
    const r = this.advance(now);
    if (r.kind !== "running") this.settled = true;
    return r;
  }

  /** Stops movement. Idempotent; after this, step() never reports. */
  cancel(): void {
    if (this.settled) return;
    this.settled = true;
    this.body.stop();
  }

  private advance(now: Tick): StepResult {
    const pos = this.body.location();
    if (!this.state) {
      this.firstStepAt ??= now;
      if (!pos) {
        // Can't read position yet; try next pump, but never past the base timeout (distance unknown).
        if (now - this.firstStepAt >= timeoutTicks(0)) return { kind: "failed", reason: "timeout" };
        return { kind: "running" };
      }
      this.state = initGotoState(this.task.target, pos, now);
    }
    const s = this.state;
    const d = decide(s, pos, now);
    switch (d.kind) {
      case "arrived":
        this.body.stop();
        return { kind: "done" };
      case "timeout":
        this.body.stop();
        return { kind: "failed", reason: "timeout" };
      case "unreachable":
        this.body.stop();
        return { kind: "failed", reason: "unreachable" };
      case "wait":
        return { kind: "running" };
      case "navigate": {
        // Navigation can only start from the ground (per typings). Retry next pump.
        if (!this.body.isOnGround()) {
          s.navigating = false;
          return { kind: "running" };
        }
        if (d.repath) logInfo(`${this.body.name}: no progress, re-pathing (#${s.repaths}) for ${this.taskId}`);
        const r = onNavResult(s, classifyNav(this.body.navigateTo(s.target)), now);
        if (r === "unreachable") {
          this.body.stop();
          return { kind: "failed", reason: "unreachable" };
        }
        return { kind: "running" };
      }
    }
  }
}
