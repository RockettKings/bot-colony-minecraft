// Phase 2 runtime wiring (Job 6): executor registry dispatch, taskProgress emission (only on change, before
// the report), chest effects -> events, recentReplies. The engine, the adapter, the world port and the
// executors are all fakes, so these tests don't depend on the engine mock growing a voxel world.
// Each test gets a fresh module graph (runtime singleton, interval, subscriptions start clean).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColonyRuntime } from "../src/game/runtime.js";
import type { ChestRef, ColonyEvent, ItemCount, Sender, Task, TaskProgress, Vec3 } from "../src/core/types.js";
import type { ExecutorContext, StepResult, TaskExecutor } from "../src/game/bots/executor.js";
import type { ChestLocateResult } from "../src/game/adapter/world.js";

// ---------- fakes ----------

interface FakeExec extends TaskExecutor {
  ctx: ExecutorContext;
  steps: number;
  cancels: number;
  /** What progress() returns; a function lets a test make it throw. */
  prog: TaskProgress | undefined | (() => TaskProgress | undefined);
  /** Next step result (consumed once; then running). */
  next?: StepResult;
}

interface FakeBody {
  id: string;
  name: string;
  valid: boolean;
  dim: string | undefined;
}

const h = vi.hoisted(() => {
  const state = {
    tick: 0,
    intervals: [] as Array<{ cb: () => void; every: number }>,
    dieSubs: [] as Array<(ev: { deadEntity: { id: string } }) => void>,
    broadcasts: [] as string[],
    players: [] as Array<{ id: string; name: string; location: Vec3; dimension: unknown; inbox: string[]; sendMessage(m: string): void }>,
    bodies: [] as FakeBody[],
    execs: [] as FakeExec[],
    nextEntity: 1,
    /** Initial progress for new fake executors. */
    initialProgress: undefined as TaskProgress | undefined,
    // world.js fakes
    locateCalls: [] as Array<{ player: unknown; near: Vec3 }>,
    locate: (() => ({ ok: false, reason: "none_found" })) as () => ChestLocateResult,
    readCalls: [] as ChestRef[],
    read: (() => []) as () => ItemCount[] | undefined,
    portCalls: [] as string[],
  };
  return state;
});

function makeExec(task: Task, ctx: ExecutorContext): FakeExec {
  const ex: FakeExec = {
    taskId: task.id,
    task,
    ctx,
    steps: 0,
    cancels: 0,
    prog: h.initialProgress ? { ...h.initialProgress } : undefined,
    step() {
      ex.steps++;
      const r = ex.next ?? { kind: "running" };
      ex.next = undefined;
      return r;
    },
    cancel() {
      ex.cancels++;
    },
    progress() {
      return typeof ex.prog === "function" ? ex.prog() : ex.prog;
    },
  };
  h.execs.push(ex);
  return ex;
}

function makeBody(id: string, name: string): FakeBody & Record<string, unknown> {
  const b = {
    id,
    name,
    valid: true,
    dim: "minecraft:overworld" as string | undefined,
    isValid: () => b.valid,
    location: () => ({ x: 0, y: 64, z: 0 }),
    isOnGround: () => true,
    navigateTo: () => ({ isFullPath: true, path: [] }),
    stop: () => {},
    respawn: () => true,
    disconnect: () => {
      b.valid = false;
    },
    dimensionId: () => b.dim,
  };
  h.bodies.push(b);
  return b;
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
        return h.tick;
      },
      run: (cb: () => void) => {
        cb();
        return 1;
      },
      runInterval: (cb: () => void, every: number) => {
        h.intervals.push({ cb, every });
        return h.intervals.length;
      },
      beforeEvents: { startup: { subscribe: () => {} } },
    },
    world: {
      beforeEvents: { chatSend: { subscribe: () => {} } },
      afterEvents: { entityDie: { subscribe: (cb: (typeof h.dieSubs)[number]) => h.dieSubs.push(cb) } },
      sendMessage: (m: string) => void h.broadcasts.push(m),
      getAllPlayers: () => h.players,
      getDimension: () => ({ id: "minecraft:overworld" }),
    },
  };
});

