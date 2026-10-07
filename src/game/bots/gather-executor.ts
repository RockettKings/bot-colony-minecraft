// Gather executor (Job 5): drives one WorkerBody through scan -> approach -> break -> collect -> deposit
// until the task's amount is delivered. Imperative shell around gather-logic.ts / crafting.ts.
// NO @minecraft imports (enforced by test/boundaries.test.ts): only ports, so it's tested against fakes.
// State machine: docs/PHASE2-SPEC.md §"Gather executor".
import type { GatherTask, TaskFailReason, TaskId, TaskProgress, Tick, Vec3 } from "../../core/types.js";
import { CONTAINER_BLOCK_TYPES, CRAFTING_TABLE, LOG_IDS, RESOURCES, toolInfo } from "../../core/items.js";
import type { ResourceDef, ToolInfo } from "../../core/items.js";
import { logError, logInfo } from "../log.js";
import { planCraft, planWoodenPickaxe, tableSpot } from "./crafting.js";
import type { ExecutorContext, GatherConfig, StepResult, TaskExecutor } from "./executor.js";
import {
  EYE_HEIGHT,
  bestToolSlot,
  blockCenter,
  blockOf,
  breakTimeoutTicks,
  countItems,
  estimateBreakTicks,
  eyeDistance,
  faceToward,
  inBreakReach,
  inContainerReach,
  isExposed,
  planHotbar,
  posKey,
  rankCandidates,
  scanSlices,
  shouldDeposit,
  slotsWith,
  standCells,
  type BlockProbe,
} from "./gather-logic.js";
import { Walker, feetIn } from "./nav.js";
import type { Box, InventorySnapshot, WorkerBody, WorldPort } from "./ports.js";

export type GatherPhase =
  | "start" // first step: resolve world, position, resource; decide whether a tool must be fetched first
  | "toChest" // walking to the chest (purpose: deposit | fetch tool | fetch logs)
  | "atChest" // container transfers (deposit yields; withdraw tool / logs)
  | "craft" // crafting chain for a wooden pickaxe (incl. placing a table)
  | "scan" // time-sliced block search around task.origin
  | "approach" // walking to a stand cell for the chosen block
  | "break" // breaking the block (polling until it's gone)
  | "collect" // waiting for / walking to drops
  | "finished"; // terminal (reported or cancelled)

/** Why the bot walks to the chest. "tool" = fetch a tool (and, for a pickaxe, logs to craft one). */
type ChestPurpose = "deposit" | "tool";

/** Max ticks to wait for a readable position / inventory on the first steps. */
export const START_WAIT_TICKS = 200;
/** After the walker says "arrived" (1.5 blocks), keep walking this long for the reach predicate to hold. */
export const ARRIVE_GRACE_TICKS = 20;
/** Re-issue navigation toward a drop at most this often. */
export const DROP_RENAV_TICKS = 20;
/** Candidates validated per pump in scan. */
export const PICK_CHECKS_PER_PUMP = 8;
/** At-chest out_of_reach retries before failing no_chest. */
export const CHEST_RETRIES = 2;
/** Craft-phase pumps before giving up (a full chain from logs takes ~8). */
export const MAX_CRAFT_PUMPS = 24;

const RUNNING: StepResult = { kind: "running" };
const failed = (reason: TaskFailReason): StepResult => ({ kind: "failed", reason });

interface Candidate {
  block: Vec3;
  /** Stand cell (integer) to walk to. */
  cell: Vec3;
}

export class GatherExecutor implements TaskExecutor {
  readonly taskId: TaskId;
  private readonly res: ResourceDef;
  private readonly cfg: GatherConfig;
  private readonly body: WorkerBody;
  private world: WorldPort | undefined;
  private readonly probe: BlockProbe = (p) => this.world?.blockAt(p);

  private ph: GatherPhase = "start";
  private settled = false;
  private delivered: number;
  private lastInv: InventorySnapshot | undefined;
  private firstStepAt: Tick | undefined;
  private deadline: Tick = Number.POSITIVE_INFINITY;
  /** Set when the task must end after a final deposit (timeout / no_source / unreachable / no_tool). */
  private pendingFailure: TaskFailReason | undefined;
  private failures = 0;
  private readonly blacklist = new Set<string>();

