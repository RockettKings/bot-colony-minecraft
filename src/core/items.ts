// Shared item/block tables for Phase 2 (architect-owned contract). Pure data + trivial lookups, no @minecraft.
// Used by the parser (resource names), the colony (labels), and the game layer (scan types, tools, recipes).
// Every id here is a full Bedrock typeId ("minecraft:oak_log").
import type { ResourceKey } from "./types.js";

export const MC = "minecraft:";

/** "oak_log" | "minecraft:oak_log" -> "minecraft:oak_log". Lower-cases. */
export function ns(id: string): string {
  const t = id.trim().toLowerCase();
  return t.startsWith(MC) ? t : MC + t;
}

/** "minecraft:oak_log" -> "oak_log" (player-facing). Other namespaces are kept. */
export function shortId(typeId: string): string {
  return typeId.startsWith(MC) ? typeId.slice(MC.length) : typeId;
}

// ---------------------------------------------------------------- !gather limits

export const GATHER_LIMITS = {
  minAmount: 1,
  maxAmount: 256,
  defaultAmount: 16,
} as const;

// ---------------------------------------------------------------- tools

export type ToolKind = "axe" | "pickaxe" | "shovel";
export type ToolTier = "wooden" | "stone" | "iron" | "golden" | "diamond" | "netherite";

/** Preference order, best first (durable tiers before golden). */
export const TOOL_TIER_PREFERENCE: readonly ToolTier[] = ["netherite", "diamond", "iron", "stone", "golden", "wooden"];

/** Bedrock mining speed multiplier per tier (hand = 1). */
export const TOOL_SPEED: Readonly<Record<ToolTier, number>> = {
  wooden: 2,
  stone: 4,
  iron: 6,
  golden: 12,
  diamond: 8,
  netherite: 9,
};

export interface ToolInfo {
  kind: ToolKind;
  tier: ToolTier;
  /** 0 = best (index in TOOL_TIER_PREFERENCE). */
  rank: number;
}

const TOOL_RE = /^minecraft:(wooden|stone|iron|golden|diamond|netherite)_(axe|pickaxe|shovel)$/;

/** Tool info for an item typeId, or undefined if it isn't an axe/pickaxe/shovel. */
export function toolInfo(typeId: string): ToolInfo | undefined {
  const m = TOOL_RE.exec(typeId);
  if (!m) return undefined;
  const tier = m[1] as ToolTier;
  return { kind: m[2] as ToolKind, tier, rank: TOOL_TIER_PREFERENCE.indexOf(tier) };
}

export function toolId(tier: ToolTier, kind: ToolKind): string {
  return `${MC}${tier}_${kind}`;
}

// ---------------------------------------------------------------- resources (!gather)

export const LOG_SPECIES = [
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "dark_oak",
  "mangrove",
  "cherry",
  "pale_oak",
] as const;
export type LogSpecies = (typeof LOG_SPECIES)[number];

export const LOG_IDS: readonly string[] = LOG_SPECIES.map((s) => `${MC}${s}_log`);
export const PLANK_IDS: readonly string[] = LOG_SPECIES.map((s) => `${MC}${s}_planks`);

export interface ResourceDef {
  key: ResourceKey;
  /** Player-facing name in chat, e.g. "logs", "oak_log", "cobblestone". */
  label: string;
  /** Block typeIds the bot breaks to get it. */
  sources: readonly string[];
  /** Item typeIds that count toward the amount and are deposited. */
  yields: readonly string[];
  /** Tool class that speeds it up / is required. */
  tool: ToolKind | null;
  /** Without `tool` the block drops nothing (stone): the bot must get a tool first or fail with no_tool. */
  requiresTool: boolean;
}

function logResource(species: LogSpecies): ResourceDef {
  const id = `${MC}${species}_log`;
  return { key: `${species}_log`, label: `${species}_log`, sources: [id], yields: [id], tool: "axe", requiresTool: false };
}

export const RESOURCES: Readonly<Record<ResourceKey, ResourceDef>> = {
  log: { key: "log", label: "logs", sources: LOG_IDS, yields: LOG_IDS, tool: "axe", requiresTool: false },
  oak_log: logResource("oak"),
  spruce_log: logResource("spruce"),
  birch_log: logResource("birch"),
  jungle_log: logResource("jungle"),
  acacia_log: logResource("acacia"),
  dark_oak_log: logResource("dark_oak"),
  mangrove_log: logResource("mangrove"),
  cherry_log: logResource("cherry"),
  pale_oak_log: logResource("pale_oak"),
  cobblestone: {
    key: "cobblestone",
    label: "cobblestone",
    sources: [`${MC}stone`, `${MC}cobblestone`],
    yields: [`${MC}cobblestone`],
    tool: "pickaxe",
    requiresTool: true,
  },
  dirt: {
    key: "dirt",
    label: "dirt",
    sources: [`${MC}dirt`, `${MC}grass_block`],
    yields: [`${MC}dirt`],
    tool: "shovel",
    requiresTool: false,
  },
  sand: { key: "sand", label: "sand", sources: [`${MC}sand`], yields: [`${MC}sand`], tool: "shovel", requiresTool: false },
  gravel: {
    key: "gravel",
    label: "gravel",
    sources: [`${MC}gravel`],
    // Gravel sometimes drops flint instead; only gravel counts (flint is picked up but not deposited).
    yields: [`${MC}gravel`],
    tool: "shovel",
    requiresTool: false,
  },
};

