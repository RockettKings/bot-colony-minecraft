import { describe, expect, it } from "vitest";
import { Colony } from "../src/core/colony/index.js";
import { fmtNum, fmtPos } from "../src/core/colony/messages.js";
import type { Command, CoordTriple, Effect, Sender, TaskFailReason, Tick } from "../src/core/types.js";

// ---------- harness ----------

const alice: Sender = { id: "pA", name: "Alice", pos: { x: 0, y: 64, z: 0 } };
const bob: Sender = { id: "pB", name: "Bob", pos: { x: 100, y: 70, z: -50 } };
const carol: Sender = { id: "pC", name: "Carol", pos: { x: -5, y: 60, z: 5 } };

const abs = (x: number, y: number, z: number): CoordTriple => ({
  x: { value: x, relative: false },
  y: { value: y, relative: false },
  z: { value: z, relative: false },
});

/** Wrapper that advances time by default so cooldown doesn't interfere unless a test wants it. */
class H {
  readonly c: Colony;
  now: Tick = 1000;
  constructor(cfg?: ConstructorParameters<typeof Colony>[0]) {
    this.c = new Colony(cfg);
  }
  cmd(sender: Sender, command: Command, advance = 100): Effect[] {
    this.now += advance;
    return this.c.handle({ kind: "command", now: this.now, sender, command });
  }
  goto(sender: Sender, x: number, y: number, z: number, count = 1): Effect[] {
    return this.cmd(sender, { kind: "goto", target: abs(x, y, z), count });
  }
  register(botId: string, name: string): Effect[] {
    return this.c.handle({ kind: "botRegistered", now: this.now, botId, name });
  }
  /** Spawn + register n default bots: b1..bn named Bot-1..Bot-n. */
  bots(n: number): void {
    for (let i = 1; i <= n; i++) {
      this.cmd(alice, { kind: "spawn" });
      this.register(`b${i}`, `Bot-${i}`);
    }
  }
  done(botId: string, taskId: string): Effect[] {
    return this.c.handle({ kind: "taskReport", now: this.now, botId, taskId, outcome: "done" });
  }
  failed(botId: string, taskId: string, reason: TaskFailReason): Effect[] {
    return this.c.handle({ kind: "taskReport", now: this.now, botId, taskId, outcome: "failed", reason });
  }
  tick(advance = 4): Effect[] {
    this.now += advance;
    return this.c.handle({ kind: "tick", now: this.now });
  }
  taskOf(botId: string): string | undefined {
    return this.c.snapshot().bots.find((b) => b.id === botId)?.task?.id;
  }
}

const replies = (fx: Effect[], to?: string) =>
  fx.filter((e): e is Extract<Effect, { kind: "reply" }> => e.kind === "reply" && (to === undefined || e.to === to));
const texts = (fx: Effect[], to?: string) => replies(fx, to).map((r) => r.text);
const assigns = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: "assign" }> => e.kind === "assign");
const cancels = (fx: Effect[]) => fx.filter((e): e is Extract<Effect, { kind: "cancel" }> => e.kind === "cancel");

/** Game-layer invariant: never assign to a bot that is busy unless cancelled earlier in the same list. */
function checkAssignInvariant(
  before: ReturnType<Colony["snapshot"]>,
  fx: Effect[],
  freedByEvent: readonly string[] = [],
): void {
  const busy = new Set(before.bots.filter((b) => b.state === "busy").map((b) => b.id));
  for (const id of freedByEvent) busy.delete(id);
  for (const e of fx) {
    if (e.kind === "cancel") {
      expect(busy.has(e.botId)).toBe(true);
      busy.delete(e.botId);
    } else if (e.kind === "assign") {
      expect(busy.has(e.botId), `assign to busy ${e.botId} without cancel`).toBe(false);
      busy.add(e.botId);
    }
  }
}

// ---------- tests ----------

describe("formatting", () => {
  it("formats coords as ints when whole, else one decimal", () => {
    expect(fmtPos({ x: 10, y: 64, z: -3 })).toBe("10 64 -3");
    expect(fmtPos({ x: 10.25, y: 64.5, z: -3.04 })).toBe("10.3 64.5 -3");
    expect(fmtNum(-0.04)).toBe("0");
  });
});

describe("config", () => {
  it("merges partial config with defaults", () => {
    const c = new Colony({ maxBots: 5, prefix: "?" });
    expect(c.config).toEqual({ prefix: "?", maxBots: 5, offerTtlTicks: 600, commandCooldownTicks: 20, defaultBotNamePrefix: "Bot-" });
  });
});

