import { describe, expect, it, vi } from "vitest";
import { COMMAND_SPECS, COORD_LIMITS, helpText, isCommand, parseCommand, parseCoord } from "../src/core/commands/index.js";
import { createColony, handleChat } from "../src/core/index.js";
import type { Command, ParseResult, Sender } from "../src/core/types.js";

const ok = (text: string, prefix?: string): Command => {
  const r = parseCommand(text, prefix);
  if (!r || !r.ok) throw new Error(`expected ok for ${JSON.stringify(text)}, got ${JSON.stringify(r)}`);
  return r.command;
};
const err = (text: string, prefix?: string): Extract<ParseResult, { ok: false }> => {
  const r = parseCommand(text, prefix);
  if (!r || r.ok) throw new Error(`expected error for ${JSON.stringify(text)}, got ${JSON.stringify(r)}`);
  return r;
};
const abs = (value: number) => ({ value, relative: false });
const rel = (value: number) => ({ value, relative: true });

describe("isCommand", () => {
  it.each(["!help", "!a", "  !come  ", "!Spawn Bob", "!z9"])("true for %j", (t) => {
    expect(isCommand(t)).toBe(true);
  });
  it.each(["", "!", "!!!", "! hi", "!1", "!~", "hello !help", "!é", "!_x", "!-x", " ! come"])(
    "false for %j",
    (t) => expect(isCommand(t)).toBe(false),
  );
  it("respects a custom prefix", () => {
    expect(isCommand(".come", ".")).toBe(true);
    expect(isCommand("!come", ".")).toBe(false);
    expect(isCommand("bot:come", "bot:")).toBe(true);
    expect(isCommand("bot: come", "bot:")).toBe(false);
  });
});

describe("parseCommand basics", () => {
  it("returns null for non-commands", () => {
    for (const t of ["hello", "!!!", "! hi", "!", ""]) expect(parseCommand(t)).toBeNull();
  });
  it("is case-insensitive on command names", () => {
    expect(ok("!HELP")).toEqual({ kind: "help" });
    expect(ok("!CoMe")).toEqual({ kind: "come", count: 1 });
    expect(ok("!OVERRIDE")).toEqual({ kind: "override" });
  });
  it("tolerates repeated and surrounding whitespace, including tabs", () => {
    expect(ok("   !goto   1    2\t3    4  ")).toEqual({
      kind: "goto",
      target: { x: abs(1), y: abs(2), z: abs(3) },
      count: 4,
    });
  });
  it("unknown command gives the exact message, lowercased", () => {
    expect(parseCommand("!xyz")).toEqual({ ok: false, error: "Unknown command '!xyz'. Type !help." });
    expect(err("!XyZ 1 2").error).toBe("Unknown command '!xyz'. Type !help.");
    expect(err("!dance").usage).toBeUndefined();
  });
  it("uses the given prefix in errors and usage", () => {
    expect(err(".xyz", ".").error).toBe("Unknown command '.xyz'. Type .help.");
    expect(err(".come 0", ".").usage).toBe(".come [count]");
    expect(ok(".stop", ".")).toEqual({ kind: "stop" });
  });
});

