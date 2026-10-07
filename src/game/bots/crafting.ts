// Pure crafting planner (Job 4). NO @minecraft imports: unit-tested in test/crafting.test.ts.
// Recipes are data in src/core/items.ts; the adapter applies a CraftPlan atomically (WorkerBody.applyCraft).
import type { Vec3 } from "../../core/types.js";
import type { Recipe } from "../../core/items.js";
import {
  CRAFTING_TABLE,
  CRAFTING_TABLE_RECIPE,
  LOG_IDS,
  PLANK_IDS,
  PLANKS_RECIPES,
  STICK,
  STICK_RECIPE,
  WOODEN_PICKAXE_RECIPE,
  ns,
} from "../../core/items.js";
import type { BlockProbe } from "./gather-logic.js";
import { blockOf, isStandable } from "./gather-logic.js";
import type { CraftPlan, Face, InventorySnapshot } from "./ports.js";

const NEW_STACK_MAX = 64;

/**
 * Plan one craft of `recipe` from `inv`. For each ingredient, take from slots holding any of `anyOf`,
 * lowest slot first, splitting across slots as needed (track what is left per slot so no slot is
 * over-consumed across ingredient entries). Output must fit: a mergeable stack of the output
 * typeId with room (amount + out <= maxAmount; assume maxAmount 64 for new stacks), an empty slot, or a slot
 * the consumption empties. recipe.needsTable requires `tableAt` (copied into the plan).
 * undefined when ingredients are missing, the output doesn't fit, or the table is required but absent.
 *
 * Consume entries are merged per slot (one entry per slot), so the adapter's per-entry check is exact.
 * tableAt is only copied for recipes that need a table.
 */
export function planCraft(recipe: Recipe, inv: InventorySnapshot, tableAt?: Vec3): CraftPlan | undefined {
  if (recipe.needsTable && !tableAt) return undefined;
  const left = inv.map((s) => s?.amount ?? 0);
  const taken = new Map<number, number>();
  for (const ing of recipe.ingredients) {
    let need = ing.amount;
    for (let i = 0; i < inv.length && need > 0; i++) {
      const s = inv[i];
      const l = left[i] ?? 0;
      if (!s || l <= 0 || !ing.anyOf.includes(s.typeId)) continue;
      const take = Math.min(l, need);
      left[i] = l - take;
      taken.set(i, (taken.get(i) ?? 0) + take);
      need -= take;
    }
    if (need > 0) return undefined;
  }
  const out = recipe.output;
  const fits = inv.some((s, i) => {
    const l = left[i] ?? 0;
    if (!s || l === 0) return out.amount <= NEW_STACK_MAX;
    return s.typeId === out.typeId && l + out.amount <= s.maxAmount;
  });
  if (!fits) return undefined;
  const consume = [...taken.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, amount]) => ({ slot, typeId: inv[slot]!.typeId, amount }));
  const plan: CraftPlan = { recipeId: recipe.id, consume, produce: { typeId: out.typeId, amount: out.amount } };
  if (recipe.needsTable && tableAt) plan.tableAt = { x: tableAt.x, y: tableAt.y, z: tableAt.z };
  return plan;
}

/** The planks recipe for a log typeId ("minecraft:birch_log" -> birch_planks), else undefined. */
export function planksRecipeFor(logTypeId: string): Recipe | undefined {
  const id = ns(logTypeId);
  return PLANKS_RECIPES.find((r) => r.ingredients[0]?.anyOf.includes(id));
}

export type PickaxeStep =
  /** Craft once (re-plan with planCraft against the fresh inventory right before applying). */
  | { kind: "craft"; recipe: Recipe }
  /** Place the crafting table from the inventory (see tableSpot), then use it for the following 3x3 steps. */
  | { kind: "place_table" };

export type PickaxePlan = { ok: true; steps: PickaxeStep[] } | { ok: false; logsMissing: number };

function count(inv: InventorySnapshot, ids: readonly string[]): number {
  let n = 0;
  for (const s of inv) if (s && ids.includes(s.typeId)) n += s.amount;
  return n;
}

/**
 * Steps to end up with a wooden pickaxe, using what `inv` already holds (logs of any species, planks, sticks,
 * a crafting table item). Needs 3 planks + 2 sticks; sticks come 4 per 2 planks; a table costs 4 planks unless
 * `tableNearby` or a crafting_table item is held. Planks come 4 per log (use the species with the most logs
 * first). Order: planks crafts, then stick, then crafting_table (if needed), then place_table (if not nearby),
 * then wooden_pickaxe. ok:false gives how many more logs are needed (>= 1).
 */
export function planWoodenPickaxe(inv: InventorySnapshot, tableNearby: boolean): PickaxePlan {
  const planks = count(inv, PLANK_IDS);
  const sticks = count(inv, [STICK]);
  const haveTable = tableNearby || count(inv, [CRAFTING_TABLE]) > 0;
  const stickCrafts = sticks >= 2 ? 0 : 1;
  const tableCrafts = haveTable ? 0 : 1;
  const planksNeeded = 3 + 2 * stickCrafts + 4 * tableCrafts;
  const logsNeeded = Math.ceil(Math.max(0, planksNeeded - planks) / 4);

  // Logs per species, most first (ties: LOG_IDS order).
  const logs = LOG_IDS.map((id, order) => ({ id, order, n: count(inv, [id]) }))
    .filter((l) => l.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order);
  const totalLogs = logs.reduce((s, l) => s + l.n, 0);
  if (totalLogs < logsNeeded) return { ok: false, logsMissing: logsNeeded - totalLogs };

  const steps: PickaxeStep[] = [];
  let todo = logsNeeded;
  for (const l of logs) {
    const recipe = planksRecipeFor(l.id);
    if (!recipe) continue;
    for (let i = 0; i < l.n && todo > 0; i++, todo--) steps.push({ kind: "craft", recipe });
    if (todo === 0) break;
  }
  if (stickCrafts) steps.push({ kind: "craft", recipe: STICK_RECIPE });
  if (tableCrafts) steps.push({ kind: "craft", recipe: CRAFTING_TABLE_RECIPE });
  if (!tableNearby) steps.push({ kind: "place_table" });
  steps.push({ kind: "craft", recipe: WOODEN_PICKAXE_RECIPE });
  return { ok: true, steps };
}

/** Where to put a crafting table: placement target for WorkerBody.placeFromSlot + the resulting table block. */
export interface TableSpot {
  /** Solid block to click (the table goes on its `face`). */
  onBlock: Vec3;
  face: Face;
  /** Where the table will be. */
  tableAt: Vec3;
}

/** N, E, S, W, then NE, SE, SW, NW. */
const TABLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/**
 * A cell horizontally adjacent to the bot's feet block (4 neighbours, then 4 diagonals; N, E, S, W order:
 * dz -1, dx +1, dz +1, dx -1) that is passable with its head cell passable too, and a solid block below:
 * { onBlock: cell - 1y, face: "Up", tableAt: cell }. undefined if none.
 * Diagonal order: NE, SE, SW, NW.
 */
export function tableSpot(probe: BlockProbe, feet: Vec3): TableSpot | undefined {
  const f = blockOf(feet);
  for (const [dx, dz] of TABLE_OFFSETS) {
    const cell = { x: f.x + dx, y: f.y, z: f.z + dz };
    if (isStandable(probe, cell)) return { onBlock: { x: cell.x, y: cell.y - 1, z: cell.z }, face: "Up", tableAt: cell };
  }
  return undefined;
}
