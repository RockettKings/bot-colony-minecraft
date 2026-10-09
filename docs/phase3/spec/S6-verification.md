# S6: Verification (probes, GameTests, unit-test plan, builder rules, Definition of Done)

Part of `docs/PHASE3-SPEC.md`. Names from the skeleton (§4 shared vocabulary, §6 jobs B1–B7) are used exactly. Where this file **proposes** a name that the skeleton does not fix (config keys, test hooks, file names), it is marked **[S6-proposed]**; the contract writer reconciles those with S1–S5 and records the result in PHASE3-SPEC §14. Builders never rename anything.

**Alignment with S3.** S3 §7 already fixes `config.body` key names; §1.4 below uses them (marked ✔S3). Keys marked *new* are not in S3 §7 and are added by the contract writer. S3 §6 says probes print `[colony-probe] P<n> <result>`; S6 follows the **existing** probe format (`[probe] <name>: RESULT …`, as the task requires), so S3's wording is superseded (record in §14).

Reference docs used: `docs/phase3/API-MAP.md` (15 probes P1–P15, safe-usage rules; P15 `light` added by DECISIONS D18, fixture-only APIs in its section I), `docs/phase3/MOBS.md`, `docs/phase3/TABLES.md`, `docs/phase3/spec/S1-stack-sensing.md` (`BotStatusView`, in the shape S5 reads: DECISIONS D25), `docs/phase3/spec/S4b-snapshot-flows.md` (§12 snapshot GameTest fixes, applied in §2.4), `docs/phase3/spec/S5-commands.md` (`BotView.presence`, `Sender`), existing `src/probes/*`, `src/gametests/*`, `scripts/make-structure.mjs`, `test/runtime.test.ts`, `test/boundaries.test.ts`.

---

## 0. Decisions S6 needs from the contract writer

Everything below is referenced later; the contract writer creates or records these **before** builders start.

| # | Item | Content |
|---|---|---|
| C1 | `Rng` type | In `src/core/combat/types.ts`: `export type Rng = () => number;` (returns a value in `[0, 1)`). Every core function that needs randomness takes an `Rng` parameter. Production wiring (`Math.random`) happens in `src/game/runtime.ts` only. |
| C2 | Config switches | The keys in §1.4 (probe → config switch table) are added to `src/core/config.ts` with the listed **defaults**. Group names are the skeleton's: `config.combat`, `config.snapshot`, `config.body`. |
| C3 | Test hooks on `ColonyRuntime` (B3 implements per S1 §11, in `src/game/runtime.ts`) | `testReset(): void` clears colony core state, all controllers, the roster and every world dynamic property whose key starts with `colony:` and does NOT start with `colony:probe` (so `colony:probe_shield_mode` survives; snapshot keys `colony:snap:…` and the persisted meta key). `combatDebug(botName: string): CombatDebug`. `botStatus` is **not** needed: use `snapshot().bots[i].combat` (S1 `BotStatusView`, S5 shape, D25). Both hooks are **TEST-ONLY** (see §4 rule 21). |
| C4 | `CombatDebug` shape (**[S6-proposed]**, in `src/game/bots/controller.ts` exported type) | `{ attackCalls: Record<string, number> /* per target entity id: number of `body.attackTarget(id)` calls whose `AttackResult` is exactly "hit" (the engine call was reached, S3 §1.2 step 9) */; guardRejects: number /* results "invalid", "out_of_reach", "no_los" and "cooldown" (S3 §1.2 steps 1-8 that return before the engine call) */; shieldUpTicks: number /* total game ticks (not necessarily consecutive) during which `shieldState() === "up"`; at each pump whose end state is "up" the controller adds the ticks elapsed since its previous pump */; eats: number; escapes: number; dismisses: number; summons: number /* completed summon/rejoin spawns */; excludedDropped: number /* excluded items dropped on the ground by a dismiss or escape, counted in items (S4b §12, H6) */; decisions: Partial<Record<OptionKind, number>>; tactics: TacticName[] /* unique, order of first use */ }`. Counted in the controller's wrapper around `attackTarget`; `escapes`, `dismisses`, `summons` and `excludedDropped` are incremented by `src/game/snapshot/service.ts` (the boundaries test allows that file to name `combatDebug`). Keyed by bot **name** (entity ids change on rejoin). Cleared by `testReset()`. |
| C5 | `test/support/p3-fakes.ts` | Created by the contract writer exactly as specified in §3.2. Builders import it and never edit it. |
| C6 | `test/boundaries-p3.test.ts` and `test/branch-ledger.test.ts` | Created by the contract writer exactly as specified in §4.3 and §3.4. Builders never edit them. |
| C7 | Ownership additions (skeleton §6 does not list these) | B5 also owns the edit of `src/probes/index.ts` (§1.6) and `src/probes/combat/names.ts`, `verdicts.ts`, `fixtures.ts`. B3 also owns `src/gametests/combat-helpers.ts` (new), the one-line import in `src/gametests/index.ts`, `scripts/make-structure.mjs` (new structures, §2.3) and `test/structures-p3.test.ts`. **Default if the contract writer does not decide otherwise:** B3 owns `src/gametests/snapshot.ts` too (the two snapshot GameTests); B4 may instead own it if the contract writer prefers. |
| C8 | Mechanical edits allowed to B3 | Adding `pause`/`resume` to fake executors in existing tests (`test/support/fake-world.ts`, `test/runtime*.test.ts`, `test/gather-executor.test.ts`) so they typecheck. No behavioural edits to old tests. |

---

## 1. Probes

### 1.1 What is being probed and why

All 15 probes from API-MAP "Needs in-game probe" (P1–P15; P15 `light` is added by D18) are implemented as `/colony:probe <name>` subcommands next to the four Phase 1 probes (`spawn chat chunks reload`, unchanged). Probes test **raw engine mechanisms**: they do not import `src/game` or `src/core` (same as Phase 1). They run on the player's real world (**cheats OFF, Beta APIs ON**), so they only use APIs that work without cheats.

### 1.2 Priorities and names

| Pri | API-MAP id | Command | File (`src/probes/combat/`) | Export | Decides |
|---|---|---|---|---|---|
| **P0** | P4 | `/colony:probe disconnect` | `disconnect.ts` | `disconnectProbe` | whether items drop on `disconnect()`; keeps clear-before-disconnect honest; escape/dismiss/summon safety |
| **P0** | P5 | `/colony:probe invchange` | `invchange.ts` | `invchangeProbe` | event-driven vs timer-only snapshot writes |
| **P0** | P3 | `/colony:probe attack` | `attack.ts` | `attackProbe` | `attackEntity` vs `attack()`, reach, min interval, crit |
| **P0** | P1 | `/colony:probe shield` | `shield.ts` | `shieldProbe` | shield mode A/B/off |
| **P0** | P2 | `/colony:probe eating` | `eating.ts` | `eatingProbe` | `useItemInSlot` eating, ticks, interrupt safety |
| P1 | P9 | `/colony:probe namereuse` | `namereuse.ts` | `namereuseProbe` | same-name respawn delay and in-memory stacks. **Blocks every snapshot flow**: run it right after the P0 set |
| P1 | P10 | `/colony:probe movement` | `movement.ts` | `movementProbe` | strafe / back-off / look tracking / drop |
| P1 | P6 | `/colony:probe sneak` | `sneak.ts` | `sneakProbe` | `isSneaking` and `isSprinting` writes |
| P1 | P8 | `/colony:probe target` | `target.ts` | `targetProbe` | `Entity.target` usability |
| P1 | P7 | `/colony:probe creeper` | `creeper.ts` | `creeperProbe` | `mob_hissing` source |
| P1 | P12 | `/colony:probe propsize` | `propsize.ts` | `propsizeProbe` | dynamic-property chunk size |
| P2 | P11 | `/colony:probe hunger` | `hunger.ts` | `hungerProbe` | hunger components on bots, effect duration semantics |
| P2 | P13 | `/colony:probe lifecycle` | `lifecycle.ts` | `lifecycleProbe` | lifecycle events, Save & Quit before-leave bonus |
| P2 | P14 | `/colony:probe shielddisabled` | `shielddisabled.ts` | `shielddisabledProbe` | `bot_shield_disabled` signal |
| P1 | P15 | `/colony:probe light` | `light.ts` | `lightProbe` | light and daylight semantics for spider neutrality (D18). **Run it in daylight** (time of day 0..11999) |

Shared files in `src/probes/combat/` (B5):
- `names.ts` — **pure**, no `@minecraft` import: `export const COMBAT_PROBE_NAMES = ["disconnect", "invchange", "attack", "shield", "eating", "namereuse", "movement", "sneak", "target", "creeper", "propsize", "hunger", "lifecycle", "shielddisabled", "light"] as const; export type CombatProbeName = (typeof COMBAT_PROBE_NAMES)[number];` (table order above; `light` is last) and `export const COMBAT_PROBES: readonly { name: CombatProbeName; priority: 0 | 1 | 2; apiMapId: string }[]` with the priorities and ids of the table. Unit-tested and read by `test/playtest-doc.test.ts`.
- `verdicts.ts` — **pure**, no `@minecraft` import, no import of `util.ts`: `export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE"; export interface Judgement { verdict: Verdict; summary: string }`, exactly these 15 judges (each takes the `*Measure` of the same probe, all exported from `verdicts.ts`; types in the block below; inputs and rules in §1.5): `judgeDisconnect(DisconnectMeasure)`, `judgeInvChange(InvChangeMeasure)`, `judgeAttack(AttackMeasure)`, `judgeShield(ShieldMeasure)`, `judgeEating(EatMeasure)`, `judgeNameReuse(NameReuseMeasure)`, `judgeMovement(MovementMeasure)`, `judgeSneak(SneakMeasure)`, `judgeTarget(TargetMeasure)`, `judgeCreeper(CreeperMeasure)`, `judgePropSize(PropSizeMeasure)`, `judgeHunger(HungerMeasure)`, `judgeLifecycle(LifecycleMeasure)`, `judgeShieldDisabled(ShieldDisabledMeasure)`, `judgeLight(LightMeasure)`; each returns `Judgement`. Math helpers: `median(xs: number[]): number | undefined`, `angleBetweenDeg(a: { x: number; z: number }, b: { x: number; z: number }): number` (horizontal angle between two vectors, degrees, 0..180), `minGap(ticks: number[]): number | undefined`. Every judge is table-tested (§3).
- `fixtures.ts` — engine code shared by the probes (§1.3).
- `index.ts` — `export const COMBAT_PROBE_RUNNERS: Record<CombatProbeName, (player: Player) => Promise<void>>`.

**Measure types (exact, in `verdicts.ts`).** The probe fills these plain objects; `judge*` reads nothing else.
```ts
export interface DisconnectMeasure { botSpawned: boolean; fixtureOk: boolean; noClear: { marked: number; labels: string[]; dropEvents: number }; cleared: { marked: number } }
export type InvChangeStep = "scriptSet" | "engineMove" | "drop" | "pickup" | "eat";
export interface InvChangeMeasure { steps: Record<InvChangeStep, { executed: boolean; fired: boolean; count: number }>; others: number }
export interface ReachRow { dist: number; calls: number; trues: number; hurts: number }
export interface AttackMeasure {
  reach: ReachRow[]; behindHurts: number;
  cooldown: { calls: number; trues: number; hurts: number; minTrueGap?: number; minHurtGap?: number; medianDamage?: number };  // medianDamage = median over all landed S2 hits
  crit: { samples: number; median?: number }; lookAttack: { trues: number; hurts: number; median?: number }; hitEventFires: boolean;
}
export interface ShieldMode { hits: number; hurtsDamaging: number; sneakEvents: number; firstBlockedTick?: number; useReturns?: boolean[] }
export interface ShieldMeasure { control: ShieldMode; sneak: ShieldMode; hotbar: ShieldMode; botDied: boolean }
export interface EatRun { returned: boolean; startEvent: boolean; completeEvent: boolean; stopEvent: boolean; amountBefore: number; amountAfter: number; hungerBefore: number; hungerAfter: number; saturationBefore: number; saturationAfter: number; ticksToConsume?: number }
export interface EatMeasure { componentsOk: boolean; full: EatRun; interrupt: EatRun; fromInventory: EatRun }
export interface NameTrial { delay: number; spawnOk: boolean; unique: boolean; newId: boolean; dataIntact: boolean; error?: string }
export interface NameReuseMeasure { baseline: boolean; trials: NameTrial[] }
export interface MovementMeasure {
  instantLookErrDeg: number; continuousMeanErrDeg: number;
  strafeDist5: number; strafeDist20: number; strafeDist40: number; strafeLookErrDeg: number; strafeLeftSign: 1 | -1; strafeStopTicks: number;
  backoffGain: number;
  dropOk: boolean; dropEntities: number; dropAmount: number; dropOriginalAmount: number; repickedWithin60: boolean;
}
export interface SneakMeasure { initial: boolean; readbackAfter: boolean; startEvent: boolean; dSneak: number; dWalk: number; dSprint: number; sprintReadback: boolean }
export interface TargetRow { samples: number; targetIsBot: number; targetDefined: number; threw: number; approaching: boolean }
export interface TargetMeasure { melee: TargetRow; ranged: TargetRow; passive: TargetRow }
export interface CreeperMeasure {
  spawned: boolean;
  forced: { preIgnited: number; ignitedTrueTicks: number; endedInExplosion: boolean; eventIds: string[] };
  natural?: { ignitedTrueTicks: number; hissed: boolean };
  chargedReadable?: boolean;
}
export interface PropSizeMeasure { rows: { n: number; setOk: boolean; equal: boolean; error?: string }[]; multi: { keys: number; setOk: boolean; equal: boolean; totalBytes?: number } }
export interface HungerReading { hunger: number; saturation: number; exhaustion: number }
export interface HungerMeasure {
  present: { hunger: boolean; saturation: boolean; exhaustion: boolean };
  initial: HungerReading; after: HungerReading; blocksRun: number;
  poison: { applied: boolean; d0?: number; d20?: number; d40?: number };
  air: { tried: boolean; present: boolean; series: number[]; totalSupply?: number };      // H4, §1.5
}
export interface LifecycleMeasure {
  spawn: { playerSpawn: boolean; initialSpawnTrue: boolean; playerJoin: boolean };
  respawn: { playerSpawn: boolean; initialSpawnFalse: boolean };
  leave: { afterLeave: boolean; beforeLeave: boolean; beforeWriteOk: boolean };
}
export interface ShieldDisabledMeasure { executed: boolean; readings: { category: string; max: number }[]; componentMax: number; unblockedWhileReadingPositive: number; blockedBeforeFirstReading: number; unblockedAfterFirstBlocked: number }
export interface LightMeasure {
  timeOfDay: number;                 // world.getTimeOfDay(), 0..23999
  lightFeet?: number; skyFeet?: number; readError?: string;      // bot feet cell
  spider?: { spawned: boolean; samples: number; lightAtSpider: number[]; targetIsBot: number; minDistance: number };
}
```

**Verdict convention for all 15 probes** (extends the Phase 1 meaning):
- **PASS** — the probed mechanism works as API-MAP assumes. The summary prints ` | SET key=value` tokens to apply; they may equal the current defaults or be tuned numbers.
- **FAIL** — the mechanism does not work as assumed. The printed `SET` tokens select the fallback. The build is trusted only after those values are applied (the lead edits the config default) and the dependent GameTests are rerun.
- **INCONCLUSIVE** — the measurement was not valid (bot died, mob did not spawn, preconditions failed, timeout, uncaught error). The summary says what to fix before rerunning. Never a silent pass.

**Printed line format** (identical to Phase 1; produced by `ProbeReport.end(verdict, summary)`):
```
[probe] <name>: RESULT <PASS|FAIL|INCONCLUSIVE> - <summary>
```
`<summary>` is one line: findings, then ` | SET <key>=<value>, <key>=<value>` when any config applies. Before that line the probe prints `r.fact(key, value)` pairs as one `[probe] <name>: facts: k=v  k=v` line. Examples:
```
[probe] shield: RESULT PASS - sneak+offhand blocked 9/10 hits (control 0/10); raise delay ~5 ticks | SET body.shieldMethod=sneak, body.shieldRaiseTicks=5
[probe] shield: RESULT FAIL - sneak+offhand blocked 1/10 (control 0/10), hotbar use blocked 9/10 | SET body.shieldMethod=use_item
[probe] disconnect: RESULT INCONCLUSIVE - husk fixture could not spawn: <error>
```

### 1.3 Common probe rules (every combat probe; B5 implements once in `fixtures.ts`)

1. Signature `export async function <name>Probe(player: Player): Promise<void>`. First line `const r = new ProbeReport("<name>")`. All output through `ProbeReport` (`note`, `fact`, `end`). `end` is called exactly once on every path.
2. **Preflight** `combatPreflight(player, r): boolean`; on failure it calls `r.end("INCONCLUSIVE", reason)` and the probe returns:
   - the player is in the overworld, not in water;
   - flat patch: sampling every 3 blocks in a 21×21 square centred on the player, at least 80 % of cells have a solid block below the feet cell and 3 air blocks above (reason: `stand on open flat ground (21x21)`);
   - `world.getDifficulty() !== Difficulty.Peaceful` (reason: `set difficulty to Normal`); the difficulty is printed as a fact;
   - no foreign hostile mob within 24 blocks: `getEntities({ families: ["monster"], location, maxDistance: 24 })` is empty (reason: `n hostile mobs nearby, clear them or move`);
   - no other combat probe is running (global mutex in `src/probes/index.ts`, §1.6).
3. **Bots**: names `Probe-<tick % 100000>` (second bot `Probe2-…`), spawned with the existing `spawnBotNear(player, name, dx, dz)` and `waitOnGround`. A bot name is ≤ 16 chars.
4. **Cleanup** (always, in `finally`): `safeDisconnect` every bot; `fixtureRemove` every fixture mob and every item entity the probe created; restore any game rule changed; run via a `Cleanup` list in `fixtures.ts`. A probe leaves nothing behind.
5. **Hard deadline** per probe (listed in §1.5): when exceeded, `r.end("INCONCLUSIVE", "timeout after N ticks at step <label>")`.
6. **Fixture mobs**: `PROBE_MELEE_MOB = "minecraft:husk"` (does not burn in daylight), `PROBE_RANGED_MOB = "minecraft:skeleton"` with a `fire_resistance` effect (burns otherwise). Never `zombie` in probes.
7. **Fixture API allowance (TEST/PROBE-ONLY).** These APIs are forbidden for gameplay; probes and GameTests may use them for setup only, and only inside `fixtures.ts` (probes) or `combat-helpers.ts` (GameTests), in functions named `fixture*` / `testOnly*`:

| Fixture API (all verified in d.ts) | Wrapper name | Use |
|---|---|---|
| `Dimension.spawnEntity` S:8901 | `fixtureSpawnMob(dim, typeId, loc)` | spawn husk/skeleton/creeper/cow/… |
| `Entity.teleport` S:10624 + `Entity.clearVelocity` S:9921 | `fixtureHoldMob(mob, loc)` | hold a mob at a measured spot each tick |
| `Entity.remove` S:10367 / `Entity.kill` S:10296 | `fixtureRemove(e)` | cleanup |
| `Entity.triggerEvent` S:10668 | `fixtureTrigger(e, eventId)` | creeper `minecraft:start_exploding_forced` (d.ts example) |
| `Entity.addEffect` S:9714 | `fixtureEffect(e, id, ticks)` | `fire_resistance` on skeletons |
| `Container.setItem` S:7439 + `new ItemStack` S:16142 | `fixtureGive(bot, slot, typeId, amount, opts?)` | give marked items to a probe bot |
| `EntityEquippableComponent.setEquipment` S:11347 | `fixtureEquip(bot, slot, itemOrUndefined)` | offhand / armour fixtures |
| `EntityAttributeComponent.setCurrentValue` S:10854 | `fixtureSetHealth(bot, hp)`, `fixtureSetFood(bot, hunger, saturation)` | top-up HP; set hunger |

   Each API above is listed in API-MAP section I (Fixture-only); `src/probes/**` and `src/gametests/**` are the only places the boundaries test allows them. `Entity.setOnFire` S:10519 (`fixtureSetOnFire(e, seconds)`) is also fixture-only (used by GameTests, §2.1). Every other API used by a probe is either the API under test or a read-only query listed in API-MAP.
8. **Event taps**: `EventTap` in `fixtures.ts` subscribes, collects `{ tick, kind, … }` records and unsubscribes on `stop()` (always called in `finally`). Subscribe only to after-events. Filter by entity **id**, never by display name alone.
9. Sampling uses `waitUntil`/`sleep` from `util.ts` (ticks), never wall-clock.
10. A bot death during a probe is `INCONCLUSIVE` unless the probe says otherwise (creeper).
11. Unit-testability: probes are not unit-tested (they call the engine). Their **verdict logic** is: the probe collects a plain `<Name>Measure` object and calls `judge<Name>`; nothing else decides PASS/FAIL.

### 1.4 Probe → code path → config switch

✔S3 = the key exists in S3 §7 with this name and default. *new* = added by the contract writer (S6-proposed; S1/S2/S4 may rename, the contract writer then renames here). "Default" is what the code assumes before the probe runs. Tokens are printed as `SET <group>.<key>=<value>`.

