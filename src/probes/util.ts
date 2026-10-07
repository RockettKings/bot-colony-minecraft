// Shared helpers for spike probes. Probes test raw engine mechanisms, so nothing here depends on src/game.
import { GameMode, Player, system, world } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import { SimulatedPlayer, spawnSimulatedPlayer } from "@minecraft/server-gametest";

// lib is ES2022 only; the script engine provides console (content log). Module-scoped, does not leak.
declare const console: { warn(...args: unknown[]): void; info(...args: unknown[]): void };

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

const VERDICT_COLOR: Record<Verdict, string> = { PASS: "§a", FAIL: "§c", INCONCLUSIVE: "§6" };

/** Log to the content log and (optionally) to chat. Never throws. */
export function log(text: string, chat = true): void {
  try {
    console.warn(`[probe] ${text}`);
  } catch {
    /* ignore */
  }
  if (chat) {
    try {
      world.sendMessage(`§e[probe]§r ${text}`);
    } catch {
      /* ignore (e.g. called in restricted mode or no players) */
    }
  }
}

/** Content-log only, low priority (per-sample traces). */
export function trace(text: string): void {
  try {
    console.info(`[probe] ${text}`);
  } catch {
    /* ignore */
  }
}

export class ProbeReport {
  private readonly facts: string[] = [];
  private ended = false;

  constructor(readonly name: string) {
    log(`${name}: started`);
  }

  note(text: string, chat = true): void {
    log(`${this.name}: ${text}`, chat);
  }

  fact(key: string, value: unknown): void {
    this.facts.push(`${key}=${fmt(value)}`);
  }

  end(verdict: Verdict, summary: string): void {
    if (this.ended) return;
    this.ended = true;
    if (this.facts.length > 0) log(`${this.name}: facts: ${this.facts.join("  ")}`);
    try {
      console.warn(`[probe] ${this.name}: RESULT ${verdict} - ${summary}`);
    } catch {
      /* ignore */
    }
    try {
      world.sendMessage(`§e[probe]§r ${this.name}: ${VERDICT_COLOR[verdict]}RESULT ${verdict}§r - ${summary}`);
    } catch {
      /* ignore */
    }
  }
}

export function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v && typeof v === "object" && "x" in v && "y" in v && "z" in v) return fmtVec(v as Vector3);
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  return String(v);
}

export function fmtVec(v: Vector3): string {
  return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

export function dist(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function hdist(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function copy(v: Vector3): Vector3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function sleep(ticks: number): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => resolve(), Math.max(1, Math.floor(ticks)));
  });
}

/** Poll `cond` every `step` ticks for up to `maxTicks`. Exceptions in cond count as false. */
export async function waitUntil(cond: () => boolean, maxTicks: number, step = 2): Promise<boolean> {
  for (let t = 0; t <= maxTicks; t += step) {
    try {
      if (cond()) return true;
    } catch {
      /* treat as not yet */
    }
    await sleep(step);
  }
  return false;
}

/** Top-level spawn (no GameTest), survival, next to the player. Throws on failure — caller reports it. */
export function spawnBotNear(player: Player, name: string, dx: number, dz: number): SimulatedPlayer {
  const l = player.location;
  return spawnSimulatedPlayer(
    { dimension: player.dimension, x: Math.floor(l.x) + dx + 0.5, y: l.y, z: Math.floor(l.z) + dz + 0.5 },
    name,
    GameMode.Survival,
  );
}

/**
 * Disconnect a probe bot. If the handle went invalid (e.g. its chunk unloaded) but a player with the same
 * name is still listed, disconnect that one instead so probes never leave bots behind.
 */
export function safeDisconnect(bot: SimulatedPlayer | undefined, name?: string): boolean {
  try {
    if (bot?.isValid) {
      bot.disconnect();
      return true;
    }
  } catch (e) {
    log(`disconnect failed: ${errMsg(e)}`, false);
  }
  if (name === undefined) return false;
  try {
    const p = world.getAllPlayers().find((x) => x.name === name);
    if (p && isSimulated(p)) {
      (p as SimulatedPlayer).disconnect();
      return true;
    }
  } catch (e) {
    log(`disconnect by name '${name}' failed: ${errMsg(e)}`, false);
  }
  return false;
}

/**
 * True if `p` is a simulated player. world.getAllPlayers() may hand back plain Player wrappers, so
 * besides instanceof we duck-type on methods that only SimulatedPlayer declares in the d.ts.
 */
export function isSimulated(p: Player): boolean {
  try {
    if (p instanceof SimulatedPlayer) return true;
    const sp = p as Partial<SimulatedPlayer>;
    return typeof sp.disconnect === "function" && typeof sp.navigateToLocation === "function";
  } catch {
    return false;
  }
}

export function inPlayerList(id: string): boolean {
  try {
    return world.getAllPlayers().some((p) => p.id === id);
  } catch {
    return false;
  }
}

export async function waitOnGround(bot: SimulatedPlayer, maxTicks: number): Promise<boolean> {
  return waitUntil(() => bot.isValid && bot.isOnGround, maxTicks, 2);
}
