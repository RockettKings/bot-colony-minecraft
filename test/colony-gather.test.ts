import { describe, expect, it } from "vitest";
import { Colony, splitAmount } from "../src/core/colony/index.js";
import type {
  ChestRef,
  Command,
  Effect,
  GatherTask,
  ItemCount,
  ResourceKey,
  Sender,
  Task,
  TaskFailReason,
  TaskProgress,
  Tick,
} from "../src/core/types.js";

// ---------- harness ----------

const alice: Sender = { id: "pA", name: "Alice", pos: { x: 0, y: 64, z: 0 } };
const bob: Sender = { id: "pB", name: "Bob", pos: { x: 100, y: 70, z: -50 } };
const CHEST: ChestRef = { dimensionId: "minecraft:overworld", pos: { x: 3, y: 64, z: -2 } };

class H {
  readonly c = new Colony();
  now: Tick = 1000;
  cmd(sender: Sender, command: Command, advance = 100): Effect[] {
    this.now += advance;
    return this.c.handle({ kind: "command", now: this.now, sender, command });
  }
  gather(sender: Sender, item: ResourceKey, amount = 16, count = 1): Effect[] {
    return this.cmd(sender, { kind: "gather", item, amount, count });
  }
  goto(sender: Sender, x: number, y: number, z: number, count = 1): Effect[] {
    const c = (value: number) => ({ value, relative: false });
    return this.cmd(sender, { kind: "goto", target: { x: c(x), y: c(y), z: c(z) }, count });
  }
  bots(n: number): void {
    for (let i = 1; i <= n; i++) {
      this.cmd(alice, { kind: "spawn" });
      this.c.handle({ kind: "botRegistered", now: this.now, botId: `b${i}`, name: `Bot-${i}` });
    }
  }
  setChest(chest: ChestRef = CHEST, by = alice.id): Effect[] {
    return this.c.handle({ kind: "chestLocated", now: this.now, requestedBy: by, chest });
  }
  progress(botId: string, taskId: string, delivered: number, held: number): Effect[] {
    const progress: TaskProgress = { kind: "gather", delivered, held };
    return this.c.handle({ kind: "taskProgress", now: this.now, botId, taskId, progress });
  }
  done(botId: string, taskId: string): Effect[] {
    return this.c.handle({ kind: "taskReport", now: this.now, botId, taskId, outcome: "done" });
  }
  failed(botId: string, taskId: string, reason: TaskFailReason): Effect[] {
    return this.c.handle({ kind: "taskReport", now: this.now, botId, taskId, outcome: "failed", reason });
  }
  view(botId: string) {
    return this.c.snapshot().bots.find((b) => b.id === botId);
  }
  taskOf(botId: string): Task | undefined {
    return this.view(botId)?.task;
  }
}

const replies = (fx: Effect[], to?: string) =>
  fx.filter((e): e is Extract<Effect, { kind: "reply" }> => e.kind === "reply" && (to === undefined || e.to === to));
const texts = (fx: Effect[], to?: string) => replies(fx, to).map((r) => r.text);
const assigns = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: "assign" }> => e.kind === "assign");
const cancels = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: "cancel" }> => e.kind === "cancel");
const gatherOf = (t: Task | undefined): GatherTask | undefined => (t?.kind === "gather" ? t : undefined);

const NO_CHEST = "No colony chest yet. Look at a chest and type !chest set.";

// ---------- chest ----------

describe("!chest set", () => {
  it("emits locateChest with the sender position and no reply", () => {
    const h = new H();
    const fx = h.cmd(alice, { kind: "chest", action: "set" });
    expect(fx).toEqual([{ kind: "locateChest", requestedBy: "pA", near: { x: 0, y: 64, z: 0 } }]);
    // near is a copy
    const e = fx[0] as Extract<Effect, { kind: "locateChest" }>;
    e.near.x = 99;
    expect(alice.pos.x).toBe(0);
  });

  it("chestLocated stores the chest and replies to the requester", () => {
    const h = new H();
    const fx = h.setChest(CHEST, "pB");
    expect(fx).toEqual([{ kind: "reply", to: "pB", text: "Colony chest set to 3 64 -2." }]);
    expect(h.c.snapshot().chest).toEqual(CHEST);
  });

  it("a later chestLocated replaces the chest; snapshot returns a copy", () => {
    const h = new H();
    h.setChest();
    const other: ChestRef = { dimensionId: "minecraft:overworld", pos: { x: -10, y: 70, z: 5 } };
    h.setChest(other);
    const snap = h.c.snapshot();
    expect(snap.chest).toEqual(other);
    (snap.chest as ChestRef).pos.x = 1234;
    expect(h.c.snapshot().chest?.pos.x).toBe(-10);
  });

  it("snapshot has no chest before one is set", () => {
    expect(new H().c.snapshot().chest).toBeUndefined();
  });

  it("chestLocateFailed replies per reason", () => {
    const h = new H();
    const fail = (reason: "none_found" | "no_player" | "error") =>
      texts(h.c.handle({ kind: "chestLocateFailed", now: h.now, requestedBy: "pA", reason }), "pA");
    expect(fail("none_found")).toEqual(["No chest found. Look at a chest (or stand next to one) and type !chest set."]);
    expect(fail("no_player")).toEqual(["Couldn't look for a chest. Try again."]);
    expect(fail("error")).toEqual(["Couldn't look for a chest. Try again."]);
    expect(h.c.snapshot().chest).toBeUndefined();
  });

  it("is cooldown-checked", () => {
    const h = new H();
    h.cmd(alice, { kind: "status" });
    expect(texts(h.cmd(alice, { kind: "chest", action: "set" }, 5))).toEqual(["Slow down… wait a moment between commands."]);
  });
});