  // inner "logs for a pickaxe" gather: logs are kept in the inventory, not deposited
  private gatheringLogs = false;
  private logsTarget = 0;

  // scan
  private slices: Box[] | undefined;
  private sliceIdx = 0;
  private found: Vec3[] = [];
  private ranked: Vec3[] | undefined;
  private rankIdx = 0;
  private needRerank = false;
  private picksFromScan = 0;

  // approach / break / collect
  private cand: Candidate | undefined;
  private walker: Walker | undefined;
  private arrivedAt: Tick | undefined;
  private breakTimeoutAt: Tick = 0;
  private breaking = false;
  private settleUntil: Tick = 0;
  private collectUntil: Tick = 0;
  private dropId: string | undefined;
  private dropNavAt: Tick = 0;

  // chest
  private chestPurpose: ChestPurpose = "deposit";
  private chestWalker: Walker | undefined;
  private chestRetries = 0;

  // craft
  private tableAt: Vec3 | undefined;
  private placedTableAt: Vec3 | undefined;
  private craftPumps = 0;

  constructor(
    readonly task: GatherTask,
    private readonly ctx: ExecutorContext,
  ) {
    this.taskId = task.id;
    this.res = RESOURCES[task.item];
    this.cfg = ctx.gather;
    this.body = ctx.body;
    this.delivered = task.delivered;
  }

  step(now: Tick): StepResult {
    if (this.settled) return RUNNING;
    let r: StepResult;
    try {
      r = this.advance(now);
    } catch (e) {
      logError(`${this.body.name}: gather ${this.taskId} crashed in ${this.ph}`, e);
      r = failed("error");
    }
    if (r.kind !== "running") {
      if (this.breaking) this.body.stopBreaking();
      this.body.stop();
      this.settled = true;
      this.ph = "finished";
      logInfo(
        `${this.body.name}: gather ${this.taskId} ${r.kind === "done" ? "done" : `failed (${r.reason})`} ` +
          `${this.delivered}/${this.task.amount} ${this.res.label}`,
      );
    }
    return r;
  }

  cancel(): void {
    if (this.settled) return;
    this.settled = true;
    this.ph = "finished";
    this.body.stopBreaking();
    this.body.stop();
  }

  progress(): TaskProgress | undefined {
    return {
      kind: "gather",
      delivered: this.delivered,
      held: this.lastInv ? countItems(this.lastInv, this.res.yields) : 0,
    };
  }

  /** Current phase (for tests and logs). */
  phase(): GatherPhase {
    return this.ph;
  }

  // ------------------------------------------------------------ dispatch

  private advance(now: Tick): StepResult {
    if (this.ph === "start") return this.start(now);
    const inv = this.body.inventory();
    if (inv) this.lastInv = inv;

    if (now >= this.deadline && this.pendingFailure === undefined) {
      this.pendingFailure = "timeout";
      // Already on the way to deposit: that trip is the final deposit.
      const depositing = (this.ph === "toChest" || this.ph === "atChest") && this.chestPurpose === "deposit";
      if (!depositing) {
        this.stopBreakingIfNeeded();
        this.body.stop();
        return this.held() > 0 ? this.goToChest("deposit") : failed("timeout");
      }
    }

    switch (this.ph) {
      case "toChest":
        return this.toChest(now);
      case "atChest":
        return this.atChest();
      case "craft":
        return this.craft();
      case "scan":
        return this.scan();
      case "approach":
        return this.approach(now);
      case "break":
        return this.breakStep(now);
      case "collect":
        return this.collect(now);
      case "finished":
        return RUNNING;
    }
  }

  private start(now: Tick): StepResult {
    this.firstStepAt ??= now;
    this.world ??= this.ctx.world();
    if (!this.world) return failed("error");
    const pos = this.body.location();
    if (!pos) return now - this.firstStepAt >= START_WAIT_TICKS ? failed("timeout") : RUNNING;
    const inv = this.body.inventory();
    if (!inv) return now - this.firstStepAt >= START_WAIT_TICKS ? failed("error") : RUNNING;
    this.lastInv = inv;
    this.deadline = this.firstStepAt + this.cfg.maxTaskTicks;
    if (this.delivered >= this.task.amount) return { kind: "done" };
    if (this.needsToolFetch(inv)) return this.goToChest("tool");
    this.equipBest(inv, this.res);
    this.resetScan();
    return RUNNING;
  }