| Probe | Code that depends on it | Config key (default) | Result → `SET` |
|---|---|---|---|
| shield | `body/shield.ts`, brain `shield` option, atom `bot_has_shield`, tactics `shield_hold`, `shield_advance_zigzag` | `body.shieldMethod` ✔S3 (`"sneak"`), `body.shieldEnabled` ✔S3 (true), `body.shieldRaiseTicks` ✔S3 (5) | sneak blocks → `shieldMethod=sneak`, `shieldRaiseTicks=<measured>`; only hotbar blocks → FAIL `shieldMethod=use_item`; neither → FAIL `shieldEnabled=false` |
| eating | `body/eating.ts`, brain `eat` option | `body.eatEnabled` ✔S3 (true), `body.eatTicksByType` ✔S3 (keys are prefixed typeIds, e.g. `minecraft:cooked_beef`) | consumed → PASS (`eatTicksByType.minecraft:<id>=<n>` only if n ≠ 32); not consumed → FAIL `eatEnabled=false` (`Player.eatItem` stays unselectable without player approval) |
| attack | `body/melee.ts`, `attackTarget` in `adapter/body.ts` | `body.attackIntervalTicks` ✔S3 (10), `body.meleeReach` ✔S3 (3.0; never raised above 3.0), `body.critEnabled` ✔S3 (true), `body.attackMode` *new* (`"attack_entity"`) | PASS `attackIntervalTicks=<n>`, `critEnabled=<bool>`; FAIL `attackMode=look_attack` (S3 §6: `lookAtEntity(Instant)` + `attack()` inside `attackTarget`, same checks); FAIL `attackMode=off` (brain never picks `attack`) |
| disconnect | `snapshot/service.ts` dismiss/escape/summon flows | `snapshot.dropsOnDisconnect` *new* (info, true), `snapshot.enabled` *new* (true) | PASS prints the observed fact; FAIL `snapshot.enabled=false`: `!dismiss`, escape and idle-dismiss are refused with a chat notice. Clear-before-disconnect stays mandatory in every case |
| invchange | `snapshot/service.ts` dirty marking | `snapshot.inventoryEvent` *new* (`"all"`); the always-active fallback timer is `snapshot.fallbackIntervalTicks` (100, S4a) and the normal interval is `snapshot.intervalTicks` (200, D6) | FAIL `inventoryEvent=partial|off` (S4a then uses `min(intervalTicks, fallbackIntervalTicks)`; the service also marks dirty on its own writes in every case) |
| namereuse | escape/summon/dismiss rejoin | `snapshot.respawnDelayTicks` *new* (2), `snapshot.sameNameRespawn` *new* (true), `snapshot.inSessionStacks` *new* (true) | larger delay (smallest delay from which every longer delay also works); or `sameNameRespawn=false` (escape is refused, `requestEscape` false; other flows wait for a free name); or `inSessionStacks=false` (never keep `HeldStacks`; the codec is used, excluded stacks are lost) |
| movement | `body/tactics.ts` strafe/back-off, look tracking, haul drop | `body.relativeMoveMethod` ✔S3 (`"relative"`), `body.strafeLeftSign` ✔S3 (1), `body.dropEnabled` *new* (true) | PASS `strafeLeftSign=<±1>`; FAIL `relativeMoveMethod=move_to`; drop broken → `dropEnabled=false` |
| sneak | `body/shield.ts` method `sneak`, tactic `flee_sneak` | `body.sneakEnabled` ✔S3 (true), `body.sprintEnabled` *new* (true) | FAIL `sneakEnabled=false` (then `shieldMethod` must be `use_item`) and/or `sprintEnabled=false` |
| target | `bots/sensor.ts` `mob_aggroed_on_bot` | `combat.useTargetApi` *new* (true) | FAIL `useTargetApi=false` (the proxy always runs regardless) |
| creeper | `bots/sensor.ts` atom `mob_hissing` | `body.hissProxyEnabled` ✔S3 (true: proxy `dist < hissProxyDist`) | PASS `hissProxyEnabled=false` (component is used); FAIL `hissProxyEnabled=true` (event ids, if any, are printed as a fact only; TODO(phase-5)) |
| propsize | `snapshot/store.ts` chunking | `snapshot.chunkChars` *new* (30000), `snapshot.maxTotalChars` *new* (600000) | smaller chunk; lower total cap |
| hunger | `bots/sensor.ts` hunger/saturation/effects; drowning reflex air reading | `combat.effectDurationCountsDown` *new* (true) | components missing → FAIL, no key (the adapter reports `undefined` and the S1 sensor defaults to `hunger = 20`, `saturation = 5`); `effectDurationCountsDown=false`: remaining poison time = initial duration − ticks since `effectAdd`. Air supply unusable → FAIL, no key (S1 uses the `inWater` fallback, D20) |
| lifecycle | `snapshot/service.ts` rejoin detection | `snapshot.rejoinDetect` *new* (`"events"`) | FAIL `rejoinDetect=poll`: poll `world.getPlayers({ name })` every 2 ticks |
| shielddisabled | atom `bot_shield_disabled` (S1 reads it) | `combat.shieldDisabledSource` *new* (`"inferred"`), `combat.shieldCooldownCategory` *new* (`""`), `body.shieldDisableTicks` *new* (100) | PASS `shieldDisabledSource=cooldown_api`, category, ticks; FAIL keeps `inferred` (assume disabled for `shieldDisableTicks` after an axe hit) |
| light | `core/combat/sense.ts` `classify` (spiders), `bots/sensor.ts` `lightAt` / `isDaylight` | `combat.spiderNeutralLight` ✔S1 (12; S1 §10) | PASS `spiderNeutralLight=12`; FAIL `spiderNeutralLight=16` (spiders never neutral: 16 is above the maximum light 15) or `=<measured light>`; a light query that throws → FAIL with no key (`lightLevel` stays `undefined`, spiders are treated as hostile) |

### 1.5 The 15 probes (steps, measure, verdict)

Common to all: `combatPreflight` first; deadline stated per probe; cleanup per §1.3. "Tick 0" is the tick the step starts. `bot` is the probe bot, `front(bot, d)` is `bot.location + horizontal view direction × d` at the bot's feet height.

#### P0-a `disconnect` (API-MAP P4) — deadline 400 ticks
**Setup.** Spawn bot A (`Probe-…`) two blocks east, wait on ground (≤ 60). `fixtureGive` marked items, every `nameTag = "probe-<tick>-<label>"`: hotbar slot 0 `minecraft:diamond_sword`; slot 1 `minecraft:cobblestone` ×5; main slot 10 `minecraft:apple` ×3; `fixtureEquip` Head `iron_helmet`, Offhand `shield`. That is 5 marked stacks (sword, cobblestone, apples, helmet, shield); label each (`sword`, `cobble`, `apple`, `helmet`, `shield`) and use `hotbar` / `inventory` / `equipment` as the group in `labels`.
**Variant X (no clear).** Count baseline `minecraft:item` entities within 6 blocks of the bot (`n0`). Subscribe an `EventTap` to `entityItemDrop` (no filter). Call `bot.disconnect()` (no `clearAll`, no equipment clear). At +1, +5, +20, +60 ticks count `minecraft:item` entities within 6 blocks of the old location whose `item.itemStack.nameTag` starts with `probe-` (`markedX[t]`); record which labels dropped (hotbar / inventory / equipment). Then `fixtureRemove` every such item entity.
**Variant Y (cleared first).** Spawn bot B with the same fixtures. `container.clearAll()`; `setEquipment(slot, undefined)` for Head/Chest/Legs/Feet/Offhand; then `disconnect()`. Count marked item entities at +1, +20 ticks (`markedY`). Remove them.
**Measure (`DisconnectMeasure`).** `{ botSpawned, fixtureOk, noClear: { marked: number /* max over checks */, labels: string[], dropEvents: number }, cleared: { marked: number } }`.
**Verdict (`judgeDisconnect`).**
- `!botSpawned || !fixtureOk` → INCONCLUSIVE `fixture/bot failed: <step>`.
- `cleared.marked > 0` → **FAIL** `items still drop after clearAll+equipment clear; clear-before-disconnect is not sufficient` `| SET snapshot.enabled=false`.
- `noClear.marked ≥ 1` → **PASS** `items DROP on disconnect (<labels>); clear-before-disconnect is mandatory (build does it) | SET snapshot.dropsOnDisconnect=true`.
- `noClear.marked == 0` → **PASS** `items do NOT drop on disconnect (they vanish); serialize-before-disconnect is mandatory | SET snapshot.dropsOnDisconnect=false`.
**Fallback.** `snapshot.enabled=false` only if FAIL. Clear before disconnect stays mandatory in both PASS cases.

#### P0-b `invchange` (API-MAP P5) — deadline 500 ticks
**Setup.** One bot, grounded, flat ground. `EventTap` on `world.afterEvents.playerInventoryItemChange` with **no options**. Record `{ tick, step, playerId, slot, inventoryType, before: typeId×amount, after: typeId×amount }`; keep only events whose `player.id === bot.id` (count the rest as `others`).
**Steps** (each followed by a 20-tick window; label the active step):
1. `scriptSet`: `container.setItem(3, new ItemStack("minecraft:cobblestone", 5))`.
2. `engineMove`: `container.swapItems(3, 4, container)`.
3. `drop`: `bot.selectedSlotIndex = 4; bot.dropSelectedItem()`; require return `true` and a `minecraft:item` entity within 4 blocks within 10 ticks (else `executed=false`).
4. `pickup`: wait 60 ticks (pickup delay), then `bot.navigateToLocation(item.location)`; window 80 ticks; executed iff the dropped item entity is gone and the bot's cobblestone count is back to 5.
5. `eat`: `fixtureGive(slot 0, cooked_beef ×2)`, `fixtureSetFood(bot, 10, 0)`, `bot.selectedSlotIndex = 0`, `bot.useItemInSlot(0)`; window 80 ticks; executed iff the stack amount dropped by 1.
**Measure (`InvChangeMeasure`).** `{ steps: Record<"scriptSet"|"engineMove"|"drop"|"pickup"|"eat", { executed: boolean; fired: boolean; count: number }>, others: number }`.
**Verdict (`judgeInvChange`).** Cargo steps are `drop`, `pickup`, `eat` (the ones that change cargo during play).
- any cargo step `executed=false` → INCONCLUSIVE `step <label> did not execute`.
- all three `fired` → **PASS** `events fire for drop/pickup/eat (script set: <y/n>, engine move: <y/n>) | SET snapshot.inventoryEvent=all`.
- none fired → **FAIL** `no inventory events for bots | SET snapshot.inventoryEvent=off`.
- otherwise → **FAIL** `partial: fired for <list> | SET snapshot.inventoryEvent=partial`.
Note for the summary: the service always marks dirty on its own writes regardless of the result.

