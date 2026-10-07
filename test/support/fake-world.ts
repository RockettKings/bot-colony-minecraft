// Voxel fake of WorldPort + WorkerBody for executor tests (Job 5). No engine: plain data + a tick() that
// simulates movement (straight line toward the nav target), survival breaking over N ticks with drops that
// fall to the ground, pickup within PICKUP_DIST, chests, transfers, crafting and placement.
// It records every port call and any rule violation (reach, creating items) so tests can assert on them.
import type { ChestRef, Vec3 } from "../../src/core/types.js";
import { CONTAINER_BLOCK_TYPES, toolInfo } from "../../src/core/items.js";
import type {
  BlockInfo,
  Box,
  CraftPlan,
  Face,
  InventorySnapshot,
  ItemEntityView,
  ItemStackView,
  TransferResult,
  WorkerBody,
  WorldPort,
} from "../../src/game/bots/ports.js";
import type { NavInfo } from "../../src/game/bots/executor-logic.js";
import type { ExecutorContext, GatherConfig, StepResult, TaskExecutor } from "../../src/game/bots/executor.js";
import { DEFAULT_GATHER_CONFIG } from "../../src/game/bots/executor.js";

export const DIM = "minecraft:overworld";
export const AIR = "minecraft:air";
export const PICKUP_DIST = 1.5;
export const BOT_SPEED = 0.25; // blocks per tick (~5 b/s)
export const CHEST_SLOTS = 27;
export const BOT_SLOTS = 36;

const PASSABLE = new Set([AIR, "minecraft:short_grass", "minecraft:tall_grass", "minecraft:poppy"]);
const LIQUID = new Set(["minecraft:water", "minecraft:lava"]);

export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function stack(typeId: string, amount: number, maxAmount?: number): ItemStackView {
  const tool = toolInfo(typeId) !== undefined;
  return { typeId, amount, maxAmount: maxAmount ?? (tool ? 1 : 64) };
}

/** Add `item` into `slots` (merge first, then empty slots). Returns how many didn't fit. */
function addInto(slots: (ItemStackView | undefined)[], item: ItemStackView): number {
  let left = item.amount;
  for (const s of slots) {
    if (left <= 0) break;
    if (s && s.typeId === item.typeId && s.amount < s.maxAmount) {
      const n = Math.min(left, s.maxAmount - s.amount);
      s.amount += n;
      left -= n;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i] === undefined) {
      const n = Math.min(left, item.maxAmount);
      slots[i] = { ...item, amount: n };
      left -= n;
    }
  }
  return left;
}

export interface FakeOptions {
  /** Break duration in ticks for a block type with the given held item. Default 12 (stone by hand: 40). */
  breakTicks?: (typeId: string, held: ItemStackView | undefined) => number;
  /** Navigation to these targets returns an empty path (unreachable). */
  unreachable?: (target: Vec3) => boolean;
  /** Stack size for picked-up items (default 64; tools 1). */
  maxStack?: (typeId: string) => number;
}

export class FakeWorld implements WorldPort {
  readonly dimensionId = DIM;
  readonly blocks = new Map<string, string>();
  readonly containers = new Map<string, (ItemStackView | undefined)[]>();
  readonly items: ItemEntityView[] = [];
  readonly findCalls: { box: Box; typeIds: readonly string[] }[] = [];
  /** Positions that read as unloaded. */
  readonly unloaded = new Set<string>();
  private nextItem = 1;

