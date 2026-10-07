# Agent context (read first)

Shared ground rules for every agent working on this repo. The lead updates this between phases.

## Project
- Repo: `/home/claude/bot-colony` (git; the lead commits after each phase, agents don't commit).
- Minecraft Bedrock behavior pack: TypeScript → esbuild → `packs/BP/scripts/main.js` → `dist/bot-colony.mcpack`.
- Target game 1.26.5x. Pinned packages: `@minecraft/server 2.11.0-beta.1.26.52-stable`, `@minecraft/server-gametest 1.0.0-beta.1.26.52-stable`.
- **Ground truth for every game API:** `node_modules/@minecraft/server/index.d.ts` and `node_modules/@minecraft/server-gametest/index.d.ts`. Never use a method, property, event or enum member that isn't in those files. Check privilege annotations (read-only before-events, restricted-execution custom-command callbacks, early-execution). Wrap experimental calls in try/catch at the adapter boundary and log with a `[colony]` tag.

## Player requirements and decisions
- Runs on a normal client-hosted world (solo or friends): **Beta APIs ON, cheats OFF**.
- **No network, no API keys, no dedicated server, no LLM at runtime.** Everything is in-pack code. The "commander" is rule-based code.
- Anyone can command bots. Busy bots → an offer answered with `!override` / `!queue` (expires in 30 s).
- `!` chat commands are primary (`world.beforeEvents.chatSend`, verified working); `/colony:c <text>` is the fallback.
- Player-facing chat text: short, consistent, colony lines `§7[Colony]§r …`, bot lines `<Bot-1> …`.

## Verified in-game facts (Phase 1 probes)
- Top-level `spawnSimulatedPlayer` works with cheats off; bots spawned this way use **absolute world coords** for navigation.
- Bots keep ticking and moving > 160 blocks from every real player (no tickingarea needed).
- Bots do **not** survive Save & Quit. Persistence is the **final** phase; don't build persistence before then.

## Survival rules for bots ("same permissions as a player")
- No `/give`, `/tp`, `/fill`, `setBlock`/`setType` or item spawning for gameplay. Bots break and place blocks themselves via the SimulatedPlayer API, and blocks/items must really be produced/consumed.
- Allowed abstractions (a player could do the same through a UI the bot can't open):
  - **Container transfer:** moving items between a bot's inventory and a container block the bot is standing next to (≤ 2.5 blocks), via the `inventory` component containers.
  - **Crafting:** consuming exact recipe ingredients from the bot's inventory to produce the output (2×2 recipes anywhere; 3×3 only within reach of a crafting table).
  - Item pickup happens naturally (survival bots pick up nearby drops).

## Architecture
- **Functional core / imperative shell.**
  - `src/core/` is pure TS, **no `@minecraft/*` imports** (enforced by `test/boundaries.test.ts`). `Colony.handle(event: ColonyEvent): Effect[]` is deterministic; time arrives on events as ticks.
  - `src/game/` is the shell: `adapter/` (the only importer of `@minecraft/server-gametest` besides `src/probes` and `src/gametests`), `frontends/` (chat + slash), executors, `runtime.ts` wiring.
  - Shared contracts live in `src/core/types.ts` and are owned by the phase architect.
- Specs: `docs/PHASE1-SPEC.md`, then `docs/PHASE<n>-SPEC.md` per phase. Player guide: `PLAYTEST.md`. Phase summaries: `docs/PHASE<n>-SUMMARY.md` (lead).

## Working mode: rapid prototype
- Favour a working end-to-end slice over completeness. Leave `TODO(phase-n)` notes rather than gold-plating.
- Still required: `npm run check` (typecheck + vitest + build) passes, and existing behaviour and tests keep working.
- GameTests can't run here. Verify game-layer logic with unit tests against fakes (see how `test/runtime.test.ts` mocks `@minecraft/*` with `vi.mock`), and add GameTests for the player to run.
- **Do not** modify `package.json`, run `npm init`, or install packages. Node scripts may live in `scripts/`.
- Stay inside the files your job owns. If you need something outside them, make a local workaround and report it.

## Phase plan
1. Walking skeleton — done.
2. Gatherers
3. Builders
4. Commander (rule-based goals → multi-bot task graphs, roles)
5. Guards (`!defend`, zones, rule-based combat)
6. Scale and outposts
7. Learned combat (trained offline in Node, shipped as JS weights)
8. Persistence
