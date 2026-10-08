# Brief S2a: scoring (role: Section Writer)

**OUTPUT:** `docs/phase3/spec/S2a-scoring.md` (budget: about 500 lines)

**INPUTS:**
- `docs/phase3/spec/S1-stack-sensing.md` §1 (types: `Percept`, `SelfPercept`, `EntityPercept`, `Classification`, `Relevance`, `ObjectiveContext`), §5–§7, §9 (reflexes).
- `docs/phase3/spec/S3-body.md`: the `MobEntry`/`Condition` shapes, `TacticName`, `canBlock()`.
- `docs/phase3/MOBS.md` §1–§3 (danger, engage_policy, preferred_range, flee_if).
- `docs/phase3/TABLES.md` §1–§4.

**MUST USE:** S1 type and field names exactly. If you need a field S1 lacks, add it under "Requested Percept additions" with its exact TS.

## Cover
1. **Public API** (`src/core/combat/scoring.ts`, pure): exact TS signatures for every function. Also the `Knowledge` bundle type (mob, food and value lookups), `FoodEntry`, `ItemValueEntry`, `CombatConfig` (the S2 part), and `Rng = () => number` in [0,1).
2. **Derived quantities, each as a formula with constants:**
   - threatLevel per entity: MOBS danger × distance falloff, normalised by HP.
   - totalThreat.
   - expectedIncomingDps: from MOBS attack damage at Normal difficulty and an attack interval table per mob.
   - botOffenceDps: sword damage fist 1, wood or gold 4, stone 5, iron 6, diamond 7, netherite 8; axes per MOBS/Bedrock; attack interval from S3.
   - timeToKill and timeToDie.
   - deathRisk ∈ [0,1]: a logistic, with constants.
   - cargoValue, gearValue, objectiveValue and deathCost: exactly per TABLES §4.
   - canEatSafely: no relevant threat can reach within eatTicks + margin, using a mob speed table in blocks per tick.
3. **A score formula for every option:** attack, shield, back_off, retreat, eat, flee, escape_rejoin, resume_task, idle. Use named config weights and include these gates:
   - engage_policy (avoid → attack only if blocking_objective and danger ≤ threshold; flee → attack score 0).
   - flee_if forces flee.
   - never_target, neutral_unprovoked and irrelevant → attack score 0 (irrelevant → avoid instead).
   - **Escape rule:** low HP plus high objective or cargo value → escape_rejoin dominates. Low HP plus cheap cargo → fight or retreat locally. No cooldown.
   - **Retreat → eat → fight must emerge from the scores:** eat scores high only when canEatSafely and HP or hunger is low; retreat scores high when eating is wanted but unsafe.
4. **Fixed exports** (S2b is written in parallel against these names, so use them exactly):
   - `computeDerived(p: Percept, kb: Knowledge, cfg: CombatConfig): Derived`
   - `scoreOptions(p: Percept, d: Derived, kb: Knowledge, cfg: CombatConfig): OptionScores`
   - `OptionScores = Record<OptionKind, number>`
   - Give `Derived` its full TS.
5. **At least 8 worked scenario examples,** showing derived values and every option score:
   - HP 6/20, 3 zombies at 4 blocks, steak in inventory.
   - Same, but the zombies are at 20 blocks → eat.
   - Mid-meal, a zombie closes to 2 blocks.
   - Holding 64/64 requested diamonds at HP 5 with 2 skeletons → escape_rejoin.
   - HP 5 holding only dirt → retreat or fight, not escape.
   - A creeper at 2.5 blocks while gathering.
   - An irrelevant zombie 12 blocks away while gathering → resume_task.
   - Defend task, a zombie targeting a player in the zone → attack.
   - An enderman, neutral and unprovoked → attack score 0.
6. **Config keys table "Config keys (S2a)":** key | default | unit | meaning. Bias toward bot survival.
7. **Open questions,** each with the fallback chosen.
