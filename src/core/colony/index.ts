// Deterministic colony core: task model, allocator, offers.
// Functional core: no clocks, randomness, I/O, or @minecraft imports. Time arrives on events.
import {
  DEFAULT_CONFIG,
  type BotId,
  type ChestRef,
  type ColonyConfig,
  type ColonyEvent,
  type ColonySnapshot,
  type Command,
  type Effect,
  type PlayerId,
  type PlayerRef,
  type Sender,
  type Task,
  type TaskProgress,
  type Tick,
  type Vec3,
} from "../types.js";
import { RESOURCES } from "../items.js";
import { COORD_LIMITS } from "../commands/index.js";
import { planAllocation } from "./allocator.js";
import { msg, resourceLabel, taskActivity, taskNoun } from "./messages.js";
import { createState, type BotRecord, type ColonyState, type Offer, type TaskOffer, type TaskSpec } from "./state.js";

export { fmtNum, fmtPos, msg, taskActivity, taskNoun } from "./messages.js";
export { planAllocation } from "./allocator.js";

type CommandEvent = Extract<ColonyEvent, { kind: "command" }>;
type ReportEvent = Extract<ColonyEvent, { kind: "taskReport" }>;
type ProgressEvent = Extract<ColonyEvent, { kind: "taskProgress" }>;
type GatherCommand = Extract<Command, { kind: "gather" }>;

export class Colony {
  readonly config: ColonyConfig;
  private readonly s: ColonyState = createState();
  /** Effects for the event currently being handled. */
  private out: Effect[] = [];