#### P0-c `attack` (API-MAP P3) — deadline 900 ticks
**Setup.** One bot; `fixtureGive(slot 0, iron_sword)`, `selectedSlotIndex = 0`; `fixtureSetHealth(bot, 20)` every 20 ticks. Target `husk` (`fixtureSpawnMob`), held each tick with `fixtureHoldMob(husk, front(bot, D))` (the husk's own AI may hit the bot; that is fine). Replace the husk with a fresh one whenever its HP < 7. `EventTap`: `entityHurt` (record `{tick, hurtEntity.id, damage, damagingEntity?.id}`), `entityHitEntity`.
**Stages.**
- S1 reach: `D ∈ {2, 3, 4, 6, 10}`; per D, 30 ticks; each tick `bot.lookAtEntity(husk, LookDuration.Instant)` every 5 ticks and `bot.attackEntity(husk)` every tick. Row: `{ dist, calls, trues, hurts /* entityHurt on husk caused by bot */ }`.
- S1b behind: husk held at 2 blocks **behind** the bot (opposite the view direction), no look; 30 ticks of `attackEntity`; fact `behindHurts`.
- S2 cooldown: D = 2, 100 ticks of `attackEntity` every tick. Record `trueTicks`, `hurtTicks`, per-hit `damage`. `minTrueGap = minGap(trueTicks)`, `minHurtGap = minGap(hurtTicks)`, `medianDamage = median(damages)`.
- S3 crit: D = 2; 5 jumps: `bot.jump()`, then each tick while `!isOnGround && getVelocity().y < 0` call `attackEntity` once; take the damage of that hit; `critMedian`.
- S4 look-attack: `lookAtEntity(husk, Instant)` then `bot.attack()` every tick for 60 ticks at D = 2 and again at D = 3.5. Row `{ trues, hurts, medianDamage }`.
**Measure (`AttackMeasure`).** `{ reach: ReachRow[], behindHurts, cooldown: { calls, trues, hurts, minTrueGap?, minHurtGap?, medianDamage? }, crit: { samples, median? }, lookAttack: { trues, hurts, median? }, hitEventFires: boolean }`.
**Verdict (`judgeAttack`).**
- `reach` row D=2 has `hurts ≥ 1` (attackEntity lands):
  - median damage over all landed S2 hits `< 5.5` → INCONCLUSIVE `median damage <x> < 5.5: is the iron sword held in slot 0?`
  - else **PASS** `attackEntity lands to D<=<maxLandedD>; hurt gap <g> ticks; dmg <m>; crit x<r>; behind=<n> hurts; API reach not enforced: <y/n> | SET body.attackIntervalTicks=<clamp(minHurtGap ?? 10, 5, 20)>, body.critEnabled=<crit median / base median ≥ 1.3>`.
- else `lookAttack.hurts ≥ 1` → **FAIL** `attackEntity never damaged the husk, look+attack() did | SET body.attackMode=look_attack, body.attackIntervalTicks=<…>`.
- else if `reach[D=2].calls == 0` or no husk ever alive → INCONCLUSIVE.
- else **FAIL** `no attack API landed damage | SET body.attackMode=off`.
**Always true regardless of the result:** the adapter enforces reach ≤ 3 (eye to AABB) and line of sight (API-MAP C table); the probe only records what the API does on its own.

#### P0-d `shield` (API-MAP P1) — deadline 1000 ticks
**Setup.** One bot. `fixtureGive`: slot 0 `iron_sword` (selected), slot 1 `shield`; `fixtureEquip(Offhand, shield)` (for modes control and A). `fixtureSetHealth(bot, 20)` between modes. Attacker `husk` (`fixtureSpawnMob`) held in front: at each mode start and every 10 ticks if `dist(husk, bot) > 2.2` call `fixtureHoldMob(husk, front(bot, 1.6))` and `bot.lookAtEntity(husk, LookDuration.Instant)`. The bot never moves. `EventTap`: `entityHitEntity`, `entityHurt`, `entityStartSneaking`.
**Modes, in this order, 200 ticks each, 40 ticks between (stop mode, `isSneaking=false`, `stopUsingItem()`, heal, new husk):**
1. `control`: offhand shield, not sneaking.
2. `sneak` (A): offhand shield; at tick 0 set `bot.isSneaking = true`; re-assert every 20 ticks (count readbacks that were `false`).
3. `hotbar` (B): `fixtureEquip(Offhand, undefined)`; `bot.selectedSlotIndex = 1`; `bot.useItemInSlot(1)` at tick 0, re-issued every 40 ticks (count calls and returns).
**Per mode** (only events involving this mode's husk id and the bot): `hits` = `entityHitEntity` husk→bot; `hurtsDamaging` = `entityHurt` on bot from the husk with `damage > 0` within 1 tick of a hit; `blocked = hits − hurtsDamaging`; `ratio = blocked / hits`; `sneakEvents`; `firstBlockedTick` (ticks from mode start to the first blocked hit = raise delay).
**Measure (`ShieldMeasure`).** `{ control: ShieldMode, sneak: ShieldMode, hotbar: ShieldMode, botDied: boolean }` with `ShieldMode = { hits, hurtsDamaging, sneakEvents, firstBlockedTick?, useReturns?: boolean[] }`.
**Verdict (`judgeShield`).** `works(m) = m.hits ≥ 4 && blocked/hits ≥ 0.8`; `measured(m) = m.hits ≥ 4`.
- `botDied` → INCONCLUSIVE.
- `!measured(control)` → INCONCLUSIVE `attacker landed <4 hits in the control mode`.
- `control.blocked/hits > 0.25` → INCONCLUSIVE `control mode already "blocks": measurement invalid`.
- `works(sneak)` → **PASS** `sneak+offhand blocked <b>/<h> (control <cb>/<ch>); raise delay ~<d> ticks | SET body.shieldMethod=sneak, body.shieldRaiseTicks=<d or 5>`. Also store `world.setDynamicProperty("colony:probe_shield_mode", "sneak")` (read by `shielddisabled`).
- `works(hotbar)` (sneak does not) → **FAIL** `sneak+offhand blocked <b>/<h>, hotbar use blocked <b2>/<h2> | SET body.shieldMethod=use_item`; store property `use_item`.
- `measured(sneak) && measured(hotbar)` and neither works → **FAIL** `no shield mode blocks | SET body.shieldEnabled=false`.
- otherwise → INCONCLUSIVE `mode <x> not measured`.

#### P0-e `eating` (API-MAP P2) — deadline 500 ticks
**Setup.** One bot, no mobs. `EventTap`: `itemStartUse`, `itemCompleteUse`, `itemStopUse` (filter `source.id`). Each run: `fixtureSetFood(bot, 10, 0)`; read `player.hunger`/`player.saturation` components via `getComponent` (missing → `componentsOk=false`).
**Runs** (sample every tick, 80 ticks; stop early once the stack amount drops):
- `full`: slot 0 `cooked_beef` ×2, `selectedSlotIndex = 0`, `ok = bot.useItemInSlot(0)`. Record per tick `hunger`, `saturation`, slot-0 amount; event ticks with `useDuration`. After the run call `stopUsingItem()` and record its return (`undefined` expected).
- `interrupt` (20 ticks after `full`): reset food; same, but `bot.stopUsingItem()` at tick 10. Run to tick 60. Record amount/hunger change.
- `fromInventory` (20 ticks later): slot 0 emptied, `cooked_beef` ×2 in main slot 12, selected slot 0, `bot.useItemInSlot(12)` (no select).
**Measure (`EatMeasure`).** `{ componentsOk, full: EatRun, interrupt: EatRun, fromInventory: EatRun }` with `EatRun = { returned: boolean, startEvent, completeEvent, stopEvent, amountBefore, amountAfter, hungerBefore, hungerAfter, saturationBefore, saturationAfter, ticksToConsume?: number }`.
**Verdict (`judgeEating`).** `consumed(run) = run.returned && run.amountBefore − run.amountAfter === 1 && run.hungerAfter > run.hungerBefore`.
- `!componentsOk` → INCONCLUSIVE `hunger components missing on the bot (run the hunger probe)`.
- `!full.returned` → **FAIL** `useItemInSlot returned false | SET body.eatEnabled=false`.
- `!consumed(full)` → **FAIL** `item not consumed / hunger unchanged within 80 ticks | SET body.eatEnabled=false`.
- `full.ticksToConsume > 60` → INCONCLUSIVE `eating took <n> ticks (expected ~32)`.
- else **PASS** `eat takes <n> ticks, consumes 1, hunger +<h>; interrupt safe: <y/n>; works from inventory slot: <y/n> | SET body.eatTicksByType.minecraft:cooked_beef=<n> (only if n ≠ 32)`. (`interruptSafe = !consumed(interrupt) && interrupt.amountAfter === interrupt.amountBefore`.)

#### P1-a `namereuse` (API-MAP P9) — deadline 600 ticks
**Setup.** For each delay `w ∈ {1, 2, 5, 20}` one trial with its own name `Probe-<tick%100000>w<w>` (≤ 16 chars): spawn bot, `fixtureGive` slot 0 a `diamond_sword` with `nameTag = "probe-n"`, durability `damage = 50`, enchantment `sharpness` III (via `enchantable.addEnchantment`); keep `held = container.getItem(0)` (the `ItemStack` object) and `oldId`. `disconnect()`. After exactly `w` ticks, `spawnSimulatedPlayer` the **same name** at the same spot (top-level, `spawnBotNear` semantics). Wait on ground (≤ 40). `container.setItem(0, held)`; read slot 0 back.
**Checks per trial.** `spawnOk` (no throw), `unique` (`world.getPlayers({ name })` length 1), `newId` (`bot.id !== oldId`), `dataIntact` (typeId, amount, nameTag, `durability.damage`, enchantment id+level equal). `error` string if thrown.
**Measure.** `{ baseline: boolean, trials: NameTrial[] }`, `NameTrial = { delay, spawnOk, unique, newId, dataIntact, error? }`.
**Verdict (`judgeNameReuse`).** The delays are tested independently, so a short delay can pass while a longer one fails; the result therefore uses the first delay **from which every longer delay also works**.
- `ok(t) = t.spawnOk && t.unique`; `okFrom` = the smallest `w` in `{1, 2, 5, 20}` such that every trial with `delay >= w` is `ok` (undefined when the `w=20` trial is not `ok`).
- `!baseline` (first spawn or fixture failed) → INCONCLUSIVE.
- `okFrom` undefined → **FAIL** `same name cannot be reused reliably (ok for delays <list or none>; <first error>) | SET snapshot.sameNameRespawn=false`.
- some trial with `delay >= okFrom` is `ok` but `!dataIntact` → **FAIL** `in-memory ItemStack lost data | SET snapshot.inSessionStacks=false`.
- `okFrom <= 2` → **PASS** `same-name respawn works from 2 ticks after disconnect on (new id: <y/n>); in-memory stack intact | SET snapshot.respawnDelayTicks=2` (never below the default 2, even if `w=1` works).
- `okFrom > 2` → **FAIL** `needs <okFrom> ticks | SET snapshot.respawnDelayTicks=<okFrom>`.

#### P1-b `movement` (API-MAP P10) — deadline 600 ticks
**Setup.** One bot, flat ground with ≥ 15 clear blocks ahead. `fixtureGive(slot 0, cobblestone ×16)`. A `husk` for tracking (held by `fixtureHoldMob`), its HP topped is irrelevant.
**Steps.**
- M1 look, instant control: husk held at 6 blocks, moved around the bot on a circle (radius 6, +6° per tick) for 40 ticks while the bot calls `lookAtEntity(husk, Instant)` **once** at tick 0. `instantLookErrDeg` = angle between bot view direction and direction to husk at tick 40.
- M2 look, continuous: same circle, `lookAtEntity(husk, Continuous)` once at tick 0. `continuousMeanErrDeg` = mean error over ticks 10..40.
- M3 strafe: husk fixed at 6 blocks ahead, `lookAtEntity(husk, Continuous)` once, then `bot.moveRelative(1, 0)` once. Positions at ticks 5, 20, 40 → `strafeDist5/20/40` (horizontal distance from start); `strafeLookErrDeg` at tick 40; `strafeLeftSign` = `+1` if `moveRelative(+1, 0)` moved the bot to its **left**, else `-1` (with `view` = horizontal view direction at the start and `disp` = displacement at tick 20: left iff `view.x*disp.z − view.z*disp.x < 0`; x east, z south). Then `stopMoving()`; `strafeStopTicks` = ticks until speed < 0.05.
- M4 back-off: `moveRelative(0, -1)` once, 20 ticks → `backoffGain` (distance gained from husk).
- M5 drop: `selectedSlotIndex = slot of cobblestone`; `dropOk = bot.dropSelectedItem()`; after 5 ticks count item entities within 3 blocks (`dropEntities`) and sum amounts (`dropAmount`) vs original 16 (`dropOriginalAmount`); wait 60 ticks standing still: `repickedWithin60`.
**Measure (`MovementMeasure`, exact type in §1.2).** Derived values used by the verdict: `dropReturned = dropOk && dropEntities >= 1 && dropAmount >= 1`; the drop is reported as "whole stack" when `dropAmount === dropOriginalAmount`, else "one item".
**Verdict (`judgeMovement`).** `lookTracks = continuousMeanErrDeg ≤ 20`; `strafeKeepsLook = strafeLookErrDeg ≤ 25`; `strafePersists = strafeDist40 ≥ 6 && (strafeDist40 − strafeDist20) ≥ 2`.
- `instantLookErrDeg > 45` (the bot never turns) → **FAIL** `lookAtEntity does not turn the bot (err <e> deg); shield/strafe direction unreliable, report to the lead` (no `SET`).
- `strafeDist40 < 1` → **FAIL** `moveRelative does not move the bot | SET body.relativeMoveMethod=move_to`.
- `strafeKeepsLook && strafePersists && dropReturned` → **PASS** `strafe persists (<d> blocks in 40 ticks) and keeps the look (err <e> deg); continuous look err <c> deg; drop: <whole stack / one item> | SET body.strafeLeftSign=<±1>`. (`lookTracks` is informational: S3 runners re-issue the look every pump.)
- else **FAIL** with the matching tokens: `!strafeKeepsLook || !strafePersists` → `body.relativeMoveMethod=move_to, body.strafeLeftSign=<±1>`; `!dropReturned` → `body.dropEnabled=false`.

#### P1-c `sneak` (API-MAP P6) — deadline 400 ticks
**Setup.** One bot, flat ground, ≥ 15 clear blocks ahead; bot looks along it (`lookAtLocation`, `Instant`). `EventTap`: `entityStartSneaking`, `entityStopSneaking`.
**Steps.**
- Q1 read `isSneaking` (expected `false`) → `initial`. Set `bot.isSneaking = true`; read back after 1 and 2 ticks (`readbackAfter` = true if either is true). Record `startEvent`.
- Q2 speed: `moveRelative(0, 1)` for 40 ticks with sneak on → `dSneak`; stop, sneak off, wait 10; 40 ticks → `dWalk`; stop; `bot.isSprinting = true`, 40 ticks → `dSprint`; read `isSprinting` after 10 ticks → `sprintReadback`.
**Verdict (`judgeSneak`).** `initial === true` → INCONCLUSIVE `bot started sneaking`. `dWalk < 4` → INCONCLUSIVE `bot barely moved`. `sneakOk = readbackAfter && (startEvent || dSneak/dWalk ≤ 0.6)`. `sprintOk = sprintReadback && dSprint/dWalk ≥ 1.1`.
- both ok → **PASS** `sneak x<r> speed, event <y/n>; sprint x<s> | SET body.sneakEnabled=true, body.sprintEnabled=true`.
- `!sneakOk` → **FAIL** `isSneaking write ignored | SET body.sneakEnabled=false` (then `body.shieldMethod` must be `use_item`); `!sprintOk` → add `body.sprintEnabled=false` (both tokens if both).

#### P1-d `target` (API-MAP P8) — deadline 400 ticks
**Setup.** One bot, still. Fixtures: `husk` at 12 blocks, `skeleton` (+`fire_resistance`) at 14 blocks, `cow` at 6 blocks, all left to their own AI. `fixtureSetHealth(bot, 20)` every 20 ticks.
**Sampling.** Every 20 ticks for 200 ticks and for each mob: `distance`; `target` read in `try` (count `threw`); `target?.id === bot.id`. `approaching` for husk = distance decreased by ≥ 4 over the run.
**Measure.** `{ melee: Row, ranged: Row, passive: Row }`, `Row = { samples, targetIsBot, targetDefined, threw, approaching }`.
**Verdict (`judgeTarget`).**
- melee `samples − threw == 0` and `approaching` → **FAIL** `Entity.target throws | SET combat.useTargetApi=false`.
- `!melee.approaching` → INCONCLUSIVE `husk never approached`.
- `melee.targetIsBot / melee.samples ≥ 0.8 && passive.targetDefined == 0 && ranged.targetIsBot / ranged.samples ≥ 0.5` → **PASS** `target reports the bot for husk <a>%, skeleton <b>%; cow never | SET` (none).
- `melee.targetIsBot == 0` → **FAIL** `target never set for a chasing husk | SET combat.useTargetApi=false`.
- else INCONCLUSIVE `partial: husk <a>%, skeleton <b>%, cow defined <c>`.

#### P1-e `creeper` (API-MAP P7) — deadline 400 ticks
**Setup.** One bot. `EventTap` on `world.afterEvents.dataDrivenEntityTrigger` with `{ entityTypes: ["minecraft:creeper"] }`: record `eventId` and `addedComponentGroups`/`removedComponentGroups` of `getModifiers()`. Each tick for the watched creeper: `hasComponent("minecraft:is_ignited")`, `hasComponent("minecraft:is_charged")`, distance.
**Run A (forced).** Bot stands still. `fixtureSpawnMob(creeper)` 12 blocks away. Sample 20 ticks (`preIgnited` = ticks with `is_ignited` true before the trigger; must be 0). `fixtureTrigger(creeper, "minecraft:start_exploding_forced")`. Sample until the creeper entity is invalid (explosion) or 60 ticks: `ignitedTrueTicks`, `endedInExplosion`, `eventIds` (unique ids seen).
**Run B (natural, optional, skipped if A did not explode).** New creeper 14 blocks away, left to its AI; bot still. At the first tick with `distance < 3.0` record `proxyTick`, then `bot.moveToLocation(away 20 blocks)` with `isSprinting = true`; sample until distance > 12 or 80 ticks. Record `ignitedTrueTicks`, `exploded`, bot HP lost (bot death is acceptable here).
**Charged (info).** New creeper; try `fixtureTrigger(c, "minecraft:become_charged")`; `chargedReadable = hasComponent("minecraft:is_charged")`; if still false try spawn id `"minecraft:creeper<minecraft:become_charged>"`. Info only.
**Measure.** `{ spawned, forced: { preIgnited, ignitedTrueTicks, endedInExplosion, eventIds: string[] }, natural?: { ignitedTrueTicks, hissed /* distance<3 happened */ }, chargedReadable?: boolean }`.
**Verdict (`judgeCreeper`).**
- `!spawned` or `!forced.endedInExplosion` → INCONCLUSIVE `creeper did not fuse/explode`.
- `forced.preIgnited == 0 && forced.ignitedTrueTicks ≥ 5` and (`natural` undefined or `!natural.hissed` or `natural.ignitedTrueTicks ≥ 5`) → **PASS** `is_ignited true for <n> ticks of the fuse, never before | SET body.hissProxyEnabled=false`.
- `forced.eventIds.length ≥ 1` (component unusable) → **FAIL** `is_ignited unusable; dataDrivenEntityTrigger ids seen: <ids> | SET body.hissProxyEnabled=true` (the ids are printed as a fact for a later phase).
- else **FAIL** `no usable ignition signal | SET body.hissProxyEnabled=true`.

#### P1-f `propsize` (API-MAP P12) — deadline 200 ticks
**Setup.** Key `colony:probe_size`, deterministic string `"abcdefghij".repeat(n/10)` (n multiple of 10). Sizes `n ∈ {1000, 10000, 30000, 31000, 32760, 32770, 40000, 65530, 100000}`. For each: `world.setDynamicProperty(key, s)` in `try` (`setOk`, `error`), read back (`equal` = length and content equal). Then multi-key: 20 keys `colony:probe_size_<i>` × 30000 chars; `setOk`/`equal` for all; read `world.getDynamicPropertyTotalByteCount()`. Finally delete every probe key with `setDynamicProperty(key, undefined)`. **Never** `clearDynamicProperties()`.
**Measure.** `{ rows: { n, setOk, equal, error? }[], multi: { keys, setOk, equal, totalBytes? } }`.
**Verdict (`judgePropSize`).** `maxOk` = the largest size from the tested list (`1000, 10000, 30000, 31000, 32760, 32770, 40000, 65530, 100000`) with `setOk && equal`.
- `maxOk < 1000` → **FAIL** `dynamic properties unusable | SET snapshot.enabled=false`.
- `!multi.setOk || !multi.equal` → **FAIL** `20 x 30000 chars rejected/corrupt | SET snapshot.maxTotalChars=<observed total chars>`.
- `maxOk ≥ 30000` → **PASS** `<maxOk> chars per key round-trip; 600000 total ok | SET snapshot.chunkChars=30000` (keep the default even if larger works).
- else (1000 ≤ maxOk < 30000) → **FAIL** `limit ~<maxOk> | SET snapshot.chunkChars=<Math.max(1000, Math.floor(0.9 * maxOk / 1000) * 1000)>` (never below 1000: a 0 would loop the chunker forever).

#### P2-a `hunger` (API-MAP P11) — deadline 1300 ticks
**Setup.** One bot, flat ground with space to run back and forth between two points 12 blocks apart.
**Steps.** H1 read `player.hunger`, `player.saturation`, `player.exhaustion` via `getComponent` (presence, `currentValue`). H2 sprint: `isSprinting = true`, `navigateToLocation` back and forth for 400 ticks; read the three values every 20 ticks. H3 poison: `fixtureSpawnMob(cave_spider)` held adjacent (`fixtureHoldMob`, 1.5 blocks) with `fixtureSetHealth(bot, 20)` each 20 ticks; wait until `getEffects()` contains `typeId === "minecraft:poison"` (≤ 200 ticks), then log its `duration` at `t0`, `t0+20`, `t0+40`; remove the spider. H4 air supply (the drowning reflex depends on `EntityBreathableComponent`, D20): optional, runs only when water at least 3 blocks deep exists within 24 blocks of the bot (search every 3 blocks in a 49×49 square at the bot's y and 3 below with the block read the preflight already uses; water = `minecraft:water` with the cell 2 above also water; none found → `air.tried = false`). Walk into it with `navigateToLocation` (≤ 200 ticks). Then every 20 ticks, for 10 samples (stop early when the bot is out of the water or `airSupply <= 60`), read `getComponent("minecraft:breathable")`: push `airSupply` (S:10890) to `series` and remember `totalSupply` (S:10955); `fixtureSetHealth(bot, 20)` each sample. Finally `navigateToLocation` to the nearest dry cell and wait on ground (≤ 100 ticks). A missing component sets `air.present = false`.
**Measure (`HungerMeasure`, exact type in §1.2).**
**Verdict (`judgeHunger`).** `airOk = air.present && air.series.length >= 5 && series never increases from one sample to the next && series[last] < series[0] && series[0] <= air.totalSupply`.
- any `present` false → **FAIL** `components missing: <list>; the adapter reports undefined and the sensor defaults to hunger=20, saturation=5 | SET` (no key).
- `blocksRun ≥ 40` and none of `after.hunger < initial.hunger`, `after.saturation < initial.saturation`, `after.exhaustion > initial.exhaustion` → **FAIL** `values never change while sprinting; hunger is not simulated for bots | SET` (no key; same adapter fallback, and the brain must not rely on hunger changing).
- `!poison.applied` → INCONCLUSIVE `cave spider did not poison (Normal poison lasts about 7 s; check that the spider's hit landed)`.
- `d20 > d0 − 10` → **FAIL** `poison duration constant | SET combat.effectDurationCountsDown=false`.
- `air.tried && !airOk` → **FAIL** `air supply unusable (component <y/n>, series <list>); the drowning reflex uses the inWater fallback | SET` (no key).
- else **PASS** `hunger/saturation/exhaustion readable and moving; poison duration counts down (<d0> -> <d20>); air supply <first> -> <last> of <total> (or: air not measured: no water within 24 blocks) | SET` (none).

#### P2-b `lifecycle` (API-MAP P13) — deadline 600 ticks; two stages
**Stage 1 (immediate).** `EventTap`: `playerSpawn` (record `initialSpawn`), `playerJoin`, `playerLeave` (after), and a `world.beforeEvents.playerLeave` subscription whose callback only records `{ tick, player.name }` and tries `world.setDynamicProperty("colony:probe_lifecycle_leave", "<name>@<tick>")` inside `try` (restricted mode; report whether it threw). Sequence: spawn bot → wait 40 → `bot.kill()` (fixture) → wait for death, then `bot.respawn()` → wait 40 → `bot.disconnect()` → wait 40. Record events per phase.
**Stage 2 (after Save & Quit).** If the player runs `/colony:probe lifecycle` in a **new script session** (detected as in `reload.ts`: stored session token differs) and the stored `colony:probe_lifecycle_leave` value exists, print fact `beforeLeaveOnQuit=<value>`; that means the before-event fired and the write persisted. Stage 2 never changes the verdict; it prints `[probe] lifecycle: RESULT INCONCLUSIVE - stage 2 info only: beforeLeaveOnQuit=<yes/no>`. (Procedure in PLAYTEST: spawn a bot, run the probe, Save & Quit, reopen, run the probe again.)
**Measure.** `{ spawn: { playerSpawn, initialSpawnTrue, playerJoin }, respawn: { playerSpawn, initialSpawnFalse }, leave: { afterLeave, beforeLeave, beforeWriteOk } }`.
**Verdict (`judgeLifecycle`).** Default `snapshot.rejoinDetect = events` needs `spawn.playerSpawn` and `leave.afterLeave`.
- both true → **PASS** `playerSpawn(initial=<y>)/join/leave fire for bots; respawn spawn event <y/n>; before-leave <y/n> (write ok <y/n>) | SET` (none).
- else **FAIL** `<missing list> | SET snapshot.rejoinDetect=poll`.

#### P2-c `shielddisabled` (API-MAP P14) — deadline 700 ticks
**Setup.** One bot with iron sword (slot 0) and shield. Read `colony:probe_shield_mode` (set by the `shield` probe; default `sneak`): apply the same shield mode as in P0-d. Attacker `vindicator` (`fixtureSpawnMob`), held at `front(bot, 1.8)` like in the shield probe; `fixtureSetHealth(bot, 20)` every 20 ticks.
**Sampling each tick for 400 ticks.** `bot.getItemCooldown(c)` for `c ∈ ["shield", "minecraft:shield"]` (each in `try`); the shield `ItemStack`'s `getComponent("minecraft:cooldown")` → `cooldownCategory`, `cooldownTicks`, `getCooldownTicksRemaining(bot)`. Hits/hurts as in the shield probe, each tagged with the current max cooldown reading (>0 or not).
**Measure.** `{ executed: boolean /* ≥1 vindicator hit seen */, readings: { category: string, max: number }[], componentMax: number, unblockedWhileReadingPositive: number, blockedBeforeFirstReading: number, unblockedAfterFirstBlocked: number }`.
**Verdict (`judgeShieldDisabled`).**
- `!executed` → INCONCLUSIVE `vindicator never hit the shield`.
- any reading `max > 0` or `componentMax > 0` → **PASS** `shield cooldown visible via <category>, max <m> ticks | SET combat.shieldDisabledSource=cooldown_api, combat.shieldCooldownCategory=<category>, body.shieldDisableTicks=<m>`.
- `blockedBeforeFirstReading ≥ 1 && unblockedAfterFirstBlocked ≥ 1` (it stopped blocking but no reading) → **FAIL** `shield disabled but no cooldown signal | SET combat.shieldDisabledSource=inferred`.
- else INCONCLUSIVE `shield was never disabled`.

#### P1-g `light` (API-MAP P15, D18) — deadline 400 ticks
**Why.** S1 classifies a spider as `neutral_unprovoked` only when `isDaylight && lightLevel >= combat.spiderNeutralLight` (12) and the spider is unprovoked; otherwise `threat`. The probe checks what `Dimension.getLightLevel` / `getSkyLightLevel` return and that an unprovoked spider in daylight really ignores the bot. **Run it in daylight, outdoors, on open ground.**
**Setup.** One bot, still; `fixtureSetHealth(bot, 20)` every 20 ticks. `timeOfDay = world.getTimeOfDay()` (0..23999); day means `timeOfDay < 12000`.
**Steps.**
- L1 read `dimension.getLightLevel(feetCell)` and `dimension.getSkyLightLevel(feetCell)` for the bot's feet cell (`lightFeet`, `skyFeet`); a throw goes to `readError` (message) and the probe skips L2.
- L2 (day only): `fixtureSpawnMob(spider)` 10 blocks away on open ground, left to its own AI; the bot never attacks it. Every 20 ticks for 200 ticks (10 samples): `lightAtSpider` = `getLightLevel` of the spider's feet cell (in `try`; skip the sample on a throw), `target?.id === bot.id` (in `try`; a throw counts as not targeting) and the distance (`minDistance` = smallest value seen). Remove the spider.
**Measure (`LightMeasure`, exact type in §1.2).**
**Verdict (`judgeLight`).** `isDay = timeOfDay < 12000`; `engaged = spider.targetIsBot / spider.samples >= 0.5 || spider.minDistance <= 2.5`; `minLight = min(spider.lightAtSpider)`.
- `readError !== undefined || lightFeet === undefined` → **FAIL** `light query failed: <error>; spiders are treated as hostile (unknown light) | SET` (no key).
- `!isDay` → INCONCLUSIVE `night: light <lightFeet> (sky <skyFeet>) at time <timeOfDay>; <if lightFeet >= 12: getLightLevel ignores the time of day, so the isDaylight guard is required (implemented, D18)>; rerun in daylight (time 0..11999)`.
- `spider` undefined, `!spider.spawned`, `spider.samples < 8` or `lightAtSpider` empty → INCONCLUSIVE `spider fixture failed`.
- `!engaged && minLight >= 12` → **PASS** `daylight light <lightFeet> (spider feet min <minLight>) >= 12; unprovoked spider ignored the bot (targeted <a>%) | SET combat.spiderNeutralLight=12`.
- `engaged && minLight >= 12` → **FAIL** `spider hostile in daylight at light <minLight> >= 12: the neutrality rule is wrong | SET combat.spiderNeutralLight=16`.
- `!engaged && minLight < 12` → **FAIL** `spider neutral in daylight at light <minLight> < 12 | SET combat.spiderNeutralLight=<minLight>`.
- `engaged && minLight < 12` → **PASS** `spider hostile at light <minLight> < 12 as assumed (daylight) | SET combat.spiderNeutralLight=12`.

### 1.6 Registration changes in `src/probes/index.ts` (B5 owns this edit; nothing else in the file changes)
1. Imports: `COMBAT_PROBE_NAMES` from `./combat/names.js`, `COMBAT_PROBE_RUNNERS` from `./combat/index.js`.
2. `const BASE_PROBES = ["spawn", "chat", "chunks", "reload"] as const; const PROBES = [...BASE_PROBES, ...COMBAT_PROBE_NAMES] as const;` — the enum registered with `registerEnum(ENUM_NAME, [...PROBES])` therefore has 19 values. Probe names are letters-only so they are valid enum values.
3. `runProbe`: for a combat name, `const player = invoker ?? first non-simulated player`; if none: `log("<name>: RESULT INCONCLUSIVE - needs a real player in the world to run near")`. A module-level `let combatRunning: string | undefined` is the mutex: if set, `log("<name>: already running - wait for the <other> RESULT line")`. Set it before starting, clear it in `done`/`fail`. Then `COMBAT_PROBE_RUNNERS[name](player).then(done, fail)`.
4. `description` of the command: `Run a colony probe: spawn, chat, chunks, reload, or a combat probe (disconnect invchange attack shield eating namereuse movement sneak target creeper propsize hunger lifecycle shielddisabled light)`.
5. Unknown-name error message lists `PROBES.join(", ")` as today. `startupProbe` is unchanged and must still print PASS.

### 1.7 Player run order (for PLAYTEST)
P0 set, one at a time, in this order: `disconnect`, `invchange`, `attack`, `shield`, `eating` (≈ 6 min). Then `namereuse`, then P1 (`movement`, `sneak`, `target`, `creeper`, `propsize`, and `light` in daylight), then P2 (`hunger`, `lifecycle`, `shielddisabled`). The player pastes every `RESULT` line back verbatim.

---

## 2. GameTests

### 2.1 Common contract
- Run on a **dev world with cheats ON, Beta APIs ON, flat, no bots**: `/gametest runset colony` (all) or `/gametest run colony:<name>`. These are separate from the cheats-OFF play world.
- Registration style = Phase 2 `reg()`: `registerAsync("colony", name, body).structureName(…).maxTicks(…).setupTicks(5).padding(4).batch("colony_<name>").required(true).tag("colony")`, wrapped in `try/catch`. Class `colony`; names below are the test names (`colony:<name>`).
- Files: `src/gametests/combat.ts` (combat, defend, reflex and Phase 3 stack tests), `src/gametests/snapshot.ts` (the two snapshot tests), `src/gametests/combat-helpers.ts` (helpers). `src/gametests/index.ts` gets two import lines (`import "./combat.js"; import "./snapshot.js";`). `src/gametests/helpers.ts` is **not edited**; new tests import from it: `beginTest, spawnBot, botName, waitFor, waitGrounded, floorY, absCell, sender, runtime, view, snapStr, hasReply, repliesStr, placeChest, chestCount, chestStr, COOLDOWN`.
- Bots come from the **top-level** spawn (`spawnBot(test, "toplevel", rel, name)`); the bot is `rt.adoptBot(bot, bot.name)`. Fake senders as in Phase 2 (`sender("S", absCell(…))`); S5 makes `!home set`, `!summon`, `!defend` use `Sender.pos`, so fake senders suffice. Ownerless bots are claimed by the first command.
- **TEST-ONLY world setup** (`enterCombatEnv(test, opts?)` in `combat-helpers.ts`; restores everything in `test.runOnFinish`): first read the previous values of `doMobSpawning`, `mobGriefing` and the difficulty; then set `world.gameRules.doMobSpawning = false`; `world.setDifficulty(Difficulty.Normal)`; `world.gameRules.mobGriefing = false` iff `opts.noGriefing`. `runOnFinish` writes back exactly the values read before (not defaults). Also `test.runOnFinish(() => test.killAllEntities())` and every block cell changed through `testOnlySetBlock` is set back to `minecraft:air`. Difficulty is Normal in every test: a zombie hit is 3 HP (Easy 2, Hard 4).
- **TEST-ONLY gear/state** (all in `combat-helpers.ts`, every function name starts `testOnly`): `testOnlyKit(bot, kit)` with kits `"iron_full"` (slot 0 `iron_sword`, Offhand `shield`, Head/Chest/Legs/Feet iron armour) and `"bare"`; `testOnlyGive(bot, slot, typeId, amount, opts?: { nameTag?, damage?, enchants?: [id, level][] })`; `testOnlySetHealth(bot, hp)`; `testOnlySetFood(bot, hunger, saturation)`; `testOnlyTame(wolf, owner)`; `testOnlySetBlock(test, rel, typeId)` (wraps `GameTest.Test.setBlockType`, G:2085; records the cell so `enterCombatEnv` restores it to air); `testOnlySetOnFire(bot, seconds)` (wraps `Entity.setOnFire`, S:10519); `testOnlyAirSupply(bot): number | undefined` (reads `getComponent("minecraft:breathable")?.airSupply`); `testOnlyFillChest(test, rel, items: [typeId, amount][])` (fills the chest placed by `placeChest`). `testOnlyKit` and `testOnlyGive` give every stack the `nameTag` `gt-<label>` (label = kit slot name or `opts.nameTag` when given) so tests can tell kit items from world drops. Items are never given any other way and never after the bot is adopted unless a test says so.
- **TEST-ONLY mobs**: `testOnlySpawn(test, typeId, rel)` wraps `test.spawn`.
- **Observability** (no engine reads beyond these):
  - `snapshot().bots[i]` → `.presence` (`live | leaving | rejoining | dismissed`), `.task`, `.progress`, `.combat` (`BotStatusView`, S5's shape per D25: `layer`, `option`, `target?.typeId`, `hp`, `maxHp`, `hunger`, `recovering`, `gear {weaponTypeId?, armorPieces, hasShield, foodCount}`; it has no timestamp, and the runtime pushes it only when a field changed, so after a layer change the new value is the one read). Helper `viewByName(name)` (ids change on rejoin).
  - `rt.combatDebug(name)` (C4).
  - Engine-side facts: `world.getPlayers({ name })`, the bot's `health` component, container/equipment via `fingerprint(bot)`, `minecraft:item` entity counts, and a `HitLedger`.
- `HitLedger` (in `combat-helpers.ts`): `start()` subscribes `world.afterEvents.entityHitEntity` and `entityHurt`; `stop()` unsubscribes (also in `runOnFinish`); `hits(attackerId, victimId?)`, `hurts(attackerId, victimId?)`, `firstHitTick(attackerId, victimId?)`. All keyed by entity id.
- `fingerprint(bot, skipSlots?: number[]): string` — canonical, order-stable (container slots listed in `skipSlots` are left out): for slots 0..35 `"<slot>:<typeId>x<amount>|nt=<nameTag or ->|dmg=<durability.damage or 0>|en=<sorted id:level list>|lore=<lore joined />"` for non-empty slots; then `"eq:<Head|Chest|Legs|Feet|Offhand>:…"` in the same format; then `"sel=<selectedSlotIndex>"`. **Mainhand is not included** (it aliases the hotbar).
- `mobAlive(e)` = `e.isValid && health.currentValue > 0` in `try`. `botHp(bot)`.
- `floorY(test, 1, 1)` (not the default `(8, 8)`, which is out of bounds in `corridor`) finds the floor in every Phase 3 structure.
- Each test starts with `rt.testReset()` then `beginTest(test)`; each ends with `test.succeed()` / `test.fail(msg)` where `msg` always includes `snapStr()`, bot HP, and `combatDebug`.
- **Priority:** ★ = must pass before the build is trusted.

### 2.2 Pass/fail summary

| Test | Priority | Structure | maxTicks |
|---|---|---|---|
| `combat_zombie_win` | ★ | `colony:arena` | 1200 |
| `combat_skeleton_shield` | | `colony:arena` | 1500 |
| `combat_creeper_survive` | | `colony:arena` | 1200 |
| `combat_never_hits_player` | ★ | `colony:corridor` | 800 |
| `combat_ignores_tamed_wolf` | | `colony:arena` | 1200 |
| `combat_harvester_resumes` | ★ | `colony:grove_roofed` | 5200 |
| `combat_retreat_eat` | | `colony:arena` | 1000 |
| `snapshot_dismiss_summon_conserves` | ★ | `colony:flat` | 800 |
| `snapshot_escape_rejoin` | ★ | `colony:grove_roofed` | 4200 |
| `defend_patrol_kills` | | `colony:arena_gap` | 1800 |
| `defend_protects_player` | | `colony:arena` | 1500 |
| `p3_gather_under_stack` | ★ | `colony:grove_roofed` | 5200 |
| `p3_never_attack_friendlies` | ★ | `colony:arena` | 1200 |
| `p3_haul_cargo_escape` | | `colony:grove_roofed` | 3200 |
| `p3_escape_owner_feet` | | `colony:arena` | 1500 |
| `p3_recover_after_combat` | | `colony:grove_roofed` | 5200 |
| `p3_idle_far_threat` | | `colony:arena` | 1500 |
| `p3_reflex_lava` | | `colony:arena` | 600 |
| `p3_reflex_drown` | | `colony:arena` | 900 |
| `p3_reflex_fire` | | `colony:arena` | 600 |
| `p3_equip_from_chest` | | `colony:arena` | 600 |

21 Phase 3 tests (11 original + 10 added in the revision pass: the completeness findings and D16); 7 are ★. The 8 Phase 2 GameTests (`chest_set`, `gather_logs`, `gather_two_bots`, `gather_cobble_craft`, `gather_no_source`, `goto_flat`, `goto_unreachable`, `override_flow`) are not listed here; §2.6 makes them a regression gate.

### 2.3 New structures (`scripts/make-structure.mjs`, B3)

Append after the existing Phase 2 code; **do not change** the existing functions, palettes or the first four outputs. Their SHA-256 must stay exactly (a test pins them, §2.5):
```
flat.mcstructure    61c5351aae180d2b482d07dc4166f3d06db85f0a11e1acae7027b224ce8be21a
walled.mcstructure  a12dd1d07eb646a64a9829d95d45c23bc1a975032c02a6e682bd9df9db89e270
grove.mcstructure   57acb26a9ea0e9c63400ac09347a9a3878499cbaff6bddcd1d8464cf4ccc0743
quarry.mcstructure  75e9b9d0c269bbd16a9e88fa3b7a471e7b119b8868e688eaa2d3394e6ac71e0e
```
Use the existing `GATHER_PALETTE` (`0 air, 1 stone, 2 oak_log`) and the existing `structure([sx, sy, sz], palette, blockAt)` (index order `i = (x * sy + y) * sz + z`, handled by the function; do not reimplement). Add to `buildStructures()`:

```js
// ---- Phase 3 scenes (interior is dark and roofed: zombies/skeletons do not burn; mobs cannot leave)
export const ARENA_SIZE = [24, 8, 24];
function arena(x, y, z) {                       // colony:arena 24x8x24
  if (y === 0 || y === 7) return G_STONE;       // floor and roof
  const wall = x === 0 || x === 23 || z === 0 || z === 23;
  return wall ? G_STONE : G_AIR;                // interior x,z 1..22, y 1..6
}
export const ARENA_GAP = { wallX: 12, zMin: 11, zMax: 12, yMax: 2 };
function arenaGap(x, y, z) {                    // colony:arena_gap 24x8x24
  if (arena(x, y, z) === G_STONE) return G_STONE;
  if (x === ARENA_GAP.wallX) {                  // partition at x=12, y 1..6, z 1..22
    const inGap = z >= ARENA_GAP.zMin && z <= ARENA_GAP.zMax && y <= ARENA_GAP.yMax;
    return inGap ? G_AIR : G_STONE;             // 2 wide (z 11..12), 2 high (y 1..2) doorway
  }
  return G_AIR;
}
export const CORRIDOR = { x0: 1, x1: 18, z: 3 };
function corridor(x, y, z) {                    // colony:corridor 20x4x7
  if (y === 0 || y === 3) return G_STONE;
  return z === CORRIDOR.z && x >= CORRIDOR.x0 && x <= CORRIDOR.x1 ? G_AIR : G_STONE; // 1 wide, 2 high, x 1..18
}
function groveRoofed(x, y, z) {                 // colony:grove_roofed 16x9x16
  if (y === 0 || y === 8) return G_STONE;
  if (x === 0 || x === 15 || z === 0 || z === 15) return G_STONE;
  return grove(x, y, z);                        // existing: oak columns at GROVE_TREES, 4 high
}
// in buildStructures():
//   "arena.mcstructure":        structure([24, 8, 24], GATHER_PALETTE, arena),
//   "arena_gap.mcstructure":    structure([24, 8, 24], GATHER_PALETTE, arenaGap),
//   "corridor.mcstructure":     structure([20, 4, 7],  GATHER_PALETTE, corridor),
//   "grove_roofed.mcstructure": structure([16, 9, 16], GATHER_PALETTE, groveRoofed),
```
`scripts/build.mjs` already calls `makeStructures()`, so the new files land in `packs/BP/structures/colony/`. Floor is relative `y = 0` in every structure; feet cells are `y = 1`; `floorY(test, 1, 1)` returns 0 for all of them.

| Structure | Used by | Layout (relative cells; x east, z south) |
|---|---|---|
| `arena` | zombie_win, skeleton_shield, creeper_survive, ignores_tamed_wolf, retreat_eat, defend_protects_player, p3_never_attack_friendlies, p3_escape_owner_feet, p3_idle_far_threat, p3_reflex_lava, p3_reflex_drown, p3_reflex_fire, p3_equip_from_chest | closed roofed box, interior 22×22, 6 high |
| `arena_gap` | defend_patrol_kills | `arena` plus a partition at x = 12 with a 2-wide, 2-high doorway at z 11..12, y 1..2 |
| `corridor` | never_hits_player | 1-wide, 2-high tunnel along x 1..18 at z = 3, solid stone all around |
| `grove_roofed` | harvester_resumes, escape_rejoin, p3_gather_under_stack, p3_haul_cargo_escape, p3_recover_after_combat | grove (3 oak columns, 4 high) inside walls (x/z 0 and 15) and a roof at y = 8 |
| `flat` (existing) | dismiss_summon_conserves | open ground (no mobs needed) |

### 2.4 The tests

Common bot name: `botName("GC")`; bot facing is irrelevant. `kit` below always means `testOnlyKit(bot, "iron_full")` **before** `rt.adoptBot`. All distances use bot feet to mob feet. `Hz` = zombie. Positions are relative cells at feet height `y = 1` unless noted; use `absCell(test, rel)` for world coordinates.

#### `combat_zombie_win` ★ — structure `colony:arena`, maxTicks 1200
**Setup.** `enterCombatEnv`. Bot at (4,1,12) with kit, adopted. Zombie `testOnlySpawn("minecraft:zombie", (19,1,12))`. `HitLedger.start()`.
**Run.** Poll each tick: `mobAlive(zombie)`, `botHp(bot)`.
**Pass.** Zombie dead within 1200 ticks **and** bot valid with HP ≥ 8 **and** `ledger.hits(bot.id, zombie.id) ≥ 1` **and** `ledger.hits(bot.id)` (to any victim) equals the hits to the zombie (no other victim) **and**, within 100 ticks after the kill, `viewByName(bot).combat` is defined and its `layer !== "combat"` (the runtime pushes the status when the layer changes, so an undefined value or a still-`combat` value fails).
**Fail messages.** bot dead/invalid; zombie alive at limit (include distance and `combat.option`); bot HP < 8; hits on other victims.
**Cleanup.** `runOnFinish`: disconnect bot, `killAllEntities`, restore env.

#### `combat_skeleton_shield` — `colony:arena`, 1500
**Setup.** As above; bot at (3,1,12) with kit; skeleton `testOnlySpawn("minecraft:skeleton", (20,1,12))`.
**Skip rule.** If `config.body.shieldEnabled === false` (probe FAIL result applied): `test.print("shield mode off: shield assertions skipped")` and the shield assertion below is not applied (the kill/HP assertions still are).
**Pass.** Skeleton dead within 1500 ticks; bot HP ≥ 6; `combatDebug(bot).shieldUpTicks ≥ 10`; no hits to any victim other than the skeleton.

#### `combat_creeper_survive` — `colony:arena`, 1200 (`enterCombatEnv(test, { noGriefing: true })`)
**Setup.** Bot at (3,1,12) with kit; creeper at (20,1,12).
**Pass.** Within 1200 ticks the creeper is gone (killed or exploded) **and** the bot is valid with HP ≥ 8 at that moment. Print the tactics used (`combatDebug.tactics`). Fail if the bot dies or HP < 8, or the creeper is still alive at 1200 ticks (a bot that only runs forever fails).
Diagnostics: print minimum distance reached and whether a hit by the bot occurred (`entityHurt` on the creeper).

#### `combat_never_hits_player` ★ — `colony:corridor`, 800
**Setup.** Bot at (2,1,3) with kit, adopted. Decoy: top-level `spawnPlayerLike(test, rel, name, GameMode.Creative)` (helper) at (5,1,3) named `botName("GD")`, **not adopted** (a plain player to the colony). Creative: zombies ignore it and it takes no damage. Zombie at (17,1,3). `HitLedger.start()`.
**Phase A (ticks 0–300).** Every 20 ticks sample geometry `bot.x < decoy.x < zombie.x` (`geometryHeld`). Assert at every tick: `ledger.hits(bot.id, decoy.id) == 0` and `ledger.hurts(bot.id, decoy.id) == 0` and `(combatDebug(bot).attackCalls[decoy.id] ?? 0) == 0`. At tick 300 require `geometryHeld` in ≥ 80 % of the samples (else fail `setup: decoy no longer between bot and zombie`).
**Phase B (ticks 300–800).** `decoy.disconnect()`. Zombie must die within 400 ticks of that (positive control: the bot is alive and fights). The decoy assertions above stay active until it is disconnected.
**Pass.** Phase A and B assertions all hold. Print `guardRejects` (informational).

#### `combat_ignores_tamed_wolf` — `colony:arena`, 1200
**Setup.** Owner: top-level Creative sim `GT-Owner` at (2,1,16), not adopted. Wolf `testOnlySpawn("minecraft:wolf", (5,1,13))`, then `testOnlyTame(wolf, owner)` (`getComponent("minecraft:tameable").tame(owner)`; if it throws, `test.fail("setup: could not tame")`). Bot at (3,1,12) with kit. Zombie at (20,1,12).
**Pass.** Zombie dead within 900 ticks; `ledger.hits(bot.id, wolf.id) == 0`, `ledger.hits(bot.id, owner.id) == 0`, `attackCalls[wolf.id] ?? 0 == 0` (the wolf may die to the zombie; that does not fail the test).

#### `combat_harvester_resumes` ★ — `colony:grove_roofed`, 5200
**Setup.** As Phase 2 `setup()`: chest at (2,1,2) via `placeChest`; bot at (4,1,3) with kit (`iron_full`), adopted; sender at (3,1,2); `!chest set` verified; wait `COOLDOWN`; `!gather oak_log 8`. Record `taskId = view.task.id`.
**Trigger.** Poll until `progress.delivered + progress.held ≥ 2` (≤ 2500 ticks, else fail `setup: no progress`). Record `p0`. Spawn a zombie at the interior corner farthest from the bot among (13,1,13), (13,1,2), (2,1,13): choose by greatest distance, tie: first in the listed order; if the greatest distance is < 7, `test.fail("setup: bot too close to every corner")`. `HitLedger.start()`.
**Per-tick assertions after the trigger** (until the zombie is dead): `view.task` defined, `kind === "gather"`, `id === taskId`; `p(t) = delivered + held` never below the maximum seen so far.
**Pass (all).**
1. `layer === "combat"` or `combatDebug.decisions.attack ≥ 1` observed within 300 ticks of the trigger;
2. zombie dead within 600 ticks of the trigger; bot valid, HP > 0;
3. the per-tick assertions held;
4. after the kill the bot returns to the task: `waitAllIdle` within the remaining ticks; `chestCount(oak_log) ≥ 8`; a `Delivered` reply; **no** `Stopped gathering` reply (`hasReply`).
**Cleanup.** Standard + `!stop` from the sender.

#### `combat_retreat_eat` — `colony:arena`, 1000
**Setup.** Bot at (20,1,20) with kit plus `testOnlyGive(bot, 4, "minecraft:cooked_beef", 6)`; then `testOnlySetHealth(bot, 6)` and `testOnlySetFood(bot, 10, 0)` (all **before** `adoptBot`). Zombie at (3,1,3) (distance ≈ 24). `HitLedger.start()`.
**Run.** Each tick record the beef count in slot 4 and `dist(bot, zombie)`.
**Pass (all).** Beef count drops by ≥ 1 (a meal was eaten); at the tick the count first dropped, `dist ≥ 6`; the tick of the first bot→zombie hit (`ledger.firstHitTick`) is **after** the tick the first meal completed (or no hit happened before the meal); the zombie is dead within 1000 ticks; the bot is valid.
**Fail messages.** no eating; ate only with the zombie < 6 away; engaged before eating.

#### `snapshot_dismiss_summon_conserves` ★ — `colony:flat`, 800 (file `src/gametests/snapshot.ts`)
**Setup.** Bot at (4,1,4) named `botName("GS")`. TEST-ONLY items (before `adoptBot`): kit `iron_full` with the sword given `nameTag "gt-sword"`, durability `damage 40`, Sharpness III; 12 `oak_log` in slot 9; 3 `apple` in slot 20; 1 `minecraft:white_shulker_box` in slot 21 (an **excluded** item, S4a `excludedTypeReason`: it cannot be serialized, so a dismiss with no colony chest drops it on the ground); `selectedSlotIndex = 2`. `fp0 = fingerprint(bot, [21])` (slot 21 left out). Sender S at (6,1,4). Record the `presence` values seen from here on (poll each tick) into `presenceSeq`.
**Run.**
1. `!dismiss <botName>`. Wait ≤ 200 ticks until `getPlayers({ name }).length == 0` and `viewByName(name)?.presence === "dismissed"` (budget about 30 ticks: 1 pump + drop + the 20-tick gone wait).
2. Assert: exactly **one** `minecraft:item` entity of typeId `minecraft:white_shulker_box` within 12 blocks of the old position (the real drop) and no other `minecraft:item` entity from this bot; exactly zero players with that name; 40 ticks later still none (no auto-respawn).
3. Move the sender to (10,1,10) (`sender` with new pos) and `!summon <botName>`. Wait ≤ 300 ticks until exactly one player with that name exists, `isOnGround`, and `presence === "live"` (budget about 8 ticks).
4. `fp1 = fingerprint(newBot, [21])`; slot 21 of the new bot is empty.
5. Wait `COOLDOWN`, send `!summon <botName>` again; wait 60 ticks (the core sees a live bot and issues a goto, so this proves no duplicate body; the exactly-once restore itself is the service unit case U2, §3.1 TC-B4.6).
**Pass (all).** `fp1 === fp0`; new bot within 3 blocks of (10,1,10); exactly one player with that name after step 5 and `fingerprint(.., [21])` still `fp0`; exactly one shulker item entity still exists (no second shulker created) and no other `minecraft:item` entity from this bot; `combatDebug(name)`: `dismisses == 1`, `summons == 1`, `excludedDropped == 1`; `presenceSeq` contains `leaving`, `dismissed`, `rejoining`, `live` in this order (other values may repeat in between).
**Cleanup.** Disconnect any player with that name; `rt.testReset()` (clears roster and `colony:snap:` keys).

#### `snapshot_escape_rejoin` ★ — `colony:grove_roofed`, 4200 (`snapshot.ts`)
**Setup.** As `combat_harvester_resumes` (chest, bot with kit at (4,1,3), `!chest set`). Home: a second fake sender at (13,1,13) sends `!home set` (home = that block). Then S sends `!gather oak_log 12`. Constants at the top of the file: `ESCAPE_HP = 6`, `ESCAPE_EXTRA = { diamond: 8 }`; if S2's thresholds make this scenario not escape, S2 owns changing these constants (documented in the failure message). (HP 6, not lower: with the zombies 7-8 blocks away the bot cannot die before the escape commits.)
**Cargo (TEST-ONLY, before `adoptBot`).** `testOnlyGive(bot, 30, "minecraft:diamond", 8)` in addition to the kit (every stack carries a `gt-` nameTag, §2.1). Items are never given after adoption.
**Trigger.** Poll until `progress.delivered + progress.held ≥ 3` (≤ 2500 ticks). Let `c` = the bot's floored cell at the trigger tick. Zombie 1 goes to the first of `c+(7,0,0)`, `c+(-7,0,0)`, `c+(8,0,0)`, `c+(-8,0,0)`, zombie 2 to the first of `c+(0,0,7)`, `c+(0,0,-7)`, `c+(0,0,8)`, `c+(0,0,-8)` whose feet and head cells are air and lie inside the interior (x and z in 1..14); a missing cell → `test.fail("setup: no free cell for a zombie")`. Record `baseline` = ids of all `minecraft:item` entities at this tick. In the same tick: `testOnlySetHealth(bot, ESCAPE_HP)` and spawn the zombies. From the trigger on, each tick record `fingerprintLast = fingerprint(bot)` while the bot is valid, and `escapes0 = combatDebug(name).escapes`.
**Run.** Wait until `getPlayers({ name }).length == 0` (the bot left; ≤ 400 ticks, else fail `no escape`), then until a player with that name exists again, grounded, with a non-empty inventory (≤ 600 ticks). `fp1 = fingerprint(newBot)` at the **first** tick it is grounded and holds items.
**Pass (all).** `fp1 === fingerprintLast` (identical items and equipment, including the diamonds and the logs held); the new bot is within 3 blocks of the home cell (13,1,13) (the spawn cell is (13.5, 1, 13.5), about 0.7 blocks away); `newBot.id !== oldId`; exactly one player with that name; no **new** `minecraft:item` entity (not in `baseline`) is a marked stack (nameTag starts `gt-`) and the new `oak_log` item entities number at most the `oak_log` item entities in `baseline` (a grove drops saplings, sticks and apples and zombies drop flesh, so a raw item count is not usable); `combatDebug(name).escapes - escapes0 == 1`; `presence` was `rejoining` with `view.task?.id === taskId` and then `live`, and `view.task?.id === taskId` right after the rejoin.
**Cleanup.** Standard; `testReset()`. The test does not wait for the task to continue (two zombies are hunting it).

#### `defend_patrol_kills` — `colony:arena_gap`, 1800
**Setup.** `enterCombatEnv`. Bot at (6,1,11) with kit, adopted. Sender S at (6,1,11) sends `!defend 8` (zone centre (6,1,11), radius 8 ⇒ covers the doorway at x = 12 and cells up to x = 14). A cow `testOnlySpawn("minecraft:cow", (8,1,5))` inside the zone. Zombie `testOnlySpawn(zombie, (20,1,11))` in the east half (outside the zone, behind the partition; it must come through the doorway). `HitLedger.start()`.
**Per-tick sample.** Bot horizontal distance from the zone centre `d`; track `maxD`.
**Pass (all).** Zombie dead within 1500 ticks; bot HP ≥ 8; `view.task.kind === "defend"` still (patrol continues, bot not idle); `maxD <= 8 + config.combat.defendLeashExtra` (= 12 blocks from the zone centre; radius 8, `defendLeashExtra` read from `config`, default 4); `ledger.hits(bot.id, cow.id) == 0`; then S sends `!stop`: the bot is idle within 100 ticks.

#### `defend_protects_player` — `colony:arena`, 1500
**Setup.** Protected player: top-level **Survival** sim `GT-Prot` at (12,1,12), not adopted, `testOnlySetHealth(prot, 20)`. Bot at (6,1,12) with kit, adopted. Sender S at (12,1,12) sends `!defend 10` (protect the player's spot). Zombie at (20,1,12) (nearest player to it is `GT-Prot`). `HitLedger.start()`.
Difficulty is Normal (`enterCombatEnv`): a zombie hit is 3 HP, so 2 hits (6 HP) is the allowed maximum and 14 is the threshold.
**Pass (all).** Zombie dead within 600 ticks; `botHp(prot) ≥ 14` at the moment of the kill; `ledger.hits(bot.id, prot.id) == 0`; bot valid.
**Fail.** The player lost more than 6 HP (the defender was too slow or did not engage).

#### `p3_gather_under_stack` ★ — `colony:grove_roofed`, 5200 (Phase 2 gather behaviour under the Phase 3 stack; D16)
**Setup.** `enterCombatEnv`. As `combat_harvester_resumes` (chest at (2,1,2), `!chest set`, sender at (3,1,2)), but the bot is armed with a **stone sword only**: `testOnlyGive(bot, 0, "minecraft:stone_sword", 1)`, no armour, no shield, adopted at (4,1,3). `!gather oak_log 8`; record `taskId`. `HitLedger.start()`.
**Trigger.** At tick 100 spawn one zombie at the interior corner farthest from the bot among (13,1,13), (13,1,2), (2,1,13) (same rule as `combat_harvester_resumes`); the distance must be ≥ 12, else `test.fail("setup: zombie closer than 12")`.
**Pass (all).** Zombie dead within 900 ticks of the spawn; bot valid; `chestCount(oak_log) ≥ 8` and a `Delivered` reply before maxTicks; no `Stopped gathering` reply; `view.task.id === taskId` at every sampled tick until delivery; no item lost: `chestCount(oak_log) + (oak_log in the bot's container) ≥ 8` at the end and slot 0 of the bot still holds `minecraft:stone_sword`; `attackCalls[id] ?? 0 == 0` for every entity id other than the zombie.
**Cleanup.** Standard + `!stop`.

#### `p3_never_attack_friendlies` ★ — `colony:arena`, 1200 (hard rule: never attack villagers, golems, tamed pets, players)
**Setup.** `enterCombatEnv`. Top-level Creative sim `GT-Owner` at (2,1,2), not adopted. Bot at (12,1,12) with kit, adopted. `testOnlySpawn`: `minecraft:villager` (14,1,12), `minecraft:iron_golem` (12,1,15), `minecraft:wolf` (10,1,12) then `testOnlyTame(wolf, owner)`, `minecraft:armor_stand` (12,1,9), zombie 1 (16,1,12) (4 blocks from the bot). `HitLedger.start()`.
**Run.** 1000 ticks. At tick 400 spawn zombie 2 at (20,1,20) (positive control: the bot still fights while friendlies are around).
**Assertions at every tick** for each friendly `F` in {villager, golem, wolf, armor stand, `GT-Owner`}: `ledger.hits(bot.id, F.id) == 0`, `ledger.hurts(bot.id, F.id) == 0`, `(combatDebug(bot).attackCalls[F.id] ?? 0) == 0`. A friendly that dies to the zombie does not fail the test.
**Pass (all).** The assertions held for all 1000 ticks; zombie 1 dead within 400 ticks (by anyone); `ledger.hits(bot.id, zombie2.id) ≥ 1` and zombie 2 dead by tick 1000; bot valid with HP ≥ 8. Print `guardRejects`.

#### `p3_haul_cargo_escape` — `colony:grove_roofed`, 3200 (objective cargo dominates the escape decision)
**Setup.** `enterCombatEnv`. Chest (2,1,2), `!chest set`; a second fake sender at (13,1,13) sends `!home set`. Constants at the top of the file: `HAUL_HP = 12`, `HAUL_LOGS = 32`; if S2's numbers make this scenario not behave as below, S2 owns changing them (said in the failure message).
**Phase A (control: empty cargo).** Bot `botName("GHA")` with kit at (4,1,3), adopted, `!gather oak_log 32`. Once `progress.delivered + progress.held ≥ 1` (≤ 1500 ticks) set `testOnlySetHealth(bot, HAUL_HP)` and spawn two zombies with the cell rule of `snapshot_escape_rejoin` (7-8 blocks away). Pass A: both zombies dead within 900 ticks, bot valid, `combatDebug(GHA).escapes == 0`. Then `!stop`, disconnect the bot, clear the zombies.
**Phase B (objective cargo).** Bot `botName("GHB")` with kit and `testOnlyGive(bot, 9, "minecraft:oak_log", 32)` before adoption (32 of the 32 requested logs held: objective value 1000, S2a), same task, same HP and zombie placement at the first tick after adoption plus 40 ticks. Pass B: `combatDebug(GHB).escapes ≥ 1` within 600 ticks of the spawn; after the rejoin (≤ 600 more ticks) the new bot is within 3 blocks of (13,1,13) and `fingerprint(newBot) === fingerprintLast`.
**Pass (all).** Pass A and Pass B (same HP and threat; only the cargo differs, so the difference is the cargo term).

#### `p3_escape_owner_feet` — `colony:arena`, 1500 (no home: rejoin at the owner's feet, haul delivery)
**Skip rule.** The destination is the owner's feet, else the first online human sorted by name (S4b `destOrder`). The fake sender is not a human, so a real player must be online. If `world.getAllPlayers()` has no player that this test did not spawn: `test.print("no human online: owner-feet test skipped")` and `test.succeed()`.
**Setup.** `enterCombatEnv`. No `!home set`. Bot with kit at (4,1,4), `testOnlyGive(bot, 9, "minecraft:oak_log", 12)`, adopted; sender S at (4,1,6) sends `!gather oak_log 16` (`progress.held` becomes 12, `delivered` 0). `owner = ` the first human sorted by name; `ownerCell = floor(owner.location)`.
**Trigger.** One tick after `progress.held ≥ 12`: `testOnlySetHealth(bot, 6)`; zombies with the cell rule of `snapshot_escape_rejoin` (7-8 blocks). `escapes0 = combatDebug(name).escapes`; `fingerprintLast` each tick while the bot is valid.
**Pass (all).** The bot leaves (≤ 400 ticks) and a player with that name exists again within 600 ticks; the new bot is within 3 blocks of `ownerCell`; exactly one player with that name at +60 ticks after the rejoin (exactly once); `combatDebug(name).escapes - escapes0 == 1`; 200 ticks after the rejoin the new bot holds no `minecraft:oak_log` (haul dropped, S4b §7) while every other line of `fp1` (all kit lines) equals the same line of `fingerprintLast`; `view.task?.id` equals the gather task id (12 < 16 requested: the task continues).

#### `p3_recover_after_combat` — `colony:grove_roofed`, 5200 (RECOVER returns to the task)
**Setup.** As `combat_harvester_resumes` (chest, kit, `!chest set`, `!gather oak_log 12`), plus `testOnlyGive(bot, 4, "minecraft:cooked_beef", 6)` and `testOnlySetFood(bot, 20, 5)` before adoption. Record `taskId`.
**Trigger.** Once `progress.delivered + progress.held ≥ 2`: `testOnlySetHealth(bot, 9)` and spawn one zombie at the farthest corner (rule of `combat_harvester_resumes`). Let `recoverHp = config.combat.recoverHp` (16).
**Run.** Sample every tick from the kill (`tKill` = first tick the zombie is dead): `rec = viewByName(name).combat?.recovering`, `layer`, `p = delivered + held`, beef count, `hp`.
**Pass (all).** Zombie dead within 600 ticks of the spawn; `recovering === true` observed within 100 ticks after `tKill`; while `recovering` is true `p` never increases (the task is paused); `recovering` becomes false within 1500 ticks of `tKill`, and at that moment `hp >= recoverHp` or the beef count is 0; within 600 ticks after that `layer === "task"` and `p` has grown by ≥ 1; `view.task?.id === taskId` throughout; bot valid.
**Cleanup.** Standard + `!stop`.

#### `p3_idle_far_threat` — `colony:arena`, 1500 (idle bot far from its owner still defends itself)
**Setup.** `enterCombatEnv`. Bot with kit at (4,1,12), adopted, **no task**. Fake sender S at world cell `absCell(test, (44,1,12))` (40 blocks east of the bot, outside the structure) sends `!status` so S owns the bot (an ownerless bot is claimed by its first command; `!status` queues no task). `HitLedger.start()`.
**Trigger.** At tick 100 spawn a zombie at (14,1,12) (10 blocks).
**Pass (all).** Zombie dead within 900 ticks of the spawn; bot valid with HP ≥ 8; `view.task` is undefined at every sampled tick; `presence === "live"` at every sampled tick (the idle/far self-dismiss, `idle.idleGraceTicks` 600 and `idle.farTicks` 1200, must not remove a bot that is fighting); `ledger.hits(bot.id, zombie.id) ≥ 1`.

#### `p3_reflex_lava` — `colony:arena`, 600
**Setup.** `enterCombatEnv`. Bot at (12,1,12) with kit, adopted, idle. At tick 20 `testOnlySetBlock(test, (12,1,12), "minecraft:lava")` (the bot stands in a lava source; lava spreads on the flat floor).
**Pass (all).** `viewByName(name).combat.layer === "reflex"` observed within 20 ticks of the placement; within 100 ticks of the placement the bot's feet block is not lava and the bot is valid with HP > 0; `combatDebug(name).escapes == 0` (the exit is faster than `lavaEscapeTicks`, measured as continuous hazard time, D28; if this fails with `escapes ≥ 1` the failure message says the lava exit was slower than `config.combat.lavaEscapeTicks`); 200 ticks after the exit `layer !== "reflex"`.

#### `p3_reflex_drown` — `colony:arena`, 900
**Setup.** `enterCombatEnv`. Bot at (12,1,12) with kit, adopted, idle. At tick 20 fill water with `testOnlySetBlock` for x 10..14, z 10..14, y 1..4 (a 5×5×4 pool; the bot is submerged). Record `air0 = testOnlyAirSupply(bot)` (`undefined` allowed) and sample the air every 20 ticks into `airSeries`.
**Pass (all).** `layer === "reflex"` observed (the reflex triggers on `drownHeadTicks` 200 ticks of head-in-water, or earlier when `airFrac <= drownAirFrac` is readable); the bot's head is out of the water (feet block not water or head block not water) within 450 ticks of the placement; the bot is valid with HP ≥ 8 (a single drowning tick may hurt, never more); `combatDebug(name).escapes == 0`; if `air0` is defined: `min(airSeries) > 0` (the bot never ran out of air) and the print line includes `airSeries`; if `air0` is undefined: print `air supply unreadable: head-ticks fallback used` (not a failure).

#### `p3_reflex_fire` — `colony:arena`, 600
**Setup.** `enterCombatEnv`. Bot at (12,1,12) with kit, adopted, idle. `testOnlySetBlock(test, (16,1,12), "minecraft:water")` (a source 4 blocks away) at tick 0. At tick 20 `testOnlySetOnFire(bot, 5)`.
**Pass (all).** `layer === "reflex"` observed within 20 ticks of the ignition; within 200 ticks the bot is not burning (`getComponent("minecraft:onfire")` is undefined) or `isInWater`; bot valid with HP ≥ 10; `combatDebug(name).escapes == 0`.

#### `p3_equip_from_chest` — `colony:arena`, 600
**Setup.** `enterCombatEnv`. Chest at (6,1,6) (`placeChest`), `testOnlyFillChest`: `minecraft:iron_sword` ×1, `minecraft:shield` ×1, `minecraft:iron_axe` ×1, `minecraft:cobblestone` ×16. Sender at (7,1,6) sends `!chest set`. Bot with an empty inventory (`testOnlyKit(bot, "bare")`) spawned at (6,1,7) (adjacent to the chest), adopted after `!chest set`.
**Pass (all).** Within 400 ticks of adoption: the item in the bot's selected hotbar slot is `minecraft:iron_sword`, the Offhand item is `minecraft:shield`; the chest holds `iron_sword` 0, `shield` 0, `iron_axe` 1, `cobblestone` 16 (it lost exactly the sword and the shield; the S3 equipment planner fetches only swords, armour and shields, never axes or other stacks); total counts conserved (chest + bot: sword 1, shield 1, axe 1, cobblestone 16).
**Note.** S3 owns the fetch trigger (`onNearChest` after a deposit or on rejoin at home). If the bot never fetches because adoption next to the chest does not call it, the failure message says so and S3 adds the call.

### 2.5 Structure and registration unit test (`test/structures-p3.test.ts`, B3)
- Imports `buildStructures` from `scripts/make-structure.mjs` (allowed in tests; the `.mjs` is plain JS).
- Pins the four existing SHA-256 values from §2.3 (`node:crypto`).
- Contains the 30-line `readNbt(buf)` below; then for each new structure decodes `size` and `structure.block_indices[0]` and the palette names, and asserts the cells in the table:

```ts
function readNbt(buf: Buffer): Record<string, unknown> {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const i32 = () => { const v = buf.readInt32LE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16LE(o); o += 2; const s = buf.toString("utf8", o, o + n); o += n; return s; };
  const payload = (t: number): unknown => {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 3: return i32();
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a: unknown[] = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const c: Record<string, unknown> = {}; for (;;) { const ct = u8(); if (ct === 0) break; const k = str(); c[k] = payload(ct); } return c; }
      default: throw new Error(`unsupported tag ${t}`);
    }
  };
  const t = u8(); str();
  return payload(t) as Record<string, unknown>;
}
// cell(x, y, z) -> block name:  palette[indices[(x * sy + y) * sz + z]].name
```
| Structure | size | Asserted cells |
|---|---|---|
| `arena` | 24,8,24 | floor (5,0,5) stone; roof (5,7,5) stone; wall (0,3,10) and (23,3,10) and (10,3,0) and (10,3,23) stone; interior (1,1,1), (22,6,22), (12,3,12) air |
| `arena_gap` | 24,8,24 | everything `arena` asserts, except (12,3,12) is stone; partition (12,1,5) stone; gap (12,1,11), (12,2,11), (12,1,12), (12,2,12) air; (12,3,11) stone; (12,1,13) stone |
| `corridor` | 20,4,7 | (0,1,3) and (19,1,3) stone; (1,1,3), (1,2,3), (18,2,3) air; (5,1,2) and (5,1,4) stone; (5,3,3) stone (roof); (5,0,3) stone |
| `grove_roofed` | 16,9,16 | (8,1,8)…(8,4,8) `minecraft:oak_log`; (8,5,8) air; (11,3,5) and (5,2,11) oak_log; (0,3,3) and (15,3,3) and (3,3,0) and (3,3,15) stone; (8,8,8) stone (roof); (1,1,1) air |
- Also asserts the registered GameTest names: `src/gametests/combat.ts` and `snapshot.ts` text contains each of the 21 test names of §2.2 as a string literal passed to `reg(` (read the files as text; do not import them).

### 2.6 Phase 2 regression block (D16)

The ROADMAP requires a review of the Phase 2 gather behaviour under the Phase 3 stack. Nothing in the Phase 2 code changes except through the executor `pause`/`resume` contract, so the review is a gate:
1. **GameTests:** all 8 existing Phase 2 tests stay green with the controller wired in: `chest_set`, `gather_logs`, `gather_two_bots`, `gather_cobble_craft`, `gather_no_source`, `goto_flat`, `goto_unreachable`, `override_flow`. They run in the same `/gametest runset colony`. A failure of any is a blocker for the phase, not a flaky test: fix the Phase 3 code, never the old test (C8 mechanical edits aside).
2. **Pause/resume during gather:** `combat_harvester_resumes` and `p3_gather_under_stack` (§2.4) plus the unit file `executor-pause` (TC-B3.4).
3. **PLAYTEST §I ("Do bots pick up drops?", item pickup) is re-run** with the 0.3.0 pack (§6, row AD): the pickup behaviour that Phase 2 relies on must still work when combat code runs in the same pump.
4. DoD items 46 and 47 (§5).

---

## 3. Unit-test plan

### 3.1 Test files per job (TC = test cases; each job owns exactly the files listed)

| Job | Test files | TC-B* content (minimum cases) |
|---|---|---|
| B1 | `test/combat-sense.test.ts`, `test/combat-brain.test.ts`, `test/combat-stats.test.ts`, `test/combat-scoring.test.ts` | **TC-B1.1** classification: every NEVER_TARGET id; tamed vs wild wolf/cat/horse; baby; neutral list unprovoked/provoked; IGNORE list; unknown hostile → `threat`; `minecraft:player` and a bot player → `never_target`; spider (D18): neutral only when `isDaylight && lightLevel >= spiderNeutralLight`, `threat` when provoked, at night (`isDaylight` false, light 15), at light 11, and with `lightLevel` undefined. **B1.2** relevance geometry: targeting me; blocking objective for gather block/path corridor/chest/goto target/defend zone; irrelevant; leash equality (distance = `leashBlocks`, `leashBlocks`+ε; defend zone: radius + `defendLeashExtra`); provocation memory expiry at exactly `config.combat.provokeMemoryTicks` and `+1`. **B1.3** `mob_aggroed_on_bot` proxy: each of the three proxy rules alone, API target set and unset, invalid entity skipped. **B1.4** brain golden table, ≥ 30 rows `Percept → OptionKind` (healthy vs zombie → attack; HP low + food + far threat → eat; HP low + near → retreat; cargo-heavy + low HP → escape_rejoin; creeper hissing close → back_off/retreat; skeleton at range with shield → shield; flee-only mob → flee; nothing → resume_task / idle; task paused → resume after threat gone); TABLES.md worked examples 1–7 as rows. **B1.5** hysteresis: commit until `until` tick, emergency override, tie-break order, determinism (same input twice → same output, input not mutated). **B1.6** property: for 500 seeded random percepts (`seededRng(1..500)`) the brain never returns `attack` with a `targetId` whose entity is `never_target`/`ignore`/`neutral_unprovoked`, never `attack` when `config.body.attackMode === "off"`, and always returns a defined option. **B1.7** stats: record/aggregate, best-allowed selection with `n ≥ minSamples`, exploration with injected `fixedRng` below/above `exploreRate`, never a disallowed tactic, bounded size, defaults when empty. **B1.8** scoring: each term of each option formula per S2 with boundary values. |
| B2 | `test/combat-kb.test.ts`, `test/mobs-golden.test.ts` | **TC-B2.1** drift guard: the test reads `docs/phase3/MOBS.md` §3 and asserts `Object.keys(MOBS)` equals the set of `id: minecraft:…` lines in §3 (and §4 for stubs); same for the FOOD ids in `docs/phase3/TABLES.md`. **B2.2** every `tactics[].name` ∈ `TacticName`; every `when`/`flee_if` atom ∈ the CONDITION grammar list (copied into the test from MOBS.md §1.5); every `verify` field name is a key of the entry. **B2.3** lookup: unknown id → default entry; variants map to the base entry; NEVER_TARGET membership. **B2.4** food: preference lists reference existing foods; every row has `hunger ≥ 0`; selection examples from TABLES.md §5. **B2.5** values: modifiers (enchant cap, durability floor, unknown stackable/unstackable), objective bonus and death-cost examples 4–6 to the digit. **B2.6** `config` defaults: every numeric key finite, thresholds ordered (e.g. retreat HP > flee HP) as S2 states. **B2.7** (`mobs-golden.test.ts`) one golden row per mob: for each of the 19 Phase 3 entries of MOBS §3 and the default entry, `mobId | expected EngagePolicy | expected tactics[0].name`, typed into the test from MOBS §3 (`tactics[0]`), asserted against `kb.mob(mobId)` with the shared preset `makePercept()` + `makeEntity({ typeId: mobId })` for the classification; a MOBS entry without a row, or a row without an entry, fails (drift guard). |
| B3 | `test/controller.test.ts`, `test/sensor.test.ts`, `test/defend-executor.test.ts`, `test/executor-pause.test.ts`, `test/runtime-p3.test.ts`, `test/structures-p3.test.ts` | **TC-B3.1** controller layer order (reflex > combat > task > idle) with all combinations; pause on combat entry, resume on exit with the same executor and progress; `step()` not called while paused; `!stop`/cancel during combat cancels both. **B3.2** sensor against the fake world: entity list → `EntityPercept[]`, invalid entity skipped, query throws → empty percept and one rate-limited log, scan cadence = `scanEveryTicks`, LoS ray via fake. **B3.3** defend executor state machine: patrol, zone entry detection, leash, no chase beyond, stop. **B3.4** `gather`/`goto` pause/resume: pause stops breaking/moving, progress unchanged, resume re-plans. **B3.5** runtime wiring with the `runtime.test.ts` mock pattern: pump → controller tick, `botStatus` push only on change, `testReset`, `combatDebug`. **B3.6** structures (§2.5). |
| B4 | `test/snapshot-excluded.test.ts`, `test/adapter-snapshot-io.test.ts`, `test/snapshot-codec.test.ts`, `test/snapshot-machine.test.ts`, `test/snapshot-store.test.ts`, `test/snapshot-service.test.ts`, `test/snapshot-conservation.test.ts` (files under test also include `src/core/snapshot/excluded.ts` and `src/game/adapter/snapshot-io.ts`) | **TC-B4.0** (`excluded.ts`) every `EXCLUDED_EXACT` id and every suffix rule returns `excludedTypeReason(typeId) !== undefined` with the right `ExcludeReason`; `unknown_enchant`, `has_inventory_component`, `has_book_component`, `serialize_error`; a normal item returns `undefined`. `adapter-snapshot-io`: fake engine capture/restore, `held` reuse (the same `ItemStack` object is re-set), engine throw → typed failure. **B4.1** codec round trip for every "yes" row of API-MAP D5 (type/amount, durability, enchantments, nameTag, lore, keepOnDeath, lockMode, canDestroy/canPlaceOn, dyeable, potion, book, bundle recursion); every excluded type is reported by `excludedTypeReason(typeId) !== undefined`; an unknown component or a serialization error yields an `ExcludeReason` (`unknown_enchant` / `has_inventory_component` / `serialize_error`), never a thrown error and never a `SnapItem`; corrupt JSON → typed error not throw. **B4.2** machine: every flow (dismiss, summon, escape, idle, reload, owner offline) through its states including each failure edge; consumed marked **before** restore; second restore of the same id is a no-op. **B4.3** store: chunking at `chunkChars`; write order new chunks → count → delete stale; crash injected after each write step (via `FakePropertyStore.failAfter`) leaves the last good snapshot readable; clear semantics; key namespace `colony:snap:`. **B4.4** service with `FakeSnapshotEngine`: clear-before-disconnect always (with `dropOnDisconnect: true` no item ever appears on the ground); excluded stacks never written to the store but kept in memory (`held`); timer + dirty writes with `FakeClock`; Save & Quit restore on load. **B4.5** conservation (see 3.3). **B4.6** (S4b §12.3, service cases U1-U15, each a failure-table row, with `FakeSnapshotEngine` and `FakeClock`): U1 commit order spy: write, readDetailed, clear, disconnect, dispose in that order (and none after a failed write). U2 two `summonBot` effects in one pump: one spawn, second `busy`. U3 `markRestored` called before the first `setItem` (spy order). U4 spawn throws twice then succeeds: one body. U5 spawn throws but a body appeared: adopted, no second spawn. U6 `apply` partial x2 then done: `setItem` count equals plan length. U7 partial x5: `carryover` in the forced write, notice `restoreLeftover`. U8 re-arm after `bot_invalid`. U9 idle with excluded and no chest: refused, backoff 1200. U10 `assign` during idle walk aborts the flow. U11 world load: dismissed row not queued; `online` row queued; owner offline + no home: `rejoinDeferred` after 200 ticks. U12 haul: only objective slots dropped, `haulDropped.count` right. U13 `storage_full`: body untouched, `botDismissFailed` reason `storage_full`. U14 escape with `dropsOnDisconnect=true`: no item on the fake ground after the flow. U15 scripted reload with a live body: adopt, no restore. |
| B5 | `test/body-tactics.test.ts`, `test/body-melee.test.ts`, `test/body-shield.test.ts`, `test/body-eating.test.ts`, `test/body-equipment.test.ts`, `test/adapter-body.test.ts`, `test/probes-verdicts.test.ts`, `test/probes-registry.test.ts`, `test/outcome-stats.test.ts` | **TC-B5.1** each of the 15 tactics (MOBS.md §5) as a tick-by-tick transcript on `FakeBody` (pre-conditions, steps, abort conditions, gear requirements, 10-tick attack interval). **B5.2** melee: reach cap, stop-breaking first, weapon select, look tracking, crit window (`velocity.y < 0`). **B5.3** shield per `shieldMethod` (`sneak`, `use_item`) and `shieldEnabled=false`, raise delay, lower when threat gone. **B5.4** eating: success, timeout at `useDuration + 10`, `stopUsingItem` path, interrupt-unsafe config, never creates items. **B5.5** equipment: selection order, durability swap threshold, ordered swap with failure injected at each of the 4 steps of API-MAP D3 (item count always conserved), ask-in-chat once. **B5.6** adapter body against a mocked engine: `attackTarget` steps 1–9 of S3 §1.2, each returning its `AttackResult` (rejects: wrong type id, player, tamed, cooldown, out of reach > 3, no LoS, friendly in line, all without reaching `attackEntity`; accepts otherwise with exactly one call); every method returns its documented failure value when the engine throws and logs with `[colony]`. **B5.7** `judge*` functions: for each of the 15 judges one test per verdict branch listed in §1.5 plus the boundary values (e.g. ratio 0.8 exactly, hits 3 vs 4). **B5.8** registry: 15 names (incl. `light`), unique, letters only, priorities as §1.2, every name has a runner key (source text check of `index.ts`). **B5.9** (`outcome-stats.test.ts`) the tactic outcome stats (S3 §3.4): one record per finished fight (mob type × tactic → win/loss, HP lost, duration); aggregation across fights; serialization into `ColonyMeta.stats` / `BotSnapshot.stats` within `maxStatsChars`; a simulated world reload (serialize → fresh state → load) returns the same aggregate; corrupt or oversize text → empty stats, no throw. |
| B6 | `test/commands-p3.test.ts`, `test/colony-p3.test.ts` | **TC-B6.1** parse every new command per S5 (happy, defaults, bounds, aliases, `/colony:c` join, every error plus usage line). **B6.2** colony semantics per S5 §4 (owner claim, home, summon/dismiss/recall, absent roster, offers with defend tasks, requeue with progress, `botStatus` staleness, `rosterRestored`). Phase 1/2 tests untouched. |
| B7 | `test/help-p3.test.ts`, `test/messages-p3.test.ts`, `test/playtest-doc.test.ts` | **TC-B7.1** help topics for the new commands. **B7.2** every S5 string id renders exactly (table-driven from S5 §6). **B7.3** `PLAYTEST.md` has a Phase 3 section and it contains: every `/colony:probe <name>` from `COMBAT_PROBE_NAMES`, every GameTest `colony:<name>` of §2.2, every manual test id `[M-01]`…`[M-15]` from §6. |

### 3.2 Shared fakes — `test/support/p3-fakes.ts` (created by the contract writer; builders import, never edit)
```ts
// Time and randomness
export class FakeClock { now: number; constructor(start?: number); advance(ticks: number): number }   // ticks only
export function seededRng(seed: number): Rng            // mulberry32; same seed => same sequence
export function fixedRng(values: number[]): Rng         // cycles through values; throws if values is empty

// Percept builders (S1 types)
export function makePercept(over?: DeepPartial<Percept>): Percept        // full HP/hunger bot at origin, iron sword+shield+armour, no entities, objective idle, now = 1000
export function makeEntity(over?: Partial<EntityPercept>): EntityPercept // husk 5 blocks away, targetingMe false, LoS true, classification threat, relevance irrelevant

// Body: records every BodyActions call
export interface BodyCall { tick: number; method: string; args: unknown[] }
export class FakeBody implements BodyActions {
  calls: BodyCall[];
  returns: Partial<Record<keyof BodyActions, unknown[]>>;  // FIFO return queue per method; empty queue => the method's default success value
  clock: FakeClock;
  callsTo(method: keyof BodyActions): BodyCall[];
  // mutable state the tactics read (position, yaw, velocity, onGround, inWater, hp, selectedSlot, offhand, sneaking)
}

// World port: entity lists
export class FakeEntityWorld {                         // used by sensor tests; extends nothing in test/support/fake-world.ts
  entities: Map<string, FakeEntity>;                   // { id, typeId, pos, hp, targetId?, valid, tamed?, baby?, families: string[] }
  add(e: Partial<FakeEntity> & { id: string; typeId: string }): FakeEntity;
  invalidate(id: string): void;                        // isValid = false; typeId/id still readable, everything else throws
  throwOn(method: string, times?: number): void;       // next `times` calls to that method throw
  readonly asWorldPort: WorldPort;                     // plugs into the sensor
}

// Dynamic-property store: implements exactly S4a's `PropertyPort` (`get`, `set` (undefined removes), `ids()`, `totalBytes()`)
export class FakePropertyStore implements PropertyPort {
  data: Map<string, string | number>;
  maxStringLength: number;                             // set > throws, to test chunking
  failAfter(nSets: number): void;                      // the (n+1)th set throws: simulates a crash mid-write
  writes: string[];                                    // keys in write order (for the new-chunks -> count -> delete assertion)
  totalChars(): number;
  ids(): string[];                                     // PropertyPort: the keys of `data`
  totalBytes(): number;                                // PropertyPort: sum of key + value lengths
}

// Snapshot engine: bots with 36-slot containers + equipment, a ground, item conservation
export class FakeSnapshotEngine {
  dropOnDisconnect: boolean;                           // P4 outcome: disconnect leaves items on the ground unless cleared
  failSpawn(times: number): void;                      // next spawns throw
  spawnDelayTicks: number;
  bots: Map<string, FakeBot>;                          // by name
  ground: FakeStack[];
  totalItems(): Map<string, number>;                   // typeId -> count over bots + ground (+ store via the service)
}
export function assertNotMoreThan(before: Map<string, number>, after: Map<string, number>): void  // after[t] <= before[t] for every t
```
Rules for fakes: no real timers, no `Date`, no `Math.random`; every fake is deterministic; `vi.fn` is allowed only to spy, never for time.

### 3.3 Conservation property test (`test/snapshot-conservation.test.ts`, B4)
For seeds 1..200 (`seededRng(seed)`): build a random inventory (random typeIds, amounts, some excluded such as shulker boxes), pick a random flow (dismiss→summon, escape, idle dismiss, Save&Quit reload) and a random **failure point** (disconnect throws, spawn throws N times, store write fails after k sets, restore throws mid-way, duplicate summon, double restore). Run to completion with `FakeClock`. Assertions: (1) total of each typeId over bots + ground + store-restorable ≤ the original (never more); (2) when no failure was injected, it equals the original; (3) each snapshot id is restored at most once; (4) with `dropOnDisconnect: true` no item is ever on the ground after a flow that cleared first. The failing seed is in the assertion message.

### 3.4 Determinism and the ≥ 90 % branch-coverage rule
**Scope.** `src/core/combat/sense.ts`, `brain.ts`, `scoring.ts`, `stats.ts`, `src/core/snapshot/codec.ts`, `machine.ts`. The rule applies to exactly these six files; if a builder adds another pure file with branching under `src/core/combat/` or `src/core/snapshot/` (for example `excluded.ts`), the file gets its own ledger in its test file and the same 90 % rule. There is no `npm run coverage` script (no coverage provider, `package.json` cannot change); the ledger and the reviewer enforce the rule.
1. **Target:** at least **90 % of branches** of each file are exercised by deterministic unit tests. A branch = each arm of `if/else`, `?:`, `switch` case (incl. default), each operand of `&&`/`||`/`??`, and each early return.
2. **Deterministic:** no real timers, `Date`, `Math.random`, `performance.now`, network, or file reads (except B2's drift guard and B7's doc test); time = `FakeClock`/ticks passed as arguments; randomness = injected `Rng` (`seededRng`/`fixedRng`); no dependence on `Map`/`Set` iteration order unless sorted; no test depends on another test.
3. **Tool:** no coverage provider is installed and `package.json` cannot change. Coverage is therefore enforced by a **branch ledger**: each of the six files' test files (`combat-sense`, `combat-brain`, `combat-scoring`, `combat-stats`, `snapshot-codec`, `snapshot-machine`) starts with a comment block
   ```ts
   // BRANCH LEDGER src/core/combat/brain.ts
   // [B:brain.attack.noWeapon] attack option has no weapon -> score 0
   // [B:brain.eat.threatNear] eat rejected when threat closer than eat time
   ```
   one line per branch point the builder enumerated (target: every branch of the file). Every ledger tag must appear in a test title as `it("[B:brain.attack.noWeapon] …")`. `test/branch-ledger.test.ts` (contract writer, C6) checks: for each test file containing `BRANCH LEDGER`, every ledger tag appears in exactly one-or-more titles of that file, and every `[B:` tag in titles is in the ledger; and that the six files above contain a ledger with ≥ 1 tag per exported function of the source file (exports are read from the source text with the TypeScript parser). The reviewer enumerates the branches of the source independently and rejects when the ledger covers < 90 %. If `@vitest/coverage-v8` happens to be available locally, the reviewer may run `npx vitest run --coverage` as a cross-check; it is not required and must not be added to `package.json`.
4. No `/* istanbul ignore */`-style exclusions, no `it.skip`/`it.only`/`it.todo`, no snapshot (`toMatchSnapshot`) tests.

### 3.5 How the engine is mocked
Copy the pattern in `test/runtime.test.ts`: `vi.hoisted` state, `vi.mock("@minecraft/server", () => …)` and `vi.mock("@minecraft/server-gametest", () => …)` with only the exports the code under test imports, `vi.resetModules()` + dynamic `import()` per test, `advance(ticks)` helper driving a fake `system.currentTick`. A test file mocks only what it needs; it never edits another job's test. Files under `src/probes/` and `src/gametests/` register at import time and are **never imported** by unit tests, except the pure `src/probes/combat/names.ts` and `verdicts.ts`.

---

## 4. Builder rules (apply to B1–B7; numbered; a violation is a review failure)

### 4.1 The rules
1. **No `any`.** Not explicit (`: any`, `<any>`, `as any`, `any[]`), not implicit (the repo is `strict` with `noUncheckedIndexedAccess`). No `@ts-ignore`; `@ts-expect-error` only in tests, with a reason comment. Avoid `!` non-null assertions; guard instead. Casts through `unknown` only inside `src/game/adapter/`.
2. **`src/core/**` imports no `@minecraft/*`** (enforced by `test/boundaries.test.ts`). `src/game/bots/**` imports no `@minecraft/*` and not the adapter (same test). Gametest module only in `src/game/adapter/`, `src/probes/`, `src/gametests/`.
3. **Only APIs listed in `docs/phase3/API-MAP.md`, and only through the adapter.** Engine calls (`getComponent`, `getEntities`, containers, equipment, dynamic properties, SimulatedPlayer methods) live in `src/game/adapter/`. If you need something that is not listed, **stop and report**; do not guess a name.
4. **Every engine call is in `try/catch` at the adapter boundary** and logs with the `[colony]` tag through `src/game/log.ts` (`logWarn`/`logError`, rate-limited like Phase 2: first failure, then every 25th). The adapter returns the port's documented failure value; no engine error ever reaches the core or an executor.
5. **Check validity before every use of a cached handle:** `entity.isValid` (a property) before each use, and again after any `system.run` delay. `id` and `typeId` are readable on invalid entities; `name`, `location`, components are not. The core stores **ids**, never handles. Re-query mobs every pump.
6. **Never create items**, except (a) Phase 2 crafting in `src/game/adapter/`, (b) the ordered equip swap (API-MAP D3) in `src/game/adapter/body.ts`, (c) snapshot restore in `src/game/snapshot/service.ts`. `new ItemStack`, `setItem`, `addItem`, `setEquipment` appear nowhere else under `src/game` or `src/core`. Restore marks the snapshot consumed **before** writing items, exactly once per snapshot id.
7. **Never use for gameplay:** `giveItem`, `SimulatedPlayer.setItem`, `useItem`, `useItemOnBlock`, `spawnItem`, `spawnEntity`, `teleport`/`tryTeleport`, `applyDamage`/`applyImpulse`/`applyKnockback`, `kill`, `addEffect`, `setOnFire`, `runCommand*`, attribute `setCurrentValue`/`resetTo*`, `setType`/`setBlockType`/`setPermutation`, `tame`, `Player.eatItem`, `clearDynamicProperties`, `move()`/`setBodyRotation()`. Allowed only in `src/probes/` and `src/gametests/` for setup (fixtures). `clearDynamicProperties` and `Player.eatItem` are forbidden **everywhere**, probes and tests included.
8. **Never `EquipmentSlot.Mainhand` in snapshot code** (it aliases the selected hotbar slot). Snapshots cover the 36 container slots, `selectedSlotIndex`, Head, Chest, Legs, Feet, Offhand.
9. **Attacks go through one guard.** Calls to `attackEntity`/`attack` in `src/game` exist only inside the `attackTarget` method of the body adapter in `src/game/adapter/body.ts` (one `attackEntity` call, plus at most one `attack()` call for the `body.attackMode = "look_attack"` fallback, so 1 or 2 call expressions in total) (S3 §1.2 is the exact algorithm; the constant `ATTACK_GUARD_FN` in `test/boundaries-p3.test.ts` must match the method name). It refuses, without calling the engine, when: the target is a player (any `minecraft:player`, including colony bots), in `NEVER_TARGET`, tamed, a villager/golem; distance eye-to-AABB > `meleeReach` (3.0); no line of sight (API-MAP A8 recipe); or a friendly hitbox is on the ray. Before an attack: `stopBreakingBlock()` if breaking; the weapon slot is selected by the caller. No tactic, runner or controller code may call the engine attack any other way. The controller's wrapper counts `CombatDebug.attackCalls`/`guardRejects` from the returned `AttackResult`.
10. **No `Math.random` in `src/core` or `src/game/bots`.** Take an injected `Rng` (C1). Production wiring in `src/game/runtime.ts` only.
11. **Time is ticks.** No `Date`, `performance.now`, `setTimeout`, `setInterval` in `src/core`, `src/game` (use `system.currentTick` in the shell, a `Tick` argument in the core). Probes and GameTests use `system.runTimeout`/`sleep`.
12. **All thresholds and timers come from `src/core/config.ts`** (`config.combat`, `config.snapshot`, `config.body`, `config.idle`). No numeric literal other than 0, 1, -1 and 2 appears in `src/core/combat/{brain,scoring,stats,sense}.ts`, `src/game/bots/*.ts` (tactic and controller code) and `src/core/snapshot/*.ts`, except as the initialiser of a top-level `const` in UPPER_CASE with a unit comment (physical constants such as `EYE_HEIGHT` are such consts).
13. **Chat text only from `src/core/colony/messages.ts`** (S5). Combat and snapshot code emit typed notices/events (`botNotice`), never formatted strings. Bot lines use `world.sendMessage` via the runtime, not `SimulatedPlayer.chat`.
14. **Always pass `LookDuration` explicitly.** Never use `move()` or `setBodyRotation()` for top-level bots (coordinates are absolute).
15. **Privileges:** inside any `beforeEvents.*` callback do no non-restricted-execution calls and no writes to restricted-read-only properties; copy what you need, then `system.run(() => …)`.
16. **Beta members are isolated**: one adapter function per beta member (`Entity.target`, `Player.eatItem` (unused), tamed owner getters, `Block.isSolid`, `Dimension.getWeather`, `EquipmentSlot.Body`, the gametest module), each with a `try/catch` and the safe default listed in API-MAP "Safe usage rule 5".
17. **Fallback switches are real:** code that depends on a probe result reads the config key in §1.4 and implements both branches (default and fallback). A branch that is not implemented is a `TODO(phase-n)` with the key named, and the matching unit test is written as `it("[B:…] fallback <key>")` (not skipped).
18. **Do not edit tests to make them pass.** A failing test means the code or the spec is wrong: fix the code, or report the spec gap. Do not weaken assertions, delete cases, or mark them skipped. Do not edit tests owned by other jobs (C8 mechanical edits excepted).
19. **Do not edit files you do not own.** If you need a change in someone else's file, a contract file (`types.ts`, `ports.ts`, `config.ts`, the `Executor` interface, stubs) or a doc, make a local workaround and **report** it in your final message (file, change, why).
20. **Keep `TODO(phase-n)` for deferred work**, with the phase number and one line of what is missing. No unmarked `TODO`/`FIXME`.
21. **TEST-ONLY code stays in tests:** `testReset`, `combatDebug`, every `testOnly*` and `fixture*` function, and `enterCombatEnv` exist only in `src/game/runtime.ts` (hooks) and `src/gametests/`/`src/probes/`/`test/`. Production code never calls them.
22. **Production code never imports `src/probes/` or `src/gametests/`** (only `src/main.ts` does, for registration).
23. **No new dependencies; no `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts` changes.** No new global state outside the existing runtime singleton; module-level mutable state must be resettable for tests.
24. **Pure functions are pure:** no mutation of arguments, no hidden I/O, no reading `config` implicitly (take it as a parameter, defaulting to the imported `config` only at the shell boundary).
25. **Every new public function has a test that calls it.** Pure core modules follow the branch-ledger rule (§3.4). Tests are deterministic (§3.4 rules 2 and 4) and use the shared fakes (`test/support/p3-fakes.ts`).
26. **`npm run check` must pass for your files** (typecheck + vitest + build) before you report. Existing Phase 1/2 tests keep passing. If another job's stub makes a test of yours fail, say so in the report; do not hack around it.
27. **Logging:** `[colony]` tag, sparse (phase transitions, failures), never per tick. No `console.*` outside `src/game/log.ts` and `src/probes/`.
28. **Final report format:** (a) files created/edited; (b) deviations from the spec and why; (c) gaps found (spec said X, needed Y); (d) anything another job must know; (e) the branch-ledger coverage estimate for pure files.

### 4.2 Builder-facing summary of "what must not change"
Contract files (`src/core/types.ts`, `src/core/combat/types.ts`, `src/core/snapshot/types.ts`, `ports.ts`, `config.ts` structure, `Executor` interface), `test/boundaries.test.ts`, `test/boundaries-p3.test.ts`, `test/branch-ledger.test.ts`, `test/support/p3-fakes.ts`, `packs/BP/manifest.json`, all `docs/**`.

### 4.3 `test/boundaries-p3.test.ts` (contract writer creates it verbatim; builders never edit it)
```ts
// Phase 3 guards: forbidden APIs, wall-clock/random in the pure layers, the single attack guard, no `any`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ATTACK_GUARD_FN = "attackTarget";           // S3 §1.2: the BodyActions method implemented in the body adapter
const ATTACK_FILE = "src/game/adapter/body.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(p) ? [p] : [];
  });
}
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const SRC = walk(join(ROOT, "src")).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));
/** JS output with comments removed and types erased, so patterns only match executable code. */
const js = (text: string) =>
  ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;

interface Rule { id: string; pattern: RegExp; allowed: string[]; scope?: string[] }
const TEST_AREAS = ["src/probes/", "src/gametests/"];
const RULES: Rule[] = [
  { id: "no-Math.random", pattern: /\bMath\.random\b/, allowed: ["src/game/runtime.ts", ...TEST_AREAS] },
  { id: "no-wall-clock", pattern: /\b(Date\.now|performance\.now|new Date|setTimeout|setInterval)\b/, allowed: TEST_AREAS },
  { id: "no-new-ItemStack", pattern: /\bnew\s+ItemStack\s*\(/, allowed: ["src/game/adapter/", "src/game/snapshot/service.ts", ...TEST_AREAS] },
  { id: "no-script-item-writes", pattern: /\.(setItem|addItem|setEquipment)\s*\(/, allowed: ["src/game/adapter/", "src/game/snapshot/service.ts", ...TEST_AREAS] },
  {
    id: "no-cheat-api",
    pattern: /\.(giveItem|useItem|useItemOnBlock|spawnItem|spawnEntity|setBlockType|setType|setPermutation|runCommand|runCommandAsync|teleport|tryTeleport|applyDamage|applyImpulse|applyKnockback|kill|addEffect|setOnFire|setCurrentValue|resetToMaxValue|resetToDefaultValue|interactWithEntity|setBodyRotation|tame)\s*\(/,
    allowed: TEST_AREAS,
  },
  { id: "no-clearDynamicProperties", pattern: /\bclearDynamicProperties\b/, allowed: [] },
  { id: "no-Mainhand-in-snapshots", pattern: /\bMainhand\b/, allowed: [], scope: ["src/game/snapshot/", "src/core/snapshot/"] },
  {
    id: "engine-calls-in-adapter",
    pattern: /\.(getComponent|getEntities|getHeadLocation|getVelocity|getBlockFromRay|getEntitiesFromRay|getDynamicProperty|setDynamicProperty|swapItems|transferItem|moveItem|clearAll)\s*\(/,
    allowed: ["src/game/adapter/", ...TEST_AREAS],
  },
  { id: "no-eatItem", pattern: /\beatItem\b/, allowed: [] },
  { id: "test-only-hooks", pattern: /\b(testReset|combatDebug|testOnly\w+|fixture[A-Z]\w*|enterCombatEnv)\b/, allowed: ["src/game/runtime.ts", "src/game/bots/controller.ts", "src/game/snapshot/service.ts", ...TEST_AREAS] },
];
const PURE = ["src/core/", "src/game/bots/"];   // extra: no Math.random/clock even via allowed list above
const allowedIn = (path: string, allowed: string[]) => allowed.some((a) => path === a || path.startsWith(a));

describe("Phase 3 forbidden patterns", () => {
  for (const rule of RULES) {
    it(rule.id, () => {
      const bad = SRC.filter((f) => (rule.scope ? rule.scope.some((s) => f.path.startsWith(s)) : true))
        .filter((f) => !allowedIn(f.path, rule.allowed))
        .filter((f) => rule.pattern.test(js(f.text)))
        .map((f) => f.path);
      expect(bad).toEqual([]);
    });
  }
  it("pure layers never use Math.random or wall-clock, even in an allowed file", () => {
    const bad = SRC.filter((f) => PURE.some((p) => f.path.startsWith(p)))
      .filter((f) => /\b(Math\.random|Date\.now|performance\.now|new Date|setTimeout|setInterval)\b/.test(js(f.text)))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });
  it("production code never imports probes or gametests", () => {
    const bad = SRC.filter((f) => f.path !== "src/main.ts" && !TEST_AREAS.some((a) => f.path.startsWith(a)))
      .filter((f) => ts.preProcessFile(f.text, true, true).importedFiles.some((i) => /(^|\/)(probes|gametests)(\/|$)/.test(i.fileName)))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });
});

describe("no `any` in src", () => {
  it("has no AnyKeyword", () => {
    const bad: string[] = [];
    for (const f of SRC) {
      const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ES2022, true);
      const visit = (n: ts.Node): void => {
        if (n.kind === ts.SyntaxKind.AnyKeyword) bad.push(`${f.path}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(bad).toEqual([]);
  });
});

describe("single attack guard", () => {
  it("every attackEntity/attack call lies inside the guard function in the adapter (1 or 2 calls)", () => {
    const calls: { path: string; fn: string | undefined }[] = [];
    for (const f of SRC.filter((x) => !TEST_AREAS.some((a) => x.path.startsWith(a)))) {
      const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ES2022, true);
      const visit = (n: ts.Node, fn: string | undefined): void => {
        let cur = fn;
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) cur = n.name.text;
        else if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) cur = n.name.text;
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["attackEntity", "attack"].includes(n.expression.name.text)) calls.push({ path: f.path, fn: cur });
        ts.forEachChild(n, (c) => visit(c, cur));
      };
      visit(sf, undefined);
    }
    // `attackTarget` holds one `attackEntity` call and at most one `attack()` fallback call (body.attackMode = "look_attack").
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.filter((c) => c.path !== ATTACK_FILE || c.fn !== ATTACK_GUARD_FN)).toEqual([]);
  });
});
```
If a port method legitimately collides with a pattern name (e.g. a port called `getEntities`), the **port method is renamed**, not the rule.

---

## 5. Definition of Done (goes into `docs/PHASE3-SPEC.md` §13; 59 items)

Verification column: **U** = unit test file, **G** = GameTest, **M** = manual playtest id (§6), **P** = probe result. Every row is observable in game or by a test.

**Stack and sensing (S1)**
1. With a reflex trigger (lava/fire/drowning), a threat and an active task all present, the controller runs the reflex first, then combat, then the task, then idle. — U `controller`
2. A zombie attacking a gathering bot pauses the gather (no body actions from the executor while paused), the bot kills the zombie, and the gather resumes with `delivered + held` never decreased and completes. — G `combat_harvester_resumes`, U `executor-pause`
3. `pause()` stops breaking and movement and keeps progress; `resume()` re-plans; `step()` is never called while paused (gather, goto, defend). — U `executor-pause`
4. Players (including colony bots), villagers, golems, tamed pets and armor stands are classified `never_target`; unprovoked neutral mobs are not attacked; provoked ones become threats and calm down after the memory window. — U `combat-sense`
5. A mob targeting the bot is `threatening_me`, one blocking the gather block/path/chest/defend zone is `blocking_objective`, any other is `irrelevant` and is never chased beyond `leashBlocks`. — U `combat-sense`, G `defend_patrol_kills`
6. A warden within the trigger distance produces a sneak-away reflex and never an `attack`. — U `combat-brain`, M-04
7. The sensor skips invalid entities and survives engine errors (empty percept, one log line). — U `sensor`

**Decision (S2)**
8. A full-HP bot with an iron sword vs one zombie chooses `attack` and wins. — U `combat-brain`, G `combat_zombie_win`
9. A low-HP bot with food and a far threat eats before engaging. — U `combat-brain`, G `combat_retreat_eat`
10. Decisions do not flip inside the minimum commit time except through the emergency override; identical input gives identical output. — U `combat-brain`
11. Low HP plus high death cost (gear, objective cargo) chooses `escape_rejoin`, with no cooldown between escapes. — U `combat-brain`, G `snapshot_escape_rejoin`
12. Flee-only mobs never get `attack`; creeper hissing nearby never gets a melee `attack` without the knockback tactic. — U `combat-brain` (table over MOBS)
13. Every fight records mob × tactic outcome stats; the bot mostly picks the best allowed tactic and explores another only with the injected `Rng` below `exploreRate`; it never picks a disallowed tactic. — U `combat-stats`
14. Food choice matches the TABLES.md worked examples 1–7; golden apple only in an emergency; rotten flesh/spider eye/chicken/pufferfish only when starving. — U `combat-kb`, `combat-brain`

**Body (S3)**
15. No attack reaches the engine unless `attackTarget` passes its checks (not a player/never-target/tamed, reach ≤ 3, line of sight, no friendly on the ray); attack calls (`attackEntity`, plus at most one `attack()` fallback) exist only inside it. — U `adapter-body`, U `boundaries-p3`
16. A bot with a shield beats a skeleton with the shield raised for at least 10 ticks and ends with HP ≥ 6. — G `combat_skeleton_shield`, P `shield`
17. A bot never hits a player standing between it and a mob. — G `combat_never_hits_player`
18. A bot never hits a tamed wolf or its owner. — G `combat_ignores_tamed_wolf`
19. A bot survives a creeper (ends with HP ≥ 8, creeper gone) using the knockback/avoid tactics. — G `combat_creeper_survive`
20. Eating consumes exactly one food item and raises hunger, aborts after `useDuration + 10` ticks, and never creates items. — U `body-eating`, P `eating`
21. Equipment swaps conserve item counts under a failure at any of the four steps; durability-low gear is swapped for a spare, or the bot asks once in chat. — U `body-equipment`, M-06
22. Melee honours `attackIntervalTicks` and stops breaking before attacking. — U `body-melee`, P `attack`

**Snapshot (S4)**
23. The codec round-trips every serializable field of API-MAP D5 and reports every unserializable stack as excluded (`excludedTypeReason(typeId) !== undefined`, or an `ExcludeReason` for an unknown component or a serialization error); excluded stacks are never written to disk by dismiss/escape. — U `snapshot-excluded`, `snapshot-codec`
24. Snapshot writes are chunked at `snapshot.chunkChars`; a crash after any write step leaves the previous snapshot readable. — U `snapshot-store`, P `propsize`
25. No injected failure sequence (200 seeds) ever yields more items than were serialized, and each snapshot is restored at most once. — U `snapshot-conservation`
26. `!dismiss` removes the bot with no dropped items; `!summon` brings it back at the summoner's feet with an identical inventory, equipment and selected slot, and a second `!summon` does not duplicate it. — G `snapshot_dismiss_summon_conserves`, P `disconnect`, P `namereuse`
27. An escape (low HP, valuable cargo) makes the bot leave and rejoin under the same name at home (or the owner's feet) with identical items and no dropped items. — G `snapshot_escape_rejoin`
28. Snapshots are written on inventory change (or on the shortened timer if the event fails: `snapshot.fallbackIntervalTicks`) and at least every `snapshot.intervalTicks` (200). — U `snapshot-service`, P `invchange`
29. Idle bots self-dismiss after `idle.idleTicks`, depositing to the home/colony chest if reachable, else snapshotting. — U `snapshot-service` (FakeClock), M-03
30. After Save & Quit, bots rejoin with their inventories (owner online or home set); an excluded item (shulker box, filled map) gets the degradation notice (`excludedDropped` / log line). — M-01, M-10
31. A bot whose owner is offline and has no home stays dismissed until the owner returns or someone runs `!summon`. — U `snapshot-machine`, `colony-p3`, M-02

**Commands (S5)**
32. `!defend [radius]` creates a defend task at the sender's position; a zombie that enters the zone is killed; the bot stays within `radius + config.combat.defendLeashExtra`; passive mobs are not attacked; `!stop` and `!defend stop` end it. — G `defend_patrol_kills`, U `colony-p3`
33. Defenders protect a player under attack without ever hitting that player. — G `defend_protects_player`
34. `!home set`, `!summon`, `!dismiss`, `!recall` and `!status` parse and behave as S5 specifies (owner claim, offers, requeue, pinned offers). — U `commands-p3`, `colony-p3`
35. `!status` shows HP, hunger, gear, combat layer/option and threat, hidden when older than `statusStaleTicks`. — U `colony-p3`, M-07
36. Every new chat string equals the S5 table exactly and exists only in `messages.ts`. — U `messages-p3`, U `boundaries-p3`

**Verification, hygiene, process**
37. All 15 probes are registered as `/colony:probe <name>`, print `started` and exactly one `RESULT` line, clean up after themselves, and the Phase 1 probes and startup probe still pass. — U `probes-registry`, `probes-verdicts`, M-probes
38. Every judge function returns the verdict listed in §1.5 for each branch. — U `probes-verdicts`
39. All P0 probes (`disconnect invchange attack shield eating`) have a PASS result, or a FAIL whose `SET` fallback is applied and whose dependent GameTests then pass. — P
40. No `any`, no forbidden API, no `Math.random`/clock in the pure layers, and a single attack guard. — U `boundaries-p3`
41. Pure core files (`sense, brain, scoring, stats, codec, machine`, plus any other pure file with branching in `src/core/combat/` or `src/core/snapshot/`) reach ≥ 90 % branch coverage via the branch ledger, deterministically. — U `branch-ledger` + reviewer
42. Phase 1 and Phase 2 behaviour and tests are unchanged apart from mechanical edits (C8). — U + G (see 46)
43. The 21 GameTests of §2.2 are registered and the seven ★ ones (`combat_zombie_win`, `combat_never_hits_player`, `combat_harvester_resumes`, `snapshot_dismiss_summon_conserves`, `snapshot_escape_rejoin`, `p3_gather_under_stack`, `p3_never_attack_friendlies`) pass on a cheats-on dev world. — G, U `structures-p3`
44. `npm run check` passes (typecheck + vitest + build).
45. `PLAYTEST.md` has a Phase 3 section that lists every probe command, every GameTest, and every manual test `[M-01]`…`[M-15]`. — U `playtest-doc`

**Added in the revision pass (reviews + D16, D18, D20)**
46. Phase 2 regression (D16): the 8 existing Phase 2 GameTests (`chest_set`, `gather_logs`, `gather_two_bots`, `gather_cobble_craft`, `gather_no_source`, `goto_flat`, `goto_unreachable`, `override_flow`) pass unchanged with the controller wired in, and the review findings for the Phase 2 gather behaviour are listed in `docs/PHASE3-SPEC.md`. — G (all of `/gametest runset colony`), §2.6
47. Pause/resume during gather (D16): a gather paused by combat keeps `delivered + held` and resumes to completion; PLAYTEST §I (item pickup) is re-run on the 0.3.0 pack with a recorded result, and a gather with a mob nearby ends with the logs delivered. — G `combat_harvester_resumes`, `p3_gather_under_stack`, U `executor-pause`, M (PLAYTEST row AD)
48. Reflex lava exit: a bot standing in lava leaves it without an escape when the hazard lasts less than `lavaEscapeTicks` (continuous time, D28). — G `p3_reflex_lava`, U `controller`
49. Reflex drowning exit (air supply measured): a submerged bot reaches air before drowning; the air supply series is printed when readable. — G `p3_reflex_drown`, P `hunger` (step H4)
50. Reflex fire: a burning bot with water within reach extinguishes itself. — G `p3_reflex_fire`
51. Objective cargo dominates the escape decision: the same HP and threat escape with objective cargo and do not escape with an empty bag. — G `p3_haul_cargo_escape`, U `combat-brain`
52. Escape without a home rejoins at the owner's feet exactly once and delivers the objective haul (S4b §7). — G `p3_escape_owner_feet`, U `snapshot-service` (U12)
53. After a fight with HP below `recoverHp` the bot recovers (eat/regen) with the task paused, then returns to the task. — G `p3_recover_after_combat`
54. An idle bot far from its owner still defends itself and is not self-dismissed while fighting. — G `p3_idle_far_threat`, U `snapshot-service`
55. A bot never hits a villager, iron golem, tamed pet, armor stand or player standing next to a hostile mob. — G `p3_never_attack_friendlies`
56. The equipment manager takes a sword and a shield from the adjacent colony chest and nothing else. — G `p3_equip_from_chest`, U `body-equipment`
57. Tactic outcome stats are logged per fight and survive a world reload (`ColonyMeta.stats`). — U `outcome-stats`
58. Every MOBS Phase 3 entry and the default entry has a golden row (policy and first tactic). — U `mobs-golden`
59. Spider neutrality needs daylight (D18): neutral only when `isDaylight && lightLevel >= spiderNeutralLight` and unprovoked; probe P15 passes (or its `SET` token is applied). — U `combat-sense`, P `light`

---

## 6. PLAYTEST.md Phase 3 outline (B7 writes the section from this; text style as Phase 2: short checklists, **Record:** lines)

Insert after §4 Q (Phase 2). Continue the letters. Update §1 (pack version 0.3.0, delete the old pack first), §3 (commands table: `!defend [radius]|stop`, `!home [set]`, `!summon [bot|all]`, `!dismiss [bot|all]`, `!recall`, richer `!status`), and the "Things that are normal" list (bots now fight; they ignore players; Save & Quit now keeps bots). Heading line: `### Phase 3: combat I`. Add an intro paragraph: what changed, that a **second world** (cheats ON, flat) is needed for GameTests, that the play world stays **cheats OFF, Beta APIs ON**, and that fighting is real (a bot can die; keep armour/food in a chest for it).

