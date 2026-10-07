// Adapter (engine boundary) tests against a mocked @minecraft engine: WorkerBody methods of
// wrapSimulatedPlayer, the WorldPort from createWorldPort, and locateChest / readChest.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vec3 } from "../src/core/types.js";
import type { CraftPlan, WorkerBody } from "../src/game/bots/ports.js";

// ---------- fake engine ----------

const g = vi.hoisted(() => {
  const MAX: Record<string, number> = { "minecraft:wooden_pickaxe": 1, "minecraft:stone_pickaxe": 1, "minecraft:iron_axe": 1 };

  class ItemStack {
    readonly typeId: string;
    readonly maxAmount: number;
    private _amount = 1;
    damage: number | undefined;
    constructor(typeId: string, amount = 1) {
      if (!typeId.includes(":") || typeId.endsWith(":bogus")) throw new Error(`invalid item ${typeId}`);
      this.typeId = typeId;
      this.maxAmount = MAX[typeId] ?? 64;
      this.amount = amount;
      if (this.maxAmount === 1) this.damage = 0;
    }
    get amount() {
      return this._amount;
    }
    set amount(n: number) {
      if (!Number.isInteger(n) || n < 1 || n > this.maxAmount) throw new Error(`bad amount ${n}`);
      this._amount = n;
    }
    clone(): ItemStack {
      const c = new ItemStack(this.typeId, this.amount);
      c.damage = this.damage;
      return c;
    }
    getComponent(id: string) {
      if (id === "durability" && this.damage !== undefined) return { damage: this.damage, maxDurability: 59 };
      return undefined;
    }
  }

  class Container {
    slots: Array<ItemStack | undefined>;
    throwOnSet = false;
    /** transferItem empties the slot even when not everything fits (models a lossy engine). */
    lossyTransfer = false;
    constructor(public size: number) {
      this.slots = new Array(size).fill(undefined);
    }
    private check(slot: number) {
      if (slot < 0 || slot >= this.size) throw new Error("slot out of bounds");
    }
    getItem(slot: number) {
      this.check(slot);
      return this.slots[slot]?.clone();
    }
    setItem(slot: number, s?: ItemStack) {
      this.check(slot);
      if (this.throwOnSet) throw new Error("setItem failed");
      this.slots[slot] = s?.clone();
    }
    swapItems(a: number, b: number, other: Container) {
      this.check(a);
      other.check(b);
      const t = this.slots[a];
      this.slots[a] = other.slots[b];
      other.slots[b] = t;
    }
    addItem(s: ItemStack): ItemStack | undefined {
      let left = s.amount;
      for (let i = 0; i < this.size && left > 0; i++) {
        const cur = this.slots[i];
        if (cur && cur.typeId === s.typeId && cur.amount < cur.maxAmount) {
          const n = Math.min(left, cur.maxAmount - cur.amount);
          cur.amount += n;
          left -= n;
        }
      }
      for (let i = 0; i < this.size && left > 0; i++) {
        if (!this.slots[i]) {
          const n = Math.min(left, s.maxAmount);
          this.slots[i] = new ItemStack(s.typeId, n);
          left -= n;
        }
      }
      if (left === 0) return undefined;
      const r = s.clone();
      r.amount = left;
      return r;
    }
    transferItem(from: number, to: Container): ItemStack | undefined {
      this.check(from);
      const s = this.slots[from];
      if (!s) return undefined;
      const leftover = to.addItem(s);
      this.slots[from] = this.lossyTransfer ? undefined : leftover;
      return leftover?.clone();
    }
    total(typeId: string) {
      return this.slots.reduce((n, s) => n + (s && s.typeId === typeId ? s.amount : 0), 0);
    }
  }

  class BlockVolume {
    constructor(
      public from: Vec3,
      public to: Vec3,
    ) {}
  }

  interface FakeBlock {
    typeId: string;
    location: Vec3;
    container?: Container;
  }

  const key = (v: Vec3) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;

  class Dimension {
    blocks = new Map<string, FakeBlock>();
    unloaded = new Set<string>();
    entities: Array<{ id: string; type: string; location: Vec3; stack?: ItemStack; broken?: boolean }> = [];
    getBlocksCalls: Array<{ from: Vec3; to: Vec3; includeTypes?: string[]; allowUnloaded?: boolean }> = [];
    getBlocksThrows = false;
    getEntitiesThrows = false;
    constructor(public id: string) {}
    put(pos: Vec3, typeId: string, container?: Container) {
      this.blocks.set(key(pos), { typeId, location: { ...pos }, container });
    }
    getBlock(pos: Vec3) {
      if (this.unloaded.has(key(pos))) throw new Error("LocationInUnloadedChunkError");
      const b = this.blocks.get(key(pos));
      const typeId = b?.typeId ?? "minecraft:air";
      const loc = b?.location ?? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      return {
        typeId,
        location: loc,
        isAir: typeId === "minecraft:air",
        isSolid: typeId !== "minecraft:air" && typeId !== "minecraft:water",
        isLiquid: typeId === "minecraft:water",
        getComponent: (id: string) => (id === "inventory" && b?.container ? { container: b.container } : undefined),
      };
    }
    getBlocks(volume: BlockVolume, opts: { includeTypes?: string[] }, allowUnloaded?: boolean) {
      this.getBlocksCalls.push({ from: volume.from, to: volume.to, includeTypes: opts.includeTypes, allowUnloaded });
      if (this.getBlocksThrows) throw new Error("getBlocks failed");
      const lo = { x: Math.min(volume.from.x, volume.to.x), y: Math.min(volume.from.y, volume.to.y), z: Math.min(volume.from.z, volume.to.z) };
      const hi = { x: Math.max(volume.from.x, volume.to.x), y: Math.max(volume.from.y, volume.to.y), z: Math.max(volume.from.z, volume.to.z) };
      const hits = [...this.blocks.values()]
        .filter((b) => (opts.includeTypes ?? []).includes(b.typeId))
        .map((b) => b.location)
        .filter((l) => l.x >= lo.x && l.x <= hi.x && l.y >= lo.y && l.y <= hi.y && l.z >= lo.z && l.z <= hi.z);
      return { getBlockLocationIterator: () => hits.map((h) => ({ ...h }))[Symbol.iterator]() };
    }
    getEntities(opts: { type?: string; location?: Vec3; maxDistance?: number }) {
      if (this.getEntitiesThrows) throw new Error("getEntities failed");
      return this.entities
        .filter((e) => !opts.type || e.type === opts.type)
        .filter((e) => {
          if (!opts.location || opts.maxDistance === undefined) return true;
          const d = Math.hypot(e.location.x - opts.location.x, e.location.y - opts.location.y, e.location.z - opts.location.z);
          return d <= opts.maxDistance;
        })
        .map((e) => ({
          id: e.id,
          location: e.location,
          getComponent: (id: string) => {
            if (id !== "item") return undefined;
            if (e.broken) throw new Error("entity gone");
            return { itemStack: e.stack };
          },
        }));
    }
  }

  const state = {
    dims: new Map<string, Dimension>(),
    getDimensionThrows: false,
    knownBlockTypes: new Set<string>(),
    blockTypeGets: [] as string[],
    ItemStack,
    Container,
    Dimension,
    BlockVolume,
  };
  return state;
});

