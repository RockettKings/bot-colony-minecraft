// Pure crafting planner (Job 4). NO @minecraft imports: unit-tested in test/crafting.test.ts.
// Recipes are data in src/core/items.ts; the adapter applies a CraftPlan atomically (WorkerBody.applyCraft).
import type { Vec3 } from "../../core/types.js";
import type { Recipe } from "../../core/items.js";
import type { BlockProbe } from "./gather-logic.js";
import type { CraftPlan, Face, InventorySnapshot } from "./ports.js";

const TODO = (what: string): never => {
  throw new Error(`TODO(phase-2): ${what}`);
};

/**
 * Plan one craft of `recipe` from `inv`. For each ingredient, take from slots holding any of `anyOf`,
 * lowest slot first, splitting across slots as needed (track what is left per slot so no slot is
 * over-consumed across ingredient entries). Output must fit: a mergeable stack of the output
 * typeId with room (amount + out <= maxAmount; assume maxAmount 64 for new stacks), an empty slot, or a slot
 * the consumption empties. recipe.needsTable requires `tableAt` (copied into the plan).
 * undefined when ingredients are missing, the output doesn't fit, or the table is required but absent.
 */
export function planCraft(recipe: Recipe, inv: InventorySnapshot, tableAt?: Vec3): CraftPlan | undefined {
  void recipe;
  void inv;
  void tableAt;
  return TODO("planCraft");
}

/** The planks recipe for a log typeId ("minecraft:birch_log" -> birch_planks), else undefined. */
export function planksRecipeFor(logTypeId: string): Recipe | undefined {
  void logTypeId;
  return TODO("planksRecipeFor");
}

export type PickaxeStep =
  /** Craft once (re-plan with planCraft against the fresh inventory right before applying). */
  | { kind: "craft"; recipe: Recipe }
  /** Place the crafting table from the inventory (see tableSpot), then use it for the following 3x3 steps. */
  | { kind: "place_table" };

export type PickaxePlan = { ok: true; steps: PickaxeStep[] } | { ok: false; logsMissing: number };

/**
 * Steps to end up with a wooden pickaxe, using what `inv` already holds (logs of any species, planks, sticks,
 * a crafting table item). Needs 3 planks + 2 sticks; sticks come 4 per 2 planks; a table costs 4 planks unless
 * `tableNearby` or a crafting_table item is held. Planks come 4 per log (use the species with the most logs
 * first). Order: planks crafts, then stick, then crafting_table (if needed), then place_table (if not nearby),
 * then wooden_pickaxe. ok:false gives how many more logs are needed (>= 1).
 */
export function planWoodenPickaxe(inv: InventorySnapshot, tableNearby: boolean): PickaxePlan {
  void inv;
  void tableNearby;
  return TODO("planWoodenPickaxe");
}

/** Where to put a crafting table: placement target for WorkerBody.placeFromSlot + the resulting table block. */
export interface TableSpot {
  /** Solid block to click (the table goes on its `face`). */
  onBlock: Vec3;
  face: Face;
  /** Where the table will be. */
  tableAt: Vec3;
}

/**
 * A cell horizontally adjacent to the bot's feet block (4 neighbours, then 4 diagonals; N, E, S, W order:
 * dz -1, dx +1, dz +1, dx -1) that is passable with its head cell passable too, and a solid block below:
 * { onBlock: cell - 1y, face: "Up", tableAt: cell }. undefined if none.
 */
export function tableSpot(probe: BlockProbe, feet: Vec3): TableSpot | undefined {
  void probe;
  void feet;
  return TODO("tableSpot");
}