| Section | Heading | What the player does by hand |
|---|---|---|
| R | Set up the test spot (10 min) | Normal-difficulty survival world; flat 21×21 patch for probes; a chest with iron gear, shield, bread/cooked beef; a night or a dark cave/mob farm for zombies; a tamed wolf and a villager nearby; a bed. Hostile mobs cleared around the probe spot. Difficulty **Normal**. |
| S | P0 probes (≈ 10 min) | Run in this order, one at a time, wait for the RESULT line, paste it: `/colony:probe disconnect`, `invchange`, `attack`, `shield`, `eating`. Each entry: what the bot does, what to watch (items on the ground after disconnect; shield visibly up; bot eating animation), what a FAIL line means (the `SET` token). |
| T | P1 probes (≈ 12 min) | `namereuse`, `movement`, `sneak`, `target`, `creeper` (stay > 12 blocks away; an explosion happens), `propsize`, `light` (**daytime only**: stand outdoors on open ground at time of day 0-11999; at night it prints INCONCLUSIVE, so wait for morning and run it again). |
| U | P2 probes (≈ 10 min) | `hunger` (stand within 24 blocks of water at least 3 deep, otherwise the air-supply step is skipped and the result says so), `lifecycle` (then the Save & Quit stage 2: [M-01] pairing), `shielddisabled`. |
| V | Combat by hand (15 min) | [M-04] warden-flee only if one is available (otherwise skip); zombie at night/in a dark room (bot wins, HP, kills it); skeleton (shield up, approaches); creeper (backs off, keeps ≥ 7 blocks, no damage to chests); spider; enderman unprovoked is left alone; [M-09] villager, iron golem, tamed wolf, you yourself standing in the line of fire are never hit; baby zombie; three zombies at once → retreat/escape; [M-08] read every bot chat line for wording and consistency; charged creeper only if a thunderstorm happens (otherwise skip), phantoms at night in the open ([M-05]). **Record:** per mob, what the bot did and its HP at the end. |
| W | Food, shield, gear (10 min) | Bot at low food eats a sensible item (bread vs cooked beef vs golden apple only in emergency); [M-06] gear in the chest is equipped (armour, shield, best sword), a nearly broken item is swapped or the bot asks in chat once. `!status` shows HP/gear/threat ([M-07]). |
| X | Tasks pause and resume (10 min) | `!gather oak_log 16` while a zombie walks up: the bot fights, then continues from the same count; `!goto` far away interrupted by a creeper and resumed; `!stop` mid-fight. |
| Y | New commands (10 min) | `!home set`/`!home`; `!defend 12` then a mob wanders in; `!defend stop`; `!summon`, `!dismiss`, `!recall` with and without home; wrong input + usage lines; offers with defend tasks (`!override`/`!queue`). |
| Z | Snapshots: items identical (15 min) | `!dismiss` then `!summon` with enchanted/named/damaged gear and a full inventory: compare item by item; check no item entities on the ground after dismiss; spam `!summon` twice; escape at low HP with valuable cargo (rejoins at home or at your feet with identical items); [M-03] idle self-dismiss (leave the bot alone for the idle timeout; `!summon` brings it back); [M-12] bot death and respawn; item fidelity (§7): give the bot an enchanted book, trimmed armour, a banner and a filled map, `!dismiss` then `!summon`, compare each stack and **Record:** what differed. |
| AA | Save & Quit and owner offline (10 min) | [M-01] Save & Quit with 2 bots holding items, reopen: bots rejoin with inventories (only after you are in the world); [M-10] an excluded item (shulker box, filled map) is dropped with the degradation notice and the `excludedDropped` line in the log (**Record:** notice text seen yes/no); [M-02] owner offline and no home → bot stays dismissed until you return or `!summon`. |
| AB | Stress and multiplayer (optional) | [M-13] item-count audit across a dozen dismiss/summon/escape cycles; [M-14] three bots fighting at once: any lag (**Record:** tick-rate impression); [M-15] friend present: friend's `!summon`/`!dismiss` and bots not attacking the friend. |
| AC | Automated GameTests (30 min) | Separate flat world, **cheats ON**, Beta APIs on, pack active, no bots. `/gametest runset colony`. List all 21 tests of §2.2 with one line each and mark the seven ★ ones (the `p3_escape_owner_feet` test needs you online and standing still, otherwise it skips); Phase 1/2 tests still included. `/gametest clearall 64` to clean up. Note: a failure message prints bot HP, `combatDebug` and the colony snapshot. |
| AD | Phase 2 re-run (10 min) | In the play world with the 0.3.0 pack: re-run Phase 2 PLAYTEST §I ("Do bots pick up drops?") exactly as written, then `!gather oak_log 8` with a zombie walking up while the bot gathers (gather with a mob nearby). Expected: pickups still work, the bot fights and the gather finishes with 8 logs in the chest. **Record:** §I result (pickup yes/no, delay), logs delivered, whether the bot lost any item. |

