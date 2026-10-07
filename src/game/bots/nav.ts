// Reusable "walk to X" helper on top of the Phase 1 goto rules (executor-logic.ts): same arrival radius,
// stuck re-pathing, partial-path give-up and 200 + 20 x dist timeout. The caller owns stopping the body and
// any extra predicate ("in reach" etc.), which it checks before stepping the walker.
import type { Tick, Vec3 } from "../../core/types.js";
import { classifyNav, decide, initGotoState, onNavResult, type GotoState } from "./executor-logic.js";
import type { BotBody } from "./ports.js";

export type WalkStatus = "walking" | "arrived" | "timeout" | "unreachable";

export class Walker {
  private state: GotoState | undefined;

  constructor(
    private readonly body: BotBody,
    readonly target: Vec3,
  ) {}

  /** One pump. `pos` undefined = unreadable this pump (only the deadline is checked once started). */
  step(pos: Vec3 | undefined, now: Tick): WalkStatus {
    if (!this.state) {
      if (!pos) return "walking";
      this.state = initGotoState(this.target, pos, now);
    }
    const s = this.state;
    const d = decide(s, pos, now);
    switch (d.kind) {
      case "arrived":
        return "arrived";
      case "timeout":
        return "timeout";
      case "unreachable":
        return "unreachable";
      case "wait":
        return "walking";
      case "navigate": {
        if (!this.body.isOnGround()) {
          s.navigating = false;
          return "walking";
        }
        const r = onNavResult(s, classifyNav(this.body.navigateTo(s.target)), now);
        return r === "unreachable" ? "unreachable" : "walking";
      }
    }
  }
}

/** Feet position for standing in integer cell `c`: its bottom center. */
export function feetIn(c: Vec3): Vec3 {
  return { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
}
