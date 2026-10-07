# Phase 2 spec: gatherers

The contract every Phase 2 job builds against. If code and this doc disagree, fix one of them; don't leave both.
Ground rules, survival rules and verified facts: `docs/AGENT-CONTEXT.md` (read it first). Phase 1 contract: `docs/PHASE1-SPEC.md` (still in force unless this doc changes it).

## Goal

Bots acquire resources on request and deliver them to a colony chest, under survival rules: they find the blocks, walk there, break them over real time with the best tool they have, pick the drops up, and put them in the chest. No item is created except by the crafting abstraction (exact ingredients consumed).

## Definition of done

1. `npm run check` passes (typecheck + vitest + build). All Phase 1 tests keep passing (only mechanical edits for the widened `Task` union are allowed in old tests).
2. Unit tests cover: parsing of `!gather` / `!chest`; colony semantics for gather and chest (allocation, offers, split, progress, requeue, messages); pure gather/crafting logic; the gather executor state machine against fake ports; the adapter against a mocked engine; runtime wiring (registry, progress events, chest effects).
3. GameTests exist (`/gametest runset colony`): chest set, gather logs into a chest (chest ends with ≥ N logs), cobblestone with a crafted pickaxe, no-source failure, two-bot split.
4. `PLAYTEST.md` has a Phase 2 section listing what the player must test by hand; `!help gather` / `!help chest` explain the commands.
5. Pack version 0.2.0 (done by the architect).

## Scope

In: `!chest set`, `!chest`, `!gather <item> [amount] [bots]` for logs (any or one species), cobblestone (from stone), dirt (from dirt / grass), sand, gravel; aliases `wood`, `logs`, `stone`, `cobble`, `grass`. Tools: the bot holds the best matching tool it has; takes one from the chest if it needs one; for cobblestone without any pickaxe it crafts a wooden pickaxe (logs → planks → sticks → crafting table → place table → pickaxe), getting logs from its inventory, the chest, or by chopping them by hand. Multi-bot gather (amount split between bots). The Phase 1 collision / offer / queue system applies unchanged to gather tasks.

Out (leave `TODO(phase-n)`): digging tunnels / pillaring up to reach buried or high blocks (only exposed blocks reachable from a standable cell are gathered); depositing non-yield junk (saplings, apples, flint); tool durability management; more recipes; several chests or per-player chests; chest persistence across reload (Phase 8); risk weighting (hook only, Phase 6); smelting; leaves/shears; bots in other dimensions than the chest.

Survival-rule clarification (adds to AGENT-CONTEXT): a bot may **rearrange its own inventory** (swap slots, choose the selected hotbar slot), as a player can in the inventory screen. Container transfer may move part of a stack as long as the total item count is conserved.

## Layering and ownership

```
src/core/types.ts, src/core/items.ts, src/core/index.ts     contracts (architect)
src/game/bots/ports.ts, src/game/bots/executor.ts           contracts (architect)
test/boundaries.test.ts, packs/BP/manifest.json              architect
src/core/commands/{parse,specs,index}.ts                     Job 1
src/core/colony/*                                            Job 2
src/game/adapter/{index,world}.ts                            Job 3
src/game/bots/{gather-logic,crafting}.ts                     Job 4
src/game/bots/{gather-executor,goto-executor,executor-logic,nav}.ts   Job 5
src/game/runtime.ts, src/game/bots/registry.ts, src/gametests/*, scripts/make-structure.mjs   Job 6
PLAYTEST.md, README.md, docs/SETUP.md, docs/SPIKE-CHECKLIST.md, src/core/commands/help.ts      Job 7
```

New boundary (enforced by `test/boundaries.test.ts`): **`src/game/bots/` never imports `@minecraft/*` or the adapter.** Executors only see the ports in `src/game/bots/ports.ts` and are tested against plain fakes.

## Contracts (already in the tree; jobs must not edit them)