vi.mock("@minecraft/server-gametest", () => ({ spawnSimulatedPlayer: () => ({}) }));

vi.mock("../src/game/adapter/index.js", () => ({
  spawnBot: (_where: unknown, name: string) => ({ ok: true, body: makeBody(`e${h.nextEntity++}`, name) }),
  wrapSimulatedPlayer: (p: { id: string }, name: string) => makeBody(p.id, name),
}));

vi.mock("../src/game/adapter/world.js", () => ({
  OVERWORLD: "minecraft:overworld",
  createWorldPort: (dim: string) => {
    h.portCalls.push(dim);
    return { dimensionId: dim };
  },
  locateChest: (player: unknown, near: Vec3) => {
    h.locateCalls.push({ player, near });
    return h.locate();
  },
  readChest: (chest: ChestRef) => {
    h.readCalls.push(chest);
    return h.read();
  },
}));

vi.mock("../src/game/bots/registry.js", () => ({
  EXECUTORS: { goto: makeExec, gather: makeExec },
}));

// ---------- harness ----------

let rt: ColonyRuntime;
let mod: typeof import("../src/game/runtime.js");
/** Every event the colony core received, in order. */
let seen: ColonyEvent[];

function addPlayer(id: string, name: string, location: Vec3) {
  const p = {
    id,
    name,
    location: { ...location },
    dimension: { id: "minecraft:overworld" },
    inbox: [] as string[],
    sendMessage(m: string) {
      p.inbox.push(m);
    },
  };
  h.players.push(p);
  return p;
}

const sender = (p: { id: string; name: string; location: Vec3 }): Sender => ({ id: p.id, name: p.name, pos: { ...p.location } });
const ghost = (id: string): Sender => ({ id, name: `GT-${id}`, pos: { x: 1, y: 64, z: 1 } });

function advance(ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    h.tick++;
    for (const iv of h.intervals) if (h.tick % iv.every === 0) iv.cb();
  }
}

const lastExec = (): FakeExec => {
  const e = h.execs.at(-1);
  if (!e) throw new Error("no executor created");
  return e;
};

const CHEST: ChestRef = { dimensionId: "minecraft:overworld", pos: { x: 3, y: 64, z: -2 } };
const kinds = (pred: (e: ColonyEvent) => boolean = () => true) => seen.filter(pred).map((e) => e.kind);
const notTick = (e: ColonyEvent) => e.kind !== "tick";

beforeEach(async () => {
  h.tick = 100;
  h.intervals.length = 0;
  h.dieSubs.length = 0;
  h.broadcasts.length = 0;
  h.players.length = 0;
  h.bodies.length = 0;
  h.execs.length = 0;
  h.nextEntity = 1;
  h.initialProgress = undefined;
  h.locateCalls.length = 0;
  h.locate = () => ({ ok: true, chest: { dimensionId: CHEST.dimensionId, pos: { ...CHEST.pos } } });
  h.readCalls.length = 0;
  h.read = () => [];
  h.portCalls.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  mod = await import("../src/game/runtime.js");
  const core = await import("../src/core/colony/index.js");
  seen = [];
  const orig = core.Colony.prototype.handle;
  vi.spyOn(core.Colony.prototype, "handle").mockImplementation(function (this: InstanceType<typeof core.Colony>, e: ColonyEvent) {
    seen.push(e);
    return orig.call(this, e);
  });
  rt = mod.startColonyRuntime();
});

/** Alice with one bot (Bot-1), past the command cooldown. */
function withBot() {
  const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
  rt.submitText(sender(alice), "!spawn");
  const body = h.bodies.at(-1);
  if (!body) throw new Error("no bot");
  advance(40);
  return { alice, body };
}

