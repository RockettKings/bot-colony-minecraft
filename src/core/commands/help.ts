// Help text, rendered from COMMAND_SPECS so it can't drift from the grammar.
import { echo } from "./parse.js";
import { COMMAND_SPECS, findSpec } from "./specs.js";

export function helpText(topic?: string, prefix = "!"): string[] {
  const t = topic?.trim() ?? "";
  if (t === "") {
    return [`Colony commands (${prefix}help <command> for details):`, ...COMMAND_SPECS.map((s) => prefix + s.usage)];
  }
  const name = prefix.length > 0 && t.startsWith(prefix) ? t.slice(prefix.length) : t;
  const spec = findSpec(name);
  if (!spec) return [`Unknown command '${prefix}${echo(name.toLowerCase())}'. Type ${prefix}help.`];
  return [`Usage: ${prefix}${spec.usage}`, spec.description];
}
