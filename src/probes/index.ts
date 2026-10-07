// Spike probes (Job 4). Entry: registerProbes(), called once at script load (early-execution).
// - Startup probe: logs which raw mechanisms exist (top-level spawnSimulatedPlayer, chatSend, custom commands).
// - /colony:probe <spawn|chat|chunks|reload>: runs one spike probe. Permission Any, no cheats.
// Probes deliberately bypass src/game: they test the engine, not our runtime.
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world,
} from "@minecraft/server";
import type { CustomCommandOrigin, CustomCommandResult, StartupEvent } from "@minecraft/server";
import * as gametest from "@minecraft/server-gametest";
import { chatProbe } from "./chat.js";
import { chunksProbe } from "./chunks.js";
import { reloadProbe } from "./reload.js";
import { spawnProbe } from "./spawn.js";
import { ProbeReport, errMsg, isSimulated, log } from "./util.js";

const PROBES = ["spawn", "chat", "chunks", "reload"] as const;
type ProbeName = (typeof PROBES)[number];
const ENUM_NAME = "colony:probename";
const COMMAND_NAME = "colony:probe";

let registered = false;
let commandStatus = "startup event not seen";
const running = new Set<ProbeName>();

function isProbeName(v: unknown): v is ProbeName {
  return typeof v === "string" && (PROBES as readonly string[]).includes(v);
}

function originPlayer(origin: CustomCommandOrigin): Player | undefined {
  try {
    const e = origin.sourceEntity ?? origin.initiator;
    if (e instanceof Player) return e;
  } catch {
    /* ignore */
  }
  return undefined;
}

function runProbe(name: ProbeName, invoker: Player | undefined): void {
  if (running.has(name)) {
    log(`${name}: already running - wait for its RESULT line`);
    return;
  }
  const player = invoker ?? world.getAllPlayers().find((p) => !isSimulated(p));
  if ((name === "spawn" || name === "chunks") && !player) {
    log(`${name}: RESULT INCONCLUSIVE - needs a real player in the world to run near`);
    return;
  }
  running.add(name);
  const done = (): void => {
    running.delete(name);
  };
  const fail = (e: unknown): void => {
    log(`${name}: RESULT INCONCLUSIVE - uncaught probe error: ${errMsg(e)}`);
    done();
  };
  try {
    switch (name) {
      case "spawn":
        if (player) spawnProbe(player).then(done, fail);
        break;
      case "chat":
        chatProbe().then(done, fail);
        break;
      case "chunks":
        if (player) chunksProbe(player).then(done, fail);
        break;
      case "reload":
        reloadProbe();
        done();
        break;
    }
  } catch (e) {
    fail(e);
  }
}

function onProbeCommand(origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult | undefined {
  // Custom-command callbacks run in restricted execution: capture inputs, do the work in system.run.
  try {
    const arg = args[0];
    if (!isProbeName(arg)) {
      return { status: CustomCommandStatus.Failure, message: `Unknown probe '${String(arg)}'. Use: ${PROBES.join(", ")}` };
    }
    const invoker = originPlayer(origin);
    system.run(() => {
      try {
        runProbe(arg, invoker);
      } catch (e) {
        log(`${arg}: RESULT INCONCLUSIVE - ${errMsg(e)}`);
      }
    });
    // No message: ProbeReport already prints "<name>: started" to chat.
    return { status: CustomCommandStatus.Success };
  } catch (e) {
    return { status: CustomCommandStatus.Failure, message: `[probe] error: ${errMsg(e)}` };
  }
}

function onStartup(ev: StartupEvent): void {
  try {
    const reg = ev.customCommandRegistry;
    reg.registerEnum(ENUM_NAME, [...PROBES]); // must be registered before the command that uses it
    reg.registerCommand(
      {
        name: COMMAND_NAME,
        description: "Run a colony spike probe: spawn, chat, chunks or reload",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "probe", type: CustomCommandParamType.Enum, enumName: ENUM_NAME }],
      },
      onProbeCommand,
    );
    commandStatus = "registered";
  } catch (e) {
    commandStatus = `registration failed: ${errMsg(e)}`;
  }
}

// ---------- startup probe ----------

function startupProbe(toChat: boolean): void {
  const r = new ProbeReport("startup");
  let spawnFn = false;
  let chatSend = false;
  let chatSendErr = "";
  let cheats = "unknown";
  try {
    spawnFn = typeof gametest.spawnSimulatedPlayer === "function";
  } catch {
    spawnFn = false;
  }
  try {
    const sig = world.beforeEvents.chatSend;
    chatSend = !!sig && typeof sig.subscribe === "function";
  } catch (e) {
    chatSendErr = errMsg(e);
  }
  try {
    cheats = String(world.allowCheats);
  } catch {
    /* beta property may be missing */
  }
  r.fact("spawnSimulatedPlayer(top-level)", spawnFn);
  r.fact("beforeEvents.chatSend", chatSend ? true : `false${chatSendErr ? ` (${chatSendErr})` : ""}`);
  r.fact("customCommand /colony:probe", commandStatus);
  r.fact("allowCheats", cheats);
  const ok = spawnFn && chatSend && commandStatus === "registered";
  const summary = ok
    ? "all three mechanisms are present (existence only; run /colony:probe spawn|chat|chunks|reload for behaviour)"
    : "a required mechanism is missing - check that Beta APIs is on, then check the content log";
  if (!toChat) {
    // Content log only (no players yet); the chat copy is sent when the first real player spawns.
    log(`startup: spawn=${spawnFn} chatSend=${chatSend} command=${commandStatus} cheats=${cheats}`, false);
  }
  r.end(ok ? "PASS" : "FAIL", summary);
}

export function registerProbes(): void {
  if (registered) return;
  registered = true;

  try {
    system.beforeEvents.startup.subscribe(onStartup);
  } catch (e) {
    commandStatus = `startup subscribe failed: ${errMsg(e)}`;
  }

  // Once after world load: report to the content log. Chat messages before any player joins are lost,
  // so also report once to chat after the first real player spawns.
  let reportedToChat = false;
  try {
    const onLoad = (): void => {
      system.run(() => {
        try {
          startupProbe(false);
        } catch (e) {
          log(`startup: RESULT INCONCLUSIVE - ${errMsg(e)}`, false);
        }
      });
    };
    world.afterEvents.worldLoad.subscribe(onLoad);
  } catch (e) {
    log(`startup: worldLoad subscribe failed: ${errMsg(e)}`, false);
  }
  try {
    const onSpawn = (ev: { initialSpawn: boolean; player: Player }): void => {
      try {
        if (reportedToChat || !ev.initialSpawn || isSimulated(ev.player)) return;
        reportedToChat = true;
        system.runTimeout(() => {
          try {
            startupProbe(true);
          } catch (e) {
            log(`startup: RESULT INCONCLUSIVE - ${errMsg(e)}`);
          }
        }, 60);
      } catch {
        /* never throw out of an event callback */
      }
    };
    world.afterEvents.playerSpawn.subscribe(onSpawn);
  } catch (e) {
    log(`startup: playerSpawn subscribe failed: ${errMsg(e)}`, false);
  }
}
