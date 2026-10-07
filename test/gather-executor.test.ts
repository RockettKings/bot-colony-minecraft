// GatherExecutor state machine against the voxel fake (test/support/fake-world.ts).
// Depends on Job 4's real gather-logic.ts / crafting.ts (no mocks).
import { describe, expect, it } from "vitest";
import type { GatherTask, ResourceKey, TaskProgress, Vec3 } from "../src/core/types.js";
import { GatherExecutor, type GatherPhase } from "../src/game/bots/gather-executor.js";
import { scanSlices } from "../src/game/bots/gather-logic.js";
import { DEFAULT_GATHER_CONFIG, type GatherConfig } from "../src/game/bots/executor.js";
import { DIM, FakeBody, FakeWorld, flatWorld, makeCtx, run, stack, v, type FakeOptions } from "./support/fake-world.js";

const OAK = "minecraft:oak_log";
const COBBLE = "minecraft:cobblestone";
const CHEST = v(0, 1, 0);

function task(item: ResourceKey, amount: number, opts: { origin?: Vec3; delivered?: number; chest?: Vec3 } = {}): GatherTask {
  return {
    id: "t1",
    kind: "gather",
    item,
    amount,
    delivered: opts.delivered ?? 0,
    origin: opts.origin ?? v(1.5, 1, 1.5),
    chest: { dimensionId: DIM, pos: opts.chest ?? CHEST },
    issuer: { id: "p1", name: "Steve" },
    createdAt: 0,
  };
}

function logColumn(w: FakeWorld, x: number, z: number, h = 4, type = OAK): void {
  for (let y = 1; y <= h; y++) w.set(v(x, y, z), type);
}

interface Scene {
  w: FakeWorld;
  body: FakeBody;
  ex: GatherExecutor;
}

function scene(
  t: GatherTask,
  setup: (w: FakeWorld) => void,
  o: { cfg?: Partial<GatherConfig>; fake?: FakeOptions; at?: Vec3; chest?: boolean } = {},
): Scene {
  const w = flatWorld();
  if (o.chest !== false) w.set(t.chest.pos, "minecraft:chest");
  setup(w);
  const body = new FakeBody(w, o.at ?? v(1.5, 1, 1.5), o.fake);
  const ex = new GatherExecutor(t, makeCtx(w, body, o.cfg));
  return { w, body, ex };
}

/** Run, recording each distinct phase transition. */
function runPhases(s: Scene, maxTicks?: number, onStep?: (now: number) => void) {
  const phases: GatherPhase[] = [];
  const r = run(s.ex, s.body, maxTicks, (now) => {
    const p = s.ex.phase();
    if (phases[phases.length - 1] !== p) phases.push(p);
    onStep?.(now);
  });
  return { ...r, phases };
}

const trips = (phases: GatherPhase[]) => phases.filter((p) => p === "atChest").length;