vi.mock("@minecraft/server", () => ({
  GameMode: { Survival: "Survival" },
  Direction: { Up: "Up", Down: "Down", North: "North", South: "South", East: "East", West: "West" },
  ItemStack: g.ItemStack,
  BlockVolume: g.BlockVolume,
  BlockTypes: {
    get: (id: string) => {
      g.blockTypeGets.push(id);
      return g.knownBlockTypes.has(id) ? { id } : undefined;
    },
  },
  world: {
    getDimension: (id: string) => {
      if (g.getDimensionThrows) throw new Error("no such dimension");
      const d = g.dims.get(id);
      if (!d) throw new Error(`unknown dimension ${id}`);
      return d;
    },
  },
}));

vi.mock("@minecraft/server-gametest", () => ({
  LookDuration: { Continuous: "Continuous", Instant: "Instant", UntilMove: "UntilMove" },
  spawnSimulatedPlayer: () => {
    throw new Error("not used");
  },
}));

const { wrapSimulatedPlayer } = await import("../src/game/adapter/index.js");
const world = await import("../src/game/adapter/world.js");

// ---------- harness ----------

type ItemStackT = InstanceType<typeof g.ItemStack>;
type ContainerT = InstanceType<typeof g.Container>;
type DimensionT = InstanceType<typeof g.Dimension>;

const OW = "minecraft:overworld";
const CHEST_POS = { x: 10, y: 64, z: 10 };
const CHEST = { dimensionId: OW, pos: CHEST_POS };
const stack = (typeId: string, n = 1): ItemStackT => new g.ItemStack(`minecraft:${typeId}`, n);

