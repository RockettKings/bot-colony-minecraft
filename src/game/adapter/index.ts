// The ONLY module in src/game that imports @minecraft/server-gametest (enforced by test/boundaries.test.ts).
//
// Experimental surface used (all from @minecraft/server-gametest 1.0.0-beta):
//   spawnSimulatedPlayer(DimensionLocation, name, GameMode)  top-level, not bound to a Test
//   SimulatedPlayer.navigateToLocation(Vector3, speed?) -> NavigationResult { isFullPath, getPath() }
//   SimulatedPlayer.stopMoving() / respawn(): boolean / disconnect()
//   Phase 2 (all no-restricted-execution, all "can throw"):
//   SimulatedPlayer.lookAtBlock(Vector3, LookDuration.UntilMove)
//   SimulatedPlayer.breakBlock(Vector3, Direction): boolean   survival: keeps hitting until broken / stopBreakingBlock
//   SimulatedPlayer.stopBreakingBlock()
//   SimulatedPlayer.useItemInSlotOnBlock(slot, Vector3, Direction): boolean   survival: consumes one item
// Stable @minecraft/server surface used for bodies: Entity.isValid / isOnGround / location / dimension.id
// (properties in 2.x), Player.selectedSlotIndex (read/write; restricted-execution-read-only),
// Entity.getComponent("inventory").container, Container.size/getItem/setItem/swapItems/transferItem/addItem,
// Dimension.getBlock, Block.getComponent("inventory").container, ItemStack (constructor, clone, amount).
// Never used for gameplay (they create items): SimulatedPlayer.giveItem / setItem / useItemOnBlock, setBlock*.
// Every call is wrapped in try/catch and logged with "[colony]" (1st failure per method, then every 25th).
// Nothing else in src/game sees these types, except the SimulatedPlayer type re-export needed by
// ColonyRuntime.adoptBot's signature.
import { Direction, GameMode, ItemStack, type Container, type DimensionLocation } from "@minecraft/server";
import { LookDuration, spawnSimulatedPlayer, type SimulatedPlayer } from "@minecraft/server-gametest";
import { CONTAINER_BLOCK_TYPES, CRAFTING_TABLE, RECIPES, type Recipe } from "../../core/items.js";
import type { ChestRef, Vec3 } from "../../core/types.js";
import { DEFAULT_GATHER_CONFIG } from "../bots/executor.js";
import type { NavInfo } from "../bots/executor-logic.js";
import { HOTBAR_SIZE, type BotBody, type CraftPlan, type Face, type TransferResult, type WorkerBody } from "../bots/ports.js";
import { errText, logError } from "../log.js";
import { blockContainer, blockPos, rateLimitedLogger, snapshotContainer } from "./world.js";

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
    // ---------------------------------------------------------- Phase 2 (WorkerBody)
    ...workerMethods(p, name),
  };
}

// ---------------------------------------------------------------- Phase 2: WorkerBody methods

/** Survival-rule reach limits enforced here too (defence in depth; the executor checks first). */
export const CONTAINER_REACH = DEFAULT_GATHER_CONFIG.containerReach;
export const CONTAINER_MAX_DY = 2;
export const BREAK_REACH = DEFAULT_GATHER_CONFIG.breakReach;
/** Extra slack for break/place only: the bot may drift a little between the executor's check and the call. */
export const BREAK_REACH_SLACK = 0.5;
const EYE_HEIGHT = 1.62;
const EPS = 1e-6;

/** Face -> Direction. Lazy (not a module-level table) so importing this module never touches engine enums. */
function toDirection(face: Face): Direction {
  return Direction[face];
}

/** Feet within `reach` (horizontal) of the block center and |feet.y - (block.y + .5)| <= CONTAINER_MAX_DY. */
export function withinContainerReach(feet: Vec3, block: Vec3, reach = CONTAINER_REACH): boolean {
  const dx = block.x + 0.5 - feet.x;
  const dz = block.z + 0.5 - feet.z;
  return Math.hypot(dx, dz) <= reach + EPS && Math.abs(feet.y - (block.y + 0.5)) <= CONTAINER_MAX_DY + EPS;
}

/** Eyes (feet + 1.62) to block center <= reach. */
export function withinEyeReach(feet: Vec3, block: Vec3, reach = BREAK_REACH): boolean {
  const dx = block.x + 0.5 - feet.x;
  const dy = block.y + 0.5 - (feet.y + EYE_HEIGHT);
  const dz = block.z + 0.5 - feet.z;
  return Math.hypot(dx, dy, dz) <= reach + EPS;
}

function recipeFor(plan: CraftPlan): Recipe | undefined {
  return (
    RECIPES.find((r) => r.id === plan.recipeId) ??
    RECIPES.find((r) => r.output.typeId === plan.produce.typeId && r.output.amount === plan.produce.amount)
  );
}

