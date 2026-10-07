// Phase 2 GameTests: colony chest + gathering (Job 6). Imported by src/gametests/index.ts for side effects.
// Run on a dev world (cheats on, Beta APIs on):  /gametest runset colony   or   /gametest run colony:gather_logs
//
// Bots come from the TOP-LEVEL spawn only (helpers.spawnBot(test, "toplevel", ...)): the coordinate frame of
// breakBlock / lookAtBlock / navigate* for test-spawned players is unverified (SPIKE §5).
// Scene setup uses test.setBlockType (chest) and container.setItem (prefill) for SETUP ONLY; bots never get
// items or blocks that way. Observability: snapshot(), recentReplies(sender.id), the chest's inventory.
//
// Structures (scripts/make-structure.mjs): colony:flat, colony:grove (3 oak columns), colony:quarry (stone pad).
// The colony chest only resolves in the overworld for GameTest senders (no online player -> the runtime's
// locateChest falls back to minecraft:overworld), so run these tests in the overworld.
import type { SimulatedPlayer, Test } from "@minecraft/server-gametest";
import { registerAsync } from "@minecraft/server-gametest";
import type { Vector3 } from "@minecraft/server";
import type { BotId, Sender } from "../core/types.js";
import {
  COOLDOWN,
  CRAFTING_TABLE,
  absCell,
  beginTest,
  botName,
  chestCount,
  chestStr,
  fillChest,
  findInArea,
  fmt,
  hasReply,
  isIdle,
  placeChest,
  repliesStr,
  runtime,
  sender,
  snapStr,
  spawnBot,
  view,
  waitAllIdle,
  waitGrounded,
} from "./helpers.js";

const CLASS = "colony";
const TAG = "colony";
const OAK = "minecraft:oak_log";
const COBBLE = "minecraft:cobblestone";
/** Chest cell (relative x/z) used by every gather test; the sender stands next to it. */
const CHEST_XZ = { x: 2, z: 2 };
const AREA = { x: 16, z: 16 };

/** Relative y of the stone floor. All structures here have it at relative y 0 (see make-structure.mjs). */
function floor(test: Test): number | undefined {
  for (const y of [0, 1, -1]) {
    try {
      if (test.getBlock({ x: 1, y, z: 1 }).typeId === "minecraft:stone") return y;
    } catch {
      /* out of bounds */
    }
  }
  test.fail("could not find the stone floor of the test structure");
  return undefined;
}

interface Scene {
  y: number; // feet layer (floor + 1)
  chestRel: Vector3;
  chestAbs: Vector3;
  s: Sender;
  bots: SimulatedPlayer[];
  ids: BotId[];
}

/**
 * Common setup: clean colony, chest at CHEST_XZ, `botCells` top-level bots adopted, sender next to the chest,
 * `!chest set` verified against the chest's absolute block position. undefined after test.fail.
 */
async function setup(test: Test, botCells: Array<{ x: number; z: number }>): Promise<Scene | undefined> {
  if (!(await beginTest(test))) return undefined;
  const fy = floor(test);
  if (fy === undefined) return undefined;
  const y = fy + 1;
  const chestRel = { x: CHEST_XZ.x, y, z: CHEST_XZ.z };
  let chestAbs: Vector3;
  try {
    chestAbs = placeChest(test, chestRel);
  } catch (e) {
    test.fail(`could not place the chest: ${String(e)}`);
    return undefined;
  }
  const bots = botCells.map((c, i) => spawnBot(test, "toplevel", { x: c.x, y, z: c.z }, botName(`GG${i}`)));
  if (!(await waitGrounded(test, bots))) return undefined;
  const rt = runtime();
  const ids = bots.map((b) => rt.adoptBot(b, b.name));

  const s = sender("G", absCell(test, { x: CHEST_XZ.x + 1, y, z: CHEST_XZ.z }));
  rt.submitText(s, "!chest set");
  const chest = rt.snapshot().chest;
  if (!chest || !sameBlock(chest.pos, chestAbs)) {
    test.fail(`!chest set: expected colony chest at ${fmt(chestAbs)}, got ${chest ? fmt(chest.pos) : "none"}. ${repliesStr(s)}`);
    return undefined;
  }
  if (!hasReply(s, "Colony chest set to")) {
    test.fail(`!chest set: no confirmation reply. ${repliesStr(s)}`);
    return undefined;
  }
  await test.idle(COOLDOWN); // the next command from the same sender must clear the per-player cooldown
  return { y, chestRel, chestAbs, s, bots, ids };
}

