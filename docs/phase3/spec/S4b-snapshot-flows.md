# S4b: Snapshot flows, exactly-once restore, invariants, failure handling (Phase 3)

Owner: S4b. Consumers: B4 (`src/core/snapshot/machine.ts`, `src/game/snapshot/service.ts`, `test/snapshot-machine|service|conservation.test.ts`), B3 (runtime wiring, controller hand-off), B6 (core reactions to the events), TC-B4 case writers.
S4a (`S4a-snapshot-data.md`) owns *what* `captureSnapshot`, `applySnapshot`, `SnapshotStore` do. This file owns *when* they are called, in what order, and what happens when they fail. Names are used exactly as S4a / S5 define them (`BotSnapshot`, `RestoreToken`, `SnapshotStore.write/read/readDetailed/markRestored/delete/listRoster/readMeta/writeMeta/gcAll`, `captureSnapshot`, `clearSnapshotted`, `applySnapshot`, `planApplySteps`, `scanDroppedItems`; events `botDismissed`, `botDismissFailed`, `botEscaped`, `botRejoined`, `botRejoinFailed`, `rosterRestored`, `botNotice`; effects `dismissBot`, `summonBot`, `persistMeta`). Fields are added, never renamed. Binding cross-doc decisions D6, D7, D9, D10, D21, D26 of `DECISIONS.md` (this file's own §0 decisions are numbered A1-A11) are applied: `snapshot.intervalTicks`; `"storage_full"` in `SnapshotFailReason`; S4a's extra helpers are used by their exact names (`rollbackClearHeld`, `scanDroppedItems`, `DirtyReason`, ...); the P4-says-drops fallback, the forced-write contract and `partial`/`leftover` to `carryover` are covered in §3, §8 and §10 (map in A11); hand-offs H1-H7 are accepted (§14); `carry` holds `brainState`, `recover`, `objectiveItemIds`, `stats` only and the core, not the snapshot service, owns the task on an escape rejoin (D26).

## 0. Decisions at a glance

| # | Decision |
|---|---|
| A1 | One class owns every flow: `SnapshotService` (`src/game/snapshot/service.ts`), driven by the runtime pump (4 ticks) and by effects. Pure logic is in `src/core/snapshot/machine.ts` (`SnapshotFlowState`, `nextLeave`, `nextRestore`, `destOrder`, `mapWriteFail`, `mapReadFail`); the service executes the commands it returns. |
| A2 | Two shared machines. **LEAVE** (prep, walk, put, drop, commit, gone) serves manual dismiss, idle, far and escape. **RESTORE** (resolve, name_wait, spawn, ground, mark, apply, haul_drop, haul_away, live) serves summon, escape, reload and owner_returned. |
| A3 | The point of no return of LEAVE is the **commit**: capture, write, read-back verify, `clearSnapshotted`, `disconnect()`, `controller.dispose` run in ONE synchronous call stack (no `system.run*` between). Before it every failure leaves the bot untouched; after it the snapshot is the only copy. |
| A4 | `botEscaped` and `botDismissed` are emitted only after the body is confirmed gone. A failure before the commit is invisible to the core (escape: `controller.onEscapeFailed`; dismiss: `botDismissFailed`). |
| A5 | Excluded items (S4a §2) are disposed **before** the commit, by priority: deposit in the colony chest, else drop as real drops plus `excludedDropped`. They are never serialized and never left in a body at `disconnect()`. |
| A6 | **Escape destination**: home if set, else the owner's feet. Neither available: `requestEscape` returns false and the bot gets notice `escapeBlocked` (S5). If the destination disappears after the commit (owner logged off), the bot **stays dismissed** (`botRejoinFailed`, reason `owner_offline`, snapshot kept). No cooldown. |
| A7 | **Restore** order: `markRestored` (persisted, read back) then `applySnapshot` (S4a §5.3-5.4). The decoded snapshot stays in service memory (`RestoreRun.snap`) because the store no longer returns a consumed seq. Any failure after `markRestored` and before the first `setItem` **re-arms** (writes the in-memory snapshot as a new seq). |
| A8 | In-session restore reuses the live `ItemStack` copies (`HeldStacks`, lossless: trims, shield banners) when `snapshot.inSessionStacks`; excluded stacks are removed from `held` before it is stored, so `planApplySteps` never writes them back. |
| A9 | Task fate: escape keeps the task assigned **in the core** (`presence = "rejoining"`); the carry holds no task (D26). Manual dismiss: the core has already cancelled the task (S5 §4.4); the service refuses with `busy` if a task is still present. Idle and far dismiss only start for a bot with no task. |
| A10 | Save & Quit: on world load every roster row of status `online` or `escaping` is respawned (restore order lastPos, home, owner's feet); status `dismissed` rows stay dismissed. A bot is rejoined only if its owner is online or home is set (S5 §4.7). |
| A11 | D10 coverage map. (1) P4-says-drops fallback: rows V3, A5, A6, failure F5, `scanDrops` in §3.1, S4a §6.3. (2) Forced-write contract (a failed write never clears the body): rows C4, C5, C6, failures F8-F10, invariants 2 and 9. (3) `partial` / `leftover` -> `carryover`: rows A2, A3, §3.3 step 2, §8.2, failure F2, invariant 10. |

## 1. Machinery shared by all flows

### 1.1 Service surface and dependencies

```ts
// src/game/snapshot/service.ts (B4). Engine access only through `deps.engine` (adapter) and snapshot-io.ts.
export interface SnapshotService {
  /** S1 SnapshotHandle. Returns true = a flow was registered and will run on this pump; false = refused (see §5.1). */
  requestEscape(botId: BotId, now: Tick, carry: () => ControllerCarry): boolean;
  abortEscape(botId: BotId, reason: "bot_died" | "disposed"): void;
  /** Colony effects (runtime routes them). */
  onDismissBot(e: Extract<Effect, { kind: "dismissBot" }>, now: Tick): void;
  onSummonBot(e: Extract<Effect, { kind: "summonBot" }>, now: Tick): void;
  onPersistMeta(meta: ColonyMeta): void;                 // store.writeMeta; failure is logged only
  /** Runtime hooks. */
  onWorldLoad(now: Tick): void;                          // §6
  onPlayerSpawn(playerId: string, now: Tick): void;      // human owner (re)appeared: §6.3
  onBotDeath(botId: BotId, now: Tick): void;             // §10 rows F21-F23
  onAssign(botId: BotId): void;                          // runtime calls it BEFORE delivering an assign effect; aborts an idle/far flow in prep|walk|put
  isFlowActive(botId: BotId): boolean;
  markDirty(botName: string, reason: DirtyReason, now: Tick): void;   // S4a §6.1
  pump(now: Tick): void;                                 // after all controllers ticked, every 4 ticks
  testReset(): void;                                     // S6 C3
}
export interface SnapshotDeps {
  store: SnapshotStore & { gcAll(): void };
  cfg: Phase3Config;                                     // .snapshot, .idle, .combat.escapeRetryTicks
  engine: SnapshotEngine;                                // §1.2
  emit: (e: ColonyEvent) => void;                        // runtime feeds colony.handle
  colony: { home(): HomeRef | undefined; chest(): ChestRef | undefined; ownerOf(botId: BotId): PlayerRef | undefined };
  bots: BotDirectory;                                    // §1.2
  serializeStats: (botName: string) => string;           // S2b OutcomeStats -> string, "" if none
  log: (msg: string) => void;                            // prefixes "[colony] "
}
```

### 1.2 Engine and runtime ports (adapter implements; fakes in `test/support`)

```ts
export interface SnapshotEngine {
  /** world.getPlayers({ name }) (case-insensitive). Humans and bots. */
  playersNamed(name: string): Array<{ id: string; isSimulated: boolean }>;
  /** Human players only (bots excluded): id, name, feet position, dimension id. */
  humans(): Array<{ id: string; name: string; pos: Vec3; dimensionId: string }>;
  isChunkLoaded(dimensionId: string, pos: Vec3): boolean;
  /** Safe-cell search of §3.2. Returns a feet position (x+.5, y, z+.5) or undefined. */
  findSpawnCell(dimensionId: string, near: Vec3): Vec3 | undefined;
  /** spawnSimulatedPlayer(...). Throws are caught: { ok:false }. */
  spawn(name: string, dimensionId: string, feet: Vec3): { ok: true; bot: SimBot } | { ok: false; error: string };
  /** The live SimBot for a registered bot id, undefined if invalid. */
  botById(botId: BotId): SimBot | undefined;
  botByName(name: string): SimBot | undefined;
  disconnect(bot: SimBot): boolean;
  /** Excluded-item handling (WorkerBody / S3 BodyActions). All return false/0 on failure and never throw. */
  unequip(bot: SimBot, key: EquipKey): boolean;                 // S3 unequip: equipment slot -> first empty inventory slot
  depositSlot(bot: SimBot, chest: ChestRef, slot: number): TransferResult;   // Phase 2 Container.transferItem
  dropSlot(bot: SimBot, slot: number): number;                  // S3 dropSlot: items that left the bot (0 = failed)
  navigateTo(bot: SimBot, target: Vec3): boolean;               // false = no path / threw
  location(bot: SimBot): Vec3 | undefined;
  rollbackClearHeld(bot: SimBot, held: HeldStacks, snap: BotSnapshot): number;   // S4a §5.2a, snapshot-io.ts (same name, same signature)
  worldLoadedTick(): Tick;
}
export interface BotDirectory {
  layerOf(botId: BotId): LayerKind | undefined;                 // controller.layer()
  taskIdOf(botId: BotId): TaskId | undefined;                   // controller.currentTaskId()
  /** Controller lifecycle (S1 §2.3). */
  dispose(botId: BotId, reason: "dismissed" | "escaped"): void;
  onEscapeFailed(botId: BotId, now: Tick): void;
  /** Create the controller + BotEntry for a respawned body. init undefined = fresh idle controller; with init.carry = RECOVER start (S1 §3.6). No task travels in the carry (D26). */
  registerRejoined(bot: SimBot, init: ControllerInit | undefined, now: Tick): BotId;
  adopt(bot: SimBot): BotId;                                    // body already alive (script reload): Phase 1 adopt path
  lastActiveTick(botId: BotId): Tick;                           // last tick the layer was not "idle" or a task was assigned
}
```

### 1.3 Types (`src/core/snapshot/machine.ts`; vocabulary name `SnapshotFlowState`)

```ts
export type LeaveKind = "command" | "idle" | "far" | "escape";
export type LeaveState = "prep" | "walk" | "put" | "drop" | "commit" | "gone";
export type RestoreCause = RejoinCause;       // "summon" | "escape" | "reload" | "owner_returned"
export type RestoreState = "resolve" | "name_wait" | "spawn" | "ground" | "mark" | "apply" | "haul_drop" | "haul_away" | "live";
export interface Dest { kind: "lastPos" | "home" | "owner" | "summoner"; dimensionId: string; pos: Vec3 }

export interface LeaveFlow {
  flow: "leave"; kind: LeaveKind; state: LeaveState;
  botId: BotId; name: string; startedAt: Tick; stateSince: Tick;
  requestedBy?: PlayerId; carry?: () => ControllerCarry;
  excludedLoops: number;                       // times commit found excluded stacks again
  dropped: { items: number; firstPos?: Vec3 }; // for notice excludedDropped
  depositTarget?: ChestRef;                    // set when a chest is reachable
  disconnectedAt?: Tick; snapSeq?: number; stacks?: number; bodyPos?: Vec3;
}
export interface RestoreFlow {
  flow: "restore"; cause: RestoreCause; state: RestoreState;
  name: string; startedAt: Tick; stateSince: Tick;
  requestedBy?: PlayerId; summonNear?: { pos: Vec3; dimensionId: string };
  seq: number;                                 // seq of the snapshot this flow restores
  dests: Dest[];                               // resolved, in try order
  spawnAttempts: number; applyAttempts: number; markAttempts: number;
  carry?: ControllerCarry;                     // escape only
  oldBotId?: BotId; notBefore: Tick;           // spawn not before (disconnectedAt + respawnDelayTicks)
}
export type SnapshotFlowState = LeaveFlow | RestoreFlow;

export function destOrder(cause: RestoreCause): Array<Dest["kind"]> {
  switch (cause) {
    case "summon": return ["summoner"];
    case "escape": return ["home", "owner"];
    default: return ["lastPos", "home", "owner"];       // reload, owner_returned
  }
}
export function mapWriteFail(r: WriteFailReason): SnapshotFailReason { return r === "storage_full" ? "storage_full" : "error"; }
export function mapReadFail(r: "no_snapshot" | "consumed" | "snapshot_unreadable"): SnapshotFailReason {
  return r === "snapshot_unreadable" ? "snapshot_unreadable" : "no_snapshot";       // consumed behaves as "nothing saved"
}
```
`SnapshotFailReason` (S5 §5) gains `"storage_full"` (D7). `SNAPSHOT_FAIL_TEXT.storage_full` = `the colony's save space is full` (S5 §6 table; used in `dismissFailed`, `summonFailed`, `rejoinFailed`).

### 1.4 Pump order and per-bot rules

`pump(now)` runs once per runtime pump, after every `controller.tick`. Order: (1) world-load restore queue (§6); (2) advance every `LeaveFlow` and `RestoreFlow` one step (sorted by `startedAt`, then name); (3) idle/far detection (§4); (4) S4a checkpoint writer (skipped for bots with a flow). One step = at most one state transition **plus** the synchronous commit when entered. A bot has at most one flow (`flows: Map<lowerName, SnapshotFlowState>`); a second request while a flow exists is refused (`requestEscape` false; `dismissBot` or `summonBot` answered with `busy`; except the idle-to-command takeover of §4.3).
Every flow has a deadline: `now - startedAt >= snapshot.flowDeadlineTicks` (500) before the commit (LEAVE) or before `mark` (RESTORE) aborts it with reason `error`. 500 < `flowTimeoutTicks` (600, S5) so the core's timeout never fires first.

### 1.5 `rollbackClearHeld` (defined by S4a §5.2a, hand-off H5 applied)

`rollbackClearHeld(bot, held, snap): number` (S4a, `snapshot-io.ts`) refills only slots that `clearSnapshotted` emptied, from `held`; never touches a non-empty slot, never `addItem`. Used only by §2.2 rows C6 (clear failed) and C8 (disconnect failed), and by row G2 and failure F12/F13. It cannot duplicate. The service reaches it through `SnapshotEngine.rollbackClearHeld` (§1.2).

### 1.6 Excluded-item disposal (shared by every LEAVE variant)

`cap = captureSnapshot(bot, {...})` lists `cap.excluded: ExcludedStack[]` (key `i<k>` or equipment key). Disposal, per excluded stack, in this priority:
1. **Deposit** in `colony.chest()` when reachable (§1.7): equipment key: `engine.unequip` first (becomes an inventory slot; failure = treat as undisposable, see §10 F24); then `engine.depositSlot(bot, chest, slot)`; `moved < amount` or 0 = chest full: emit `botNotice chestFull` (once per flow), remainder goes to step 2.
2. **Drop** (`engine.dropSlot` loop, up to `snapshot.dropCallsPerPump` (8) calls per pump per flow; stop when the slot is empty; `dropped.items += returned`; `dropped.firstPos ??= engine.location(bot)`). Kinds `idle` and `far` do **not** drop: they refuse instead (§4.2).
3. When every excluded stack is gone: emit `botNotice { id: "excludedDropped", count: dropped.items, pos: floor(dropped.firstPos) }` if `dropped.items > 0` (bot-voiced to the owner; see §14 hand-off H1 about routing for non-live records).
Pickup safety: dropped items have a pickup delay (S3 §1.3, about 40 ticks); the commit runs in the same pump as the last drop, so the bot cannot re-collect them. If P10 shows an immediate pickup, `snapshot.dropStepAwayBlocks` (default 0) makes the flow walk that far from `dropped.firstPos` before the commit.

### 1.7 "Reachable chest" (single definition)

`reachable(bot) = chest := colony.chest(); chest defined && chest.dimensionId == bot dimension && engine.isChunkLoaded(chest.dimensionId, chest.pos) && horizontalDist(bot, chest.pos) <= idle.depositWalkMaxBlocks (48) && engine.navigateTo(...) not false`. Phase 3 has exactly one deposit target: the colony chest (`GatherTask.chest` stays the deposit target, S5 D2). "Home chests" arrive with Phase 4; until then home is a destination, not a container.

## 2. Dismiss (manual `!dismiss`; the LEAVE machine)

Trigger: effect `dismissBot { botId, name, cause: "command", requestedBy }`. The core has set `presence = "leaving"` and cancelled the task. Idle/far reuse this machine (§4); escape reuses it with kind `escape` (§5).

### 2.1 LEAVE state table

"cap" = `captureSnapshot` (probe, no side effects). `K` = flow kind. Every row also checks, first: bot valid (else row L0).

| # | State | Trigger | Guard | Action | Next |
|---|---|---|---|---|---|
| L0 | any | body invalid or `onBotDeath` | before commit | abort flow, no snapshot change (the old checkpoint stays; death path deletes it, §10 F21) | end |
| L1 | (none) | `dismissBot` | `!cfg.enabled` -> reason `error`; a flow exists or `taskIdOf(botId)` is defined -> reason `busy` | `emit botDismissFailed { now, botId, name, reason }` | end |
| L2 | (none) | `dismissBot` | else | create `LeaveFlow{kind:"command"}`; remember `requestedBy` | prep |
| P1 | prep | pump | `cap` not ok | `botDismissFailed { reason: "error" }` (log detail) | end |
| P2 | prep | pump | `cap.excluded` empty | none | commit |
| P3 | prep | pump | excluded, `K` in (`command`, `escape`) and `reachable(bot)` (escape: only if within `CONTAINER_REACH` 2.5 of the chest, it never walks) | `depositTarget = chest` | K=command: walk (escape: put when in reach) |
| P4 | prep | pump | excluded, `K` in (`command`, `escape`), no reachable chest | none | drop |
| P5 | prep | pump | excluded, `K` in (`idle`, `far`), reachable chest | `depositTarget = chest` | walk |
| P6 | prep | pump | excluded, `K` in (`idle`, `far`), no chest | refuse: log, `idleRefusedUntil = now + idle.idleRetryTicks` | end (silent) |
| W1 | walk | pump | `layerOf(botId)` is `combat` or `reflex` | `K=command`: `botDismissFailed { reason: "busy" }`; `K` idle/far: silent abort | end |
| W2 | walk | pump | within `CONTAINER_REACH` of chest | `engine.navigateTo` stop | put |
| W3 | walk | pump | else, `now - stateSince < snapshot.depositTimeoutTicks` (300) | `navigateTo(chest)` once per pump; `false` = no path | walk (no path: as the timeout row) |
| W4 | walk | timeout or no path | `K=command` | `depositTarget` cleared | drop |
| W5 | walk | timeout or no path | `K` idle/far | silent abort, `idleRefusedUntil` set | end |
| T1 | put | pump | stack left in `cap.excluded` and chest takes it | `depositSlot`; `moved == amount` | put (next stack) |
| T2 | put | pump | `moved < amount` | `botNotice chestFull` (once); remainder stays | drop (command, escape) or end silent (idle, far) |
| T3 | put | all excluded gone | `K` in (`idle`, `far`) | cargo deposit pass of §4.2 (after excluded) | commit |
| T4 | put | all excluded gone | else | none | commit |
| D1 | drop | pump | an excluded stack remains | up to `dropCallsPerPump` `dropSlot` calls (§1.6 step 2); deadline for this state: `dropMaxTicks` 60 (escape: `escapeDropMaxTicks` 40) | drop |
| D2 | drop | all excluded gone | none | `excludedDropped` notice (§1.6 step 3) | commit |
| D3 | drop | state deadline | `K=escape` | survival bias: log `[colony] escape: <n> excluded stacks left in body (<types>)`; proceed with the commit regardless (engine drops or removes them at `disconnect`, P4); notice `excludedDropped` only for what was dropped | commit (flag `leftExcluded`) |
| D4 | drop | state deadline | `K=command` | `botDismissFailed { reason: "error" }` | end |
| C | commit | entered | see §2.2 | atomic block | gone |
| G1 | gone | pump | `!bot.isValid` or `playersNamed(name)` empty | emit the end event of §2.3 | end |
| G2 | gone | `now - disconnectedAt >= snapshot.goneWaitTicks` (20) | still present | `disconnect()` again (once); after 2x`goneWaitTicks`: `rollbackClearHeld` if valid, `botDismissFailed { reason: "error" }`, delete nothing | end |

### 2.2 The commit (one synchronous call; exact order)

```
C1  cap = captureSnapshot(bot, { now, status, owner, stats: deps.serializeStats(name), pausedTaskId: directory.taskIdOf(botId),
                                 carryover: pendingCarryover.get(lower), maxStatsChars })
      status = K==="escape" ? "escaping" : "dismissed"
      cap not ok                                  -> fail("error")
C2  cap.excluded.length > 0                       -> excludedLoops++; if excludedLoops > snapshot.excludedLoopMax (3) fail("error"); else state=prep (re-dispose)   [bot picked something up]
C3  carryNow = K==="escape" ? carry() : undefined    // exportCarry() (brainState, recover, objectiveItemIds, stats; no task) is read BEFORE the clear and before dispose; stored in flow.carry for the RESTORE flow
C4  w = store.write(cap.snap)                     -> !ok: fail(mapWriteFail(w.reason)); the body is NOT cleared and not disconnected (S4a D6, forced-write contract, D10)
C5  r = store.readDetailed(name); require r.ok && r.snap.seq === w.seq && contentHashOf(r.snap) === contentHashOf(cap.snap)
                                                  -> else fail("error")   // "verify stored"
C6  cl = clearSnapshotted(bot, cap.snap)          -> !ok: rollbackClearHeld(bot, cap.held, cap.snap); recapture + store.write(status "online"); fail("error")
C7  heldKept = cap.held minus every key of cap.excluded; if cfg.inSessionStacks: heldStore.set(lower, { seq: w.seq, held: heldKept })
C8  ok = engine.disconnect(bot)                   -> !ok (threw): rollbackClearHeld(bot, cap.held, cap.snap); recapture + store.write(status "online"); fail("error"). The controller is still alive (dispose has not run).
C9  directory.dispose(botId, K==="escape" ? "escaped" : "dismissed")      // body already gone; dispose must tolerate an invalid body
C10 disconnectedAt = now; snapSeq = w.seq; stacks = stacksOf(cap.snap); bodyPos = cap.snap.lastPos
C11 K==="escape": emit botEscaped { now, botId, name, dest, pos: bodyPos }  (dest chosen at request time, §5.1)
```
`fail(reason)`: K=command -> `emit botDismissFailed { now, botId, name, reason }`; K=escape -> `directory.onEscapeFailed(botId, now)` (S1 T17, controller waits `escapeRetryTicks`); K idle/far -> silent, `idleRefusedUntil`. After a failure the bot is exactly as before the flow (C6/C8 roll back). `stacksOf(snap) = snap.inventory.length + count(present keys of snap.equipment)` (the same rule as `RosterRecord.stacks`; worked example in §2.4).

### 2.3 End events of LEAVE

| K | Event (after G1) |
|---|---|
| `command` | `botDismissed { now, botId, name, cause: "command", stacks }` |
| `idle` | `botDismissed { ..., cause: "idle", stacks }` |
| `far` | `botDismissed { ..., cause: "far", stacks }` |
| `escape` | none (the RESTORE flow of §3 starts: `botEscaped` was already sent at C11) |

### 2.4 Worked example (manual dismiss, one excluded item, no chest set)

Bot `Bot-1` has: sword in slot 0, 64 cobblestone in slot 1, a `minecraft:white_shulker_box` in slot 21, shield in offhand. `now = 48000`.
1. 48000 `dismissBot`: L2, flow `prep`. 48000 (same pump): `cap.excluded = [{key:"i21", amount:1, reason:"type_excluded"}]`, no chest -> P4 -> `drop`.
2. 48000: `dropSlot(21)`: slot 21 >= 9 so S3 swaps with scratch slot 8, drops, swaps back; returns 1. `dropped = {items:1, firstPos:(100.5,64,-20.25)}`. Excluded gone -> D2: `botNotice excludedDropped {count:1, pos:{x:100,y:64,z:-21}}` (floor of each coordinate: `floor(-20.25) = -21`) -> commit.
3. Commit: `cap.snap.inventory` = slots 0 and 1 (2 entries), `equipment.offhand` (1) -> `stacksOf = 2 + 1 = 3`. `write` ok seq 8, verify ok, `clearSnapshotted` ok (`remaining = []`), dispose, `disconnect()`.
4. 48004: `isValid` false -> G1 -> `botDismissed { cause:"command", stacks:3 }`. Core replies `Dismissed Bot-1 (3 stacks saved). Type !summon Bot-1 to bring it back.`; owner sees `Dropped 1 item I can't carry offline at 100 64 -21.`
Time used: 4 ticks of a 500-tick deadline.

## 3. Rejoin and summon (the RESTORE machine)

Trigger: effect `summonBot { name, near, dimensionId, requestedBy }` (cause `summon`), a finished escape commit (cause `escape`: C11 creates the `RestoreFlow` in state `resolve` with `oldBotId`, `carry` and `notBefore = now + snapshot.respawnDelayTicks`), or the world-load queue (causes `reload`, `owner_returned`, §6).

### 3.1 RESTORE state table

| # | State | Trigger | Guard | Action | Next |
|---|---|---|---|---|---|
| R0 | (none) | `summonBot` | flow exists for the name | `emit botRejoinFailed { name, cause:"summon", reason:"busy" }` | end |
| R1 | (none) | `summonBot` | `!cfg.enabled` | `botRejoinFailed { reason:"error" }` | end |
| R2 | (none) | `summonBot` | else | `RestoreFlow{cause:"summon", summonNear:{pos:near, dimensionId}}`, `notBefore = now` | resolve |
| V1 | resolve | pump | `store.readDetailed(name)` not ok | `botRejoinFailed { reason: mapReadFail(reason) }` | end |
| V2 | resolve | pump | snapshot ok | `seq = snap.seq`; `dests = §3.2`; keep `snap` in `RestoreRun` (§8.1); `dests` empty -> `botRejoinFailed { reason: cause==="escape"||cause==="reload"||cause==="owner_returned" ? "owner_offline" : "spawn_failed" }` | name_wait |
| V3 | resolve | `snap.status === "online"` and `cfg.dropsOnDisconnect` | `!engine.isChunkLoaded(snap.dimensionId, snap.lastPos)` | wait; every `scanRetryTicks` (20) recheck; after `scanDeferMaxTicks` (1200): `botRejoinFailed { reason:"error" }` (snapshot untouched, "Its items are kept.") | resolve (waiting) |
| N1 | name_wait | pump | `playersNamed(name)` empty and `now >= notBefore` | none | spawn |
| N2 | name_wait | pump | a player named `name` exists, it is a SimulatedPlayer, cause in (`reload`, `owner_returned`) | script reload left the body alive: `directory.adopt(bot)` (items are in that body); no restore; flow ends | end |
| N3 | name_wait | `now - stateSince >= snapshot.nameFreeWaitTicks` (40) | a player still named `name` | `botRejoinFailed { reason:"name_in_use" }` | end |
| SP1 | spawn | pump | `dest = next of dests`; `feet = findSpawnCell(dest)`; defined | `engine.spawn(name, dest.dimensionId, feet)` | ground (ok) |
| SP2 | spawn | no cell for this dest | more dests left | next dest | spawn |
| SP3 | spawn | no cell for any dest | none left | `botRejoinFailed { reason:"spawn_failed" }` | end |
| SP4 | spawn | `spawn` returned `ok:false` | `spawnAttempts < spawnMaxAttempts` (3) | first check `playersNamed(name)`: if a body now exists adopt it as ours (double-spawn guard), else wait `spawnRetryTicks` (10) | spawn |
| SP5 | spawn | `spawn` failed | attempts exhausted | `botRejoinFailed { reason:"spawn_failed" }` | end |
| GR1 | ground | pump | `bot.isOnGround` | none | mark |
| GR2 | ground | `now - stateSince >= snapshot.groundWaitTicks` (60) | not grounded | `engine.disconnect(bot)` (empty body); `botRejoinFailed { reason:"spawn_failed" }` | end |
| M1 | mark | pump | `store.markRestored(name, seq)` returns | create `RestoreToken` (§8.1) | apply |
| M2 | mark | `markRestored` threw | `markAttempts < 3` | retry next pump | mark |
| M3 | mark | threw 3 times | none | `engine.disconnect(bot)`; `botRejoinFailed { reason:"error" }`; snapshot still unconsumed | end |
| A1 | apply | pump | `applySnapshot(bot, snap, token, {now, held, scanDrops, cursor})` -> `done` | `stacks = stacksOf(snap)`; `leftover = result.leftover` | haul_drop (escape with haul, §7) else live |
| A2 | apply | `partial` | `applyAttempts < applyMaxAttempts` (5) | `cursor = result.cursor`; wait `applyRetryTicks` (2) | apply |
| A3 | apply | `partial` | attempts exhausted | `leftover = result.leftover` (all unplaced stacks) | live (with carryover) |
| A4 | apply | `refused not_ready` | within `groundWaitTicks` | retry next pump | apply |
| A5 | apply | `refused scan_unavailable` | `now - markedAt < snapshot.scanDeferMaxTicks` (1200) | retry every `scanRetryTicks` (20) | apply |
| A6 | apply | `refused` anything else, or A5 timeout, or bot died before the first `setItem` | cursor not started | **re-arm** (§8.3) then `engine.disconnect(bot)`; `botRejoinFailed { reason:"error" }` | end |
| HD1 | haul_drop | see §7 | | | haul_away / live |
| LV1 | live | entered | none | register + checkpoint + events, exact order of §3.3 | end |

`scanDrops` in A1 = `cfg.snapshot.dropsOnDisconnect` for **every** cause; `applySnapshot` itself runs the drop scan only when `snap.status === "online"` (S4a §5.3 step 3 and §6.2 item 6, H5: the status, not the cause, tells whether the body left without a clear step). V3 and A5 wait on the same condition (`dropsOnDisconnect` and `status === "online"`). When `result.skippedAsDropped > 0` the service logs `[colony] <name>: <n> stacks left on the ground (drop scan)`; the stacks stay on the ground (conserved).

### 3.2 Destinations (`destOrder`, resolved in V2)

| Kind | Source | Valid when |
|---|---|---|
| `summoner` | `summonBot.near` / `dimensionId` | chunk loaded and a spawn cell exists |
| `home` | `colony.home()` | same |
| `owner` | `snap.owner` (else the first online human, sorted by name) found in `engine.humans()`; pos = `floor` of the owner's feet, their dimension | owner online, chunk loaded, spawn cell exists |
| `lastPos` | `snap.lastPos`, `snap.dimensionId` | same |

Spawn cell search (`findSpawnCell`, adapter, pure scan with `blockAt`): candidate cells are the column of `near` and the cells within `snapshot.spawnSearchRadius` (2) horizontally, ordered by Chebyshev distance then by `|dy|` ascending, `dy` in `-4..+4` (`snapshot.spawnSearchDy`). A cell is safe when the feet and head blocks are air (not liquid), the block below is solid and not liquid, and none of feet, head, below has typeId in {`minecraft:lava`, `minecraft:water`, `minecraft:fire`, `minecraft:magma`, `minecraft:cactus`, `minecraft:campfire`, `minecraft:soul_campfire`, `minecraft:sweet_berry_bush`, `minecraft:powder_snow`}. Result feet = `(cx + 0.5, cy, cz + 0.5)`.

### 3.3 Live (LV1), exact order (nothing may be reordered)

1. `id = directory.registerRejoined(bot, init, now)`: for summon/reload/owner_returned `init = { stats: snap.stats }` (fresh idle controller, no carry); for escape `init = { carry: flow.carry, stats: snap.stats }` (`flow.carry` = `{ brainState, recover: true, objectiveItemIds?, stats? }`, no task, D26; `init.stats` overrides `carry.stats`). The controller exists **before** the event so the `assign` effect the core emits on `botRejoined` finds it.
2. `markDirty(name, "rejoin", now)` and an immediate forced write: `captureSnapshot(... status "online", carryover: leftover)` then `store.write`. This replaces the consumed seq at once and persists `leftover` as `carryover` (S4a §5.4 step 5, D10). Failure: log, `pendingCarryover.set(lower, leftover)`, retried by the normal checkpoint writer (it passes `carryover` until one write succeeds).
3. `emit botRejoined { now, botId: id, name, cause, pos: bot position, stacks, owner: snap.owner, dest?, seq, leftover: leftover.length, haulDropped? }`. `dest` only for `escape`.
4. If `leftover.length > 0`: `emit botNotice { name, botId: id, notice: { id: "restoreLeftover", count: sum of leftover n } }`.
5. `heldStore.delete(lower)`. The flow is removed.

### 3.4 Worked example (summon, in-session, tick arithmetic)

`!summon Bot-1` at 48100; the summoner stands at (10, 1, 10). Pump ticks are multiples of 4.
- 48100: R2 -> resolve; V1/V2 same pump; `dests = [summoner (10.5,1,10.5)]`; N1 (`notBefore = 48100`, name free) -> spawn; SP1 spawns.
- 48104: GR1 grounded -> M1 `markRestored(bot-1, 8)` ok -> A1 `applySnapshot` returns `done {restored: 3, relocated: 0, leftover: []}` (held stacks used) -> LV1 -> `botRejoined {cause:"summon", stacks:3}`; reply `Back — 3 stacks restored.`
- Total 4 ticks after the effect (1 pump). A second `summonBot` for the same name before 48104 hits R0 (`busy`); after 48104 the core sees a live bot and issues a goto instead (S5 §4.5), so no second restore is possible.

## 4. Idle and far self-dismiss

### 4.1 Detection (service pump step 3, per live bot, `ownerless` bots included)

Eligible bot: `presence live` (a registered controller), no flow, `taskIdOf == undefined`, `layerOf == "idle"`, not recovering, `now - lastActiveTick(botId) >= idle.idleGraceTicks` (600), `now >= idleRefusedUntil`.
`idleFor = now - lastActiveTick(botId)`; `minHumanDist` = smallest horizontal distance from the bot to any human in `engine.humans()` **in the same dimension** (a human in another dimension counts as infinitely far; no humans online = infinitely far).

| Trigger | Condition | Kind |
|---|---|---|
| idle | `idleFor >= idle.idleTicks` (12000 = 10 min) | `idle` |
| far | `idleFor >= idle.farTicks` (1200 = 60 s) and `minHumanDist > idle.farFromPlayersBlocks` (64) held continuously for `farTicks` (`farSince` resets whenever a human comes within 64) | `far` |

Far is "parked": idle for `farTicks` **and** far. Busy bots (gathering, defending, fighting) are never self-dismissed.

### 4.2 Behaviour (LEAVE machine rows P5, P6, W*, T*, C)

1. `captureSnapshot` probe. `cargo = inventory stacks that are not gear`; gear = typeId ends with `_sword|_axe|_pickaxe|_shovel|_hoe|_helmet|_chestplate|_leggings|_boots`, or is `minecraft:shield|bow|crossbow|trident|torch`, or `kb.food(typeId)` is defined (S2a `Knowledge`). Tools, armour, shield and food always stay with the bot.
2. `reachable(bot)` (§1.7): walk to the chest, deposit **excluded + cargo** (stack by stack, `depositSlot`); a full chest ends the pass (`chestFull` notice once); excluded left over -> refuse (row T2); cargo left over simply stays in the snapshot.
3. No reachable chest: no excluded stacks -> commit directly (everything snapshotted, "else snapshot"); excluded stacks -> **refuse** (row P6): the bot stays live, `idleRefusedUntil = now + idle.idleRetryTicks` (1200), one log line. An idle bot never drops items on the ground.
4. Commit (status `dismissed`), end event `botDismissed { cause: "idle" | "far" }`. The core record was `live` the whole time (S5 §4.4: it removes the record and creates the `AbsentBot`).
5. Abort rules before the commit: `onAssign(botId)` is called by the runtime before delivering an `assign` effect; it aborts an idle/far flow in `prep|walk|put` and returns, so the task is delivered normally (the assign wins, nothing is lost: nothing was cleared). `layerOf` `combat`/`reflex` aborts the walk (W1). A human within `farFromPlayersBlocks / 2` aborts a `far` flow.

### 4.3 Takeover

`dismissBot` for a bot with an idle/far flow in `prep|walk|put|drop`: the flow's `kind` becomes `command`, `requestedBy` is set; state kept. In `commit`/`gone` it is too late: answer `botDismissFailed { reason:"busy" }`.

### 4.4 Worked example (idle, chest 30 blocks away)

`idleTicks = 12000`. Bot last active at tick 60000; at 72000 `idleFor = 72000 - 60000 = 12000 >= 12000` -> kind `idle`. Inventory: iron_sword (gear), 20 apples (food), 40 cobblestone and 12 coal (cargo), shield (offhand). Chest at horizontal distance 30 <= 48: walk, deposit 2 cargo stacks, `commit` snapshots sword, apples, shield (`stacks = 2 + 1 = 3`). Bot walks 30 blocks at about 4.3 blocks/s (sprint-less walking): about 140 ticks, under `depositTimeoutTicks` (300) and `flowDeadlineTicks` (500).

## 5. Escape_rejoin (LEAVE kind `escape`, then RESTORE cause `escape`)

### 5.1 `requestEscape(botId, now, carry)` (called by `BotController.beginEscape`, S1 §3.6)

Returns synchronously; the work happens in `pump` of the same tick. Checks in order; the first failing check returns false:

| # | Check | On failure |
|---|---|---|
| E1 | `cfg.snapshot.enabled && cfg.snapshot.sameNameRespawn` | return false (log once per 1200 ticks) |
| E2 | no flow for the bot's name; body valid | return false |
| E3 | `dest`: `colony.home()` defined and `isChunkLoaded(home)` -> `"home"`; else the owner (`colony.ownerOf(botId)`, else the first online human) is in `engine.humans()` and their chunk is loaded -> `"owner"` | return false and `emit botNotice { name, botId, notice: { id: "escapeBlocked" } }` (the controller then waits `combat.escapeRetryTicks`, so at most one notice per 200 ticks) |
| E4 | none | register `LeaveFlow{kind:"escape", carry, dest}`; return true |

**No cooldown:** the service stores no "last escape" tick. A bot that has just rejoined may escape again on its next pump (its new controller has `escapeBlockedUntil = 0`). The only throttle is the controller's `escapeRetryTicks` after a *refusal*.

### 5.2 Order of operations (maps to table rows)

| Step | What | Rows |
|---|---|---|
| 1 | Excluded stacks: deposit if the bot stands within 2.5 blocks of the colony chest, else drop (<= 40 ticks, then proceed regardless) | P3, P4, T1, D1-D3 |
| 2 | Capture with `status "escaping"`, `seq` = `max(pointer seq, restored seq) + 1` assigned by `write` | C1 |
| 3 | Write, then read back and compare seq and `contentHashOf` ("verify stored") | C4, C5 |
| 4 | Clear every snapshotted slot (never `clearAll`) | C6 |
| 5 | `disconnect()`, then `dispose("escaped")`, then `botEscaped` | C8-C11 |
| 6 | Wait `respawnDelayTicks` (2, P9) and for the name to be free | N1 |
| 7 | Spawn the same name at `home` else the owner's feet (`destOrder("escape")`) | SP1 |
| 8 | Grounded, `markRestored`, `applySnapshot` (held stacks, no drop scan: the body was cleared) | GR1, M1, A1 |
| 9 | Haul drop when the destination is the owner (§7) | HD1, HD2 |
| 10 | Register the controller with `{ carry, stats }` (`carry.recover = true`); forced `online` write; `botRejoined` | LV1 |
| 11 | The **core** re-emits `assign` (same task id, `delivered` folded) on `botRejoined`. The controller creates the executor from that `assign`, in the paused/recover layer, and keeps it paused until `hp >= recoverHp` (S1 §2.5 / H4, §3.5-3.6) | (core) |

Controller hand-off (S1 §2.3, §3.6; D26: one task owner, the core): at step 5 the old controller is disposed with `"escaped"`; it exports `ControllerCarry = { brainState, recover, objectiveItemIds?, stats? }` (hand-off H2) and **no task**: the task stays assigned in the core record (`presence = "rejoining"`, §11.3). At step 10 the runtime builds `new BotController(deps, { carry, stats }, now)`: layer `combat`, phase `recover`, **no executor**. The controller never rebuilds a task from the carry or from the snapshot. When the core's re-emitted `assign` arrives, the controller creates the executor already paused (H4: the `recover` layer holds it) and it resumes when recovery ends. If the flow fails *before* step 5, `directory.onEscapeFailed(botId, now)` (S1 T17). If it fails *after* step 5, the core receives `botRejoinFailed { cause: "escape" }` (task requeued, bot becomes `dismissed`, snapshot kept).

### 5.3 Worked example (tick arithmetic, seq arithmetic)

Home is set. Bot at HP 3 with 8 diamonds, `now = 48000`, store pointer seq 7, `:r` = 6.
- 48000: controller picks `escape_rejoin`, `requestEscape` -> true (E3: home chunk loaded, `dest "home"`). Same pump, `service.pump`: no excluded stacks -> commit. `write` assigns `seq = max(7, 6) + 1 = 8`, status `escaping`. Verify ok, clear ok, `disconnect()` ok, `dispose("escaped")`, `botEscaped {dest:"home"}` -> chat `Too hurt — escaping to home.` `notBefore = 48000 + 2 = 48002`.
- 48004: pump: `playersNamed` empty, `48004 >= 48002` -> `findSpawnCell(home)` -> spawn.
- 48008: grounded -> `markRestored(name, 8)` (`:r` = 8) -> `applySnapshot` done (held stacks) -> `registerRejoined` -> forced write `seq = max(8, 8) + 1 = 9` status `online` -> `botRejoined {cause:"escape", dest:"home"}` -> chat `Safe at home. Recovering.`
- Result: 8 ticks (2 pumps) from the decision to a live bot; seq 8 is consumed, seq 9 is the live checkpoint.

## 6. Save & Quit restore on world load

### 6.1 Sequence (`onWorldLoad(now)`)

1. `store.gcAll()` (drop unreachable keys). `meta = store.readMeta()`; `roster = store.listRoster()` (O(bots), once).
2. `ownersFallback`: if `meta` is undefined or lacks an owner for a row whose snapshot has `owner`, fill `meta.owners[lower] = row.owner`. `meta ??= { owners: {} }`.
3. `emit rosterRestored { now, meta, names: roster.map(r => r.botName) }` (all rows, every status; `unreadable` rows use the lowercase key). The core creates one `AbsentBot dismissed` per name (S5 §4.7).
4. Build the restore queue: rows with `status` in (`online`, `escaping`) and not `unreadable`, sorted by `takenAtTick` ascending then name. Rows with status `dismissed` are **not** queued: **dismissed bots stay dismissed**. Unreadable rows are logged and stay dismissed.
5. Set `reloadWindowEnd = now + snapshot.reloadWindowTicks` (1200).

### 6.2 Queue processing (pump step 1)

Per queued row, at most one flow start per `snapshot.rejoinStaggerTicks` (8 ticks):

| # | Guard | Action |
|---|---|---|
| W1 | a flow exists for the name, or `restoredSeqs` has `name:seq` | drop the row |
| W2 | name online as a SimulatedPlayer (`/reload` of scripts left bodies alive) | `directory.adopt(bot)`; drop the row; the next checkpoint overwrites the stale seq (rows N2 / `markDirty "spawn"`) |
| W3 | `canRejoin(row)`: the effective owner is online (`row.owner` in `engine.humans()`, else any human when the row has no owner) **or** `colony.home()` is defined | start `RestoreFlow{cause: now <= reloadWindowEnd ? "reload" : "owner_returned"}` |
| W4 | else | keep the row; once, after `snapshot.deferNoticeTicks` (200) since world load, `emit botNotice { name, notice: { id: "rejoinDeferred", owner: row.owner } }` (colony voice, S5 §6) |

### 6.3 Owner returns

`onPlayerSpawn(playerId)` (a human): re-evaluate W3 for every kept row; rows whose owner id matches (or ownerless rows) start with cause `reload` if inside the window, else `owner_returned` (chat `Welcome back, <owner>.`). With `snapshot.rejoinDetect = "poll"` the service instead polls `engine.humans()` every `snapshot.ownerPollTicks` (20). A deferred bot can always be brought back by `!summon` (cause `summon`, no gating).

### 6.4 Destination order (`destOrder` reload and owner_returned = lastPos, home, owner's feet)

Rationale: lastPos keeps the colony layout and makes the P4 drop scan possible; home is the fixed safe point; the owner is the last resort because they may stand anywhere. A destination is skipped when its chunk is unloaded or no safe cell exists within 2 blocks and +-4 in Y (§3.2). Status `escaping` rows (crash between commit and rejoin) use `destOrder("escape")` instead, because their lastPos is where the danger was.
Example: bot saved at (100.5, 64, -20.25); on load the chunk at (100, -21) is unloaded; home (10, 70, 10) set and loaded with a safe cell: spawn at (10.5, 70, 10.5). Same bot with no home: the owner at (3.2, 65.0, 8.9) -> `floor` cell (3, 65, 8) -> spawn at (3.5, 65, 8.5).

## 7. Haul delivery with no home

Trigger: RESTORE cause `escape`, actual destination kind `owner` (no home, or home unusable at spawn time), and `carry.objectiveItemIds` non-empty (only a gather executor exports a non-empty objective item list, so no task kind is needed and the carry holds no task, D26). Otherwise nothing is dropped (with a home set, Phase 3 keeps the cargo and the bot resumes; home chests and the sorter are Phase 4).
Rule: **drop the objective items, keep tools, armour, shield and food.** `haulSlots` = inventory slots (after the restore) whose typeId is in `objectiveItemIds` and is not gear or food (gear test of §4.2 item 1).

| # | State | Trigger | Guard | Action | Next |
|---|---|---|---|---|---|
| HD1 | haul_drop | entered after A1 | `haulSlots` empty | `haulDropped = undefined` | live |
| HD2 | haul_drop | pump | slots remain, `now - stateSince < haulDropMaxTicks` (60) | up to `dropCallsPerPump` (8) `dropSlot(slot)` calls over `haulSlots`; `haulCount += returned`; `dropPos ??= location` | haul_drop |
| HD3 | haul_drop | slots empty or the 60 ticks passed | | `haulDropped = { itemIds: distinct typeIds dropped, count: haulCount }` (items that did not drop stay in the inventory) | haul_away (`haulCount > 0`) else live |
| HD4 | haul_away | entered | | `target` = the safe cell `haulStepAwayBlocks` (4) from `dropPos` along (`dropPos` minus the owner's position, normalised; `+x` if equal); `engine.navigateTo(bot, target)` | haul_away |
| HD5 | haul_away | within 1 block of target, or `haulStepTimeoutTicks` (60), or `navigateTo` false | | none | live |

The bot walks away so it does not pick the drop up again. Conservation: dropped items are world entities; the snapshot was already consumed, so nothing exists twice.
**Core accounting** (hand-off H3; `progress` is the core record's progress for the task, not part of the carry, D26): on `botRejoined` with `haulDropped`, `delivered' = progress.delivered + min(haulDropped.count, progress.held)` before the re-`assign`; if `delivered' >= amount` the task is dropped silently (S5 §4.7).
Example: gather 16 oak_log, `progress = {delivered: 3, held: 12}`, no home, owner at the destination. Restore puts the 12 logs back; HD2 drops them (12 calls = 2 pumps at 8 per pump if `dropSelectedItem` drops one item per call, P10); `haulDropped = {itemIds:["minecraft:oak_log"], count:12}`; `delivered' = 3 + min(12, 12) = 15 < 16`: the task continues with 1 log to go. Sword, armour and apples stay in the bot.

## 8. Exactly-once restore

### 8.1 Token design

```ts
interface RestoreRun {                         // service memory only, key = lowercase name; at most one per name
  snap: BotSnapshot;                           // decoded BEFORE markRestored; the store will not return it afterwards
  token: RestoreToken;                         // makeRestoreToken(snap, `${snap.botName}:${snap.seq}:${now}`, now)
  markedAt?: Tick;
  started: boolean;                            // true after applySnapshot returned anything but "refused"
  cursor?: ApplyCursor;
  held?: HeldStacks;                           // heldStore entry with entry.seq === snap.seq, else undefined
  leftover: SnapStack[];
}
const restoredSeqs = new Set<string>();        // `${lower}:${seq}`, added when markRestored returns; blocks any second flow for that seq in this session
```
Three independent layers (any one is enough to prevent a second restore):
1. **Store:** `markRestored(name, seq)` persists `:r = seq` and reads it back *before* the first `setItem`. `read`/`readDetailed` never return a seq `<= :r` (`consumed`).
2. **Apply:** `applySnapshot` keeps `startedTokens` (`${lower}:${seq}`) and returns `refused already_applied` for a second fresh start (S4a §5.3). Restore uses `setItem` only, so a retried slot write replaces, never adds.
3. **Service:** one `RestoreRun` and one flow per name; `restoredSeqs` guard; a name is spawned only when `playersNamed(name)` is empty (§8.4).

### 8.2 Interrupted restore (per-slot cursor)

`applySnapshot` returns `partial { cursor, leftover }` when a slot write throws, returns false or fails read-back. The service keeps `run.cursor` and calls again after `applyRetryTicks` (2 ticks) with `opts.cursor`; the cursor holds `next` (index into `planApplySteps`), `attempts`, `restored`, `relocated`, `skip`, `leftover`, `selected`. At most `applyMaxAttempts` (5) calls in total.
Example: 14 steps; step 6 fails twice: attempt 1 returns `partial {cursor.next:6, attempts:1}` (6 steps written: indices 0-5); 2 ticks later attempt 2 retries step 6: fails (`attempts:2`); attempt 3 succeeds, continues 6..13, returns `done {restored: 14}`. Steps 0-5 are not touched again because the loop starts at `cursor.next`; step 6's slot is either empty (written now) or already holds the stack (counted, not written twice). Total `setItem` calls = 14 + 2 failed ones that wrote nothing.
After attempt 5 still `partial`: A3: the unplaced stacks (`result.leftover`) are written into the next checkpoint's `carryover` (LV1 step 2) and `restoreLeftover` is sent. The next restore's `planApplySteps` re-offers `c<j>` entries. A script crash mid-restore loses the unwritten remainder (S4a Q4: accepted; loss, never duplication).

### 8.3 Re-arm (failure after `markRestored`, before the first `setItem`)

When `!run.started` and the flow cannot continue (A6, M-row after a mark, body died before the first write): `store.write({ ...run.snap, status: "dismissed" })` creates a new unconsumed seq (`max(pointer, :r) + 1`). Success: log `[colony] rearmed <name> seq <old> -> <new>`. Failure: `rearmPending.set(lower, run.snap)`; retried every `snapshot.rearmRetryTicks` (200) until it succeeds; each failure logs `[colony] REARM FAILED <name>: <reason>`. While pending, `!summon` for the name answers `botRejoinFailed { reason: "busy" }`. If `run.started` (some slot written) the remainder is **not** re-armed (it would duplicate placed stacks); it becomes `leftover` or, if the body is gone, is lost.

### 8.4 Double-spawn protection

- The only call to `engine.spawn` is row SP1. It runs in the same synchronous block as the check `playersNamed(name).length === 0`.
- After a throw (SP4) re-check `playersNamed(name)`: a body that appeared despite the throw is adopted as the flow's body, never spawned over.
- Both entry points (`onSummonBot`, world-load queue, owner return) call `startRestore(name, cause)`, which refuses when `flows.has(lower)`.
- A human who joined with the dismissed bot's name makes N3 fire (`name_in_use`); the snapshot is untouched.

## 9. Conservation invariants

Numbered; every one is a unit test in `snapshot-conservation.test.ts` / `snapshot-service.test.ts` (seeds 1..200, S6 §3.3).

1. **Single location.** Every item stack is, at any tick, in exactly one of: a live body, an unconsumed snapshot, a chest, a real world drop. Never two.
2. **Verified write before clear.** `clearSnapshotted` runs only after `store.write` returned `ok` and the read-back of that seq matched `contentHashOf` (rows C4-C6).
3. **Atomic commit.** Capture, write, verify, clear, `disconnect()` and `dispose` happen in one synchronous call stack; nothing can pick up or drop an item in between.
4. **No disconnect with items.** `disconnect()` is only called on a body whose snapshotted slots are empty. The single exception is the escape timeout (row D3, logged); there the engine's P4 behaviour decides, and loss is possible, duplication is not.
5. **Clear precision.** Slots are cleared individually (never `clearAll`); excluded stacks are never cleared by S4a, only disposed by S4b (§1.6).
6. **Consume before write.** `markRestored` returned (and was read back) before the first `setItem` of that seq; a seq is restored at most once per world; `addItem` is never used for restore.
7. **One body, one flow per name.** At most one entity, one flow and one `RestoreRun` exists per lowercase name; spawn happens only when the name is free.
8. **Excluded items** are never serialized; each is deposited, dropped with notice `excludedDropped`, or still in a live body; never silently destroyed (exception: invariant 4).
9. **Failed forced write never clears.** `write` not ok on dismiss/escape/idle/far leaves the body untouched (S4a D6).
10. **Leftover is kept.** Unplaced stacks go to `carryover` (written in the same pump the restore finishes) and are re-offered by the next apply; they are never discarded without a log line.
11. **Mainhand untouched.** Only `selectedSlot` and the 36 slots plus head, chest, legs, feet, offhand are read or written (S6 rule 8).
12. **No snapshot writes during flows** except the flow's own commit, forced `online` rejoin write, and re-arm; the checkpoint writer skips bots with a flow.
13. **Death deletes.** A bot that dies after its restore started has its snapshot deleted (`store.delete`, S5 Q7); its items are death drops (world entities), counted as ground.
14. **Escape has no cooldown** and no counter; the only precondition is "no flow running" (invariant 7).
15. **Conservation bound.** For every typeId, `bodies + store(unconsumed) + chests + ground` after any flow is `<=` before; it is `==` when no failure was injected and `dropSelectedItem` drops are counted as ground.
16. **Never touches people.** The service never reads or writes a human player's inventory or position and never targets an entity.

## 10. Failure table

Reasons are `SnapshotFailReason` (S5 §5 plus `storage_full`, D7). "Notice" = `botNotice` id; "msg" = S5 §6 message id fed with the reason text. Rows are test cases.

| # | Failure | Where | Exact handling | Player-visible |
|---|---|---|---|---|
| F1 | `spawn` throws or returns `ok:false` | SP4, SP5 | Re-check `playersNamed(name)` (adopt a body that exists); retry up to `spawnMaxAttempts` (3) every `spawnRetryTicks` (10); then `botRejoinFailed { reason: "spawn_failed" }`; snapshot unconsumed | summon: `summonFailed(bot, "the spawn failed")`; escape/reload: `rejoinFailed(bot, ...)` ("Its items are kept.") |
| F2 | `applySnapshot` throws a slot write | A2, A3 | `partial`: resume with the cursor every 2 ticks, max 5 attempts; then leftover to `carryover`, bot goes live | notice `restoreLeftover { count }` |
| F3 | `applySnapshot` `refused` (`bot_invalid`, `engine_error`, `token_mismatch`, `already_applied`) | A6 | Not started: re-arm (§8.3), disconnect the empty body, `botRejoinFailed { reason: "error" }`. `already_applied` after a service bug: treat as `done` with a log line | `summonFailed` / `rejoinFailed`, "something went wrong" |
| F4 | `refused not_ready` | A4 | Retry next pump, bounded by `groundWaitTicks` (60) | none |
| F5 | `refused scan_unavailable` (P4 says drops; `lastPos` chunk unloaded) | V3, A5 | Wait, recheck every 20 ticks up to `scanDeferMaxTicks` (1200); then `botRejoinFailed { reason: "error" }`; snapshot untouched. Never restore blind | `rejoinFailed` / `summonFailed` |
| F6 | Chest full while depositing | T2 | Notice once; remainder: command and escape drop it (+ `excludedDropped`); idle and far refuse (cargo only: stays in the snapshot) | `chestFull`; `excludedDropped(count, pos)` |
| F7 | Chest unreachable (not set, other dimension, unloaded, no path, > 48 blocks) | P4, P6, W4, W5 | command, escape: drop excluded; idle, far: refuse and back off 1200 ticks | `excludedDropped` (command, escape) |
| F8 | Storage full (`write` -> `storage_full`) | C4 | Body not cleared. command: `botDismissFailed { reason: "storage_full" }`; escape: `onEscapeFailed` (controller backs off 200 ticks, fights on); idle/far: silent, back off. Checkpoints: S4a §4.5 (log once per 1200 ticks) | `dismissFailed(bot, "the colony's save space is full")` |
| F9 | Other write failure (`engine_error`, `too_large`, `verify_failed`, `disabled`, `invalid`) | C4 | Same as F8 with reason `error` | `dismissFailed(bot, "something went wrong")` |
| F10 | Read-back verify mismatch | C5 | Body not cleared; `fail("error")`. The just-written seq stays as a harmless `dismissed` copy that the next write supersedes | as F9 |
| F11 | `clearSnapshotted` fails (`mismatch` or `clear_failed`) | C6 | `mismatch`: nothing cleared, `fail("error")`. `clear_failed`: `rollbackClearHeld` refills the emptied slots, recapture, write `online`, `fail("error")` | as F9 |
| F12 | `disconnect()` throws | C8 | `rollbackClearHeld`, recapture, write `online`, `fail("error")`; controller still alive | as F9 |
| F13 | Body still present after `goneWaitTicks` | G2 | `disconnect()` again; after 40 ticks `rollbackClearHeld` (if valid) + `botDismissFailed { "error" }` | as F9 |
| F14 | Decode/validate fails (`snapshot_unreadable`) | V1, listRoster | Restore: `botRejoinFailed { reason: "snapshot_unreadable" }`; world load: row logged and left dismissed. No fallback to an older seq (swept). Nothing is deleted | `summonFailed(bot, "its saved inventory couldn't be read")` |
| F15 | No snapshot / consumed | V1 | `botRejoinFailed { reason: "no_snapshot" }` | "no saved inventory found" |
| F16 | Name collision (player with that name online after `nameFreeWaitTicks` 40) | N3 | `botRejoinFailed { reason: "name_in_use" }`; no spawn | "the old copy is still leaving; try again" |
| F17 | Destination chunk unloaded or unsafe | SP2, SP3, V2 | Next destination in `destOrder`; none left: escape/reload/owner_returned -> `owner_offline`; summon -> `spawn_failed` (world load: the row stays queued and `rejoinDeferred` is sent) | `rejoinFailed` / `summonFailed` / `rejoinDeferred` |
| F18 | Owner offline and no home, after the commit | V2 | `botRejoinFailed { cause:"escape", reason: "owner_offline" }`: bot stays dismissed, snapshot kept, task requeued by the core | `rejoinFailed(bot, "its owner is offline")` |
| F19 | Owner offline and no home, before the commit | E3 | `requestEscape` false | `escapeBlocked` |
| F20 | `markRestored` throws | M2, M3 | Retry 3 pumps; then disconnect the empty body, `botRejoinFailed { "error" }` | as F3 |
| F21 | Bot dies before the commit | L0 | Abort; `store.delete(name)` (S5 Q7); items are death drops | core `left (died)` |
| F22 | Bot dies after spawn, before `markRestored` | GR*, M* | Snapshot kept (unconsumed); `botRejoinFailed { "spawn_failed" }` | as F1 |
| F23 | Bot dies during apply | A* | Unplaced remainder lost, placed stacks drop on death; `store.delete(name)`; run discarded | core `left (died)` |
| F24 | Excluded stack in an equipment slot, `unequip` fails | P3-D* | command, idle, far: `fail("error")` (refuse); escape: proceed at the drop deadline (D3) | `dismissFailed` |
| F25 | Flow deadline (500 ticks) | all | Before commit / before mark: abort with `error` as F9/F20 | as F9 |
| F26 | `snapshot.enabled = false` | L1, R1, E1 | dismiss: `botDismissFailed "error"`; summon: `botRejoinFailed "error"`; escape refused; idle/far never start; world-load queue empty (log) | `dismissFailed` |
| F27 | `persistMeta` write fails | `onPersistMeta` | Log; `pendingMeta` retried every 200 ticks; newest meta wins | none |
| F28 | Script reload with live bots | W2, N2 | Adopt the live body, no restore | none |

## 11. Payloads, emission matrix, task fate

### 11.1 Exact TypeScript (S5 §5 shapes plus the added fields; the contract writer merges)

```ts
// src/core/types.ts additions (S4b)
export type SnapshotFailReason =
  | "busy" | "no_snapshot" | "snapshot_unreadable" | "spawn_failed" | "name_in_use" | "owner_offline" | "storage_full" | "error";

export type SnapEvent =                                   // members of ColonyEvent
  | { kind: "botDismissed"; now: Tick; botId: BotId; name: string; cause: DismissCause; stacks: number; seq?: number }
  | { kind: "botDismissFailed"; now: Tick; botId: BotId; name: string; reason: SnapshotFailReason }
  | { kind: "botEscaped"; now: Tick; botId: BotId; name: string; dest: EscapeDest; pos?: Vec3 }
  | { kind: "botRejoined"; now: Tick; botId: BotId; name: string; cause: RejoinCause; pos: Vec3; stacks: number;
      owner?: PlayerRef; dest?: EscapeDest; seq?: number; leftover?: number;
      haulDropped?: { itemIds: string[]; count: number } }
  | { kind: "botRejoinFailed"; now: Tick; name: string; cause: RejoinCause; reason: SnapshotFailReason; botId?: BotId }
  | { kind: "rosterRestored"; now: Tick; meta: ColonyMeta; names: string[] }
  | { kind: "botNotice"; now: Tick; name: string; botId?: BotId; notice: BotNotice };

// effects (unchanged from S5): dismissBot { botId, name, cause: "command", requestedBy },
// summonBot { name, near, dimensionId, requestedBy }, persistMeta { meta }.

// src/core/combat/types.ts (S1 hand-offs H2 + D26). NO task, NO progress: the core owns the task and re-emits `assign` on botRejoined.
export interface ControllerCarry {
  brainState: unknown;                 // BrainState (S2b), committed tactic/target state
  recover: boolean;                    // true for an escape rejoin: start in layer `combat`, phase `recover`
  objectiveItemIds?: string[];         // executor.objectiveHint().items.ids at export time (§7 haul trigger)
  stats?: string;                      // serialised OutcomeStats; init.stats (= snap.stats) overrides it
}
export interface ControllerInit { carry?: ControllerCarry; stats?: string }   // stats alone = fresh idle controller that loads snap.stats
```
`stacks` always equals `stacksOf(snapshot)` of §2.2. `dest` on `botEscaped` is the choice made at request time (`"home" | "owner"`); `dest` on `botRejoined` is the **actual** destination kind (`home` or `owner`). Messages use `botRejoined.dest`.

### 11.2 Emission matrix (each event: who, when, how often)

| Event / effect | Emitted by | When | At most |
|---|---|---|---|
| `botDismissed` | LEAVE G1 | body confirmed gone, kinds command/idle/far | once per flow |
| `botDismissFailed` | LEAVE `fail`, L1 | kind command only | once per flow |
| `botEscaped` | LEAVE C11 | right after a successful disconnect | once per escape |
| `botRejoined` | RESTORE LV1 | after controller registration and the forced write | once per restore |
| `botRejoinFailed` | RESTORE | any terminal failure after the effect/commit/world-load start | once per flow |
| `rosterRestored` | world load | once per world load, before any `botRejoined` | once |
| `botNotice` | LEAVE / RESTORE / detection | ids `chestFull`, `excludedDropped`, `restoreLeftover`, `escapeBlocked`, `rejoinDeferred` | per row above |
| `persistMeta` handling | `onPersistMeta` | `store.writeMeta(meta)` | per effect |

Idle/far flows never emit `botDismissFailed` (the core never marked the bot `leaving`).

### 11.3 What happens to the task while the bot is away

| Flow | Task | Mechanism |
|---|---|---|
| Escape | Stays assigned. The core keeps it (`presence = "rejoining"`), `!stop` clears it without a `cancel` effect, `botRejoined` re-`assign`s the same id with `delivered` folded (S5 §4.7); the new controller creates its executor from that `assign`, paused in the recover layer (D26, H4). The carry holds no task | core record + `assign` effect (not `ControllerCarry`) |
| Failed escape rejoin | Core requeues it at the queue front (`botLeftRequeued`); the bot becomes `dismissed` | `botRejoinFailed` |
| Manual dismiss | The core already dropped the task (own task, `"stopped"`) or requeued it (pinned override). The service **refuses with `busy`** if `taskIdOf(botId)` is still set (L1) | S5 §4.4 |
| Idle / far dismiss | Not eligible unless the bot has no task; an `assign` arriving before the commit aborts the flow (`onAssign`) | §4.2 item 5 |
| Summon / reload / owner_returned | No task (the bot was dismissed); the new controller starts idle | `registerRejoined(bot, undefined)` |

## 12. Snapshot GameTests (S6 §2.4): confirmed and fixed

### 12.1 `snapshot_dismiss_summon_conserves` (confirmed with 4 fixes)

- **Fix 1 (shulker).** S6 expects `fp1 === fp0` with a shulker box in slot 21 and "zero `minecraft:item` entities at the end". Under A5 (§0) the shulker is excluded; with no colony chest in this test it is dropped. Replace by: `fp0` excludes slot 21; after the dismiss exactly **one** `minecraft:item` entity of `minecraft:white_shulker_box` exists within 12 blocks (the real drop); after the summon `fp1 === fp0` (slot 21 empty) and still exactly that one entity (no second shulker created).
- **Fix 2.** Step 5 (second `!summon`): the core sees a live bot and issues a goto, so it does not exercise the exactly-once restore. Keep it (proves no duplicate body, `fp1` unchanged) and add the service unit test U2 (§12.3) for the double `summonBot` effect.
- **Fix 3.** `combatDebug(name)` gains `excludedDropped` (items); assert `dismisses == 1`, `excludedDropped == 1`, `summons == 1`.
- **Fix 4.** Dismiss wait <= 200 ticks is right (budget: 1 pump + drop + 20-tick gone wait = about 30 ticks); summon wait <= 300 is right (8 ticks). Total about 600 of 800.
Pass conditions (final): `fp1 === fp0`; new bot within 3 blocks of (10,1,10); exactly one player of that name after step 5, fingerprint still `fp0`; one shulker item entity, no other `minecraft:item` entity from this bot; `dismisses == 1`, `summons == 1`, `excludedDropped == 1`; `presence` went `leaving -> dismissed -> rejoining -> live`.

### 12.2 `snapshot_escape_rejoin` (confirmed with 3 fixes)

- **Fix 1.** "Zero `minecraft:item` entities in the whole structure area" is wrong in a grove (leaves drop saplings, sticks, apples; killed zombies drop flesh). Replace by: record `baseline` = ids of item entities at the trigger tick; at the end no **new** item entity has a typeId that occurs in `fingerprintLast` (kit, `diamond`), and the new `oak_log` item entities number at most the baseline's.
- **Fix 2.** Assert the order of events: `view.presence` is `rejoining` (task kept, `view.task?.id === taskId`) then `live`; `newBot.id !== oldId`; `combatDebug.escapes >= 1`, and `escapes` increases by exactly 1 for one escape.
- **Fix 3.** Distance check "within 3 blocks of the home cell (13,1,13)" stays valid (spawn cell = (13.5, 1, 13.5), 0.7 blocks). Timeline budget: gather <= 2500 + leave <= 400 + respawn <= 600 = 3500 <= 4200.
Pass conditions (final): `fp1 === fingerprintLast`; home distance <= 3; exactly one player of the name; no new item entities as above; `escapes >= 1`; `view.task?.id === taskId` right after the rejoin.

### 12.3 Service unit cases to add to TC-B4 (FakeSnapshotEngine, FakeClock; each is a failure-table row)

U1 commit order spy: write, readDetailed, clear, disconnect, dispose in that order (and none after a failed write). U2 two `summonBot` effects in one pump: one spawn, second `busy`. U3 `markRestored` called before the first `setItem` (spy order). U4 spawn throws twice then succeeds: one body. U5 spawn throws but a body appeared: adopted, no second spawn. U6 `apply` partial x2 then done: `setItem` count equals plan length. U7 partial x5: `carryover` in the forced write, notice `restoreLeftover`. U8 re-arm after `bot_invalid`. U9 idle with excluded and no chest: refused, backoff 1200. U10 `assign` during idle walk aborts the flow. U11 world load: dismissed row not queued; `online` row queued; owner offline + no home: `rejoinDeferred` after 200 ticks. U12 haul: only objective slots dropped, `haulDropped.count` right. U13 `storage_full`: body untouched, `botDismissFailed` reason `storage_full`. U14 escape with `dropsOnDisconnect=true`: no item on the fake ground after the flow. U15 scripted reload with a live body: adopt, no restore.

## 13. Config keys (S4b)

New keys in `config.snapshot` (S4a keys are in S4a §7; `intervalTicks` per D6) and `config.idle` (new group). All ticks are game ticks, 20 per second.

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `snapshot.sameNameRespawn` (S6) | `true` | bool | P9 result. `false` disables escape (`requestEscape` false); other flows still wait for a free name |
| `snapshot.inSessionStacks` (S6) | `true` | bool | P9 result. `false`: never keep `HeldStacks`, apply from the codec only |
| `snapshot.respawnDelayTicks` (S6) | 2 | ticks | Wait after `disconnect()` before the same name is spawned again |
| `snapshot.rejoinDetect` (S6) | `"events"` | `"events" \| "poll"` | `events`: owner return via `playerSpawn`; `poll`: `engine.humans()` every `ownerPollTicks` |
| `snapshot.ownerPollTicks` | 20 | ticks | Poll spacing for `rejoinDetect = "poll"` |
| `snapshot.flowDeadlineTicks` | 500 | ticks | Pre-commit / pre-mark deadline of any flow (must stay below `flowTimeoutTicks` 600) |
| `snapshot.goneWaitTicks` | 20 | ticks | Wait for the body to disappear after `disconnect()` |
| `snapshot.nameFreeWaitTicks` | 40 | ticks | Wait for an old body of the same name to vanish before `name_in_use` |
| `snapshot.spawnMaxAttempts` | 3 | attempts | Spawn tries |
| `snapshot.spawnRetryTicks` | 10 | ticks | Spacing between spawn tries |
| `snapshot.groundWaitTicks` | 60 | ticks | Wait for `isOnGround` after spawn |
| `snapshot.spawnSearchRadius` | 2 | blocks | Horizontal search for a safe spawn cell |
| `snapshot.spawnSearchDy` | 4 | blocks | Vertical search (+-) |
| `snapshot.depositTimeoutTicks` | 300 | ticks | Walk-to-chest limit (manual dismiss, idle, far) |
| `snapshot.dropCallsPerPump` | 8 | calls | `dropSlot` calls per flow per pump |
| `snapshot.dropMaxTicks` | 60 | ticks | Drop-state limit for command dismiss |
| `snapshot.escapeDropMaxTicks` | 40 | ticks | Drop-state limit for escape, then proceed (survival bias) |
| `snapshot.dropStepAwayBlocks` | 0 | blocks | Walk this far from the first drop before the commit (set if P10 shows instant pickup) |
| `snapshot.excludedLoopMax` | 3 | loops | Times the commit may find new excluded stacks before failing |
| `snapshot.haulDropMaxTicks` | 60 | ticks | Limit of the haul drop state |
| `snapshot.haulStepAwayBlocks` | 4 | blocks | Distance the bot walks from the haul drop |
| `snapshot.haulStepTimeoutTicks` | 60 | ticks | Limit of the walk away |
| `snapshot.reloadWindowTicks` | 1200 | ticks | After world load, restores count as cause `reload` |
| `snapshot.rejoinStaggerTicks` | 8 | ticks | Minimum spacing between world-load flow starts |
| `snapshot.deferNoticeTicks` | 200 | ticks | Delay before `rejoinDeferred` is sent |
| `snapshot.scanRetryTicks` | 20 | ticks | Recheck spacing while the drop-scan chunk is unloaded |
| `snapshot.scanDeferMaxTicks` | 1200 | ticks | Give up waiting for the scan chunk |
| `snapshot.rearmRetryTicks` | 200 | ticks | Retry spacing of a failed re-arm write and of `persistMeta` |
| `idle.idleTicks` | 12000 | ticks | Idle time before idle self-dismiss (10 min). S6 DoD 29 calls this `idle.dismissTicks`: use `idleTicks` |
| `idle.farTicks` | 1200 | ticks | Idle time before far self-dismiss (60 s) |
| `idle.farFromPlayersBlocks` | 64 | blocks | "Far from every player" distance (same dimension, humans only) |
| `idle.depositWalkMaxBlocks` | 48 | blocks | Colony chest must be within this horizontal distance to walk there (all deposit walks) |
| `idle.idleRetryTicks` | 1200 | ticks | Backoff after a refused or aborted idle/far dismiss |
| `idle.idleGraceTicks` | 600 | ticks | No self-dismiss within this time after spawn, rejoin or the last activity |

## 14. Open questions (chosen fallbacks) and hand-offs

| # | Question | Fallback chosen |
|---|---|---|
| Q1 | Brief: "owner offline and no home -> stay dismissed" for escape; S5 defines notice `escapeBlocked` (a refusal). | Refuse at request time (E3, `escapeBlocked`); if the owner vanishes after the commit the bot stays dismissed (F18). Alternative (escape-as-dismiss with no destination) needs a new `DismissCause "escape"` and a string; not adopted. |
| Q2 | Idle bots with cargo: ROADMAP says "deposit to the chest if reachable, else snapshot". | Cargo (non-gear, non-food) is deposited, gear and food are kept; with no chest everything is snapshotted. |
| Q3 | Can `spawnSimulatedPlayer` target an unloaded chunk? (S6 probe `chunks`) | Never try: unloaded destinations are skipped (F17). |
| Q4 | P10: does `dropSelectedItem` drop one item or the stack, and is pickup delayed? | Loop up to `dropCallsPerPump` per pump; `dropStepAwayBlocks` default 0, raise to 4 if pickup is instant. |
| Q5 | Excluded stack in an equipment slot (banner on the head, rare). | `unequip` first; failure: refuse (F24). |
| Q6 | No fallback to an older seq when the newest is unreadable (S4a sweeps old chunks). | Accepted; roster row stays `dismissed`, error text tells the player the items are kept. A future `!forget` is out of scope. |
| Q7 | Home in another dimension than the owner for escape. | `home` wins; spawn happens in the home's dimension (S5 Q2). |
| Q8 | Repeated escape loops if the destination is itself hostile (no cooldown by design). | Accepted (ROADMAP). Every loop is conserving; `combatDebug.escapes` counts them. |

**Hand-offs (all accepted by D21; the reviser of each target doc applies the rows that name it: H1/H3/H7 -> S5, H2/H4 -> S1, H5 -> S4a (done), H6 -> S6):**

| # | To | Needed change |
|---|---|---|
| H1 | S5 §6 routing | Bot-voiced `botNotice` (`chestFull`, `excludedDropped`, `restoreLeftover`) must resolve the record by name in **any** presence (`live`, `leaving`, `rejoining`), because dismiss/escape notices are sent while the record is `leaving`/`rejoining`. Otherwise they are dropped. |
| H2 | S1 §3.6 / `ControllerCarry`, `ControllerInit` | `ControllerCarry = { brainState, recover, objectiveItemIds?, stats? }` exactly as §11.1: **no `task`, no `progress`** (D26). `objectiveItemIds` comes from `executor.objectiveHint().items.ids`; `ControllerInit = { carry?, stats? }` (the brain loads `snap.stats` through S2b). S1 §3.6 no longer rebuilds the executor from `carry.task`. |
| H3 | S5 §4.7 `botRejoined` | Fold `haulDropped` into `delivered` (rule in §7). Accept the optional fields `seq`, `leftover`, `haulDropped`, `pos` of §11.1. |
| H4 | S1 §2.5 `assign` | A controller created with `carry.recover = true` has no executor. The core's re-emitted `assign` creates the executor in the paused/recover layer (no warning); the executor resumes when recovery ends. If an executor with the same `taskId` already exists, replace it silently and keep the layer. |
| H5 | S4a | DONE in S4a: `rollbackClearHeld` (S4a §5.2a); drop scan for any cause when `snap.status === "online"` (S4a §5.3 step 3, §6.2 item 6). |
| H6 | S6 | `snapshot.timerTicks` -> `snapshot.intervalTicks` (D6); `idle.dismissTicks` -> `idle.idleTicks`; the two GameTest fixes of §12; `combatDebug` gains `excludedDropped` and `summons`. |
| H7 | S5 §5/§6 | `SnapshotFailReason` adds `"storage_full"`; `SNAPSHOT_FAIL_TEXT.storage_full = "the colony's save space is full"` (D7). |

## Revision log (review pass 1)

No review files exist for S4b (`docs/phase3/reviews/S4b-snapshot-flows--*.md` matches nothing); this pass applies `DECISIONS.md` rows only.

- DECISIONS D10: applied/confirmed. The three hand-offs are already covered; added the coverage map as decision A11 (P4-says-drops fallback: V3/A5/A6/F5; forced-write contract: C4-C6/F8-F10/invariants 2, 9; `partial`/`leftover` -> `carryover`: A2/A3/§3.3 step 2/§8.2/F2/invariant 10). C4 now also says "not disconnected".
- DECISIONS D21 (S4b hand-offs H1-H7): applied. §14 heading says all accepted and who applies what. H2 and H4 rewritten to the D26 shape. H5 marked DONE (S4a now defines it).
- DECISIONS D26: applied. `ControllerCarry` is now `{ brainState, recover, objectiveItemIds?, stats? }` (no `task`, no `progress`); `ControllerInit = { carry?, stats? }`; `registerRejoined` takes `ControllerInit`. §3.3 step 1, §5.2 steps 10-11 and the controller hand-off paragraph, §7 trigger (now `carry.objectiveItemIds` non-empty, no task kind), §11.3 escape row, A9 and the §7 core-accounting note changed: the core re-emits `assign` on `botRejoined`; the controller creates the executor paused in the recover layer (H4).
- Names matched to S4a: engine port member `rollbackClear` renamed `rollbackClearHeld` (S4a §5.2a); §1.5 now points to S4a instead of requesting it; `C1 pausedTaskId` uses `directory.taskIdOf(botId)` (the carry has no task); `scanDrops = cfg.snapshot.dropsOnDisconnect` for every cause, S4a decides by `snap.status === "online"` (A1 note); `skippedAsDropped` is logged; `DirtyReason` and `scanDroppedItems` are now defined by S4a.
- DECISIONS D6, D7, D9: already followed in this file (`intervalTicks`, `storage_full`, S4a helpers); header sentence extended, no other change.
