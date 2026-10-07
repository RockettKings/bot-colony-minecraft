// Pure decision logic for gathering (Job 4). NO @minecraft imports: unit-tested in test/gather-logic.test.ts.
// Geometry, time-sliced scan planning, candidate ranking, stand cells, break timing, inventory math, tools.
// Semantics are specified in docs/PHASE2-SPEC.md §"Gather logic"; the executor (Job 5) relies on them exactly.
import type { ItemCount, Tick, Vec3 } from "../../core/types.js";
import type { ResourceDef, ToolInfo, ToolKind } from "../../core/items.js";
import type { GatherConfig } from "./executor.js";
import type { BlockInfo, Box, Face, InventorySnapshot } from "./ports.js";

const TODO = (what: string): never => {
  throw new Error(`TODO(phase-2): ${what}`);
};

/** Feet -> eyes. */
export const EYE_HEIGHT = 1.62;
/** World build limits (overworld). Scan boxes are clamped to these. */
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 319;

export type BlockProbe = (pos: Vec3) => BlockInfo | undefined;

// ---------------------------------------------------------------- geometry

/** Integer block position containing `v` (Math.floor per axis). */
export function blockOf(v: Vec3): Vec3 {
  void v;
  return TODO("blockOf");
}

/** Center of the block at integer position `b`: b + 0.5 on every axis. */
export function blockCenter(b: Vec3): Vec3 {
  void b;
  return TODO("blockCenter");
}

/** "x,y,z" of the integer block position (stable key for sets/maps). */
export function posKey(b: Vec3): string {
  void b;
  return TODO("posKey");
}

/** Distance from the eyes of a bot standing at `feet` (feet + EYE_HEIGHT) to the center of `block`. */
export function eyeDistance(feet: Vec3, block: Vec3): number {
  void feet;
  void block;
  return TODO("eyeDistance");
}

/** Horizontal (x/z) distance from `feet` to the center of `block`. */
export function horizontalDistance(feet: Vec3, block: Vec3): number {
  void feet;
  void block;
  return TODO("horizontalDistance");
}

/** True when a bot at `feet` can break / use `block`: eyeDistance <= reach. */
export function inBreakReach(feet: Vec3, block: Vec3, reach: number): boolean {
  void feet;
  void block;
  void reach;
  return TODO("inBreakReach");
}

/** Container transfer rule: horizontalDistance(feet, chest) <= reach and |feet.y - (chest.y + 0.5)| <= 2. */
export function inContainerReach(feet: Vec3, chest: Vec3, reach: number): boolean {
  void feet;
  void chest;
  void reach;
  return TODO("inContainerReach");
}

/**
 * The face of `block` to hit from `eye`: the axis with the largest |eye - blockCenter| component picks the
 * face (dy > 0 -> "Up", dy < 0 -> "Down", dx > 0 -> "East", dx < 0 -> "West", dz > 0 -> "South", dz < 0 -> "North").
 * Ties prefer y, then x, then z.
 */
export function faceToward(block: Vec3, eye: Vec3): Face {
  void block;
  void eye;
  return TODO("faceToward");
}

// ---------------------------------------------------------------- scanning

/**
 * Full scan box around `origin`'s block: x/z within ±cfg.scanRadius, y within ±cfg.scanHalfHeight,
 * y clamped to [WORLD_MIN_Y, WORLD_MAX_Y].
 */
export function scanBox(origin: Vec3, cfg: GatherConfig): Box {
  void origin;
  void cfg;
  return TODO("scanBox");
}

/**
 * scanBox split into slices of cfg.scanLayersPerPump y-layers (same x/z extent), ordered nearest-first
 * around origin's y: the slice containing origin.y first, then alternating the next slice above, the next
 * below, ... until the box is covered. Slices are disjoint and their union is exactly scanBox.
 */
export function scanSlices(origin: Vec3, cfg: GatherConfig): Box[] {
  void origin;
  void cfg;
  return TODO("scanSlices");
}

/** Loaded and walk-through: not solid and not liquid (air, flowers, tall grass...). undefined (unloaded) -> false. */
export function isPassable(b: BlockInfo | undefined): boolean {
  void b;
  return TODO("isPassable");
}

/** A bot can stand at `cell` (feet): cell and cell+1y passable, cell-1y solid. */
export function isStandable(probe: BlockProbe, cell: Vec3): boolean {
  void probe;
  void cell;
  return TODO("isStandable");
}