describe("GatherExecutor: logs", () => {
  it("happy path: breaks, collects and deposits the amount", () => {
    const s = scene(task("oak_log", 4), (w) => logColumn(w, 6, 6));
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(4);
    expect(s.body.count(OAK)).toBe(0);
    expect(s.body.violations).toEqual([]);
    expect(r.phases).toEqual(expect.arrayContaining(["scan", "approach", "break", "collect", "toChest", "atChest", "finished"]));
    expect(s.ex.progress()).toEqual({ kind: "gather", delivered: 4, held: 0 });
    // terminal once, then running forever without touching the body
    const calls = s.body.calls.length;
    expect(s.ex.step(r.now + 4)).toEqual({ kind: "running" });
    expect(s.body.calls.length).toBe(calls);
  });

  it("'log' accepts any species and only deposits yields", () => {
    const s = scene(task("log", 3), (w) => {
      logColumn(w, 6, 6, 2, "minecraft:birch_log");
      w.set(v(4, 1, -4), "minecraft:spruce_log");
    });
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, "minecraft:birch_log") + s.w.chestCount(CHEST, "minecraft:spruce_log")).toBe(3);
  });

  it("multi-trip deposit when the inventory fills up", () => {
    const s = scene(
      task("oak_log", 4),
      (w) => logColumn(w, 6, 6),
      { fake: { maxStack: (id) => (id === OAK ? 1 : 64) } },
    );
    // 34 junk slots: 2 free -> after one log, 1 free (<= reserveSlots) and the log stack is full.
    s.body.give(...Array.from({ length: 34 }, () => stack("minecraft:dirt", 64)));
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(4);
    expect(trips(r.phases)).toBeGreaterThanOrEqual(2);
    expect(s.w.chestCount(CHEST, "minecraft:dirt")).toBe(0); // junk stays with the bot
  });

  it("walks to drops that land away from the bot", () => {
    // Bot stops as soon as the block is in reach (4.5), so drops land out of pickup range and must be walked to.
    const s = scene(task("oak_log", 1), (w) => logColumn(w, 9, 1, 1), { at: v(1.5, 1, 1.5) });
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(s.w.items).toEqual([]);
    expect(s.w.chestCount(CHEST, OAK)).toBe(1);
  });

  it("resumes a requeued task from task.delivered", () => {
    const s = scene(task("oak_log", 4, { delivered: 2 }), (w) => logColumn(w, 6, 6));
    expect(s.ex.progress()).toEqual({ kind: "gather", delivered: 2, held: 0 });
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(2);
    expect(s.ex.progress()?.delivered).toBe(4);
  });

  it("progress: delivered is monotonic, held rises then drops at the deposit", () => {
    const s = scene(task("oak_log", 3), (w) => logColumn(w, 6, 6, 3));
    const seen: TaskProgress[] = [];
    run(s.ex, s.body, undefined, () => {
      const p = s.ex.progress()!;
      const last = seen[seen.length - 1];
      if (!last || last.delivered !== p.delivered || last.held !== p.held) seen.push(p);
    });
    expect(seen[0]).toEqual({ kind: "gather", delivered: 0, held: 0 });
    expect(seen.map((p) => p.held)).toEqual([0, 1, 2, 3, 0]);
    expect(seen[seen.length - 1]).toEqual({ kind: "gather", delivered: 3, held: 0 });
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.delivered).toBeGreaterThanOrEqual(seen[i - 1]!.delivered);
  });
});

describe("GatherExecutor: scan", () => {
  it("time slicing: at most one source findBlocks per step, nearest layers first", () => {
    const t = task("oak_log", 1);
    const s = scene(t, () => {});
    const perStep: number[] = [];
    let before = 0;
    const r = run(s.ex, s.body, undefined, () => {
      const n = s.w.findCalls.filter((c) => c.typeIds.includes(OAK)).length;
      perStep.push(n - before);
      before = n;
    });
    expect(r.result).toEqual({ kind: "failed", reason: "no_source" });
    expect(Math.max(...perStep)).toBe(1);
    const slices = scanSlices(t.origin, DEFAULT_GATHER_CONFIG);
    expect(s.w.findCalls.map((c) => c.box)).toEqual(slices);
  });

  it("no_source without partial delivery", () => {
    const s = scene(task("sand", 4), () => {});
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_source" });
    expect(s.body.calls).not.toContain("depositSlot");
  });

  it("no_source after a partial deposit", () => {
    const s = scene(task("oak_log", 5), (w) => logColumn(w, 6, 6, 2));
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_source" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(2);
    expect(s.ex.progress()).toEqual({ kind: "gather", delivered: 2, held: 0 });
  });

  it("skips buried blocks and gathers dirt from grass", () => {
    const s = scene(task("dirt", 2), (w) => {
      w.set(v(5, 1, 5), "minecraft:grass_block");
      w.set(v(-5, 1, 5), "minecraft:dirt");
      // buried dirt: fully enclosed
      w.fill(v(9, 1, 9), v(11, 3, 11), "minecraft:bedrock");
      w.set(v(10, 2, 10), "minecraft:dirt");
    });
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, "minecraft:dirt")).toBe(2);
    expect(s.w.typeAt(v(10, 2, 10))).toBe("minecraft:dirt");
  });
});

