// Phase 2 engine boundary for world reads (Job 3). Imports @minecraft/server only (never server-gametest).
// Implements WorldPort (src/game/bots/ports.ts) over a Dimension, plus the chest lookups behind the
// locateChest / inspectChest effects. Every engine call is wrapped in try/catch and logged with "[colony]"
// (first failure per method, then every LOG_EVERY-th).
//
// APIs (verified in node_modules/@minecraft/server/index.d.ts, see docs/PHASE2-SPEC.md §API):
//   world.getDimension(id), Dimension.getBlock(v) (throws in unloaded chunks / out of bounds),
//   Block.typeId/isAir/isSolid/isLiquid/location, BlockTypes.get(id) (undefined for unknown ids),
//   Dimension.getBlocks(new BlockVolume(from, to), { includeTypes }, true) -> ListBlockVolume.getBlockLocationIterator(),
//   Dimension.getEntities({ type: "minecraft:item", location, maxDistance }), Entity.getComponent("item").itemStack,
//   Block.getComponent("inventory").container (optional; getter can throw), Container.size/getItem(i),
//   ItemStack.typeId/amount/maxAmount, ItemStack.getComponent("durability").damage/maxDurability,
//   Player.getBlockFromViewDirection({ maxDistance }) -> BlockRaycastHit.block.
import { BlockTypes, BlockVolume, world, type Container, type Dimension, type ItemStack, type Player } from "@minecraft/server";
import { CONTAINER_BLOCK_TYPES } from "../../core/items.js";
import type { ChestLocateFailure, ChestRef, ItemCount, Vec3 } from "../../core/types.js";
import type { BlockInfo, Box, InventorySnapshot, ItemEntityView, ItemStackView, WorldPort } from "../bots/ports.js";
import { logError } from "../log.js";

export const OVERWORLD = "minecraft:overworld";
/** `!chest set`: max ray distance for the looked-at block, and the fallback search radius around the sender. */
export const CHEST_LOOK_DISTANCE = 6;
export const CHEST_NEAR_RADIUS = 4;

export type ChestLocateResult = { ok: true; chest: ChestRef } | { ok: false; reason: ChestLocateFailure };

// ---------------------------------------------------------------- shared helpers (also used by index.ts)

/** Log the 1st failure of a repeating call, then every Nth, so a stuck bot can't flood the content log. */
export const LOG_EVERY = 25;

/** Per-key rate-limited error logger. `log(key, msg, err)` logs failure #1, #26, #51, ... of each key. */
export function rateLimitedLogger(prefix: string): (key: string, err: unknown) => void {
  const counts = new Map<string, number>();
  return (key, err) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if ((n - 1) % LOG_EVERY === 0) logError(`${prefix}${key} failed (x${n})`, err);
  };
}

export function blockPos(v: Vec3): Vec3 {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

/** Plain-data view of an engine ItemStack (durability only for items that have the component). */
export function stackView(s: ItemStack): ItemStackView {
  const view: ItemStackView = { typeId: s.typeId, amount: s.amount, maxAmount: s.maxAmount };
  try {
    const d = s.getComponent("durability");
    if (d) view.durability = { damage: d.damage, max: d.maxDurability };
  } catch {
    // no durability info; the stack itself is still valid
  }
  return view;
}

/** Slot snapshot of a container. Throws if the container is invalid (callers catch). */
export function snapshotContainer(c: Container): InventorySnapshot {
  const out: Array<ItemStackView | undefined> = [];
  const size = c.size;
  for (let i = 0; i < size; i++) {
    const s = c.getItem(i);
    out.push(s ? stackView(s) : undefined);
  }
  return out;
}

/** The inventory container of the block at `pos` in `dim`, or undefined (unloaded / no inventory). Throws are caught. */
export function blockContainer(dim: Dimension, pos: Vec3): { typeId: string; container: Container } | undefined {
  const block = dim.getBlock(blockPos(pos));
  if (!block) return undefined;
  const container = block.getComponent("inventory")?.container;
  if (!container) return undefined;
  return { typeId: block.typeId, container };
}

const knownTypes = new Map<string, boolean>();

/** `ids` filtered to block types this world knows (BlockTypes.get), cached. getBlocks may throw on unknown ids. */
export function knownBlockTypes(ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const cached = knownTypes.get(id);
    if (cached !== undefined) return cached;
    try {
      const ok = BlockTypes.get(id) !== undefined;
      knownTypes.set(id, ok);
      return ok;
    } catch (err) {
      logError(`BlockTypes.get('${id}') failed`, err);
      return false; // not cached: retry next time
    }
  });
}

/** Test hook: forget the BlockTypes cache. */
export function resetBlockTypeCache(): void {
  knownTypes.clear();
}

function findIn(dim: Dimension, box: Box, typeIds: readonly string[]): Vec3[] {
  const types = knownBlockTypes(typeIds);
  if (types.length === 0) return [];
  const volume = new BlockVolume(blockPos(box.min), blockPos(box.max));
  const out: Vec3[] = [];
  for (const l of dim.getBlocks(volume, { includeTypes: types }, true).getBlockLocationIterator()) {
    out.push({ x: l.x, y: l.y, z: l.z });
  }
  return out;
}

// ---------------------------------------------------------------- WorldPort

const worldLog = rateLimitedLogger("world.");

