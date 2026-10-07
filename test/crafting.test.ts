import { describe, expect, it } from "vitest";
import { planCraft, planWoodenPickaxe, planksRecipeFor, tableSpot, type PickaxeStep } from "../src/game/bots/crafting.js";
import { posKey, type BlockProbe } from "../src/game/bots/gather-logic.js";
import {
  CRAFTING_TABLE_RECIPE,
  PLANKS_RECIPES,
  STICK_RECIPE,
  WOODEN_PICKAXE_RECIPE,
  type Recipe,
} from "../src/core/items.js";
import type { BlockInfo, InventorySnapshot, ItemStackView } from "../src/game/bots/ports.js";
import type { Vec3 } from "../src/core/types.js";

const item = (typeId: string, amount = 1, maxAmount = 64): ItemStackView => ({ typeId: `minecraft:${typeId}`, amount, maxAmount });
function inv(entries: Record<number, ItemStackView>, size = 36): InventorySnapshot {
  return Array.from({ length: size }, (_, i) => entries[i]);
}
const OAK_PLANKS = PLANKS_RECIPES.find((r) => r.id === "oak_planks")!;
const TABLE: Vec3 = { x: 1, y: 64, z: 2 };

describe("planCraft", () => {
  it("2x2 planks from one log", () => {
    const plan = planCraft(OAK_PLANKS, inv({ 3: item("oak_log", 5) }));
    expect(plan).toEqual({
      recipeId: "oak_planks",
      consume: [{ slot: 3, typeId: "minecraft:oak_log", amount: 1 }],
      produce: { typeId: "minecraft:oak_planks", amount: 4 },
    });
  });
  it("missing ingredients -> undefined", () => {
    expect(planCraft(OAK_PLANKS, inv({ 0: item("birch_log", 5) }))).toBeUndefined();
    expect(planCraft(CRAFTING_TABLE_RECIPE, inv({ 0: item("oak_planks", 3) }))).toBeUndefined();
  });
  it("splits an ingredient across slots (any species), lowest slot first", () => {
    const plan = planCraft(CRAFTING_TABLE_RECIPE, inv({ 2: item("birch_planks", 1), 5: item("oak_planks", 2), 9: item("oak_planks", 8) }));
    expect(plan?.consume).toEqual([
      { slot: 2, typeId: "minecraft:birch_planks", amount: 1 },
      { slot: 5, typeId: "minecraft:oak_planks", amount: 2 },
      { slot: 9, typeId: "minecraft:oak_planks", amount: 1 },
    ]);
  });
  it("never over-consumes a slot across ingredient entries; merges entries per slot", () => {
    const twice: Recipe = {
      id: "test",
      output: { typeId: "minecraft:test", amount: 1 },
      ingredients: [
        { anyOf: ["minecraft:oak_planks"], amount: 2 },
        { anyOf: ["minecraft:oak_planks"], amount: 2 },
      ],
      needsTable: false,
    };
    expect(planCraft(twice, inv({ 0: item("oak_planks", 3) }))).toBeUndefined();
    const plan = planCraft(twice, inv({ 0: item("oak_planks", 3), 1: item("oak_planks", 5) }));
    expect(plan?.consume).toEqual([
      { slot: 0, typeId: "minecraft:oak_planks", amount: 3 },
      { slot: 1, typeId: "minecraft:oak_planks", amount: 1 },
    ]);
  });
  it("3x3 needs tableAt and copies it", () => {
    const i = inv({ 0: item("oak_planks", 3), 1: item("stick", 2) });
    expect(planCraft(WOODEN_PICKAXE_RECIPE, i)).toBeUndefined();
    const plan = planCraft(WOODEN_PICKAXE_RECIPE, i, TABLE);
    expect(plan?.tableAt).toEqual(TABLE);
    expect(plan?.consume).toEqual([
      { slot: 0, typeId: "minecraft:oak_planks", amount: 3 },
      { slot: 1, typeId: "minecraft:stick", amount: 2 },
    ]);
    expect(plan?.produce).toEqual({ typeId: "minecraft:wooden_pickaxe", amount: 1 });
    // 2x2 recipes don't carry a table
    expect(planCraft(STICK_RECIPE, i, TABLE)?.tableAt).toBeUndefined();
  });
  describe("output room", () => {
    const fullOf = (fill: (i: number) => ItemStackView) => Array.from({ length: 36 }, (_, i) => fill(i));
    it("full inventory without room -> undefined", () => {
      const i = fullOf((k) => (k === 0 ? item("oak_log", 5) : item("cobblestone", 64)));
      expect(planCraft(OAK_PLANKS, i)).toBeUndefined();
    });
    it("full inventory, but a slot the consumption empties", () => {
      const i = fullOf((k) => (k === 0 ? item("oak_log", 1) : item("cobblestone", 64)));
      expect(planCraft(OAK_PLANKS, i)).toBeDefined();
    });
    it("full inventory, mergeable output stack with room", () => {
      const i = fullOf((k) => (k === 0 ? item("oak_log", 5) : k === 1 ? item("oak_planks", 60) : item("cobblestone", 64)));
      expect(planCraft(OAK_PLANKS, i)).toBeDefined();
      const tight = fullOf((k) => (k === 0 ? item("oak_log", 5) : k === 1 ? item("oak_planks", 61) : item("cobblestone", 64)));
      expect(planCraft(OAK_PLANKS, tight)).toBeUndefined();
    });
    it("output stack that is itself consumed counts its remaining amount", () => {
      // sticks from planks with planks as... use planks->table: table stack of max 64 with 63 -> 64 fits
      const i = fullOf((k) => (k === 0 ? item("oak_planks", 4) : k === 1 ? item("crafting_table", 63) : item("dirt", 64)));
      // slot 0 is emptied anyway; also the 63-table stack has room for 1
      expect(planCraft(CRAFTING_TABLE_RECIPE, i)).toBeDefined();
    });
    it("unstackable output (pickaxe, max 1) can't merge", () => {
      const i = fullOf((k) =>
        k === 0 ? item("oak_planks", 5) : k === 1 ? item("stick", 4) : k === 2 ? item("wooden_pickaxe", 1, 1) : item("dirt", 64),
      );
      expect(planCraft(WOODEN_PICKAXE_RECIPE, i, TABLE)).toBeUndefined();
    });
  });
});

