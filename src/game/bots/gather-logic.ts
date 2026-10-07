// Pure decision logic for gathering (Job 4). NO @minecraft imports: unit-tested in test/gather-logic.test.ts.
// Geometry, time-sliced scan planning, candidate ranking, stand cells, break timing, inventory math, tools.
// Semantics are specified in docs/PHASE2-SPEC.md §"Gather logic"; the executor (Job 5) relies on them exactly.
import type { ItemCount, Tick, Vec3 } from "../../core/types.js";
import type { ResourceDef, ToolInfo, ToolKind } from "../../core/items.js";
import { BLOCK_HARDNESS, DEFAULT_HARDNESS, TOOL_SPEED, toolInfo } from "../../core/items.js";
import type { GatherConfig } from "./executor.js";
import type { BlockInfo, Box, Face, InventorySnapshot } from "./ports.js";
import { HOTBAR_SIZE } from "./ports.js";

/** Feet -> eyes. */
export const EYE_HEIGHT = 1.62;
/** World build limits (overworld). Scan boxes are clamped to these. */
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 319;

export type BlockProbe = (pos: Vec3) => BlockInfo | undefined;

const add = (v: Vec3, dx: number, dy: number, dz: number): Vec3 => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz });

// ---------------------------------------------------------------- geometry

/** Integer block position containing `v` (Math.floor per axis). */
export function blockOf(v: Vec3): Vec3 {
  return { x: Math.floor(v.x), y: Math.floor(v.y), z: Math.floor(v.z) };
}

/** Center of the block at integer position `b`: b + 0.5 on every axis. */
export function blockCenter(b: Vec3): Vec3 {
  return { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
}

/** "x,y,z" of the integer block position (stable key for sets/maps). */
export function posKey(b: Vec3): string {
  return `${b.x},${b.y},${b.z}`;
}

/** Distance from the eyes of a bot standing at `feet` (feet + EYE_HEIGHT) to the center of `block`. */
export function eyeDistance(feet: Vec3, block: Vec3): number {
  const c = blockCenter(block);
  return Math.hypot(feet.x - c.x, feet.y + EYE_HEIGHT - c.y, feet.z - c.z);
}

/** Horizontal (x/z) distance from `feet` to the center of `block`. */
export function horizontalDistance(feet: Vec3, block: Vec3): number {
  return Math.hypot(feet.x - (block.x + 0.5), feet.z - (block.z + 0.5));
}

/** True when a bot at `feet` can break / use `block`: eyeDistance <= reach. */
export function inBreakReach(feet: Vec3, block: Vec3, reach: number): boolean {
  return eyeDistance(feet, block) <= reach;
}

/** Container transfer rule: horizontalDistance(feet, chest) <= reach and |feet.y - (chest.y + 0.5)| <= 2. */
export function inContainerReach(feet: Vec3, chest: Vec3, reach: number): boolean {
  return horizontalDistance(feet, chest) <= reach && Math.abs(feet.y - (chest.y + 0.5)) <= 2;
}

/**
 * The face of `block` to hit from `eye`: the axis with the largest |eye - blockCenter| component picks the
 * face (dy > 0 -> "Up", dy < 0 -> "Down", dx > 0 -> "East", dx < 0 -> "West", dz > 0 -> "South", dz < 0 -> "North").
 * Ties prefer y, then x, then z.
 */
export function faceToward(block: Vec3, eye: Vec3): Face {
  const c = blockCenter(block);
  const dx = eye.x - c.x;
  const dy = eye.y - c.y;
  const dz = eye.z - c.z;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ay >= ax && ay >= az) return dy >= 0 ? "Up" : "Down";
  if (ax >= az) return dx > 0 ? "East" : "West";
  return dz > 0 ? "South" : "North";
}

// ---------------------------------------------------------------- scanning

/**
 * Full scan box around `origin`'s block: x/z within ±cfg.scanRadius, y within ±cfg.scanHalfHeight,
 * y clamped to [WORLD_MIN_Y, WORLD_MAX_Y].
 */
export function scanBox(origin: Vec3, cfg: GatherConfig): Box {
  const b = blockOf(origin);
  const r = cfg.scanRadius;
  const h = cfg.scanHalfHeight;
  return {
    min: { x: b.x - r, y: Math.max(WORLD_MIN_Y, b.y - h), z: b.z - r },
    max: { x: b.x + r, y: Math.min(WORLD_MAX_Y, b.y + h), z: b.z + r },
  };
}

/**
 * scanBox split into slices of cfg.scanLayersPerPump y-layers (same x/z extent), ordered nearest-first
 * around origin's y: the slice containing origin.y first, then alternating the next slice above, the next
 * below, ... until the box is covered. Slices are disjoint and their union is exactly scanBox.
 *
 * Alignment: the first slice starts at origin's block y (or the nearest in-box y if origin is outside the
 * world limits) and is shifted down by floor((layers - 1) / 2) so it is roughly centred; e.g. layers = 2
 * gives [oy, oy+1], then [oy+2, oy+3], [oy-2, oy-1], ... All slices are clipped to the box.
 */