/** Alice + Bot-1 running a goto task with a fake executor (goto exercises the generic wiring without Job 2's gather code). */
function withRunningTask() {
  const ctx = withBot();
  rt.submitText(sender(ctx.alice), "!goto 10 64 0");
  const ex = lastExec();
  return { ...ctx, ex };
}

const progress = (delivered: number, held: number): TaskProgress => ({ kind: "gather", delivered, held });

// ---------- registry ----------

describe("executor registry", () => {
  it("dispatches each task kind to its executor class", async () => {
    const reg = await vi.importActual<typeof import("../src/game/bots/registry.js")>("../src/game/bots/registry.js");
    const { GotoExecutor } = await import("../src/game/bots/goto-executor.js");
    const { GatherExecutor } = await import("../src/game/bots/gather-executor.js");
    const { DEFAULT_GATHER_CONFIG, createExecutor } = await import("../src/game/bots/executor.js");
    const body = makeBody("eX", "X") as unknown as ExecutorContext["body"];
    const ctx: ExecutorContext = { body, world: () => undefined, gather: DEFAULT_GATHER_CONFIG };
    const issuer = { id: "pA", name: "Alice" };
    const goto: Task = { id: "t1", kind: "goto", target: { x: 1, y: 2, z: 3 }, issuer, createdAt: 0 };
    const gather: Task = {
      id: "t2",
      kind: "gather",
      item: "oak_log",
      amount: 6,
      delivered: 0,
      origin: { x: 0, y: 64, z: 0 },
      chest: CHEST,
      issuer,
      createdAt: 0,
    };
    const g1 = createExecutor(reg.EXECUTORS, goto, ctx);
    const g2 = createExecutor(reg.EXECUTORS, gather, ctx);
    expect(g1).toBeInstanceOf(GotoExecutor);
    expect(g1.taskId).toBe("t1");
    expect(g2).toBeInstanceOf(GatherExecutor);
    expect(g2.taskId).toBe("t2");
    expect(g2.task).toBe(gather);
  });

  it("assign builds the executor from EXECUTORS with the bot's body and a lazy world port", async () => {
    const { DEFAULT_GATHER_CONFIG } = await import("../src/game/bots/executor.js");
    const { body, ex } = withRunningTask();
    expect(ex.task).toMatchObject({ kind: "goto", target: { x: 10, y: 64, z: 0 } });
    expect(ex.ctx.body).toBe(body);
    expect(ex.ctx.gather).toBe(DEFAULT_GATHER_CONFIG);
    expect(h.portCalls).toEqual([]); // not resolved at assign
    expect(ex.ctx.world()).toEqual({ dimensionId: "minecraft:overworld" });
    expect(h.portCalls).toEqual(["minecraft:overworld"]);
    body.dim = undefined;
    expect(ex.ctx.world()).toBeUndefined();
    expect(h.portCalls).toHaveLength(1);
  });
});

// ---------- progress ----------