describe("planksRecipeFor", () => {
  it("maps each log species", () => {
    expect(planksRecipeFor("minecraft:birch_log")?.output).toEqual({ typeId: "minecraft:birch_planks", amount: 4 });
    expect(planksRecipeFor("minecraft:pale_oak_log")?.id).toBe("pale_oak_planks");
    expect(planksRecipeFor("dark_oak_log")?.id).toBe("dark_oak_planks");
    expect(planksRecipeFor("minecraft:stone")).toBeUndefined();
  });
});

describe("planWoodenPickaxe", () => {
  const ids = (steps: PickaxeStep[]) => steps.map((s) => (s.kind === "craft" ? s.recipe.id : s.kind));
  it("from 3 logs: planks x3, stick, table, place, pickaxe", () => {
    const p = planWoodenPickaxe(inv({ 0: item("oak_log", 3) }), false);
    expect(p.ok && ids(p.steps)).toEqual(["oak_planks", "oak_planks", "oak_planks", "stick", "crafting_table", "place_table", "wooden_pickaxe"]);
  });
  it("table nearby: 2 logs, no table craft or placement", () => {
    const p = planWoodenPickaxe(inv({ 0: item("oak_log", 5) }), true);
    expect(p.ok && ids(p.steps)).toEqual(["oak_planks", "oak_planks", "stick", "wooden_pickaxe"]);
  });
  it("held crafting_table item: placed, not crafted", () => {
    const p = planWoodenPickaxe(inv({ 0: item("oak_log", 2), 1: item("crafting_table") }), false);
    expect(p.ok && ids(p.steps)).toEqual(["oak_planks", "oak_planks", "stick", "place_table", "wooden_pickaxe"]);
  });
  it("uses held planks and sticks first", () => {
    const p = planWoodenPickaxe(inv({ 0: item("spruce_planks", 3), 1: item("stick", 2) }), true);
    expect(p.ok && ids(p.steps)).toEqual(["wooden_pickaxe"]);
    const q = planWoodenPickaxe(inv({ 0: item("oak_planks", 6), 4: item("oak_log", 1) }), false); // need 9
    expect(q.ok && ids(q.steps)).toEqual(["oak_planks", "stick", "crafting_table", "place_table", "wooden_pickaxe"]);
  });
  it("species with the most logs first, then the next", () => {
    const p = planWoodenPickaxe(inv({ 0: item("oak_log", 1), 1: item("birch_log", 2) }), false);
    expect(p.ok && ids(p.steps).slice(0, 3)).toEqual(["birch_planks", "birch_planks", "oak_planks"]);
  });
  it("not enough logs -> logsMissing", () => {
    expect(planWoodenPickaxe(inv({}), false)).toEqual({ ok: false, logsMissing: 3 });
    expect(planWoodenPickaxe(inv({}), true)).toEqual({ ok: false, logsMissing: 2 });
    expect(planWoodenPickaxe(inv({ 0: item("oak_log", 1) }), false)).toEqual({ ok: false, logsMissing: 2 });
    expect(planWoodenPickaxe(inv({ 0: item("oak_planks", 8) }), false)).toEqual({ ok: false, logsMissing: 1 });
  });
  it("one stick is not enough", () => {
    const p = planWoodenPickaxe(inv({ 0: item("oak_planks", 5), 1: item("stick", 1) }), true);
    expect(p.ok && ids(p.steps)).toEqual(["stick", "wooden_pickaxe"]);
  });
  it("the step list replays through planCraft (simulated inventory)", () => {
    // Simulate applying each craft with planCraft against a running inventory.
    let cur: (ItemStackView | undefined)[] = [...inv({ 0: item("oak_log", 3) })];
    const p = planWoodenPickaxe(cur, false);
    if (!p.ok) throw new Error("plan failed");
    for (const s of p.steps) {
      if (s.kind === "place_table") {
        const k = cur.findIndex((x) => x?.typeId === "minecraft:crafting_table");
        cur[k] = cur[k]!.amount > 1 ? { ...cur[k]!, amount: cur[k]!.amount - 1 } : undefined;
        continue;
      }
      const plan = planCraft(s.recipe, cur, TABLE);
      expect(plan).toBeDefined();
      for (const c of plan!.consume) {
        const st = cur[c.slot]!;
        cur[c.slot] = st.amount > c.amount ? { ...st, amount: st.amount - c.amount } : undefined;
      }
      const m = cur.findIndex((x) => x?.typeId === plan!.produce.typeId && x.amount + plan!.produce.amount <= x.maxAmount);
      const slot = m >= 0 ? m : cur.findIndex((x) => x === undefined);
      const prev = cur[slot];
      cur[slot] = { typeId: plan!.produce.typeId, amount: (prev?.amount ?? 0) + plan!.produce.amount, maxAmount: plan!.produce.typeId.endsWith("pickaxe") ? 1 : 64 };
      cur = [...cur];
    }
    expect(cur.some((x) => x?.typeId === "minecraft:wooden_pickaxe")).toBe(true);
  });
});