  // ------------------------------------------------------------ helpers

  private active(): ResourceDef {
    return this.gatheringLogs ? RESOURCES.log : this.res;
  }

  private held(): number {
    return this.lastInv ? countItems(this.lastInv, this.res.yields) : 0;
  }

  private needsToolFetch(inv: InventorySnapshot): boolean {
    return this.res.requiresTool && this.res.tool !== null && bestToolSlot(inv, this.res.tool) === undefined;
  }

  private stopBreakingIfNeeded(): void {
    if (!this.breaking) return;
    this.breaking = false;
    this.body.stopBreaking();
  }

  /** Deposit held yields first (if any), then fail with `reason`. */
  private failOrDeposit(reason: TaskFailReason): StepResult {
    this.body.stop();
    if (this.held() > 0) {
      this.pendingFailure ??= reason;
      return this.goToChest("deposit");
    }
    return failed(this.pendingFailure ?? reason);
  }

  /** Hold the best tool of `res.tool` (if any). Returns the ToolInfo of the item that ends up selected. */
  private equipBest(inv: InventorySnapshot, res: ResourceDef): ToolInfo | undefined {
    const selected = this.body.selectedSlot();
    const slot = res.tool ? bestToolSlot(inv, res.tool) : undefined;
    if (slot === undefined) {
      const cur = selected !== undefined ? inv[selected] : undefined;
      return cur ? toolInfo(cur.typeId) : undefined;
    }
    const item = inv[slot];
    if (slot !== selected) {
      const plan = planHotbar(inv, slot, selected);
      if (plan.swapFrom !== undefined && !this.body.swapSlots(plan.swapFrom, plan.select)) return undefined;
      if (!this.body.selectSlot(plan.select)) return undefined;
    }
    return item ? toolInfo(item.typeId) : undefined;
  }

  private resetScan(): void {
    this.ph = "scan";
    this.slices = undefined;
    this.ranked = undefined;
    this.found = [];
    this.sliceIdx = 0;
    this.rankIdx = 0;
    this.picksFromScan = 0;
    this.needRerank = false;
  }

  /** Back to scan keeping the cached ranked list (re-ranked from the new position). */
  private toScan(): StepResult {
    this.ph = "scan";
    this.cand = undefined;
    this.walker = undefined;
    this.needRerank = true;
    return RUNNING;
  }

  // ------------------------------------------------------------ chest

  private goToChest(purpose: ChestPurpose): StepResult {
    this.stopBreakingIfNeeded();
    this.chestPurpose = purpose;
    this.chestWalker = undefined;
    this.chestRetries = 0;
    this.arrivedAt = undefined;
    this.ph = "toChest";
    logInfo(`${this.body.name}: to chest (${purpose}) for ${this.taskId}`);
    return RUNNING;
  }

  private chestRetry(): StepResult {
    this.chestRetries++;
    if (this.chestRetries > CHEST_RETRIES) return failed("no_chest");
    this.chestWalker = undefined;
    this.arrivedAt = undefined;
    this.ph = "toChest";
    return RUNNING;
  }

  private toChest(now: Tick): StepResult {
    const world = this.world!;
    const chest = this.task.chest;
    if (world.dimensionId !== chest.dimensionId) return failed("no_chest");
    const b = world.blockAt(chest.pos);
    if (!b || !CONTAINER_BLOCK_TYPES.includes(b.typeId)) return failed("no_chest");
    const pos = this.body.location();
    if (!pos) return RUNNING;
    if (inContainerReach(pos, chest.pos, this.cfg.containerReach)) {
      this.body.stop();
      this.ph = "atChest";
      return RUNNING;
    }
    if (!this.chestWalker) {
      const cells = standCells(this.probe, chest.pos, this.cfg.breakReach).filter((c) =>
        inContainerReach(feetIn(c), chest.pos, this.cfg.containerReach),
      );
      const cell = cells[Math.min(this.chestRetries, cells.length - 1)];
      if (!cell) return failed("no_chest");
      this.chestWalker = new Walker(this.body, feetIn(cell));
      this.arrivedAt = undefined;
    }
    const st = this.chestWalker.step(pos, now);
    if (st === "walking") return RUNNING;
    if (st === "arrived") {
      // Let navigation finish the last block; then try the transfer (which re-checks reach).
      this.arrivedAt ??= now;
      if (now - this.arrivedAt < ARRIVE_GRACE_TICKS) return RUNNING;
      this.body.stop();
      this.ph = "atChest";
      return RUNNING;
    }
    this.body.stop();
    return failed("no_chest");
  }

