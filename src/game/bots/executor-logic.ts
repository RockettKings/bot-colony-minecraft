// Pure decision logic for the goto executor. NO @minecraft imports: unit-tested in test/executor-logic.test.ts.
import type { Tick, Vec3 } from "../../core/types.js";

export const ARRIVE_DIST = 1.5; // blocks
export const STUCK_TICKS = 100; // ~5 s without progress -> re-path
export const MIN_PROGRESS = 0.5; // blocks of improvement that count as progress
export const TIMEOUT_BASE_TICKS = 200;
export const TIMEOUT_TICKS_PER_BLOCK = 20;

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function timeoutTicks(dist: number): Tick {
  return Math.ceil(TIMEOUT_BASE_TICKS + TIMEOUT_TICKS_PER_BLOCK * Math.max(0, dist));
}

/** Result of a navigation request, already stripped of game types. undefined = the call threw. */
export interface NavInfo {
  pathLength: number;
  isFullPath: boolean;
}

/**
 * - full:    a complete path to the target exists.
 * - partial: a path towards the target exists but doesn't reach it.
 * - none:    no path at all -> unreachable.
 * - error:   the call threw (e.g. bot not on ground yet) -> retry on a later pump.
 */
export type NavClass = "full" | "partial" | "none" | "error";

export function classifyNav(nav: NavInfo | undefined): NavClass {
  if (!nav) return "error";
  if (nav.pathLength === 0) return "none";
  return nav.isFullPath ? "full" : "partial";
}

export interface GotoState {
  readonly target: Vec3;
  readonly startedAt: Tick;
  readonly deadline: Tick;
  /** Closest distance reached so far (updated only on real progress). */
  bestDist: number;
  lastProgressAt: Tick;
  /** A navigation request has been accepted for the current attempt. */
  navigating: boolean;
  /** The last accepted navigation was only a partial path. */
  lastNavPartial: boolean;
  repaths: number;
  /** Stuck-triggered re-paths since the last real progress. */
  stallsSinceProgress: number;
}

export function initGotoState(target: Vec3, pos: Vec3, now: Tick): GotoState {
  const d = distance(pos, target);
  return {
    target: { ...target },
    startedAt: now,
    deadline: now + timeoutTicks(d),
    bestDist: d,
    lastProgressAt: now,
    navigating: false,
    lastNavPartial: false,
    repaths: 0,
    stallsSinceProgress: 0,
  };
}

export type Decision =
  | { kind: "arrived" }
  | { kind: "timeout" }
  | { kind: "unreachable" }
  /** (Re)issue the navigation request. */
  | { kind: "navigate"; repath: boolean }
  | { kind: "wait" };

/**
 * One pump step. Mutates `s` (progress bookkeeping) and says what the executor should do.
 * `pos` undefined = position unreadable this pump; only the deadline is checked.
 */
export function decide(s: GotoState, pos: Vec3 | undefined, now: Tick): Decision {
  if (pos) {
    const d = distance(pos, s.target);
    if (d <= ARRIVE_DIST) return { kind: "arrived" };
    if (d <= s.bestDist - MIN_PROGRESS) {
      s.bestDist = d;
      s.lastProgressAt = now;
      s.stallsSinceProgress = 0;
    }
  }
  if (now >= s.deadline) return { kind: "timeout" };
  if (!pos) return { kind: "wait" };
  if (!s.navigating) return { kind: "navigate", repath: false };
  if (now - s.lastProgressAt >= STUCK_TICKS) {
    // Stuck again after re-pathing on a partial path: the target can't be reached from here.
    if (s.lastNavPartial && s.stallsSinceProgress >= 1) return { kind: "unreachable" };
    s.stallsSinceProgress++;
    s.repaths++;
    s.lastProgressAt = now;
    return { kind: "navigate", repath: true };
  }
  return { kind: "wait" };
}

/** Record the outcome of a navigation request. Returns "unreachable" when the task must fail. */
export function onNavResult(s: GotoState, nav: NavClass, now: Tick): "ok" | "retry" | "unreachable" {
  switch (nav) {
    case "none":
      return "unreachable";
    case "error":
      s.navigating = false;
      return "retry";
    case "full":
    case "partial":
      s.navigating = true;
      s.lastNavPartial = nav === "partial";
      s.lastProgressAt = now;
      return "ok";
  }
}
