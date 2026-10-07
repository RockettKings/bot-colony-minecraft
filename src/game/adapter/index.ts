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
import type { NavInfo } from "../bots/executor-logic.js";
import type { WorkerBody } from "../bots/ports.js";
import { errText, logError } from "../log.js";

export type { SimulatedPlayer } from "@minecraft/server-gametest";

export type { NavInfo } from "../bots/executor-logic.js";

// BotBody / WorkerBody are contracts in src/game/bots/ports.ts (engine-free, so executors are testable).
export type { BotBody, WorkerBody } from "../bots/ports.js";

export type SpawnResult = { ok: true; body: WorkerBody } | { ok: false; reason: string };

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

export function wrapSimulatedPlayer(p: SimulatedPlayer, name: string): WorkerBody {
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
    // ---------------------------------------------------------- Phase 2 (Job 3 implements; see PHASE2-SPEC)
    // Stubs return the documented failure values so nothing on a Phase 1 path can throw.
    dimensionId: () => undefined, // TODO(phase-2)
    lookAtBlock: () => false, // TODO(phase-2)
    startBreaking: () => false, // TODO(phase-2)
    stopBreaking: () => undefined, // TODO(phase-2)
    inventory: () => undefined, // TODO(phase-2)
    selectedSlot: () => undefined, // TODO(phase-2)
    selectSlot: () => false, // TODO(phase-2)
    swapSlots: () => false, // TODO(phase-2)
    depositSlot: () => ({ ok: false, reason: "error" }), // TODO(phase-2)
    withdrawSlot: () => ({ ok: false, reason: "error" }), // TODO(phase-2)
    applyCraft: () => false, // TODO(phase-2)
    placeFromSlot: () => false, // TODO(phase-2)
  };
}