describe("spawn", () => {
  it("uses lowest unused Bot-N and emits spawn near sender", () => {
    const h = new H();
    const fx = h.cmd(alice, { kind: "spawn" });
    expect(fx).toEqual([
      { kind: "spawn", name: "Bot-1", near: alice.pos, requestedBy: "pA" },
      { kind: "reply", to: "pA", text: "Spawning Bot-1…" },
    ]);
    // pending spawn reserves the name
    const fx2 = h.cmd(alice, { kind: "spawn" });
    expect(fx2[0]).toMatchObject({ kind: "spawn", name: "Bot-2" });
  });

  it("fills gaps in default names", () => {
    const h = new H();
    h.bots(3);
    h.c.handle({ kind: "botRemoved", now: h.now, botId: "b2", reason: "gone" });
    const fx = h.cmd(alice, { kind: "spawn" });
    expect(fx[0]).toMatchObject({ kind: "spawn", name: "Bot-2" });
  });

  it("refuses at maxBots counting pending spawns", () => {
    const h = new H({ maxBots: 2 });
    h.cmd(alice, { kind: "spawn" });
    h.register("b1", "Bot-1");
    h.cmd(alice, { kind: "spawn" }); // pending
    const fx = h.cmd(bob, { kind: "spawn" });
    expect(fx).toEqual([{ kind: "reply", to: "pB", text: "Bot limit reached (2/2)." }]);
  });

  it("frees the slot on spawnFailed and tells the requester", () => {
    const h = new H({ maxBots: 1 });
    h.cmd(bob, { kind: "spawn", name: "Scout" });
    const fx = h.c.handle({ kind: "spawnFailed", now: h.now, name: "Scout", requestedBy: "pB", reason: "no space" });
    expect(fx).toEqual([{ kind: "reply", to: "pB", text: "Couldn't spawn Scout: no space." }]);
    expect(h.cmd(bob, { kind: "spawn", name: "Scout" })[0]).toMatchObject({ kind: "spawn", name: "Scout" });
  });

  it("refuses taken names (registered or pending, case-insensitive)", () => {
    const h = new H();
    h.bots(1);
    expect(texts(h.cmd(alice, { kind: "spawn", name: "bot-1" }))).toEqual(["Name 'bot-1' is taken."]);
    h.cmd(alice, { kind: "spawn", name: "Scout" });
    expect(texts(h.cmd(bob, { kind: "spawn", name: "Scout" }))).toEqual(["Name 'Scout' is taken."]);
  });

  it("botRegistered broadcasts join and drains the queue", () => {
    const h = new H({ maxBots: 2 });
    h.bots(1);
    h.goto(alice, 1, 64, 1); // t1 on b1
    h.goto(bob, 2, 64, 2);
    h.cmd(bob, { kind: "queue" }); // t2 queued
    h.cmd(bob, { kind: "spawn" });
    const fx = h.register("b2", "Bot-2");
    expect(fx[0]).toEqual({ kind: "reply", to: "all", text: "Bot-2 joined." });
    expect(fx[1]).toMatchObject({ kind: "assign", botId: "b2", task: { id: "t2" } });
    expect(fx[2]).toMatchObject({ kind: "reply", to: "pB", from: "b2" });
    expect(h.c.snapshot().queued).toEqual([]);
  });
});

describe("status", () => {
  it("lists bots and queued count", () => {
    const h = new H();
    h.bots(2);
    h.goto(bob, 10, 64.5, -3);
    const fx = h.cmd(carol, { kind: "status" });
    expect(texts(fx, "pC")).toEqual(["Bot-1: going to 10 64.5 -3 for Bob", "Bot-2: idle", "Queued: 0"]);
  });

  it("single bot by name (with @), unknown bot errors", () => {
    const h = new H();
    h.bots(1);
    expect(texts(h.cmd(alice, { kind: "status", bot: "@bot-1" }))).toEqual(["Bot-1: idle"]);
    expect(texts(h.cmd(alice, { kind: "status", bot: "Nope" }))).toEqual(["No bot named 'Nope'."]);
  });
});

