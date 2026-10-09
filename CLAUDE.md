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
  - **All Phase 3 docs are written and revised once (review pass 1):**
    - `docs/PHASE3-SPEC.md`: skeleton, vocabulary, module table.
    - `docs/phase3/spec/`: S1 stack/sensing, S2a scoring, S2b commitment/tactics, S3 body, S4a snapshot data, S4b snapshot flows, S5 commands, S6 verification.
    - `docs/phase3/`: API-MAP, MOBS, TABLES.
    - `docs/phase3/DECISIONS.md`: binding cross-doc decisions D1–D31.
    - About 10,000 lines in total.
  - **Review coverage, pass 1:**
    - The existing docs (S1, S3, S5, S6, MOBS, TABLES, API-MAP) had all 5 lenses (precision, consistency, game-api, logic, completeness), and the findings were applied.
    - The new docs (S2a, S2b, S4a, S4b) only had `DECISIONS.md` and the S2a precision findings applied. **They haven't had a full review yet.**
  - **Review pass 2: in progress, stopped by Jaycob on 2026-10-09.**
    - **Done:** the game-api review of the new docs (`reviews/<DOC>--game-api--p2.md` for S2a, S2b, S4a, S4b: 28 findings, no blockers by severity).
      - **Key issues found:** the S4a Save & Quit drop scan can duplicate items (merged item entities, 8-block radius); S2a/S2b still list honey_bottle (contradicts D20); D31 is only partly closed.
    - **Not run yet:**
      - New-group lenses: precision, consistency, logic, completeness.
      - Seam-A consistency (S1, S3, S6) and seam-B consistency (S5, MOBS, TABLES, API-MAP).
      - The prompts are the same as for game-api; see `briefs/REVIEW.md` § "Pass 2".
  - **After pass 2:** revisers apply the `--p2` findings, Case Writers write `docs/phase3/cases/`, **Jaycob approves**, then the code stage.
  - **Briefs:** `docs/phase3/briefs/` (COMMON, REVIEW, REVISE, S2a, S2b, S4a, S4b). For pass 2, reviewers write `reviews/<DOC>--<lens>--p2.md`.
- **Phase 3 in-game probes** to run once built: P0 is disconnect (do items drop?), invchange, attack, shield and eating. See S6.
