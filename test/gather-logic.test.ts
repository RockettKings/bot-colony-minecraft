import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  aggregate,
  bestToolSlot,
  blockCenter,
  blockOf,
  breakTimeoutTicks,
  countItems,
  estimateBreakTicks,
  eyeDistance,
  faceToward,
  freeSlots,
  horizontalDistance,
  inBreakReach,
  inContainerReach,
  isExposed,
  isPassable,
  isStandable,
  planHotbar,
  posKey,
  rankCandidates,
  scanBox,
  scanSlices,
  shouldDeposit,
  slotsWith,
  standCells,
  type BlockProbe,
} from "../src/game/bots/gather-logic.js";
import { DEFAULT_GATHER_CONFIG, type GatherConfig } from "../src/game/bots/executor.js";
import type { BlockInfo, InventorySnapshot, ItemStackView } from "../src/game/bots/ports.js";
import { RESOURCES, toolInfo } from "../src/core/items.js";
import type { Vec3 } from "../src/core/types.js";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const cfg = (o: Partial<GatherConfig> = {}): GatherConfig => ({ ...DEFAULT_GATHER_CONFIG, ...o });

const AIR: BlockInfo = { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false };
const STONE: BlockInfo = { typeId: "minecraft:stone", isAir: false, isSolid: true, isLiquid: false };
const WATER: BlockInfo = { typeId: "minecraft:water", isAir: false, isSolid: false, isLiquid: true };
const FLOWER: BlockInfo = { typeId: "minecraft:poppy", isAir: false, isSolid: false, isLiquid: false };
const LOG: BlockInfo = { typeId: "minecraft:oak_log", isAir: false, isSolid: true, isLiquid: false };

/** Voxel probe: explicit blocks; y <= floorY is stone, above is air; positions in `unloaded` -> undefined. */
function world(blocks: Record<string, BlockInfo> = {}, floorY = 0, unloaded: string[] = []): BlockProbe {
  return (p) => {
    const k = posKey(p);
    if (unloaded.includes(k)) return undefined;
    if (k in blocks) return blocks[k];
    return p.y <= floorY ? STONE : AIR;
  };
}

const item = (typeId: string, amount = 1, maxAmount = 64, durability?: { damage: number; max: number }): ItemStackView => ({
  typeId: `minecraft:${typeId}`,
  amount,
  maxAmount,
  ...(durability ? { durability } : {}),
});
function inv(entries: Record<number, ItemStackView>, size = 36): InventorySnapshot {
  return Array.from({ length: size }, (_, i) => entries[i]);
}