export function scanSlices(origin: Vec3, cfg: GatherConfig): Box[] {
  const box = scanBox(origin, cfg);
  const minY = box.min.y;
  const maxY = box.max.y;
  if (minY > maxY) return [];
  const n = Math.max(1, Math.floor(cfg.scanLayersPerPump));
  const oy = Math.min(maxY, Math.max(minY, blockOf(origin).y));
  const firstLo = Math.max(minY, oy - Math.floor((n - 1) / 2));
  const firstHi = Math.min(maxY, firstLo + n - 1);
  const slice = (lo: number, hi: number): Box => ({
    min: { x: box.min.x, y: lo, z: box.min.z },
    max: { x: box.max.x, y: hi, z: box.max.z },
  });
  const out: Box[] = [slice(firstLo, firstHi)];
  let up = firstHi + 1; // next unscanned layer above
  let down = firstLo - 1; // next unscanned layer below
  while (up <= maxY || down >= minY) {
    if (up <= maxY) {
      const hi = Math.min(maxY, up + n - 1);
      out.push(slice(up, hi));
      up = hi + 1;
    }
    if (down >= minY) {
      const lo = Math.max(minY, down - n + 1);
      out.push(slice(lo, down));
      down = lo - 1;
    }
  }
  return out;
}

/** Loaded and walk-through: not solid and not liquid (air, flowers, tall grass...). undefined (unloaded) -> false. */
export function isPassable(b: BlockInfo | undefined): boolean {
  return b !== undefined && !b.isSolid && !b.isLiquid;
}

/** A bot can stand at `cell` (feet): cell and cell+1y passable, cell-1y solid. */
export function isStandable(probe: BlockProbe, cell: Vec3): boolean {
  return isPassable(probe(cell)) && isPassable(probe(add(cell, 0, 1, 0))) && probe(add(cell, 0, -1, 0))?.isSolid === true;
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** At least one of the 6 face neighbours of `block` is passable (a buried block can't be reached). */
export function isExposed(probe: BlockProbe, block: Vec3): boolean {
  return NEIGHBOURS.some(([dx, dy, dz]) => isPassable(probe(add(block, dx, dy, dz))));
}

/**
 * Cells from which a bot can break `block`: offsets dx, dz in -1..1 and dy in -3..+1 relative to the block
 * (dx = dz = 0 only for dy <= -2, i.e. block above the head), that are standable, within `reach`
 * (eyeDistance from the cell's bottom-center feet position (x+.5, y, z+.5)), and not standing ON the block
 * (cell - 1y != block). Sorted by eyeDistance asc, ties by posKey asc. Returned cells are integer block positions.
 */
export function standCells(probe: BlockProbe, block: Vec3, reach: number): Vec3[] {
  const out: { cell: Vec3; d: number; key: string }[] = [];
  for (let dy = -3; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0 && dy > -2) continue; // the block itself / standing on it / head inside it
        const cell = add(block, dx, dy, dz);
        const d = eyeDistance({ x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }, block);
        if (d > reach) continue;
        if (!isStandable(probe, cell)) continue;
        out.push({ cell, d, key: posKey(cell) });
      }
    }
  }
  out.sort((a, b) => a.d - b.d || cmpStr(a.key, b.key));
  return out.map((e) => e.cell);
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Candidate order for the next block to break: drop positions in `exclude` (posKey set) and those farther
 * than cfg.scanRadius horizontally from `origin` (box corners), then sort by
 * distance(botPos, blockCenter) + riskCost(pos) asc, ties by posKey asc.
 * riskCost defaults to () => 0. TODO(phase-6): risk weighting (distance from home, light level, mobs).
 *
 * "Horizontally from origin (box corners)" = per-axis: |pos.x - blockOf(origin).x| <= r and same for z, so the
 * whole square scan box (corners included) is kept. Duplicate positions are returned once.
 */
export function rankCandidates(
  found: readonly Vec3[],
  botPos: Vec3,
  origin: Vec3,
  cfg: GatherConfig,
  exclude: ReadonlySet<string>,
  riskCost: (pos: Vec3) => number = () => 0,
): Vec3[] {
  const o = blockOf(origin);
  const r = cfg.scanRadius;
  const seen = new Set<string>();
  const scored: { pos: Vec3; key: string; cost: number }[] = [];
  for (const pos of found) {
    const key = posKey(pos);
    if (exclude.has(key) || seen.has(key)) continue;
    if (Math.abs(pos.x - o.x) > r || Math.abs(pos.z - o.z) > r) continue;
    seen.add(key);
    const c = blockCenter(pos);
    const dist = Math.hypot(botPos.x - c.x, botPos.y - c.y, botPos.z - c.z);
    scored.push({ pos, key, cost: dist + riskCost(pos) });
  }
  scored.sort((a, b) => a.cost - b.cost || cmpStr(a.key, b.key));
  return scored.map((s) => s.pos);
}

// ---------------------------------------------------------------- breaking

