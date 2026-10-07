// The ONLY module in src/game that imports @minecraft/server-gametest (enforced by test/boundaries.test.ts).
//
// Experimental surface used (all from @minecraft/server-gametest 1.0.0-beta):
//   spawnSimulatedPlayer(DimensionLocation, name, GameMode)  top-level, not bound to a Test
//   SimulatedPlayer.navigateToLocation(Vector3, speed?) -> NavigationResult { isFullPath, getPath() }
//   SimulatedPlayer.stopMoving() / respawn(): boolean / disconnect()
//   Entity.isValid / isOnGround / location are PROPERTIES in @minecraft/server 2.x (isValid is not a method).
// Every call is wrapped in try/catch and logged with "[colony]". Nothing else in src/game sees these types,
// except the SimulatedPlayer type re-export needed by ColonyRuntime.adoptBot's signature.
import { GameMode, type DimensionLocation } from "@minecraft/server";
import { spawnSimulatedPlayer, type SimulatedPlayer } from "@minecraft/server-gametest";
import type { Vec3 } from "../../core/index.js";
import type { NavInfo } from "../bots/executor-logic.js";
import { errText, logError } from "../log.js";

export type { SimulatedPlayer } from "@minecraft/server-gametest";

export type { NavInfo } from "../bots/executor-logic.js";

/** A bot's in-world body. All methods are exception-safe. */
export interface BotBody {
  /** Entity id (stable, readable even when invalid). Used as BotId. */
  readonly id: string;
  readonly name: string;
  isValid(): boolean;
  /** Current feet position, or undefined if it can't be read. */
  location(): Vec3 | undefined;
  isOnGround(): boolean;
  /** Start pathfinding to an absolute location. undefined = the call threw (e.g. not on ground). */
  navigateTo(target: Vec3): NavInfo | undefined;
  stop(): void;
  /** true on success. */
  respawn(): boolean;
  disconnect(): void;
}

export type SpawnResult = { ok: true; body: BotBody } | { ok: false; reason: string };

export function spawnBot(where: DimensionLocation, name: string): SpawnResult {
  try {
    const p = spawnSimulatedPlayer(where, name, GameMode.Survival);
    return { ok: true, body: wrapSimulatedPlayer(p, name) };
  } catch (err) {
    logError(`spawnSimulatedPlayer('${name}') failed`, err);
    return { ok: false, reason: errText(err) };
  }
}

/** Log the 1st failure of a repeating call, then every Nth, so a stuck bot can't flood the content log. */
const LOG_EVERY = 25;

export function wrapSimulatedPlayer(p: SimulatedPlayer, name: string): BotBody {
  const id = p.id; // Entity.id is readable even when the entity is invalid
  let navFailures = 0;
  return {
    id,
    name,
    isValid: () => {
      try {
        return p.isValid;
      } catch {
        return false;
      }
    },
    location: () => {
      try {
        const l = p.location;
        return { x: l.x, y: l.y, z: l.z };
      } catch {
        return undefined;
      }
    },
    isOnGround: () => {
      try {
        return p.isOnGround;
      } catch {
        return false;
      }
    },
    navigateTo: (target) => {
      try {
        if (!p.isValid) return undefined; // invalid entity: the runtime removes the bot; don't log-spam
        const r = p.navigateToLocation({ x: target.x, y: target.y, z: target.z });
        navFailures = 0;
        return { pathLength: r.getPath().length, isFullPath: r.isFullPath };
      } catch (err) {
        if (navFailures++ % LOG_EVERY === 0) logError(`${name}.navigateToLocation failed (x${navFailures})`, err);
        return undefined;
      }
    },
    stop: () => {
      try {
        if (!p.isValid) return; // nothing to stop (e.g. cancel after the bot left)
        p.stopMoving();
      } catch (err) {
        logError(`${name}.stopMoving failed`, err);
      }
    },
    respawn: () => {
      try {
        return p.respawn();
      } catch (err) {
        logError(`${name}.respawn failed`, err);
        return false;
      }
    },
    disconnect: () => {
      try {
        if (!p.isValid) return;
        p.disconnect();
      } catch (err) {
        logError(`${name}.disconnect failed`, err);
      }
    },
  };
}
