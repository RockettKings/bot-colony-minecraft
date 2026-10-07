// Phase 2 engine boundary for world reads (Job 3). Imports @minecraft/server only (never server-gametest).
// Implements WorldPort (src/game/bots/ports.ts) over a Dimension, plus the chest lookups behind the
// locateChest / inspectChest effects. Every engine call is wrapped in try/catch and logged with "[colony]".
//
// APIs (verified in node_modules/@minecraft/server/index.d.ts, see docs/PHASE2-SPEC.md §API):
//   world.getDimension(id), Dimension.getBlock(v) (throws in unloaded chunks), Block.typeId/isAir/isSolid/isLiquid,
//   Dimension.getBlocks(new BlockVolume(from, to), { includeTypes }, true) -> ListBlockVolume.getBlockLocationIterator(),
//   Dimension.getEntities({ type: "minecraft:item", location, maxDistance }), Entity.getComponent("item").itemStack,
//   Block.getComponent("inventory").container, Player.getBlockFromViewDirection({ maxDistance }).
import type { Player } from "@minecraft/server";
import type { ChestLocateFailure, ChestRef, ItemCount, Vec3 } from "../../core/types.js";
import type { WorldPort } from "../bots/ports.js";

export const OVERWORLD = "minecraft:overworld";
/** `!chest set`: max ray distance for the looked-at block, and the fallback search radius around the sender. */
export const CHEST_LOOK_DISTANCE = 6;
export const CHEST_NEAR_RADIUS = 4;

export type ChestLocateResult = { ok: true; chest: ChestRef } | { ok: false; reason: ChestLocateFailure };

/** WorldPort over world.getDimension(dimensionId). undefined if the dimension can't be resolved. */
export function createWorldPort(dimensionId: string): WorldPort | undefined {
  void dimensionId;
  throw new Error("TODO(phase-2): createWorldPort");
}

/**
 * `!chest set`. With an online `player`: the container block (CONTAINER_BLOCK_TYPES) hit by
 * getBlockFromViewDirection({ maxDistance: CHEST_LOOK_DISTANCE }); otherwise / if that isn't a container,
 * the container block nearest to `near` within CHEST_NEAR_RADIUS (in the player's dimension, or
 * `fallbackDimensionId` when there is no player — GameTest senders). Returned pos = integer block coords.
 */
export function locateChest(player: Player | undefined, near: Vec3, fallbackDimensionId: string = OVERWORLD): ChestLocateResult {
  void player;
  void near;
  void fallbackDimensionId;
  throw new Error("TODO(phase-2): locateChest");
}

/**
 * `!chest`: aggregated contents (one entry per typeId, amount desc, then typeId asc). [] = empty.
 * undefined = no container there, unloaded, or threw. Any distance (player-facing info only).
 */
export function readChest(chest: ChestRef): ItemCount[] | undefined {
  void chest;
  throw new Error("TODO(phase-2): readChest");
}
