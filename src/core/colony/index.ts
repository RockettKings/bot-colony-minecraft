// Deterministic colony core: task model, allocator, offers.
// Functional core: no clocks, randomness, I/O, or @minecraft imports. Time arrives on events.
import {
  DEFAULT_CONFIG,
  type BotId,
  type ColonyConfig,
  type ColonyEvent,
  type ColonySnapshot,
  type Command,
  type Effect,
  type GotoTask,
  type PlayerId,
  type PlayerRef,
  type Sender,
  type Task,
  type Tick,
  type Vec3,
} from "../types.js";
import { COORD_LIMITS } from "../commands/index.js";
import { planAllocation } from "./allocator.js";
import { msg } from "./messages.js";
import { createState, type BotRecord, type ColonyState, type GotoOffer, type Offer } from "./state.js";

export { fmtNum, fmtPos, msg } from "./messages.js";
export { planAllocation } from "./allocator.js";

type CommandEvent = Extract<ColonyEvent, { kind: "command" }>;
type ReportEvent = Extract<ColonyEvent, { kind: "taskReport" }>;

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
    }
    const effects = this.out;
    this.out = [];
    return effects;
  }

  snapshot(): ColonySnapshot {
    return {
      bots: this.botList().map((b) =>
        b.task
          ? { id: b.id, name: b.name, state: "busy" as const, task: copyTask(b.task) }
          : { id: b.id, name: b.name, state: "idle" as const },
      ),
      queued: this.s.queue.map(copyTask),
      pendingOffers: this.s.offers.size,
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
      case "chest":
        return; // TODO(phase-2, Job 2): cmdGather / cmdChest
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
    const bots = this.botList();
    // A rejected request has no side effects: the player's pending offer survives.
    if (bots.length === 0) return this.reply(sender.id, msg.noBots(this.config.prefix));
    if (n > bots.length) return this.reply(sender.id, msg.tooMany(n, bots.length));
    // A valid fresh request supersedes whatever this player had pending.
    this.s.offers.delete(sender.id);

    const plan = planAllocation(bots, n, sender.id);
    const allOwn = plan.take.every((b) => b.task?.issuer.id === sender.id);
    if (allOwn) {
      for (const b of plan.idle) this.assignNew(b, sender, now, target);
      for (const b of plan.take) {
        // Own task: replaced outright, not requeued.
        this.cancel(b, "preempted");
        this.assignNew(b, sender, now, target);
      }
      return;
    }

    this.s.offers.set(sender.id, { kind: "goto", owner: ref(sender), createdAt: now, target, count: n });
    const busy = bots.filter((b) => b.task).length;
    this.reply(sender.id, msg.offerCounts(n, bots.length - busy, busy));
    for (const b of plan.take) {
      const t = b.task as Task;
      this.reply(sender.id, msg.offerBusyBot(b.name, taskTarget(t), t.issuer.name));
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
    this.reply(sender.id, msg.offerBusyBot(bot.name, taskTarget(task), task.issuer.name));
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

    this.executeGotoOffer(sender, now, offer);
  }

  /** Re-plans against current state (bots may have freed up or left since the offer). */
  private executeGotoOffer(sender: Sender, now: Tick, offer: GotoOffer): void {
    const bots = this.botList();
    if (bots.length === 0) return this.reply(sender.id, msg.noBots(this.config.prefix));
    if (offer.count > bots.length) return this.reply(sender.id, msg.tooMany(offer.count, bots.length));

    const plan = planAllocation(bots, offer.count, sender.id);
    for (const b of plan.idle) this.assignNew(b, sender, now, offer.target);

    const requeue: Task[] = [];
    for (const b of plan.take) {
      const old = b.task as Task;
      this.cancel(b, "preempted");
      if (old.issuer.id !== sender.id) {
        requeue.push(old);
        this.reply(old.issuer.id, msg.reassigned(b.name, sender.name, taskTarget(old)));
      }
      this.assignNew(b, sender, now, offer.target);
    }
    // Preempted tasks go to the front, keeping their relative order.
    this.s.queue.unshift(...requeue);
  }

  private cmdQueue(sender: Sender, now: Tick): void {
    const offer = this.s.offers.get(sender.id);
    if (!offer || offer.kind !== "goto" || !this.isLive(offer, now)) {
      if (offer && !this.isLive(offer, now)) this.s.offers.delete(sender.id);
      return this.reply(sender.id, msg.nothingToQueue());
    }
    this.s.offers.delete(sender.id);

    let remaining = offer.count;
    for (const b of this.botList()) {
      if (remaining === 0) break;
      if (!b.task) {
        this.assignNew(b, sender, now, offer.target);
        remaining--;
      }
    }
    if (remaining === 0) return;
    const first = this.s.queue.length + 1;
    for (let i = 0; i < remaining; i++) this.s.queue.push(this.newTask(sender, now, offer.target));
    this.reply(sender.id, msg.queuedAt(remaining, first));
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
      this.s.queue.unshift(bot.task);
      this.reply(bot.task.issuer.id, msg.botLeftRequeued(bot.name, taskTarget(bot.task)));
    }
    this.reply("all", msg.left(bot.name, reason));
    this.drainQueue();
  }

  private onTaskReport(e: ReportEvent): void {
    const bot = this.s.bots.get(e.botId);
    const task = bot?.task;
    if (!bot || !task || task.id !== e.taskId) return; // stale or unknown: ignore

    bot.task = undefined;
    const text = e.outcome === "done" ? msg.arrived(taskTarget(task)) : msg.failed(taskTarget(task), e.reason);
    this.botSay(bot, task.issuer.id, text);
    this.drainQueue();
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
      this.botSay(b, task.issuer.id, msg.pickingUp(taskTarget(task)));
    }
  }

  private assignNew(bot: BotRecord, sender: Sender, now: Tick, target: Vec3): void {
    this.assign(bot, this.newTask(sender, now, target));
    this.botSay(bot, sender.id, msg.onMyWay(target));
  }

  /** The only place that emits `assign`. Enforces: bot must be idle (cancel first). */
  private assign(bot: BotRecord, task: Task): void {
    if (bot.task) throw new Error(`colony invariant: assign to busy bot ${bot.id}`);
    bot.task = task;
    this.out.push({ kind: "assign", botId: bot.id, task: copyTask(task) });
  }

  /** The only place that emits `cancel`. Leaves the bot idle. */
  private cancel(bot: BotRecord, reason: "stopped" | "preempted"): void {
    const task = bot.task;
    if (!task) return;
    bot.task = undefined;
    this.out.push({ kind: "cancel", botId: bot.id, taskId: task.id, reason });
  }

  private newTask(issuer: PlayerRef, now: Tick, target: Vec3): GotoTask {
    return { id: `t${this.s.nextTaskNum++}`, kind: "goto", target: { ...target }, issuer: ref(issuer), createdAt: now };
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
  return b.task ? msg.statusGoing(b.name, taskTarget(b.task), b.task.issuer.name) : msg.statusIdle(b.name);
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

/**
 * TODO(phase-2, Job 2): placeholder so Phase 1 compiles with the widened Task union. Replace every use with
 * per-kind task descriptions (PHASE2-SPEC §Colony: describeTask), then delete this.
 */
function taskTarget(t: Task): Vec3 {
  return t.kind === "goto" ? t.target : t.origin;
}
