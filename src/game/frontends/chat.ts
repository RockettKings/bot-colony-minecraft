// Front-end (a): `!` commands typed in chat, via world.beforeEvents.chatSend (beta).
import { system, world, type Player } from "@minecraft/server";
import { isCommand } from "../../core/index.js";
import { logError, logInfo, logWarn } from "../log.js";

export type SubmitFn = (player: Player, text: string) => void;

/** Returns true if the subscription succeeded. */
export function installChatFrontend(prefix: string, submit: SubmitFn): boolean {
  let signal: typeof world.beforeEvents.chatSend | undefined;
  try {
    signal = world.beforeEvents.chatSend;
  } catch (err) {
    logError("world.beforeEvents.chatSend threw", err);
  }
  if (!signal || typeof signal.subscribe !== "function") {
    logWarn("world.beforeEvents.chatSend unavailable; use /colony:c <text> instead");
    return false;
  }
  try {
    signal.subscribe((ev) => {
      // Before-events run in restricted (read-only) execution: only decide + cancel here, defer the rest.
      // Reading message/sender and writing ev.cancel are allowed; system.run has no restricted-execution
      // privilege annotation, so it may be called here. The sender is validated when the deferred run fires.
      try {
        const message = ev.message;
        if (!isCommand(message, prefix)) return;
        ev.cancel = true;
        const sender = ev.sender;
        system.run(() => submit(sender, message));
      } catch (err) {
        logError("chatSend handler failed", err);
      }
    });
    logInfo("chat front-end installed");
    return true;
  } catch (err) {
    logError("chatSend.subscribe failed; use /colony:c <text> instead", err);
    return false;
  }
}
