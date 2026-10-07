// Command table: the single source of truth for both parsing and help text.
import type { CommandKind } from "../types.js";
import { GATHER_LIMITS } from "../items.js";

export const MIN_COUNT = 1;
export const MAX_COUNT = 16;
export const BOT_NAME_RE = /^[A-Za-z0-9_-]{1,16}$/;

/** How a single positional argument is parsed. */
export type ArgType =
  | "coord" // number, `~` or `~n`
  | "count" // integer MIN_COUNT..MAX_COUNT
  | "botName" // optional leading `@`, then BOT_NAME_RE
  | "topic" // any single token
  | "item" // resolveResource(token) from src/core/items.ts
  | "amount" // integer GATHER_LIMITS.minAmount..maxAmount
  | "chestAction"; // literal `set` (case-insensitive)

export interface ArgSpec {
  /** Placeholder shown in usage, e.g. `x` -> `<x>` / `[x]`. */
  name: string;
  /** Player-facing noun used in "Missing ..." errors. */
  label: string;
  type: ArgType;
  optional: boolean;
}

export interface CommandSpec {
  name: CommandKind;
  /** Usage without the prefix, e.g. `goto <x> <y> <z> [count]`. Derived from `args`. */
  usage: string;
  description: string;
  args: readonly ArgSpec[];
}

const req = (name: string, label: string, type: ArgType): ArgSpec => ({ name, label, type, optional: false });
const opt = (name: string, label: string, type: ArgType): ArgSpec => ({ name, label, type, optional: true });

function spec(name: CommandKind, description: string, args: ArgSpec[]): CommandSpec {
  const parts = args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`));
  return { name, usage: [name, ...parts].join(" "), description, args };
}

export const COMMAND_SPECS: readonly CommandSpec[] = [
  spec("help", "List commands, or show how to use one.", [opt("command", "command", "topic")]),
  spec("status", "Show what each bot is doing and the queue, or one bot.", [opt("bot", "bot name", "botName")]),
  spec("spawn", "Spawn a bot at your position. Name: 1-16 letters, digits, _ or -.", [opt("name", "bot name", "botName")]),
  spec("goto", `Send bots to x y z (~ = relative to you). Count ${MIN_COUNT}-${MAX_COUNT}, default ${MIN_COUNT}.`, [
    req("x", "x coordinate", "coord"),
    req("y", "y coordinate", "coord"),
    req("z", "z coordinate", "coord"),
    opt("count", "count", "count"),
  ]),
  spec("come", `Call bots to your position. Count ${MIN_COUNT}-${MAX_COUNT}, default ${MIN_COUNT}.`, [opt("count", "count", "count")]),
  spec(
    "gather",
    `Gather an item into the colony chest. Amount ${GATHER_LIMITS.minAmount}-${GATHER_LIMITS.maxAmount} (default ${GATHER_LIMITS.defaultAmount}), split across ${MIN_COUNT}-${MAX_COUNT} bots.`,
    [req("item", "item", "item"), opt("amount", "amount", "amount"), opt("bots", "bot count", "count")],
  ),
  spec("chest", "Show the colony chest, or 'set' it to the chest you look at.", [opt("set", "chest action", "chestAction")]),
  spec("stop", "Stop all your tasks (queued too), or one bot. Stopping another player's bot asks first.", [opt("bot", "bot name", "botName")]),
  spec("override", "Answer a busy reply: take (or stop) the busy bots anyway.", []),
  spec("queue", "Answer a busy reply: wait in line for free bots.", []),
];

export function findSpec(name: string): CommandSpec | undefined {
  const lower = name.toLowerCase();
  return COMMAND_SPECS.find((s) => s.name === lower);
}