class FakeSim {
  id = "e1";
  name = "Bot-1";
  isValid = true;
  isOnGround = true;
  location: Vec3 = { x: 11.5, y: 64, z: 10.5 }; // 1 block east of the chest center
  selectedSlotIndex = 0;
  inv = new g.Container(36);
  calls: Array<[string, ...unknown[]]> = [];
  throwing = new Set<string>();
  breakResult = true;
  useResult = true;
  viewHit: { block: ReturnType<DimensionT["getBlock"]> } | undefined;
  constructor(public dimension: DimensionT) {}
  private maybeThrow(m: string) {
    if (this.throwing.has(m)) throw new Error(`${m} threw`);
  }
  getComponent(id: string) {
    this.maybeThrow("getComponent");
    return id === "inventory" ? { container: this.inv } : undefined;
  }
  lookAtBlock(pos: Vec3, dur: unknown) {
    this.maybeThrow("lookAtBlock");
    this.calls.push(["lookAtBlock", pos, dur]);
  }
  breakBlock(pos: Vec3, dir: unknown) {
    this.maybeThrow("breakBlock");
    this.calls.push(["breakBlock", pos, dir]);
    return this.breakResult;
  }
  stopBreakingBlock() {
    this.maybeThrow("stopBreakingBlock");
    this.calls.push(["stopBreakingBlock"]);
  }
  useItemInSlotOnBlock(slot: number, pos: Vec3, dir: unknown) {
    this.maybeThrow("useItemInSlotOnBlock");
    this.calls.push(["useItemInSlotOnBlock", slot, pos, dir]);
    return this.useResult;
  }
  getBlockFromViewDirection(opts: { maxDistance?: number }) {
    this.maybeThrow("getBlockFromViewDirection");
    this.calls.push(["getBlockFromViewDirection", opts]);
    return this.viewHit;
  }
}

let dim: DimensionT;
let sim: FakeSim;
let body: WorkerBody;
let chest: ContainerT;

function wrap(s: FakeSim): WorkerBody {
  return wrapSimulatedPlayer(s as unknown as Parameters<typeof wrapSimulatedPlayer>[0], s.name);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  g.dims.clear();
  g.getDimensionThrows = false;
  g.knownBlockTypes = new Set([
    "minecraft:chest",
    "minecraft:trapped_chest",
    "minecraft:barrel",
    "minecraft:oak_log",
    "minecraft:stone",
    "minecraft:crafting_table",
  ]);
  g.blockTypeGets = [];
  world.resetBlockTypeCache();
  dim = new g.Dimension(OW);
  g.dims.set(OW, dim);
  chest = new g.Container(27);
  dim.put(CHEST_POS, "minecraft:chest", chest);
  sim = new FakeSim(dim);
  body = wrap(sim);
});

// ---------- WorkerBody ----------

describe("WorkerBody: identity, looking, breaking", () => {
  it("dimensionId reads Entity.dimension.id; throws -> undefined", () => {
    expect(body.dimensionId()).toBe(OW);
    Object.defineProperty(sim, "dimension", {
      get() {
        throw new Error("invalid entity");
      },
    });
    expect(body.dimensionId()).toBeUndefined();
  });

  it("lookAtBlock uses LookDuration.UntilMove on the integer block; throws -> false", () => {
    expect(body.lookAtBlock({ x: 12.7, y: 64.2, z: 9.1 })).toBe(true);
    expect(sim.calls).toEqual([["lookAtBlock", { x: 12, y: 64, z: 9 }, "UntilMove"]]);
    sim.throwing.add("lookAtBlock");
    expect(body.lookAtBlock({ x: 12, y: 64, z: 9 })).toBe(false);
  });

  it("startBreaking maps Face -> Direction and returns the API boolean", () => {
    expect(body.startBreaking({ x: 12, y: 65, z: 10 }, "West")).toBe(true);
    expect(sim.calls).toEqual([["breakBlock", { x: 12, y: 65, z: 10 }, "West"]]);
    sim.breakResult = false;
    expect(body.startBreaking({ x: 12, y: 65, z: 10 }, "Up")).toBe(false);
    expect(sim.calls[1]).toEqual(["breakBlock", { x: 12, y: 65, z: 10 }, "Up"]);
  });

  it("startBreaking refuses blocks out of reach without calling the engine; throws -> false", () => {
    expect(body.startBreaking({ x: 20, y: 64, z: 10 }, "West")).toBe(false);
    expect(sim.calls).toEqual([]);
    sim.throwing.add("breakBlock");
    expect(body.startBreaking({ x: 12, y: 64, z: 10 }, "West")).toBe(false);
  });

  it("stopBreaking calls stopBreakingBlock, skips invalid entities, swallows throws", () => {
    body.stopBreaking();
    expect(sim.calls).toEqual([["stopBreakingBlock"]]);
    sim.throwing.add("stopBreakingBlock");
    expect(() => body.stopBreaking()).not.toThrow();
    sim.isValid = false;
    sim.throwing.clear();
    body.stopBreaking();
    expect(sim.calls).toHaveLength(1);
  });
});

