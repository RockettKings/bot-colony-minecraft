# Spike checklist

Engine questions the code depends on but the type definitions don't settle. Phase 1: §0–6 (probes and runtime checks). Phase 2: §7 (gathering), answered by hand in PLAYTEST §4 G–Q and by the Phase 2 GameTests.

Run on a **play world: Beta APIs on, cheats OFF**, unless noted. Every probe ends with a chat and content-log line of this form:
`[probe] <name>: RESULT PASS|FAIL|INCONCLUSIVE - <summary>`, usually preceded by a `facts:` line. Paste both lines into **Result**.
Per-second traces (chunks probe) go to the content log only.

Game version: ________  Platform: ________  Date: ________

## Results summary

Solo play test 2026-10-06: PLAYTEST sections A, B and E all passed. D (multiplayer collision) deferred until a second player is available.

| # | Probe | Command | Verdict (PASS/FAIL/INCONCLUSIVE) | Key facts |
|---|---|---|---|---|
| 0 | startup | automatic on join | PASS (2026-10-06) | |
| 1 | spawn | `/colony:probe spawn` | PASS (2026-10-06) | `allowCheats`, `endToTarget`, `offset` |
| 2 | chat | `/colony:probe chat`, then type `!probe-chat` | PASS (2026-10-06) | `beforeFired`, `afterFiredForToken`, seen by eye? |
| 3 | chunks | `/colony:probe chunks` | PASS (2026-10-06) | `maxDx`, `farIntervalsMoving`, `farChunkUnloaded`, `wentInvalid` |
| 4 | reload | `/colony:probe reload` (before and after reopening) | FAIL (2026-10-06): none of 2 simulated players came back after the reload | `survived`, `presentButNotDetectedAsSimulated` |
| 5 | nav coord frame | `/gametest runset colony` (dev world) | | table in §5 |
| 6 | runtime checks | see §6 | | table in §6 |
| 7 | Phase 2 gathering | PLAYTEST §4 I–N, Q | | table in §7 |

## 0. Startup (automatic)

About 3 s after you first join, `[probe] startup` reports `spawnSimulatedPlayer(top-level)`, `beforeEvents.chatSend`, `customCommand /colony:probe` and `allowCheats`. A one-line copy also goes to the content log on world load.

- **PASS:** the first three are present (`allowCheats` is informational). This only shows the APIs exist; spikes 1–4 cover behaviour.
- **FAIL:** something is missing. Most likely Beta APIs is off, or the game version doesn't match the manifest's module versions.

Also check in the content log: `[colony] registered /colony:c` and `[colony] chat front-end installed` appear, with no `registerCommand … failed` error (two startup subscribers register `/colony:c` and `/colony:probe`).

Result:

## 1. spawn: does top-level `spawnSimulatedPlayer` work with cheats off, and are its nav coords absolute?

**Run:** stand on flat open ground and run `/colony:probe spawn`.

**Method:** the probe spawns `Probe-<tick>` (survival) 2 blocks east of you and checks `isValid` and `world.getAllPlayers()`. It then calls `navigateToLocation` toward an absolute point 5 blocks away (the first standable cardinal cell), waits about 5 s and measures the distance to the absolute target. If navigation doesn't move the bot, it retries with `moveToLocation`. At the end it disconnects the bot.

- **PASS:** the bot spawned, it ended within 1.5 blocks of the absolute target, and `allowCheats=false`. Also check `inGetAllPlayers=true` (reported as a fact, not part of the verdict).
- **INCONCLUSIVE:** the bot reached the target but cheats were on (rerun cheats-off), or the bot never moved (stand on open flat ground and rerun).
- **FAIL:** the spawn threw (blocked with cheats off?), the spawned bot wasn't valid, or the bot moved but ended away from the absolute target (an `offset` about the size of your world coordinates means coords aren't absolute).

**Decision:**
- PASS keeps the spec's plan (adapter spawns via the top-level API and passes world coords).
- FAIL on spawn means Phase 1 needs cheats on, or a different spawn path. Revisit the definition of done.
- FAIL on coords means the adapter must translate coordinates.

Result:

## 2. chat: does `world.beforeEvents.chatSend` fire, and does `cancel` hide the message?

**Run:** `/colony:probe chat`, then type `!probe-chat` within 30 s. The colony also replies "Unknown command '!probe-chat'. Type !help."; that's expected.

**Method:** the probe temporarily subscribes to the before-event, sets `cancel = true` for that exact message, and watches `afterEvents.chatSend`. A message that is broadcast fires the after-event, so a suppressed message must not. The probe unsubscribes after the event plus 1 s, or after 30 s.

- **PASS:** the before-event fired, and the after-event did not fire for the token. Also confirm by eye that `!probe-chat` did not appear in chat.
- **INCONCLUSIVE:** the before-event fired but the after-event was unavailable. Confirm by eye.
- **FAIL:** no before-event in 30 s, or the message was still broadcast.

**Decision:**
- PASS means chat is the primary front-end.
- FAIL means `/colony:c` becomes the primary front-end, and `!` commands are documented as best-effort.

Did the message show in chat? (yes/no): ____