describe("goto / come", () => {
  it("assigns idle bot and bot acknowledges to sender", () => {
    const h = new H();
    h.bots(2);
    const fx = h.goto(bob, 10, 64, -3);
    expect(fx).toEqual([
      {
        kind: "assign",
        botId: "b1",
        task: { id: "t1", kind: "goto", target: { x: 10, y: 64, z: -3 }, issuer: { id: "pB", name: "Bob" }, createdAt: h.now },
      },
      { kind: "reply", to: "pB", from: "b1", text: "On my way to 10 64 -3." },
    ]);
  });

  it("task ids increment t1, t2, ...", () => {
    const h = new H();
    h.bots(3);
    const fx = h.goto(alice, 1, 2, 3, 3);
    expect(assigns(fx).map((a) => [a.botId, a.task.id])).toEqual([
      ["b1", "t1"],
      ["b2", "t2"],
      ["b3", "t3"],
    ]);
  });

  it("come targets sender position", () => {
    const h = new H();
    h.bots(1);
    const fx = h.cmd(bob, { kind: "come", count: 1 });
    expect(assigns(fx)[0]?.task.target).toEqual(bob.pos);
  });

  it("resolves ~ against sender position", () => {
    const h = new H();
    h.bots(1);
    const target: CoordTriple = { x: { value: 0, relative: true }, y: { value: 5, relative: false }, z: { value: -3, relative: true } };
    const fx = h.cmd(bob, { kind: "goto", target, count: 1 });
    expect(assigns(fx)[0]?.task.target).toEqual({ x: 100, y: 5, z: -53 });
  });

  it("count greater than registered bots is an error", () => {
    const h = new H();
    h.bots(2);
    const fx = h.goto(alice, 0, 0, 0, 3);
    expect(fx).toEqual([{ kind: "reply", to: "pA", text: "Only 2 bots exist; can't send 3." }]);
  });

  it("no bots → hint to spawn", () => {
    const h = new H();
    expect(texts(h.goto(alice, 0, 0, 0))).toEqual(["No bots yet. Type !spawn."]);
  });

  it("busy → offer naming bot, task and owner; uses configured prefix and TTL", () => {
    const h = new H({ prefix: "?", offerTtlTicks: 400 });
    h.bots(1);
    h.goto(alice, 1, 64, 1.25);
    const fx = h.goto(bob, 5, 64, 5);
    expect(fx).toEqual([
      { kind: "reply", to: "pB", text: "Need 1 bot: 0 free, 1 busy." },
      { kind: "reply", to: "pB", text: "Bot-1 is going to 1 64 1.3 for Alice." },
      { kind: "reply", to: "pB", text: "Reply ?override to take over or ?queue to wait (expires in 20s)." },
    ]);
    expect(h.c.snapshot().pendingOffers).toBe(1);
  });

  it("default offer text", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 64, 1);
    expect(texts(h.goto(bob, 5, 64, 5)).at(-1)).toBe("Reply !override to take over or !queue to wait (expires in 30s).");
  });

  it("offer prefers sender's own tasks, then oldest others", () => {
    const h = new H();
    h.bots(3);
    h.goto(carol, 1, 1, 1); // b1 Carol (oldest)
    h.goto(alice, 2, 2, 2); // b2 Alice
    h.goto(bob, 3, 3, 3); // b3 Bob (own)
    const fx = h.goto(bob, 9, 9, 9, 2);
    expect(texts(fx)).toEqual([
      "Need 2 bots: 0 free, 3 busy.",
      "Bot-3 is going to 3 3 3 for Bob.",
      "Bot-1 is going to 1 1 1 for Carol.",
      "Reply !override to take over or !queue to wait (expires in 30s).",
    ]);
  });

  it("own-task preemption needs no offer; cancel precedes assign; old task not requeued", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    const before = h.c.snapshot();
    const fx = h.goto(alice, 2, 2, 2);
    checkAssignInvariant(before, fx);
    expect(fx.map((e) => e.kind)).toEqual(["cancel", "assign", "reply"]);
    expect(fx[0]).toEqual({ kind: "cancel", botId: "b1", taskId: "t1", reason: "preempted" });
    expect(fx[1]).toMatchObject({ kind: "assign", botId: "b1", task: { id: "t2" } });
    expect(h.c.snapshot()).toMatchObject({ queued: [], pendingOffers: 0 });
  });

  it("mixed idle + own busy: idle assigned and own busy preempted, no offer", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // b1 Alice
    const before = h.c.snapshot();
    const fx = h.goto(alice, 2, 2, 2, 2);
    checkAssignInvariant(before, fx);
    expect(assigns(fx).map((a) => a.botId)).toEqual(["b2", "b1"]);
    expect(cancels(fx)).toHaveLength(1);
    expect(h.c.snapshot().pendingOffers).toBe(0);
  });
});