describe("geometry", () => {
  it("blockOf floors, including negatives", () => {
    expect(blockOf(v(1.9, -0.1, -3.5))).toEqual(v(1, -1, -4));
    expect(blockOf(v(2, 64, 0))).toEqual(v(2, 64, 0));
  });
  it("blockCenter / posKey", () => {
    expect(blockCenter(v(1, -2, 3))).toEqual(v(1.5, -1.5, 3.5));
    expect(posKey(v(1, -2, 3))).toBe("1,-2,3");
  });
  it("eyeDistance uses feet + 1.62 to block center", () => {
    expect(EYE_HEIGHT).toBe(1.62);
    expect(eyeDistance(v(0.5, 0, 0.5), v(0, 1, 0))).toBeCloseTo(0.12);
    expect(eyeDistance(v(0.5, 0, 0.5), v(3, 1, 4))).toBeCloseTo(Math.hypot(3, 0.12, 4));
  });
  it("horizontalDistance ignores y", () => {
    expect(horizontalDistance(v(0.5, 100, 0.5), v(3, 0, 4))).toBeCloseTo(5);
  });
  it("inBreakReach is inclusive", () => {
    expect(inBreakReach(v(0.5, 0, 0.5), v(4, 1, 0), 4.5)).toBe(true); // ~4.0
    expect(inBreakReach(v(0.5, 0, 0.5), v(5, 1, 0), 4.5)).toBe(false); // ~5.0
    expect(inBreakReach(v(0.5, -1.62 + 0.5, 0.5), v(4, 0, 0), 4)).toBe(true); // exactly 4
  });
  it("inContainerReach: horizontal <= reach and |dy| <= 2 from chest center", () => {
    const chest = v(10, 64, 10);
    expect(inContainerReach(v(12.5, 64, 10.5), chest, 2.5)).toBe(true); // h = 2
    expect(inContainerReach(v(13.5, 64, 10.5), chest, 2.5)).toBe(false); // h = 3
    expect(inContainerReach(v(10.5, 66.5, 12.5), chest, 2.5)).toBe(true); // dy = 2
    expect(inContainerReach(v(10.5, 66.6, 12.5), chest, 2.5)).toBe(false);
    expect(inContainerReach(v(10.5, 62.5, 11.5), chest, 2.5)).toBe(true); // dy = -2
  });
  it("faceToward picks the dominant axis with sign", () => {
    const b = v(0, 0, 0); // center .5,.5,.5
    expect(faceToward(b, v(0.5, 3, 0.5))).toBe("Up");
    expect(faceToward(b, v(0.5, -3, 0.5))).toBe("Down");
    expect(faceToward(b, v(3, 0.5, 0.5))).toBe("East");
    expect(faceToward(b, v(-3, 0.5, 0.5))).toBe("West");
    expect(faceToward(b, v(0.5, 0.5, 3))).toBe("South");
    expect(faceToward(b, v(0.5, 0.5, -3))).toBe("North");
  });
  it("faceToward ties prefer y, then x, then z", () => {
    const b = v(0, 0, 0);
    expect(faceToward(b, v(2.5, 2.5, 2.5))).toBe("Up");
    expect(faceToward(b, v(2.5, -1.5, 0.5))).toBe("Down");
    expect(faceToward(b, v(-1.5, 0.5, 2.5))).toBe("West");
  });
});