- `src/core/types.ts`: `Command` gains `gather` and `chest`; `Task = GotoTask | GatherTask`, `TaskKind`, `TaskOf<K>`; `TaskFailReason` gains `no_source | no_chest | no_tool | inventory_full`; `TaskProgress`; `ChestRef`, `ItemCount`, `ChestLocateFailure`, `ResourceKey`; events `taskProgress`, `chestLocated`, `chestLocateFailed`, `chestInspected`; effects `locateChest`, `inspectChest`; `BotView.progress`, `ColonySnapshot.chest`.
- `src/core/items.ts`: `RESOURCES` (sources, yields, tool, requiresTool, label), `resolveResource`, `RESOURCE_ALIASES`, `RESOURCE_NAMES_HINT`, `GATHER_LIMITS` (1..256, default 16), tool tables (`toolInfo`, `TOOL_SPEED`, `TOOL_TIER_PREFERENCE`), `CONTAINER_BLOCK_TYPES` (chest, trapped_chest, barrel), `BLOCK_HARDNESS`, `RECIPES` (planks per species, stick, crafting_table, wooden_pickaxe), `ns`/`shortId`. Re-exported from `src/core/index.ts`.
- `src/game/bots/ports.ts`: `BotBody` (Phase 1, moved here, re-exported by the adapter), `WorkerBody extends BotBody` (Phase 2 abilities), `WorldPort`, `InventorySnapshot`, `ItemStackView`, `BlockInfo`, `Box`, `Face`, `TransferResult`, `CraftPlan`, `ItemEntityView`, `HOTBAR_SIZE`.
- `src/game/bots/executor.ts`: `TaskExecutor` (`step`, `cancel`, `progress`), `StepResult`, `ExecutorContext { body, world(), gather }`, `GatherConfig` + `DEFAULT_GATHER_CONFIG`, `ExecutorRegistry` (mapped type: one factory per `TaskKind`, missing = compile error), `createExecutor`.

Stubs (signatures fixed, bodies `TODO(phase-2)`): `gather-logic.ts`, `crafting.ts`, `gather-executor.ts`, `registry.ts` (already wired), `adapter/world.ts`, the Phase 2 methods in `wrapSimulatedPlayer`, the gather/chest cases in `colony/index.ts` and `parse.ts`. A job may add **new** exports to its own files but must not change the signatures listed in this doc; if a signature is wrong, make a local workaround and report it.

## Command grammar (Job 1)

| Command | Args | Notes |
|---|---|---|
| `!gather <item> [amount] [bots]` | item: `resolveResource(token)`; amount: int `GATHER_LIMITS.minAmount..maxAmount` (1–256), default 16; bots: int 1–16 (`MIN_COUNT..MAX_COUNT`), default 1 | → `{ kind: "gather", item, amount, count }` |
| `!chest [set]` | optional literal `set` (case-insensitive) | → `{ kind: "chest", action: "show" \| "set" }` |

- Spec order in `COMMAND_SPECS`: help, status, spawn, goto, come, **gather, chest**, stop, override, queue. Usage lines (derived from args): `gather <item> [amount] [bots]`, `chest [set]`.
- Descriptions: gather: `Gather an item into the colony chest. Amount 1-256 (default 16), split across 1-16 bots.`; chest: `Show the colony chest, or 'set' it to the chest you look at.`
- New arg types: `item`, `amount`, `chestAction`. Errors (each followed by the usage line, as in Phase 1):
  - unknown item: `Unknown item '<echo>'. Try: ${RESOURCE_NAMES_HINT}.`
  - bad amount: `Amount must be a whole number from 1 to 256.`
  - bad bots: the Phase 1 count error `Count must be a whole number from 1 to 16.`
  - bad chest action: `Unknown chest action '<echo>'. Use !chest or !chest set.`
- `/colony:c` takes 5 tokens: `gather <item> <amount> <bots>` fits.

## Colony semantics (Job 2)

Phase 1 rules (cooldown, offers, override/queue/stop, requeue to the front, reply routing) apply to every task kind. `gather` and `chest` are cooldown-checked commands.

**Task phrases** (new message helpers; goto wording must stay byte-identical to Phase 1):
- activity (status / busy lines): goto `going to x y z`; gather `gathering <label> <n>/<amount>` with `n = progress ? progress.delivered + progress.held : task.delivered`.
- noun (reassigned / left / queued notices): goto `go to x y z`; gather `gather <label> <task.delivered>/<amount>`.
- `<label>` = `RESOURCES[item].label` (`logs`, `oak_log`, `cobblestone`, …).

**chest**
- `!chest set` → effect `locateChest { requestedBy: sender.id, near: sender.pos }`, no reply yet.
  - `chestLocated` → store as the colony chest (replaces any previous one); reply to `requestedBy`: `Colony chest set to x y z.`
  - `chestLocateFailed`: `none_found` → `No chest found. Look at a chest (or stand next to one) and type !chest set.`; `no_player` / `error` → `Couldn't look for a chest. Try again.`
- `!chest` with no chest → `No colony chest yet. Look at a chest and type !chest set.`; else effect `inspectChest { to: sender.id, chest }`.
  - `chestInspected`: `items` undefined → `Colony chest at x y z can't be read (gone or unloaded).`; `[]` → `Colony chest at x y z: empty.`; else `Colony chest at x y z: 23 oak_log, 5 cobblestone` (shortId names, at most 8 entries, then `, +N more`).
- `snapshot().chest` is the registered chest (copy).