/** Extra names accepted by `!gather` (besides every ResourceKey itself). Lower-case, no namespace. */
export const RESOURCE_ALIASES: Readonly<Record<string, ResourceKey>> = {
  logs: "log",
  wood: "log",
  woods: "log",
  stone: "cobblestone",
  cobble: "cobblestone",
  cobbles: "cobblestone",
  grass: "dirt",
  grass_block: "dirt",
};

/** Player token -> canonical key. Case-insensitive; an optional "minecraft:" prefix is ignored. */
export function resolveResource(token: string): ResourceKey | undefined {
  const t = shortId(ns(token));
  if (Object.prototype.hasOwnProperty.call(RESOURCES, t)) return t as ResourceKey;
  return Object.prototype.hasOwnProperty.call(RESOURCE_ALIASES, t) ? RESOURCE_ALIASES[t] : undefined;
}

/** For help text and "unknown item" errors. */
export const RESOURCE_NAMES_HINT = "logs (or oak_log, birch_log, ...), cobblestone, dirt, sand, gravel";

// ---------------------------------------------------------------- blocks

/** Block types `!chest set` accepts and bots deposit into. All have a minecraft:inventory block component. */
export const CONTAINER_BLOCK_TYPES: readonly string[] = [`${MC}chest`, `${MC}trapped_chest`, `${MC}barrel`];

export const CRAFTING_TABLE = `${MC}crafting_table`;
export const STICK = `${MC}stick`;

/** Bedrock block hardness (seconds-scale), for break-time estimates. Unknown blocks: DEFAULT_HARDNESS. */
export const BLOCK_HARDNESS: Readonly<Record<string, number>> = {
  ...Object.fromEntries(LOG_IDS.map((id) => [id, 2])),
  [`${MC}stone`]: 1.5,
  [`${MC}cobblestone`]: 2,
  [`${MC}dirt`]: 0.5,
  [`${MC}grass_block`]: 0.6,
  [`${MC}sand`]: 0.5,
  [`${MC}gravel`]: 0.6,
};
export const DEFAULT_HARDNESS = 2;

// ---------------------------------------------------------------- crafting (tiny table)

export interface RecipeIngredient {
  /** Any one of these item typeIds (e.g. any planks). */
  anyOf: readonly string[];
  amount: number;
}

export interface Recipe {
  id: string;
  output: { typeId: string; amount: number };
  ingredients: readonly RecipeIngredient[];
  /** 3x3 recipe: needs a crafting table within reach (AGENT-CONTEXT survival rules). */
  needsTable: boolean;
}

/** One planks recipe per species: 1 log -> 4 planks (2x2, anywhere). */
export const PLANKS_RECIPES: readonly Recipe[] = LOG_SPECIES.map((s) => ({
  id: `${s}_planks`,
  output: { typeId: `${MC}${s}_planks`, amount: 4 },
  ingredients: [{ anyOf: [`${MC}${s}_log`], amount: 1 }],
  needsTable: false,
}));

export const STICK_RECIPE: Recipe = {
  id: "stick",
  output: { typeId: STICK, amount: 4 },
  ingredients: [{ anyOf: PLANK_IDS, amount: 2 }],
  needsTable: false,
};

export const CRAFTING_TABLE_RECIPE: Recipe = {
  id: "crafting_table",
  output: { typeId: CRAFTING_TABLE, amount: 1 },
  ingredients: [{ anyOf: PLANK_IDS, amount: 4 }],
  needsTable: false,
};

export const WOODEN_PICKAXE_RECIPE: Recipe = {
  id: "wooden_pickaxe",
  output: { typeId: `${MC}wooden_pickaxe`, amount: 1 },
  ingredients: [
    { anyOf: PLANK_IDS, amount: 3 },
    { anyOf: [STICK], amount: 2 },
  ],
  needsTable: true,
};

export const RECIPES: readonly Recipe[] = [...PLANKS_RECIPES, STICK_RECIPE, CRAFTING_TABLE_RECIPE, WOODEN_PICKAXE_RECIPE];

/** Logs a bot needs to craft a wooden pickaxe from nothing: 9 planks (3 pickaxe + 2 for sticks + 4 table) = 3 logs. */
export const LOGS_FOR_PICKAXE_WITH_TABLE_CRAFT = 3;
/** ... when a crafting table is already within reach: 5 planks = 2 logs. */
export const LOGS_FOR_PICKAXE = 2;
