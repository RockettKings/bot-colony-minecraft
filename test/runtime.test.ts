// Runtime (imperative shell) tests against a fake @minecraft world. Each test gets a fresh module graph,
// so the runtime singleton, its interval and subscriptions start clean.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColonyRuntime } from "../src/game/runtime.js";
import type { Sender, Vec3 } from "../src/core/types.js";

// ---------- fake game ----------

interface FakeSim {
  id: string;
  name: string;
  isValid: boolean;
  location: Vec3;
  isOnGround: boolean;
  navTargets: Vec3[];
  stops: number;
  respawnOk: boolean;
  respawns: number;
  disconnected: boolean;
  /** What navigateToLocation does: full/partial path, empty path, or throw. */
  nav: "full" | "partial" | "none" | "throw";
  navigateToLocation(t: Vec3): { isFullPath: boolean; getPath(): Vec3[] };
  stopMoving(): void;
  respawn(): boolean;
  disconnect(): void;
}

const g = vi.hoisted(() => {
  const state = {
    tick: 0,
    deferred: [] as Array<() => void>,
    intervals: [] as Array<{ cb: () => void; every: number }>,
    chatSubs: [] as Array<(ev: { message: string; sender: unknown; cancel: boolean }) => void>,
    dieSubs: [] as Array<(ev: { deadEntity: { id: string } }) => void>,
    startupSubs: 0,
    broadcasts: [] as string[],
    players: [] as Array<{ id: string; name: string; location: Vec3; dimension: unknown; inbox: string[]; sendMessage(m: string): void }>,
    sims: [] as FakeSim[],
    spawnThrows: undefined as string | undefined,
    /** Number of upcoming system.currentTick reads that throw. */
    tickThrows: 0,
    broadcastThrows: false,
    nextEntity: 1,
  };
  return state;
});

function makeSim(name: string, at: Vec3): FakeSim {
  const sim: FakeSim = {
    id: `e${g.nextEntity++}`,
    name,
    isValid: true,
    location: { ...at },
    isOnGround: true,
    navTargets: [],
    stops: 0,
    respawnOk: true,
    respawns: 0,
    disconnected: false,
    nav: "full",
    navigateToLocation(t) {
      if (sim.nav === "throw") throw new Error("not on ground");
      sim.navTargets.push({ ...t });
      if (sim.nav === "none") return { isFullPath: false, getPath: () => [] };
      return { isFullPath: sim.nav === "full", getPath: () => [t] };
    },
    stopMoving() {
      sim.stops++;
    },
    respawn() {
      sim.respawns++;
      return sim.respawnOk;
    },
    disconnect() {
      sim.disconnected = true;
      sim.isValid = false;
    },
  };
  return sim;
}

vi.mock("@minecraft/server", () => {
  class Player {}
  return {
    Player,
    GameMode: { Survival: "Survival" },
    CommandPermissionLevel: { Any: 0 },
    CustomCommandParamType: { String: 0 },
    CustomCommandStatus: { Success: 0, Failure: 1 },
    system: {
      get currentTick() {
        if (g.tickThrows > 0) {
          g.tickThrows--;
          throw new Error("clock unavailable");
        }
        return g.tick;
      },
      run: (cb: () => void) => {
        g.deferred.push(cb);
        return g.deferred.length;
      },
      runInterval: (cb: () => void, every: number) => {
        g.intervals.push({ cb, every });
        return g.intervals.length;
      },
      beforeEvents: { startup: { subscribe: () => void g.startupSubs++ } },
    },
    world: {
      beforeEvents: { chatSend: { subscribe: (cb: (typeof g.chatSubs)[number]) => g.chatSubs.push(cb) } },
      afterEvents: { entityDie: { subscribe: (cb: (typeof g.dieSubs)[number]) => g.dieSubs.push(cb) } },
      sendMessage: (m: string) => {
        if (g.broadcastThrows) throw new Error("sendMessage failed");
        g.broadcasts.push(m);
      },
      getAllPlayers: () => g.players,
      getDimension: () => ({ id: "overworld" }),
    },
  };
});

vi.mock("@minecraft/server-gametest", () => ({
  spawnSimulatedPlayer: (loc: Vec3, name: string) => {
    if (g.spawnThrows) throw new Error(g.spawnThrows);
    const sim = makeSim(name, { x: loc.x, y: loc.y, z: loc.z });
    g.sims.push(sim);
    return sim;
  },
}));

