import { describe, expect, it } from "vitest";
import {
  ARRIVE_DIST,
  STUCK_TICKS,
  classifyNav,
  decide,
  distance,
  initGotoState,
  onNavResult,
  timeoutTicks,
} from "../src/game/bots/executor-logic.js";
import { GotoExecutor } from "../src/game/bots/goto-executor.js";
import type { BotBody } from "../src/game/adapter/index.js";
import type { GotoTask } from "../src/core/types.js";

const at = (x: number, y = 0, z = 0) => ({ x, y, z });
const TARGET = at(20);

function started(now = 0, pos = at(0), nav: "full" | "partial" = "full") {
  const s = initGotoState(TARGET, pos, now);
  expect(decide(s, pos, now)).toEqual({ kind: "navigate", repath: false });
  expect(onNavResult(s, nav, now)).toBe("ok");
  return s;
}

describe("distance / timeout", () => {
  it("is euclidean 3D", () => {
    expect(distance(at(0), { x: 3, y: 4, z: 12 })).toBe(13);
  });
  it("timeout = 200 + 20 x distance, rounded up", () => {
    expect(timeoutTicks(0)).toBe(200);
    expect(timeoutTicks(10)).toBe(400);
    expect(timeoutTicks(10.01)).toBe(401);
    expect(timeoutTicks(-1)).toBe(200);
  });
  it("initGotoState sets deadline from start distance", () => {
    const s = initGotoState(TARGET, at(0), 100);
    expect(s.deadline).toBe(100 + 200 + 20 * 20);
    expect(s.bestDist).toBe(20);
  });
});

describe("classifyNav", () => {
  it("maps results", () => {
    expect(classifyNav(undefined)).toBe("error");
    expect(classifyNav({ pathLength: 0, isFullPath: false })).toBe("none");
    expect(classifyNav({ pathLength: 0, isFullPath: true })).toBe("none");
    expect(classifyNav({ pathLength: 5, isFullPath: true })).toBe("full");
    expect(classifyNav({ pathLength: 5, isFullPath: false })).toBe("partial");
  });
});

describe("decide", () => {
  it("arrival within 1.5 blocks wins, even before navigating", () => {
    const s = initGotoState(TARGET, at(0), 0);
    expect(decide(s, at(20 - ARRIVE_DIST), 4)).toEqual({ kind: "arrived" });
    expect(decide(started(), at(20, 1, 0), 8)).toEqual({ kind: "arrived" });
    expect(decide(started(), at(18.4), 8)).toEqual({ kind: "wait" });
  });

  it("arrival beats timeout on the same pump", () => {
    const s = started();
    expect(decide(s, at(19.5), s.deadline + 10)).toEqual({ kind: "arrived" });
  });

  it("waits while making progress", () => {
    const s = started();
    // 0.6 blocks per pump for ~25 s: never stuck, never arrived (stays below 18).
    for (let i = 1; i <= 29; i++) expect(decide(s, at(i * 0.6), i * 4)).toEqual({ kind: "wait" });
    expect(s.repaths).toBe(0);
  });

  it("re-paths after ~5 s without progress, then resets the stall clock", () => {
    const s = started();
    expect(decide(s, at(5), 4)).toEqual({ kind: "wait" }); // progress at t=4
    expect(decide(s, at(5), 4 + STUCK_TICKS - 4)).toEqual({ kind: "wait" });
    expect(decide(s, at(5), 4 + STUCK_TICKS)).toEqual({ kind: "navigate", repath: true });
    expect(s.repaths).toBe(1);
    expect(onNavResult(s, "full", 4 + STUCK_TICKS)).toBe("ok");
    expect(decide(s, at(5), 8 + STUCK_TICKS)).toEqual({ kind: "wait" });
    // full path: keeps re-pathing on each stall until timeout
    expect(decide(s, at(5), 4 + 2 * STUCK_TICKS)).toEqual({ kind: "navigate", repath: true });
    expect(s.repaths).toBe(2);
  });

  it("jitter smaller than MIN_PROGRESS is not progress", () => {
    const s = started();
    decide(s, at(5), 4);
    decide(s, at(5.3), 50);
    expect(s.lastProgressAt).toBe(4);
  });

  it("partial path that stalls twice is unreachable", () => {
    const s = started(0, at(0), "partial");
    expect(decide(s, at(10), 4)).toEqual({ kind: "wait" });
    expect(decide(s, at(10), 4 + STUCK_TICKS)).toEqual({ kind: "navigate", repath: true });
    onNavResult(s, "partial", 4 + STUCK_TICKS);
    expect(decide(s, at(10), 4 + 2 * STUCK_TICKS)).toEqual({ kind: "unreachable" });
  });

  it("progress after a re-path forgives the earlier stall", () => {
    const s = started(0, at(0), "partial");
    decide(s, at(10), 4);
    decide(s, at(10), 4 + STUCK_TICKS); // stall 1 -> repath
    onNavResult(s, "partial", 4 + STUCK_TICKS);
    decide(s, at(12), 8 + STUCK_TICKS); // progress
    expect(s.stallsSinceProgress).toBe(0);
    expect(decide(s, at(12), 8 + 2 * STUCK_TICKS)).toEqual({ kind: "navigate", repath: true });
  });

  it("times out at the deadline", () => {
    const s = started();
    expect(decide(s, at(1), s.deadline - 1).kind).not.toBe("timeout");
    expect(decide(s, at(1), s.deadline)).toEqual({ kind: "timeout" });
  });

  it("unknown position only checks the deadline", () => {
    const s = started();
    expect(decide(s, undefined, STUCK_TICKS * 3)).toEqual({ kind: "wait" });
    expect(decide(s, undefined, s.deadline)).toEqual({ kind: "timeout" });
  });
});