  set(p: Vec3, typeId: string): this {
    if (typeId === AIR) this.blocks.delete(key(p));
    else this.blocks.set(key(p), typeId);
    if (CONTAINER_BLOCK_TYPES.includes(typeId)) {
      if (!this.containers.has(key(p))) this.containers.set(key(p), new Array(CHEST_SLOTS).fill(undefined));
    } else this.containers.delete(key(p));
    return this;
  }
  typeAt(p: Vec3): string {
    return this.blocks.get(key(p)) ?? AIR;
  }
  /** Fill an inclusive box. */
  fill(min: Vec3, max: Vec3, typeId: string): this {
    for (let x = min.x; x <= max.x; x++)
      for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) this.set(v(x, y, z), typeId);
    return this;
  }
  chest(p: Vec3): (ItemStackView | undefined)[] {
    const c = this.containers.get(key(p));
    if (!c) throw new Error(`no container at ${key(p)}`);
    return c;
  }
  chestCount(p: Vec3, typeId: string): number {
    return this.chest(p).reduce((n, s) => n + (s && s.typeId === typeId ? s.amount : 0), 0);
  }
  spawnItem(typeId: string, amount: number, at: Vec3): void {
    // fall to the ground: lowest passable cell above a solid one
    const p = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    while (p.y > -64 && this.info(v(p.x, p.y - 1, p.z)).isSolid === false) p.y--;
    this.items.push({ id: `item-${this.nextItem++}`, typeId, amount, pos: { x: p.x + 0.5, y: p.y, z: p.z + 0.5 } });
  }

  info(p: Vec3): BlockInfo {
    const t = this.typeAt(p);
    const liquid = LIQUID.has(t);
    return { typeId: t, isAir: t === AIR, isSolid: !PASSABLE.has(t) && !liquid, isLiquid: liquid };
  }

  // ---- WorldPort
  blockAt(pos: Vec3): BlockInfo | undefined {
    if (this.unloaded.has(key(pos))) return undefined;
    return this.info(pos);
  }
  findBlocks(box: Box, typeIds: readonly string[]): Vec3[] | undefined {
    this.findCalls.push({ box, typeIds });
    const out: Vec3[] = [];
    for (const [k, t] of this.blocks) {
      if (!typeIds.includes(t)) continue;
      const [x, y, z] = k.split(",").map(Number) as [number, number, number];
      if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y || z < box.min.z || z > box.max.z) continue;
      out.push(v(x, y, z));
    }
    return out;
  }
  itemsNear(center: Vec3, radius: number, typeIds?: readonly string[]): ItemEntityView[] {
    return this.items
      .filter((i) => dist(i.pos, center) <= radius && (!typeIds || typeIds.includes(i.typeId)))
      .map((i) => ({ ...i, pos: { ...i.pos } }));
  }
  containerAt(pos: Vec3): InventorySnapshot | undefined {
    const c = this.containers.get(key(pos));
    return c?.map((s) => (s ? { ...s } : undefined));
  }
}

export class FakeBody implements WorkerBody {
  readonly id = "bot-1";
  readonly name = "Bot-1";
  pos: Vec3;
  slots: (ItemStackView | undefined)[] = new Array(BOT_SLOTS).fill(undefined);
  selected = 0;
  navTarget: Vec3 | undefined;
  breaking: { block: Vec3; ticks: number } | undefined;
  readonly calls: string[] = [];
  readonly violations: string[] = [];
  readonly navTargets: Vec3[] = [];
  crafted: string[] = [];
  stops = 0;
  stopBreaks = 0;
  /** Test knobs. */
  locationUnreadable = false;
  inventoryUnreadable = false;

  constructor(
    readonly world: FakeWorld,
    at: Vec3,
    readonly opts: FakeOptions = {},
  ) {
    this.pos = { ...at };
  }

  give(...items: ItemStackView[]): this {
    for (const i of items) addInto(this.slots, { ...i });
    return this;
  }
  count(typeId: string): number {
    return this.slots.reduce((n, s) => n + (s && s.typeId === typeId ? s.amount : 0), 0);
  }
  heldItem(): ItemStackView | undefined {
    return this.slots[this.selected];
  }

