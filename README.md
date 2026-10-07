# Bot Colony

**Just want to play or test it?** Read [PLAYTEST.md](PLAYTEST.md).

A Minecraft Bedrock behavior pack (Script API, TypeScript) for a colony of autonomous bots. You give orders in chat, a rule-based commander turns them into tasks, and bots (simulated players) carry them out under survival rules. Everything runs inside the pack on a normal world: no network, no API keys, no dedicated server.

## Phase 2: gatherers (current, pack 0.2.0)

Bots acquire resources on request and deliver them to a colony chest. They find exposed source blocks near the requester, walk there, break them over real time with the best tool they have, pick up the drops and deposit them. No item is created except by crafting (exact ingredients consumed).

- `!chest set` registers the chest you look at (or stand next to) as the colony chest; `!chest` shows its position and contents.
- `!gather <item> [amount] [bots]`: logs (any or one species), cobblestone (from stone), dirt (from dirt/grass), sand, gravel; aliases `wood`, `logs`, `stone`, `cobble`, `grass`. Amount 1–256 (default 16), split over 1–16 bots (`32/3 → 11, 11, 10`).
- Tools: bots hold the best matching tool; stone requires a pickaxe, taken from the chest or crafted (logs → planks → sticks → crafting table placed in the world → wooden pickaxe), with logs from the inventory, the chest, or chopped by hand.
- Progress (`delivered + held`) shows in `!status`; failures are typed (`nothing left to gather nearby`, `can't reach the colony chest`, `no pickaxe and couldn't make one`, `the chest is full`, plus the Phase 1 reasons).
- The Phase 1 offer / override / queue system applies to gather tasks; a preempted gather is requeued with what it already delivered.
- GameTests: `chest_set`, `gather_logs`, `gather_two_bots`, `gather_cobble_craft`, `gather_no_source`.

Out of scope for now: tunnelling / pillaring to buried or high blocks, depositing junk drops, tool durability, smelting, several chests, chest and bot persistence across reloads (Phase 8). Full contract: [docs/PHASE2-SPEC.md](docs/PHASE2-SPEC.md).

## Phase 1: walking skeleton (done)

Chat command → parse → task → bot executes → bot replies, on a world with **Beta APIs on and cheats off**.

- Commands: `!help [command]`, `!status [bot]`, `!spawn [name]`, `!goto <x> <y> <z> [count]`, `!come [count]`, `!stop [bot]`, plus `!override` / `!queue` to answer a "busy" reply when every bot is taken. Fallback slash command: `/colony:c <command>` (same text, `!` optional).
- Goto task: navigate, re-path when stuck, time out, fail fast with "no path".
- Spike probes (`/colony:probe spawn|chat|chunks|reload`): bots spawn with cheats off and use absolute coords, `!` chat works and is hidden, bots tick far from players, bots don't survive Save & Quit. See [docs/PHASE1-SUMMARY.md](docs/PHASE1-SUMMARY.md).

## Roadmap

1. Walking skeleton (done) · 2. Gatherers (current) · 3. Builders · 4. Commander (rule-based goals → multi-bot task graphs) · 5. Guards · 6. Scale and outposts · 7. Learned combat (trained offline, shipped as JS weights) · 8. Persistence.

## Quick start

```sh
npm install
npm run check   # typecheck + unit tests + build
npm run pack    # -> dist/bot-colony.mcpack
```

Delete any older Bot Colony BP (Settings → Storage), then double-click `dist/bot-colony.mcpack` to import it. Create a world with **Beta APIs on, cheats off**, activate **Bot Colony BP**, then `!spawn`, look at a chest and `!chest set`, and `!gather logs 8`. Full steps, including the dev world for GameTests and troubleshooting: [docs/SETUP.md](docs/SETUP.md).

Targets game 1.26.5x with `@minecraft/server 2.11.0-beta` and `@minecraft/server-gametest 1.0.0-beta`.

## Layout

```
src/core/            pure TS, no @minecraft imports
  types.ts           shared contracts: commands, tasks (goto | gather), events, effects, snapshot
  items.ts           resource table (sources, yields, tools), aliases, tool tiers, block hardness, recipes
  commands/          parser, command specs, help text
  colony/            colony state machine: tasks, allocator, offers, chest registry, messages
src/game/            imperative shell
  adapter/           the only engine-facing code for bots: SimulatedPlayer → WorkerBody, WorldPort, chest locate/read
  bots/              engine-free bot logic (never imports @minecraft/* or the adapter)
    ports.ts         WorkerBody / WorldPort interfaces the executors see
    executor.ts      TaskExecutor contract, GatherConfig, ExecutorRegistry (one factory per task kind)
    registry.ts      the registry: goto → GotoExecutor, gather → GatherExecutor
    goto-executor.ts, executor-logic.ts    goto state machine
    gather-executor.ts                     gather state machine (tool, scan, approach, break, collect, deposit)
    gather-logic.ts, crafting.ts           pure geometry, scanning, break timing, inventory, tool and craft planning
  frontends/         chat (!) and slash (/colony:c) front-ends
  runtime.ts         wiring: events in, effects out, executors, progress events, chest effects
src/probes/          spike probes (/colony:probe)
src/gametests/       GameTests (/gametest runset colony)
src/main.ts          entry
test/                Vitest unit tests (parser, colony, pure logic, executors against fakes, adapter against a mocked engine, runtime, boundaries)
scripts/             build.mjs (esbuild bundle; --pack zips the .mcpack), make-structure.mjs (GameTest structures: flat, walled, grove, quarry)
packs/BP/            the behavior pack; scripts/main.js and structures/colony/* are build outputs
docs/                specs, phase summaries, SETUP.md, SPIKE-CHECKLIST.md, AGENT-CONTEXT.md
```

Module boundaries (enforced by `test/boundaries.test.ts`): `src/core` imports nothing from `@minecraft`; only `src/game/adapter`, `src/probes` and `src/gametests` import `@minecraft/server-gametest`; `src/game/bots` imports neither `@minecraft/*` nor the adapter, so executors are tested against plain fakes.

## Docs

- [docs/PHASE2-SPEC.md](docs/PHASE2-SPEC.md): Phase 2 contract (gatherers)
- [docs/PHASE1-SPEC.md](docs/PHASE1-SPEC.md), [docs/PHASE1-SUMMARY.md](docs/PHASE1-SUMMARY.md): Phase 1 contract and results
- [docs/AGENT-CONTEXT.md](docs/AGENT-CONTEXT.md): ground rules, survival rules, verified engine facts
- [docs/SETUP.md](docs/SETUP.md): build, install, play world, dev world for GameTests, troubleshooting
- [docs/SPIKE-CHECKLIST.md](docs/SPIKE-CHECKLIST.md): engine questions, how each is tested, results
