# Phase 1 summary: walking skeleton

Status: **done** (2026-10-06), solo play test on Bedrock 1.26.5x, Beta APIs on, cheats off. Multiplayer collision test (PLAYTEST §D) deferred until a second player is available; it is covered by unit tests in the meantime.

## What was built
- Behavior pack (TypeScript → esbuild → `dist/bot-colony.mcpack`), pinned to `@minecraft/server 2.11.0-beta` and `@minecraft/server-gametest 1.0.0-beta`.
- Functional core / imperative shell: `src/core` is pure TS (parser, colony state machine, allocator); `src/game` adapts the engine (chat and `/colony:c` front-ends, spawn, goto executor, effect rendering).
- Commands: `!help`, `!spawn`, `!come`, `!goto`, `!status`, `!stop`, `!override`, `!queue`. Anyone can command; busy bots trigger an offer (override / queue / 30 s expiry).
- Goto executor: re-path on stall, distance-scaled timeout, typed failure reasons, death → respawn.
- Four spike probes (`/colony:probe`), six GameTests (`/gametest runset colony`), 290 unit tests.

## What was decided
- Bots: top-level `spawnSimulatedPlayer`, survival mode, no cheats. Max 3 bots (config).
- Two front-ends into one parser: `!` chat (primary) and `/colony:c` (fallback). Claude's future output will use the same command grammar.
- Command path for Claude: `!` fast path everywhere; `?` Claude path only on BDS (Phase 2).
- Scope: chest/inventory work moved to Phase 3 so Phase 1 proves integration risks first.
- On override, a taken bot running the overrider's own task is replaced, not requeued.

## What we learned (probe results)
| Probe | Result | Consequence |
|---|---|---|
| spawn | PASS | Bots spawn with cheats off and read absolute world coords. No cheats fallback needed. |
| chat | PASS | `chatSend` fires and cancel hides `!` messages. Chat is the primary front-end. |
| chunks | PASS | Bots keep ticking > 160 blocks from every player. Remote work doesn't need tickingareas. |
| reload | FAIL | Simulated players don't survive Save & Quit. The colony must persist its roster and respawn bots on world load. No orphan bodies to clean up. |

Also confirmed: slash fallback (including quoted form), short hops, death → respawn, Y-range rejection.

## What's next (revised 2026-10-06)
Decision: **no Claude API and no dedicated server.** Everything runs as code inside the behavior pack on a normal solo or client-hosted world. Claude's role is design-time (writing and testing the code), not a runtime commander. The `?` / BDS bridge is dropped.

Revised roadmap:
- Phase 2: Persistence. Save the roster (names, last positions, queued tasks) in world dynamic properties; respawn and resume on load.
- Phase 3: Gatherers. Chop, mine, collect drops, deposit into a chest.
- Phase 4: Builders. Blueprint → structure; missing materials raise gather requests.
- Phase 5: In-game commander. Goal commands (e.g. `!gather oak_log 64`, `!build hut`) decomposed by rules into multi-bot task graphs.
- Phase 6: Guards (`!defend` patrols, rule-based combat).
- Phase 7: Scale and outposts.
- Phase 8: Learned combat, trained offline on a PC and shipped as plain JS weights inside the pack.
- PLAYTEST §D (multiplayer) when a second player is available.