describe("override", () => {
  function busySetup() {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 64, 1); // t1 Alice on b1
    h.goto(bob, 5, 64, 5); // offer for Bob
    return h;
  }

  it("takes bot, cancels before assign, requeues old task at front, notifies previous owner", () => {
    const h = busySetup();
    // an existing queued task, so we can check "front"
    h.goto(carol, 7, 7, 7);
    h.cmd(carol, { kind: "queue" }); // t2 queued
    const before = h.c.snapshot();
    const fx = h.cmd(bob, { kind: "override" });
    checkAssignInvariant(before, fx);
    expect(fx).toEqual([
      { kind: "cancel", botId: "b1", taskId: "t1", reason: "preempted" },
      { kind: "reply", to: "pA", text: "Bot-1 was reassigned by Bob; your task (go to 1 64 1) is queued." },
      expect.objectContaining({ kind: "assign", botId: "b1", task: expect.objectContaining({ id: "t3", issuer: { id: "pB", name: "Bob" } }) }),
      { kind: "reply", to: "pB", from: "b1", text: "On my way to 5 64 5." },
    ]);
    const snap = h.c.snapshot();
    expect(snap.queued.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(snap.pendingOffers).toBe(0);
  });

  it("requeued task is picked up when the bot frees", () => {
    const h = busySetup();
    h.cmd(bob, { kind: "override" });
    const fx = h.done("b1", h.taskOf("b1") ?? "");
    expect(fx).toEqual([
      { kind: "reply", to: "pB", from: "b1", text: "Arrived at 5 64 5." },
      expect.objectContaining({ kind: "assign", botId: "b1", task: expect.objectContaining({ id: "t1" }) }),
      { kind: "reply", to: "pA", from: "b1", text: "Picking up your queued task: going to 1 64 1." },
    ]);
  });

  it("assigns idle bots first and only takes the needed busy ones", () => {
    const h = new H();
    h.bots(3);
    h.goto(alice, 1, 1, 1); // b1
    h.goto(carol, 2, 2, 2); // b2
    h.goto(bob, 9, 9, 9, 2); // 1 idle (b3), takes b1 (oldest)
    const before = h.c.snapshot();
    const fx = h.cmd(bob, { kind: "override" });
    checkAssignInvariant(before, fx);
    expect(assigns(fx).map((a) => a.botId)).toEqual(["b3", "b1"]);
    expect(cancels(fx).map((c) => c.botId)).toEqual(["b1"]);
    expect(h.taskOf("b2")).toBeDefined();
    expect(h.c.snapshot().queued.map((t) => t.issuer.name)).toEqual(["Alice"]);
  });

  it("without an offer → Nothing to override", () => {
    const h = new H();
    expect(h.cmd(alice, { kind: "override" })).toEqual([{ kind: "reply", to: "pA", text: "Nothing to override." }]);
  });
});

describe("queue", () => {
  it("enqueues at the back, replies position, later assigned when a bot frees", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    h.goto(bob, 2, 2, 2);
    expect(h.cmd(bob, { kind: "queue" })).toEqual([{ kind: "reply", to: "pB", text: "Queued 1 task at position 1." }]);
    h.goto(carol, 3, 3, 3);
    expect(texts(h.cmd(carol, { kind: "queue" }))).toEqual(["Queued 1 task at position 2."]);
    expect(h.c.snapshot().queued.map((t) => t.issuer.name)).toEqual(["Bob", "Carol"]);

    const fx = h.done("b1", "t1");
    expect(assigns(fx)[0]?.task.issuer.name).toBe("Bob");
    expect(replies(fx, "pB")[0]).toMatchObject({ from: "b1", text: "Picking up your queued task: going to 2 2 2." });
  });

  it("assigns idle bots now and queues the rest", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // b1 busy
    h.goto(bob, 2, 2, 2, 2);
    const fx = h.cmd(bob, { kind: "queue" });
    expect(assigns(fx).map((a) => a.botId)).toEqual(["b2"]);
    expect(texts(fx, "pB").at(-1)).toBe("Queued 1 task at position 1.");
    expect(h.c.snapshot().queued).toHaveLength(1);
  });

  it("without a goto offer → reply", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.cmd(bob, { kind: "stop", bot: "Bot-1" }); // stop offer, not goto
    expect(texts(h.cmd(bob, { kind: "queue" }))).toEqual(["Nothing to queue."]);
  });

  it("tick drains queue when a bot is idle", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" });
    // stale-safe: simulate the bot becoming idle via a stop then tick
    h.cmd(alice, { kind: "stop" }); // also drains
    expect(h.taskOf("b1")).toBe("t2");
    expect(h.tick()).toEqual([]);
  });
});

describe("offers", () => {
  it("expire after TTL on tick and notify owner", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    expect(h.tick(599)).toEqual([]);
    expect(h.tick(1)).toEqual([{ kind: "reply", to: "pB", text: "Your pending request expired." }]);
    expect(h.c.snapshot().pendingOffers).toBe(0);
    expect(texts(h.cmd(bob, { kind: "override" }))).toEqual(["Nothing to override."]);
  });

  it("an offer past TTL is dead even before the tick expires it", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    expect(texts(h.cmd(bob, { kind: "override" }, 600))).toEqual(["Nothing to override."]);
    expect(h.taskOf("b1")).toBe("t1");
  });

  it("one offer per player: newer replaces older", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    h.goto(bob, 3, 3, 3);
    expect(h.c.snapshot().pendingOffers).toBe(1);
    const fx = h.cmd(bob, { kind: "override" });
    expect(assigns(fx)[0]?.task.target).toEqual({ x: 3, y: 3, z: 3 });
  });

  it("offers are per player", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    h.goto(carol, 3, 3, 3);
    expect(h.c.snapshot().pendingOffers).toBe(2);
  });
});