describe("!chest (show)", () => {
  it("without a chest says how to set one", () => {
    const h = new H();
    expect(h.cmd(alice, { kind: "chest", action: "show" })).toEqual([{ kind: "reply", to: "pA", text: NO_CHEST }]);
  });

  it("emits inspectChest with a copy of the chest", () => {
    const h = new H();
    h.setChest();
    const fx = h.cmd(bob, { kind: "chest", action: "show" });
    expect(fx).toEqual([{ kind: "inspectChest", to: "pB", chest: CHEST }]);
  });

  it("formats chestInspected: unreadable, empty, items, +N more", () => {
    const h = new H();
    const show = (items: ItemCount[] | undefined) =>
      texts(h.c.handle({ kind: "chestInspected", now: h.now, to: "pA", chest: CHEST, items }), "pA");
    expect(show(undefined)).toEqual(["Colony chest at 3 64 -2 can't be read (gone or unloaded)."]);
    expect(show([])).toEqual(["Colony chest at 3 64 -2: empty."]);
    expect(
      show([
        { typeId: "minecraft:oak_log", amount: 23 },
        { typeId: "minecraft:cobblestone", amount: 5 },
      ]),
    ).toEqual(["Colony chest at 3 64 -2: 23 oak_log, 5 cobblestone"]);
    const many = Array.from({ length: 10 }, (_, i) => ({ typeId: `minecraft:item_${i}`, amount: 10 - i }));
    expect(show(many)).toEqual([
      "Colony chest at 3 64 -2: 10 item_0, 9 item_1, 8 item_2, 7 item_3, 6 item_4, 5 item_5, 4 item_6, 3 item_7, +2 more",
    ]);
    expect(show(many.slice(0, 8))[0]).not.toContain("more");
    expect(show([{ typeId: "mod:thing", amount: 1 }])).toEqual(["Colony chest at 3 64 -2: 1 mod:thing"]);
  });
});

// ---------- gather: validation ----------

describe("!gather validation", () => {
  it("no chest is checked first, has no side effects, and keeps a pending offer", () => {
    const h = new H();
    h.bots(1);
    h.goto(bob, 1, 64, 1);
    h.goto(alice, 5, 64, 5); // offer for Alice
    expect(h.c.snapshot().pendingOffers).toBe(1);
    const fx = h.gather(alice, "oak_log");
    expect(fx).toEqual([{ kind: "reply", to: "pA", text: NO_CHEST }]);
    expect(h.c.snapshot().pendingOffers).toBe(1);
  });

  it("no chest wins over no bots", () => {
    const h = new H();
    expect(texts(h.gather(alice, "log"))).toEqual([NO_CHEST]);
  });

  it("no bots / too many bots", () => {
    const h = new H();
    h.setChest();
    expect(texts(h.gather(alice, "log"))).toEqual(["No bots yet. Type !spawn."]);
    h.bots(2);
    expect(texts(h.gather(alice, "log", 16, 3))).toEqual(["Only 2 bots exist; can't send 3."]);
  });

  it("bots are capped at amount (n = min(count, amount))", () => {
    const h = new H();
    h.setChest();
    h.bots(2);
    const fx = h.gather(alice, "sand", 1, 5); // n = 1, fits
    expect(assigns(fx).map((a) => a.botId)).toEqual(["b1"]);
    expect(gatherOf(assigns(fx)[0]?.task)?.amount).toBe(1);
  });

  it("a valid request supersedes the sender's pending offer", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.goto(bob, 1, 64, 1);
    h.goto(alice, 5, 64, 5);
    expect(h.c.snapshot().pendingOffers).toBe(1);
    h.done("b1", h.taskOf("b1")!.id);
    h.gather(alice, "dirt", 4);
    expect(h.c.snapshot().pendingOffers).toBe(0);
    expect(texts(h.cmd(alice, { kind: "override" }))).toEqual(["Nothing to override."]);
  });

  it("is cooldown-checked", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.cmd(alice, { kind: "status" });
    expect(texts(h.gather(alice, "log", 16, 1), "pA")).toEqual(["Gathering 16 logs."]);
    expect(texts(h.cmd(alice, { kind: "gather", item: "log", amount: 4, count: 1 }, 5))).toEqual([
      "Slow down… wait a moment between commands.",
    ]);
  });
});

