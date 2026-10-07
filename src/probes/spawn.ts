// Spike 1: does top-level spawnSimulatedPlayer work (ideally on a cheats-off world), and are a
// non-test simulated player's navigation coords ABSOLUTE world coords?
import { Player, system, world } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import {
  ProbeReport,
  copy,
  dist,
  errMsg,
  fmtVec,
  hdist,
  inPlayerList,
  safeDisconnect,
  sleep,
  spawnBotNear,
  waitOnGround,
  waitUntil,
} from "./util.js";

const ARRIVE = 1.5;
const STEP = 5;

function readCheats(): string {
  try {
    return String(world.allowCheats);
  } catch (e) {
    return `unknown (${errMsg(e)})`;
  }
}

/** Pick a standable cell STEP blocks away in a cardinal direction (solid below, two air above). */
function pickTarget(dim: Dimension, from: Vector3): { target: Vector3; dir: string } {
  const base = { x: Math.floor(from.x), y: Math.floor(from.y + 0.01), z: Math.floor(from.z) };
  const dirs: [string, number, number][] = [
    ["+x", STEP, 0],
    ["-x", -STEP, 0],
    ["+z", 0, STEP],
    ["-z", 0, -STEP],
  ];
  for (const [name, dx, dz] of dirs) {
    try {
      const x = base.x + dx;
      const z = base.z + dz;
      const below = dim.getBlock({ x, y: base.y - 1, z });
      const feet = dim.getBlock({ x, y: base.y, z });
      const head = dim.getBlock({ x, y: base.y + 1, z });
      if (below?.isSolid && feet?.isAir && head?.isAir) return { target: { x: x + 0.5, y: base.y, z: z + 0.5 }, dir: name };
    } catch {
      /* try next */
    }
  }
  return { target: { x: base.x + STEP + 0.5, y: base.y, z: base.z + 0.5 }, dir: "+x (unchecked)" };
}

export async function spawnProbe(player: Player): Promise<void> {
  const r = new ProbeReport("spawn");
  const cheats = readCheats();
  r.fact("allowCheats", cheats);
  let bot: SimulatedPlayer | undefined;
  const botName = `Probe-${system.currentTick % 100000}`;
  try {
    try {
      bot = spawnBotNear(player, botName, 2, 0);
    } catch (e) {
      r.end("FAIL", `top-level spawnSimulatedPlayer threw (cheats=${cheats}): ${errMsg(e)}`);
      return;
    }
    const botId = bot.id;
    const listed = await waitUntil(() => inPlayerList(botId), 40, 2);
    r.fact("isValid", bot.isValid);
    r.fact("inGetAllPlayers", listed);
    try {
      r.fact("gameMode", bot.getGameMode());
    } catch (e) {
      r.fact("gameMode", `err ${errMsg(e)}`);
    }
    if (!bot.isValid) {
      r.end("FAIL", `spawn returned but bot is not valid (cheats=${cheats})`);
      return;
    }

    const grounded = await waitOnGround(bot, 60);
    r.fact("onGround", grounded);
    const start = copy(bot.location);
    const { target, dir } = pickTarget(bot.dimension, start);
    r.fact("start", start);
    r.fact("target(abs)", target);
    r.fact("dir", dir);
    r.note(`navigating ${STEP} blocks ${dir} to ABSOLUTE ${fmtVec(target)}`);

    let method = "navigateToLocation";
    try {
      const res = bot.navigateToLocation(target);
      const path = res.getPath();
      const last = path[path.length - 1];
      r.fact("nav.isFullPath", res.isFullPath);
      r.fact("nav.pathLen", path.length);
      if (last) {
        r.fact("nav.pathEnd", last);
        r.fact("nav.pathEndToTarget", dist(last, target));
      }
    } catch (e) {
      r.note(`navigateToLocation threw: ${errMsg(e)}`);
      method = "none";
    }

    const near = () => bot !== undefined && bot.isValid && dist(bot.location, target) <= ARRIVE;
    let arrived = await waitUntil(near, 100, 2);
    let end = copy(bot.location);
    let moved = hdist(end, start);

    if (!arrived && moved < 0.5) {
      // Navigation didn't move it at all: try a straight-line move as a second opinion.
      r.note("no movement from navigation; retrying with moveToLocation");
      try {
        bot.moveToLocation(target);
        method = "moveToLocation (fallback)";
        arrived = await waitUntil(near, 60, 2);
        end = copy(bot.location);
        moved = hdist(end, start);
      } catch (e) {
        r.note(`moveToLocation threw: ${errMsg(e)}`);
      }
    }

    const off = { x: end.x - target.x, y: end.y - target.y, z: end.z - target.z };
    r.fact("method", method);
    r.fact("end", end);
    r.fact("endToTarget", dist(end, target));
    r.fact("offset", off);
    r.fact("moved", moved);
    try {
      bot.stopMoving();
    } catch {
      /* ignore */
    }

    const cheatsOff = cheats === "false";
    if (arrived) {
      const msg = `spawn OK (cheats=${cheats}), bot listed=${listed}, reached absolute target via ${method} -> coords are ABSOLUTE`;
      if (cheatsOff) r.end("PASS", msg);
      else r.end("INCONCLUSIVE", `${msg}; but cheats are not OFF - rerun on a cheats-off world`);
    } else if (moved < 0.5) {
      r.end("INCONCLUSIVE", `spawn OK (cheats=${cheats}) but the bot never moved - stand on open flat ground and rerun`);
    } else {
      r.end("FAIL", `spawn OK (cheats=${cheats}) but bot ended ${fmtVec(off)} away from the absolute target - coords look NOT absolute (or blocked)`);
    }
  } catch (e) {
    r.end("INCONCLUSIVE", `probe error: ${errMsg(e)}`);
  } finally {
    const id = bot?.id;
    const did = safeDisconnect(bot, botName);
    if (id !== undefined) {
      await sleep(10);
      const still = inPlayerList(id);
      r.note(`cleanup: disconnect called=${did}, still listed after 10 ticks=${still}`, false);
    }
  }
}