  private atChest(): StepResult {
    const world = this.world!;
    const chest = this.task.chest;
    const pos = this.body.location();
    let inv = this.body.inventory();
    if (!pos || !inv) return RUNNING;
    if (!inContainerReach(pos, chest.pos, this.cfg.containerReach)) return this.chestRetry();

    // 1. deposit every yield stack
    let full = false;
    for (const slot of slotsWith(inv, this.res.yields)) {
      const amount = inv[slot]?.amount ?? 0;
      const r = this.body.depositSlot(chest, slot);
      if (!r.ok) return this.transferFailure(r.reason);
      this.delivered += r.moved;
      if (r.moved < amount) {
        full = true;
        break;
      }
    }
    inv = this.body.inventory() ?? inv;
    this.lastInv = inv;
    if (full) return this.delivered >= this.task.amount ? { kind: "done" } : failed("inventory_full");
    if (this.delivered >= this.task.amount) return { kind: "done" };
    if (this.pendingFailure) return failed(this.pendingFailure);

    // 2. take a tool if the bot has none of the right kind (required or not)
    if (this.res.tool && bestToolSlot(inv, this.res.tool) === undefined) {
      const cinv = world.containerAt(chest.pos);
      const s = cinv ? bestToolSlot(cinv, this.res.tool) : undefined;
      if (s !== undefined) {
        const r = this.body.withdrawSlot(chest, s, 1);
        if (!r.ok) return this.transferFailure(r.reason);
        inv = this.body.inventory() ?? inv;
        this.lastInv = inv;
      }
    }

    // 3. still no required tool: craft a wooden pickaxe (logs from the chest first)
    if (this.needsToolFetch(inv)) {
      if (this.res.tool !== "pickaxe") return failed("no_tool");
      const plan = planWoodenPickaxe(inv, this.findTable(pos) !== undefined);
      if (!plan.ok) {
        let need = plan.logsMissing;
        const cinv = world.containerAt(chest.pos) ?? [];
        for (const s of slotsWith(cinv, LOG_IDS)) {
          if (need <= 0) break;
          const r = this.body.withdrawSlot(chest, s, Math.min(need, cinv[s]?.amount ?? 0));
          if (!r.ok) return this.transferFailure(r.reason);
          need -= r.moved;
        }
      }
      this.ph = "craft";
      this.craftPumps = 0;
      logInfo(`${this.body.name}: crafting a wooden pickaxe for ${this.taskId}`);
      return RUNNING;
    }

    this.equipBest(inv, this.res);
    this.ph = "scan";
    this.needRerank = true;
    return RUNNING;
  }

  private transferFailure(reason: "no_container" | "out_of_reach" | "error"): StepResult {
    if (reason === "out_of_reach") return this.chestRetry();
    return failed(reason === "no_container" ? "no_chest" : "error");
  }

  // ------------------------------------------------------------ crafting

  /** A crafting table within break reach of `feet` (the one we placed first, else the nearest found). */
  private findTable(feet: Vec3): Vec3 | undefined {
    const world = this.world!;
    const reach = this.cfg.breakReach;
    if (this.tableAt && world.blockAt(this.tableAt)?.typeId === CRAFTING_TABLE && inBreakReach(feet, this.tableAt, reach)) {
      return this.tableAt;
    }
    const f = blockOf(feet);
    const r = this.cfg.tableSearchRadius;
    const box: Box = { min: { x: f.x - r, y: f.y - r, z: f.z - r }, max: { x: f.x + r, y: f.y + r, z: f.z + r } };
    const tables = (world.findBlocks(box, [CRAFTING_TABLE]) ?? []).filter((t) => inBreakReach(feet, t, reach));
    tables.sort((a, b) => eyeDistance(feet, a) - eyeDistance(feet, b));
    return tables[0];
  }