/** WorldPort over world.getDimension(dimensionId). undefined if the dimension can't be resolved. */
export function createWorldPort(dimensionId: string): WorldPort | undefined {
  let dim: Dimension;
  try {
    dim = world.getDimension(dimensionId);
    if (!dim) return undefined;
  } catch (err) {
    worldLog(`getDimension('${dimensionId}')`, err);
    return undefined;
  }
  return {
    dimensionId,
    blockAt(pos): BlockInfo | undefined {
      try {
        const b = dim.getBlock(blockPos(pos));
        if (!b) return undefined;
        return { typeId: b.typeId, isAir: b.isAir, isSolid: b.isSolid, isLiquid: b.isLiquid };
      } catch (err) {
        worldLog("blockAt", err);
        return undefined;
      }
    },
    findBlocks(box, typeIds) {
      try {
        return findIn(dim, box, typeIds);
      } catch (err) {
        worldLog("findBlocks", err);
        return undefined;
      }
    },
    itemsNear(center, radius, typeIds) {
      try {
        const out: ItemEntityView[] = [];
        for (const e of dim.getEntities({ type: "minecraft:item", location: center, maxDistance: radius })) {
          try {
            const s = e.getComponent("item")?.itemStack;
            if (!s) continue;
            if (typeIds && !typeIds.includes(s.typeId)) continue;
            const l = e.location;
            out.push({ id: e.id, typeId: s.typeId, amount: s.amount, pos: { x: l.x, y: l.y, z: l.z } });
          } catch {
            // entity despawned / picked up between query and read: skip it
          }
        }
        return out;
      } catch (err) {
        worldLog("itemsNear", err);
        return [];
      }
    },
    containerAt(pos) {
      try {
        const c = blockContainer(dim, pos);
        return c ? snapshotContainer(c.container) : undefined;
      } catch (err) {
        worldLog("containerAt", err);
        return undefined;
      }
    },
  };
}

// ---------------------------------------------------------------- chest effects

function distSq(a: Vec3, blockCorner: Vec3): number {
  const dx = blockCorner.x + 0.5 - a.x;
  const dy = blockCorner.y + 0.5 - a.y;
  const dz = blockCorner.z + 0.5 - a.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * `!chest set`. With an online `player`: the container block (CONTAINER_BLOCK_TYPES) hit by
 * getBlockFromViewDirection({ maxDistance: CHEST_LOOK_DISTANCE }); otherwise / if that isn't a container,
 * the container block nearest to `near` within CHEST_NEAR_RADIUS (in the player's dimension, or
 * `fallbackDimensionId` when there is no player — GameTest senders). Returned pos = integer block coords.
 * Failures: none_found; no_player (no player and the fallback dimension can't be resolved); error (threw).
 */
export function locateChest(player: Player | undefined, near: Vec3, fallbackDimensionId: string = OVERWORLD): ChestLocateResult {
  let dim: Dimension;
  try {
    dim = player ? player.dimension : world.getDimension(fallbackDimensionId);
  } catch (err) {
    logError(`locateChest: dimension unavailable`, err);
    return { ok: false, reason: player ? "error" : "no_player" };
  }
  try {
    const dimensionId = dim.id;
    if (player) {
      try {
        const block = player.getBlockFromViewDirection({ maxDistance: CHEST_LOOK_DISTANCE })?.block;
        if (block && CONTAINER_BLOCK_TYPES.includes(block.typeId)) {
          return { ok: true, chest: { dimensionId, pos: blockPos(block.location) } };
        }
      } catch (err) {
        logError(`locateChest: getBlockFromViewDirection failed (falling back to nearby search)`, err);
      }
    }
    const c = blockPos(near);
    const r = CHEST_NEAR_RADIUS;
    const found = findIn(dim, { min: { x: c.x - r, y: c.y - r, z: c.z - r }, max: { x: c.x + r, y: c.y + r, z: c.z + r } }, CONTAINER_BLOCK_TYPES);
    let best: Vec3 | undefined;
    let bestD = Infinity;
    for (const p of found) {
      const d = distSq(near, p);
      // ties: lowest x, then y, then z (deterministic)
      if (d < bestD || (d === bestD && best && (p.x - best.x || p.y - best.y || p.z - best.z) < 0)) {
        best = p;
        bestD = d;
      }
    }
    return best ? { ok: true, chest: { dimensionId, pos: best } } : { ok: false, reason: "none_found" };
  } catch (err) {
    logError(`locateChest failed`, err);
    return { ok: false, reason: "error" };
  }
}

/**
 * `!chest`: aggregated contents (one entry per typeId, amount desc, then typeId asc). [] = empty.
 * undefined = no container there, unloaded, or threw. Any distance (player-facing info only).
 */
export function readChest(chest: ChestRef): ItemCount[] | undefined {
  try {
    const c = blockContainer(world.getDimension(chest.dimensionId), chest.pos);
    if (!c) return undefined;
    const totals = new Map<string, number>();
    for (const s of snapshotContainer(c.container)) {
      if (s) totals.set(s.typeId, (totals.get(s.typeId) ?? 0) + s.amount);
    }
    return [...totals]
      .map(([typeId, amount]) => ({ typeId, amount }))
      .sort((a, b) => b.amount - a.amount || (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0));
  } catch (err) {
    logError(`readChest failed`, err);
    return undefined;
  }
}
