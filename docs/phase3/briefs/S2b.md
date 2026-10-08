# Brief S2b: commitment, targets, food, tactics (role: Section Writer)

**OUTPUT:** `docs/phase3/spec/S2b-commit-tactics.md` (budget: about 500 lines)

**INPUTS:**
- `docs/phase3/spec/S1-stack-sensing.md` §1 (types), §2–§3 (BotController, priority stack).
- `docs/phase3/spec/S3-body.md`: `TacticName`, `MobEntry`/`Condition`, the TacticRunner interface.
- `docs/phase3/MOBS.md` §3 and §5 (`tactics` + `when`, TACTICS catalogue).
- `docs/phase3/TABLES.md` §3 (food selection rules).

**Written in parallel with S2a.** S2a exports these exact names; use them and don't define them:
- `computeDerived(p, kb, cfg): Derived`
- `scoreOptions(p, d, kb, cfg): OptionScores` (`Record<OptionKind, number>`)
- `Knowledge`, `CombatConfig`, `Rng = () => number`

## Cover
1. **Public API** (`src/core/combat/brain.ts`, `stats.ts`, pure):
   - `decide(p: Percept, s: BrainState, kb: Knowledge, cfg: CombatConfig, rng: Rng): { decision: Decision; state: BrainState }`, as a step-by-step algorithm that calls computeDerived and scoreOptions.
   - Full TS for `Decision`, `BrainState`, `EngagementRecord`, `OutcomeStats`, `TacticStat`.
2. **Commitment and hysteresis:**
   - A minimum commit ticks table per option.
   - The switch rule: newScore > currentScore × (1 + switchMargin).
   - The hard-interrupt list: hp ≤ critical, target invalid or dead, eating interrupted by a threat in reach, S1 reflex active.
   - The tie-break order.
3. **Target selection** among relevant entities: threatening_me by lowest timeToKill first; a creeper within 4 blocks first; then blocking_objective nearest. Include the leash rule from S1.
4. **Food choice:** an exact procedure per TABLES §3 situation (topup, pre_engage_heal, emergency, starving, escape_teleport) → `foodTypeId` and slot.
5. **Tactic selection with outcome stats:**
   - Allowed tactics: the MOBS tactics whose `when` holds.
   - Epsilon-greedy over utility = winRate − λ·normDamage − μ·normTicks.
   - Priors from rank order; minimum samples before stats count.
   - Engagement start and end rules: win, loss, abandon defined exactly.
   - The update rule.
   - The JSON shape, which S4a stores as an opaque string.
6. **At least 6 worked examples,** given option scores as inputs: commitment holds, switch fires, hard interrupt, target choice among 3 mobs, food choice per situation, tactic choice with stats (show the rng value).
7. **Config keys table "Config keys (S2b)".**
8. **Open questions** with fallbacks.