**gather** (`item`, `amount`, `count`), in order:
1. No chest → `No colony chest yet. Look at a chest and type !chest set.` (no side effects; pending offer survives).
2. `n = min(count, amount)`. No bots → `noBots`; `n > bots` → `tooMany(n, bots)` (same as goto).
3. A valid request supersedes the sender's pending offer.
4. Shares: `amount` split over `n` bots, the first `amount % n` get one more (`32/3 → 11, 11, 10`).
5. Allocation exactly as goto (`planAllocation`): if every bot to take runs the sender's own task, assign directly (own preempted tasks are dropped, not requeued); else create an offer listing each busy bot's **activity** and owner; `!override` / `!queue` work as in Phase 1. Recommended internal shape: generalise `GotoOffer` into an offer holding one task *spec* per bot (`{kind:"goto", target}` | `{kind:"gather", item, amount, origin, chest}`), so goto and gather share all offer code.
6. Each new `GatherTask`: `delivered: 0`, `origin: sender.pos`, `chest`: the colony chest at command time. Ack (bot-spoken, to sender): `Gathering <amount> <label>.`

**taskProgress**: stored for the bot's current task when `taskId` matches (else ignored); cleared whenever the bot's task changes. Shown in `status` and `snapshot().bots[i].progress`.

**Requeue** (preempted by another player's override, or `botRemoved`): a gather task is requeued (same id) with `delivered = progress?.delivered ?? task.delivered` (held items stay with the old bot and don't count). If that is ≥ `amount`, it is dropped instead of requeued.

**Reports**
- gather done → bot: `Delivered <max(amount, progress.delivered)> <label> to the chest.`
- gather failed → bot: `Stopped gathering <label> at <delivered>/<amount>: <reason text>.` (`delivered` from progress, else task).
- goto reports unchanged (`Arrived at …` / `Couldn't reach …: …`).
- `pickingUp`: `Picking up your queued task: <activity>.` (goto: `going to x y z`, unchanged).
- Reason texts: Phase 1 ones unchanged; `no_source` `nothing left to gather nearby`, `no_chest` `can't reach the colony chest`, `no_tool` `no pickaxe and couldn't make one`, `inventory_full` `the chest is full`.

## Game layer

### Ports (contract, `src/game/bots/ports.ts`)

`WorkerBody` = `BotBody` + `dimensionId`, `lookAtBlock`, `startBreaking(block, face)`, `stopBreaking`, `inventory`, `selectedSlot`, `selectSlot`, `swapSlots`, `depositSlot(chest, slot)`, `withdrawSlot(chest, chestSlot, amount)`, `applyCraft(plan)`, `placeFromSlot(slot, onBlock, face)`. `WorldPort` = `blockAt`, `findBlocks(box, typeIds)`, `itemsNear`, `containerAt`. All exception-safe; see the JSDoc in the file for exact return values. Positions are absolute; block positions are integer corners.

### API map (Job 3; every API verified in `node_modules/@minecraft/*/index.d.ts`)

