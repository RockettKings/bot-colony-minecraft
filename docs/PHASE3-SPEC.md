# Phase 3 spec: Combat I (skeleton + index)

Builders are lower-capability models, so this spec decides everything: numbers instead of adjectives, explicit state machines, exact names. If a builder finds a gap, it **reports** the gap; it does not invent a design.

**Read order for every agent:**
1. `docs/AGENT-CONTEXT.md`
2. `docs/ROADMAP.md` (agreed decisions; it overrides anything here)
3. this file
4. the section files below that your job uses
5. the data sources: `docs/phase3/API-MAP.md`, `docs/phase3/MOBS.md`, `docs/phase3/TABLES.md`

## 1. Goal

Every bot inherits a combat layer. It senses threats, decides with a scored loop (attack, shield, back off, retreat, eat, flee, escape-rejoin, resume), and fights with per-mob tactics. It never attacks players. It pauses its current task during a fight and resumes it afterwards with progress kept.

The bot snapshot system lets a bot leave and come back with exactly its items. This covers:
- escaping at low HP: home if set, else the owner's feet; no cooldown
- `!summon` / `!dismiss`
- idle self-dismiss
- surviving Save & Quit

`!defend` patrols protect players and bots from mobs.

The Definition of Done list is in section 13. `npm run check` must pass.

## 2. Scope

| In | Out (later phases) |
|---|---|
| Phase 3 mobs in MOBS.md §3, the default unknown-hostile entry, never-target and neutral lists | Bows and crossbows, Phase 5 mobs (only their stub entries: avoid or flee) |
| Melee, shield, eating, equipment (armour, offhand shield, weapon), durability-aware swap and requests | Crafting replacement gear (Phase 6), smelting, prospecting |
| Snapshot system and all of its flows | Sorter, signs, `!sort` (Phase 4) |
| `!defend`, `!home set`, `!summon`, `!dismiss`, `!recall`, extended `!status` | Resuming queued tasks across a reload (Phase 9) |
| Outcome stats (in memory; saved with the snapshot store) | The learned policy (Phase 8) |
| Probes and GameTests for all of the above | Shulker boxes, bundles, ender chests |

## 3. Architecture

```
            ┌──────────────────────── src/core (pure, no @minecraft) ──────────────────────────┐
 commands → │ commands/parse ─► colony/Colony.handle(event) ─► Effect[]   (owners, home, tasks,    │
            │                                                             dismissed roster)       │
            │ combat/sense.ts   classify(entity, ctx) → Classification, relevance                   │
            │ combat/brain.ts   decide(percept, state, kb, cfg, rng) → { decision, state }          │
            │ combat/stats.ts   outcome stats + tactic selection                                     │
            │ combat/mobs.ts food.ts values.ts   knowledge base (data)                               │
            │ snapshot/codec.ts snapshot/machine.ts   (pure snapshot model + flow state machines)   │
            │ config.ts         every tunable (one object)                                          │
            └───────────────────────────────────────────────────────────────────────────────────────┘
                      ▲ Percept (plain data)                     │ Decision (plain data)
            ┌─────────┴────────────── src/game (engine) ────────▼──────────────────────────────────┐
 per bot,   │ bots/sensor.ts      reads entities/self/inventory → Percept                             │
 every      │ bots/controller.ts  BotController: priority stack reflexes → combat → task → idle,     │
 decision   │                     owns the TaskExecutor, pause()/resume(), feeds brain, runs actions │
 tick       │ bots/combat-executor.ts  turns a Decision into body actions via body/*                 │
            │ bots/body/          tactics.ts melee.ts shield.ts eating.ts equipment.ts               │
            │ snapshot/           store.ts (dynamic properties)  service.ts (dismiss/rejoin/escape/  │
            │                     restore-on-load, executes core/snapshot/machine.ts)                │
            │ adapter/            the only engine calls (bindings per API-MAP.md)                    │
            │ runtime.ts          wires all of the above; existing colony effects loop                │
            └─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Rules:**
- **The colony core stays the authority on tasks, owners, home and the roster** (active vs dismissed). It knows nothing about combat moment to moment.
- **Combat is per-bot and game-side,** but every decision is made by **pure** functions in `src/core/combat` from a `Percept`. That way every decision is unit-testable.
- **During combat the task is paused, not cancelled.** The core sees the task as still active. The `!status` line shows the combat state (from `BotController` via a `botStatus` read, defined in S5).

**Cadence:**
- The runtime pump stays at 4 ticks.
- `BotController.tick(now)` runs every pump.
- The sensor's full scan runs every `config.combat.scanEveryTicks`.
- The brain decides every pump, but commitment rules (S2) prevent dithering.

## 4. Shared vocabulary (names are fixed; the section files define fields exactly)

All of these live in `src/core/combat/types.ts` or `src/core/snapshot/types.ts`, and the contract writer creates them. Section writers add fields; they never rename.

| Name | Kind | Meaning | Defined in |
|---|---|---|---|
| `Percept` | interface | Everything the brain may know at tick `now`: `self: SelfPercept`, `entities: EntityPercept[]`, `objective: ObjectiveContext`, `home?`, `owner?`, `now` | S1 |
| `SelfPercept` | interface | HP, max HP, hunger, saturation, pos, effects, inWater, onGround, inventory summary (foods, weapons, shields, armour), equipped gear, cargo/gear/objective values | S1 |
| `EntityPercept` | interface | id, typeId, pos, distance, hp, targetingMe, hurtMeAtTick?, provoked, lineOfSight, classification, relevance | S1 |
| `Classification` | union | `"ignore" \| "never_target" \| "neutral_unprovoked" \| "threat"` | S1 |
| `Relevance` | union | `"threatening_me" \| "blocking_objective" \| "irrelevant"` | S1 |
| `ObjectiveContext` | union by kind | Objective points per task kind (gather target block, path corridor, chest; defend zone + protected players; goto target; idle) | S1 |
| `LayerKind` | union | `"reflex" \| "combat" \| "task" \| "idle"` | S1 |
| `OptionKind` | union | `"attack" \| "shield" \| "back_off" \| "retreat" \| "eat" \| "flee" \| "escape_rejoin" \| "resume_task" \| "idle"` | S2 |
| `Decision` | interface | option, targetId?, tactic?: `TacticName`, foodTypeId?, moveTo?, scores (debug) | S2 |
| `BrainState` | interface | committed option and until-tick, current tactic, engagement record, `OutcomeStats` (provocation lives in S1 `ProvocationMemory`, D4) | S2b |
| `Knowledge`, `Derived` | interfaces | `Knowledge` = `kb.mob/food/value` (D1); `Derived` = the per-pump derived quantities | S2a |
| `FoodChoice` | interface | `{ typeId, slot, eatTicks, situation, emergency }` returned by `chooseFood` | S2b |
| `OutcomeStats` | interface | per mob × tactic: n, wins, losses, damageTaken, ticks | S2 |
| `TacticName` | union | Exactly the snake_case names in MOBS.md §5 | S3 |
| `BodyActions` | port interface | Primitive actions the combat executor and tactics use (look, move, strafe, sprint, jump, attackTarget with reach/LoS enforced, raiseShield, lowerShield, eat(slot), equip, stopBreaking, sneak) | S3 |
| `MobEntry`, `MobKnowledge` | interfaces | TS form of a MOBS.md block and the whole knowledge base | B2 transcribes; shape in S3 |
| `FoodEntry`, `FoodSituation`, `ItemValueEntry` | interfaces | TS form of the TABLES.md rows | B2 transcribes; shape in S2 |
| `BotSnapshot`, `SnapItem`, `RestoreToken`, `SnapshotFlowState` | types | Snapshot model and flow states | S4 |
| `DefendTask` | Task kind `"defend"` | `{ id, kind: "defend", center: Vec3, radius, issuer, createdAt }`: a long-running patrol until stopped | S5 |
| `ColonyConfig` | interface | Existing colony config, extended by S5 (`statusStaleTicks`, `statusPushTicks`, `flowTimeoutTicks`); `Phase3Config.colony` | S5 |
| `Phase3Config` | interface | `{ combat: CombatConfig; body: BodyConfig; snapshot: SnapshotConfig; idle: IdleConfig; defend: DefendConfig; colony: ColonyConfig }`: every key with default, unit and meaning. `DefendConfig` is S1 §4.4; `ColonyConfig` the keys of S5 §9 | Each section lists its own keys; the contract writer merges them into `src/core/config.ts` |

**Executor contract change (S1 defines it exactly):** `TaskExecutor` gains `pause(now: Tick): void` and `resume(now: Tick): void`.
- Pause stops all body actions and keeps progress.
- Resume re-plans: gather re-scans from current progress, goto re-paths.
- `step()` is not called while paused.

## 5. Section files (Docs stage; roles from docs/ROLES.md)

| Id | File | Covers | Role | Status |
|---|---|---|---|---|
| S1 | `spec/S1-stack-sensing.md` | Priority stack, `BotController`, executor pause/resume, sensor, `Percept`, classification, relevance, leash, reflexes | Section Writer (Opus) | done |
| S2a | `spec/S2a-scoring.md` | Derived quantities (threat, DPS, time to kill and die, death risk, cargo/gear/objective values, canEatSafely) and the score formula per option | Section Writer (Opus) | todo |
| S2b | `spec/S2b-commit-tactics.md` | Commitment and hysteresis, target selection, food choice per situation, outcome stats and tactic selection, ≥ 8 worked examples | Section Writer (Opus) | todo, after S2a |
| S3 | `spec/S3-body.md` | `BodyActions`, tactic scripts, melee, shield, eating, equipment | Section Writer (Sonnet) | done |
| S4a | `spec/S4a-snapshot-data.md` | Snapshot types, excluded items, codec, store (write-then-commit), write triggers | Section Writer (Opus) | todo |
| S4b | `spec/S4b-snapshot-flows.md` | Flows (dismiss, summon, escape, idle, Save & Quit, haul), exactly-once restore, invariants, failure table, event payloads | Section Writer (Opus) | todo, after S4a |
| S5 | `spec/S5-commands.md` | Commands, owner, home, events/effects names, strings, `!status` | Section Writer (Sonnet) | done |
| S6 | `spec/S6-verification.md` | Probes, GameTests, builder rules, DoD | Section Writer (Sonnet) | done |
| – | `DECISIONS.md` | Cross-section name and field mismatches resolved | Reconciler (Opus) | after all sections |
| – | `cases/<id>.md` | Given/when/then cases per section | Case Writer (Sonnet) | after DECISIONS |

Docs-stage order: S2a ∥ S4a → S2b ∥ S4b → Reconciler → Case Writers ∥ Doc Reviewers → **Jaycob approves** → Code stage.

## 6. Code-stage modules (after approval; Implementer role, one module each, disjoint files)

The contract writer owns every `types.ts`, `ports.ts` addition, `config.ts`, the `Executor` interface change, and the stub files. Builders fill in bodies.

| Module | Model | Owns (create or edit) | Case file |
|---|---|---|---|
| B1 Combat brain | Sonnet | `src/core/combat/sense.ts`, `brain.ts`, `stats.ts`, `scoring.ts`; tests `test/combat-sense.test.ts`, `test/combat-brain.test.ts`, `test/combat-stats.test.ts` | TC-B1 |
| B2 Knowledge modules | Haiku | `src/core/combat/mobs.ts`, `food.ts`, `values.ts`, `knowledge.ts` (data and lookups); `config.ts` default values only; tests `test/combat-kb.test.ts` | TC-B2 |
| B3 Priority stack | Sonnet | `src/game/bots/controller.ts`, `sensor.ts`, `combat-executor.ts`; pause/resume bodies in `gather-executor.ts`, `goto-executor.ts`, and the new `defend-executor.ts`; `src/game/runtime.ts`; `src/game/bots/registry.ts`; `src/gametests/combat.ts`; tests `test/controller.test.ts`, `test/sensor.test.ts`, `test/defend-executor.test.ts` | TC-B3 |
| B4 Snapshot | Sonnet | `src/core/snapshot/codec.ts`, `machine.ts`; `src/game/snapshot/store.ts`, `service.ts`; tests `test/snapshot-*.test.ts` | TC-B4 |
| B5 Body control | Sonnet | `src/game/bots/body/*.ts`; adapter additions in `src/game/adapter/body.ts` (new file); `src/probes/combat/*.ts`; tests `test/body-*.test.ts` | TC-B5 |
| B6 Commands | Sonnet | `src/core/commands/parse.ts`, `specs.ts`; `src/core/colony/index.ts`, `state.ts`, `allocator.ts`; tests `test/commands-p3.test.ts`, `test/colony-p3.test.ts` | TC-B6 |
| B7 Docs | Haiku | `src/core/colony/messages.ts` (new strings exactly as S5), `src/core/commands/help.ts`, `PLAYTEST.md` §Phase 3, `README.md` | TC-B7 |

## 13. Definition of Done
Filled in from S6.

## 14. Contract-writer decisions
Filled in by the contract writer.
