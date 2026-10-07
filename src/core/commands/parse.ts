// Pure command parser. Grammar lives in specs.ts; this file only interprets it.
import type { Command, Coord, ParseResult } from "../types.js";
import { BOT_NAME_RE, MAX_COUNT, MIN_COUNT, findSpec, type ArgSpec, type CommandSpec } from "./specs.js";

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const COUNT_RE = /^\d+$/;
const LETTER_RE = /^[A-Za-z]$/;

/** World bounds. Absolute Y covers the overworld build range (a superset of Nether/End). */
export const COORD_LIMITS = {
  horizontal: 30_000_000, // |x|, |z| and |~n| on x/z
  minY: -64,
  maxY: 320,
  relativeY: 384, // |~n| on y: full build height
} as const;

export type Axis = "x" | "y" | "z";
const AXES: readonly Axis[] = ["x", "y", "z"];

const ECHO_MAX = 20;

/** Player text echoed back in an error: drop § format codes, cap length (by code point). */
export function echo(token: string): string {
  const chars = Array.from(token.replace(/\u00a7/g, ""));
  return chars.length > ECHO_MAX ? chars.slice(0, ECHO_MAX - 1).join("") + "\u2026" : chars.join("");
}

export function isCommand(text: string, prefix = "!"): boolean {
  if (prefix.length === 0) return false;
  const t = text.trim();
  return t.startsWith(prefix) && LETTER_RE.test(t.charAt(prefix.length));
}

interface Values {
  coords: Coord[];
  count?: number;
  name?: string;
  topic?: string;
}

type ArgResult = { ok: true } | { ok: false; error: string };

export function parseCommand(text: string, prefix = "!"): ParseResult | null {
  if (!isCommand(text, prefix)) return null;
  const tokens = text.trim().slice(prefix.length).split(/\s+/);
  const typed = (tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);

  const spec = findSpec(typed);
  if (!spec) return { ok: false, error: `Unknown command '${prefix}${echo(typed)}'. Type ${prefix}help.` };

  const usage = `${prefix}${spec.usage}`;
  const fail = (error: string): ParseResult => ({ ok: false, error, usage });

  if (args.length > spec.args.length) return fail("Too many arguments.");

  const values: Values = { coords: [] };
  for (let i = 0; i < spec.args.length; i++) {
    const arg = spec.args[i] as ArgSpec;
    const token = args[i];
    if (token === undefined) {
      if (arg.optional) break; // optional args are always trailing
      return fail(`Missing ${arg.label}.`);
    }
    const r = parseArg(arg, token, values);
    if (!r.ok) return fail(r.error);
  }

  return { ok: true, command: build(spec, values) };
}

function parseArg(arg: ArgSpec, token: string, values: Values): ArgResult {
  switch (arg.type) {
    case "coord": {
      const c = parseCoord(token, AXES[values.coords.length]);
      if (typeof c === "string") return { ok: false, error: c };
      values.coords.push(c);
      return { ok: true };
    }
    case "count": {
      const n = COUNT_RE.test(token) ? Number(token) : NaN;
      if (!Number.isSafeInteger(n) || n < MIN_COUNT || n > MAX_COUNT) {
        return { ok: false, error: `Count must be a whole number from ${MIN_COUNT} to ${MAX_COUNT}.` };
      }
      values.count = n;
      return { ok: true };
    }
    case "botName": {
      const name = token.startsWith("@") ? token.slice(1) : token;
      if (!BOT_NAME_RE.test(name)) {
        return { ok: false, error: `'${echo(token)}' isn't a valid bot name (1-16 letters, digits, _ or -).` };
      }
      values.name = name;
      return { ok: true };
    }
    case "topic":
      values.topic = token;
      return { ok: true };
  }
}

/**
 * Returns a Coord, or a player-facing error string. With `axis`, the value is also range-checked
 * (absolute Y within the build range; everything else within the world border).
 */
export function parseCoord(token: string, axis?: Axis): Coord | string {
  const bad = `'${echo(token)}' isn't a valid coordinate. Use a number, ~ or ~n.`;
  if (token.startsWith("^")) return "Local coordinates (^) aren't supported. Use numbers or ~.";
  const relative = token.startsWith("~");
  const rest = relative ? token.slice(1) : token;
  if (relative && rest === "") return { value: 0, relative: true };
  if (!NUMBER_RE.test(rest)) return bad;
  const value = Number(rest) + 0; // normalise -0 to 0
  if (!Number.isFinite(value)) return bad;
  if (axis !== undefined) {
    const L = COORD_LIMITS;
    if (axis === "y" && !relative && (value < L.minY || value > L.maxY)) {
      return `Y must be from ${L.minY} to ${L.maxY}.`;
    }
    const max = axis === "y" ? L.relativeY : L.horizontal;
    if (Math.abs(value) > max) return `'${echo(token)}' is out of range (max ${max}).`;
  }
  return { value, relative };
}

function build(spec: CommandSpec, v: Values): Command {
  const count = v.count ?? MIN_COUNT;
  switch (spec.name) {
    case "help":
      return v.topic === undefined ? { kind: "help" } : { kind: "help", topic: v.topic };
    case "status":
      return v.name === undefined ? { kind: "status" } : { kind: "status", bot: v.name };
    case "spawn":
      return v.name === undefined ? { kind: "spawn" } : { kind: "spawn", name: v.name };
    case "goto": {
      const [x, y, z] = v.coords;
      // Spec guarantees three required coords were parsed.
      return { kind: "goto", target: { x: x as Coord, y: y as Coord, z: z as Coord }, count };
    }
    case "come":
      return { kind: "come", count };
    case "stop":
      return v.name === undefined ? { kind: "stop" } : { kind: "stop", bot: v.name };
    case "override":
      return { kind: "override" };
    case "queue":
      return { kind: "queue" };
  }
}