// ---------- harness ----------

let rt: ColonyRuntime;
let mod: typeof import("../src/game/runtime.js");

function addPlayer(id: string, name: string, location: Vec3) {
  const p = {
    id,
    name,
    location: { ...location },
    dimension: { id: "overworld" },
    inbox: [] as string[],
    sendMessage(m: string) {
      p.inbox.push(m);
    },
  };
  g.players.push(p);
  return p;
}

const sender = (p: { id: string; name: string; location: Vec3 }): Sender => ({ id: p.id, name: p.name, pos: { ...p.location } });

/** Advance game time and run the pump each interval. */
function advance(ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    g.tick++;
    for (const iv of g.intervals) if (g.tick % iv.every === 0) iv.cb();
  }
}

function flushDeferred(): void {
  for (let cb = g.deferred.shift(); cb; cb = g.deferred.shift()) cb();
}

const lastSim = (): FakeSim => {
  const s = g.sims.at(-1);
  if (!s) throw new Error("no sim spawned");
  return s;
};

beforeEach(async () => {
  g.tick = 100;
  g.deferred.length = 0;
  g.intervals.length = 0;
  g.chatSubs.length = 0;
  g.dieSubs.length = 0;
  g.startupSubs = 0;
  g.broadcasts.length = 0;
  g.players.length = 0;
  g.sims.length = 0;
  g.spawnThrows = undefined;
  g.tickThrows = 0;
  g.broadcastThrows = false;
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  mod = await import("../src/game/runtime.js");
  rt = mod.startColonyRuntime();
});

/** Alice spawns Bot-1 next to herself. */
function withBot() {
  const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
  rt.submitText(sender(alice), "!spawn");
  const sim = lastSim();
  return { alice, sim };
}

// ---------- tests ----------

describe("startColonyRuntime", () => {
  it("is idempotent: one instance, one pump interval, one set of subscriptions", () => {
    expect(mod.startColonyRuntime()).toBe(rt);
    expect(mod.getRuntime()).toBe(rt);
    expect(g.intervals).toEqual([{ cb: expect.any(Function), every: 4 }]);
    expect(g.chatSubs).toHaveLength(1);
    expect(g.dieSubs).toHaveLength(1);
    expect(g.startupSubs).toBe(1);
  });
});

describe("chat front-end", () => {
  it("cancels ! commands and defers them; leaves ordinary chat alone", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    const sub = g.chatSubs[0];
    if (!sub) throw new Error("no chat sub");
    const plain = { message: "hello", sender: alice, cancel: false };
    sub(plain);
    expect(plain.cancel).toBe(false);
    expect(g.deferred).toHaveLength(0);

    const cmd = { message: "!status", sender: alice, cancel: false };
    sub(cmd);
    expect(cmd.cancel).toBe(true);
    expect(alice.inbox).toEqual([]); // nothing runs inside the before-event
    flushDeferred();
    expect(alice.inbox.some((l) => l.includes("[Colony]") && l.includes("No bots yet"))).toBe(true);
  });
});

describe("spawn", () => {
  it("spawn effect registers the bot within the same submit (reentrant event drained)", () => {
    const { alice, sim } = withBot();
    expect(rt.botIds()).toEqual([sim.id]);
    expect(rt.snapshot().bots).toEqual([{ id: sim.id, name: "Bot-1", state: "idle" }]);
    expect(alice.inbox.some((l) => l.includes("Spawning Bot-1"))).toBe(true);
    expect(g.broadcasts.some((l) => l.includes("Bot-1 joined"))).toBe(true);
  });

  it("spawn failure is reported to the requester and frees the slot", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    g.spawnThrows = "cheats off";
    rt.submitText(sender(alice), "!spawn");
    expect(alice.inbox.some((l) => l.includes("Couldn't spawn Bot-1") && l.includes("cheats off"))).toBe(true);
    expect(rt.snapshot().bots).toEqual([]);
    g.spawnThrows = undefined;
    advance(40);
    rt.submitText(sender(alice), "!spawn");
    expect(rt.snapshot().bots.map((b) => b.name)).toEqual(["Bot-1"]);
  });
});

