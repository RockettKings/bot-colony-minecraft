// Help text, rendered from COMMAND_SPECS so it can't drift from the grammar.
import { RESOURCE_NAMES_HINT } from "../items.js";
import type { CommandKind } from "../types.js";
import { echo } from "./parse.js";
import { COMMAND_SPECS, findSpec } from "./specs.js";

/** Extra lines shown after usage + description for `help <topic>`. Commands not listed get none. */
function extraHelp(name: CommandKind, prefix: string): string[] {
  switch (name) {
    case "gather":
      return [
        `Items: ${RESOURCE_NAMES_HINT}. Aliases: wood, stone, cobble.`,
        `Example: ${prefix}gather oak_log 32 2 (two bots, 16 each).`,
      ];
    case "chest":
      return [`Look at a chest (or stand next to one) and type ${prefix}chest set. Bots deliver there.`];
    default:
      return [];
  }
}

export function helpText(topic?: string, prefix = "!"): string[] {
  const t = topic?.trim() ?? "";
  if (t === "") {
    return [`Colony commands (${prefix}help <command> for details):`, ...COMMAND_SPECS.map((s) => prefix + s.usage)];
  }
  const name = prefix.length > 0 && t.startsWith(prefix) ? t.slice(prefix.length) : t;
  const spec = findSpec(name);
  if (!spec) return [`Unknown command '${prefix}${echo(name.toLowerCase())}'. Type ${prefix}help.`];
  return [`Usage: ${prefix}${spec.usage}`, spec.description, ...extraHelp(spec.name, prefix)];
}