  /** Simulate one game tick. */
  tick(): void {
    if (this.navTarget) {
      const d = dist(this.pos, this.navTarget);
      if (d <= BOT_SPEED) {
        this.pos = { ...this.navTarget };
        this.navTarget = undefined;
      } else {
        const f = BOT_SPEED / d;
        this.pos = {
          x: this.pos.x + (this.navTarget.x - this.pos.x) * f,
          y: this.pos.y + (this.navTarget.y - this.pos.y) * f,
          z: this.pos.z + (this.navTarget.z - this.pos.z) * f,
        };
      }
    }
    if (this.breaking) {
      const b = this.breaking;
      const type = this.world.typeAt(b.block);
      if (type === AIR) this.breaking = undefined;
      else if (++b.ticks >= this.breakTicks(type)) {
        this.world.set(b.block, AIR);
        const drop = this.dropFor(type);
        if (drop) this.world.spawnItem(drop, 1, { x: b.block.x + 0.5, y: b.block.y + 0.5, z: b.block.z + 0.5 });
        this.breaking = undefined; // in survival the bot stops hitting once the block is gone
      }
    }
    for (let i = this.world.items.length - 1; i >= 0; i--) {
      const it = this.world.items[i]!;
      if (dist(it.pos, this.pos) > PICKUP_DIST) continue;
      const left = addInto(this.slots, stack(it.typeId, it.amount, this.opts.maxStack?.(it.typeId)));
      if (left === 0) this.world.items.splice(i, 1);
      else it.amount = left;
    }
  }

  private breakTicks(type: string): number {
    if (this.opts.breakTicks) return this.opts.breakTicks(type, this.heldItem());
    if (type === "minecraft:stone" && toolInfo(this.heldItem()?.typeId ?? "")?.kind !== "pickaxe") return 40;
    return 12;
  }
  private dropFor(type: string): string | undefined {
    const held = toolInfo(this.heldItem()?.typeId ?? "");
    if (type === "minecraft:stone") return held?.kind === "pickaxe" ? "minecraft:cobblestone" : undefined;
    if (type === "minecraft:grass_block") return "minecraft:dirt";
    return type;
  }
  private eye(): Vec3 {
    return { x: this.pos.x, y: this.pos.y + 1.62, z: this.pos.z };
  }
  private inContainerReach(chest: Vec3): boolean {
    const h = Math.hypot(this.pos.x - (chest.x + 0.5), this.pos.z - (chest.z + 0.5));
    return h <= 2.5 && Math.abs(this.pos.y - (chest.y + 0.5)) <= 2;
  }

  // ---- BotBody
  isValid(): boolean {
    return true;
  }
  location(): Vec3 | undefined {
    return this.locationUnreadable ? undefined : { ...this.pos };
  }
  isOnGround(): boolean {
    return true;
  }
  navigateTo(target: Vec3): NavInfo | undefined {
    this.calls.push("navigateTo");
    this.navTargets.push({ ...target });
    if (this.opts.unreachable?.(target)) return { pathLength: 0, isFullPath: false };
    this.navTarget = { ...target };
    return { pathLength: Math.max(1, Math.ceil(dist(this.pos, target))), isFullPath: true };
  }
  stop(): void {
    this.stops++;
    this.navTarget = undefined;
  }
  respawn(): boolean {
    return true;
  }
  disconnect(): void {}

