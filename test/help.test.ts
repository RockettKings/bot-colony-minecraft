import { describe, expect, it } from "vitest";
import { COMMAND_SPECS, helpText } from "../src/core/commands/index.js";
import { RESOURCE_NAMES_HINT } from "../src/core/items.js";

const descOf = (name: string) => COMMAND_SPECS.find((s) => s.name === name)!.description;

describe("helpText: Phase 2 topics", () => {
  it("gather: usage, description, items + aliases, example", () => {
    expect(helpText("gather")).toEqual([
      "Usage: !gather <item> [amount] [bots]",
      descOf("gather"),
      `Items: ${RESOURCE_NAMES_HINT}. Aliases: wood, stone, cobble.`,
      "Example: !gather oak_log 32 2 (two bots, 16 each).",
    ]);
  });

  it("chest: usage, description, how to set it", () => {
    expect(helpText("chest")).toEqual([
      "Usage: !chest [set]",
      descOf("chest"),
      "Look at a chest (or stand next to one) and type !chest set. Bots deliver there.",
    ]);
  });

  it("prefix optional and case-insensitive for the new topics", () => {
    expect(helpText("!GATHER")).toEqual(helpText("gather"));
    expect(helpText("Chest")).toEqual(helpText("chest"));
  });

  it("extra lines follow a custom prefix", () => {
    expect(helpText("gather", ".")[3]).toBe("Example: .gather oak_log 32 2 (two bots, 16 each).");
    expect(helpText(".chest", ".")[2]).toBe("Look at a chest (or stand next to one) and type .chest set. Bots deliver there.");
  });
});

describe("helpText: other output unchanged", () => {
  it("every other topic is exactly usage + description", () => {
    for (const s of COMMAND_SPECS) {
      if (s.name === "gather" || s.name === "chest") continue;
      expect(helpText(s.name)).toEqual([`Usage: !${s.usage}`, s.description]);
    }
  });

  it("no topic: header plus one usage line per spec (no extra lines)", () => {
    const lines = helpText();
    expect(lines).toHaveLength(COMMAND_SPECS.length + 1);
    expect(lines.slice(1)).toEqual(COMMAND_SPECS.map((s) => `!${s.usage}`));
  });

  it("unknown topic is one error line", () => {
    expect(helpText("chests")).toEqual(["Unknown command '!chests'. Type !help."]);
  });
});