| Port method | Engine API | Quirks / privileges |
|---|---|---|
| `dimensionId` | `Entity.dimension.id` | throws when invalid |
| `lookAtBlock` | `SimulatedPlayer.lookAtBlock(pos, LookDuration.UntilMove)` | `LookDuration` enum from `@minecraft/server-gametest`; no-restricted-execution |
| `startBreaking` | `SimulatedPlayer.breakBlock(pos, Direction)` | "respects the game mode": survival takes real time and **keeps hitting until broken, an item is used, or `stopBreakingBlock`**. Returns true if the block is solid. Detect completion by polling the block. Map `Face` → `Direction` (`'Up'`, `'Down'`, `'North'`, …; string enum, the d.ts "Defaults to: 1" is a doc artifact). Coordinate frame for test-spawned players is unverified (SPIKE §5) → GameTests use top-level spawns only. |
| `stopBreaking` | `SimulatedPlayer.stopBreakingBlock()` | |
| `inventory` | `getComponent("inventory").container` (`EntityInventoryComponent.container`), `getItem(i)` for `0..size-1` | `ItemStack.typeId/amount/maxAmount`; durability via `getComponent("durability")` → `damage`, `maxDurability` |
| `selectedSlot` / `selectSlot` | `Player.selectedSlotIndex` (read/write) | restricted-execution-read-only (we never run in restricted mode) |
| `swapSlots` | `Container.swapItems(a, b, sameContainer)` | |
| `depositSlot` | `Container.transferItem(slot, chestContainer)` → leftover `ItemStack \| undefined` | moved = before − leftover.amount. Reach check first (feet within `containerReach` 2.5 horizontal of the chest center, \|dy\| ≤ 2) → `out_of_reach`. Chest container: `dimension.getBlock(pos).getComponent("inventory").container` (BlockInventoryComponent; `container` is optional and its getter can throw) |
| `withdrawSlot` | whole stack: `chest.transferItem(chestSlot, botContainer)`; part: `bot.addItem(stack.clone() with amount n)` then `chest.setItem(chestSlot, reduced)` (or `undefined`), conserving the total | same reach rule |
| `applyCraft` | validate all `consume` slots via `getItem`; table: `getBlock(tableAt).typeId === "minecraft:crafting_table"` and eye distance ≤ 4.5; then `setItem(slot, reduced \| undefined)` per entry and `addItem(new ItemStack(typeId, amount))` | verify room **before** consuming (empty slot / mergeable stack / a slot the consumption empties); atomic: nothing changes on failure |
| `placeFromSlot` | `SimulatedPlayer.useItemInSlotOnBlock(slot, onBlock, Direction.Up)` | consumes one item in survival. **Never** use `useItemOnBlock(itemStack, …)`, `giveItem`, `setItem` on the SimulatedPlayer for gameplay (they create items). |
| `blockAt` | `dimension.getBlock(pos)` → `typeId`, `isAir`, `isSolid`, `isLiquid` | throws `LocationInUnloadedChunkError` / out of bounds; returns undefined → undefined |
| `findBlocks` | `dimension.getBlocks(new BlockVolume(min, max), { includeTypes }, true).getBlockLocationIterator()` | `allowUnloadedChunks = true` skips unloaded parts. Unknown type ids may throw: filter `typeIds` through `BlockTypes.get(id)` once (cache). |
| `itemsNear` | `dimension.getEntities({ type: "minecraft:item", location, maxDistance })`, `getComponent("item").itemStack` | |
| `containerAt` | as the chest container above, snapshot of all slots | |
| `locateChest` (world.ts) | `player.getBlockFromViewDirection({ maxDistance: 6 })?.block`; fallback `dimension.getBlocks(box ±4 around near, { includeTypes: CONTAINER_BLOCK_TYPES }, true)`, nearest to `near` | dimension = player's, else `world.getDimension("minecraft:overworld")` |
| `readChest` (world.ts) | container snapshot aggregated per typeId, amount desc then typeId asc | any distance (player info) |

Item pickup: survival simulated players pick drops up by walking over them (AGENT-CONTEXT); there is no pickup API and none is used. This is a key PLAYTEST item.

All adapter methods log the first failure and then every 25th per method (the Phase 1 `LOG_EVERY` pattern) with `[colony]`.

### Gather logic (Job 4, pure; `gather-logic.ts`, `crafting.ts`)

Signatures and exact semantics are in the JSDoc of the stub files (they are the contract): geometry (`blockOf`, `blockCenter`, `posKey`, `eyeDistance` with `EYE_HEIGHT` 1.62, `horizontalDistance`, `inBreakReach`, `inContainerReach`, `faceToward`), scanning (`scanBox`, `scanSlices` nearest-layer-first, `isPassable`, `isStandable`, `isExposed`, `standCells`, `rankCandidates` with the `riskCost` hook), breaking (`estimateBreakTicks` = ceil(hardness × (harvestable ? 1.5 : 5) / speed × 20), `breakTimeoutTicks` = 2 × est + 40), inventory (`countItems`, `slotsWith`, `freeSlots`, `aggregate`, `shouldDeposit`), tools (`bestToolSlot`, `planHotbar`), crafting (`planCraft`, `planksRecipeFor`, `planWoodenPickaxe`, `tableSpot`).

### Gather executor (Job 5, `gather-executor.ts`)

`new GatherExecutor(task, ctx)`; implements `TaskExecutor`; `phase()` exposes `GatherPhase`. Uses only `ctx.body` (WorkerBody), `ctx.world()` (WorldPort) and `ctx.gather` (GatherConfig). `res = RESOURCES[task.item]`, `remaining = task.amount − delivered`, `delivered` starts at `task.delivered`.

```
start ──(needs tool, none held)──► toChest[tool] ─► atChest ─(tool)─► equip ─► scan
  │                                          └─(no tool, pickaxe)─► logs? withdraw ─► craft ─► equip ─► scan
  │                                                         └─(no logs anywhere)─► scan[logs, no deposit] ─► craft
  └─► equip best tool ─► scan ─► approach ─► break ─► collect ─┬─► (next candidate) approach
                          ▲                                    └─► shouldDeposit ─► toChest[deposit] ─► atChest
                          └────────────── delivered < amount ◄─────────────────────────────────┘
                                                               delivered ≥ amount ─► done
```

