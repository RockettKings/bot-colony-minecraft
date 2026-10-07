// Engine-free ports the executors drive (architect-owned contract). NO @minecraft imports: executors and
// their tests only ever see these interfaces. src/game/adapter/ implements them over the real engine.
//
// Every method is exception-safe: implementations catch, log with "[colony]" (rate-limited for repeating
// calls), and return the documented failure value. Positions are ABSOLUTE world coordinates. A block
// position is the integer corner (x, y, z) of the block; its center is (x + .5, y + .5, z + .5).
import type { ChestRef, Vec3 } from "../../core/types.js";
import type { NavInfo } from "./executor-logic.js";

// ---------------------------------------------------------------- bodies

/** Phase 1 body: movement + lifecycle. GotoExecutor only needs this. */
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

/** One inventory/container slot as plain data. */
export interface ItemStackView {
  typeId: string;
  amount: number;
  maxAmount: number;
  /** Tools only: current damage and max durability (ItemDurabilityComponent). */
  durability?: { damage: number; max: number };
}

/** Slot-indexed snapshot; `undefined` = empty slot. For a player: 36 slots, 0..8 = hotbar. */
export type InventorySnapshot = ReadonlyArray<ItemStackView | undefined>;

export const HOTBAR_SIZE = 9;

export type Face = "Up" | "Down" | "North" | "South" | "East" | "West";

export type TransferResult =
  | { ok: true; moved: number }
  | { ok: false; reason: "no_container" | "out_of_reach" | "error" };

/**
 * Crafting abstraction (AGENT-CONTEXT): consume exactly `consume` from the bot's inventory and add `produce`.
 * Built by the pure planner (crafting.ts); applied atomically by the adapter.
 */
export interface CraftPlan {
  recipeId: string;
  consume: ReadonlyArray<{ slot: number; typeId: string; amount: number }>;
  produce: { typeId: string; amount: number };
  /** Required for 3x3 recipes: the crafting table block the bot is using (adapter verifies type + reach). */
  tableAt?: Vec3;
}

/**
 * Phase 2 body: everything a gatherer does, with the same permissions as a survival player.
 * No method creates items from nothing except applyCraft (which consumes the exact ingredients).
 */
export interface WorkerBody extends BotBody {
  /** e.g. "minecraft:overworld"; undefined if unreadable. */
  dimensionId(): string | undefined;

  /** SimulatedPlayer.lookAtBlock(pos, LookDuration.UntilMove). false = threw. */
  lookAtBlock(block: Vec3): boolean;
  /**
   * SimulatedPlayer.breakBlock(pos, face). Survival: the bot keeps hitting over the following ticks until the
   * block breaks, an item is used, or stopBreaking() is called. Returns the API's boolean (true = block is
   * solid and breaking started), false if it threw. Callers poll the block to detect completion.
   */
  startBreaking(block: Vec3, face: Face): boolean;
  /** SimulatedPlayer.stopBreakingBlock(). Idempotent. */
  stopBreaking(): void;

  /** Snapshot of the bot's own inventory container. undefined = unreadable. */
  inventory(): InventorySnapshot | undefined;
  /** Player.selectedSlotIndex. undefined = unreadable. */
  selectedSlot(): number | undefined;
  /** Set Player.selectedSlotIndex (0..8). false = out of range or threw. */
  selectSlot(slot: number): boolean;
  /** Container.swapItems within the bot's own inventory (as a player can in the inventory screen). */
  swapSlots(a: number, b: number): boolean;

  /**
   * Container transfer (AGENT-CONTEXT): move the whole stack in bot `slot` into the container at `chest`
   * (Container.transferItem). The adapter refuses (out_of_reach) unless the bot's feet are within
   * CONTAINER_REACH (2.5 blocks, horizontal, |dy| <= 2) of the container block center.
   * moved = amount that actually left the bot (0 = container full).
   */
  depositSlot(chest: ChestRef, slot: number): TransferResult;
  /** Move up to `amount` items from container `chestSlot` into the bot's inventory. Same reach rule. */
  withdrawSlot(chest: ChestRef, chestSlot: number, amount: number): TransferResult;

  /**
   * Crafting abstraction: verifies every `consume` entry (slot holds >= amount of typeId), that the output
   * fits (an empty slot, a mergeable stack, or a slot freed by the consumption), and for `tableAt` that the
   * block there is a crafting table within reach (<= 4.5 from the eyes). Then consumes and adds the output.
   * false (and nothing changed) if any check fails.
   */
  applyCraft(plan: CraftPlan): boolean;
  /**
   * Place the block item held in `slot` on the `face` of the solid block at `onBlock`
   * (SimulatedPlayer.useItemInSlotOnBlock). Survival: consumes one item. Returns the API boolean.
   */
  placeFromSlot(slot: number, onBlock: Vec3, face: Face): boolean;
}

// ---------------------------------------------------------------- world

export interface BlockInfo {
  typeId: string;
  isAir: boolean;
  isSolid: boolean;
  isLiquid: boolean;
}

/** Inclusive integer box. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface ItemEntityView {
  /** Entity id. */
  id: string;
  /** Item typeId of the dropped stack. */
  typeId: string;
  amount: number;
  pos: Vec3;
}

/** Read-only view of one dimension. Executors never change the world through this. */
export interface WorldPort {
  readonly dimensionId: string;
  /** undefined = unloaded, out of the world, or threw. */
  blockAt(pos: Vec3): BlockInfo | undefined;
  /**
   * Positions of blocks in `box` whose typeId is in `typeIds` (Dimension.getBlocks with includeTypes,
   * allowUnloadedChunks = true, so unloaded parts are skipped). Unordered. undefined = the call failed.
   */
  findBlocks(box: Box, typeIds: readonly string[]): Vec3[] | undefined;
  /** Item entities (minecraft:item) within `radius` of `center`, optionally only these item typeIds. [] on failure. */
  itemsNear(center: Vec3, radius: number, typeIds?: readonly string[]): ItemEntityView[];
  /** Slot snapshot of the container block at `pos`. undefined = not a container / unloaded / threw. */
  containerAt(pos: Vec3): InventorySnapshot | undefined;
}