describe("no-arg and optional-name commands", () => {
  it("override / queue take no args", () => {
    expect(ok("!override")).toEqual({ kind: "override" });
    expect(ok("!queue")).toEqual({ kind: "queue" });
    expect(err("!override now")).toEqual({ ok: false, error: "Too many arguments.", usage: "!override" });
    expect(err("!queue 1").usage).toBe("!queue");
  });
  it("status / stop / spawn without a name", () => {
    expect(ok("!status")).toEqual({ kind: "status" });
    expect(ok("!stop")).toEqual({ kind: "stop" });
    expect(ok("!spawn")).toEqual({ kind: "spawn" });
    expect("bot" in ok("!status")).toBe(false);
  });
  it("accepts names with or without one leading @", () => {
    expect(ok("!status Bot-1")).toEqual({ kind: "status", bot: "Bot-1" });
    expect(ok("!status @Bot-1")).toEqual({ kind: "status", bot: "Bot-1" });
    expect(ok("!stop @bot_2")).toEqual({ kind: "stop", bot: "bot_2" });
    expect(ok("!spawn @Digger")).toEqual({ kind: "spawn", name: "Digger" });
    expect(ok("!spawn ABCDEFGHIJKLMNOP")).toEqual({ kind: "spawn", name: "ABCDEFGHIJKLMNOP" });
  });
  it.each(["@@Bot", "@", "Bot.1", "Bot!", "ABCDEFGHIJKLMNOPQ", "Böt", "@a@b"])("rejects bad name %j", (n) => {
    for (const cmd of ["spawn", "status", "stop"]) {
      const e = err(`!${cmd} ${n}`);
      expect(e.error).toContain("isn't a valid bot name");
      expect(e.usage).toBe(`!${cmd} [${cmd === "spawn" ? "name" : "bot"}]`);
    }
  });
  it("rejects extra args", () => {
    expect(err("!status Bot-1 Bot-2")).toEqual({ ok: false, error: "Too many arguments.", usage: "!status [bot]" });
    expect(err("!spawn a b").usage).toBe("!spawn [name]");
  });
});

describe("goto", () => {
  it("parses absolute integer and decimal coords with signs", () => {
    expect(ok("!goto 10 -3.5 +7")).toEqual({
      kind: "goto",
      target: { x: abs(10), y: abs(-3.5), z: abs(7) },
      count: 1,
    });
    expect(ok("!goto .5 -0.25 0")).toMatchObject({ target: { x: abs(0.5), y: abs(-0.25), z: abs(0) } });
  });
  it("normalises -0 to 0", () => {
    const c = ok("!goto -0 ~-0 0") as Extract<Command, { kind: "goto" }>;
    expect(Object.is(c.target.x.value, 0)).toBe(true);
    expect(Object.is(c.target.y.value, 0)).toBe(true);
  });
  it("parses ~ forms", () => {
    expect(ok("!goto ~ ~1 ~-2")).toEqual({
      kind: "goto",
      target: { x: rel(0), y: rel(1), z: rel(-2) },
      count: 1,
    });
    expect(ok("!goto ~1.5 ~+3 ~-.5")).toMatchObject({ target: { x: rel(1.5), y: rel(3), z: rel(-0.5) } });
    expect(ok("!goto ~ 64 ~")).toMatchObject({ target: { x: rel(0), y: abs(64), z: rel(0) } });
  });
  it("parses count", () => {
    expect(ok("!goto 1 2 3 1")).toMatchObject({ count: 1 });
    expect(ok("!goto 1 2 3 16")).toMatchObject({ count: 16 });
    expect(ok("!goto 1 2 3 03")).toMatchObject({ count: 3 });
  });
  it.each(["0", "17", "-1", "1.5", "two", "1e1", "+2", "999999999999999999999"])("rejects count %j", (c) => {
    expect(err(`!goto 1 2 3 ${c}`)).toEqual({
      ok: false,
      error: "Count must be a whole number from 1 to 16.",
      usage: "!goto <x> <y> <z> [count]",
    });
  });
  it("rejects ^ local coords with an explanation", () => {
    for (const t of ["!goto ^ ^ ^", "!goto 1 ^2 3", "!goto ~ ~ ^-1"]) {
      const e = err(t);
      expect(e.error).toBe("Local coordinates (^) aren't supported. Use numbers or ~.");
      expect(e.usage).toBe("!goto <x> <y> <z> [count]");
    }
  });
  it.each(["abc", "1e3", "Infinity", "NaN", "~~", "~a", "1.", "1..2", "0x10", "--1", "1,5", "~1e2"])(
    "rejects bad coord %j",
    (c) => {
      const e = err(`!goto ${c} 0 0`);
      expect(e.usage).toBe("!goto <x> <y> <z> [count]");
    },
  );
  it("bad coord error names the token", () => {
    expect(err("!goto 1 abc 3").error).toBe("'abc' isn't a valid coordinate. Use a number, ~ or ~n.");
  });
  it("missing coords", () => {
    expect(err("!goto")).toEqual({ ok: false, error: "Missing x coordinate.", usage: "!goto <x> <y> <z> [count]" });
    expect(err("!goto 1").error).toBe("Missing y coordinate.");
    expect(err("!goto 1 2").error).toBe("Missing z coordinate.");
  });
  it("extra args", () => {
    expect(err("!goto 1 2 3 4 5")).toEqual({
      ok: false,
      error: "Too many arguments.",
      usage: "!goto <x> <y> <z> [count]",
    });
  });
});