- **start**: `world()` undefined → failed `error`. Position / inventory unreadable → retry each pump; still unreadable after 200 ticks → `timeout` (position) / `error` (inventory). `deadline = now + maxTaskTicks`.
- **tool**: if `res.tool` and the inventory has one (`bestToolSlot`), hold it (`planHotbar` → `swapSlots`?, `selectSlot`). If `res.requiresTool` and none held → go to the chest: withdraw the best one (`bestToolSlot(containerAt(chest))`, 1 item). None and `res.tool === "pickaxe"` → crafting: `planWoodenPickaxe(inv, tableNearby)` (`tableNearby` = a crafting table found by `findBlocks` within `tableSearchRadius` that is `inBreakReach`); if logs are missing, withdraw that many logs from the chest; if still missing, gather them by hand (an inner gather of `RESOURCES.log`, kept in the inventory, not deposited); no logs found → failed `no_tool`. Apply steps one by one, re-planning with `planCraft` on a fresh inventory before each `applyCraft`; `place_table` uses `tableSpot` + `placeFromSlot` and is confirmed next pump by `blockAt(tableAt)`. Any craft/place failure → `no_tool`. Optional tools (axe/shovel) are never fetched specially; when the bot is at the chest anyway and holds none of `res.tool`, it withdraws the best one.
- **scan**: one `scanSlices` slice per pump via `findBlocks(slice, res.sources)` (undefined → none), accumulated; then `rankCandidates(found, feet, task.origin, cfg, blacklist)`. Picking: the first candidate whose block still has a source type, `isExposed`, and has a `standCells(…, breakReach)` entry (check ≤ 8 per pump; rejects are blacklisted). The ranked list is cached; rescan only when it is exhausted. Nothing found → if yields held: deposit, then fail `no_source`; else fail `no_source`.
- **approach**: if `inBreakReach(feet, block)` and on ground → break. Else navigate to the stand cell's bottom center using the Phase 1 goto rules (`executor-logic.ts`: `initGotoState`/`decide`/`onNavResult`, timeout `200 + 20 × dist`); reaching reach at any time wins. Arrived-but-not-in-reach, unreachable or timeout → blacklist, `failures++`; `failures ≥ maxConsecutiveFailures` → (deposit held yields first, then) fail `unreachable`.
- **break**: `lookAtBlock`, `startBreaking(block, faceToward(block, eye))` (false → blacklist, failure). Poll `blockAt` each pump: type no longer in `res.sources` → broken (`failures = 0`) → collect. `now ≥ start + breakTimeoutTicks(estimateBreakTicks(type, res, held tool))` → `stopBreaking`, blacklist, failure.
- **collect**: wait `dropSettleTicks`, then walk to the nearest `itemsNear(blockCenter, pickupRadius, res.yields)` until that entity is gone or `pickupTimeoutTicks` passed; repeat while drops remain (same overall timeout). Then `shouldDeposit(inv, res, remaining)` → toChest[deposit], else next candidate.
- **toChest / atChest**: the chest block must be a `CONTAINER_BLOCK_TYPES` block (`blockAt`) else `no_chest`. Stand cell: `standCells(probe, chest.pos, breakReach)` filtered by `inContainerReach`; none → `no_chest`; navigation unreachable/timeout → `no_chest`. At the chest: `depositSlot` every `slotsWith(inv, res.yields)` slot; `delivered += moved`; a deposit that moves less than the stack (chest full) → done if `delivered ≥ amount`, else fail `inventory_full`. `out_of_reach` → walk again (≤ 2 retries, then `no_chest`); `no_container` → `no_chest`; `error` → `error`. After depositing: `delivered ≥ amount` → done; pending failure (budget / no_source / unreachable) → that failure; else scan.
- **budget**: `now ≥ deadline` in any phase except a final deposit → deposit held yields (if any) then fail `timeout`.
- **progress()**: `{ kind: "gather", delivered, held: countItems(lastInventory, res.yields) }`.
- **cancel()**: `stopBreaking()` + `stop()`; idempotent; no report after it, never touches the body again (same `settled` rule as GotoExecutor).
- The executor never mutates the world except through `WorkerBody`.

### Runtime and registry (Job 6)

- `assign` → `createExecutor(EXECUTORS, task, contextFor(body))` (already wired). `EXECUTORS` in `src/game/bots/registry.ts`.
- After every `step`: `p = ex.progress()`; if it differs from the last emitted value for that executor, emit `taskProgress` **before** the step's `taskReport` (if any). Reset on assign/cancel.
- `locateChest` → `locateChest(findPlayer(requestedBy), near)` → `chestLocated` / `chestLocateFailed`. `inspectChest` → `readChest(chest)` → `chestInspected`. Exceptions → `chestLocateFailed{error}` / `chestInspected{items: undefined}`.
- `ColonyRuntime.recentReplies(to: PlayerId): string[]` (new, for GameTests): replies addressed to an id with no online player are kept in a bounded buffer (last 50 per id, at most 64 ids), oldest first, rendered text (with `<Bot>` / `§7[Colony]§r` prefix).
- Unit tests mock `@minecraft/*` like `test/runtime.test.ts`; for gather runs, prefer `vi.mock` of `../src/game/bots/registry.js` (fake executors with scripted progress) and `../src/game/adapter/world.js`, so runtime tests don't depend on the engine mock growing a voxel world.

### GameTests (Job 6)

New file `src/gametests/gather.ts`, imported from `src/gametests/index.ts`. Bots come from the **top-level** spawn only (`spawnBot(test, "toplevel", …)`), because `breakBlock` / `lookAtBlock` coordinates for test-spawned players are unverified. Scene setup may use `test.setBlockType` and chest `container.setItem` **for setup only**; bots never get items or blocks that way. Observability: `snapshot()`, `recentReplies(sender.id)`, chest contents via `test.getBlock(rel).getComponent("inventory").container`.

| Test | Structure | Steps | Pass |
|---|---|---|---|
| `colony:chest_set` | `colony:flat` + chest via setBlockType | sender next to chest: `!chest set`; then `!chest` | `snapshot().chest.pos` = chest abs block; reply contains `empty` |
| `colony:gather_logs` | `colony:grove` | `!chest set`, `!gather oak_log 6` | idle within 3000 ticks; chest ≥ 6 oak_log; reply `Delivered` |
| `colony:gather_two_bots` | `colony:grove` | 2 bots, `!gather oak_log 8 2` | chest ≥ 8 oak_log |
| `colony:gather_cobble_craft` | `colony:quarry`, chest prefilled with 3 oak_log | `!gather cobblestone 3` | chest ≥ 3 cobblestone; a crafting table exists in the test area |
| `colony:gather_no_source` | `colony:flat` + chest | `!gather sand 4` | idle; reply contains `nothing left` |