  constructor(config?: Partial<ColonyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  handle(e: ColonyEvent): Effect[] {
    this.out = [];
    switch (e.kind) {
      case "command":
        this.onCommand(e);
        break;
      case "botRegistered":
        this.onBotRegistered(e.botId, e.name);
        break;
      case "botRemoved":
        this.onBotRemoved(e.botId, e.reason);
        break;
      case "spawnFailed":
        this.onSpawnFailed(e.name, e.requestedBy, e.reason);
        break;
      case "taskReport":
        this.onTaskReport(e);
        break;
      case "tick":
        this.onTick(e.now);
        break;
      case "taskProgress":
        this.onTaskProgress(e);
        break;
      case "chestLocated":
        this.s.chest = copyChest(e.chest);
        this.reply(e.requestedBy, msg.chestSet(e.chest.pos));
        break;
      case "chestLocateFailed":
        this.reply(e.requestedBy, msg.chestLocateFailed(e.reason, this.config.prefix));
        break;
      case "chestInspected":
        this.reply(e.to, chestLine(e.chest, e.items));
        break;
    }
    const effects = this.out;
    this.out = [];
    return effects;
  }

  snapshot(): ColonySnapshot {
    return {
      bots: this.botList().map((b) => {
        if (!b.task) return { id: b.id, name: b.name, state: "idle" as const };
        const view = { id: b.id, name: b.name, state: "busy" as const, task: copyTask(b.task) };
        return b.progress ? { ...view, progress: { ...b.progress } } : view;
      }),
      queued: this.s.queue.map(copyTask),
      pendingOffers: this.s.offers.size,
      ...(this.s.chest ? { chest: copyChest(this.s.chest) } : {}),
    };
  }

  // ---------------------------------------------------------------- commands

  private onCommand(e: CommandEvent): void {
    const { command: c, sender, now } = e;
    if (c.kind === "help") return; // rendered by the glue layer

    if (c.kind !== "override" && c.kind !== "queue") {
      const last = this.s.lastCommandAt.get(sender.id);
      if (last !== undefined && now - last < this.config.commandCooldownTicks) {
        this.reply(sender.id, msg.slowDown());
        return;
      }
      this.s.lastCommandAt.set(sender.id, now);
    }

    switch (c.kind) {
      case "gather":
        return this.cmdGather(sender, now, c);
      case "chest":
        return this.cmdChest(sender, c.action);
      case "status":
        return this.cmdStatus(sender, c.bot);
      case "spawn":
        return this.cmdSpawn(sender, c.name);
      case "goto":
        return this.cmdGoto(sender, now, resolveTarget(c, sender.pos), c.count);
      case "come":
        return this.cmdGoto(sender, now, { ...sender.pos }, c.count);
      case "stop":
        return this.cmdStop(sender, now, c.bot);
      case "override":
        return this.cmdOverride(sender, now);
      case "queue":
        return this.cmdQueue(sender, now);
    }
  }

  private cmdStatus(sender: Sender, botName?: string): void {
    if (botName !== undefined) {
      const bot = this.findBot(botName);
      if (!bot) return this.reply(sender.id, msg.unknownBot(botName));
      return this.reply(sender.id, statusLine(bot));
    }
    const bots = this.botList();
    if (bots.length === 0) this.reply(sender.id, msg.noBots(this.config.prefix));
    for (const b of bots) this.reply(sender.id, statusLine(b));
    this.reply(sender.id, msg.statusQueued(this.s.queue.length));
  }

  private cmdSpawn(sender: Sender, requested?: string): void {
    const max = this.config.maxBots;
    if (this.s.bots.size + this.s.pendingSpawns.length >= max) {
      return this.reply(sender.id, msg.spawnLimit(max));
    }
    let name: string;
    if (requested !== undefined) {
      if (this.nameInUse(requested)) return this.reply(sender.id, msg.nameTaken(requested));
      name = requested;
    } else {
      name = this.defaultName();
    }
    this.s.pendingSpawns.push({ name, requestedBy: sender.id });
    this.out.push({ kind: "spawn", name, near: { ...sender.pos }, requestedBy: sender.id });
    this.reply(sender.id, msg.spawning(name));
  }

  private cmdGoto(sender: Sender, now: Tick, target: Vec3, rawCount: number): void {
    const n = Math.max(1, Math.floor(rawCount));
    if (target.y < COORD_LIMITS.minY || target.y > COORD_LIMITS.maxY) {
      return this.reply(sender.id, msg.outOfWorld(target.y, COORD_LIMITS.minY, COORD_LIMITS.maxY));
    }
    const specs: TaskSpec[] = [];
    for (let i = 0; i < n; i++) specs.push({ kind: "goto", target: { ...target } });
    this.request(sender, now, specs);
  }

  private cmdGather(sender: Sender, now: Tick, c: GatherCommand): void {
    const chest = this.s.chest;
    // Rejected requests have no side effects: the player's pending offer survives.
    if (!chest) return this.reply(sender.id, msg.noChest(this.config.prefix));
    const n = Math.max(1, Math.min(Math.floor(c.count), c.amount));
    const specs = splitAmount(c.amount, n).map(
      (amount): TaskSpec => ({ kind: "gather", item: c.item, amount, origin: { ...sender.pos }, chest: copyChest(chest) }),
    );
    this.request(sender, now, specs);
  }

  private cmdChest(sender: Sender, action: "show" | "set"): void {
    if (action === "set") {
      this.out.push({ kind: "locateChest", requestedBy: sender.id, near: { ...sender.pos } });
      return;
    }
    const chest = this.s.chest;
    if (!chest) return this.reply(sender.id, msg.noChest(this.config.prefix));
    this.out.push({ kind: "inspectChest", to: sender.id, chest: copyChest(chest) });
  }

  /**
   * Shared allocation for every multi-bot task request: one spec per bot. Assigns directly when every bot
   * to take runs the sender's own task (those are dropped, not requeued); otherwise creates an offer.
   */
  private request(sender: Sender, now: Tick, specs: TaskSpec[]): void {
    const n = specs.length;
    const bots = this.botList();
    if (bots.length === 0) return this.reply(sender.id, msg.noBots(this.config.prefix));
    if (n > bots.length) return this.reply(sender.id, msg.tooMany(n, bots.length));
    // A valid fresh request supersedes whatever this player had pending.
    this.s.offers.delete(sender.id);

    const plan = planAllocation(bots, n, sender.id);
    const allOwn = plan.take.every((b) => b.task?.issuer.id === sender.id);
    if (allOwn) {
      let i = 0;
      for (const b of plan.idle) this.assignNew(b, sender, now, specs[i++] as TaskSpec);
      for (const b of plan.take) {
        // Own task: replaced outright, not requeued.
        this.cancel(b, "preempted");
        this.assignNew(b, sender, now, specs[i++] as TaskSpec);
      }
      return;
    }

    this.s.offers.set(sender.id, { kind: "task", owner: ref(sender), createdAt: now, specs });
    const busy = bots.filter((b) => b.task).length;
    this.reply(sender.id, msg.offerCounts(n, bots.length - busy, busy));
    for (const b of plan.take) {
      const t = b.task as Task;
      this.reply(sender.id, msg.offerBusyBot(b.name, taskActivity(t, b.progress), t.issuer.name));
    }
    this.reply(sender.id, msg.offerHint(this.config.prefix, this.offerSecs()));
  }

  private cmdStop(sender: Sender, now: Tick, botName?: string): void {
    if (botName === undefined) {
      this.s.offers.delete(sender.id); // "stop everything" includes a pending request
      let active = 0;
      for (const b of this.botList()) {
        if (b.task?.issuer.id === sender.id) {
          this.cancel(b, "stopped");
          active++;
        }
      }
      const before = this.s.queue.length;
      this.s.queue = this.s.queue.filter((t) => t.issuer.id !== sender.id);
      this.reply(sender.id, msg.stoppedCount(active, before - this.s.queue.length));
      this.drainQueue();
      return;
    }

    const bot = this.findBot(botName);
    if (!bot) return this.reply(sender.id, msg.unknownBot(botName));
    const task = bot.task;
    if (!task) return this.reply(sender.id, msg.botIdle(bot.name));

    if (task.issuer.id === sender.id) {
      this.cancel(bot, "stopped");
      this.reply(sender.id, msg.stoppedBot(bot.name));
      this.drainQueue();
      return;
    }

    this.s.offers.set(sender.id, {
      kind: "stop",
      owner: ref(sender),
      createdAt: now,
      botId: bot.id,
      botName: bot.name,
      taskId: task.id,
    });
    this.reply(sender.id, msg.offerBusyBot(bot.name, taskActivity(task, bot.progress), task.issuer.name));
    this.reply(sender.id, msg.stopOfferHint(this.config.prefix, this.offerSecs()));
  }

  private cmdOverride(sender: Sender, now: Tick): void {
    const offer = this.takeLiveOffer(sender.id, now);
    if (!offer) return this.reply(sender.id, msg.nothingToOverride());

    if (offer.kind === "stop") {
      const bot = this.s.bots.get(offer.botId);
      if (!bot || bot.task?.id !== offer.taskId) {
        return this.reply(sender.id, msg.noLongerOnTask(bot?.name ?? offer.botName));
      }
      const victim = bot.task;
      this.cancel(bot, "stopped");
      this.reply(sender.id, msg.stoppedBot(bot.name));
      if (victim.issuer.id !== sender.id) this.reply(victim.issuer.id, msg.stoppedBy(bot.name, sender.name));
      this.drainQueue();
      return;
    }

    this.executeTaskOffer(sender, now, offer);
  }

  /** Re-plans against current state (bots may have freed up or left since the offer). */
  private executeTaskOffer(sender: Sender, now: Tick, offer: TaskOffer): void {
    const n = offer.specs.length;
    const bots = this.botList();
    if (bots.length === 0) return this.reply(sender.id, msg.noBots(this.config.prefix));
    if (n > bots.length) return this.reply(sender.id, msg.tooMany(n, bots.length));

    const plan = planAllocation(bots, n, sender.id);
    let i = 0;
    for (const b of plan.idle) this.assignNew(b, sender, now, offer.specs[i++] as TaskSpec);

    const requeue: Task[] = [];
    for (const b of plan.take) {
      const old = b.task as Task;
      const progress = b.progress;
      this.cancel(b, "preempted");
      if (old.issuer.id !== sender.id) {
        const again = requeueable(old, progress);
        if (again) {
          requeue.push(again);
          this.reply(old.issuer.id, msg.reassigned(b.name, sender.name, taskNoun(again)));
        } else {
          this.reply(old.issuer.id, msg.reassignedDone(b.name, sender.name, taskNoun(withDelivered(old, progress))));
        }
      }
      this.assignNew(b, sender, now, offer.specs[i++] as TaskSpec);
    }
    // Preempted tasks go to the front, keeping their relative order.
    this.s.queue.unshift(...requeue);
  }

  private cmdQueue(sender: Sender, now: Tick): void {
    const offer = this.s.offers.get(sender.id);
    if (!offer || offer.kind !== "task" || !this.isLive(offer, now)) {
      if (offer && !this.isLive(offer, now)) this.s.offers.delete(sender.id);
      return this.reply(sender.id, msg.nothingToQueue());
    }
    this.s.offers.delete(sender.id);

    const specs = [...offer.specs];
    for (const b of this.botList()) {
      if (specs.length === 0) break;
      if (!b.task) this.assignNew(b, sender, now, specs.shift() as TaskSpec);
    }
    if (specs.length === 0) return;
    const first = this.s.queue.length + 1;
    for (const spec of specs) this.s.queue.push(this.newTask(sender, now, spec));
    this.reply(sender.id, msg.queuedAt(specs.length, first));
  }

  // ---------------------------------------------------------------- game events

  private onBotRegistered(botId: BotId, name: string): void {
    this.dropPendingSpawn(name);

    const existing = this.s.bots.get(botId);
    if (existing) {
      existing.name = name; // re-registration (e.g. respawn): keep seq and task
    } else {
      this.s.bots.set(botId, { id: botId, name, seq: this.s.nextBotSeq++ });
      this.reply("all", msg.joined(name));
    }
    this.drainQueue();
  }

  private onSpawnFailed(name: string, requestedBy: PlayerId, reason: string): void {
    this.dropPendingSpawn(name);
    this.reply(requestedBy, msg.spawnFailed(name, reason));
  }

  /** Names are reserved case-insensitively (see nameInUse), so release them the same way. */
  private dropPendingSpawn(name: string): void {
    const key = name.toLowerCase();
    const pi = this.s.pendingSpawns.findIndex((p) => p.name.toLowerCase() === key);
    if (pi >= 0) this.s.pendingSpawns.splice(pi, 1);
  }

  private onBotRemoved(botId: BotId, reason: string): void {
    const bot = this.s.bots.get(botId);
    if (!bot) return;
    this.s.bots.delete(botId);
    if (bot.task) {
      const again = requeueable(bot.task, bot.progress);
      if (again) {
        this.s.queue.unshift(again);
        this.reply(again.issuer.id, msg.botLeftRequeued(bot.name, taskNoun(again)));
      } else {
        this.reply(bot.task.issuer.id, msg.botLeftDone(bot.name, taskNoun(withDelivered(bot.task, bot.progress))));
      }
    }
    this.reply("all", msg.left(bot.name, reason));
    this.drainQueue();
  }

  private onTaskReport(e: ReportEvent): void {
    const bot = this.s.bots.get(e.botId);
    const task = bot?.task;
    if (!bot || !task || task.id !== e.taskId) return; // stale or unknown: ignore

    const progress = bot.progress;
    bot.task = undefined;
    bot.progress = undefined;
    this.botSay(bot, task.issuer.id, reportText(task, progress, e));
    this.drainQueue();
  }

  private onTaskProgress(e: ProgressEvent): void {
    const bot = this.s.bots.get(e.botId);
    if (!bot?.task || bot.task.id !== e.taskId) return; // stale or unknown: ignore
    bot.progress = { ...e.progress };
  }

  private onTick(now: Tick): void {
    for (const [player, offer] of [...this.s.offers]) {
      if (!this.isLive(offer, now)) {
        this.s.offers.delete(player);
        this.reply(player, msg.offerExpired());
      }
    }
    this.drainQueue();
  }

  // ---------------------------------------------------------------- helpers

  /** Assign queue heads to idle bots, registration order. */
  private drainQueue(): void {
    for (const b of this.botList()) {
      if (this.s.queue.length === 0) return;
      if (b.task) continue;
      const task = this.s.queue.shift() as Task;
      this.assign(b, task);
      this.botSay(b, task.issuer.id, msg.pickingUp(taskActivity(task)));
    }
  }

  private assignNew(bot: BotRecord, sender: Sender, now: Tick, spec: TaskSpec): void {
    const task = this.newTask(sender, now, spec);
    this.assign(bot, task);
    this.botSay(bot, sender.id, task.kind === "goto" ? msg.onMyWay(task.target) : msg.gathering(task.amount, resourceLabel(task)));
  }

  /** The only place that emits `assign`. Enforces: bot must be idle (cancel first). */
  private assign(bot: BotRecord, task: Task): void {
    if (bot.task) throw new Error(`colony invariant: assign to busy bot ${bot.id}`);
    bot.task = task;
    bot.progress = undefined;
    this.out.push({ kind: "assign", botId: bot.id, task: copyTask(task) });
  }

  /** The only place that emits `cancel`. Leaves the bot idle. */
  private cancel(bot: BotRecord, reason: "stopped" | "preempted"): void {
    const task = bot.task;
    if (!task) return;
    bot.task = undefined;
    bot.progress = undefined;
    this.out.push({ kind: "cancel", botId: bot.id, taskId: task.id, reason });
  }

  private newTask(issuer: PlayerRef, now: Tick, spec: TaskSpec): Task {
    const id = `t${this.s.nextTaskNum++}`;
    if (spec.kind === "goto") {
      return { id, kind: "goto", target: { ...spec.target }, issuer: ref(issuer), createdAt: now };
    }
    return {
      id,
      kind: "gather",
      item: spec.item,
      amount: spec.amount,
      delivered: 0,
      origin: { ...spec.origin },
      chest: copyChest(spec.chest),
      issuer: ref(issuer),
      createdAt: now,
    };
  }

  private takeLiveOffer(player: PlayerId, now: Tick): Offer | undefined {
    const offer = this.s.offers.get(player);
    this.s.offers.delete(player);
    return offer && this.isLive(offer, now) ? offer : undefined;
  }

  private isLive(offer: Offer, now: Tick): boolean {
    return now - offer.createdAt < this.config.offerTtlTicks;
  }

  private offerSecs(): number {
    return Math.ceil(this.config.offerTtlTicks / 20);
  }

  private botList(): BotRecord[] {
    return [...this.s.bots.values()];
  }

  private findBot(name: string): BotRecord | undefined {
    const key = name.replace(/^@/, "").toLowerCase();
    return this.botList().find((b) => b.name.toLowerCase() === key);
  }

  private nameInUse(name: string): boolean {
    const key = name.toLowerCase();
    return (
      this.botList().some((b) => b.name.toLowerCase() === key) ||
      this.s.pendingSpawns.some((p) => p.name.toLowerCase() === key)
    );
  }

  private defaultName(): string {
    for (let i = 1; ; i++) {
      const name = `${this.config.defaultBotNamePrefix}${i}`;
      if (!this.nameInUse(name)) return name;
    }
  }

  private reply(to: PlayerId | "all", text: string): void {
    this.out.push({ kind: "reply", to, text });
  }

  private botSay(bot: BotRecord, to: PlayerId | "all", text: string): void {
    this.out.push({ kind: "reply", to, from: bot.id, text });
  }
}

// ---------------------------------------------------------------- pure helpers

function resolveTarget(c: Extract<Command, { kind: "goto" }>, origin: Vec3): Vec3 {
  const r = (coord: { value: number; relative: boolean }, base: number): number =>
    coord.relative ? base + coord.value : coord.value;
  return { x: r(c.target.x, origin.x), y: r(c.target.y, origin.y), z: r(c.target.z, origin.z) };
}

function statusLine(b: BotRecord): string {
  return b.task ? msg.statusBusy(b.name, taskActivity(b.task, b.progress), b.task.issuer.name) : msg.statusIdle(b.name);
}

/** `amount` over `n` bots; the first `amount % n` get one more (32/3 -> 11, 11, 10). */
export function splitAmount(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  const extra = amount % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The task with `delivered` folded in from its latest progress (gather); goto unchanged. */
function withDelivered(t: Task, progress: TaskProgress | undefined): Task {
  if (t.kind !== "gather") return t;
  return { ...t, delivered: progress?.delivered ?? t.delivered };
}

/** What goes back on the queue when a running task is preempted / its bot leaves; undefined = already complete. */
function requeueable(t: Task, progress: TaskProgress | undefined): Task | undefined {
  const again = withDelivered(t, progress);
  return again.kind === "gather" && again.delivered >= again.amount ? undefined : again;
}

function reportText(t: Task, progress: TaskProgress | undefined, e: ReportEvent): string {
  if (t.kind === "goto") return e.outcome === "done" ? msg.arrived(t.target) : msg.failed(t.target, e.reason);
  const label = RESOURCES[t.item].label;
  if (e.outcome === "done") return msg.delivered(Math.max(t.amount, progress?.delivered ?? 0), label);
  return msg.gatherFailed(label, progress?.delivered ?? t.delivered, t.amount, e.reason);
}

function chestLine(chest: ChestRef, items: readonly { typeId: string; amount: number }[] | undefined): string {
  if (items === undefined) return msg.chestUnreadable(chest.pos);
  if (items.length === 0) return msg.chestEmpty(chest.pos);
  return msg.chestItems(chest.pos, items);
}

function copyChest(c: ChestRef): ChestRef {
  return { dimensionId: c.dimensionId, pos: { ...c.pos } };
}

function ref(p: PlayerRef): PlayerRef {
  return { id: p.id, name: p.name };
}

function copyTask(t: Task): Task {
  switch (t.kind) {
    case "goto":
      return { ...t, target: { ...t.target }, issuer: { ...t.issuer } };
    case "gather":
      return { ...t, origin: { ...t.origin }, chest: { ...t.chest, pos: { ...t.chest.pos } }, issuer: { ...t.issuer } };
  }
}
