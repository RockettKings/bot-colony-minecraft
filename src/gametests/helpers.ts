// Helpers for colony GameTests. Tests drive the REAL runtime only through the spec interface
// (ColonyRuntime.submitText / adoptBot / botIds / snapshot).
//
// Observability: replies to the fake sender ids are dropped, so outcomes are read from
// ColonyRuntime.snapshot() (bot state, active task, queue) plus the bot's position in the world.
//   - "done reported"        <=> the bot is near the target AND the colony shows it idle.
//   - "failed (unreachable)" <=> the colony shows it idle while it is NOT near the target, before the
//     timeout deadline (200 + 20 x distance ticks, per spec), so the reason cannot have been "timeout".
import { GameMode, system } from "@minecraft/server";
import { spawnSimulatedPlayer } from "@minecraft/server-gametest";
import type { Vector3 } from "@minecraft/server";
import type { SimulatedPlayer, Test } from "@minecraft/server-gametest";
import type { BotId, BotView, Sender, Task, Vec3 } from "../core/types.js";
import { getRuntime, startColonyRuntime } from "../game/runtime.js";
import type { ColonyRuntime } from "../game/runtime.js";

export const ARRIVE = 1.5;
/** Spec: per-player command cooldown is 20 ticks; wait a bit longer between same-sender commands. */
export const COOLDOWN = 25;

export function runtime(): ColonyRuntime {
  return getRuntime() ?? startColonyRuntime();
}

let senderSeq = 0;

/** A fake command sender. Its id matches no player, so the colony's replies to it are dropped. */
export function makeSender(label: string, pos: Vector3): Sender {
  senderSeq++;
  return { id: `gametest:${label}:${system.currentTick}:${senderSeq}`, name: `GT-${label}`, pos: { x: pos.x, y: pos.y, z: pos.z } };
}

/** Absolute world position of the CENTER of a relative block cell (feet height = cell y). */
export function absCell(test: Test, rel: Vector3): Vector3 {
  return test.worldLocation({ x: rel.x + 0.5, y: rel.y, z: rel.z + 0.5 });
}

export function gotoText(abs: Vector3): string {
  return `!goto ${abs.x.toFixed(2)} ${abs.y.toFixed(2)} ${abs.z.toFixed(2)}`;
}

export function near(bot: SimulatedPlayer, abs: Vector3, radius = ARRIVE): boolean {
  try {
    if (!bot.isValid) return false;
    const l = bot.location;
    return Math.hypot(l.x - abs.x, l.z - abs.z) <= radius && Math.abs(l.y - abs.y) <= 1.5;
  } catch {
    return false;
  }
}

export function hdist(bot: SimulatedPlayer, abs: Vector3): number {
  try {
    const l = bot.location;
    return Math.hypot(l.x - abs.x, l.z - abs.z);
  } catch {
    return Number.NaN;
  }
}

export function fmt(v: Vector3): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}

/** Where the bot is, in both frames — the key diagnostic for the absolute-vs-relative coord question. */
export function where(test: Test, bot: SimulatedPlayer): string {
  try {
    const l = bot.location;
    return `abs ${fmt(l)} rel ${fmt(test.relativeLocation(l))}`;
  } catch {
    return "unknown (bot invalid)";
  }
}

/** Poll `cond` every tick. Returns the number of ticks waited, or -1 on timeout. */
export async function waitFor(test: Test, cond: () => boolean, maxTicks: number, onTick?: (t: number) => void): Promise<number> {
  for (let t = 0; t <= maxTicks; t++) {
    onTick?.(t);
    let ok = false;
    try {
      ok = cond();
    } catch {
      ok = false;
    }
    if (ok) return t;
    await test.idle(1);
  }
  return -1;
}

/** The colony's view of one bot (undefined if not registered). */
export function view(id: BotId): BotView | undefined {
  return runtime().snapshot().bots.find((b) => b.id === id);
}

export function isIdle(id: BotId): boolean {
  return view(id)?.state === "idle";
}