describe("tableSpot", () => {
  const AIR: BlockInfo = { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false };
  const STONE: BlockInfo = { typeId: "minecraft:stone", isAir: false, isSolid: true, isLiquid: false };
  const world = (blocks: Record<string, BlockInfo>): BlockProbe => (p) => blocks[posKey(p)] ?? (p.y <= 0 ? STONE : AIR);
  const feet = { x: 0.5, y: 1, z: 0.5 };
  it("north first on open ground", () => {
    expect(tableSpot(world({}), feet)).toEqual({ onBlock: { x: 0, y: 0, z: -1 }, face: "Up", tableAt: { x: 0, y: 1, z: -1 } });
  });
  it("skips blocked cells in N, E, S, W order, then diagonals", () => {
    const w = world({ "0,1,-1": STONE, "1,2,0": STONE, "0,0,1": AIR, "-1,1,0": STONE });
    // N blocked, E head blocked, S no floor, W blocked -> NE
    expect(tableSpot(w, feet)?.tableAt).toEqual({ x: 1, y: 1, z: -1 });
    const onlyEast = world({ "0,1,-1": STONE });
    expect(tableSpot(onlyEast, feet)?.tableAt).toEqual({ x: 1, y: 1, z: 0 });
  });
  it("undefined when boxed in", () => {
    const blocks: Record<string, BlockInfo> = {};
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) blocks[`${dx},1,${dz}`] = STONE;
    expect(tableSpot(world(blocks), feet)).toBeUndefined();
  });
  it("uses the feet block for fractional / negative positions", () => {
    expect(tableSpot(world({}), { x: -0.3, y: 1.0, z: -0.7 })?.tableAt).toEqual({ x: -1, y: 1, z: -2 });
  });
});
