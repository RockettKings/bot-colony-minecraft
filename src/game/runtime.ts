// Imperative shell: game happenings -> ColonyEvents, Effects -> game actions.
import { system, world, type Dimension, type Player } from "@minecraft/server";
import {
  createColony,
  handleChat,
  type BotId,
  type Colony,
  type ColonyEvent,
  type ColonySnapshot,
  type Effect,
  type Sender,
  type Tick,
  type Vec3,
} from "../core/index.js";
import { spawnBot, wrapSimulatedPlayer, type SimulatedPlayer, type WorkerBody } from "./adapter/index.js";
import { createWorldPort } from "./adapter/world.js";
import {
  DEFAULT_GATHER_CONFIG,
  createExecutor,
  type ExecutorContext,
  type StepResult,
  type TaskExecutor,
} from "./bots/executor.js";
import { EXECUTORS } from "./bots/registry.js";
import { installChatFrontend } from "./frontends/chat.js";
import { senderOf } from "./frontends/sender.js";
import { installSlashFrontend } from "./frontends/slash.js";
import { logError, logInfo, logWarn } from "./log.js";

export interface ColonyRuntime {
  /** Same path as chat; replies to unknown ids are dropped. */
  submitText(sender: Sender, text: string): void;
  /** Used by GameTests: register an already-spawned simulated player as a bot. */
  adoptBot(player: SimulatedPlayer, name: string): BotId;
  botIds(): BotId[];
  /** Read model of the colony core: bots (state + active task), queue, offer count. A copy. */
  snapshot(): ColonySnapshot;
}

const PUMP_INTERVAL_TICKS = 4;
const RESPAWN_DELAY_TICKS = 20;
const RESPAWN_RETRY_TICKS = 20;
const RESPAWN_MAX_ATTEMPTS = 5;

interface BotEntry {
  body: WorkerBody;
  name: string;
  executor?: TaskExecutor;
  /** Set while dead; respawn is attempted from the pump at/after this tick. */
  respawnAt?: Tick;
  respawnAttempts: number;
}

class Runtime implements ColonyRuntime {
  private readonly colony: Colony = createColony();
  private readonly bots = new Map<BotId, BotEntry>();
  /** Events raised while executing effects; handled after the current effect list, in order. */
  private readonly pending: ColonyEvent[] = [];
  private draining = false;

  start(): void {
    const prefix = this.colony.config.prefix;
    const submitFromPlayer = (player: Player, text: string): void => {
      let sender: Sender;
      try {
        sender = senderOf(player);
      } catch (err) {
        logError("could not read command sender", err);
        return;
      }
      this.submitText(sender, text);
    };
    // Each install is isolated: one failing front-end must not stop the pump from starting.
    guard("chat front-end install", () => installChatFrontend(prefix, submitFromPlayer));
    guard("slash front-end install", () => installSlashFrontend(prefix, submitFromPlayer));

    try {
      world.afterEvents.entityDie.subscribe(
        (ev) => {
          let id: string;
          try {
            id = ev.deadEntity.id;
          } catch (err) {
            logError("entityDie: could not read dead entity id", err);
            return;
          }
          this.onEntityDie(id);
        },
        { entityTypes: ["minecraft:player"] },
      );
    } catch (err) {
      logError("entityDie subscribe failed; bot deaths won't be reported", err);
    }

    system.runInterval(() => this.pump(), PUMP_INTERVAL_TICKS);
    logInfo("runtime started");
  }

  // ------------------------------------------------------------ public API

  submitText(sender: Sender, text: string): void {
    try {
      const out = handleChat(this.colony, text, sender, now());
      if (!out.handled) return;
      this.execute(out.effects);
      this.drain();
    } catch (err) {
      logError(`submitText failed for '${text}'`, err);
    }
  }

  adoptBot(player: SimulatedPlayer, name: string): BotId {
    const body = wrapSimulatedPlayer(player, name);
    if (!this.bots.has(body.id)) this.register(body);
    this.drain();
    return body.id;
  }

  botIds(): BotId[] {
    return [...this.bots.keys()];
  }

  snapshot(): ColonySnapshot {
    return this.colony.snapshot();
  }

  // ------------------------------------------------------------ event plumbing

  private emit(e: ColonyEvent): void {
    this.pending.push(e);
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let e = this.pending.shift(); e; e = this.pending.shift()) {
        // One bad event must not strand the rest of the queue (or kill the caller).
        let effects: Effect[];
        try {
          effects = this.colony.handle(e);
        } catch (err) {
          logError(`colony.handle(${e.kind}) failed`, err);
          continue;
        }
        this.execute(effects);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Strictly in order (cancel before assign). */
  private execute(effects: Effect[]): void {
    for (const fx of effects) {
      try {
        this.executeOne(fx);
      } catch (err) {
        logError(`effect ${fx.kind} failed`, err);
      }
    }
  }

  private executeOne(fx: Effect): void {
    switch (fx.kind) {
      case "reply":
        return this.reply(fx.to, fx.from, fx.text);
      case "assign": {
        const bot = this.bots.get(fx.botId);
        if (!bot) {
          logWarn(`assign to unknown bot ${fx.botId}`);
          this.emit({ kind: "botRemoved", now: now(), botId: fx.botId, reason: "missing" });
          return;
        }
        if (bot.executor) {
          logWarn(`${bot.name}: assign while busy with ${bot.executor.taskId}; replacing`);
          bot.executor.cancel();
        }
        bot.executor = createExecutor(EXECUTORS, fx.task, contextFor(bot.body));
        return;
      }
      case "cancel": {
        const bot = this.bots.get(fx.botId);
        if (bot?.executor && bot.executor.taskId === fx.taskId) {
          bot.executor.cancel();
          bot.executor = undefined; // no taskReport for cancelled tasks
        }
        return;
      }
      case "spawn":
        return this.spawn(fx.name, fx.near, fx.requestedBy);
      case "locateChest":
      case "inspectChest":
        // TODO(phase-2, Job 6): adapter/world.ts locateChest / readChest -> chestLocated(Failed) / chestInspected.
        logWarn(`effect ${fx.kind} not implemented yet`);
        return;
    }
  }

  // ------------------------------------------------------------ effects

  private reply(to: string, from: BotId | undefined, text: string): void {
    const line = from !== undefined ? `<${this.botName(from)}> ${text}` : `§7[Colony]§r ${text}`;
    if (to === "all") {
      world.sendMessage(line);
      return;
    }
    const player = findPlayer(to);
    if (player) player.sendMessage(line); // offline -> dropped
  }

  private botName(id: BotId): string {
    return this.bots.get(id)?.name ?? this.colony.snapshot().bots.find((b) => b.id === id)?.name ?? id;
  }

  private spawn(name: string, near: Vec3, requestedBy: string): void {
    const dimension = dimensionOf(requestedBy);
    const res = dimension
      ? spawnBot({ dimension, x: near.x, y: near.y, z: near.z }, name)
      : ({ ok: false, reason: "no dimension" } as const);
    if (!res.ok) {
      this.emit({ kind: "spawnFailed", now: now(), name, requestedBy, reason: res.reason });
      return;
    }
    this.register(res.body);
  }

  private register(body: WorkerBody): void {
    this.bots.set(body.id, { body, name: body.name, respawnAttempts: 0 });
    logInfo(`registered bot ${body.name} (${body.id})`);
    this.emit({ kind: "botRegistered", now: now(), botId: body.id, name: body.name });
  }

  // ------------------------------------------------------------ game happenings

  private onEntityDie(entityId: string): void {
    const bot = this.bots.get(entityId);
    if (!bot) return;
    const t = now();
    logInfo(`${bot.name} died`);
    const ex = bot.executor;
    bot.executor = undefined;
    bot.respawnAt = t + RESPAWN_DELAY_TICKS;
    bot.respawnAttempts = 0;
    if (ex) this.emit({ kind: "taskReport", now: t, botId: entityId, taskId: ex.taskId, outcome: "failed", reason: "bot_died" });
    this.drain();
  }

  /**
   * Every PUMP_INTERVAL_TICKS. Two passes so removals reach the core before reports (a report frees a
   * bot and drains the queue; the core must already know which bots are gone). Each bot is isolated:
   * one throwing executor fails only its own task. The whole body is guarded so the interval survives.
   */
  private pump(): void {
    try {
      const t = now();
      const live: Array<[BotId, BotEntry]> = [];
      for (const [id, bot] of [...this.bots]) {
        try {
          if (bot.respawnAt !== undefined) {
            this.tryRespawn(id, bot, t);
            continue; // dead: no validity check, no executor stepping
          }
          if (!bot.body.isValid()) {
            this.removeBot(id, bot, "gone");
            continue;
          }
          live.push([id, bot]);
        } catch (err) {
          logError(`pump: ${bot.name} lifecycle failed`, err);
        }
      }
      for (const [id, bot] of live) this.stepBot(id, bot, t);
      this.emit({ kind: "tick", now: t });
    } catch (err) {
      logError("pump failed", err);
    }
    try {
      this.drain();
    } catch (err) {
      logError("pump drain failed", err);
    }
  }

  private stepBot(id: BotId, bot: BotEntry, t: Tick): void {
    const ex = bot.executor;
    if (!ex) return;
    let r: StepResult;
    try {
      r = ex.step(t);
    } catch (err) {
      logError(`${bot.name}: executor for ${ex.taskId} threw; failing the task`, err);
      ex.cancel();
      r = { kind: "failed", reason: "error" };
    }
    if (r.kind === "running") return;
    bot.executor = undefined;
    this.emit(
      r.kind === "done"
        ? { kind: "taskReport", now: t, botId: id, taskId: ex.taskId, outcome: "done" }
        : { kind: "taskReport", now: t, botId: id, taskId: ex.taskId, outcome: "failed", reason: r.reason },
    );
  }

  private tryRespawn(id: BotId, bot: BotEntry, t: Tick): void {
    if (bot.respawnAt === undefined || t < bot.respawnAt) return;
    if (bot.body.respawn()) {
      logInfo(`${bot.name} respawned`);
      bot.respawnAt = undefined;
      bot.respawnAttempts = 0;
      return;
    }
    bot.respawnAttempts++;
    if (bot.respawnAttempts >= RESPAWN_MAX_ATTEMPTS) {
      logWarn(`${bot.name}: respawn failed ${bot.respawnAttempts}x; disconnecting`);
      bot.body.disconnect();
      this.removeBot(id, bot, "couldn't respawn");
      return;
    }
    bot.respawnAt = t + RESPAWN_RETRY_TICKS;
  }

  /** The core requeues the bot's task on botRemoved, so no taskReport here. */
  private removeBot(id: BotId, bot: BotEntry, reason: string): void {
    bot.executor = undefined;
    this.bots.delete(id);
    logInfo(`bot ${bot.name} removed (${reason})`);
    this.emit({ kind: "botRemoved", now: now(), botId: id, reason });
  }
}

// ------------------------------------------------------------ helpers

/** Executor context for a bot. The world port is resolved lazily (goto never needs it). */
function contextFor(body: WorkerBody): ExecutorContext {
  return {
    body,
    world: () => {
      const dim = body.dimensionId();
      return dim === undefined ? undefined : createWorldPort(dim);
    },
    gather: DEFAULT_GATHER_CONFIG,
  };
}

function guard(what: string, fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    logError(`${what} failed`, err);
  }
}

function now(): Tick {
  return system.currentTick;
}

function findPlayer(id: string): Player | undefined {
  try {
    return world.getAllPlayers().find((p) => p.id === id);
  } catch (err) {
    logError("getAllPlayers failed", err);
    return undefined;
  }
}

/** The requesting player's dimension, falling back to the overworld. */
function dimensionOf(playerId: string): Dimension | undefined {
  const player = findPlayer(playerId);
  if (player) {
    try {
      return player.dimension;
    } catch {
      // fall through
    }
  }
  try {
    return world.getDimension("overworld");
  } catch (err) {
    logError("getDimension(overworld) failed", err);
    return undefined;
  }
}

// ------------------------------------------------------------ singleton

let instance: Runtime | undefined;

/** Idempotent. Call at script load so the slash command registers before startup fires. */
export function startColonyRuntime(): ColonyRuntime {
  if (!instance) {
    instance = new Runtime();
    instance.start();
  }
  return instance;
}

export function getRuntime(): ColonyRuntime | undefined {
  return instance;
}