Result:

## 3. chunks: does a bot keep ticking when it's more than 160 blocks from every real player?

**Run:** use a flat world, or clear terrain to the east (+x). Run `/colony:probe chunks` and **stay put** for up to 120 s.

**Method:** the probe spawns `Probe-far-<n>` 2 blocks east of you and drives it east using `navigateToLocation` toward a point 340 blocks away. When progress stalls for 2 s (or there's no path) it switches to 8-block `moveToLocation` steps with jumps, and tries `fly()` once after 6 s stuck. Every second it samples position, `isValid`, `isChunkLoaded` and the horizontal distance to the nearest real player; every 10 s it prints a progress line to chat. It stops after 30 samples beyond 160 blocks, after 5 invalid samples in a row, or after 120 s, then disconnects the bot.

Verdicts are checked in this order:
- **INCONCLUSIVE:** you moved more than 16 blocks from where you started.
- **FAIL:** the bot went invalid while about 128+ blocks from you (it doesn't stay loaded far away).
- **INCONCLUSIVE:** fewer than 5 one-second intervals beyond 160 blocks (terrain; use a flat world or a clear path east).
- **PASS:** beyond 160 blocks, at least 60% of 1-s intervals still showed movement (≥ 0.2 blocks). The bot ticks while away.
- **FAIL:** below 60%, and some far sample was in an unloaded chunk or no far interval moved at all (the bot froze).
- **INCONCLUSIVE:** mixed movement while the chunk stayed loaded (probably stuck on terrain).

**Decision:**
- FAIL means remote tasks need chunk loading (a tickingarea needs cheats, so an alternative is needed), or tasks are restricted to the loaded radius. This is a far-gatherer design input.
- PASS means bots can work out of range.

Record `maxDx`, `farIntervalsMoving` and `farChunkUnloaded`. Also check `/list` afterwards: was the bot actually removed? (yes/no): ____

Result:

## 4. reload: do simulated players survive save & quit plus reopen?

**Run:**
1. `!spawn` one or two bots.
2. `/colony:probe reload`. This lists the bots and records a baseline in a world dynamic property (INCONCLUSIVE "baseline recorded").
3. Save & Quit, reopen the world, wait about 5 s, then run `/colony:probe reload` again.

**Method:** the probe compares the stored names (from the previous script session) with the names of **all** current players, because after a reload the script may not recognise surviving bots as simulated players. `presentButNotDetectedAsSimulated` lists such names: record it, as Phase 5 re-adoption depends on it.

- **PASS:** every recorded name is present again.
- **FAIL:** none came back.
- **INCONCLUSIVE:** some came back (rerun a few seconds later), or there was no baseline.

**Decision:**
- FAIL means the colony must respawn its bots on load (Phase 5 persistence, from stored names and positions).
- PASS means bots persist, but the runtime must re-adopt existing bodies on load, or there will be duplicates or orphans.

Note: even with PASS, the Phase 1 runtime doesn't re-adopt bots after a reload. They are orphans until Phase 5.

Result:

## 5. Are navigation coords absolute for non-test bots, and test-relative for test-spawned bots?

**Run:**
- The non-test half comes from spike 1 (PASS = absolute).
- The test half: on a **dev world (cheats on)**, run `/gametest runset colony` and compare each test with its `_abs` twin.

| Test | plain (test.spawnSimulatedPlayer) | `_abs` (top-level spawn) |
|---|---|---|
| goto_flat | | |
| goto_unreachable | | |
| override_flow | | |

**Reading the results:**
- Both columns pass: test-spawned bots also use absolute coords. The GameTests are valid as written.
- `_abs` passes and plain fails, with the bot heading toward the "if abs coords were read as test-relative" position in the failure message: test-spawned bots use **test-relative** nav coords. The runtime is fine. Keep the `_abs` tests as the authoritative ones, or have `adoptBot` callers pass relative coords.
- Both fail: a runtime bug (the goto executor or allocator), or terrain. Check the failure text.

**Decision:** whether the GameTests use test spawns or top-level spawns, and whether the adapter needs a coordinate-frame flag for adopted bots.

Result:

## 6. Runtime behaviour the type definitions don't settle

The code handles each of these defensively (try/catch plus a `[colony]` or `[probe]` log line). Confirm each one on the play world unless noted.

| # | Check | How | Result |
|---|---|---|---|
| a | `/colony:c goto ~5 ~ ~` and `/colony:c status @Bot-1` work, i.e. the String parameter accepts `~5` and `@Bot-1` as plain tokens | Run both; expect a bot reply, not a command syntax error | |
| b | Slash-command replies reach you: the colony's reply to `/colony:c status` appears in chat | Run it with one bot spawned | |
| c | A bot that dies is respawned (`[colony] Bot-1 respawned` in the content log). If it had a task, the bot says "Couldn't reach x y z: I died." and the task is not retried | `!goto` into lava, or `/kill Bot-1` on a cheats-on world | |
| d | A bot removed by `/kick` or by disconnect produces "Bot-1 left (gone)." to everyone within about 1 s; if it had a task, the owner gets "Bot-1 left; your task (go to x y z) is queued." | Cheats-on world: `/kick Bot-1` | |
| e | `navigateToLocation` with no path returns an empty path (fast "no path" failure) rather than throwing. Navigation can't start in mid-air, so a throw while airborne is expected | `!goto` into a sealed box; look for `navigateToLocation failed (xN)` in the content log | |
| f | `world.allowCheats` reads correctly (the startup and spawn probes print it) | Compare with world settings | |
| g | Quoted fallback works: `/colony:c "goto 1 2 3 2"` and `/colony:c goto ~ ~5 -3` both reach the parser | Run both; expect a bot reply or a colony error, not a command syntax error | |
| h | A dead bot still reads `isValid === true` until it respawns (the runtime relies on this; if not, dead bots get removed instead of respawned) | Same as (c): expect `respawned`, not `left (gone)` | |
| i | Short hops work: `!goto ~ ~ ~2` arrives rather than failing with "no path" (an empty full path must not count as unreachable) | Stand on flat ground with a bot next to you | |

Notes:

## 7. Phase 2: gathering questions

The Phase 2 code assumes an answer to each of these; none is probed yet. Each has a defensive fallback (poll + timeout, blacklist, typed failure), so a wrong assumption shows up as a failure message, not a hang. Answer them from PLAYTEST §4 and the Phase 2 GameTests (dev world, cheats on).

| # | Question | Assumed | How to answer | If the assumption is wrong | Result |
|---|---|---|---|---|---|
| a | **Item pickup (key risk).** Does a survival simulated player pick up item entities it walks over, like a player? There is no pickup API; nothing else collects drops | Yes (AGENT-CONTEXT) | PLAYTEST §4 I; GameTest `colony:gather_logs` (chest ≥ 6 oak_log) | Collect times out, nothing is delivered, every gather ends `0/n`. Phase 2 can't close; look for another legal pickup path (e.g. an engine pickup trigger, or moving onto the exact item position) | |
| b | **Survival `breakBlock` timing.** Does `SimulatedPlayer.breakBlock(pos, face)` in survival keep hitting until the block breaks, taking about the vanilla time (oak log by hand ≈ 3 s, with a stone axe ≈ 0.75 s; stone with a wooden pickaxe ≈ 1.1 s)? | Yes; the executor polls the block and gives up after 2 × estimate + 2 s | PLAYTEST §4 I (time one log by hand), §4 J (faster with the axe), §4 K | Frequent "gave up" blacklisting, or the bot never finishes a block: re-tune `estimateBreakTicks` / timeout, or re-issue `breakBlock` each pump | |
| c | **Does the bot have to keep looking at the block?** `lookAtBlock(…, UntilMove)` is called before breaking | Looking once is enough while the bot stands still | Same as (b): watch whether the bot keeps facing the block while swinging | Re-call `lookAtBlock` every pump while breaking | |
| d | **Reach enforcement.** Does the engine refuse `breakBlock` beyond some reach, or allow any distance? The executor enforces 4.5 blocks from the eye itself | Engine allows ≤ 4.5; the executor never asks for more | Watch for blocks the bot swings at without effect (§4 J); Content Log `[colony] … breakBlock` lines | Lower `breakReach` in `DEFAULT_GATHER_CONFIG` | |
| e | **Placing with `useItemInSlotOnBlock`.** Does `SimulatedPlayer.useItemInSlotOnBlock(slot, onBlock, Up)` place a crafting table on top of `onBlock` in survival, consuming one item? | Yes; confirmed next pump by reading the block | PLAYTEST §4 K (table appears, item gone); GameTest `colony:gather_cobble_craft` | Pickaxe crafting fails with "no pickaxe and couldn't make one"; try another face / target block, or a different placement API | |
| f | **Container transfer with cheats off.** `Container.transferItem` / `addItem` / `setItem` between the bot and a chest block work on a cheats-off world, and the counts are exact | Yes | PLAYTEST §4 H, J (chest contents match "Delivered n"), §4 N (chest full) | Deposits fail with "can't reach the colony chest" / wrong counts | |
| g | **Coordinate frame of `breakBlock` / `lookAtBlock` / `useItemInSlotOnBlock` for test-spawned bots** (like §5 for navigation). Absolute or test-relative? | Unknown, so Phase 2 GameTests spawn bots with the top-level API only | Not tested in Phase 2. To answer later: a GameTest that spawns via `test.spawnSimulatedPlayer` and breaks a known block | Only matters for GameTests; play uses top-level spawns (absolute) | |
| h | **`getBlocks(…, allowUnloadedChunks = true)`** skips unloaded parts without throwing, and filtering unknown type ids through `BlockTypes.get` avoids throws | Yes | Content Log: no `[colony] findBlocks` errors during §4 J–L; §4 P (walk away mid-task) | Scans fail: bots report "nothing left to gather nearby" with blocks in plain view | |
| i | **Drops and death.** A bot that dies mid-gather drops its inventory and respawns empty; the task fails "I died" and isn't retried | Yes (Phase 1 death handling, §6 c/h) | PLAYTEST §4 N (death) | Wrong report or a stuck bot | |

Notes:
