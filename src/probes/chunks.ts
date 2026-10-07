// Spike 3: does a simulated player keep ticking (moving) when it is far (>= 160 blocks, per spec) from
// every real player? We keep commanding it to walk +x the whole time, so a frozen position beyond FAR
// while its chunk is unloaded (or it went invalid) means "not ticking".
import { Player, system, world } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import {
  ProbeReport,
  copy,
  errMsg,
  fmtVec,
  hdist,
  isSimulated,
  safeDisconnect,
  sleep,
  spawnBotNear,
  trace,
  waitOnGround,
} from "./util.js";

const FAR = 160; // "away" threshold (spec: ~160+), horizontal blocks from the nearest real player
const OVERSHOOT = 340; // target well past FAR (+x) so the bot should still be moving while beyond FAR
const TOTAL_SECONDS = 120; // hard cap: ~40 s to get past FAR at walking speed + FAR_SECONDS + slack
const FAR_SECONDS = 30; // stop early once we have this many 1-s samples beyond FAR
const WAYPOINT = 8; // fallback straight-line step length
const MOVED_EPS = 0.2; // blocks per second that count as "moved"

interface Sample {
  t: number;
  pos?: Vector3;
  valid: boolean;
  chunkLoaded?: boolean;
  dReal: number; // horizontal distance to nearest real player in the same dimension (Infinity if none)
  moved: number; // horizontal distance since previous sample
}

function nearestRealPlayer(pos: Vector3, dimId: string, botId: string): number {
  let best = Number.POSITIVE_INFINITY; // no real player in this dimension = nobody nearby
  try {
    for (const p of world.getAllPlayers()) {
      if (p.id === botId || isSimulated(p) || p.dimension.id !== dimId) continue;
      const d = hdist(p.location, pos);
      if (d < best) best = d;
    }
  } catch {
    /* ignore */
  }
  return best;
}