describe("stop", () => {
  it("no bot: cancels own active tasks, drops own queued, replies count, drains", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1, 2); // t1 b1, t2 b2
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" }); // t3 queued (Bob)
    h.goto(alice, 3, 3, 3); // all bots run Alice's tasks → b1 preempted directly to t4
    // Alice now has b1(t4), b2(t2); Bob has t3 queued
    const fx = h.cmd(alice, { kind: "stop" });
    expect(cancels(fx).map((c) => [c.botId, c.reason])).toEqual([
      ["b1", "stopped"],
      ["b2", "stopped"],
    ]);
    expect(texts(fx, "pA")).toEqual(["Stopped 2 tasks, dropped 0 queued."]);
    expect(assigns(fx)).toHaveLength(1); // Bob's queued task picked up
    expect(assigns(fx)[0]?.task.id).toBe("t3");
  });

  it("no bot: drops own queued tasks", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" });
    const fx = h.cmd(bob, { kind: "stop" });
    expect(fx).toEqual([{ kind: "reply", to: "pB", text: "Stopped 0 tasks, dropped 1 queued." }]);
    expect(h.c.snapshot().queued).toEqual([]);
  });

  it("no bot and nothing to stop", () => {
    const h = new H();
    expect(texts(h.cmd(alice, { kind: "stop" }))).toEqual(["You have no active or queued tasks."]);
  });

  it("named idle bot → says so; unknown → error", () => {
    const h = new H();
    h.bots(1);
    expect(texts(h.cmd(alice, { kind: "stop", bot: "Bot-1" }))).toEqual(["Bot-1 is idle."]);
    expect(texts(h.cmd(alice, { kind: "stop", bot: "Bot-9" }))).toEqual(["No bot named 'Bot-9'."]);
  });

  it("named bot on own task → cancel(stopped)", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    const fx = h.cmd(alice, { kind: "stop", bot: "@Bot-1" });
    expect(fx).toEqual([
      { kind: "cancel", botId: "b1", taskId: "t1", reason: "stopped" },
      { kind: "reply", to: "pA", text: "Stopped Bot-1." },
    ]);
  });

  it("named bot on someone else's task → stop offer; override stops, notifies, no requeue", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    const offerFx = h.cmd(bob, { kind: "stop", bot: "Bot-1" });
    expect(offerFx.some((e) => e.kind === "cancel")).toBe(false);
    expect(texts(offerFx)).toEqual(["Bot-1 is going to 1 1 1 for Alice.", "Reply !override to stop it (expires in 30s)."]);
    expect(h.c.snapshot().pendingOffers).toBe(1);

    const fx = h.cmd(bob, { kind: "override" });
    expect(fx).toEqual([
      { kind: "cancel", botId: "b1", taskId: "t1", reason: "stopped" },
      { kind: "reply", to: "pB", text: "Stopped Bot-1." },
      { kind: "reply", to: "pA", text: "Bot-1 was stopped by Bob." },
    ]);
    expect(h.c.snapshot()).toMatchObject({ queued: [], pendingOffers: 0 });
  });

  it("stop offer is void if the bot moved on to another task", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.cmd(bob, { kind: "stop", bot: "Bot-1" });
    h.done("b1", "t1");
    h.goto(alice, 2, 2, 2); // t2
    const fx = h.cmd(bob, { kind: "override" });
    expect(cancels(fx)).toEqual([]);
    expect(texts(fx)).toEqual(["Bot-1 is no longer on that task."]);
    expect(h.taskOf("b1")).toBe("t2");
  });
});

describe("cooldown", () => {
  it("rejects commands within cooldown with only 'Slow down…'", () => {
    const h = new H();
    h.bots(1);
    h.cmd(alice, { kind: "status" });
    const fx = h.cmd(alice, { kind: "goto", target: abs(1, 1, 1), count: 1 }, 19);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ kind: "reply", to: "pA" });
    expect(texts(fx)[0]).toMatch(/^Slow down…/);
    // rejected command does not reset the window: 1 tick later (20 since accepted) is fine
    expect(assigns(h.cmd(alice, { kind: "goto", target: abs(1, 1, 1), count: 1 }, 1))).toHaveLength(1);
  });

  it("is per player", () => {
    const h = new H();
    h.cmd(alice, { kind: "status" });
    expect(texts(h.cmd(bob, { kind: "status" }, 0))).toEqual(["No bots yet. Type !spawn.", "Queued: 0"]);
  });

  it("override and queue are exempt", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1, 2);
    h.goto(bob, 2, 2, 2);
    expect(assigns(h.cmd(bob, { kind: "override" }, 1))).toHaveLength(1);
    h.goto(carol, 3, 3, 3);
    expect(texts(h.cmd(carol, { kind: "queue" }, 1))).toEqual(["Queued 1 task at position 2."]);
  });
});