// ---------- gather: assignment and split ----------

describe("!gather assignment", () => {
  it("creates a GatherTask with origin, chest, delivered 0 and acks", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    const fx = h.gather(alice, "oak_log", 20);
    expect(fx).toEqual([
      {
        kind: "assign",
        botId: "b1",
        task: {
          id: expect.any(String),
          kind: "gather",
          item: "oak_log",
          amount: 20,
          delivered: 0,
          origin: { x: 0, y: 64, z: 0 },
          chest: CHEST,
          issuer: { id: "pA", name: "Alice" },
          createdAt: h.now,
        },
      },
      { kind: "reply", to: "pA", from: "b1", text: "Gathering 20 oak_log." },
    ]);
  });

  it("captures the chest at command time", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log");
    h.setChest({ dimensionId: "minecraft:overworld", pos: { x: 50, y: 60, z: 50 } });
    expect(gatherOf(h.taskOf("b1"))?.chest).toEqual(CHEST);
  });

  it("splits 32/3 -> 11, 11, 10 with per-bot acks", () => {
    const h = new H();
    h.setChest();
    h.bots(3);
    const fx = h.gather(alice, "cobblestone", 32, 3);
    expect(assigns(fx).map((a) => [a.botId, gatherOf(a.task)?.amount])).toEqual([
      ["b1", 11],
      ["b2", 11],
      ["b3", 10],
    ]);
    expect(texts(fx, "pA")).toEqual(["Gathering 11 cobblestone.", "Gathering 11 cobblestone.", "Gathering 10 cobblestone."]);
    expect(new Set(assigns(fx).map((a) => a.task.id)).size).toBe(3);
  });

  it("splitAmount", () => {
    expect(splitAmount(32, 3)).toEqual([11, 11, 10]);
    expect(splitAmount(16, 1)).toEqual([16]);
    expect(splitAmount(8, 2)).toEqual([4, 4]);
    expect(splitAmount(3, 3)).toEqual([1, 1, 1]);
    expect(splitAmount(5, 4)).toEqual([2, 1, 1, 1]);
  });

  it("own busy bots are replaced directly (cancel, no requeue)", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.goto(alice, 9, 64, 9);
    const old = h.taskOf("b1")!.id;
    const fx = h.gather(alice, "gravel", 5);
    expect(cancels(fx)).toEqual([{ kind: "cancel", botId: "b1", taskId: old, reason: "preempted" }]);
    expect(gatherOf(h.taskOf("b1"))?.item).toBe("gravel");
    expect(h.c.snapshot().queued).toEqual([]);
  });
});

// ---------- offers ----------