describe("WorkerBody: inventory and slots", () => {
  it("inventory snapshots every slot with durability for tools", () => {
    sim.inv.setItem(0, stack("oak_log", 5));
    const pick = stack("wooden_pickaxe");
    pick.damage = 7;
    sim.inv.setItem(3, pick);
    const inv = body.inventory()!;
    expect(inv).toHaveLength(36);
    expect(inv[0]).toEqual({ typeId: "minecraft:oak_log", amount: 5, maxAmount: 64 });
    expect(inv[3]).toEqual({ typeId: "minecraft:wooden_pickaxe", amount: 1, maxAmount: 1, durability: { damage: 7, max: 59 } });
    expect(inv[1]).toBeUndefined();
  });

  it("inventory -> undefined when the component throws", () => {
    sim.throwing.add("getComponent");
    expect(body.inventory()).toBeUndefined();
  });

  it("selectedSlot / selectSlot (hotbar 0..8 only)", () => {
    sim.selectedSlotIndex = 4;
    expect(body.selectedSlot()).toBe(4);
    expect(body.selectSlot(8)).toBe(true);
    expect(sim.selectedSlotIndex).toBe(8);
    expect(body.selectSlot(9)).toBe(false);
    expect(body.selectSlot(-1)).toBe(false);
    expect(body.selectSlot(1.5)).toBe(false);
    expect(sim.selectedSlotIndex).toBe(8);
  });

  it("swapSlots swaps within the bot's own container; bad slots -> false", () => {
    sim.inv.setItem(20, stack("stone_pickaxe"));
    expect(body.swapSlots(2, 20)).toBe(true);
    expect(sim.inv.slots[2]?.typeId).toBe("minecraft:stone_pickaxe");
    expect(sim.inv.slots[20]).toBeUndefined();
    expect(body.swapSlots(2, 36)).toBe(false);
    expect(sim.inv.slots[2]?.typeId).toBe("minecraft:stone_pickaxe");
  });
});