Structures (extend `scripts/make-structure.mjs`; keep the NBT writer byte-correct, palette entries may now carry states, e.g. `oak_log` with `pillar_axis: "y"` as a String tag): `grove.mcstructure` 16×8×16, stone floor y=0, three oak_log columns 4 high at (8,1..4,8), (11,1..4,5), (5,1..4,11); `quarry.mcstructure` 16×6×16, stone floor, a 4×4 stone pad at y=1 (x,z 9..12). Chests are placed in-test (block entities aren't written by the generator).

## Test plan

| Area | File (owner) | What |
|---|---|---|
| Parsing | `test/commands.test.ts` (J1) | gather/chest happy paths, defaults, aliases, `minecraft:` prefix, case, every error + usage, slash join, COMMAND_SPECS order |
| Colony | `test/colony.test.ts`, `test/colony-gather.test.ts` (J2) | chest set/show/failures; gather validation order; split; offers/override/queue with gather; progress storage + status lines; requeue with delivered; reports; snapshot; Phase 1 unchanged |
| Pure logic | `test/gather-logic.test.ts`, `test/crafting.test.ts` (J4) | every exported function, edge cases (world Y clamp, ties, unloaded probes, full inventory, multi-slot ingredients, output room) |
| Executor | `test/gather-executor.test.ts` + `test/support/fake-world.ts` (J5) | happy path logs; multi-trip deposit; no_source (with and without partial deposit); pickaxe from chest; craft with chest logs; craft by chopping logs; no_tool; inventory_full; no_chest (chest removed); unreachable after N failures; break timeout; budget timeout deposits first; cancel mid-break; progress values; time slicing (one slice per step); Phase 1 goto tests unchanged |
| Adapter | `test/adapter.test.ts` (J3) | each WorkerBody / WorldPort method against a mocked engine; reach refusal; transfer math; partial withdraw conserves counts; applyCraft atomicity; type filtering; locateChest view/near/none; readChest aggregation; throws → failure values |
| Runtime | `test/runtime.test.ts`, `test/runtime-gather.test.ts` (J6) | registry dispatch; progress-before-report ordering; progress only on change; chest effects → events; recentReplies; Phase 1 runtime tests unchanged |
| Help | `test/help.test.ts` (J7) | `!help gather` / `!help chest` extra lines; other topics unchanged |
| In game | GameTests (J6), PLAYTEST §Phase 2 (J7) | see above |

## Jobs (7, run in parallel, disjoint files)

Every job: read `docs/AGENT-CONTEXT.md` and this spec first; do not edit contract files (`src/core/types.ts`, `src/core/items.ts`, `src/core/index.ts`, `src/game/bots/ports.ts`, `src/game/bots/executor.ts`, `test/boundaries.test.ts`, `packs/BP/manifest.json`, `docs/PHASE2-SPEC.md`, `docs/AGENT-CONTEXT.md`) or other jobs' files; other jobs' modules are stubs while you work (they throw `TODO(phase-2)`), so code against the signatures/JSDoc here, not against their current bodies. `npm run check` must typecheck and your own tests must pass except where they necessarily exercise another job's stub (say so in your report). Report: what you built, deviations, and anything another job must know.

### Job 1 — Command parser
- **Owns:** `src/core/commands/parse.ts`, `src/core/commands/specs.ts`, `src/core/commands/index.ts`, `test/commands.test.ts`.
- **Deliverable:** `gather` and `chest` specs, arg types `item` (via `resolveResource` from `src/core/items.ts`), `amount` (`GATHER_LIMITS`), `chestAction`; `build()` returns the new `Command` variants (remove the TODO throw). Grammar, descriptions and error texts exactly as in §Command grammar. Export any new constants from `index.ts`.
- **Tests:** extend `test/commands.test.ts` (update the "covers every command kind" list). Don't assert `helpText("gather"|"chest")` contents (Job 7 adds extra lines there); `helpText()` stays header + one usage line per spec.
- **Consumes:** `Command`, `ResourceKey` (types.ts); `resolveResource`, `RESOURCE_NAMES_HINT`, `GATHER_LIMITS` (items.ts).

### Job 2 — Colony core
- **Owns:** `src/core/colony/index.ts`, `state.ts`, `allocator.ts`, `messages.ts`, `test/colony.test.ts`, `test/colony-gather.test.ts` (new).
- **Deliverable:** §Colony semantics: chest registry and the chest events/effects, `cmdGather` with split + shared offer machinery, progress storage, requeue with `delivered`, per-kind task phrases and messages, snapshot `chest`/`progress`. Remove the `taskTarget` placeholder and the TODO cases. Phase 1 strings for goto unchanged.
- **Tests:** `test/colony-gather.test.ts` (new) for everything gather/chest; keep `test/colony.test.ts` passing (it reads goto targets via `gotoOf`).
- **Consumes:** types.ts (Command, Task, GatherTask, events, effects, TaskProgress, ChestRef), items.ts (`RESOURCES`, `shortId`).

### Job 3 — Engine adapter
- **Owns:** `src/game/adapter/index.ts`, `src/game/adapter/world.ts`, `test/adapter.test.ts` (new).
- **Deliverable:** the 12 Phase 2 `WorkerBody` methods in `wrapSimulatedPlayer` (replace the stubs), `createWorldPort`, `locateChest`, `readChest`, exactly per §API map and the JSDoc in `ports.ts` / `world.ts`. Enforce the container-reach and table-reach rules in the adapter too (defence in depth). Never use `giveItem`, `SimulatedPlayer.setItem`, `useItemOnBlock`, `setBlock*` for gameplay. Exception-safe everywhere, rate-limited `[colony]` logs. Update the header comment listing the experimental surface.
- **Tests:** `test/adapter.test.ts` with `vi.mock("@minecraft/server")` / `vi.mock("@minecraft/server-gametest")` (pattern: `test/runtime.test.ts`), fake containers/blocks/entities; cases in §Test plan.
- **Consumes:** ports.ts, types.ts (`ChestRef`, `ItemCount`, `ChestLocateFailure`), items.ts (`CONTAINER_BLOCK_TYPES`, `CRAFTING_TABLE`), `DEFAULT_GATHER_CONFIG.containerReach/breakReach` (executor.ts).
- **Note for Job 6:** list every `@minecraft/server` / `-gametest` value export you use (e.g. `BlockVolume`, `BlockTypes`, `ItemStack`, `Direction`, `LookDuration`) in your report; the runtime test mocks must provide them.

### Job 4 — Pure gather and crafting logic
- **Owns:** `src/game/bots/gather-logic.ts`, `src/game/bots/crafting.ts`, `test/gather-logic.test.ts` (new), `test/crafting.test.ts` (new).
- **Deliverable:** implement every exported function exactly as its JSDoc says (the JSDoc is the contract the executor is written against). Pure: imports only core types/items and ports/executor types.
- **Tests:** full coverage of each function including edge cases listed in §Test plan.
- **Consumes:** ports.ts types, executor.ts `GatherConfig`, items.ts tables.

### Job 5 — Executors
- **Owns:** `src/game/bots/gather-executor.ts`, `src/game/bots/goto-executor.ts`, `src/game/bots/executor-logic.ts`, `src/game/bots/nav.ts` (new, optional: a reusable "walk to X until predicate" helper on top of executor-logic), `test/gather-executor.test.ts` (new), `test/support/fake-world.ts` (new), `test/executor-logic.test.ts`.
- **Deliverable:** `GatherExecutor` per §Gather executor, using `gather-logic.ts` / `crafting.ts` (Job 4) for every decision listed there; goto behaviour unchanged (Phase 1 tests keep passing). Log phase transitions sparingly via `../log.js`.
- **Tests:** `test/support/fake-world.ts`: a voxel `WorldPort` + `WorkerBody` fake (scripted movement toward the navigation target, breaking that takes N ticks and drops an item entity, pickup within 1.5 blocks into a 36-slot inventory, a chest container, deposits/withdrawals, applyCraft honoring the plan). Scenarios in §Test plan. Job 4's functions are stubs while you work: your tests run against the real ones after merge; keep to their JSDoc.
- **Consumes:** executor.ts, ports.ts, gather-logic.ts + crafting.ts signatures, items.ts.

### Job 6 — Integration: runtime, registry, GameTests, structures
- **Owns:** `src/game/runtime.ts`, `src/game/bots/registry.ts`, `src/gametests/helpers.ts`, `src/gametests/index.ts`, `src/gametests/gather.ts` (new), `scripts/make-structure.mjs`, `packs/BP/structures/colony/*` (generated), `test/runtime.test.ts`, `test/runtime-gather.test.ts` (new).
- **Deliverable:** §Runtime and registry (progress events, chest effects, `recentReplies` on `ColonyRuntime`), §GameTests (5 tests, top-level spawns, helpers for chest setup/reading and reply polling), the `grove` and `quarry` structures. Keep Phase 1 GameTests registered and working. `src/main.ts` stays unchanged (gather tests load via `gametests/index.ts`).
- **Tests:** `test/runtime-gather.test.ts` (new) per §Test plan; extend the `@minecraft` mocks in `test/runtime.test.ts` only as needed (adapter value imports, see Job 3's note: `BlockVolume`, `BlockTypes`, `ItemStack`, `Direction`, `LookDuration` are likely).
- **Consumes:** everything (stubs while you work): executor.ts, registry, `adapter/world.ts` (`createWorldPort`, `locateChest`, `readChest`), core events/effects.

### Job 7 — Docs and help
- **Owns:** `PLAYTEST.md`, `README.md`, `docs/SETUP.md`, `docs/SPIKE-CHECKLIST.md`, `src/core/commands/help.ts`, `test/help.test.ts` (new).
- **Deliverable:**
  - `helpText`: for topics `gather` and `chest`, append extra lines after the usual two: gather → `Items: ${RESOURCE_NAMES_HINT}. Aliases: wood, stone, cobble.` and `Example: !gather oak_log 32 2 (two bots, 16 each).`; chest → `Look at a chest (or stand next to one) and type !chest set. Bots deliver there.` All other output unchanged.
  - `PLAYTEST.md` Phase 2 section (keep Phase 1 sections; update the intro and the install note: new version 0.2.0, delete the old pack first): commands table additions; hand tests — chest set by looking and by standing near; gather logs near real trees (status shows `gathering oak_log n/16`); cobblestone with a pickaxe in the chest; cobblestone with only logs in the chest (bot crafts and places a table); cobblestone with an empty chest (bot chops logs first); dirt/sand/gravel; `!gather … 2` split; busy → `!override` / `!queue` with a gather task; `!stop` mid-gather; chest full → "the chest is full"; break the chest mid-task → "can't reach the colony chest"; bot death mid-gather; **drops are actually picked up** (key risk); Phase 2 GameTests; what to record and send back (extend the §5 template).
  - `README.md`: Phase 2 summary, commands, layout additions (ports/executor/registry, items table). `docs/SETUP.md`: anything changed for the dev world. `docs/SPIKE-CHECKLIST.md`: new open questions (item pickup by simulated players; survival `breakBlock` timing and reach; `useItemInSlotOnBlock` placement; coordinate frame of `breakBlock` for test-spawned bots).
- **Tests:** `test/help.test.ts`.
- **Consumes:** items.ts (`RESOURCE_NAMES_HINT`), `COMMAND_SPECS` / `findSpec` (Job 1's files; read-only).

## Risks / open questions

- **Item pickup** by simulated players is assumed (AGENT-CONTEXT) but not yet probed. If it fails, collect times out and nothing is delivered: GameTest `gather_logs` and PLAYTEST catch it.
- **Survival `breakBlock`**: break duration, whether the bot must keep looking, and reach enforcement are engine-defined; the executor polls the block and enforces its own reach (4.5) and timeout.
- **Coordinate frame** for test-spawned players' `breakBlock`/`lookAtBlock`/`navigate*` (SPIKE §5 unresolved) → Phase 2 GameTests use top-level spawns only.
- `getBlocks` with an unknown block type id may throw → adapter filters through `BlockTypes.get`.
- Floating upper logs of tall trees are skipped (no pillaring) and blacklisted; real forests may yield fewer logs than expected → `no_source` with partial delivery.
- Gather moves bots up to `scanRadius` (16) from the requester; bots only act in loaded chunks (scan uses `allowUnloadedChunks`), and drops despawn after ~5 min, so bots collect immediately after each break.
- Chest registration is in memory only (lost on reload, like bots) until Phase 8.