describe("gather offers", () => {
  it("busy bots listed with their gather activity; override requeues with delivered", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(bob, "oak_log", 16);
    const bobTask = h.taskOf("b1")!.id;
    h.progress("b1", bobTask, 4, 3);

    const offer = h.gather(alice, "sand", 8);
    expect(assigns(offer)).toEqual([]);
    expect(texts(offer, "pA")).toEqual([
      "Need 1 bot: 0 free, 1 busy.",
      "Bot-1 is gathering oak_log 7/16 for Bob.",
      "Reply !override to take over or !queue to wait (expires in 30s).",
    ]);

    const fx = h.cmd(alice, { kind: "override" });
    expect(cancels(fx)).toEqual([{ kind: "cancel", botId: "b1", taskId: bobTask, reason: "preempted" }]);
    expect(texts(fx, "pB")).toEqual(["Bot-1 was reassigned by Alice; your task (gather oak_log 4/16) is queued."]);
    expect(texts(fx, "pA")).toEqual(["Gathering 8 sand."]);
    const q = h.c.snapshot().queued;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ id: bobTask, kind: "gather", delivered: 4, amount: 16 });
    // new task has no stale progress
    expect(h.view("b1")?.progress).toBeUndefined();
  });

  it("goto offer against a gather-busy bot shows the gather activity", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(bob, "log", 10);
    expect(texts(h.goto(alice, 1, 64, 1), "pA")[1]).toBe("Bot-1 is gathering logs 0/10 for Bob.");
  });

  it("gather offer against a goto-busy bot keeps Phase 1 wording", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.goto(bob, 1, 64, 1);
    expect(texts(h.gather(alice, "log"), "pA")[1]).toBe("Bot-1 is going to 1 64 1 for Bob.");
  });

  it("override of a task that already delivered its amount drops it", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(bob, "dirt", 5);
    const t = h.taskOf("b1")!.id;
    h.progress("b1", t, 5, 0);
    h.gather(alice, "sand", 2);
    const fx = h.cmd(alice, { kind: "override" });
    expect(texts(fx, "pB")).toEqual(["Bot-1 was reassigned by Alice; your task (gather dirt 5/5) was already done."]);
    expect(h.c.snapshot().queued).toEqual([]);
  });

  it("split offer: idle bots take the larger shares on override", () => {
    const h = new H();
    h.setChest();
    h.bots(2);
    h.goto(bob, 1, 64, 1); // b1 busy
    h.gather(alice, "log", 9, 2);
    const fx = h.cmd(alice, { kind: "override" });
    expect(assigns(fx).map((a) => [a.botId, gatherOf(a.task)?.amount])).toEqual([
      ["b2", 5],
      ["b1", 4],
    ]);
    expect(h.c.snapshot().queued[0]).toMatchObject({ kind: "goto", target: { x: 1, y: 64, z: 1 } });
  });

  it("!queue assigns free shares and queues the rest", () => {
    const h = new H();
    h.setChest();
    h.bots(2);
    h.goto(bob, 1, 64, 1);
    h.gather(alice, "cobblestone", 7, 2);
    const fx = h.cmd(alice, { kind: "queue" });
    expect(assigns(fx).map((a) => [a.botId, gatherOf(a.task)?.amount])).toEqual([["b2", 4]]);
    expect(texts(fx, "pA")).toEqual(["Gathering 4 cobblestone.", "Queued 1 task at position 1."]);
    const q = h.c.snapshot().queued;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "gather", item: "cobblestone", amount: 3, delivered: 0, chest: CHEST });

    // Bob's goto finishes: queued gather is picked up with the gather activity phrase
    const pick = h.done("b1", h.taskOf("b1")!.id);
    expect(texts(pick, "pA")).toEqual(["Picking up your queued task: gathering cobblestone 0/3."]);
    expect(gatherOf(h.taskOf("b1"))?.amount).toBe(3);
  });

  it("stop offer on a gather-busy bot uses the activity", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(bob, "sand", 6);
    h.progress("b1", h.taskOf("b1")!.id, 2, 1);
    const fx = h.cmd(alice, { kind: "stop", bot: "Bot-1" });
    expect(texts(fx, "pA")[0]).toBe("Bot-1 is gathering sand 3/6 for Bob.");
  });
});

// ---------- progress ----------

describe("taskProgress", () => {
  it("is stored for the current task and shown in status and snapshot", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "oak_log", 16);
    const t = h.taskOf("b1")!.id;
    expect(texts(h.cmd(alice, { kind: "status" }))[0]).toBe("Bot-1: gathering oak_log 0/16 for Alice");
    expect(h.view("b1")?.progress).toBeUndefined();

    expect(h.progress("b1", t, 3, 2)).toEqual([]);
    expect(h.view("b1")?.progress).toEqual({ kind: "gather", delivered: 3, held: 2 });
    expect(texts(h.cmd(alice, { kind: "status", bot: "bot-1" }))).toEqual(["Bot-1: gathering oak_log 5/16 for Alice"]);
  });

  it("is ignored for a stale task id or unknown bot", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log");
    h.progress("b1", "nope", 9, 9);
    h.progress("zz", "nope", 9, 9);
    expect(h.view("b1")?.progress).toBeUndefined();
  });

  it("snapshot progress is a copy", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log");
    h.progress("b1", h.taskOf("b1")!.id, 1, 1);
    const p = h.view("b1")!.progress!;
    p.delivered = 100;
    expect(h.view("b1")?.progress?.delivered).toBe(1);
  });

  it("is cleared when the task changes (stop, report, reassign)", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log");
    h.progress("b1", h.taskOf("b1")!.id, 1, 1);
    h.gather(alice, "sand"); // own task replaced
    expect(h.view("b1")?.progress).toBeUndefined();
    h.progress("b1", h.taskOf("b1")!.id, 2, 0);
    h.cmd(alice, { kind: "stop" });
    expect(h.view("b1")?.state).toBe("idle");
    expect(h.view("b1")?.progress).toBeUndefined();
  });
});