describe("goto lifecycle", () => {
  it("assign -> navigate -> arrival -> done report -> bot idle, bot speaks as <name>", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    const snap = rt.snapshot();
    expect(snap.bots[0]).toMatchObject({ state: "busy", task: { id: "t1", target: { x: 10, y: 64, z: 0 } } });

    advance(4);
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
    sim.location = { x: 9.5, y: 64, z: 0 };
    advance(4);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
    expect(alice.inbox).toContain("<Bot-1> Arrived at 10 64 0.");
  });

  it("queued task is assigned when the bot frees, in the same pump", () => {
    const { alice, sim } = withBot();
    const bob = addPlayer("pB", "Bob", { x: 5, y: 64, z: 5 });
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    rt.submitText(sender(bob), "!goto 20 64 0");
    rt.submitText(sender(bob), "!queue");
    expect(rt.snapshot().queued.map((t) => t.id)).toEqual(["t2"]);
    sim.location = { x: 10, y: 64, z: 0 };
    advance(4);
    expect(rt.snapshot()).toMatchObject({ queued: [], bots: [{ state: "busy", task: { id: "t2" } }] });
    advance(4);
    expect(sim.navTargets.at(-1)).toEqual({ x: 20, y: 64, z: 0 });
  });
});

describe("cancel", () => {
  it("!stop stops the body and a cancelled task never reports later", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4);
    advance(40);
    rt.submitText(sender(alice), "!stop");
    expect(sim.stops).toBeGreaterThan(0);
    sim.location = { x: 10, y: 64, z: 0 }; // would count as arrival if the executor were still alive
    advance(20);
    expect(alice.inbox.some((l) => l.includes("Arrived"))).toBe(false);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
  });

  it("own-task preemption: old executor cancelled before the new one starts; only the new task reports", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4);
    advance(40);
    rt.submitText(sender(alice), "!goto -10 64 0");
    expect(rt.snapshot().bots[0]?.task?.id).toBe("t2");
    sim.location = { x: 10, y: 64, z: 0 };
    advance(8);
    expect(alice.inbox.some((l) => l.includes("Arrived at 10 64 0"))).toBe(false);
    expect(rt.snapshot().bots[0]?.task?.id).toBe("t2");
    sim.location = { x: -10, y: 64, z: 0 };
    advance(4);
    expect(alice.inbox).toContain("<Bot-1> Arrived at -10 64 0.");
  });
});

describe("bot death", () => {
  it("reports failed(bot_died), frees the bot, then respawns after the delay", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4);
    g.dieSubs[0]?.({ deadEntity: { id: sim.id } });
    expect(alice.inbox).toContain("<Bot-1> Couldn't reach 10 64 0: I died.");
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
    expect(sim.respawns).toBe(0);
    advance(24);
    expect(sim.respawns).toBe(1);
    expect(rt.botIds()).toEqual([sim.id]);
  });

  it("a task assigned while dead waits for the respawn, then runs", () => {
    const { alice, sim } = withBot();
    g.dieSubs[0]?.({ deadEntity: { id: sim.id } });
    advance(40);
    sim.navTargets.length = 0;
    rt.submitText(sender(alice), "!goto 10 64 0");
    expect(rt.snapshot().bots[0]?.state).toBe("busy");
    // respawn happened at the first pump >= death+20; the executor steps on later pumps
    advance(8);
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
  });

  it("gives up after repeated respawn failures: disconnects and removes the bot once", () => {
    const { alice, sim } = withBot();
    sim.respawnOk = false;
    g.dieSubs[0]?.({ deadEntity: { id: sim.id } }); // tick 100: attempts at 120, 140, 160, 180, 200
    advance(30);
    rt.submitText(sender(alice), "!goto 10 64 0"); // assigned while dead
    advance(69); // 199
    expect(sim.respawns).toBe(4);
    expect(rt.botIds()).toEqual([sim.id]);
    advance(101);
    expect(sim.respawns).toBe(5);
    expect(sim.disconnected).toBe(true);
    expect(rt.botIds()).toEqual([]);
    expect(rt.snapshot().bots).toEqual([]);
    expect(g.broadcasts.filter((l) => l.includes("Bot-1 left"))).toEqual(["§7[Colony]§r Bot-1 left (couldn't respawn)."]);
    expect(rt.snapshot().queued.map((t) => t.id)).toEqual(["t1"]); // assigned while dead -> requeued, not reported
  });

  it("death of an unknown entity is ignored", () => {
    withBot();
    g.dieSubs[0]?.({ deadEntity: { id: "nope" } });
    advance(40);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
  });
});