Manual test ids (each appears once in PLAYTEST as `[M-nn]` with a checklist): **M-01** Save & Quit rejoin with inventories; **M-02** owner offline and no home; **M-03** idle self-dismiss timer; **M-04** warden flee-sneak (skip if none available); **M-05** other Phase 3 mobs at least once each (witch, enderman, silverfish, slime/magma cube, phantom, drowned, pillager); **M-06** equipment from chest, durability swap or chat request; **M-07** `!status` content and staleness; **M-08** chat wording reads right and is consistent; **M-09** never attacks players, villagers, golems, tamed pets, armor stands; **M-10** excluded-item degradation notice on Save & Quit; **M-11** `!defend` with real players and real night mobs; **M-12** bot death/respawn clears the engagement and records a loss; **M-13** item-count audit (no duplication, no loss) across repeated flows; **M-14** performance with 3 bots fighting; **M-15** multiplayer behaviour.

§5 "What to send back" gets new lines: `R spot`, `S/T/U probes: paste every RESULT line verbatim (15 lines)`, `V combat: ok/notes per mob`, `W food/gear`, `X resume`, `Y commands`, `Z snapshots: items identical yes/no (what differed)`, `AA save&quit`, `AB stress`, `AC gametests: passed/failed + failure text`, `AD phase 2 re-run: §I result + gather with a mob`, `Content Log errors`. Most useful results: **S (P0 probes)**, **Z**, **AC**. §6 Troubleshooting gets rows for: probe says "stand on open flat ground"; probe INCONCLUSIVE "hostile mobs nearby"; bot vanished after `!dismiss` (use `!summon`); bot rejoined without items (report Z); GameTests all fail at once (world not flat/cheats off/bots present).