function sameBlock(a: Vector3, b: Vector3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

/** Every bot must be busy with a gather task right after the command. */
function expectGathering(test: Test, sc: Scene, what: string): boolean {
  for (const id of sc.ids) {
    const t = view(id)?.task;
    if (!t || t.kind !== "gather") {
      test.fail(`${what}: expected ${view(id)?.name ?? id} gathering. ${snapStr()}. ${repliesStr(sc.s)}`);
      return false;
    }
  }
  return true;
}

function diag(test: Test, sc: Scene): string {
  return `${chestStr(test, sc.chestRel)}. ${snapStr()}. ${repliesStr(sc.s)}`;
}

// ---------------------------------------------------------------- tests

async function chestSet(test: Test): Promise<void> {
  const sc = await setup(test, [{ x: 6, z: 6 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!chest");
  if (!hasReply(sc.s, "empty")) return test.fail(`!chest on an empty chest: expected 'empty'. ${repliesStr(sc.s)}`);
  test.print(`chest_set: colony chest at ${fmt(sc.chestAbs)}; !chest reports it empty.`);
  test.succeed();
}

async function gatherLogs(test: Test): Promise<void> {
  const sc = await setup(test, [{ x: 4, z: 3 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather oak_log 6");
  if (!expectGathering(test, sc, "after !gather oak_log 6")) return;
  const t = await waitAllIdle(test, sc.ids, 3000);
  if (t < 0) return test.fail(`gather still running after 3000 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, OAK);
  if (n < 6) return test.fail(`chest has ${n} oak_log, expected >= 6. ${diag(test, sc)}`);
  if (!hasReply(sc.s, "Delivered")) return test.fail(`no 'Delivered' report. ${diag(test, sc)}`);
  test.print(`gather_logs: ${n} oak_log delivered after ${t} ticks.`);
  test.succeed();
}

async function gatherTwoBots(test: Test): Promise<void> {
  const sc = await setup(test, [
    { x: 4, z: 3 },
    { x: 3, z: 4 },
  ]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather oak_log 8 2");
  if (!expectGathering(test, sc, "after !gather oak_log 8 2")) return;
  const t = await waitAllIdle(test, sc.ids, 3000);
  if (t < 0) return test.fail(`gather still running after 3000 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, OAK);
  if (n < 8) return test.fail(`chest has ${n} oak_log, expected >= 8. ${diag(test, sc)}`);
  test.print(`gather_two_bots: ${n} oak_log delivered by 2 bots after ${t} ticks.`);
  test.succeed();
}

async function gatherCobbleCraft(test: Test): Promise<void> {
  const sc = await setup(test, [{ x: 4, z: 4 }]);
  if (!sc) return;
  if (!fillChest(test, sc.chestRel, OAK, 3)) return test.fail(`could not prefill the chest with 3 oak_log. ${chestStr(test, sc.chestRel)}`);
  runtime().submitText(sc.s, "!gather cobblestone 3");
  if (!expectGathering(test, sc, "after !gather cobblestone 3")) return;
  const t = await waitAllIdle(test, sc.ids, 3600);
  if (t < 0) return test.fail(`gather still running after 3600 ticks. ${diag(test, sc)}`);
  const n = chestCount(test, sc.chestRel, COBBLE);
  if (n < 3) return test.fail(`chest has ${n} cobblestone, expected >= 3. ${diag(test, sc)}`);
  const tables = findInArea(test, CRAFTING_TABLE, AREA, sc.y - 1, sc.y + 4);
  if (tables.length === 0) return test.fail(`no crafting table in the test area (bot should have placed one). ${diag(test, sc)}`);
  test.print(`gather_cobble_craft: ${n} cobblestone after ${t} ticks; crafting table at rel ${fmt(tables[0] ?? { x: 0, y: 0, z: 0 })}.`);
  test.succeed();
}

async function gatherNoSource(test: Test): Promise<void> {
  const sc = await setup(test, [{ x: 6, z: 6 }]);
  if (!sc) return;
  runtime().submitText(sc.s, "!gather sand 4");
  if (!expectGathering(test, sc, "after !gather sand 4")) return;
  const t = await waitAllIdle(test, sc.ids, 600);
  if (t < 0) return test.fail(`no-source gather still running after 600 ticks. ${diag(test, sc)}`);
  if (!hasReply(sc.s, "nothing left")) return test.fail(`expected a 'nothing left' report. ${diag(test, sc)}`);
  if (sc.ids.some((id) => !isIdle(id))) return test.fail(`bot not idle. ${diag(test, sc)}`);
  test.print(`gather_no_source: failed with no_source after ${t} ticks.`);
  test.succeed();
}

// ---------------------------------------------------------------- registration

function reg(name: string, structure: string, maxTicks: number, body: (test: Test) => Promise<void>): void {
  try {
    registerAsync(CLASS, name, body)
      .structureName(structure)
      .maxTicks(maxTicks)
      .setupTicks(5)
      .padding(4)
      .batch(`colony_${name}`) // one test per batch: the runtime is a shared singleton
      .required(true)
      .tag(TAG);
  } catch (e) {
    void e; // never break script load because of test registration
  }
}

reg("chest_set", "colony:flat", 400, chestSet);
reg("gather_logs", "colony:grove", 3400, gatherLogs);
reg("gather_two_bots", "colony:grove", 3400, gatherTwoBots);
reg("gather_cobble_craft", "colony:quarry", 4000, gatherCobbleCraft);
reg("gather_no_source", "colony:flat", 1000, gatherNoSource);