describe("invalid entity", () => {
  it("emits botRemoved exactly once and the core requeues its task", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    sim.isValid = false;
    advance(12);
    expect(rt.botIds()).toEqual([]);
    expect(rt.snapshot()).toMatchObject({ bots: [], queued: [{ id: "t1" }] });
    expect(g.broadcasts.filter((l) => l.includes("Bot-1 left"))).toHaveLength(1);
    expect(alice.inbox.some((l) => l.includes("Bot-1 left; your task"))).toBe(true);
  });

  it("a bot removed in the same pump that frees another bot doesn't get the queue head", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "!spawn");
    const s1 = lastSim();
    advance(40);
    rt.submitText(sender(alice), "!spawn");
    const s2 = lastSim();
    const bob = addPlayer("pB", "Bob", { x: 0, y: 64, z: 0 });
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0 2"); // both busy (t1 on s1, t2 on s2)
    rt.submitText(sender(bob), "!goto 30 64 0");
    rt.submitText(sender(bob), "!queue"); // t3 queued
    s1.location = { x: 10, y: 64, z: 0 }; // s1 arrives ...
    s2.isValid = false; // ... and s2 vanishes in the same pump
    advance(4);
    const snap = rt.snapshot();
    expect(snap.bots.map((b) => b.id)).toEqual([s1.id]);
    // Removals reach the core before reports: t2 is requeued at the FRONT, then s1 frees and takes it.
    expect(snap.bots[0]?.task?.id).toBe("t2");
    expect(snap.queued.map((t) => t.id)).toEqual(["t3"]);
    expect(g.broadcasts.filter((l) => l.includes("Bot-2 left"))).toEqual(["§7[Colony]§r Bot-2 left (gone)."]);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("assign to unknown bot"));
  });
});

describe("replies", () => {
  it("replies to unknown/offline player ids are dropped; broadcasts use world.sendMessage", () => {
    const ghost: Sender = { id: "offline", name: "Ghost", pos: { x: 0, y: 64, z: 0 } };
    rt.submitText(ghost, "!status");
    rt.submitText(ghost, "!help");
    expect(g.broadcasts).toEqual([]);
  });

  it("ordinary chat and parse errors don't reach the colony", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "hello");
    expect(alice.inbox).toEqual([]);
    rt.submitText(sender(alice), "!goto 1 2");
    expect(alice.inbox.map((l) => l.replace("§7[Colony]§r ", ""))).toEqual(["Missing z coordinate.", "Usage: !goto <x> <y> <z> [count]"]);
  });
});

describe("adoptBot", () => {
  it("registers an existing simulated player once, and drains the queue onto it", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    const sim = makeSim("GT-1", { x: 0, y: 64, z: 0 });
    const asPlayer = sim as unknown as Parameters<ColonyRuntime["adoptBot"]>[0];
    const id = rt.adoptBot(asPlayer, "GT-1");
    expect(rt.adoptBot(asPlayer, "GT-1")).toBe(id);
    expect(rt.botIds()).toEqual([id]);
    expect(g.broadcasts.filter((l) => l.includes("GT-1 joined"))).toHaveLength(1);
    rt.submitText(sender(alice), "!goto 3 64 3");
    expect(rt.snapshot().bots[0]).toMatchObject({ id, state: "busy", task: { target: { x: 3, y: 64, z: 3 } } });
  });
});

describe("executor robustness", () => {
  it("a task whose bot position is never readable fails instead of staying busy forever", () => {
    const { alice, sim } = withBot();
    Object.defineProperty(sim, "location", {
      get() {
        throw new Error("unreadable");
      },
    });
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(400);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
    expect(alice.inbox.some((l) => l.startsWith("<Bot-1> Couldn't reach 10 64 0"))).toBe(true);
  });
});

// ---------- added: spec bullets and robustness ----------

describe("runtime singleton", () => {
  it("getRuntime is undefined until startColonyRuntime runs", async () => {
    vi.resetModules();
    const fresh = await import("../src/game/runtime.js");
    expect(fresh.getRuntime()).toBeUndefined();
    const r = fresh.startColonyRuntime();
    expect(fresh.getRuntime()).toBe(r);
    expect(fresh.startColonyRuntime()).toBe(r);
  });
});