describe("taskReport", () => {
  it("done → bot reply arrived; bot becomes idle", () => {
    const h = new H();
    h.bots(1);
    h.goto(bob, 10.5, 64, -3);
    expect(h.done("b1", "t1")).toEqual([{ kind: "reply", to: "pB", from: "b1", text: "Arrived at 10.5 64 -3." }]);
    expect(h.c.snapshot().bots[0]?.state).toBe("idle");
  });

  it("failed → bot reply with reason; not retried", () => {
    const h = new H();
    h.bots(1);
    h.goto(bob, 1, 2, 3);
    expect(h.failed("b1", "t1", "unreachable")).toEqual([{ kind: "reply", to: "pB", from: "b1", text: "Couldn't reach 1 2 3: no path." }]);
    expect(h.c.snapshot()).toMatchObject({ queued: [], bots: [{ state: "idle" }] });
  });

  it("stale task id is ignored", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    h.goto(alice, 2, 2, 2); // own preempt → t2
    expect(h.done("b1", "t1")).toEqual([]);
    expect(h.failed("b1", "t1", "timeout")).toEqual([]);
    expect(h.done("nobody", "t2")).toEqual([]);
    expect(h.taskOf("b1")).toBe("t2");
  });
});

describe("botRemoved", () => {
  it("requeues task at front, notifies issuer, broadcasts leave", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" }); // t2
    const fx = h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "despawned" });
    expect(fx).toEqual([
      { kind: "reply", to: "pA", text: "Bot-1 left; your task (go to 1 1 1) is queued." },
      { kind: "reply", to: "all", text: "Bot-1 left (despawned)." },
    ]);
    expect(h.c.snapshot()).toMatchObject({ bots: [], queued: [{ id: "t1" }, { id: "t2" }] });
  });

  it("requeued task goes to the next idle bot", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // b1
    const fx = h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "x" });
    expect(assigns(fx)).toEqual([expect.objectContaining({ botId: "b2", task: expect.objectContaining({ id: "t1" }) })]);
  });

  it("unknown bot is ignored", () => {
    const h = new H();
    expect(h.c.handle({ kind: "botRemoved", now: 0, botId: "zz", reason: "x" })).toEqual([]);
  });
});

describe("snapshot", () => {
  it("reflects bots in registration order, tasks, queue and offers; is a copy", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // t1 b1
    h.goto(bob, 2, 2, 2); // t2 b2
    h.goto(carol, 3, 3, 3); // offer
    const snap = h.c.snapshot();
    expect(snap).toEqual({
      bots: [
        { id: "b1", name: "Bot-1", state: "busy", task: expect.objectContaining({ id: "t1", issuer: { id: "pA", name: "Alice" } }) },
        { id: "b2", name: "Bot-2", state: "busy", task: expect.objectContaining({ id: "t2" }) },
      ],
      queued: [],
      pendingOffers: 1,
    });
    // mutation of the snapshot must not leak into state
    const t = snap.bots[0]?.task;
    if (t) t.target.x = 999;
    expect(h.c.snapshot().bots[0]?.task?.target.x).toBe(1);
  });

  it("idle bots have no task key", () => {
    const h = new H();
    h.bots(1);
    expect(h.c.snapshot().bots[0]).toEqual({ id: "b1", name: "Bot-1", state: "idle" });
  });
});

describe("determinism / invariants", () => {
  it("same event sequence gives identical effects", () => {
    const run = () => {
      const h = new H();
      const all: Effect[] = [];
      h.bots(3);
      all.push(...h.goto(alice, 1, 1, 1, 2));
      all.push(...h.goto(bob, 2, 2, 2, 3));
      all.push(...h.cmd(bob, { kind: "override" }));
      all.push(...h.tick());
      return all;
    };
    expect(run()).toEqual(run());
  });

  it("never assigns a busy bot without a preceding cancel across a busy scenario", () => {
    const h = new H();
    h.bots(3);
    const steps: Array<(() => Effect[]) | [() => Effect[], string]> = [
      () => h.goto(alice, 1, 1, 1, 2),
      () => h.goto(bob, 2, 2, 2, 3),
      () => h.cmd(bob, { kind: "override" }),
      () => h.goto(alice, 3, 3, 3, 3),
      () => h.cmd(alice, { kind: "queue" }),
      () => h.goto(carol, 4, 4, 4, 3),
      () => h.cmd(carol, { kind: "override" }),
      [() => h.done("b1", h.taskOf("b1") ?? ""), "b1"],
      () => h.tick(),
      () => h.goto(carol, 5, 5, 5, 3),
      () => h.cmd(alice, { kind: "stop" }),
      () => h.tick(),
    ];
    let assignsSeen = 0;
    for (const step of steps) {
      const [run, freed] = Array.isArray(step) ? step : [step, undefined];
      const before = h.c.snapshot();
      const fx = run();
      assignsSeen += assigns(fx).length;
      checkAssignInvariant(before, fx, freed ? [freed] : []);
    }
    expect(assignsSeen).toBeGreaterThan(5);
  });
});