describe("GatherExecutor: tools and crafting", () => {
  function quarry(w: FakeWorld): void {
    w.fill(v(5, 1, 5), v(7, 1, 7), "minecraft:stone");
  }

  it("takes the best pickaxe from the chest", () => {
    const s = scene(task("cobblestone", 3), quarry);
    s.w.chest(CHEST)[0] = stack("minecraft:wooden_pickaxe", 1);
    s.w.chest(CHEST)[1] = stack("minecraft:iron_pickaxe", 1);
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(r.phases.slice(0, 3)).toEqual(["toChest", "atChest", "scan"]); // phases sampled after each step
    expect(s.body.count("minecraft:iron_pickaxe")).toBe(1);
    expect(s.w.chestCount(CHEST, "minecraft:wooden_pickaxe")).toBe(1);
    expect(s.w.chestCount(CHEST, COBBLE)).toBe(3);
    expect(s.body.heldItem()?.typeId).toBe("minecraft:iron_pickaxe");
  });

  it("holds a pickaxe already in the inventory (swapping it into the hotbar)", () => {
    const s = scene(task("cobblestone", 2), quarry);
    s.body.slots[20] = stack("minecraft:stone_pickaxe", 1);
    s.body.slots[0] = stack("minecraft:dirt", 5);
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(r.phases[0]).toBe("scan"); // no chest trip first
    expect(s.body.heldItem()?.typeId).toBe("minecraft:stone_pickaxe");
    expect(s.w.chestCount(CHEST, COBBLE)).toBe(2);
  });

  it("crafts a wooden pickaxe from chest logs (places a table)", () => {
    const s = scene(task("cobblestone", 2), quarry);
    s.w.chest(CHEST)[3] = stack(OAK, 3);
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(r.phases).toContain("craft");
    expect(s.body.crafted).toEqual(["oak_planks", "oak_planks", "oak_planks", "stick", "crafting_table", "wooden_pickaxe"]);
    expect([...s.w.blocks.values()]).toContain("minecraft:crafting_table");
    expect(s.w.chestCount(CHEST, OAK)).toBe(0);
    expect(s.w.chestCount(CHEST, COBBLE)).toBe(2);
    expect(s.body.calls).toContain("placeFromSlot");
  });

  it("uses an existing crafting table in reach (2 logs only)", () => {
    const s = scene(task("cobblestone", 1), (w) => {
      quarry(w);
      w.set(v(-1, 1, 0), "minecraft:crafting_table");
    });
    s.w.chest(CHEST)[0] = stack(OAK, 5);
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.body.crafted).toEqual(["oak_planks", "oak_planks", "stick", "wooden_pickaxe"]);
    expect(s.w.chestCount(CHEST, OAK)).toBe(3);
    expect(s.body.calls).not.toContain("placeFromSlot");
  });

  it("chops logs by hand when the chest has none, keeps them, then crafts", () => {
    const s = scene(task("cobblestone", 2), (w) => {
      quarry(w);
      logColumn(w, -6, 4, 4);
    });
    const r = runPhases(s);
    expect(r.result).toEqual({ kind: "done" });
    expect(s.body.crafted).toContain("wooden_pickaxe");
    expect(s.w.chestCount(CHEST, OAK)).toBe(0); // logs were kept for crafting, not deposited
    expect(s.w.chestCount(CHEST, COBBLE)).toBe(2);
    expect(s.body.violations).toEqual([]);
  });

  it("no_tool: no pickaxe, no logs anywhere", () => {
    const s = scene(task("cobblestone", 2), quarry);
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_tool" });
    expect(s.body.calls.some((c) => c.startsWith("applyCraft"))).toBe(false);
  });

  it("no_tool when a craft is refused", () => {
    const s = scene(task("cobblestone", 2), quarry);
    s.w.chest(CHEST)[0] = stack(OAK, 3);
    s.body.applyCraft = () => false;
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_tool" });
  });

  it("takes an optional axe while at the chest anyway", () => {
    const s = scene(task("oak_log", 2), (w) => logColumn(w, 6, 6), {
      fake: { maxStack: (id) => (id === OAK ? 1 : 64) },
    });
    s.body.give(...Array.from({ length: 34 }, () => stack("minecraft:dirt", 64)));
    s.w.chest(CHEST)[0] = stack("minecraft:stone_axe", 1);
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.body.count("minecraft:stone_axe")).toBe(1);
  });
});

