// Glue between raw chat text and the colony core. Pure: no @minecraft imports.
import { helpText, isCommand, parseCommand } from "./commands/index.js";
import { Colony } from "./colony/index.js";
import type { ColonyConfig, Effect, Sender, Tick } from "./types.js";

export * from "./types.js";
export * from "./items.js";
export { Colony } from "./colony/index.js";
export { isCommand, parseCommand, helpText } from "./commands/index.js";

export function createColony(config?: Partial<ColonyConfig>): Colony {
  return new Colony(config);
}

export interface ChatOutcome {
  /** True when the text was a colony command (and should be hidden from public chat). */
  handled: boolean;
  effects: Effect[];
}

export function handleChat(colony: Colony, text: string, sender: Sender, now: Tick): ChatOutcome {
  const prefix = colony.config.prefix;
  if (!isCommand(text, prefix)) return { handled: false, effects: [] };

  const parsed = parseCommand(text, prefix);
  if (!parsed) return { handled: false, effects: [] };

  if (!parsed.ok) {
    const lines = parsed.usage ? [parsed.error, `Usage: ${parsed.usage}`] : [parsed.error];
    return { handled: true, effects: lines.map((line) => reply(sender.id, line)) };
  }

  if (parsed.command.kind === "help") {
    const lines = helpText(parsed.command.topic, prefix);
    return { handled: true, effects: lines.map((line) => reply(sender.id, line)) };
  }

  return { handled: true, effects: colony.handle({ kind: "command", now, sender, command: parsed.command }) };
}

function reply(to: string, text: string): Effect {
  return { kind: "reply", to, text };
}