describe("come", () => {
  it("defaults count to 1 and accepts bounds", () => {
    expect(ok("!come")).toEqual({ kind: "come", count: 1 });
    expect(ok("!come 1")).toEqual({ kind: "come", count: 1 });
    expect(ok("!come 16")).toEqual({ kind: "come", count: 16 });
  });
  it("rejects bad count and extra args", () => {
    expect(err("!come 0")).toEqual({
      ok: false,
      error: "Count must be a whole number from 1 to 16.",
      usage: "!come [count]",
    });
    expect(err("!come 17").usage).toBe("!come [count]");
    expect(err("!come Bot-1").error).toContain("Count");
    expect(err("!come 2 3")).toEqual({ ok: false, error: "Too many arguments.", usage: "!come [count]" });
  });
});

describe("help command parsing", () => {
  it("with and without topic", () => {
    expect(ok("!help")).toEqual({ kind: "help" });
    expect(ok("!help goto")).toEqual({ kind: "help", topic: "goto" });
    expect(ok("!help !GOTO")).toEqual({ kind: "help", topic: "!GOTO" });
    expect(ok("!help nonsense")).toEqual({ kind: "help", topic: "nonsense" });
    expect(err("!help goto come")).toEqual({ ok: false, error: "Too many arguments.", usage: "!help [command]" });
  });
});

describe("helpText", () => {
  it("lists a header plus one usage line per command", () => {
    const lines = helpText();
    expect(lines).toHaveLength(COMMAND_SPECS.length + 1);
    expect(lines[0]).toContain("!help <command>");
    expect(lines.slice(1)).toEqual([
      "!help [command]",
      "!status [bot]",
      "!spawn [name]",
      "!goto <x> <y> <z> [count]",
      "!come [count]",
      "!stop [bot]",
      "!override",
      "!queue",
    ]);
  });
  it("treats empty/blank topic as no topic", () => {
    expect(helpText("")).toEqual(helpText());
    expect(helpText("  ")).toEqual(helpText());
  });
  it("topic shows usage and description, prefix optional, case-insensitive", () => {
    const expected = ["Usage: !goto <x> <y> <z> [count]", COMMAND_SPECS.find((s) => s.name === "goto")!.description];
    expect(helpText("goto")).toEqual(expected);
    expect(helpText("!goto")).toEqual(expected);
    expect(helpText("GoTo")).toEqual(expected);
    expect(helpText("!GOTO")).toEqual(expected);
  });
  it("unknown topic gives one error line pointing to help", () => {
    const lines = helpText("dance");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Unknown command '!dance'. Type !help.");
    expect(helpText("!!dance")).toHaveLength(1);
  });
  it("uses a custom prefix", () => {
    expect(helpText(undefined, ".")[1]).toBe(".help [command]");
    expect(helpText(".come", ".")).toEqual(["Usage: .come [count]", expect.any(String)]);
    expect(helpText("x", ".")).toEqual(["Unknown command '.x'. Type .help."]);
  });
});

