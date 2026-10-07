# Bot Colony

**Just want to play or test it?** Read [PLAYTEST.md](PLAYTEST.md).

A Minecraft Bedrock behavior pack (Script API, TypeScript) for a colony of autonomous bots. You give orders in chat, a planner turns them into tasks, and bots (simulated players) carry them out. Eventually Claude acts as the commander; in Phase 1 the "commander" is a deterministic rule-based core.

## Phase 1: walking skeleton

Chat command → parse → task → bot executes → bot replies. It runs on a normal world with **Beta APIs on and cheats off**.

- Commands: `!help [command]`, `!status [bot]`, `!spawn [name]`, `!goto <x> <y> <z> [count]`, `!come [count]`, `!stop [bot]`, plus `!override` / `!queue` to answer a "busy" reply when every bot is taken. Fallback slash command: `/colony:c <command>` (same text, `!` optional).
- One task type: goto (navigate, re-path when stuck, time out, fail fast with "no path").
- Spike probes (`/colony:probe spawn|chat|chunks|reload`) answer the engine questions later phases depend on.
- GameTests for goto and the override flow (`/gametest runset colony`, dev world).

Out of scope: chests and inventory (Phase 3), the Claude bridge (Phase 2), persistence across reloads (Phase 5), combat (Phase 6). The full contract is in [docs/PHASE1-SPEC.md](docs/PHASE1-SPEC.md).

## Quick start

```sh
npm install
npm run check   # typecheck + unit tests + build
npm run pack    # -> dist/bot-colony.mcpack
```

Double-click `dist/bot-colony.mcpack` to import it. Create a world with **Beta APIs on, cheats off**, activate **Bot Colony BP**, then type `!spawn` and `!come`. Full steps, including the dev world for GameTests and troubleshooting: [docs/SETUP.md](docs/SETUP.md).

Targets game 1.26.5x with `@minecraft/server 2.11.0-beta` and `@minecraft/server-gametest 1.0.0-beta`.

## Layout

```
src/core/        pure TS, no @minecraft imports: types, command parser + help, colony (tasks, allocator, offers, messages)
src/game/        imperative shell: adapter, chat + slash front-ends, goto executor, runtime
src/probes/      spike probes (/colony:probe)
src/gametests/   GameTests (/gametest runset colony)
src/main.ts      entry
test/            Vitest unit tests (core, executor logic, runtime, module boundaries)
scripts/         build.mjs (esbuild bundle; --pack zips the .mcpack), make-structure.mjs (GameTest .mcstructure files)
packs/BP/        the behavior pack; scripts/main.js and structures/colony/* are build outputs
docs/            PHASE1-SPEC.md, SETUP.md, SPIKE-CHECKLIST.md
```

Only `src/game/adapter`, `src/probes` and `src/gametests` import `@minecraft/server-gametest`; `src/core` imports nothing from `@minecraft`. `test/boundaries.test.ts` enforces both.

## Docs

- [docs/PHASE1-SPEC.md](docs/PHASE1-SPEC.md): Phase 1 contract and API ground rules
- [docs/SETUP.md](docs/SETUP.md): build, install, play world, dev world for GameTests, troubleshooting
- [docs/SPIKE-CHECKLIST.md](docs/SPIKE-CHECKLIST.md): what each probe tests, PASS/FAIL criteria, results