// ---------- requeue on bot removal ----------

describe("botRemoved with a gather task", () => {
  it("requeues the same task with delivered from progress", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "cobblestone", 10);
    const t = h.taskOf("b1")!.id;
    h.progress("b1", t, 6, 3);
    const fx = h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "died" });
    expect(texts(fx, "pA")).toEqual(["Bot-1 left; your task (gather cobblestone 6/10) is queued."]);
    const q = h.c.snapshot().queued;
    expect(q).toEqual([expect.objectContaining({ id: t, kind: "gather", delivered: 6, amount: 10 })]);

    // a new bot picks it up from 6 (held items stayed with the old bot)
    h.cmd(alice, { kind: "spawn" });
    const pick = h.c.handle({ kind: "botRegistered", now: h.now, botId: "b9", name: "Bot-9" });
    expect(assigns(pick)).toEqual([expect.objectContaining({ botId: "b9", task: expect.objectContaining({ id: t, delivered: 6 }) })]);
    expect(texts(pick, "pA")).toEqual(["Picking up your queued task: gathering cobblestone 6/10."]);
  });

  it("requeues with task.delivered when there is no progress", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log", 4);
    h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "gone" });
    expect(h.c.snapshot().queued[0]).toMatchObject({ kind: "gather", delivered: 0 });
  });

  it("drops a task whose amount was already delivered", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log", 4);
    h.progress("b1", h.taskOf("b1")!.id, 4, 0);
    const fx = h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "gone" });
    expect(texts(fx, "pA")).toEqual(["Bot-1 left; your task (gather logs 4/4) was already done."]);
    expect(h.c.snapshot().queued).toEqual([]);
  });
});

// ---------- reports ----------

describe("gather reports", () => {
  it("done: Delivered max(amount, progress.delivered)", () => {
    const h = new H();
    h.setChest();
    h.bots(2);
    h.gather(alice, "oak_log", 6, 2);
    h.progress("b1", h.taskOf("b1")!.id, 4, 0);
    expect(texts(h.done("b1", h.taskOf("b1")!.id))).toEqual(["Delivered 4 oak_log to the chest."]);
    expect(texts(h.done("b2", h.taskOf("b2")!.id))).toEqual(["Delivered 3 oak_log to the chest."]);
    expect(h.c.snapshot().bots.every((b) => b.state === "idle" && b.progress === undefined)).toBe(true);
  });

  it("done report is bot-spoken to the issuer and drains the queue", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "dirt", 2);
    const t = h.taskOf("b1")!.id;
    const fx = h.done("b1", t);
    expect(replies(fx)).toEqual([{ kind: "reply", to: "pA", from: "b1", text: "Delivered 2 dirt to the chest." }]);
  });

  it("failed: delivered from progress, else task; every reason text", () => {
    const cases: [TaskFailReason, string][] = [
      ["no_source", "nothing left to gather nearby"],
      ["no_chest", "can't reach the colony chest"],
      ["no_tool", "no pickaxe and couldn't make one"],
      ["inventory_full", "the chest is full"],
      ["unreachable", "no path"],
      ["timeout", "timed out"],
      ["bot_died", "I died"],
      ["error", "something went wrong"],
    ];
    for (const [reason, text] of cases) {
      const h = new H();
      h.setChest();
      h.bots(1);
      h.gather(alice, "cobblestone", 12);
      const t = h.taskOf("b1")!.id;
      h.progress("b1", t, 5, 2);
      expect(texts(h.failed("b1", t, reason))).toEqual([`Stopped gathering cobblestone at 5/12: ${text}.`]);
    }
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "sand", 3);
    expect(texts(h.failed("b1", h.taskOf("b1")!.id, "no_source"))).toEqual([
      "Stopped gathering sand at 0/3: nothing left to gather nearby.",
    ]);
  });

  it("stale reports are ignored", () => {
    const h = new H();
    h.setChest();
    h.bots(1);
    h.gather(alice, "log");
    expect(h.done("b1", "t999")).toEqual([]);
    expect(h.view("b1")?.state).toBe("busy");
  });

  it("goto failure wording unchanged (Phase 1)", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 64, 2);
    expect(texts(h.failed("b1", h.taskOf("b1")!.id, "unreachable"))).toEqual(["Couldn't reach 1 64 2: no path."]);
  });
});