  private craft(): StepResult {
    const world = this.world!;
    const pos = this.body.location();
    const inv = this.body.inventory();
    if (!pos || !inv) return RUNNING;
    if (bestToolSlot(inv, "pickaxe") !== undefined) {
      this.equipBest(inv, this.res);
      this.resetScan();
      return RUNNING;
    }
    if (++this.craftPumps > MAX_CRAFT_PUMPS) return this.failOrDeposit("no_tool");
    if (this.placedTableAt) {
      if (world.blockAt(this.placedTableAt)?.typeId !== CRAFTING_TABLE) return this.failOrDeposit("no_tool");
      this.tableAt = this.placedTableAt;
      this.placedTableAt = undefined;
    }
    const table = this.findTable(pos);
    const plan = planWoodenPickaxe(inv, table !== undefined);
    if (!plan.ok) {
      // Chest logs were already taken at the chest: chop the rest by hand, keep them for crafting.
      this.gatheringLogs = true;
      this.logsTarget = countItems(inv, LOG_IDS) + plan.logsMissing;
      this.resetScan();
      logInfo(`${this.body.name}: chopping ${plan.logsMissing} log(s) for a pickaxe (${this.taskId})`);
      return RUNNING;
    }
    const next = plan.steps[0];
    if (!next) return this.failOrDeposit("no_tool");
    if (next.kind === "place_table") {
      const spot = tableSpot(this.probe, pos);
      const slot = slotsWith(inv, [CRAFTING_TABLE])[0];
      if (!spot || slot === undefined) return this.failOrDeposit("no_tool");
      this.body.lookAtBlock(spot.onBlock);
      if (!this.body.placeFromSlot(slot, spot.onBlock, spot.face)) return this.failOrDeposit("no_tool");
      this.placedTableAt = spot.tableAt; // confirmed next pump
      return RUNNING;
    }
    const craftPlan = planCraft(next.recipe, inv, next.recipe.needsTable ? table : undefined);
    if (!craftPlan || !this.body.applyCraft(craftPlan)) return this.failOrDeposit("no_tool");
    return RUNNING;
  }

  // ------------------------------------------------------------ scan / approach / break / collect

  private scan(): StepResult {
    const world = this.world!;
    const pos = this.body.location();
    if (!pos) return RUNNING;
    const act = this.active();
    if (!this.slices) {
      this.slices = scanSlices(this.task.origin, this.cfg);
      this.sliceIdx = 0;
      this.found = [];
      this.ranked = undefined;
      this.picksFromScan = 0;
    }
    if (!this.ranked) {
      const slice = this.slices[this.sliceIdx];
      if (slice) {
        this.sliceIdx++;
        const f = world.findBlocks(slice, act.sources);
        if (f) this.found.push(...f);
        return RUNNING; // one slice per pump
      }
      this.ranked = rankCandidates(this.found, pos, this.task.origin, this.cfg, this.blacklist);
      this.rankIdx = 0;
      this.found = [];
      this.needRerank = false;
    } else if (this.needRerank) {
      this.ranked = rankCandidates(this.ranked.slice(this.rankIdx), pos, this.task.origin, this.cfg, this.blacklist);
      this.rankIdx = 0;
      this.needRerank = false;
    }

    for (let checks = 0; checks < PICK_CHECKS_PER_PUMP && this.rankIdx < this.ranked.length; checks++) {
      const c = this.ranked[this.rankIdx++]!;
      const key = posKey(c);
      if (this.blacklist.has(key)) continue;
      const b = world.blockAt(c);
      const cells = b && act.sources.includes(b.typeId) && isExposed(this.probe, c) ? standCells(this.probe, c, this.cfg.breakReach) : [];
      const cell = cells[0];
      if (!cell) {
        this.blacklist.add(key);
        continue;
      }
      this.picksFromScan++;
      this.cand = { block: c, cell };
      this.walker = undefined;
      this.arrivedAt = undefined;
      this.ph = "approach";
      return RUNNING;
    }
    if (this.rankIdx < this.ranked.length) return RUNNING;

    // Exhausted. A list that yielded picks may be stale: rescan once more before giving up.
    if (this.picksFromScan > 0) {
      this.slices = undefined;
      return RUNNING;
    }
    return this.failOrDeposit(this.gatheringLogs ? "no_tool" : "no_source");
  }