describe("COMMAND_SPECS drives parsing", () => {
  it("covers every command kind exactly once", () => {
    const names = COMMAND_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(["come", "goto", "help", "override", "queue", "spawn", "status", "stop"]);
  });
  it("every spec parses with no args when it has no required args, and its kind matches", () => {
    for (const s of COMMAND_SPECS) {
      const r = parseCommand(`!${s.name}`);
      if (s.args.some((a) => !a.optional)) expect(r?.ok).toBe(false);
      else expect(r).toMatchObject({ ok: true, command: { kind: s.name } });
    }
  });
  it("optional args never precede required ones", () => {
    for (const s of COMMAND_SPECS) {
      const firstOpt = s.args.findIndex((a) => a.optional);
      if (firstOpt >= 0) expect(s.args.slice(firstOpt).every((a) => a.optional)).toBe(true);
    }
  });
  it("too many args always yields that spec's usage", () => {
    for (const s of COMMAND_SPECS) {
      const filler = s.args.map((a) => (a.type === "coord" ? "1" : a.type === "count" ? "1" : "x"));
      expect(err(`!${s.name} ${[...filler, "extra"].join(" ")}`).usage).toBe(`!${s.usage}`);
    }
  });
  it("error messages are short", () => {
    const samples = ["!goto ^ 0 0", "!goto a 0 0", "!come 99", "!spawn ABCDEFGHIJKLMNOPQRS", "!goto", "!queue x"];
    for (const t of samples) expect(err(t).error.length).toBeLessThanOrEqual(80);
  });
});

describe("isCommand edge cases", () => {
  it.each(["!\tcome", "!\ncome", "\u00a0! come", "!\u00a0come", "\u200b!come", "!１", "!ｃome", "!\u{1F600}"])(
    "false for %j",
    (t) => expect(isCommand(t)).toBe(false),
  );
  it.each(["\t!come\n", "\u00a0!come", "\ufeff!come", "!come\u3000", "!Z"])("true for %j", (t) => {
    expect(isCommand(t)).toBe(true);
  });
  it("empty prefix never matches", () => {
    expect(isCommand("come", "")).toBe(false);
    expect(parseCommand("come", "")).toBeNull();
  });
  it("other prefixes are ordinary chat", () => {
    for (const t of ["/come", ".come", "#come", "?help", "!!come", "¡come"]) expect(parseCommand(t)).toBeNull();
  });
});

describe("whitespace and unicode in arguments", () => {
  it("splits on any whitespace run (nbsp, newline, ideographic space)", () => {
    expect(ok("!goto\u00a01\n2\u30003")).toMatchObject({ kind: "goto", target: { x: abs(1), y: abs(2), z: abs(3) } });
    expect(ok("!stop\t\t@Bot-1")).toEqual({ kind: "stop", bot: "Bot-1" });
  });
  it("rejects non-ASCII digits in coords and counts", () => {
    expect(err("!goto ١ 2 3").error).toContain("isn't a valid coordinate");
    expect(err("!goto １ 2 3").error).toContain("isn't a valid coordinate");
    expect(err("!come ２").error).toContain("Count");
  });
  it("a zero-width char glued to a name makes it unknown, not a different command", () => {
    expect(err("!come\u200b").error).toBe("Unknown command '!come\u200b'. Type !help.");
  });
});

describe("coords: non-finite and exotic numbers", () => {
  it.each(["1e999", "-1e999", "Infinity", "-Infinity", "+NaN", "~Infinity", "~NaN", "0b1", "0o7", "1_000", "", " "])(
    "parseCoord rejects %j",
    (t) => expect(typeof parseCoord(t)).toBe("string"),
  );
  it("rejects a digit string that overflows to Infinity", () => {
    expect(typeof parseCoord("9".repeat(400))).toBe("string");
    expect(typeof parseCoord("~" + "9".repeat(400))).toBe("string");
  });
  it("without an axis only syntax is checked (back-compat)", () => {
    expect(parseCoord("1000")).toEqual(abs(1000));
    expect(parseCoord("~-5")).toEqual(rel(-5));
  });
});