describe("GatherExecutor: chest failures", () => {
  it("inventory_full when the chest can't take the stack", () => {
    const s = scene(task("oak_log", 3), (w) => logColumn(w, 6, 6));
    const c = s.w.chest(CHEST);
    for (let i = 0; i < c.length; i++) c[i] = stack("minecraft:dirt", 64);
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "inventory_full" });
    expect(s.ex.progress()).toEqual({ kind: "gather", delivered: 0, held: 3 });
  });

  it("partial deposit into a nearly full chest that reaches the amount is done", () => {
    const s = scene(task("oak_log", 2), (w) => logColumn(w, 6, 6));
    const c = s.w.chest(CHEST);
    for (let i = 0; i < c.length; i++) c[i] = stack("minecraft:dirt", 64);
    c[5] = stack(OAK, 62);
    expect(run(s.ex, s.body).result).toEqual({ kind: "done" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(64);
  });

  it("no_chest when the chest is removed mid-task", () => {
    const s = scene(task("oak_log", 4), (w) => logColumn(w, 6, 6));
    let removed = false;
    const r = run(s.ex, s.body, undefined, () => {
      if (!removed && s.ex.phase() === "collect") {
        s.w.set(CHEST, "minecraft:air");
        removed = true;
      }
    });
    expect(r.result).toEqual({ kind: "failed", reason: "no_chest" });
  });

  it("no_chest when the chest is unreachable (no stand cell)", () => {
    const s = scene(task("oak_log", 1), (w) => {
      logColumn(w, 6, 6);
      w.fill(v(-1, 1, -1), v(1, 3, 1), "minecraft:bedrock");
      w.set(CHEST, "minecraft:chest");
    }, { at: v(4.5, 1, 4.5) });
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_chest" });
  });

  it("no_chest when the chest is in another dimension", () => {
    const t = task("oak_log", 1);
    t.chest = { dimensionId: "minecraft:nether", pos: CHEST };
    const s = scene(t, (w) => logColumn(w, 6, 6));
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "no_chest" });
  });
});

describe("GatherExecutor: failures and budget", () => {
  it("unreachable after maxConsecutiveFailures candidates", () => {
    const s = scene(task("oak_log", 4), (w) => {
      logColumn(w, 12, 12);
      logColumn(w, 12, -12);
    }, { fake: { unreachable: () => true } });
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "unreachable" });
    // one (refused) navigation per candidate block; neighbouring blocks may share a stand cell
    expect(s.body.navTargets.length).toBe(DEFAULT_GATHER_CONFIG.maxConsecutiveFailures);
  });

  it("unreachable deposits held yields first", () => {
    // first log reachable (in reach from the start), the rest "unreachable"
    const s = scene(task("oak_log", 10), (w) => {
      w.set(v(3, 1, 1), OAK);
      logColumn(w, 12, 12);
      logColumn(w, 12, -12);
    }, { fake: { unreachable: (t) => Math.abs(t.x) > 8 || Math.abs(t.z) > 8 } });
    expect(run(s.ex, s.body).result).toEqual({ kind: "failed", reason: "unreachable" });
    expect(s.w.chestCount(CHEST, OAK)).toBe(1);
  });

  it("break timeout: stops breaking, blacklists, moves on", () => {
    const s = scene(task("oak_log", 2), (w) => logColumn(w, 6, 6), {
      cfg: { maxConsecutiveFailures: 2 },
      fake: { breakTicks: () => 100_000 },
    });
    const r = run(s.ex, s.body);
    expect(r.result).toEqual({ kind: "failed", reason: "unreachable" });
    expect(s.body.stopBreaks).toBeGreaterThanOrEqual(2);
    expect(s.body.calls.filter((c) => c === "startBreaking").length).toBe(2);
    // est. hand break for a log = 60 ticks -> timeout 160 each
    expect(r.now).toBeGreaterThanOrEqual(320);
  });

  it("budget timeout deposits what it holds, then fails timeout", () => {
    const s = scene(task("oak_log", 50), (w) => {
      for (let x = 4; x <= 10; x += 3) for (let z = 4; z <= 10; z += 3) logColumn(w, x, z, 2);
    }, { cfg: { maxTaskTicks: 400 } });
    const r = run(s.ex, s.body);
    expect(r.result).toEqual({ kind: "failed", reason: "timeout" });
    expect(r.now).toBeGreaterThanOrEqual(400);
    const delivered = s.w.chestCount(CHEST, OAK);
    expect(delivered).toBeGreaterThan(0);
    expect(s.body.count(OAK)).toBe(0);
    expect(s.ex.progress()).toEqual({ kind: "gather", delivered, held: 0 });
  });

  it("budget timeout with nothing held fails immediately", () => {
    const s = scene(task("oak_log", 5), (w) => logColumn(w, 6, 6), {
      cfg: { maxTaskTicks: 8 },
      fake: { breakTicks: () => 100_000 },
    });
    const r = run(s.ex, s.body);
    expect(r.result).toEqual({ kind: "failed", reason: "timeout" });
    expect(r.now).toBeLessThan(40);
  });
});