describe("onNavResult", () => {
  it("no path -> unreachable", () => {
    const s = initGotoState(TARGET, at(0), 0);
    expect(onNavResult(s, "none", 0)).toBe("unreachable");
  });
  it("error -> retry on next pump", () => {
    const s = initGotoState(TARGET, at(0), 0);
    expect(onNavResult(s, "error", 0)).toBe("retry");
    expect(decide(s, at(0), 4)).toEqual({ kind: "navigate", repath: false });
  });
  it("accepted nav resets the progress clock", () => {
    const s = initGotoState(TARGET, at(0), 0);
    onNavResult(s, "full", 60);
    expect(s.lastProgressAt).toBe(60);
    expect(s.navigating).toBe(true);
    expect(decide(s, at(0), 60 + STUCK_TICKS - 4)).toEqual({ kind: "wait" });
  });
});

// ---------- GotoExecutor (imperative shell) against a fake body ----------


function fakeBody(pos = at(0)) {
  const b = {
    pos: pos as ReturnType<BotBody["location"]>,
    onGround: true,
    navResult: { pathLength: 3, isFullPath: true } as ReturnType<BotBody["navigateTo"]>,
    navs: 0,
    stops: 0,
  };
  const body: BotBody = {
    id: "e1",
    name: "Bot-1",
    isValid: () => true,
    location: () => b.pos && { ...b.pos },
    isOnGround: () => b.onGround,
    navigateTo: () => {
      b.navs++;
      return b.navResult;
    },
    stop: () => void b.stops++,
    respawn: () => true,
    disconnect: () => {},
  };
  return { b, body };
}

const task: GotoTask = { id: "t1", kind: "goto", target: TARGET, issuer: { id: "p", name: "P" }, createdAt: 0 };

describe("GotoExecutor", () => {
  it("navigates on the first step and reports arrival exactly once", () => {
    const { b, body } = fakeBody();
    const ex = new GotoExecutor(body, task);
    expect(ex.step(4)).toEqual({ kind: "running" });
    expect(b.navs).toBe(1);
    b.pos = at(19);
    expect(ex.step(8)).toEqual({ kind: "done" });
    expect(b.stops).toBe(1);
    expect(ex.step(12)).toEqual({ kind: "running" });
    ex.cancel(); // after settling: no-op
    expect(b.stops).toBe(1);
  });

  it("cancel stops movement once; later steps never move the body or report", () => {
    const { b, body } = fakeBody();
    const ex = new GotoExecutor(body, task);
    ex.step(4);
    ex.cancel();
    ex.cancel();
    expect(b.stops).toBe(1);
    b.pos = at(20); // at target
    for (let t = 8; t < 2000; t += 4) expect(ex.step(t)).toEqual({ kind: "running" });
    expect(b.navs).toBe(1);
    expect(b.stops).toBe(1);
  });

  it("no-path navigation result -> failed(unreachable) and stops", () => {
    const { b, body } = fakeBody();
    b.navResult = { pathLength: 0, isFullPath: false };
    const ex = new GotoExecutor(body, task);
    expect(ex.step(4)).toEqual({ kind: "failed", reason: "unreachable" });
    expect(b.stops).toBe(1);
    expect(ex.step(8)).toEqual({ kind: "running" });
  });

  it("waits for the ground before navigating; nav errors retry", () => {
    const { b, body } = fakeBody();
    b.onGround = false;
    const ex = new GotoExecutor(body, task);
    ex.step(4);
    ex.step(8);
    expect(b.navs).toBe(0);
    b.onGround = true;
    b.navResult = undefined; // call threw
    expect(ex.step(12)).toEqual({ kind: "running" });
    b.navResult = { pathLength: 3, isFullPath: true };
    ex.step(16);
    expect(b.navs).toBe(2);
  });

  it("times out at 200 + 20 x start distance after the first step", () => {
    const { body } = fakeBody();
    const ex = new GotoExecutor(body, task);
    const start = 100;
    ex.step(start);
    const deadline = start + timeoutTicks(20);
    let t = start + 4;
    for (; t < deadline; t += 4) expect(ex.step(t).kind).toBe("running");
    expect(ex.step(deadline)).toEqual({ kind: "failed", reason: "timeout" });
  });

  it("unreadable start position gives up after the base timeout", () => {
    const { b, body } = fakeBody();
    b.pos = undefined;
    const ex = new GotoExecutor(body, task);
    expect(ex.step(0).kind).toBe("running");
    expect(ex.step(196).kind).toBe("running");
    expect(ex.step(200)).toEqual({ kind: "failed", reason: "timeout" });
  });
});