describe("goto executor in the runtime", () => {
  it("no-path navigation result fails the task as unreachable, stops the body, reports once", () => {
    const { alice, sim } = withBot();
    sim.nav = "none";
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    const stops = sim.stops;
    advance(4);
    expect(alice.inbox).toContain("<Bot-1> Couldn't reach 10 64 0: no path.");
    expect(sim.stops).toBe(stops + 1);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
    advance(400);
    expect(alice.inbox.filter((l) => l.includes("Couldn't reach"))).toHaveLength(1);
  });

  it("re-paths every ~5 s (100 ticks) without progress and times out at 200 + 20 x distance ticks", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0"); // tick 140, distance 10
    advance(4); // tick 144: first step, deadline = 144 + 200 + 200 = 544
    expect(sim.navTargets).toHaveLength(1);
    advance(99); // 243
    expect(sim.navTargets).toHaveLength(1);
    advance(1); // 244: stuck for 100 ticks -> re-path
    expect(sim.navTargets).toHaveLength(2);
    advance(299); // 543
    expect(sim.navTargets).toHaveLength(4); // re-paths at 344, 444
    expect(alice.inbox.some((l) => l.includes("timed out"))).toBe(false);
    expect(rt.snapshot().bots[0]?.state).toBe("busy");
    advance(1); // 544
    expect(alice.inbox).toContain("<Bot-1> Couldn't reach 10 64 0: timed out.");
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
  });

  it("a partial path that stalls again after a re-path fails as unreachable before the timeout", () => {
    const { alice, sim } = withBot();
    sim.nav = "partial";
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4); // 144: partial nav
    advance(100); // 244: stall 1 -> re-path
    expect(sim.navTargets).toHaveLength(2);
    expect(rt.snapshot().bots[0]?.state).toBe("busy");
    advance(100); // 344: stall 2 -> unreachable (deadline would be 544)
    expect(alice.inbox).toContain("<Bot-1> Couldn't reach 10 64 0: no path.");
  });

  it("doesn't request navigation while airborne; starts once on the ground", () => {
    const { alice, sim } = withBot();
    sim.isOnGround = false;
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(20);
    expect(sim.navTargets).toEqual([]);
    sim.isOnGround = true;
    advance(4);
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
  });

  it("a throwing navigation call is retried on the next pump, not treated as unreachable", () => {
    const { alice, sim } = withBot();
    sim.nav = "throw";
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(12);
    expect(rt.snapshot().bots[0]?.state).toBe("busy");
    sim.nav = "full";
    advance(4);
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
    expect(alice.inbox.some((l) => l.includes("Couldn't reach"))).toBe(false);
  });
});

describe("cancel vs arrival in the same tick", () => {
  it("stop processed before the pump: no arrival report, ever", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0"); // 140
    advance(23); // 163 (last pump at 160)
    sim.location = { x: 10, y: 64, z: 0 };
    rt.submitText(sender(alice), "!stop");
    advance(1); // pump at 164 sees the bot at the target
    advance(40);
    expect(alice.inbox).toContain("§7[Colony]§r Stopped 1 task, dropped 0 queued.");
    expect(alice.inbox.some((l) => l.includes("Arrived"))).toBe(false);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
  });

  it("pump before the stop: exactly one arrival, and the stop finds nothing", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(23);
    sim.location = { x: 10, y: 64, z: 0 };
    advance(1); // 164: arrival
    rt.submitText(sender(alice), "!stop");
    advance(40);
    expect(alice.inbox.filter((l) => l.includes("Arrived"))).toEqual(["<Bot-1> Arrived at 10 64 0."]);
    expect(alice.inbox).toContain("§7[Colony]§r You have no active or queued tasks.");
  });
});

describe("reassign mid-navigation (override)", () => {
  it("stops the old navigation, starts the new one, old task never reports, old owner's task resumes after", () => {
    const { alice, sim } = withBot();
    const bob = addPlayer("pB", "Bob", { x: 5, y: 64, z: 5 });
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0"); // t1
    advance(20); // 160, navigating to t1
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
    rt.submitText(sender(bob), "!come");
    expect(bob.inbox.some((l) => l.includes("!override"))).toBe(true);
    const stops = sim.stops;
    rt.submitText(sender(bob), "!override"); // cancel(t1, preempted) then assign(t2)
    expect(sim.stops).toBe(stops + 1);
    expect(alice.inbox).toContain("§7[Colony]§r Bot-1 was reassigned by Bob; your task (go to 10 64 0) is queued.");
    advance(4);
    expect(sim.navTargets.at(-1)).toEqual({ x: 5, y: 64, z: 5 });
    sim.location = { x: 10, y: 64, z: 0 }; // t1's target: the dead executor must not report
    advance(8);
    expect(alice.inbox.some((l) => l.includes("Arrived"))).toBe(false);
    sim.location = { x: 5, y: 64, z: 5 };
    advance(4);
    expect(bob.inbox).toContain("<Bot-1> Arrived at 5 64 5.");
    expect(alice.inbox).toContain("<Bot-1> Picking up your queued task: going to 10 64 0.");
    expect(rt.snapshot().bots[0]?.task?.id).toBe("t1");
  });
});