describe("GatherExecutor: lifecycle", () => {
  it("world() undefined -> error", () => {
    const w = flatWorld();
    const body = new FakeBody(w, v(0.5, 1, 0.5));
    const ex = new GatherExecutor(task("oak_log", 1), makeCtx(undefined, body));
    expect(ex.step(0)).toEqual({ kind: "failed", reason: "error" });
  });

  it("unreadable position for 200 ticks -> timeout; inventory -> error", () => {
    const a = scene(task("oak_log", 1), () => {});
    a.body.locationUnreadable = true;
    const ra = run(a.ex, a.body);
    expect(ra.result).toEqual({ kind: "failed", reason: "timeout" });
    expect(ra.now).toBe(200);

    const b = scene(task("oak_log", 1), () => {});
    b.body.inventoryUnreadable = true;
    expect(run(b.ex, b.body).result).toEqual({ kind: "failed", reason: "error" });
  });

  it("recovers when the position becomes readable", () => {
    const s = scene(task("oak_log", 1), (w) => logColumn(w, 6, 6, 1));
    s.body.locationUnreadable = true;
    expect(s.ex.step(0).kind).toBe("running");
    expect(s.ex.step(4).kind).toBe("running");
    s.body.locationUnreadable = false;
    expect(run(s.ex, s.body, undefined, undefined, 8).result).toEqual({ kind: "done" });
  });

  it("cancel mid-break stops breaking and movement, then never reports or touches the body", () => {
    const s = scene(task("oak_log", 4), (w) => logColumn(w, 6, 6), { fake: { breakTicks: () => 1000 } });
    let now = 0;
    while (s.ex.phase() !== "break" && now < 2000) {
      s.ex.step(now);
      for (let i = 0; i < 4; i++) s.body.tick();
      now += 4;
    }
    expect(s.ex.phase()).toBe("break");
    expect(s.body.breaking).toBeDefined();
    s.ex.cancel();
    expect(s.body.breaking).toBeUndefined();
    expect(s.body.stopBreaks).toBe(1);
    const stops = s.body.stops;
    const calls = s.body.calls.length;
    s.ex.cancel(); // idempotent
    for (let i = 1; i <= 50; i++) expect(s.ex.step(now + 4 * i)).toEqual({ kind: "running" });
    expect(s.body.stops).toBe(stops);
    expect(s.body.stopBreaks).toBe(1);
    expect(s.body.calls.length).toBe(calls);
    expect(s.ex.phase()).toBe("finished");
  });

  it("an exception inside a step fails with error instead of throwing", () => {
    const s = scene(task("oak_log", 1), (w) => logColumn(w, 6, 6));
    s.body.inventory = () => {
      throw new Error("boom");
    };
    expect(s.ex.step(0)).toEqual({ kind: "failed", reason: "error" });
  });
});