/** At least one of the 6 face neighbours of `block` is passable (a buried block can't be reached). */
export function isExposed(probe: BlockProbe, block: Vec3): boolean {
  void probe;
  void block;
  return TODO("isExposed");
}

/**
 * Cells from which a bot can break `block`: offsets dx, dz in -1..1 and dy in -3..+1 relative to the block
 * (dx = dz = 0 only for dy <= -2, i.e. block above the head), that are standable, within `reach`
 * (eyeDistance from the cell's bottom-center feet position (x+.5, y, z+.5)), and not standing ON the block
 * (cell - 1y != block). Sorted by eyeDistance asc, ties by posKey asc. Returned cells are integer block positions.
 */
export function standCells(probe: BlockProbe, block: Vec3, reach: number): Vec3[] {
  void probe;
  void block;
  void reach;
  return TODO("standCells");
}

/**
 * Candidate order for the next block to break: drop positions in `exclude` (posKey set) and those farther
 * than cfg.scanRadius horizontally from `origin` (box corners), then sort by
 * distance(botPos, blockCenter) + riskCost(pos) asc, ties by posKey asc.
 * riskCost defaults to () => 0. TODO(phase-6): risk weighting (distance from home, light level, mobs).
 */
export function rankCandidates(
  found: readonly Vec3[],
  botPos: Vec3,
  origin: Vec3,
  cfg: GatherConfig,
  exclude: ReadonlySet<string>,
  riskCost?: (pos: Vec3) => number,
): Vec3[] {
  void found;
  void botPos;
  void origin;
  void cfg;
  void exclude;
  void riskCost;
  return TODO("rankCandidates");
}

// ---------------------------------------------------------------- breaking

/**
 * Expected survival break time in ticks for `blockTypeId` (BLOCK_HARDNESS, else DEFAULT_HARDNESS):
 *   matching = tool?.kind === res.tool;   speed = matching ? TOOL_SPEED[tool.tier] : 1
 *   harvestable = !res.requiresTool || matching
 *   ticks = ceil(hardness * (harvestable ? 1.5 : 5) / speed * 20)
 */
export function estimateBreakTicks(blockTypeId: string, res: ResourceDef, tool: ToolInfo | undefined): Tick {
  void blockTypeId;
  void res;
  void tool;
  return TODO("estimateBreakTicks");
}

/** Give up on a block after 2 x estimate + 40 ticks. */
export function breakTimeoutTicks(estimate: Tick): Tick {
  void estimate;
  return TODO("breakTimeoutTicks");
}

// ---------------------------------------------------------------- inventory

/** Total amount of items whose typeId is in `typeIds`. */
export function countItems(inv: InventorySnapshot, typeIds: readonly string[]): number {
  void inv;
  void typeIds;
  return TODO("countItems");
}

/** Slot indices holding any of `typeIds`, ascending. */
export function slotsWith(inv: InventorySnapshot, typeIds: readonly string[]): number[] {
  void inv;
  void typeIds;
  return TODO("slotsWith");
}

/** Number of empty slots. */
export function freeSlots(inv: InventorySnapshot): number {
  void inv;
  return TODO("freeSlots");
}

/** One entry per typeId, amount desc then typeId asc. */
export function aggregate(inv: InventorySnapshot): ItemCount[] {
  void inv;
  return TODO("aggregate");
}

/**
 * Time to go to the chest: held >= remaining (held = countItems(inv, res.yields)), or
 * freeSlots(inv) <= cfg.reserveSlots and no yield stack has room (amount < maxAmount). remaining <= 0 -> true.
 */
export function shouldDeposit(inv: InventorySnapshot, res: ResourceDef, remaining: number, cfg: GatherConfig): boolean {
  void inv;
  void res;
  void remaining;
  void cfg;
  return TODO("shouldDeposit");
}

// ---------------------------------------------------------------- tools

/**
 * Slot of the best tool of `kind` in any snapshot (bot inventory or chest): lowest ToolInfo.rank, then most
 * remaining durability (max - damage; missing durability counts as full), then lowest slot. undefined if none.
 */
export function bestToolSlot(inv: InventorySnapshot, kind: ToolKind): number | undefined {
  void inv;
  void kind;
  return TODO("bestToolSlot");
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
  void inv;
  void slot;
  void selected;
  return TODO("planHotbar");
}