  private candidateFailed(): StepResult {
    if (this.cand) this.blacklist.add(posKey(this.cand.block));
    this.body.stop();
    this.failures++;
    if (this.failures >= this.cfg.maxConsecutiveFailures) {
      return this.failOrDeposit(this.gatheringLogs ? "no_tool" : "unreachable");
    }
    return this.toScan();
  }

  private approach(now: Tick): StepResult {
    const c = this.cand!;
    const pos = this.body.location();
    if (!pos) return RUNNING;
    if (inBreakReach(pos, c.block, this.cfg.breakReach)) {
      if (!this.body.isOnGround()) return RUNNING;
      this.body.stop();
      return this.beginBreak(pos, now);
    }
    this.walker ??= new Walker(this.body, feetIn(c.cell));
    const st = this.walker.step(pos, now);
    if (st === "walking") return RUNNING;
    if (st === "arrived") {
      this.arrivedAt ??= now;
      if (now - this.arrivedAt < ARRIVE_GRACE_TICKS) return RUNNING;
    }
    return this.candidateFailed();
  }

  private beginBreak(pos: Vec3, now: Tick): StepResult {
    const c = this.cand!;
    const act = this.active();
    const inv = this.lastInv ?? [];
    if (!this.gatheringLogs && this.needsToolFetch(inv)) return this.goToChest("tool"); // lost the tool
    const b = this.world!.blockAt(c.block);
    if (!b || !act.sources.includes(b.typeId)) return this.toScan(); // gone meanwhile (another bot?)
    const held = this.equipBest(inv, act);
    this.breakTimeoutAt = now + breakTimeoutTicks(estimateBreakTicks(b.typeId, act, held));
    this.body.lookAtBlock(c.block);
    const eye = { x: pos.x, y: pos.y + EYE_HEIGHT, z: pos.z };
    if (!this.body.startBreaking(c.block, faceToward(c.block, eye))) return this.candidateFailed();
    this.breaking = true;
    this.ph = "break";
    return RUNNING;
  }

  private breakStep(now: Tick): StepResult {
    const c = this.cand!;
    const b = this.world!.blockAt(c.block);
    const present = b === undefined || this.active().sources.includes(b.typeId);
    if (!present) {
      this.breaking = false;
      this.failures = 0;
      this.settleUntil = now + this.cfg.dropSettleTicks;
      this.collectUntil = this.settleUntil + this.cfg.pickupTimeoutTicks;
      this.dropId = undefined;
      this.ph = "collect";
      return RUNNING;
    }
    if (now >= this.breakTimeoutAt) {
      this.stopBreakingIfNeeded();
      return this.candidateFailed();
    }
    return RUNNING;
  }

  private collect(now: Tick): StepResult {
    if (now < this.settleUntil) return RUNNING;
    const c = this.cand!;
    const pos = this.body.location();
    const drops = now < this.collectUntil ? this.world!.itemsNear(blockCenter(c.block), this.cfg.pickupRadius, this.active().yields) : [];
    if (drops.length === 0) return this.finishCollect();
    if (!pos) return RUNNING;
    let d = drops[0]!;
    for (const x of drops) if (dist2(pos, x.pos) < dist2(pos, d.pos)) d = x;
    if (d.id !== this.dropId || now - this.dropNavAt >= DROP_RENAV_TICKS) {
      // TODO(phase-2+): pickup is assumed to happen by walking over drops (SPIKE: verify in game).
      if (this.body.isOnGround()) this.body.navigateTo(d.pos);
      this.dropId = d.id;
      this.dropNavAt = now;
    }
    return RUNNING;
  }

  private finishCollect(): StepResult {
    this.body.stop();
    this.cand = undefined;
    const inv = this.body.inventory() ?? this.lastInv ?? [];
    this.lastInv = inv;
    if (this.gatheringLogs) {
      if (countItems(inv, LOG_IDS) < this.logsTarget) return this.toScan();
      this.gatheringLogs = false;
      this.ph = "craft";
      this.craftPumps = 0;
      this.slices = undefined; // next scan is for the real resource
      return RUNNING;
    }
    if (shouldDeposit(inv, this.res, this.task.amount - this.delivered, this.cfg)) return this.goToChest("deposit");
    return this.toScan();
  }
}

function dist2(a: Vec3, b: Vec3): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}