---

## 7. What cannot be tested automatically
- **Save & Quit / reload behaviour** (M-01, M-10, probe `lifecycle` stage 2, probe `reload`): needs a world reopen. Unit tests cover the restore logic against fakes only.
- **Feel of real combat**: knockback, hit timing, pathing around real terrain, night spawns, other mobs' special mechanics (M-05); GameTests cover a closed arena only.
- **Warden** (M-04), **thunderstorm/charged creeper**, **phantoms** in the open: no safe automated scene.
- **Idle self-dismiss** timer in the real engine (unit-tested with `FakeClock`, manual M-03).
- **Multiplayer** (M-15) and **owner offline** in the engine (M-02).
- **Chat readability** (M-08) and **performance** (M-14).
- **All 15 probes**: their verdict logic is unit-tested, but they only run in game.
- **Item-fidelity across versions** (enchanted book stored enchantments, trims, banners): only the excluded-stack list (`excludedTypeReason`) is testable.

**Manual coverage map.** Every item above has a checklist line with a **Record:** line in the §6 outline: Save & Quit, `lifecycle` stage 2 and `reload` → rows U and AA ([M-01], [M-10]); feel of real combat, thunderstorm/charged creeper, phantoms → row V ([M-05]); warden → row V ([M-04]); idle self-dismiss → row Z ([M-03]); multiplayer and owner offline → rows AB ([M-15]) and AA ([M-02]); chat readability → row V ([M-08]); performance → row AB ([M-14]); probes → rows S, T, U; item fidelity → row Z. The Phase 2 regression has its own manual row AD.