describe("WorkerBody: container transfer", () => {
  it("depositSlot moves the whole stack into the chest", () => {
    sim.inv.setItem(4, stack("oak_log", 12));
    expect(body.depositSlot(CHEST, 4)).toEqual({ ok: true, moved: 12 });
    expect(sim.inv.slots[4]).toBeUndefined();
    expect(chest.total("minecraft:oak_log")).toBe(12);
  });

  it("depositSlot into a nearly full chest: moved = before - leftover, leftover stays with the bot", () => {
    for (let i = 0; i < 27; i++) chest.setItem(i, stack("dirt", 64));
    chest.setItem(26, stack("oak_log", 60));
    sim.inv.setItem(0, stack("oak_log", 10));
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: true, moved: 4 });
    expect(sim.inv.slots[0]?.amount).toBe(6);
    expect(chest.total("minecraft:oak_log")).toBe(64);
  });

  it("depositSlot conserves items when the engine drops the leftover from the slot", () => {
    for (let i = 0; i < 27; i++) chest.setItem(i, stack("dirt", 64));
    sim.inv.lossyTransfer = true;
    sim.inv.setItem(0, stack("oak_log", 10));
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: true, moved: 0 });
    expect(sim.inv.slots[0]?.amount).toBe(10);
  });

  it("depositSlot of an empty slot moves 0", () => {
    expect(body.depositSlot(CHEST, 7)).toEqual({ ok: true, moved: 0 });
  });

  it("refuses out of reach: horizontal > 2.5 or |dy| > 2", () => {
    sim.inv.setItem(0, stack("oak_log", 3));
    sim.location = { x: 13.1, y: 64, z: 10.5 }; // 2.6 horizontal
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "out_of_reach" });
    sim.location = { x: 12.9, y: 64, z: 10.5 }; // 2.4
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: true, moved: 3 });
    sim.inv.setItem(0, stack("oak_log", 3));
    sim.location = { x: 10.5, y: 66.6, z: 11.5 }; // dy 2.1
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "out_of_reach" });
    expect(body.withdrawSlot(CHEST, 0, 1)).toEqual({ ok: false, reason: "out_of_reach" });
  });

  it("no_container: not a container block, no inventory, other dimension, unloaded", () => {
    sim.inv.setItem(0, stack("oak_log", 3));
    dim.put(CHEST_POS, "minecraft:furnace", new g.Container(3));
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "no_container" });
    dim.put(CHEST_POS, "minecraft:stone");
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "no_container" });
    dim.put(CHEST_POS, "minecraft:chest", chest);
    expect(body.depositSlot({ dimensionId: "minecraft:nether", pos: CHEST_POS }, 0)).toEqual({ ok: false, reason: "no_container" });
    dim.unloaded.add("10,64,10");
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "no_container" });
    expect(sim.inv.slots[0]?.amount).toBe(3);
  });

  it("errors: bad slot, unreadable position / inventory", () => {
    expect(body.depositSlot(CHEST, 99)).toEqual({ ok: false, reason: "error" });
    sim.throwing.add("getComponent");
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "error" });
    Object.defineProperty(sim, "location", {
      get() {
        throw new Error("invalid");
      },
    });
    expect(body.depositSlot(CHEST, 0)).toEqual({ ok: false, reason: "error" });
  });

  it("withdrawSlot of a whole stack uses the chest's transfer", () => {
    chest.setItem(5, stack("stone_pickaxe"));
    expect(body.withdrawSlot(CHEST, 5, 1)).toEqual({ ok: true, moved: 1 });
    expect(chest.slots[5]).toBeUndefined();
    expect(sim.inv.slots[0]?.typeId).toBe("minecraft:stone_pickaxe");
  });

  it("withdrawSlot of part of a stack conserves the total", () => {
    chest.setItem(2, stack("oak_log", 20));
    sim.inv.setItem(0, stack("oak_log", 62));
    expect(body.withdrawSlot(CHEST, 2, 3)).toEqual({ ok: true, moved: 3 });
    expect(chest.slots[2]?.amount).toBe(17);
    expect(sim.inv.total("minecraft:oak_log")).toBe(65);
    expect(chest.total("minecraft:oak_log") + sim.inv.total("minecraft:oak_log")).toBe(82);
  });

  it("withdrawSlot into a full inventory returns what didn't fit to the chest", () => {
    for (let i = 0; i < 36; i++) sim.inv.setItem(i, stack("dirt", 64));
    sim.inv.setItem(9, stack("oak_log", 63));
    chest.setItem(0, stack("oak_log", 10));
    expect(body.withdrawSlot(CHEST, 0, 4)).toEqual({ ok: true, moved: 1 });
    expect(chest.slots[0]?.amount).toBe(9);
    expect(sim.inv.slots[9]?.amount).toBe(64);
  });

  it("withdrawSlot: empty chest slot / amount 0 -> moved 0; bad chest slot -> error", () => {
    expect(body.withdrawSlot(CHEST, 3, 4)).toEqual({ ok: true, moved: 0 });
    chest.setItem(3, stack("oak_log", 4));
    expect(body.withdrawSlot(CHEST, 3, 0)).toEqual({ ok: true, moved: 0 });
    expect(body.withdrawSlot(CHEST, 27, 1)).toEqual({ ok: false, reason: "error" });
    expect(chest.slots[3]?.amount).toBe(4);
  });
});