describe("coords: range", () => {
  const L = COORD_LIMITS;
  it("accepts the build-range edges for absolute Y", () => {
    expect(ok(`!goto 0 ${L.minY} 0`)).toMatchObject({ target: { y: abs(L.minY) } });
    expect(ok(`!goto 0 ${L.maxY} 0`)).toMatchObject({ target: { y: abs(L.maxY) } });
  });
  it.each(["-65", "321", "1000", "-64.5", "320.01"])("rejects absolute Y %j", (y) => {
    expect(err(`!goto 0 ${y} 0`)).toEqual({ ok: false, error: "Y must be from -64 to 320.", usage: "!goto <x> <y> <z> [count]" });
  });
  it("relative Y is bounded by build height, not by the absolute range", () => {
    expect(ok(`!goto ~ ~-${L.relativeY} ~`)).toMatchObject({ target: { y: rel(-L.relativeY) } });
    expect(ok("!goto ~ ~330 ~")).toMatchObject({ target: { y: rel(330) } });
    expect(err(`!goto ~ ~${L.relativeY + 1} ~`).error).toBe(`'~${L.relativeY + 1}' is out of range (max ${L.relativeY}).`);
  });
  it("x/z are bounded by the world border, absolute and relative", () => {
    expect(ok(`!goto ${L.horizontal} 0 -${L.horizontal}`)).toMatchObject({
      target: { x: abs(L.horizontal), z: abs(-L.horizontal) },
    });
    expect(err(`!goto ${L.horizontal + 1} 0 0`).error).toContain("out of range");
    expect(err(`!goto 0 0 ~-${L.horizontal + 1}`).error).toContain("out of range");
    expect(err("!goto 1e300 0 0").error).toContain("isn't a valid coordinate");
    expect(err(`!goto ${"9".repeat(30)} 0 0`).error).toContain("out of range");
  });
  it("the first bad coord is reported", () => {
    expect(err("!goto a 999 ^").error).toContain("'a'");
    expect(err("!goto 0 999 ^").error).toBe("Y must be from -64 to 320.");
  });
});

describe("count edge cases", () => {
  it.each(["1.0", "16.0", "0x2", "２", "-0", "00"])("rejects %j", (c) => {
    expect(err(`!come ${c}`)).toEqual({ ok: false, error: "Count must be a whole number from 1 to 16.", usage: "!come [count]" });
  });
  it("accepts leading zeros within range", () => {
    expect(ok("!come 016")).toEqual({ kind: "come", count: 16 });
    expect(err("!come 017").error).toContain("Count");
  });
});