describe("scanning", () => {
  it("scanBox is centred on origin's block", () => {
    expect(scanBox(v(10.7, 64.2, -3.1), cfg({ scanRadius: 16, scanHalfHeight: 8 }))).toEqual({
      min: v(-6, 56, -20),
      max: v(26, 72, 12),
    });
  });
  it("scanBox clamps y to the world limits", () => {
    expect(scanBox(v(0, -60, 0), cfg()).min.y).toBe(WORLD_MIN_Y);
    expect(scanBox(v(0, 315, 0), cfg()).max.y).toBe(WORLD_MAX_Y);
  });

  function checkCover(origin: Vec3, c: GatherConfig) {
    const box = scanBox(origin, c);
    const slices = scanSlices(origin, c);
    const ys: number[] = [];
    for (const s of slices) {
      expect(s.min.x).toBe(box.min.x);
      expect(s.max.x).toBe(box.max.x);
      expect(s.min.z).toBe(box.min.z);
      expect(s.max.z).toBe(box.max.z);
      expect(s.max.y - s.min.y + 1).toBeLessThanOrEqual(c.scanLayersPerPump);
      for (let y = s.min.y; y <= s.max.y; y++) ys.push(y);
    }
    const expected = [];
    for (let y = box.min.y; y <= box.max.y; y++) expected.push(y);
    expect([...ys].sort((a, b) => a - b)).toEqual(expected); // disjoint + exact union
    return slices;
  }

  it("scanSlices: origin slice first, then alternating above/below", () => {
    const slices = checkCover(v(0, 64, 0), cfg({ scanHalfHeight: 4, scanLayersPerPump: 2 }));
    expect(slices.map((s) => [s.min.y, s.max.y])).toEqual([
      [64, 65],
      [66, 67],
      [62, 63],
      [68, 68],
      [60, 61],
    ]);
  });
  it("scanSlices covers the box for odd sizes and one layer per pump", () => {
    const s1 = checkCover(v(0, 10, 0), cfg({ scanHalfHeight: 3, scanLayersPerPump: 1 }));
    expect(s1.map((s) => s.min.y)).toEqual([10, 11, 9, 12, 8, 13, 7]);
    checkCover(v(0, 10, 0), cfg({ scanHalfHeight: 5, scanLayersPerPump: 3 }));
    checkCover(v(0, 10, 0), cfg({ scanHalfHeight: 1, scanLayersPerPump: 8 }));
  });
  it("scanSlices near the world floor/ceiling: one side runs out", () => {
    const low = checkCover(v(0, -63, 0), cfg({ scanHalfHeight: 4, scanLayersPerPump: 2 }));
    expect(low[0]!.min.y).toBe(-63);
    const high = checkCover(v(0, 319, 0), cfg({ scanHalfHeight: 4, scanLayersPerPump: 2 }));
    expect(high[0]).toMatchObject({ min: { y: 319 }, max: { y: 319 } });
    // origin outside the world: still covers the clamped box
    checkCover(v(0, -80, 0), cfg({ scanHalfHeight: 20, scanLayersPerPump: 2 }));
  });

  it("isPassable", () => {
    expect(isPassable(AIR)).toBe(true);
    expect(isPassable(FLOWER)).toBe(true);
    expect(isPassable(STONE)).toBe(false);
    expect(isPassable(WATER)).toBe(false);
    expect(isPassable(undefined)).toBe(false);
  });
  it("isStandable needs two passable cells over a solid block", () => {
    const p = world({ "0,2,0": STONE, "2,1,0": WATER, "3,1,0": FLOWER }, 0, ["4,0,0"]);
    expect(isStandable(p, v(1, 1, 0))).toBe(true);
    expect(isStandable(p, v(3, 1, 0))).toBe(true);
    expect(isStandable(p, v(0, 1, 0))).toBe(false); // head blocked
    expect(isStandable(p, v(2, 1, 0))).toBe(false); // water at feet
    expect(isStandable(p, v(1, 2, 0))).toBe(false); // air below
    expect(isStandable(p, v(4, 1, 0))).toBe(false); // floor unloaded
  });
  it("isExposed", () => {
    const p = world({}, 10);
    expect(isExposed(p, v(0, 10, 0))).toBe(true); // top layer
    expect(isExposed(p, v(0, 5, 0))).toBe(false); // buried
    const unloaded = world({}, 10, ["0,11,0"]);
    expect(isExposed(unloaded, v(0, 10, 0))).toBe(false); // only open neighbour unloaded
    const cave = world({ "1,5,0": AIR }, 10);
    expect(isExposed(cave, v(0, 5, 0))).toBe(true);
  });

  describe("standCells", () => {
    it("tree trunk on flat ground: 8 cells around the base, nearest first, never on the block", () => {
      const p = world({ "0,1,0": LOG, "0,2,0": LOG, "0,3,0": LOG });
      const cells = standCells(p, v(0, 1, 0), 4.5);
      expect(cells).toHaveLength(8);
      expect(cells.every((c) => c.y === 1)).toBe(true);
      // cardinal neighbours first (closer than diagonals), ties by posKey
      expect(cells.slice(0, 4).map(posKey)).toEqual(["-1,1,0", "0,1,-1", "0,1,1", "1,1,0"]);
      expect(cells.some((c) => c.x === 0 && c.z === 0)).toBe(false);
    });
    it("block above the head: directly below is allowed (dy <= -2)", () => {
      // log at y=3 floating over open floor: stand at (0,1,0) under it
      const p = world({ "0,3,0": LOG });
      const cells = standCells(p, v(0, 3, 0), 4.5);
      expect(cells[0]).toEqual(v(0, 1, 0));
    });
    it("floor block: standing on it excluded, neighbours on top allowed", () => {
      const p = world({}, 0);
      const cells = standCells(p, v(0, 0, 0), 4.5);
      expect(cells.length).toBe(8);
      expect(cells.every((c) => c.y === 1 && !(c.x === 0 && c.z === 0))).toBe(true);
    });
    it("respects reach and standability", () => {
      const p = world({ "0,1,0": LOG });
      expect(standCells(p, v(0, 1, 0), 0.5)).toEqual([]);
      const walled = world({ "0,5,0": LOG }, 10); // buried in stone
      expect(standCells(walled, v(0, 5, 0), 4.5)).toEqual([]);
    });
    it("returns integer cells", () => {
      const cells = standCells(world({ "0,1,0": LOG }), v(0, 1, 0), 4.5);
      for (const c of cells) expect(blockOf(c)).toEqual(c);
    });
  });

  describe("rankCandidates", () => {
    const origin = v(0.5, 64, 0.5);
    it("sorts by distance from the bot, ties by posKey", () => {
      const found = [v(5, 64, 0), v(2, 64, 0), v(0, 64, 2), v(-3, 64, 0)];
      const r = rankCandidates(found, v(0.5, 64.5, 0.5), origin, cfg(), new Set());
      expect(r.map(posKey)).toEqual(["0,64,2", "2,64,0", "-3,64,0", "5,64,0"]);
    });
    it("excludes blacklisted, out-of-box (per axis, corners kept) and duplicates", () => {
      const found = [v(16, 64, 16), v(17, 64, 0), v(0, 64, -17), v(1, 64, 1), v(1, 64, 1), v(2, 64, 2)];
      const r = rankCandidates(found, origin, origin, cfg({ scanRadius: 16 }), new Set(["2,64,2"]));
      expect(r.map(posKey)).toEqual(["1,64,1", "16,64,16"]);
    });
    it("applies riskCost", () => {
      const found = [v(1, 64, 0), v(5, 64, 0)];
      const r = rankCandidates(found, origin, origin, cfg(), new Set(), (p) => (p.x === 1 ? 100 : 0));
      expect(r.map(posKey)).toEqual(["5,64,0", "1,64,0"]);
    });
    it("empty input", () => {
      expect(rankCandidates([], origin, origin, cfg(), new Set())).toEqual([]);
    });
  });
});

