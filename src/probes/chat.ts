// Spike 2: does world.beforeEvents.chatSend fire, and does cancel=true suppress the message?
// Objective signal for suppression: the matching world.afterEvents.chatSend must NOT fire.
// Note: the colony runtime's own chatSend handler also sees "!probe-chat" (it is a "!" command) and
// may cancel it and reply "Unknown command" — that reply is expected and does not affect the result.
import { system, world } from "@minecraft/server";
import type { ChatSendAfterEvent, ChatSendBeforeEvent } from "@minecraft/server";
import { ProbeReport, errMsg } from "./util.js";

const TOKEN = "!probe-chat";
const WINDOW_TICKS = 600; // 30 s
const SETTLE_TICKS = 20; // wait this long after the event for a possible after-event

export function chatProbe(): Promise<void> {
  return new Promise((resolve) => {
    const r = new ProbeReport("chat");
    let beforeSig: typeof world.beforeEvents.chatSend | undefined;
    let afterSig: typeof world.afterEvents.chatSend | undefined;
    try {
      beforeSig = world.beforeEvents.chatSend;
    } catch (e) {
      r.note(`beforeEvents.chatSend threw: ${errMsg(e)}`);
    }
    if (!beforeSig || typeof beforeSig.subscribe !== "function") {
      r.end("FAIL", "world.beforeEvents.chatSend is unavailable (Beta APIs off?)");
      resolve();
      return;
    }
    try {
      afterSig = world.afterEvents.chatSend;
    } catch {
      afterSig = undefined;
    }

    let fired = 0;
    let cancelReadBack: boolean | undefined;
    let sender = "";
    let afterSeen = 0;
    let finished = false;
    let windowRun: number | undefined;
    let afterSub = false;

    const onBefore = (ev: ChatSendBeforeEvent): void => {
      try {
        if (ev.message.trim().toLowerCase() !== TOKEN) return;
        fired++;
        ev.cancel = true; // writing the event's own cancel field is allowed in restricted execution
        cancelReadBack = ev.cancel;
        sender = ev.sender.name;
        if (fired === 1) system.runTimeout(() => finish(), SETTLE_TICKS); // system.run* is restricted-safe; finish runs deferred
      } catch {
        /* never throw out of an event callback */
      }
    };
    const onAfter = (ev: ChatSendAfterEvent): void => {
      try {
        if (ev.message.trim().toLowerCase() === TOKEN) afterSeen++;
      } catch {
        /* ignore */
      }
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      try {
        if (windowRun !== undefined) system.clearRun(windowRun);
      } catch {
        /* ignore */
      }
      try {
        beforeSig?.unsubscribe(onBefore);
      } catch {
        /* ignore */
      }
      try {
        afterSig?.unsubscribe(onAfter);
      } catch {
        /* ignore */
      }
      r.fact("beforeFired", fired);
      r.fact("sender", sender || "-");
      r.fact("cancelReadBack", cancelReadBack);
      r.fact("afterEventAvailable", afterSub);
      r.fact("afterFiredForToken", afterSeen);
      if (fired === 0) {
        r.end("FAIL", `no chatSend before-event for '${TOKEN}' within 30 s (if nobody typed it, rerun)`);
      } else if (!afterSub) {
        r.end("INCONCLUSIVE", "before-event fired and cancel was set, but the after-event is unavailable - check by eye that the message was hidden");
      } else if (afterSeen === 0) {
        r.end("PASS", "before-event fired, cancel was set and no after-event followed. Check by eye that the message did NOT appear in chat");
      } else {
        r.end("FAIL", "before-event fired, but the message was still broadcast (after-event fired) - cancel has no effect");
      }
      resolve();
    };

    try {
      beforeSig.subscribe(onBefore);
    } catch (e) {
      r.end("FAIL", `chatSend.subscribe threw: ${errMsg(e)}`);
      resolve();
      return;
    }
    try {
      if (afterSig) {
        afterSig.subscribe(onAfter);
        afterSub = true;
      }
    } catch {
      afterSub = false;
    }
    r.note(`type §b${TOKEN}§r in chat within 30 s, then note whether it appeared in chat`);
    windowRun = system.runTimeout(() => finish(), WINDOW_TICKS);
  });
}