  // ---- WorkerBody
  dimensionId(): string | undefined {
    return DIM;
  }
  lookAtBlock(block: Vec3): boolean {
    void block;
    this.calls.push("lookAtBlock");
    return true;
  }
  startBreaking(block: Vec3, face: Face): boolean {
    void face;
    this.calls.push("startBreaking");
    const c = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };
    if (dist(this.eye(), c) > 4.5 + 1e-9) this.violations.push(`break out of reach at ${key(block)}`);
    if (!this.world.info(block).isSolid) return false;
    this.breaking = { block: { ...block }, ticks: 0 };
    return true;
  }
  stopBreaking(): void {
    this.stopBreaks++;
    this.breaking = undefined;
  }
  inventory(): InventorySnapshot | undefined {
    return this.inventoryUnreadable ? undefined : this.slots.map((s) => (s ? { ...s } : undefined));
  }
  selectedSlot(): number | undefined {
    return this.selected;
  }
  selectSlot(slot: number): boolean {
    if (slot < 0 || slot > 8) return false;
    this.selected = slot;
    return true;
  }
  swapSlots(a: number, b: number): boolean {
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    return true;
  }
  depositSlot(chest: ChestRef, slot: number): TransferResult {
    this.calls.push("depositSlot");
    const c = this.world.containers.get(key(chest.pos));
    if (!c) return { ok: false, reason: "no_container" };
    if (!this.inContainerReach(chest.pos)) return { ok: false, reason: "out_of_reach" };
    const s = this.slots[slot];
    if (!s) return { ok: true, moved: 0 };
    const left = addInto(c, s);
    const moved = s.amount - left;
    if (left === 0) this.slots[slot] = undefined;
    else s.amount = left;
    return { ok: true, moved };
  }
  withdrawSlot(chest: ChestRef, chestSlot: number, amount: number): TransferResult {
    this.calls.push("withdrawSlot");
    const c = this.world.containers.get(key(chest.pos));
    if (!c) return { ok: false, reason: "no_container" };
    if (!this.inContainerReach(chest.pos)) return { ok: false, reason: "out_of_reach" };
    const s = c[chestSlot];
    if (!s) return { ok: true, moved: 0 };
    const want = Math.min(amount, s.amount);
    const left = addInto(this.slots, { ...s, amount: want });
    const moved = want - left;
    s.amount -= moved;
    if (s.amount <= 0) c[chestSlot] = undefined;
    return { ok: true, moved };
  }
  applyCraft(plan: CraftPlan): boolean {
    this.calls.push(`applyCraft:${plan.recipeId}`);
    for (const e of plan.consume) {
      const s = this.slots[e.slot];
      if (!s || s.typeId !== e.typeId || s.amount < e.amount) return false;
    }
    if (plan.tableAt) {
      if (this.world.typeAt(plan.tableAt) !== "minecraft:crafting_table") return false;
      const c = { x: plan.tableAt.x + 0.5, y: plan.tableAt.y + 0.5, z: plan.tableAt.z + 0.5 };
      if (dist(this.eye(), c) > 4.5) return false;
    }
    const copy = this.slots.map((s) => (s ? { ...s } : undefined));
    for (const e of plan.consume) {
      const s = copy[e.slot]!;
      s.amount -= e.amount;
      if (s.amount === 0) copy[e.slot] = undefined;
    }
    if (addInto(copy, stack(plan.produce.typeId, plan.produce.amount)) > 0) return false;
    this.slots = copy;
    this.crafted.push(plan.recipeId);
    return true;
  }
  placeFromSlot(slot: number, onBlock: Vec3, face: Face): boolean {
    this.calls.push("placeFromSlot");
    const s = this.slots[slot];
    if (!s || face !== "Up" || !this.world.info(onBlock).isSolid) return false;
    const at = v(onBlock.x, onBlock.y + 1, onBlock.z);
    if (this.world.typeAt(at) !== AIR) return false;
    this.world.set(at, s.typeId);
    s.amount--;
    if (s.amount === 0) this.slots[slot] = undefined;
    return true;
  }
}

export function makeCtx(world: FakeWorld | undefined, body: FakeBody, cfg: Partial<GatherConfig> = {}): ExecutorContext {
  return { body, world: () => world, gather: { ...DEFAULT_GATHER_CONFIG, ...cfg } };
}

export interface RunResult {
  result: StepResult;
  now: number;
  steps: number;
}

/**
 * Pump an executor like the runtime does (step every 4 ticks, world ticks in between) until it returns a
 * terminal result or `maxTicks` pass. `onStep` runs after each step (for progress sampling / mid-run edits).
 */
export function run(
  ex: TaskExecutor,
  body: FakeBody,
  maxTicks = 20_000,
  onStep?: (now: number, r: StepResult) => void,
  start = 0,
): RunResult {
  let now = start;
  let steps = 0;
  while (now - start < maxTicks) {
    const r = ex.step(now);
    steps++;
    onStep?.(now, r);
    if (r.kind !== "running") return { result: r, now, steps };
    for (let i = 0; i < 4; i++) body.tick();
    now += 4;
  }
  return { result: { kind: "running" }, now, steps };
}

/** Flat floor (unbreakable bedrock by default) at y=0 over x,z in [-r, r]; everything above is air. */
export function flatWorld(r = 24, floor = "minecraft:bedrock"): FakeWorld {
  return new FakeWorld().fill(v(-r, 0, -r), v(r, 0, r), floor);
}