describe("taskProgress", () => {
  it("is emitted after a step when it changes, and only then", () => {
    const { body, ex } = withRunningTask();
    advance(4);
    expect(kinds((e) => e.kind === "taskProgress")).toEqual([]); // undefined progress (goto-like): nothing
    ex.prog = progress(0, 2);
    advance(4);
    advance(4); // unchanged
    ex.prog = progress(0, 2); // equal value, new object: still unchanged
    advance(4);
    ex.prog = progress(2, 0);
    advance(4);
    const ps = seen.filter((e): e is Extract<ColonyEvent, { kind: "taskProgress" }> => e.kind === "taskProgress");
    expect(ps.map((e) => e.progress)).toEqual([progress(0, 2), progress(2, 0)]);
    expect(ps.every((e) => e.botId === body.id && e.taskId === ex.taskId)).toBe(true);
    expect(ps.map((e) => e.now)).toEqual([148, 160]);
  });

  it("is emitted before the step's report, in the same pump", () => {
    const { ex } = withRunningTask();
    advance(4);
    ex.prog = progress(6, 0);
    ex.next = { kind: "done" };
    advance(4);
    expect(kinds((e) => notTick(e) && e.kind !== "command").slice(-2)).toEqual(["taskProgress", "taskReport"]);
    const [p, r] = seen.filter((e) => e.kind === "taskProgress" || e.kind === "taskReport");
    expect(p?.now).toBe(r?.now);
  });

  it("a failed step still reports the final progress first", () => {
    const { ex } = withRunningTask();
    advance(4);
    ex.prog = progress(3, 1);
    ex.next = { kind: "failed", reason: "no_source" };
    advance(4);
    const tail = seen.filter((e) => e.kind === "taskProgress" || e.kind === "taskReport");
    expect(tail).toMatchObject([
      { kind: "taskProgress", progress: progress(3, 1) },
      { kind: "taskReport", outcome: "failed", reason: "no_source" },
    ]);
  });

  it("the emitted value is a copy (later mutation by the executor doesn't leak into the core)", () => {
    const { ex } = withRunningTask();
    const p = progress(1, 1);
    ex.prog = p;
    advance(4);
    p.delivered = 99;
    const ev = seen.find((e) => e.kind === "taskProgress");
    expect(ev && ev.kind === "taskProgress" && ev.progress.delivered).toBe(1);
    advance(4); // the mutated object now differs from the last emitted value -> emitted again
    expect(seen.filter((e) => e.kind === "taskProgress")).toHaveLength(2);
  });

  it("a throwing progress() is logged; the step result is still reported", () => {
    const { ex } = withRunningTask();
    ex.prog = () => {
      throw new Error("boom");
    };
    ex.next = { kind: "done" };
    advance(4);
    expect(kinds((e) => e.kind === "taskProgress")).toEqual([]);
    expect(kinds((e) => e.kind === "taskReport")).toEqual(["taskReport"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("progress()"));
  });

  it("resets on cancel and on a new assignment: the same value is emitted again for the new task", () => {
    h.initialProgress = progress(0, 0);
    const { alice, ex } = withRunningTask();
    advance(4);
    expect(seen.filter((e) => e.kind === "taskProgress").map((e) => (e.kind === "taskProgress" ? e.taskId : ""))).toEqual([ex.taskId]);
    advance(40);
    rt.submitText(sender(alice), "!goto -10 64 0"); // own task preempted: cancel + assign
    const stepsAtCancel = ex.steps;
    const ex2 = lastExec();
    expect(ex2).not.toBe(ex);
    expect(ex.cancels).toBe(1);
    advance(4);
    const ids = seen.filter((e) => e.kind === "taskProgress").map((e) => (e.kind === "taskProgress" ? e.taskId : ""));
    expect(ids).toEqual([ex.taskId, ex2.taskId]);
    expect(ex.steps).toBe(stepsAtCancel); // the cancelled executor is never stepped again
  });

  it("no progress for a bot that died; the dead executor is dropped", () => {
    const { body, ex } = withRunningTask();
    ex.prog = progress(1, 0);
    h.dieSubs[0]?.({ deadEntity: { id: body.id } });
    advance(8);
    expect(kinds((e) => e.kind === "taskProgress")).toEqual([]);
    expect(seen.filter((e) => e.kind === "taskReport")).toMatchObject([{ outcome: "failed", reason: "bot_died" }]);
    expect(ex.steps).toBe(0);
  });
});

// ---------- chest effects ----------

describe("locateChest effect", () => {
  it("!chest set from an online player: locateChest(player, sender pos) -> chestLocated -> colony chest + reply", () => {
    const alice = addPlayer("pA", "Alice", { x: 2, y: 64, z: -1 });
    rt.submitText(sender(alice), "!chest set");
    expect(h.locateCalls).toEqual([{ player: alice, near: { x: 2, y: 64, z: -1 } }]);
    expect(seen.filter((e) => e.kind === "chestLocated")).toMatchObject([{ requestedBy: "pA", chest: CHEST }]);
    expect(rt.snapshot().chest).toEqual(CHEST);
    expect(alice.inbox).toContain("§7[Colony]§r Colony chest set to 3 64 -2.");
  });

  it("a GameTest sender (no online player) passes player undefined", () => {
    rt.submitText(ghost("gt1"), "!chest set");
    expect(h.locateCalls).toEqual([{ player: undefined, near: { x: 1, y: 64, z: 1 } }]);
    expect(rt.snapshot().chest).toEqual(CHEST);
    expect(rt.recentReplies("gt1")).toEqual(["§7[Colony]§r Colony chest set to 3 64 -2."]);
  });

  it("a failure result -> chestLocateFailed with that reason", () => {
    h.locate = () => ({ ok: false, reason: "none_found" });
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "!chest set");
    expect(seen.filter((e) => e.kind === "chestLocateFailed")).toMatchObject([{ requestedBy: "pA", reason: "none_found" }]);
    expect(rt.snapshot().chest).toBeUndefined();
    expect(alice.inbox.some((l) => l.includes("No chest found"))).toBe(true);
  });

  it("a throwing locateChest -> chestLocateFailed(error), logged, nothing escapes", () => {
    h.locate = () => {
      throw new Error("engine");
    };
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    expect(() => rt.submitText(sender(alice), "!chest set")).not.toThrow();
    expect(seen.filter((e) => e.kind === "chestLocateFailed")).toMatchObject([{ reason: "error" }]);
    expect(alice.inbox.some((l) => l.includes("Couldn't look for a chest"))).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("inspectChest effect", () => {
  function withChest() {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "!chest set");
    advance(40);
    alice.inbox.length = 0;
    return alice;
  }

  it("!chest -> readChest(chest) -> chestInspected with the items", () => {
    const alice = withChest();
    h.read = () => [
      { typeId: "minecraft:oak_log", amount: 23 },
      { typeId: "minecraft:cobblestone", amount: 5 },
    ];
    rt.submitText(sender(alice), "!chest");
    expect(h.readCalls).toEqual([CHEST]);
    expect(seen.filter((e) => e.kind === "chestInspected")).toMatchObject([{ to: "pA", chest: CHEST, items: [{ amount: 23 }, { amount: 5 }] }]);
    expect(alice.inbox).toEqual(["§7[Colony]§r Colony chest at 3 64 -2: 23 oak_log, 5 cobblestone"]);
  });

  it("empty and unreadable chests", () => {
    const alice = withChest();
    rt.submitText(sender(alice), "!chest");
    advance(40);
    h.read = () => undefined;
    rt.submitText(sender(alice), "!chest");
    expect(alice.inbox).toEqual([
      "§7[Colony]§r Colony chest at 3 64 -2: empty.",
      "§7[Colony]§r Colony chest at 3 64 -2 can't be read (gone or unloaded).",
    ]);
  });

  it("a throwing readChest -> chestInspected(items undefined)", () => {
    const alice = withChest();
    h.read = () => {
      throw new Error("engine");
    };
    rt.submitText(sender(alice), "!chest");
    const ev = seen.find((e) => e.kind === "chestInspected");
    expect(ev).toMatchObject({ kind: "chestInspected", to: "pA" });
    expect(ev && ev.kind === "chestInspected" && ev.items).toBeUndefined();
    expect(alice.inbox.some((l) => l.includes("can't be read"))).toBe(true);
  });
});

// ---------- gather through the whole loop ----------

describe("gather end to end (fake executor)", () => {
  it("chest set, gather assigned, progress shown in status/snapshot, done report uses delivered", () => {
    const { alice, body } = withBot();
    rt.submitText(sender(alice), "!chest set");
    advance(40);
    rt.submitText(sender(alice), "!gather oak_log 6");
    const ex = lastExec();
    expect(ex.task).toMatchObject({ kind: "gather", item: "oak_log", amount: 6, delivered: 0, chest: CHEST, origin: { x: 0, y: 64, z: 0 } });
    expect(ex.ctx.body).toBe(body);

    ex.prog = progress(2, 1);
    advance(4);
    expect(rt.snapshot().bots[0]?.progress).toEqual(progress(2, 1));
    advance(40);
    alice.inbox.length = 0;
    rt.submitText(sender(alice), "!status");
    expect(alice.inbox.some((l) => l.includes("gathering oak_log 3/6"))).toBe(true);

    ex.prog = progress(7, 0);
    ex.next = { kind: "done" };
    advance(4);
    expect(alice.inbox).toContain("<Bot-1> Delivered 7 oak_log to the chest.");
    expect(rt.snapshot().bots[0]?.state).toBe("idle");
  });
});

// ---------- recentReplies ----------

describe("recentReplies", () => {
  it("keeps rendered replies to ids with no online player, oldest first; online players aren't buffered", () => {
    const alice = addPlayer("pA", "Alice", { x: 0, y: 64, z: 0 });
    rt.submitText(sender(alice), "!status");
    expect(rt.recentReplies("pA")).toEqual([]);
    const g = ghost("gt1");
    rt.submitText(g, "!status");
    rt.submitText(g, "!nope");
    const r = rt.recentReplies("gt1");
    expect(r[0]).toContain("No bots yet");
    expect(r.at(-1)).toContain("Unknown command");
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.every((l) => l.startsWith("§7[Colony]§r "))).toBe(true);
    expect(rt.recentReplies("unknown")).toEqual([]);
  });

  it("bot-spoken lines carry the <Bot> prefix", () => {
    const { alice } = withBot();
    void alice;
    const g = ghost("gt2");
    rt.submitText(g, "!goto 10 64 0");
    expect(rt.recentReplies("gt2")).toEqual(["<Bot-1> On my way to 10 64 0."]);
  });

  it("returns a copy", () => {
    rt.submitText(ghost("gt3"), "!status");
    const r = rt.recentReplies("gt3");
    r.length = 0;
    expect(rt.recentReplies("gt3").length).toBeGreaterThan(0);
  });

  it("keeps the last 50 lines per id", () => {
    const g = ghost("gt4");
    for (let i = 0; i < 60; i++) {
      rt.submitText(g, `!help`);
      advance(25);
    }
    const r = rt.recentReplies("gt4");
    expect(r).toHaveLength(mod.REPLY_BUFFER_PER_ID);
    expect(mod.REPLY_BUFFER_PER_ID).toBe(50);
  });

  it("keeps at most 64 ids, evicting the least recently written", () => {
    for (let i = 0; i < 70; i++) rt.submitText(ghost(`id${i}`), "!status");
    expect(mod.REPLY_BUFFER_IDS).toBe(64);
    expect(rt.recentReplies("id0")).toEqual([]);
    expect(rt.recentReplies("id5")).toEqual([]);
    expect(rt.recentReplies("id6").length).toBeGreaterThan(0);
    expect(rt.recentReplies("id69").length).toBeGreaterThan(0);
    // writing to an old id refreshes it, so the next eviction takes the oldest other id
    rt.submitText(ghost("id6"), "!help");
    rt.submitText(ghost("new"), "!status");
    expect(rt.recentReplies("id6").length).toBeGreaterThan(0);
    expect(rt.recentReplies("id7")).toEqual([]);
  });
});

// ---------- structures (scripts/make-structure.mjs) ----------

describe("GameTest structures", () => {
  type Nbt = Record<string, unknown>;
  function decode(buf: Buffer): Nbt {
    let o = 0;
    const u8 = () => buf.readUInt8(o++);
    const str = () => {
      const n = buf.readUInt16LE(o);
      o += 2;
      const s = buf.toString("utf8", o, o + n);
      o += n;
      return s;
    };
    const pl = (t: number): unknown => {
      switch (t) {
        case 1:
          return buf.readInt8(o++);
        case 3: {
          const v = buf.readInt32LE(o);
          o += 4;
          return v;
        }
        case 8:
          return str();
        case 9: {
          const et = u8();
          const n = buf.readInt32LE(o);
          o += 4;
          const a: unknown[] = [];
          for (let i = 0; i < n; i++) a.push(pl(et));
          return a;
        }
        case 10: {
          const c: Nbt = {};
          for (;;) {
            const tt = u8();
            if (tt === 0) return c;
            c[str()] = pl(tt);
          }
        }
        default:
          throw new Error(`unexpected tag ${t} at ${o}`);
      }
    };
    expect(u8()).toBe(10);
    expect(str()).toBe("");
    const root = pl(10) as Nbt;
    expect(o).toBe(buf.length);
    return root;
  }

  async function load(): Promise<Record<string, Buffer>> {
    const path = "../scripts/make-structure.mjs";
    const m = (await import(/* @vite-ignore */ path)) as { buildStructures(): Record<string, Buffer> };
    return m.buildStructures();
  }

  function grid(root: Nbt) {
    const [sx, sy, sz] = root.size as number[];
    const s = root.structure as Nbt;
    const [l0, l1] = s.block_indices as number[][];
    const pal = ((s.palette as Nbt).default as Nbt).block_palette as Array<{ name: string; states: Nbt }>;
    expect(l0).toHaveLength((sx ?? 0) * (sy ?? 0) * (sz ?? 0));
    expect(l1?.every((v) => v === -1)).toBe(true);
    const at = (x: number, y: number, z: number) => pal[l0?.[(x * (sy ?? 0) + y) * (sz ?? 0) + z] ?? -1];
    return { size: [sx, sy, sz], at, pal };
  }

  it("grove: 16x8x16, stone floor, three 4-high oak_log columns with pillar_axis y", async () => {
    const files = await load();
    const g = grid(decode(files["grove.mcstructure"] as Buffer));
    expect(g.size).toEqual([16, 8, 16]);
    expect(g.at(0, 0, 0)?.name).toBe("minecraft:stone");
    expect(g.at(15, 0, 15)?.name).toBe("minecraft:stone");
    for (const [x, z] of [
      [8, 8],
      [11, 5],
      [5, 11],
    ] as const) {
      for (let y = 1; y <= 4; y++) expect(g.at(x, y, z)).toEqual({ name: "minecraft:oak_log", states: { pillar_axis: "y" }, version: expect.any(Number) });
      expect(g.at(x, 5, z)?.name).toBe("minecraft:air");
    }
    expect(g.at(8, 1, 9)?.name).toBe("minecraft:air");
    let logs = 0;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 16; z++) if (g.at(x, y, z)?.name === "minecraft:oak_log") logs++;
    expect(logs).toBe(12);
  });

  it("quarry: 16x6x16, stone floor, 4x4 stone pad at y=1 (x,z 9..12)", async () => {
    const files = await load();
    const q = grid(decode(files["quarry.mcstructure"] as Buffer));
    expect(q.size).toEqual([16, 6, 16]);
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        expect(q.at(x, 0, z)?.name).toBe("minecraft:stone");
        const pad = x >= 9 && x <= 12 && z >= 9 && z <= 12;
        expect(q.at(x, 1, z)?.name).toBe(pad ? "minecraft:stone" : "minecraft:air");
        expect(q.at(x, 2, z)?.name).toBe("minecraft:air");
      }
  });

  it("flat and walled are unchanged in shape (Phase 1 GameTests)", async () => {
    const files = await load();
    const f = grid(decode(files["flat.mcstructure"] as Buffer));
    expect(f.size).toEqual([16, 4, 16]);
    expect(f.pal.every((p) => Object.keys(p.states).length === 0)).toBe(true);
    const w = grid(decode(files["walled.mcstructure"] as Buffer));
    expect(w.size).toEqual([16, 5, 16]);
    expect(w.at(12, 1, 12)?.name).toBe("minecraft:air");
    expect(w.at(12, 3, 12)?.name).toBe("minecraft:glass");
  });
});