export async function chunksProbe(player: Player): Promise<void> {
  const r = new ProbeReport("chunks");
  let bot: SimulatedPlayer | undefined;
  const botName = `Probe-far-${system.currentTick % 1000}`;
  try {
    const playerStart = copy(player.location);
    try {
      bot = spawnBotNear(player, botName, 2, 0);
    } catch (e) {
      r.end("FAIL", `spawnSimulatedPlayer threw: ${errMsg(e)}`);
      return;
    }
    await waitOnGround(bot, 60);
    const dimId = bot.dimension.id;
    const botId = bot.id;
    const dim = bot.dimension;
    const origin = copy(bot.location);
    const farTarget: Vector3 = { x: origin.x + OVERSHOOT, y: origin.y, z: origin.z };
    try {
      bot.isSprinting = true;
    } catch {
      /* optional */
    }
    let mode = "navigateToLocation";
    try {
      const res = bot.navigateToLocation(farTarget);
      r.fact("nav.isFullPath", res.isFullPath);
      r.fact("nav.pathLen", res.getPath().length);
      if (res.getPath().length === 0) mode = "waypoints";
    } catch (e) {
      r.note(`navigateToLocation(far) threw: ${errMsg(e)} - using waypoints`, false);
      mode = "waypoints";
    }
    r.note(`stay where you are. The bot walks east (+x) from ${fmtVec(origin)} for up to ${TOTAL_SECONDS} s (1 sample/s)`);

    const samples: Sample[] = [];
    let prev: Vector3 | undefined = copy(bot.location);
    let stuckSeconds = 0;
    let triedFly = false;
    let farCount = 0;
    let maxDx = 0;
    let playerWandered = 0;

    for (let t = 1; t <= TOTAL_SECONDS; t++) {
      await sleep(20);
      const s: Sample = { t, valid: false, dReal: Number.NaN, moved: 0 };
      try {
        s.valid = bot.isValid;
        if (s.valid) {
          const pos = copy(bot.location);
          s.pos = pos;
          s.moved = prev ? hdist(pos, prev) : 0;
          prev = pos;
          s.dReal = nearestRealPlayer(pos, dimId, botId);
          try {
            s.chunkLoaded = dim.isChunkLoaded(pos);
          } catch {
            s.chunkLoaded = undefined;
          }
          maxDx = Math.max(maxDx, pos.x - origin.x);
        }
      } catch (e) {
        trace(`chunks: sample ${t} error ${errMsg(e)}`);
      }
      try {
        if (player.isValid) playerWandered = Math.max(playerWandered, hdist(player.location, playerStart));
      } catch {
        /* ignore */
      }
      samples.push(s);
      trace(
        `chunks t=${t}s valid=${s.valid} pos=${s.pos ? fmtVec(s.pos) : "-"} moved=${s.moved.toFixed(2)} dReal=${Number.isFinite(s.dReal) ? s.dReal.toFixed(1) : "none"} chunkLoaded=${String(s.chunkLoaded)}`,
      );
      if (t % 10 === 0) r.note(`t=${t}s dx=${maxDx.toFixed(0)} dReal=${Number.isFinite(s.dReal) ? s.dReal.toFixed(0) : "none"} valid=${s.valid}`, true);

      if (!s.valid) {
        // Entity unloaded/removed: keep sampling a few seconds in case it comes back, then stop.
        if (samples.slice(-5).every((x) => !x.valid)) break;
        continue;
      }
      if (s.dReal >= FAR) farCount++;
      if (farCount >= FAR_SECONDS) break;

      // Keep it moving. Re-issue a short straight-line step whenever progress stalls or in waypoint mode.
      if (s.moved < MOVED_EPS) stuckSeconds++;
      else stuckSeconds = 0;
      if (s.pos && (mode === "waypoints" || stuckSeconds >= 2)) {
        try {
          if (stuckSeconds >= 2) bot.jump();
          if (stuckSeconds >= 6 && !triedFly) {
            triedFly = true;
            bot.fly();
            r.note("bot stuck for 6 s - trying fly() to clear terrain", false);
          }
          const yBoost = triedFly ? 3 : 0;
          bot.moveToLocation({ x: s.pos.x + WAYPOINT, y: s.pos.y + yBoost, z: origin.z });
          mode = "waypoints";
        } catch (e) {
          trace(`chunks: step error ${errMsg(e)}`);
        }
      }
    }

    // ---- analysis ----
    const far = samples.filter((s) => s.valid && s.dReal >= FAR);
    // Intervals beyond FAR: sample i and i-1 both valid and beyond FAR.
    let farIntervals = 0;
    let farMoving = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (!a || !b || !a.valid || !b.valid || a.dReal < FAR || b.dReal < FAR) continue;
      farIntervals++;
      if (b.moved >= MOVED_EPS) farMoving++;
    }
    const farUnloaded = far.filter((s) => s.chunkLoaded === false).length;
    const wentInvalid = samples.some((s) => !s.valid);
    const firstInvalid = samples.find((s) => !s.valid);
    const lastValid = [...samples].reverse().find((s) => s.valid);
    r.fact("maxDx", maxDx);
    r.fact(`farSamples(>=${FAR})`, far.length);
    r.fact("farIntervalsMoving", `${farMoving}/${farIntervals}`);
    r.fact("farChunkUnloaded", farUnloaded);
    r.fact("wentInvalid", wentInvalid ? `yes at t=${firstInvalid?.t}s` : "no");
    r.fact("lastValid.dReal", lastValid?.dReal ?? Number.NaN);
    r.fact("playerWandered", playerWandered);
    r.fact("flew", triedFly);

    if (playerWandered > 16) {
      r.end("INCONCLUSIVE", `you moved ${playerWandered.toFixed(0)} blocks - stay put and rerun`);
    } else if (wentInvalid && (lastValid?.dReal ?? 0) >= FAR - 32) {
      r.end("FAIL", `bot became invalid ~${(lastValid?.dReal ?? 0).toFixed(0)} blocks from you - it does NOT stay loaded when far away`);
    } else if (farIntervals < 5) {
      r.end("INCONCLUSIVE", `bot only got ${maxDx.toFixed(0)} blocks away (needs >${FAR}); use a flat world or a clear path east (+x)`);
    } else if (farMoving / farIntervals >= 0.6) {
      r.end("PASS", `bot kept moving beyond ${FAR} blocks (${farMoving}/${farIntervals} 1-s intervals moved, ${farUnloaded} samples in unloaded chunks) - it ticks away from players`);
    } else if (farUnloaded > 0 || farMoving === 0) {
      r.end("FAIL", `bot froze beyond ${FAR} blocks (${farMoving}/${farIntervals} intervals moved, chunkUnloaded=${farUnloaded}) - not ticking away from players`);
    } else {
      r.end("INCONCLUSIVE", `mixed movement beyond ${FAR} (${farMoving}/${farIntervals}); chunk stayed loaded - possibly stuck on terrain`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  } finally {
    const did = safeDisconnect(bot, botName);
    r.note(`cleanup: disconnect called=${did}${did ? "" : " (bot already gone or unloaded - check /list)"}`, false);
  }
}