/**
 * Expected survival break time in ticks for `blockTypeId` (BLOCK_HARDNESS, else DEFAULT_HARDNESS):
 *   matching = tool?.kind === res.tool;   speed = matching ? TOOL_SPEED[tool.tier] : 1
 *   harvestable = !res.requiresTool || matching
 *   ticks = ceil(hardness * (harvestable ? 1.5 : 5) / speed * 20)
 */
export function estimateBreakTicks(blockTypeId: string, res: ResourceDef, tool: ToolInfo | undefined): Tick {
  const hardness = BLOCK_HARDNESS[blockTypeId] ?? DEFAULT_HARDNESS;
  const matching = tool !== undefined && tool.kind === res.tool;
  const speed = matching ? TOOL_SPEED[tool.tier] : 1;
  const harvestable = !res.requiresTool || matching;
  // Small epsilon so float noise (0.6 * 1.5 = 0.8999…) doesn't add a tick.
  return Math.ceil((hardness * (harvestable ? 1.5 : 5) * 20) / speed - 1e-9);
}

/** Give up on a block after 2 x estimate + 40 ticks. */
export function breakTimeoutTicks(estimate: Tick): Tick {
  return 2 * estimate + 40;
}

// ---------------------------------------------------------------- inventory

/** Total amount of items whose typeId is in `typeIds`. */
export function countItems(inv: InventorySnapshot, typeIds: readonly string[]): number {
  let n = 0;
  for (const s of inv) if (s && typeIds.includes(s.typeId)) n += s.amount;
  return n;
}

/** Slot indices holding any of `typeIds`, ascending. */
export function slotsWith(inv: InventorySnapshot, typeIds: readonly string[]): number[] {
  const out: number[] = [];
  inv.forEach((s, i) => {
    if (s && typeIds.includes(s.typeId)) out.push(i);
  });
  return out;
}

/** Number of empty slots. */
export function freeSlots(inv: InventorySnapshot): number {
  let n = 0;
  for (let i = 0; i < inv.length; i++) if (inv[i] === undefined) n++;
  return n;
}

/** One entry per typeId, amount desc then typeId asc. */
export function aggregate(inv: InventorySnapshot): ItemCount[] {
  const m = new Map<string, number>();
  for (const s of inv) if (s) m.set(s.typeId, (m.get(s.typeId) ?? 0) + s.amount);
  return [...m.entries()]
    .map(([typeId, amount]) => ({ typeId, amount }))
    .sort((a, b) => b.amount - a.amount || cmpStr(a.typeId, b.typeId));
}

/**
 * Time to go to the chest: held >= remaining (held = countItems(inv, res.yields)), or
 * freeSlots(inv) <= cfg.reserveSlots and no yield stack has room (amount < maxAmount). remaining <= 0 -> true.
 */
export function shouldDeposit(inv: InventorySnapshot, res: ResourceDef, remaining: number, cfg: GatherConfig): boolean {
  if (remaining <= 0) return true;
  if (countItems(inv, res.yields) >= remaining) return true;
  if (freeSlots(inv) > cfg.reserveSlots) return false;
  return !inv.some((s) => s !== undefined && res.yields.includes(s.typeId) && s.amount < s.maxAmount);
}

// ---------------------------------------------------------------- tools

/**
 * Slot of the best tool of `kind` in any snapshot (bot inventory or chest): lowest ToolInfo.rank, then most
 * remaining durability (max - damage; missing durability counts as full), then lowest slot. undefined if none.
 */
export function bestToolSlot(inv: InventorySnapshot, kind: ToolKind): number | undefined {
  let best: { slot: number; rank: number; left: number } | undefined;
  inv.forEach((s, slot) => {
    if (!s) return;
    const t = toolInfo(s.typeId);
    if (!t || t.kind !== kind) return;
    const left = s.durability ? s.durability.max - s.durability.damage : Number.POSITIVE_INFINITY;
    if (!best || t.rank < best.rank || (t.rank === best.rank && left > best.left)) best = { slot, rank: t.rank, left };
  });
  return best?.slot;
}

/** How to hold the item in `slot`: select it directly if it's in the hotbar (0..8), else swap it into a hotbar slot. */
export interface HotbarPlan {
  /** Hotbar slot to select afterwards. */
  select: number;
  /** If set: swapSlots(swapFrom, select) first. */
  swapFrom?: number;
}

/**
 * slot < 9 -> { select: slot }. Otherwise swap into the first empty hotbar slot; if none, into `selected`
 * (or 0 when unknown).
 */
export function planHotbar(inv: InventorySnapshot, slot: number, selected: number | undefined): HotbarPlan {
  if (slot >= 0 && slot < HOTBAR_SIZE) return { select: slot };
  for (let i = 0; i < HOTBAR_SIZE; i++) if (inv[i] === undefined) return { select: i, swapFrom: slot };
  const sel = selected !== undefined && selected >= 0 && selected < HOTBAR_SIZE ? selected : 0;
  return { select: sel, swapFrom: slot };
}