describe("WorkerBody: applyCraft", () => {
  const planks = (slot: number, n = 1): CraftPlan => ({
    recipeId: "oak_planks",
    consume: [{ slot, typeId: "minecraft:oak_log", amount: n }],
    produce: { typeId: "minecraft:oak_planks", amount: 4 },
  });
  const pickaxe = (tableAt?: Vec3): CraftPlan => ({
    recipeId: "wooden_pickaxe",
    consume: [
      { slot: 0, typeId: "minecraft:oak_planks", amount: 3 },
      { slot: 1, typeId: "minecraft:stick", amount: 2 },
    ],
    produce: { typeId: "minecraft:wooden_pickaxe", amount: 1 },
    tableAt,
  });

  it("consumes the exact ingredients and adds the output", () => {
    sim.inv.setItem(0, stack("oak_log", 3));
    expect(body.applyCraft(planks(0))).toBe(true);
    expect(sim.inv.slots[0]?.amount).toBe(2);
    expect(sim.inv.total("minecraft:oak_planks")).toBe(4);
  });

  it("missing / wrong-type / short ingredients -> false, nothing changes", () => {
    expect(body.applyCraft(planks(0))).toBe(false);
    sim.inv.setItem(0, stack("birch_log", 3));
    expect(body.applyCraft(planks(0))).toBe(false);
    sim.inv.setItem(0, stack("planks_wrong", 1));
    expect(body.applyCraft({ ...planks(0), consume: [{ slot: 0, typeId: "minecraft:oak_log", amount: 1 }, { slot: 0, typeId: "minecraft:oak_log", amount: 0 }] })).toBe(false);
    expect(sim.inv.slots[0]?.typeId).toBe("minecraft:planks_wrong");
    expect(sim.inv.total("minecraft:oak_planks")).toBe(0);
  });

  it("a slot listed twice can't be over-consumed", () => {
    sim.inv.setItem(0, stack("oak_planks", 2));
    sim.inv.setItem(1, stack("stick", 2));
    sim.inv.setItem(2, stack("oak_planks", 1));
    sim.dimension.put({ x: 12, y: 64, z: 11 }, "minecraft:crafting_table");
    const plan = (second: number): CraftPlan => ({
      ...pickaxe({ x: 12, y: 64, z: 11 }),
      consume: [
        { slot: 0, typeId: "minecraft:oak_planks", amount: 2 },
        { slot: second, typeId: "minecraft:oak_planks", amount: 1 },
        { slot: 1, typeId: "minecraft:stick", amount: 2 },
      ],
    });
    expect(body.applyCraft(plan(0))).toBe(false); // slot 0 would give 3 of its 2
    expect(sim.inv.slots[0]?.amount).toBe(2);
    expect(body.applyCraft(plan(2))).toBe(true); // split across slots is fine
    expect(sim.inv.total("minecraft:oak_planks")).toBe(0);
    expect(sim.inv.total("minecraft:wooden_pickaxe")).toBe(1);
  });

  it("plans that don't match the recipe are refused (no free items)", () => {
    sim.inv.setItem(0, stack("oak_log", 3));
    expect(body.applyCraft({ ...planks(0), produce: { typeId: "minecraft:oak_planks", amount: 8 } })).toBe(false);
    expect(body.applyCraft({ ...planks(0), recipeId: "nope", produce: { typeId: "minecraft:diamond", amount: 1 } })).toBe(false);
    expect(body.applyCraft({ ...planks(0), consume: [] })).toBe(false);
    expect(sim.inv.slots[0]?.amount).toBe(3);
    // unknown recipeId but the output identifies a known recipe: accepted
    expect(body.applyCraft({ ...planks(0), recipeId: "planks" })).toBe(true);
  });

  it("output must fit: full inventory -> false; a slot the consumption empties counts as room", () => {
    for (let i = 0; i < 36; i++) sim.inv.setItem(i, stack("dirt", 64));
    sim.inv.setItem(0, stack("oak_log", 2));
    expect(body.applyCraft(planks(0))).toBe(false);
    expect(sim.inv.slots[0]?.amount).toBe(2);
    sim.inv.setItem(0, stack("oak_log", 1));
    expect(body.applyCraft(planks(0))).toBe(true);
    expect(sim.inv.slots[0]).toEqual(expect.objectContaining({ typeId: "minecraft:oak_planks", amount: 4 }));
  });

  it("output merges into a stack with room", () => {
    for (let i = 0; i < 36; i++) sim.inv.setItem(i, stack("dirt", 64));
    sim.inv.setItem(0, stack("oak_log", 2));
    sim.inv.setItem(1, stack("oak_planks", 60));
    expect(body.applyCraft(planks(0))).toBe(true);
    expect(sim.inv.slots[1]?.amount).toBe(64);
  });

  it("3x3 recipes need a crafting table within 4.5 of the eyes", () => {
    sim.inv.setItem(0, stack("oak_planks", 3));
    sim.inv.setItem(1, stack("stick", 2));
    expect(body.applyCraft(pickaxe())).toBe(false); // no tableAt
    expect(body.applyCraft(pickaxe({ x: 12, y: 64, z: 11 }))).toBe(false); // air, not a table
    dim.put({ x: 18, y: 64, z: 10 }, "minecraft:crafting_table");
    expect(body.applyCraft(pickaxe({ x: 18, y: 64, z: 10 }))).toBe(false); // too far
    expect(sim.inv.slots[0]?.amount).toBe(3);
    dim.put({ x: 12, y: 64, z: 11 }, "minecraft:crafting_table");
    expect(body.applyCraft(pickaxe({ x: 12, y: 64, z: 11 }))).toBe(true);
    expect(sim.inv.slots[0]?.typeId).toBe("minecraft:wooden_pickaxe");
    expect(sim.inv.slots[1]).toBeUndefined();
  });

  it("is atomic: a throw while consuming restores the inventory", () => {
    sim.inv.setItem(0, stack("oak_log", 3));
    const realSet = sim.inv.setItem.bind(sim.inv);
    let calls = 0;
    sim.inv.setItem = (slot: number, s?: ItemStackT) => {
      if (calls++ === 0) throw new Error("setItem failed");
      realSet(slot, s);
    };
    expect(body.applyCraft(planks(0))).toBe(false);
    expect(sim.inv.slots[0]?.amount).toBe(3);
    expect(sim.inv.total("minecraft:oak_planks")).toBe(0);
  });
});