## 8. Open items for the contract writer
1. Create `test/support/p3-fakes.ts`, `test/boundaries-p3.test.ts`, `test/branch-ledger.test.ts` as specified (C5, C6).
2. Add the §1.4 config keys with defaults (C2); add `Rng` (C1); add `CombatDebug` (C4) and the runtime hooks (C3).
3. Confirm `ATTACK_GUARD_FN` with S3 (`attackTarget` in `src/game/adapter/body.ts`) and the `PropertyPort` (S4a) / `BodyActions` names used in §3.2 with S3/S4.
4. Confirm the ownership additions in C7 (probes index edit, gametest helpers/structures, `src/gametests/snapshot.ts`).
5. `src/game/adapter/body.ts` must exist (stub) with the single `attackTarget` engine-attack call site before `test/boundaries-p3.test.ts` is enabled, otherwise its single-attack-guard test fails on an empty list.
6. Confirm with S2 that the escape scenario of `snapshot_escape_rejoin` (HP 6, deathCost ≥ ~450: iron kit + 8 diamonds + objective logs, two zombies 7-8 blocks away, no food) triggers `escape_rejoin`; otherwise S2 adjusts the constants in that test.
7. Confirm with S5 that `!dismiss <bot>` on an ownerless GameTest bot needs no confirmation (S5 §4.4: it does not when the bot has no task or only the sender's task) and that `!summon <bot>` accepts a fake `Sender` without `dimensionId`.
8. Align `docs/PHASE3-SPEC.md` §6 ownership with §3.1 (S6 is authoritative for test file names): B1 also owns `test/combat-scoring.test.ts`; B2 `test/mobs-golden.test.ts`; B3 `test/executor-pause.test.ts`, `test/runtime-p3.test.ts`, `test/structures-p3.test.ts`; B4 `test/snapshot-excluded.test.ts`, `test/adapter-snapshot-io.test.ts`; B5 `test/outcome-stats.test.ts`, plus `src/probes/combat/light.ts`.
9. API-MAP must get: the P15 `light` row (D18); a "Fixture-only" section I listing `Dimension.spawnEntity`, `Entity.clearVelocity`, `Entity.remove`, `Entity.triggerEvent`, `Entity.setOnFire` (S:10519) and `GameTest.Test.setBlockType` (G:2085) next to the ones already named in §1.3; and the `minecraft:breathable` row (`airSupply` S:10890, `totalSupply` S:10955) or S1 drops it for the `inWater` fallback (D20; probe `hunger` step H4 verifies it).
10. S1 §10/§11 must carry the probe config keys of §1.4 (`combat.useTargetApi`, `effectDurationCountsDown`, `shieldDisabledSource`, `shieldCooldownCategory`, `spiderNeutralLight`), the `testReset`/`combatDebug` hooks (C3) and `isDaylight` on `ClassifyCtx`; S1 §10 `lavaEscapeTicks` is 20 (D17) and the lava escalation is continuous-hazard time (D28), which `p3_reflex_lava` asserts.
11. `p3_escape_owner_feet` assumes S4b `destOrder` falls back to the first online human when the sender is not a human (S4b destination table, `owner` row: "`snap.owner` else the first online human, sorted by name"); confirm with S4b.

---

## Revision log (review pass 1)

Binding decisions and cross-doc inputs applied first:
- DECISIONS D6: applied. `snapshot.timerTicks` removed from §1.4, §1.5 and DoD 28; the keys are `snapshot.intervalTicks` (200) and the S4a fallback `snapshot.fallbackIntervalTicks` (100).
- DECISIONS D16: applied. New §2.6 (Phase 2 regression block: the 8 existing GameTests, pause/resume during gather, PLAYTEST §I re-run), test `p3_gather_under_stack`, DoD 46 and 47, PLAYTEST row AD.
- DECISIONS D18: applied. New probe P15 `light` (§1.2 table, §1.4 row, §1.5 P1-g, `judgeLight`, `LightMeasure`, 19-value enum, PLAYTEST row T, DoD 59, B1.1 spider rows).
- DECISIONS D21 H6: applied (`snapshot.intervalTicks`; `idle.dismissTicks` -> `idle.idleTicks` in DoD 29; the two GameTest fixes; `combatDebug` gains `excludedDropped` and `summons`).
- DECISIONS D25: applied (the `.combat` view is S5's `BotStatusView` shape; header and §2.1 say so).
- DECISIONS D17 / D28 (via S1): `p3_reflex_lava` asserts the continuous-hazard rule; §8 item 10 tells the contract writer.
- S4b §12.1 fixes 1-4: applied to `snapshot_dismiss_summon_conserves` (shulker excluded and dropped once, `fingerprint(bot, [21])`, `excludedDropped`/`summons`, budgets, `presence` sequence). S4b §12.2 fixes 1-3: applied to `snapshot_escape_rejoin` (baseline item ids and marked stacks, `rejoining` then `live`, `escapes` +1, timeline). S4b §12.3 U1-U15: added as TC-B4.6.

Findings:
- S6-verification--completeness#1: applied (`p3_gather_under_stack` ★, DoD 46/47, PLAYTEST row AD with a Record line; named DoD items differ from the review's wording but keep its content)
- S6-verification--completeness#2: changed (four tests added: `p3_haul_cargo_escape`, `p3_escape_owner_feet`, `p3_recover_after_combat`, `p3_idle_far_threat`; there is no `escapeCargoThreshold` key (S2a uses `valueWeight`), so the haul test compares an empty-cargo bot with an objective-cargo bot at the same HP and threat; counts 11 -> 21 in §2.2, §2.5, DoD 43, PLAYTEST)
- S6-verification--completeness#3: changed (`test/mobs-golden.test.ts`, TC-B2.7, DoD 58; the percept preset is one shared preset and the rows assert policy and `tactics[0]` from the kb, since the brain's choice is covered by B1.4)
- S6-verification--completeness#4: applied (`p3_never_attack_friendlies` ★, DoD 55)
- S6-verification--completeness#5: changed (S1 §9 defines the reflexes lava, drowning, warden and fire only; there is no fall or void reflex, so `p3_reflex_lava`, `p3_reflex_drown`, `p3_reflex_fire` and DoD 48-50 were added and the fall item was skipped; warden stays M-04)
- S6-verification--completeness#6: applied (DoD 57, `test/outcome-stats.test.ts`, TC-B5.9)
- S6-verification--completeness#7: changed (the air-supply series is step H4 of the `hunger` probe, optional when no water is within 24 blocks, with `air` in `HungerMeasure` and a verdict rule; no separate probe; D20 left open in API-MAP so §8 item 9 asks for the breathable row)
- S6-verification--completeness#8: applied (`config.combat.defendLeashExtra`; no `config.combat.leash` remains)
- S6-verification--completeness#9: applied (`p3_equip_from_chest`, DoD 56; a note says S3 owns the fetch trigger)
- S6-verification--completeness#10: applied (the "Manual coverage map" after §7 and the Record lines added to rows V, Z, AA, AB)
- S6-verification--completeness#11: changed (the scope already names the six files; extended to any other pure branching file under `src/core/combat/` or `src/core/snapshot/`; the `npm run coverage` sentence was skipped because no such script exists and `package.json` cannot change)
- S6-verification--game-api#1: applied (Normal difficulty and the 3 HP hit stated in §2.1 and in `defend_protects_player`)
- S6-verification--game-api#2: applied (INCONCLUSIVE text of the `hunger` probe)
- S6-verification--precision#1: applied (`maxD <= 8 + config.combat.defendLeashExtra`, = 12; DoD 32)
- S6-verification--precision#2: applied (exact `MovementMeasure`, `dropReturned`, whole stack vs one item)
- S6-verification--precision#3: applied (exact judge table and exact `*Measure` types in §1.2 for all 15 probes)
- S6-verification--precision#4: changed (`attackCalls` counts only `"hit"`; `guardRejects` counts `"invalid"`, `"out_of_reach"`, `"no_los"` and `"cooldown"`)
- S6-verification--precision#5: changed (conflicts with logic#3; chose logic's 7-8 block zombies and made the cell choice deterministic with a fixed candidate list and a setup failure)
- S6-verification--precision#6: applied (`Math.max(1000, ...)` and the definition of `maxOk`)
- S6-verification--precision#7: applied (`minecraft:cooked_beef` prefix in §1.4 and §1.5; S3 §7 must use prefixed keys)
- S6-verification--precision#8: applied (`config.combat.provokeMemoryTicks`)
- S6-verification--precision#9: applied (`colony:probe*` prefix rule in C3)
- S6-verification--precision#10: changed (merged with logic#6: total, not necessarily consecutive, game ticks with `shieldState() === "up"`; the controller adds the ticks since its previous pump)
- S6-verification--precision#11: applied (`enterCombatEnv` reads the previous values and restores exactly those)
- S6-verification--precision#12: applied (rule 12 now lists files and allowed literals)
- S6-verification--precision#13: changed (`BotStatusView` has no `at` field; the assertion is: `combat` defined and `layer !== "combat"`, which holds because the runtime pushes on a layer change)
- S6-verification--precision#14: applied (greatest distance, tie order, setup failure)
- S6-verification--consistency#1: applied (`inventoryEvent` only; DoD 28 names `intervalTicks` and `fallbackIntervalTicks`)
- S6-verification--consistency#2: applied (same as precision#1; B1.2 leash equality uses `leashBlocks` and `defendLeashExtra`)
- S6-verification--consistency#3: applied (same as precision#8)
- S6-verification--consistency#4: changed (`PropertyStorePort` -> `PropertyPort`; `FakePropertyStore` implements S4a's actual methods `get`, `set` (undefined removes), `ids()`, `totalBytes()`, not a `remove` method, plus `failAfter`; §8 item 3)
- S6-verification--consistency#5: applied ("excluded" wording in B4.1, DoD 23, 30, M-10, §3.3, §7; "lossy" is gone)
- S6-verification--consistency#6: applied (B4 row lists `excluded.ts`, `snapshot-io.ts`, TC-B4.0 and the two new test files)
- S6-verification--consistency#7: applied (rule 7 sentence, `setOnFire` and `Test.setBlockType` added, §8 item 9 asks API-MAP for section I)
- S6-verification--consistency#8: applied (C3 "per S1 §11"; §8 item 10)
- S6-verification--consistency#9: changed (S6 is authoritative for test file names; the PHASE3-SPEC §6 edit is outside this file, listed as §8 item 8)
- S6-verification--consistency#10: applied (`BotStatusView` is credited to S1, in S5's shape)
- S6-verification--consistency#11: applied (the `hunger` row and verdict text)
- S6-verification--consistency#12: applied (keys stay in S6; §8 item 10 asks S1 §10 to carry them)
- S6-verification--logic#1: applied (assertion changed to "every call inside `attackTarget`, 1 or 2 calls" in the test and in rule 9 and DoD 15)
- S6-verification--logic#2: applied (same as precision#1)
- S6-verification--logic#3: applied (`ESCAPE_HP = 6`, zombies 7-8 blocks away, kit stacks carry `gt-` nameTags so marked items are counted instead of all item entities)
- S6-verification--logic#4: applied ("excluded")
- S6-verification--logic#5: applied (`okFrom` rule: first delay from which every longer delay works; `respawnDelayTicks` is never below 2)
- S6-verification--logic#6: applied (see precision#10)