/** The plan consumes exactly the recipe's ingredients (each entry matched to one ingredient) and produces its output. */
function planMatchesRecipe(plan: CraftPlan, recipe: Recipe): boolean {
  if (plan.produce.typeId !== recipe.output.typeId || plan.produce.amount !== recipe.output.amount) return false;
  const used = recipe.ingredients.map(() => 0);
  for (const c of plan.consume) {
    if (!Number.isInteger(c.amount) || c.amount <= 0) return false;
    const i = recipe.ingredients.findIndex((ing) => ing.anyOf.includes(c.typeId));
    if (i < 0) return false;
    used[i] = (used[i] ?? 0) + c.amount;
  }
  return recipe.ingredients.every((ing, i) => used[i] === ing.amount);
}

type WorkerMethods = Omit<WorkerBody, keyof BotBody>;

function workerMethods(p: SimulatedPlayer, name: string): WorkerMethods {
  const fail = rateLimitedLogger(`${name}.`);

  const feet = (): Vec3 | undefined => {
    const l = p.location;
    return l ? { x: l.x, y: l.y, z: l.z } : undefined;
  };
  /** The bot's own inventory container (throws / undefined when the entity is gone). */
  const own = (): Container | undefined => p.getComponent("inventory")?.container;
  const slotOk = (c: Container, slot: number) => Number.isInteger(slot) && slot >= 0 && slot < c.size;

  /** Shared preamble of deposit/withdraw: reach rule, chest container, own container. */
  const transferSetup = (chest: ChestRef): { ok: true; bot: Container; box: Container } | { ok: false; result: TransferResult } => {
    const f = feet();
    if (!f) return { ok: false, result: { ok: false, reason: "error" } };
    const dim = p.dimension;
    if (dim.id !== chest.dimensionId) return { ok: false, result: { ok: false, reason: "no_container" } };
    if (!withinContainerReach(f, chest.pos)) return { ok: false, result: { ok: false, reason: "out_of_reach" } };
    let found: ReturnType<typeof blockContainer>;
    try {
      found = blockContainer(dim, chest.pos);
    } catch {
      found = undefined; // unloaded / out of bounds: there is no container we can use
    }
    if (!found || !CONTAINER_BLOCK_TYPES.includes(found.typeId)) return { ok: false, result: { ok: false, reason: "no_container" } };
    const bot = own();
    if (!bot) return { ok: false, result: { ok: false, reason: "error" } };
    return { ok: true, bot, box: found.container };
  };

  /**
   * After `from.transferItem(slot, to)`: the amount still in `slot` (same type). If the engine emptied the slot
   * but reported a leftover, put the leftover back so no item is lost (conservation).
   */
  const settleTransfer = (from: Container, slot: number, typeId: string, leftover: ItemStack | undefined): number => {
    const after = from.getItem(slot);
    if (after && after.typeId === typeId) return after.amount;
    if (!after && leftover && leftover.amount > 0) {
      from.setItem(slot, leftover);
      return leftover.amount;
    }
    return 0;
  };

  return {
    dimensionId: () => {
      try {
        return p.dimension.id;
      } catch (err) {
        fail("dimension", err);
        return undefined;
      }
    },

    lookAtBlock: (block) => {
      try {
        p.lookAtBlock(blockPos(block), LookDuration.UntilMove);
        return true;
      } catch (err) {
        fail("lookAtBlock", err);
        return false;
      }
    },

    startBreaking: (block, face) => {
      try {
        const f = feet();
        const b = blockPos(block);
        if (!f || !withinEyeReach(f, b, BREAK_REACH + BREAK_REACH_SLACK)) return false;
        return p.breakBlock(b, toDirection(face));
      } catch (err) {
        fail("breakBlock", err);
        return false;
      }
    },

    stopBreaking: () => {
      try {
        if (!p.isValid) return;
        p.stopBreakingBlock();
      } catch (err) {
        fail("stopBreakingBlock", err);
      }
    },

    inventory: () => {
      try {
        const c = own();
        return c ? snapshotContainer(c) : undefined;
      } catch (err) {
        fail("inventory", err);
        return undefined;
      }
    },

    selectedSlot: () => {
      try {
        return p.selectedSlotIndex;
      } catch (err) {
        fail("selectedSlotIndex", err);
        return undefined;
      }
    },

    selectSlot: (slot) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) return false;
      try {
        p.selectedSlotIndex = slot;
        return true;
      } catch (err) {
        fail("selectSlot", err);
        return false;
      }
    },

    swapSlots: (a, b) => {
      try {
        const c = own();
        if (!c || !slotOk(c, a) || !slotOk(c, b)) return false;
        if (a !== b) c.swapItems(a, b, c);
        return true;
      } catch (err) {
        fail("swapSlots", err);
        return false;
      }
    },

    depositSlot: (chest, slot) => {
      try {
        const s = transferSetup(chest);
        if (!s.ok) return s.result;
        if (!slotOk(s.bot, slot)) return { ok: false, reason: "error" };
        const stack = s.bot.getItem(slot);
        if (!stack) return { ok: true, moved: 0 };
        const before = stack.amount;
        const leftover = s.bot.transferItem(slot, s.box);
        const remaining = settleTransfer(s.bot, slot, stack.typeId, leftover);
        return { ok: true, moved: Math.max(0, before - remaining) };
      } catch (err) {
        fail("depositSlot", err);
        return { ok: false, reason: "error" };
      }
    },

    withdrawSlot: (chest, chestSlot, amount) => {
      try {
        const s = transferSetup(chest);
        if (!s.ok) return s.result;
        if (!slotOk(s.box, chestSlot)) return { ok: false, reason: "error" };
        const stack = s.box.getItem(chestSlot);
        const want = Math.floor(amount);
        if (!stack || !(want > 0)) return { ok: true, moved: 0 };
        if (want >= stack.amount) {
          // whole stack: the engine's own transfer (merges into the bot's stacks / first free slots)
          const before = stack.amount;
          const leftover = s.box.transferItem(chestSlot, s.bot);
          const remaining = settleTransfer(s.box, chestSlot, stack.typeId, leftover);
          return { ok: true, moved: Math.max(0, before - remaining) };
        }
        // part of a stack: take `want` out of the chest first, then add to the bot, then return what didn't fit.
        // Ordered so a throw can never duplicate items (worst case the chest slot is restored).
        const reduced = stack.clone();
        reduced.amount = stack.amount - want;
        const part = stack.clone();
        part.amount = want;
        s.box.setItem(chestSlot, reduced);
        let leftover: ItemStack | undefined;
        try {
          leftover = s.bot.addItem(part);
        } catch (err) {
          s.box.setItem(chestSlot, stack); // restore; nothing moved
          throw err;
        }
        const added = want - (leftover?.amount ?? 0);
        if (added < want) {
          const back = stack.clone();
          back.amount = stack.amount - added;
          s.box.setItem(chestSlot, back);
        }
        return { ok: true, moved: added };
      } catch (err) {
        fail("withdrawSlot", err);
        return { ok: false, reason: "error" };
      }
    },

    applyCraft: (plan) => {
      try {
        const recipe = recipeFor(plan);
        if (!recipe || !planMatchesRecipe(plan, recipe)) return false;
        const c = own();
        if (!c) return false;
        // 3x3 recipes: a real crafting table within reach of the eyes
        if (recipe.needsTable || plan.tableAt) {
          if (!plan.tableAt) return false;
          const f = feet();
          if (!f || !withinEyeReach(f, blockPos(plan.tableAt))) return false;
          const table = p.dimension.getBlock(blockPos(plan.tableAt));
          if (!table || table.typeId !== CRAFTING_TABLE) return false;
        }
        // every consume entry is present (aggregated per slot so one slot can't be over-consumed)
        const take = new Map<number, number>();
        for (const e of plan.consume) {
          if (!slotOk(c, e.slot)) return false;
          take.set(e.slot, (take.get(e.slot) ?? 0) + e.amount);
        }
        const originals = new Map<number, ItemStack>();
        for (const [slot, n] of take) {
          const s = c.getItem(slot);
          const types = new Set(plan.consume.filter((e) => e.slot === slot).map((e) => e.typeId));
          if (!s || types.size !== 1 || !types.has(s.typeId) || s.amount < n) return false;
          originals.set(slot, s);
        }
        // the output fits after consumption (empty slots, mergeable stacks, slots the consumption empties)
        const out = new ItemStack(plan.produce.typeId, plan.produce.amount);
        let room = 0;
        for (let i = 0; i < c.size && room < out.amount; i++) {
          const s = c.getItem(i);
          const left = (s?.amount ?? 0) - (take.get(i) ?? 0);
          if (!s || left <= 0) room += out.maxAmount;
          else if (s.typeId === out.typeId) room += Math.max(0, s.maxAmount - left);
        }
        if (room < out.amount) return false;
        // apply; roll the consumed slots back if the engine throws part-way
        try {
          for (const [slot, n] of take) {
            const s = originals.get(slot)!;
            if (s.amount === n) c.setItem(slot, undefined);
            else {
              const r = s.clone();
              r.amount = s.amount - n;
              c.setItem(slot, r);
            }
          }
        } catch (err) {
          for (const [slot, s] of originals) {
            try {
              c.setItem(slot, s);
            } catch {
              // best effort
            }
          }
          throw err;
        }
        const leftover = c.addItem(out);
        if (leftover && leftover.amount > 0) logError(`${name}.applyCraft: ${leftover.amount} ${out.typeId} didn't fit`);
        return true;
      } catch (err) {
        fail("applyCraft", err);
        return false;
      }
    },

    placeFromSlot: (slot, onBlock, face) => {
      try {
        const c = own();
        if (!c || !slotOk(c, slot) || !c.getItem(slot)) return false;
        const f = feet();
        const b = blockPos(onBlock);
        if (!f || !withinEyeReach(f, b, BREAK_REACH + BREAK_REACH_SLACK)) return false;
        return p.useItemInSlotOnBlock(slot, b, toDirection(face));
      } catch (err) {
        fail("useItemInSlotOnBlock", err);
        return false;
      }
    },
  };
}