describe("breaking", () => {
  const wooden = toolInfo("minecraft:wooden_pickaxe");
  const stoneAxe = toolInfo("minecraft:stone_axe");
  const ironShovel = toolInfo("minecraft:iron_shovel");
  it("hand on logs: 2 * 1.5 * 20 = 60", () => {
    expect(estimateBreakTicks("minecraft:oak_log", RESOURCES.log, undefined)).toBe(60);
  });
  it("matching tool divides by tier speed", () => {
    expect(estimateBreakTicks("minecraft:oak_log", RESOURCES.log, stoneAxe)).toBe(15);
    expect(estimateBreakTicks("minecraft:stone", RESOURCES.cobblestone, wooden)).toBe(23); // 45/2 = 22.5
    expect(estimateBreakTicks("minecraft:gravel", RESOURCES.gravel, ironShovel)).toBe(3); // 18/6
  });
  it("non-matching tool counts as hand; required tool missing uses factor 5", () => {
    expect(estimateBreakTicks("minecraft:oak_log", RESOURCES.log, wooden)).toBe(60);
    expect(estimateBreakTicks("minecraft:stone", RESOURCES.cobblestone, undefined)).toBe(150);
    expect(estimateBreakTicks("minecraft:stone", RESOURCES.cobblestone, stoneAxe)).toBe(150);
  });
  it("float noise doesn't add a tick; unknown blocks use the default hardness", () => {
    expect(estimateBreakTicks("minecraft:grass_block", RESOURCES.dirt, undefined)).toBe(18); // 0.6*1.5*20
    expect(estimateBreakTicks("minecraft:unknown", RESOURCES.dirt, undefined)).toBe(60);
  });
  it("breakTimeoutTicks = 2 * est + 40", () => {
    expect(breakTimeoutTicks(60)).toBe(160);
    expect(breakTimeoutTicks(0)).toBe(40);
  });
});