describe("WorkerBody: placeFromSlot", () => {
  it("uses useItemInSlotOnBlock with the face direction", () => {
    sim.inv.setItem(2, stack("crafting_table"));
    expect(body.placeFromSlot(2, { x: 12, y: 63, z: 11 }, "Up")).toBe(true);
    expect(sim.calls).toEqual([["useItemInSlotOnBlock", 2, { x: 12, y: 63, z: 11 }, "Up"]]);
    sim.useResult = false;
    expect(body.placeFromSlot(2, { x: 12, y: 63, z: 11 }, "North")).toBe(false);
    expect(sim.calls[1]?.[3]).toBe("North");
  });

  it("empty slot, out of reach, or a throw -> false", () => {
    expect(body.placeFromSlot(2, { x: 12, y: 63, z: 11 }, "Up")).toBe(false);
    sim.inv.setItem(2, stack("crafting_table"));
    expect(body.placeFromSlot(2, { x: 30, y: 63, z: 11 }, "Up")).toBe(false);
    expect(sim.calls).toEqual([]);
    sim.throwing.add("useItemInSlotOnBlock");
    expect(body.placeFromSlot(2, { x: 12, y: 63, z: 11 }, "Up")).toBe(false);
  });
});

// ---------- WorldPort ----------

describe("createWorldPort", () => {
  it("undefined when the dimension can't be resolved", () => {
    expect(world.createWorldPort("minecraft:nowhere")).toBeUndefined();
    expect(world.createWorldPort(OW)?.dimensionId).toBe(OW);
  });

  it("blockAt returns plain block info; unloaded -> undefined", () => {
    const w = world.createWorldPort(OW)!;
    dim.put({ x: 1, y: 2, z: 3 }, "minecraft:water");
    expect(w.blockAt({ x: 1.9, y: 2.2, z: 3.5 })).toEqual({ typeId: "minecraft:water", isAir: false, isSolid: false, isLiquid: true });
    expect(w.blockAt({ x: 0, y: 0, z: 0 })).toEqual({ typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false });
    dim.unloaded.add("5,5,5");
    expect(w.blockAt({ x: 5, y: 5, z: 5 })).toBeUndefined();
  });

  it("findBlocks filters unknown type ids (cached), allows unloaded chunks, returns positions", () => {
    const w = world.createWorldPort(OW)!;
    dim.put({ x: 1, y: 65, z: 1 }, "minecraft:oak_log");
    dim.put({ x: 2, y: 66, z: 1 }, "minecraft:oak_log");
    dim.put({ x: 40, y: 65, z: 1 }, "minecraft:oak_log");
    const box = { min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 70, z: 5 } };
    const found = w.findBlocks(box, ["minecraft:oak_log", "minecraft:pale_oak_log"])!;
    expect(found.sort((a, b) => a.x - b.x)).toEqual([
      { x: 1, y: 65, z: 1 },
      { x: 2, y: 66, z: 1 },
    ]);
    expect(dim.getBlocksCalls[0]).toEqual({ from: box.min, to: box.max, includeTypes: ["minecraft:oak_log"], allowUnloaded: true });
    w.findBlocks(box, ["minecraft:oak_log", "minecraft:pale_oak_log"]);
    expect(g.blockTypeGets.filter((id) => id === "minecraft:pale_oak_log")).toHaveLength(1);
  });

  it("findBlocks: only unknown types -> [] without querying; engine throw -> undefined", () => {
    const w = world.createWorldPort(OW)!;
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    expect(w.findBlocks(box, ["minecraft:unobtainium"])).toEqual([]);
    expect(dim.getBlocksCalls).toHaveLength(0);
    dim.getBlocksThrows = true;
    expect(w.findBlocks(box, ["minecraft:stone"])).toBeUndefined();
  });

  it("itemsNear queries minecraft:item entities within radius, filters typeIds, skips broken entities", () => {
    const w = world.createWorldPort(OW)!;
    dim.entities.push(
      { id: "i1", type: "minecraft:item", location: { x: 1, y: 64, z: 1 }, stack: stack("oak_log", 2) },
      { id: "i2", type: "minecraft:item", location: { x: 2, y: 64, z: 1 }, stack: stack("apple", 1) },
      { id: "i3", type: "minecraft:item", location: { x: 9, y: 64, z: 1 }, stack: stack("oak_log", 1) },
      { id: "z1", type: "minecraft:zombie", location: { x: 1, y: 64, z: 1 } },
      { id: "i4", type: "minecraft:item", location: { x: 1, y: 64, z: 2 }, broken: true },
    );
    expect(w.itemsNear({ x: 1, y: 64, z: 1 }, 4, ["minecraft:oak_log"])).toEqual([
      { id: "i1", typeId: "minecraft:oak_log", amount: 2, pos: { x: 1, y: 64, z: 1 } },
    ]);
    expect(w.itemsNear({ x: 1, y: 64, z: 1 }, 4).map((e) => e.id)).toEqual(["i1", "i2"]);
    dim.getEntitiesThrows = true;
    expect(w.itemsNear({ x: 1, y: 64, z: 1 }, 4)).toEqual([]);
  });

  it("containerAt snapshots a container block; not a container -> undefined", () => {
    const w = world.createWorldPort(OW)!;
    chest.setItem(1, stack("cobblestone", 9));
    const snap = w.containerAt(CHEST_POS)!;
    expect(snap).toHaveLength(27);
    expect(snap[1]).toEqual({ typeId: "minecraft:cobblestone", amount: 9, maxAmount: 64 });
    expect(w.containerAt({ x: 0, y: 0, z: 0 })).toBeUndefined();
  });
});

