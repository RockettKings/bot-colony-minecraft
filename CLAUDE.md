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

## Agent workflow for each phase
Lead (Opus) → planners → contract writer → builders → reviewers → lead merges findings, runs check, packs and pushes.
- **Planners:**
  - spec architect or section writers (Opus/Sonnet)
  - API verifier (Opus)
  - data authors (Sonnet)
  - test-case author (Sonnet)
- **Contract writer (Opus):** writes the types and stubs so everything compiles before any builder starts.
- **Builders:** Sonnet, or Haiku for transcription and docs. Each owns a disjoint file list (`PHASE3-SPEC.md` §6) and reports out-of-scope problems instead of editing other files.
- **Reviewers:** Opus for correctness, integration, item conservation and API accuracy; Sonnet or Haiku for game knowledge, tests and docs.

## Current state (update this section at every checkpoint)
- **Phase 1** (walking skeleton): done.
- **Phase 2** (gatherers: `!chest set`, `!gather`, tools, crafting): built at commit `d2526a2`. 548 tests pass. Not yet reviewed; it gets reviewed inside Phase 3.
- **Phase 3** (Combat I), branch `phase-3-combat`. Planning is in progress:
  - **Done:** `ROADMAP.md`, `phase3/API-MAP.md`, `MOBS.md`, `TABLES.md`, and the `PHASE3-SPEC.md` skeleton (architecture, vocabulary, jobs).
  - **Section specs done:** S1 (stack and sensing), S3 (body), S5 (commands), S6 (verification).
  - **Missing:** S2 (decision loop: scoring formulas, hysteresis, outcome stats, worked examples) and S4 (snapshot system: schema, store, flows, exactly-once restore, conservation invariants). Both writers were cut off by usage limits.
  - **Next:**
    1. Write S2 and S4.
    2. The contract writer reconciles S1–S6 (S5 lists the event and effect names S4 must use; S3 §10 and S6 §0 list requests for the contract writer), records decisions in `PHASE3-SPEC.md` §14, and writes the types and stubs.
    3. The test-case author writes `docs/phase3/TEST-CASES.md`.
    4. **Jaycob reviews the spec.**
    5. Builders B1–B7, then reviewers R1–R8 (including the Phase 2 gather review).
- **Phase 3 in-game probes** to run once built: P0 is disconnect (do items drop?), invchange, attack, shield and eating. See S6.
