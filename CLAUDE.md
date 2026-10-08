# CLAUDE.md: Bot Colony (Minecraft Bedrock)

Read this first in every Claude Code session on this repo.

## What this is
A Minecraft Bedrock behavior pack (TypeScript, Script API) for a colony of simulated-player bots that take `!` chat commands. Owner: Jaycob (RockettKings), a CS student. Be concise and technical.

## Read order
1. `docs/ARCHITECTURE.md`: how the code is laid out and why.
2. `docs/ROADMAP.md`: agreed decisions and phase scope. It overrides everything else.
3. `docs/AGENT-CONTEXT.md`: ground rules for agents and the verified engine facts.
4. For the current phase: `docs/PHASE3-SPEC.md`, then `docs/phase3/spec/S*.md` and the data in `docs/phase3/` (`API-MAP.md`, `MOBS.md`, `TABLES.md`).

## Commands
```sh
npm ci            # install (pinned @minecraft versions; never upgrade them)
npm run check     # typecheck + vitest + build. Must pass before any commit
npm run pack      # -> dist/bot-colony.mcpack
npx vitest run test/<file>.test.ts
```

## Hard rules
- **No `@minecraft/*` imports in `src/core/`.** `test/boundaries.test.ts` enforces this. Core is pure and deterministic: time comes in as ticks, randomness from an injected `Rng`.
- **Engine calls only through `src/game/adapter/`,** wrapped in try/catch and logged with `[colony]`. Only use APIs present in `node_modules/@minecraft/*/index.d.ts`, and for Phase 3, listed in `docs/phase3/API-MAP.md`.
- **Pinned packages:** `@minecraft/server 2.11.0-beta.1.26.52-stable`, `@minecraft/server-gametest 1.0.0-beta.1.26.52-stable`, for game 1.26.5x. Don't modify `package.json` or install packages without asking.
- **Survival rules:** no give, tp, fill, setBlock or item creation for gameplay. The only exception is Phase 3's snapshot restore, which happens exactly once and never duplicates.
- **Bots never attack players,** villagers, golems or tamed pets.
- **No network, API keys, dedicated server or LLM at runtime.**
- **Don't edit tests to make them pass.** Fix the code, or report the test as wrong.

## Git
- **Remote:** `origin` = `https://github.com/RockettKings/bot-colony-minecraft`. **Push only to this repository, nowhere else.**
- **Branches:** `main` is always a working build. Each phase gets its own branch (`phase-3-combat`), which merges to `main` at the end of the phase with a tag (`v0.3.0`) and the `.mcpack` attached to a GitHub release.
- **Push at every checkpoint:** spec done, contracts compile, builders done, reviews done.
- **Commit author:** Jaycob Campos <jmcampos2005@icloud.com>.

## Agent workflow
- **Roles and the brief template:** see `docs/ROLES.md`. Each agent gets one narrow role, one brief, a fixed list of input files to read, one output file and a size budget.
- **Two stages per phase:**
  - **Docs stage:** only documents. No edits under `src/`, `test/`, `scripts/` or `packs/`.
  - **Code stage:** starts only after Jaycob approves the spec.

## Current state (update this section at every checkpoint)
- **Phase 1** (walking skeleton): done.
- **Phase 2** (gatherers: `!chest set`, `!gather`, tools, crafting): built at commit `d2526a2`. 548 tests pass. Not yet reviewed; it gets reviewed inside Phase 3.
- **Phase 3** (Combat I), branch `phase-3-combat`. **Docs stage: no code until Jaycob approves.**
  - **Plan:** documents only, 20 agents on Sonnet (high effort), using the briefs in `docs/phase3/briefs/` (COMMON, REVIEW, REVISE, S2a, S2b, S4a, S4b).
  - **Spec sections done:** S1, S3, S5, S6 (plus API-MAP, MOBS, TABLES), and from wave 1, **S2b** and **S4a**.
  - **Reviews of the existing docs done:** the `game-api` and `completeness` lenses, in `docs/phase3/reviews/<DOC>--<lens>.md`.

  **RESUME HERE (stopped 2026-10-08 by the usage limit). Remaining agents, all Sonnet, high effort:**
  - **Wave 1 leftovers (parallel):**
    - Writer S2a (`briefs/S2a.md`).
    - Writer S4b (`briefs/S4b.md`).
    - Reviewers for the existing group, lens `precision` and lens `consistency` (prompt: "Role: Doc Reviewer, lens = X, group = existing. Read briefs/COMMON.md then briefs/REVIEW.md…").
    - Notes for S2a: S2b assumed `Knowledge` accessors `kb.mob`, `kb.food` and `kb.value`, and requested Percept additions (`terrain`, `canBlock`, `shieldDisabled`, `objectiveItemIds`, `tacticFeedback`, `EntityPercept.inWater`). S2a should adopt or define these.
  - **Wave 2 (parallel, after wave 1):**
    - 5 reviewers on the **new** group (S2a, S2b, S4a, S4b), one per lens: precision, consistency, game-api, logic, completeness.
    - 3 revisers on the **existing** group (`briefs/REVISE.md`), one each:
      1. S1 + S6
      2. S3 + S5
      3. MOBS + TABLES + API-MAP
    - **Note: the existing-group `logic` review never ran.** Run it before the revisers, or add it to wave 2.
  - **Wave 3:** 3 revisers on the new group, one each:
    1. S2a + S2b
    2. S4a
    3. S4b
  - **Then:**
    1. The Reconciler writes `docs/phase3/DECISIONS.md` (S4a and S2b both listed cross-doc mismatches).
    2. Update this section.
    3. Push.
    4. Send the spec to Jaycob for approval.
- **Phase 3 in-game probes** to run once built: P0 is disconnect (do items drop?), invchange, attack, shield and eating. See S6.