// ---------- chest effects ----------

describe("locateChest", () => {
  const player = () => sim as unknown as Parameters<typeof world.locateChest>[0];

  it("uses the block the player looks at (max distance 6)", () => {
    const far = { x: 30, y: 64, z: 30 };
    dim.put(far, "minecraft:barrel", new g.Container(27));
    sim.viewHit = { block: dim.getBlock(far) };
    expect(world.locateChest(player(), { x: 11, y: 64, z: 10 })).toEqual({ ok: true, chest: { dimensionId: OW, pos: far } });
    expect(sim.calls).toEqual([["getBlockFromViewDirection", { maxDistance: 6 }]]);
  });

  it("falls back to the container nearest to `near` when the view hit isn't a container", () => {
    dim.put({ x: 14, y: 64, z: 10 }, "minecraft:trapped_chest", new g.Container(27));
    sim.viewHit = { block: dim.getBlock({ x: 0, y: 0, z: 0 }) };
    expect(world.locateChest(player(), { x: 13.2, y: 64, z: 10.5 })).toEqual({
      ok: true,
      chest: { dimensionId: OW, pos: { x: 14, y: 64, z: 10 } },
    });
    sim.throwing.add("getBlockFromViewDirection");
    expect(world.locateChest(player(), { x: 10.5, y: 64, z: 10.5 })).toEqual({ ok: true, chest: CHEST });
  });

  it("ignores containers beyond the radius -> none_found", () => {
    expect(world.locateChest(player(), { x: 20, y: 64, z: 10 })).toEqual({ ok: false, reason: "none_found" });
  });

  it("without a player searches the fallback dimension; no dimension -> no_player", () => {
    expect(world.locateChest(undefined, { x: 11, y: 64, z: 11 })).toEqual({ ok: true, chest: CHEST });
    g.getDimensionThrows = true;
    expect(world.locateChest(undefined, { x: 11, y: 64, z: 11 })).toEqual({ ok: false, reason: "no_player" });
  });

  it("engine failure -> error", () => {
    dim.getBlocksThrows = true;
    expect(world.locateChest(undefined, { x: 11, y: 64, z: 11 })).toEqual({ ok: false, reason: "error" });
  });
});

describe("readChest", () => {
  it("aggregates per typeId, amount desc then typeId asc", () => {
    chest.setItem(0, stack("oak_log", 10));
    chest.setItem(4, stack("cobblestone", 5));
    chest.setItem(7, stack("oak_log", 13));
    chest.setItem(9, stack("birch_log", 5));
    expect(world.readChest(CHEST)).toEqual([
      { typeId: "minecraft:oak_log", amount: 23 },
      { typeId: "minecraft:birch_log", amount: 5 },
      { typeId: "minecraft:cobblestone", amount: 5 },
    ]);
  });

  it("[] when empty; undefined when gone, unloaded or the dimension is unknown", () => {
    expect(world.readChest(CHEST)).toEqual([]);
    dim.unloaded.add("10,64,10");
    expect(world.readChest(CHEST)).toBeUndefined();
    dim.unloaded.clear();
    dim.put(CHEST_POS, "minecraft:air");
    expect(world.readChest(CHEST)).toBeUndefined();
    expect(world.readChest({ dimensionId: "minecraft:nowhere", pos: CHEST_POS })).toBeUndefined();
  });
});
