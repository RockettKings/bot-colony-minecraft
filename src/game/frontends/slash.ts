// Front-end (b): fallback slash command `/colony:c <text>`; works without Beta chat events.
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
  type CustomCommandResult,
} from "@minecraft/server";
import { logError, logInfo } from "../log.js";
import type { SubmitFn } from "./chat.js";

export const SLASH_COMMAND = "colony:c";

/** Prepend the prefix unless the text already carries it (`/colony:c come` == `/colony:c !come`). */
export function withPrefix(text: string, prefix: string): string {
  const t = text.trim();
  return t.startsWith(prefix) ? t : `${prefix}${t}`;
}

const USAGE = `Usage: /${SLASH_COMMAND} <command> [args...] (or quote it: /${SLASH_COMMAND} "goto 1 2 3")`;

/**
 * The player behind a command origin, or undefined for blocks/server/non-player entities.
 * sourceEntity covers a player typing the command (and /execute as <player>); initiator covers
 * NPC dialogue, where sourceEntity is the NPC. Reading origin fields is allowed in restricted execution.
 */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  try {
    const src = origin.sourceEntity;
    if (src instanceof Player) return src;
    const init = origin.initiator;
    if (init instanceof Player) return init;
  } catch (err) {
    logError(`/${SLASH_COMMAND}: could not read command origin`, err);
  }
  return undefined;
}

/**
 * Must be called during script load (before the startup event fires).
 * Registration happens in system.beforeEvents.startup (early execution).
 */
export function installSlashFrontend(prefix: string, submit: SubmitFn): void {
  try {
    system.beforeEvents.startup.subscribe((ev) => {
      try {
        ev.customCommandRegistry.registerCommand(
          {
            name: SLASH_COMMAND,
            description: `Run a colony command, e.g. /${SLASH_COMMAND} come (same as ${prefix}come in chat)`,
            permissionLevel: CommandPermissionLevel.Any,
            cheatsRequired: false,
            // CustomCommandParamType has no message/rawtext type, and a String param captures one token
            // (or one "quoted string"), so the line is spread over 5 String params and re-joined: enough for
            // the longest command, goto <x> <y> <z> [count]. Longer input, or tokens the engine's String
            // parser rejects, must be quoted as one string. Whether "~5", "-3" and "@Bot-1" parse as plain
            // tokens is a SPIKE-CHECKLIST item.
            mandatoryParameters: [{ name: "text", type: CustomCommandParamType.String }],
            optionalParameters: [
              { name: "arg1", type: CustomCommandParamType.String },
              { name: "arg2", type: CustomCommandParamType.String },
              { name: "arg3", type: CustomCommandParamType.String },
              { name: "arg4", type: CustomCommandParamType.String },
            ],
          },
          (origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult => {
            const source = playerOf(origin);
            if (!source) {
              return { status: CustomCommandStatus.Failure, message: "Only players can use colony commands." };
            }
            const parts = args.filter((a): a is string => typeof a === "string" && a.trim().length > 0);
            if (parts.length === 0) {
              return { status: CustomCommandStatus.Failure, message: USAGE };
            }
            const text = withPrefix(parts.join(" "), prefix);
            // Custom-command callbacks run in restricted execution: only read origin/args here, defer the rest.
            system.run(() => submit(source, text));
            return { status: CustomCommandStatus.Success };
          },
        );
        logInfo(`registered /${SLASH_COMMAND}`);
      } catch (err) {
        logError(`registerCommand /${SLASH_COMMAND} failed`, err);
      }
    });
  } catch (err) {
    logError("system.beforeEvents.startup unavailable", err);
  }
}