describe("pump robustness", () => {
  it("an exception inside the pump doesn't escape or kill the interval", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    g.tickThrows = 1;
    expect(() => advance(4)).not.toThrow();
    expect(sim.navTargets).toEqual([]);
    advance(4);
    expect(sim.navTargets).toEqual([{ x: 10, y: 64, z: 0 }]);
    sim.location = { x: 10, y: 64, z: 0 };
    advance(4);
    expect(alice.inbox).toContain("<Bot-1> Arrived at 10 64 0.");
  });

  it("a throwing executor fails only its own task (reason error); other bots in the same pump still step", async () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "!spawn");
    const s1 = lastSim();
    advance(40);
    rt.submitText(sender(alice), "!spawn");
    const s2 = lastSim();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0 2");
    const ge = await import("../src/game/bots/goto-executor.js");
    vi.spyOn(ge.GotoExecutor.prototype, "step").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    s2.location = { x: 10, y: 64, z: 0 };
    const stops = s1.stops;
    advance(4);
    expect(alice.inbox).toContain("<Bot-1> Couldn't reach 10 64 0: something went wrong.");
    expect(alice.inbox).toContain("<Bot-2> Arrived at 10 64 0.");
    expect(s1.stops).toBe(stops + 1);
    expect(rt.snapshot().bots.map((b) => b.state)).toEqual(["idle", "idle"]);
  });

  it("a failing world.sendMessage doesn't block later effects", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    g.broadcastThrows = true;
    rt.submitText(sender(alice), "!spawn"); // the "joined" broadcast throws
    expect(rt.botIds()).toHaveLength(1);
    advance(40);
    rt.submitText(sender(alice), "!goto 3 64 0");
    expect(alice.inbox).toContain("<Bot-1> On my way to 3 64 0.");
  });
});

describe("bot death: exactly one report", () => {
  it("arrival in the pump, then death in the same tick: only the arrival is reported", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(23);
    sim.location = { x: 10, y: 64, z: 0 };
    advance(1);
    g.dieSubs[0]?.({ deadEntity: { id: sim.id } });
    advance(40);
    expect(alice.inbox.filter((l) => l.startsWith("<Bot-1> Arrived") || l.includes("I died"))).toEqual([
      "<Bot-1> Arrived at 10 64 0.",
    ]);
    expect(sim.respawns).toBe(1);
  });

  it("death, then the (dead) body is at the target: only bot_died is reported", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4);
    g.dieSubs[0]?.({ deadEntity: { id: sim.id } });
    sim.location = { x: 10, y: 64, z: 0 };
    advance(40);
    expect(alice.inbox.filter((l) => l.startsWith("<Bot-1> Arrived") || l.includes("I died"))).toEqual([
      "<Bot-1> Couldn't reach 10 64 0: I died.",
    ]);
  });

  it("an entityDie event whose entity can't be read is ignored without throwing", () => {
    withBot();
    const unreadable = Object.defineProperty({}, "id", {
      get() {
        throw new Error("invalid entity");
      },
    }) as { id: string };
    expect(() => g.dieSubs[0]?.({ deadEntity: unreadable })).not.toThrow();
    advance(8);
    expect(rt.botIds()).toHaveLength(1);
  });
});

describe("offline players", () => {
  it("a report to an issuer who went offline is dropped; the bot is still freed", () => {
    const { alice, sim } = withBot();
    advance(40);
    rt.submitText(sender(alice), "!goto 10 64 0");
    advance(4);
    g.players.splice(g.players.indexOf(alice), 1);
    sim.location = { x: 10, y: 64, z: 0 };
    advance(4);
    expect(alice.inbox.some((l) => l.includes("Arrived"))).toBe(false);
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
    expect(console.error).not.toHaveBeenCalled();
  });
});