describe("echoed input is sanitised", () => {
  it("long unknown command names are clipped", () => {
    const e = err("!" + "a".repeat(5000)).error;
    expect(e.length).toBeLessThanOrEqual(80);
    expect(e).toBe(`Unknown command '!${"a".repeat(19)}\u2026'. Type !help.`);
  });
  it("long bad tokens are clipped in coord and name errors", () => {
    expect(err(`!goto ${"x".repeat(1000)} 0 0`).error.length).toBeLessThanOrEqual(80);
    expect(err(`!spawn ${"y".repeat(1000)}`).error.length).toBeLessThanOrEqual(80);
  });
  it("a 20-char token is echoed in full", () => {
    const t = "z".repeat(20);
    expect(err(`!goto ${t} 0 0`).error).toContain(`'${t}'`);
  });
  it("clipping never splits a surrogate pair", () => {
    const e = err("!a" + "\u{1F600}".repeat(40)).error;
    expect(e).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it("§ format codes are stripped from echoes", () => {
    expect(err("!x§kevil").error).toBe("Unknown command '!xkevil'. Type !help.");
    expect(err("!goto §c1 0 0").error).not.toContain("§");
    expect(err("!spawn §4Bob").error).not.toContain("§");
  });
  it("huge input with many args fails fast with usage", () => {
    const r = err("!goto " + "1 ".repeat(10000));
    expect(r.error).toBe("Too many arguments.");
  });
});

describe("help topic forms", () => {
  it("prefixed, doubled-prefix and unknown topics", () => {
    const c = ok("!help !goto") as Extract<Command, { kind: "help" }>;
    expect(helpText(c.topic)[0]).toBe("Usage: !goto <x> <y> <z> [count]");
    expect(helpText("!!goto")).toEqual(["Unknown command '!!goto'. Type !help."]);
    expect(helpText("@goto")).toHaveLength(1);
  });
});

// ---------- glue: src/core/index.ts ----------

const alice: Sender = { id: "p1", name: "Alice", pos: { x: 0, y: 64, z: 0 } };

describe("handleChat glue", () => {
  it.each(["hello", "", "   ", "!!!", "! hi", "!", "/goto 1 2 3", "!1"])("non-command %j is not handled", (t) => {
    const colony = createColony();
    const spy = vi.spyOn(colony, "handle");
    expect(handleChat(colony, t, alice, 10)).toEqual({ handled: false, effects: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("parse errors become error + usage replies to the sender only, without reaching the colony", () => {
    const colony = createColony();
    const spy = vi.spyOn(colony, "handle");
    expect(handleChat(colony, "!goto 1", alice, 10)).toEqual({
      handled: true,
      effects: [
        { kind: "reply", to: "p1", text: "Missing y coordinate." },
        { kind: "reply", to: "p1", text: "Usage: !goto <x> <y> <z> [count]" },
      ],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("unknown command is a single reply with no usage line", () => {
    const colony = createColony();
    expect(handleChat(colony, "!dance", alice, 10)).toEqual({
      handled: true,
      effects: [{ kind: "reply", to: "p1", text: "Unknown command '!dance'. Type !help." }],
    });
  });

  it("!help and !help <topic> render helpText as replies to the sender", () => {
    const colony = createColony();
    const spy = vi.spyOn(colony, "handle");
    const all = handleChat(colony, "!help", alice, 10);
    expect(all.handled).toBe(true);
    expect(all.effects).toEqual(helpText().map((text) => ({ kind: "reply", to: "p1", text })));
    for (const t of ["!help goto", "!HELP !GoTo", "!help nonsense"]) {
      const topic = t.split(" ")[1]!;
      expect(handleChat(colony, t, alice, 10).effects).toEqual(
        helpText(topic).map((text) => ({ kind: "reply", to: "p1", text })),
      );
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("help and parse errors don't consume the command cooldown", () => {
    const colony = createColony();
    handleChat(colony, "!help", alice, 100);
    handleChat(colony, "!goto x", alice, 100);
    const out = handleChat(colony, "!spawn", alice, 100);
    expect(out.effects.some((e) => e.kind === "spawn")).toBe(true);
  });

  it("valid commands are forwarded once as a command event with the given tick", () => {
    const colony = createColony();
    const spy = vi.spyOn(colony, "handle");
    const out = handleChat(colony, "  !GOTO ~1 64 -3 2 ", alice, 1234);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      kind: "command",
      now: 1234,
      sender: alice,
      command: { kind: "goto", target: { x: rel(1), y: abs(64), z: abs(-3) }, count: 2 },
    });
    expect(out).toEqual({ handled: true, effects: spy.mock.results[0]!.value });
  });

  it("forwards each non-help kind", () => {
    for (const t of ["!status", "!spawn Bob", "!come", "!stop @Bot-1", "!override", "!queue"]) {
      const colony = createColony();
      const spy = vi.spyOn(colony, "handle");
      expect(handleChat(colony, t, alice, 7).handled).toBe(true);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: "command", now: 7, command: ok(t) }));
    }
  });

  it("uses the colony's configured prefix", () => {
    const colony = createColony({ prefix: "." });
    expect(handleChat(colony, "!help", alice, 1)).toEqual({ handled: false, effects: [] });
    expect(handleChat(colony, ".help", alice, 1).effects[1]).toEqual({ kind: "reply", to: "p1", text: ".help [command]" });
    expect(handleChat(colony, ".come 0", alice, 1).effects).toEqual([
      { kind: "reply", to: "p1", text: "Count must be a whole number from 1 to 16." },
      { kind: "reply", to: "p1", text: "Usage: .come [count]" },
    ]);
  });
});

describe("help topic echo", () => {
  it("clips long topics and strips section signs", () => {
    const [line] = helpText("\u00a7c" + "z".repeat(5000));
    expect(line).toBe(`Unknown command '!c${"z".repeat(18)}\u2026'. Type !help.`);
  });
});
