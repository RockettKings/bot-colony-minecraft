// Spike 4: do simulated players survive save & quit + reload?
// Each run lists the simulated players present and stores that list (plus a per-script-session
// token) in a world dynamic property. A later run in a NEW script session (= the world was
// reloaded) compares against the stored list.
import { system, world } from "@minecraft/server";
import { ProbeReport, errMsg, fmtVec, isSimulated } from "./util.js";

const KEY = "colony:probe_reload";
/** Random per script-load; differs after a world reload (or /reload). */
const SESSION = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

interface Snapshot {
  session: string;
  names: string[];
  /** system.currentTick when the snapshot was stored (ticks since this world was opened). */
  tick?: number;
}

function readPrev(): Snapshot | undefined {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw !== "string") return undefined;
    const v = JSON.parse(raw) as Partial<Snapshot>;
    if (typeof v.session === "string" && Array.isArray(v.names)) {
      return { session: v.session, names: v.names.map(String), tick: typeof v.tick === "number" ? v.tick : undefined };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function reloadProbe(): void {
  const r = new ProbeReport("reload");
  try {
    // After a reload this script session holds no SimulatedPlayer handles, so getAllPlayers() may return
    // plain Player wrappers and isSimulated() can miss bots that did survive. So: the baseline records the
    // names detected as simulated, but the comparison checks those names against ALL current players.
    const all = world.getAllPlayers();
    const allNames = all.map((p) => p.name);
    const sims = all.filter(isSimulated);
    const names = sims.map((p) => p.name);
    r.fact("players", allNames);
    if (sims.length === 0) r.note("no simulated players detected in the world");
    for (const p of sims) {
      let where = "?";
      try {
        where = `${fmtVec(p.location)} ${p.dimension.id} valid=${p.isValid}`;
      } catch (e) {
        where = `err ${errMsg(e)}`;
      }
      r.note(`simulated player '${p.name}' at ${where}`);
    }
    const prev = readPrev();
    try {
      world.setDynamicProperty(KEY, JSON.stringify({ session: SESSION, names, tick: system.currentTick } satisfies Snapshot));
    } catch (e) {
      r.note(`could not store snapshot: ${errMsg(e)}`);
    }
    r.fact("now", names);
    r.fact("prev", prev ? prev.names : "none");
    r.fact("reloadedSincePrev", prev ? prev.session !== SESSION : "n/a");
    // currentTick is expected to restart when the world is reopened but keep counting across /reload;
    // bots trivially survive a script-only /reload, so a larger tick than the baseline's is suspicious.
    const scriptOnly = prev?.tick !== undefined && prev.session !== SESSION && system.currentTick > prev.tick;
    r.fact("tick", `${prev?.tick ?? "?"} -> ${system.currentTick}`);

    if (!prev || prev.session === SESSION) {
      r.end(
        "INCONCLUSIVE",
        `baseline recorded (${names.length} simulated player${names.length === 1 ? "" : "s"}). Spawn bots first if 0. Then save & quit, reopen the world, wait ~5 s and run /colony:probe reload again`,
      );
      return;
    }
    // Not a verdict change: the d.ts doesn't say whether currentTick restarts on world open, so just flag it.
    if (scriptOnly) r.note("tick did not restart since the baseline - this looks like /reload, not Save & Quit + reopen");
    if (prev.names.length === 0) {
      r.end("INCONCLUSIVE", "reload detected, but the baseline had no bots. Spawn some, record a baseline, reload and rerun");
      return;
    }
    const survived = prev.names.filter((n) => allNames.includes(n));
    const notDetected = survived.filter((n) => !names.includes(n));
    if (notDetected.length > 0) r.fact("presentButNotDetectedAsSimulated", notDetected);
    r.fact("survived", survived);
    if (survived.length === prev.names.length) {
      r.end("PASS", `${survived.length === 1 ? "the 1 simulated player" : `all ${survived.length} simulated players`} came back after the reload (the Phase 1 runtime does not re-adopt them)`);
    } else if (survived.length === 0) {
      r.end("FAIL", `${prev.names.length === 1 ? "the 1 simulated player did not come" : `none of ${prev.names.length} simulated players came`} back after the reload - the colony must respawn bots itself`);
    } else {
      r.end("INCONCLUSIVE", `${survived.length}/${prev.names.length} came back - rerun in a few seconds (late join?)`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  }
}