describe("review fixes and uncovered spec bullets", () => {
  it("a rejected goto (count too high) keeps the sender's pending offer", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2); // offer
    expect(texts(h.goto(bob, 3, 3, 3, 5))).toEqual(["Only 1 bot exists; can't send 5."]);
    expect(h.c.snapshot().pendingOffers).toBe(1);
    expect(assigns(h.cmd(bob, { kind: "override" }))[0]?.task.target).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("botRegistered releases the pending spawn case-insensitively", () => {
    const h = new H({ maxBots: 2 });
    h.cmd(alice, { kind: "spawn", name: "Scout" });
    h.register("b1", "scout");
    h.cmd(alice, { kind: "spawn" });
    h.register("b2", "Bot-1");
    expect(h.c.snapshot().bots).toHaveLength(2);
    // limit counts 2 registered + 0 pending, not a leaked reservation
    expect(texts(h.cmd(alice, { kind: "spawn" }))).toEqual(["Bot limit reached (2/2)."]);
    h.c.handle({ kind: "botRemoved", now: h.now, botId: "b2", reason: "x" });
    expect(h.cmd(alice, { kind: "spawn" })[0]).toMatchObject({ kind: "spawn", name: "Bot-1" });
  });

  it("stop offer on a bot that has since left names the bot", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.cmd(bob, { kind: "stop", bot: "Bot-1" });
    h.c.handle({ kind: "botRemoved", now: h.now, botId: "b1", reason: "x" });
    expect(h.cmd(bob, { kind: "override" })).toEqual([{ kind: "reply", to: "pB", text: "Bot-1 is no longer on that task." }]);
    expect(h.c.snapshot().queued.map((t) => t.id)).toEqual(["t1"]); // stop offer did not drop the requeued task
  });

  it("expired stop offer cannot be overridden", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.cmd(bob, { kind: "stop", bot: "Bot-1" });
    expect(h.tick(600)).toEqual([{ kind: "reply", to: "pB", text: "Your pending request expired." }]);
    expect(texts(h.cmd(bob, { kind: "override" }))).toEqual(["Nothing to override."]);
    expect(h.taskOf("b1")).toBe("t1");
  });

  it("override with mixed own + other busy bots: other's task requeued and notified, own task replaced silently", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // t1 b1 Alice
    h.goto(bob, 2, 2, 2); // t2 b2 Bob
    h.goto(bob, 9, 9, 9, 2); // offer: own b2 first, then b1 (Alice)
    const before = h.c.snapshot();
    const fx = h.cmd(bob, { kind: "override" });
    checkAssignInvariant(before, fx);
    expect(cancels(fx).map((c) => [c.botId, c.reason])).toEqual([
      ["b2", "preempted"],
      ["b1", "preempted"],
    ]);
    expect(replies(fx).filter((r) => r.from === undefined)).toEqual([
      { kind: "reply", to: "pA", text: "Bot-1 was reassigned by Bob; your task (go to 1 1 1) is queued." },
    ]);
    expect(h.c.snapshot().queued.map((t) => t.id)).toEqual(["t1"]);
  });

  it("override re-plans: a bot that freed up since the offer is used without preempting anyone", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    h.goto(bob, 2, 2, 2); // offer
    h.done("b1", "t1");
    const fx = h.cmd(bob, { kind: "override" });
    expect(cancels(fx)).toEqual([]);
    expect(texts(fx, "pA")).toEqual([]);
    expect(assigns(fx).map((a) => [a.botId, a.task.issuer.name])).toEqual([["b1", "Bob"]]);
    expect(h.c.snapshot().queued).toEqual([]);
  });

  it("override after bots left so count exceeds bots → error, offer consumed", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1, 2);
    h.goto(bob, 2, 2, 2, 2);
    h.c.handle({ kind: "botRemoved", now: h.now, botId: "b2", reason: "x" });
    const fx = h.cmd(bob, { kind: "override" });
    expect(fx).toEqual([{ kind: "reply", to: "pB", text: "Only 1 bot exists; can't send 2." }]);
    expect(h.c.snapshot().pendingOffers).toBe(0);
  });

  it("offer picks the oldest other task by age, not registration order", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1); // t1 b1
    h.goto(carol, 2, 2, 2); // t2 b2 (Carol)
    h.done("b1", "t1");
    h.goto(alice, 3, 3, 3); // t3 b1 (newer than Carol's)
    expect(texts(h.goto(bob, 9, 9, 9))[1]).toBe("Bot-2 is going to 2 2 2 for Carol.");
  });

  it("a newer offer replaces the older one and restarts the TTL", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2); // offer @ T
    h.goto(bob, 3, 3, 3, 1); // replaced @ T+100
    expect(h.tick(500)).toEqual([]); // 600 since first, 500 since second
    expect(h.tick(100)).toEqual([{ kind: "reply", to: "pB", text: "Your pending request expired." }]);
  });

  it("each expiring offer notifies only its owner", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    h.goto(carol, 3, 3, 3);
    const fx = h.tick(700);
    expect(replies(fx).map((r) => r.to).sort()).toEqual(["pB", "pC"]);
    expect(h.c.snapshot().pendingOffers).toBe(0);
  });

  it("queue: expired offer → Nothing to queue; multiple tasks report a position range", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2);
    expect(texts(h.cmd(bob, { kind: "queue" }, 600))).toEqual(["Nothing to queue."]);
    expect(h.c.snapshot().pendingOffers).toBe(0);
    h.goto(carol, 3, 3, 3);
    h.cmd(carol, { kind: "queue" });
    h.goto(bob, 4, 4, 4, 1);
    h.cmd(bob, { kind: "stop", bot: "Bot-1" }); // stop offer replaces goto offer
    expect(texts(h.cmd(bob, { kind: "queue" }))).toEqual(["Nothing to queue."]);
    h.goto(bob, 4, 4, 4, 1);
    expect(texts(h.cmd(bob, { kind: "queue" }))).toEqual(["Queued 1 task at position 2."]);
    expect(texts(h.cmd(carol, { kind: "status" }))).toContain("Queued: 2");
  });

  it("queue with count > free bots queues the rest at consecutive positions", () => {
    const h = new H();
    h.bots(3);
    h.goto(alice, 1, 1, 1, 2); // b1, b2
    h.goto(bob, 2, 2, 2, 3);
    const fx = h.cmd(bob, { kind: "queue" });
    expect(assigns(fx).map((a) => a.botId)).toEqual(["b3"]);
    expect(texts(fx, "pB").at(-1)).toBe("Queued 2 tasks at positions 1-2.");
  });

  it("failed report and named own stop both drain the queue", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1); // t1
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" }); // t2
    h.goto(carol, 3, 3, 3);
    h.cmd(carol, { kind: "queue" }); // t3
    const f = h.failed("b1", "t1", "timeout");
    expect(f[0]).toEqual({ kind: "reply", to: "pA", from: "b1", text: "Couldn't reach 1 1 1: timed out." });
    expect(h.taskOf("b1")).toBe("t2");
    const s = h.cmd(bob, { kind: "stop", bot: "Bot-1" });
    expect(cancels(s)).toEqual([{ kind: "cancel", botId: "b1", taskId: "t2", reason: "stopped" }]);
    expect(h.taskOf("b1")).toBe("t3");
    expect(replies(s, "pC")[0]).toMatchObject({ from: "b1", text: "Picking up your queued task: going to 3 3 3." });
  });

  it("override and queue don't reset the cooldown window", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2); // accepted @ T
    h.cmd(bob, { kind: "override" }, 10); // T+10, exempt
    // T+20 is outside the window measured from the goto, not the override
    expect(texts(h.cmd(bob, { kind: "status" }, 10))[0]).not.toMatch(/^Slow down/);
  });

  it("botRemoved requeues ahead of existing queue entries and the left line goes to all", () => {
    const h = new H();
    h.bots(2);
    h.goto(alice, 1, 1, 1, 2); // t1 b1, t2 b2
    h.goto(bob, 2, 2, 2);
    h.cmd(bob, { kind: "queue" }); // t3
    const fx = h.c.handle({ kind: "botRemoved", now: h.now, botId: "b2", reason: "gone" });
    expect(replies(fx, "all").map((r) => r.text)).toEqual(["Bot-2 left (gone)."]);
    expect(h.c.snapshot().queued.map((t) => t.id)).toEqual(["t2", "t3"]);
    // the freed b1 picks up the requeued task first
    expect(assigns(h.done("b1", "t1"))[0]?.task.id).toBe("t2");
  });

  it("rejects a resolved target outside build height without touching the pending offer", () => {
    const h = new H();
    h.bots(1);
    h.goto(alice, 1, 1, 1);
    h.goto(bob, 2, 2, 2); // bob now holds an offer
    const fx = h.goto(bob, 0, 400, 0);
    expect(texts(fx, "pB")).toEqual(["Target Y 400 is outside the world (-64 to 320)."]);
    expect(assigns(fx)).toHaveLength(0);
    expect(texts(h.cmd(bob, { kind: "override" }, 10)).join(" ")).not.toMatch(/Nothing to override/);
  });
});