/** gotoText() rounds to 2 decimals, so compare with a matching tolerance. */
export function sameVec(a: Vec3, b: Vec3, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

export function taskStr(t: Task | undefined): string {
  return t ? `${t.id}->${fmt(t.target)} for ${t.issuer.name}` : "none";
}

export function snapStr(): string {
  const s = runtime().snapshot();
  const bots = s.bots.map((b) => `${b.name}:${b.state}(${taskStr(b.task)})`).join(", ");
  return `bots [${bots}] queued [${s.queued.map((t) => t.id).join(", ")}] offers ${s.pendingOffers}`;
}

/** Every fake sender used so far; flushed (!stop) before each test so stale queued tasks can't leak. */
const usedSenders: Sender[] = [];

export function sender(label: string, pos: Vector3): Sender {
  const s = makeSender(label, pos);
  usedSenders.push(s);
  return s;
}

/**
 * The runtime is a world-wide singleton, so each test must start with no bots and no queued tasks.
 * - Bots from a previous test are dropped by the runtime's pump (every 4 ticks) once their bodies are
 *   invalid; that requeues their tasks at the front of the queue.
 * - The requeued tasks belong to previous tests' senders: "!stop" from each drops them. This must happen
 *   BEFORE adoptBot, because registering a bot drains the queue onto it.
 * Returns false (after test.fail) if the world already has bots the tests didn't create.
 */
export async function beginTest(test: Test): Promise<boolean> {
  const rt = runtime();
  const waited = await waitFor(test, () => rt.botIds().length === 0, 60);
  if (waited < 0) {
    test.fail(
      `colony already has ${rt.botIds().length} bot(s) (${rt.botIds().join(", ")}). Run GameTests on a world without colony bots.`,
    );
    return false;
  }
  const stale = usedSenders.splice(0);
  if (stale.length > 0) {
    await test.idle(COOLDOWN); // so "!stop" isn't rejected by the per-sender cooldown
    for (const s of stale) rt.submitText(s, "!stop");
    await test.idle(2);
  }
  const queued = rt.snapshot().queued;
  if (queued.length > 0) {
    test.fail(`colony queue not empty at test start: ${queued.map(taskStr).join("; ")}`);
    return false;
  }
  return true;
}

/**
 * Relative y of the test floor. Whether relative y=0 is the structure's bottom layer or the (virtual)
 * structure block below it isn't specified in the d.ts, so find the stone layer instead of assuming.
 */
export function floorY(test: Test, x = 8, z = 8): number | undefined {
  for (const y of [0, 1, 2, 3, -1]) {
    try {
      if (test.getBlock({ x, y, z }).typeId === "minecraft:stone") return y;
    } catch {
      /* out of bounds */
    }
  }
  test.fail("could not find the stone floor of the test structure");
  return undefined;
}

/** False (after test.fail) if the bots didn't land; the caller must return. */
export async function waitGrounded(test: Test, bots: SimulatedPlayer[]): Promise<boolean> {
  const t = await waitFor(test, () => bots.every((b) => b.isValid && b.isOnGround), 60);
  if (t < 0) test.fail(`bots not on ground after 60 ticks: ${bots.map((b) => b.name).join(", ")}`);
  return t >= 0;
}

/**
 * How a test's bots are spawned:
 * - "test":     test.spawnSimulatedPlayer(rel) — the spec's primary path. OPEN QUESTION: are this bot's
 *               navigateToLocation coords test-relative? The runtime always passes ABSOLUTE coords, so if
 *               they are relative, the "test" variants fail and the failure message shows where the bot
 *               went (compare "abs-as-rel" in the message).
 * - "toplevel": top-level spawnSimulatedPlayer at test.worldLocation(rel) — exactly how the runtime spawns
 *               bots in normal play (absolute coords by construction; see the spawn probe). Registered as
 *               the "*_abs" variants so the runtime logic can be validated even if "test" mode can't.
 *               These bots are not owned by the test, so they are disconnected in runOnFinish.
 */
export type SpawnMode = "test" | "toplevel";

export function spawnBot(test: Test, mode: SpawnMode, rel: Vector3, name: string): SimulatedPlayer {
  if (mode === "test") return test.spawnSimulatedPlayer(rel, name, GameMode.Survival);
  const w = test.worldLocation({ x: rel.x + 0.5, y: rel.y, z: rel.z + 0.5 });
  const bot = spawnSimulatedPlayer({ dimension: test.getDimension(), x: w.x, y: w.y, z: w.z }, name, GameMode.Survival);
  test.runOnFinish(() => {
    try {
      if (bot.isValid) bot.disconnect();
    } catch {
      /* ignore */
    }
  });
  return bot;
}

/** Short unique-ish bot name (<= 16 chars). */
export function botName(prefix: string): string {
  return `${prefix}${system.currentTick % 10000}`;
}

export function removeBots(test: Test, bots: SimulatedPlayer[]): void {
  for (const b of bots) {
    try {
      test.removeSimulatedPlayer(b);
    } catch {
      /* already gone / test completed */
    }
  }
}