describe("inventory", () => {
  const i1 = inv({ 0: item("oak_log", 10), 3: item("birch_log", 5), 4: item("oak_log", 64), 7: item("dirt", 2) });
  it("countItems / slotsWith / freeSlots", () => {
    expect(countItems(i1, RESOURCES.log.yields)).toBe(79);
    expect(countItems(i1, RESOURCES.oak_log.yields)).toBe(74);
    expect(countItems(i1, ["minecraft:sand"])).toBe(0);
    expect(slotsWith(i1, RESOURCES.log.yields)).toEqual([0, 3, 4]);
    expect(slotsWith(i1, [])).toEqual([]);
    expect(freeSlots(i1)).toBe(32);
    expect(freeSlots([])).toBe(0);
  });
  it("aggregate: amount desc then typeId asc", () => {
    const i2 = inv({ 0: item("sand", 3), 1: item("dirt", 3), 2: item("oak_log", 1), 5: item("oak_log", 4) });
    expect(aggregate(i2)).toEqual([
      { typeId: "minecraft:oak_log", amount: 5 },
      { typeId: "minecraft:dirt", amount: 3 },
      { typeId: "minecraft:sand", amount: 3 },
    ]);
    expect(aggregate(inv({}))).toEqual([]);
  });
  describe("shouldDeposit", () => {
    const res = RESOURCES.dirt;
    it("remaining <= 0 or held >= remaining", () => {
      expect(shouldDeposit(inv({}), res, 0, cfg())).toBe(true);
      expect(shouldDeposit(inv({ 0: item("dirt", 5) }), res, 5, cfg())).toBe(true);
      expect(shouldDeposit(inv({ 0: item("dirt", 4) }), res, 5, cfg())).toBe(false);
    });
    it("full inventory: deposit unless a yield stack has room", () => {
      const full = (last: ItemStackView | undefined) =>
        Array.from({ length: 36 }, (_, i) => (i === 35 ? last : item("cobblestone", 64)));
      expect(shouldDeposit(full(undefined), res, 100, cfg({ reserveSlots: 1 }))).toBe(true); // 1 free <= 1
      expect(shouldDeposit(full(undefined), res, 100, cfg({ reserveSlots: 0 }))).toBe(false); // 1 free > 0
      expect(shouldDeposit(full(item("dirt", 10)), res, 100, cfg({ reserveSlots: 1 }))).toBe(false); // room on dirt
      expect(shouldDeposit(full(item("dirt", 64)), res, 100, cfg({ reserveSlots: 1 }))).toBe(true);
    });
  });
});

describe("tools", () => {
  it("bestToolSlot: tier, then durability, then slot", () => {
    const i = inv({
      1: item("wooden_pickaxe", 1, 1),
      5: item("iron_pickaxe", 1, 1, { damage: 200, max: 250 }),
      9: item("iron_pickaxe", 1, 1, { damage: 10, max: 250 }),
      12: item("diamond_axe", 1, 1),
      20: item("golden_pickaxe", 1, 1),
    });
    expect(bestToolSlot(i, "pickaxe")).toBe(9);
    expect(bestToolSlot(i, "axe")).toBe(12);
    expect(bestToolSlot(i, "shovel")).toBeUndefined();
    // golden ranks below stone
    expect(bestToolSlot(inv({ 0: item("golden_axe", 1, 1), 1: item("stone_axe", 1, 1) }), "axe")).toBe(1);
  });
  it("bestToolSlot: missing durability counts as full; equal -> lowest slot", () => {
    const i = inv({ 3: item("stone_shovel", 1, 1, { damage: 1, max: 131 }), 4: item("stone_shovel", 1, 1) });
    expect(bestToolSlot(i, "shovel")).toBe(4);
    const j = inv({ 6: item("stone_shovel", 1, 1), 2: item("stone_shovel", 1, 1) });
    expect(bestToolSlot(j, "shovel")).toBe(2);
    expect(bestToolSlot(inv({ 0: item("stick", 4) }), "axe")).toBeUndefined();
  });
  it("planHotbar", () => {
    const i = inv({ 0: item("dirt"), 1: item("dirt"), 2: item("dirt") });
    expect(planHotbar(i, 4, 0)).toEqual({ select: 4 });
    expect(planHotbar(i, 0, 3)).toEqual({ select: 0 });
    expect(planHotbar(i, 20, 0)).toEqual({ select: 3, swapFrom: 20 });
    const fullBar = inv(Object.fromEntries(Array.from({ length: 9 }, (_, k) => [k, item("dirt")])));
    expect(planHotbar(fullBar, 20, 6)).toEqual({ select: 6, swapFrom: 20 });
    expect(planHotbar(fullBar, 20, undefined)).toEqual({ select: 0, swapFrom: 20 });
  });
});
