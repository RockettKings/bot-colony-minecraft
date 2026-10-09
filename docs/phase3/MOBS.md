# Phase 3 mob knowledge base (source for `src/core/combat/mobs.ts`)

Edition: Minecraft **Bedrock**, game 1.26.5x. Difficulty: **Normal** unless a value is given per difficulty. Bots are survival simulated players: iron sword, shield in offhand, armour, melee only (no bows until Phase 5). Bots fight mobs only, never players.

Tag `# (verify)` on a line = best-guess Bedrock value not confirmed from a primary source. The TS transcription should keep the value and add the field name to a `verify: string[]` on that entry (field name = the YAML key on the tagged line; for a tactic line use `tactics`, for notes use `notes`). Every `(verify)` is also a candidate for an in-game probe or the Phase 3 outcome logs. A line tagged `(assumed value, no probe; behaviour does not depend on it)` is NOT a verify tag: keep the value, do not add it to `verify[]`.

Section numbering follows the task list: 1 fields, 2 lists, 3 Phase 3 mobs, 4 Phase 5 stubs, 5 TACTICS catalogue, 6 default entry. Fields in section 3 reference tactics by name from **section 5**.

---

## 1. Field definitions

### 1.1 Units and shared constants
- Distances: blocks. Time: ticks (20 ticks = 1 s). Health: HP points (1 heart = 2 HP). Bot max HP = 20.
- Bot movement (approx.): walk 4.3 b/s, sprint 5.6 b/s, sneak/shield-up about 1.3 b/s (verify). Jump apex about 6 ticks after take-off; airborne about 12 ticks total on flat ground.
- Bot melee reach: 3 blocks eye-to-target-hitbox (verify). Most melee mobs reach about 2 blocks (verify).
- Bedrock has **no attack cooldown** (verify with the `attackEntity` probe) but a mob that was just damaged is invulnerable to equal-or-weaker damage for about **10 ticks** (verify). Minimum useful attack interval for the bot = 10 ticks. Config names: `config.body.meleeReach` (3.0) and `config.body.attackIntervalTicks` (10); there is no separate `MIN_ATTACK_INTERVAL_TICKS` constant in code.
- Critical hit = x1.5 damage, applies when the attacker is airborne and falling (y velocity < 0), not in water, not climbing. No sprint requirement in Bedrock (verify). No sweep attack in Bedrock.
- Sprint-hit knockback is larger than a standing hit; sprint is reset by the hit (verify).
- Weapon damage (Bedrock): wooden 4, gold 4, stone 5, iron 6, diamond 7, netherite 8 (verify). Axes: wooden 3, stone 4, iron 5, diamond 6, netherite 7 (verify). Axes disable an enemy shield for about 100 ticks (verify).
- Shield: blocks melee, arrows, tridents and (probably) explosions that come from the front 180 degrees arc while raised; does **not** stop potion splash, sonic boom, magic or poison/status damage. Bot raises shield = shield in offhand + `isSneaking = true` (unverified in-game; probe pending). Raise delay about 5 ticks (verify). While raised the bot moves at sneak speed.
- Hits to kill with an iron sword (6 dmg; 9 on a crit) are listed per mob in `notes`.

### 1.2 Per-mob entry fields
All entries use exactly these keys in this order (Phase 5 stubs and the default entry use a subset, see 4 and 6).

| Field | Type | Meaning / allowed values |
|---|---|---|
| `id` | string | Exact Bedrock id with `minecraft:` prefix. The entry's key in the table. |
| `variants` | string[] | Other ids that use this entry unchanged. `[]` if none. |
| `phase` | 0, 3 or 5 | Roadmap phase in which the bot actually fights it (0 only for the default entry in section 6). Phase 5 entries are avoid/flee stubs. |
| `hp` | number | Max health, HP points. |
| `attack_damage` | `{easy, normal, hard}` | Damage per hit in HP before armour. For ranged mobs: per projectile hit. For creeper: max explosion damage at point blank, unarmoured. |
| `attack_range_blocks` | number | Distance at which the mob can hurt the bot: melee reach, projectile range, or creeper ignition distance. |
| `move_speed` | enum | `slow`: a sprinting bot gains distance. `normal`: sprinting bot holds distance. `fast`: mob closes on a sprinting bot (cannot be outrun). Teleporters and fliers are `fast`. |
| `special` | enum[] | Mechanics, from the SPECIAL enum below. |
| `danger` | 0-10 | Threat to an iron-sword + shield + armour bot at full HP, one mob, open ground. 0 harmless, 3 routine, 5 real risk, 7 may kill without good tactics, 10 certain death. |
| `engage_policy` | enum | See ENGAGE_POLICY below. |
| `preferred_range_blocks` | `{min, max}` | Distance band the bot tries to hold from this mob when it is **not** executing a tactic strike step. `min: 0` means "melee range is fine". |
| `tactics` | list of `{name, when}` | Ranked best first. `name` = a name from section 5. `when` = a condition string from the CONDITION grammar (below). The decision loop takes the first tactic whose `when` is true and whose gear/preconditions in section 5 hold. |
| `counter_gear` | string[] | Gear that helps: `shield`, `sword`, `axe`, `armor`, `carved_pumpkin`, `food`, `milk_bucket`, `water_bucket`, `blocks`, `none`. Informational for the equipment manager. Phase 3 consumers read only the kinds `shield`, `bow`, `crossbow`, `trident`; all other kinds are documentation. |
| `do` | string[] | Concrete rules the loop must follow. |
| `dont` | string[] | Concrete rules the loop must never violate. |
| `flee_if` | list | Conditions that switch to `retreat_and_regen` / `sprint_away` / `flee_sneak` (per entry's tactics). Grammar below. |
| `notes` | string | Facts and rationale; not machine-used. |

### 1.3 ENGAGE_POLICY enum
- `engage`: fight when the mob targets the bot, blocks the objective (target block, path, chest), or is within 8 blocks and awake (it will chase anyway). Chase only inside the leash distance.
- `engage_if_blocking`: fight only when the mob is attacking/targeting the bot or blocks the objective. Never chase, never initiate.
- `avoid`: never initiate. Route around (`avoid_path_around`). If it targets the bot, use `tactics` only when escape is not possible; otherwise `retreat_and_regen`/`sprint_away`.
- `flee`: never fight. Only escape tactics. May trigger the colony escape-rejoin.

### 1.4 SPECIAL enum (allowed values)
`burns_in_daylight`, `breaks_doors_hard`, `inflicts_hunger`, `poison`, `slowness`, `weakness`, `explodes`, `teleports`, `gaze_aggro`, `water_vulnerable`, `ranged_projectile`, `throws_potions`, `self_heals`, `climbs_walls`, `jump_attack`, `splits_on_death`, `hides_in_blocks`, `calls_allies`, `flying`, `swoops`, `vibration_sensing`, `ignores_shield`, `ignores_armor`, `darkness_pulse`, `fire_immune`, `bad_omen_if_captain`, `neutral_in_daylight`, `pearl_aggro_endermen`.

### 1.5 CONDITION grammar
Used in `tactics[].when` and `flee_if`. A condition is a list of terms joined by `AND` and `OR` (uppercase, single spaces). `AND` binds tighter than `OR`. There are no parentheses and no `NOT` operator: negation exists only as the `not_` prefix on a boolean atom. A term is an atom, optionally prefixed `not_` (boolean atoms only) and optionally followed by `: N` (numeric atoms only). Examples: `not_mob_is_baby AND ground_flat AND count_at_least: 1`; `mob_in_water OR bot_in_water`; `hostile_count_at_least: 3 OR hp_below: 10` (parses as `a OR b`). No other atoms are allowed. A `flee_if` list is an implicit `OR` of its items.

State atoms (booleans): `always`, `mob_in_water`, `bot_in_water`, `mob_is_baby`, `mob_hissing` (creeper ignition started; if the API cannot read it, use `dist_below: 3` as a proxy), `mob_aggroed_on_bot`, `mob_has_los`, `bot_has_shield`, `bot_shield_disabled`, `has_cover_within_8`, `has_low_ceiling_within_8` (a 2-block-high space the bot can stand in), `has_roof_within_10`, `ground_flat` (no ledge/slope within 3 blocks of the planned fight spot), `mob_is_diving` (phantom in a swoop), `is_daylight`, `is_thunderstorm`, `mob_charged`, `mob_size_large`, `mob_size_medium`, `mob_size_small`, `target_is_objective_blocker`.

Numeric atoms: `hp_below: N`, `hp_at_least: N`, `dist_below: N`, `dist_at_least: N`, `count_at_least: N` (mobs of this type within 12 blocks), `hostile_count_at_least: N` (all hostile mobs within 12 blocks), `poisoned_and_hp_below: N`, `slowed_and_hp_below: N`, `wither_and_hp_below: N`, `shield_durability_below_pct: N`, `armor_durability_below_pct: N`.

Negation: prefix `not_` on any boolean atom (`not_bot_has_shield`).

### 1.6 Atom evaluation
Each atom is evaluated per (bot percept `p`, target `e`). `p` = `Percept`, `e` = `EntityPercept` (S1 section 1). Implementation: `evalCondition` in `stats.ts` (S2b section 6.1 is the executable form; this table is the contract it must match). Optional fields are the D2 additions; the fallback applies when the field is missing.

| Atom | Source | True when |
|---|---|---|
| `always` | n/a | always |
| `mob_in_water` | `e.inWater` | `e.inWater === true` (missing: false) |
| `bot_in_water` | `p.self.inWater` | true |
| `mob_is_baby` | `e.isBaby` | true |
| `mob_hissing` | `e.isIgnited`, `e.typeId`, `e.distance` | `e.isIgnited`, or (`e.typeId === "minecraft:creeper"` and `e.distance < 3`; the proxy) |
| `mob_aggroed_on_bot` | `e.targetingMe` | true |
| `mob_has_los` | `e.lineOfSight` | true |
| `bot_has_shield` | S2a `hasUsableShield(p)` | a shield is in the offhand (or a shield slot) with durability at least `config.combat.shieldMinDurabilityFrac` |
| `bot_shield_disabled` | `p.shieldDisabled` | `=== true` (missing: false) |
| `has_cover_within_8` | `p.terrain.coverWithin8` | true (missing: false) |
| `has_low_ceiling_within_8` | `p.terrain.lowCeilingWithin8` | true (missing: false) |
| `has_roof_within_10` | `p.terrain.roofWithin10` | true (missing: false) |
| `ground_flat` | `p.terrain.groundFlat` | true (missing: **true**) |
| `mob_is_diving` | `e.velocity`, `e.pos` | `e.velocity.y < -0.1` and the horizontal (x,z) distance from the bot to `e.pos` is below 8 |
| `is_daylight` | `p.env.isDaylight` | true |
| `is_thunderstorm` | `p.env.thunderstorm` | true |
| `mob_charged` | `e.isCharged` | true |
| `mob_size_large` / `_medium` / `_small` | `e.maxHp ?? e.hp`, else `e.aabb` | Only for `minecraft:slime` and `minecraft:magma_cube`; false for every other mob. By max HP `mh`: large `mh >= 9`, medium `3 <= mh < 9`, small `mh < 3` (size 4, 2, 1 have 16, 4, 1 HP). If `mh` is unknown use the box width `w = 2 * aabb.extent.x`: large `w >= 1.5`, medium `0.75 <= w < 1.5`, small `w < 0.75` (widths about 2.04, 1.02, 0.51). No hp and no box: large |
| `target_is_objective_blocker` | `e.relevance` | `=== "blocking_objective"` |
| `hp_below: N` / `hp_at_least: N` | `p.self.hp` | `hp < N` / `hp >= N` |
| `dist_below: N` / `dist_at_least: N` | `e.distance` | `< N` / `>= N` |
| `count_at_least: N` | threats of `e.typeId` | count within `config.combat.countRadius` (12) is `>= N` (includes `e`) |
| `hostile_count_at_least: N` | all threats | count within `config.combat.countRadius` (12) is `>= N` (includes `e`) |
| `poisoned_and_hp_below: N` | effect `minecraft:poison` | active and `hp < N` |
| `slowed_and_hp_below: N` | effect `minecraft:slowness` | active and `hp < N` |
| `wither_and_hp_below: N` | effect `minecraft:wither` | active and `hp < N` |
| `shield_durability_below_pct: N` | equipment | a shield is held and `round(durabilityFrac * 100) < N` |
| `armor_durability_below_pct: N` | equipment | at least one armour piece exists and the lowest `round(durabilityFrac * 100) < N` |

---

## 2. Lists

### 2.1 NEVER_TARGET
The bot never attacks these, never lets an area-attack tactic hit them, and never aims knockback at them. Tamed-ness is a runtime check (`minecraft:is_tamed` component present, verify exact API); an untamed member of a family is NOT in this list unless stated.

```yaml
NEVER_TARGET:
  always:
    - minecraft:player            # includes every colony bot (simulated players)
    - minecraft:villager_v2
    - minecraft:villager          # legacy id
    - minecraft:wandering_trader
    - minecraft:iron_golem
    - minecraft:snow_golem
    - minecraft:copper_golem      # (assumed value, no probe; behaviour does not depend on it) id is in @minecraft/vanilla-data 1.26.52
    - minecraft:allay
    - minecraft:npc
    - minecraft:armor_stand
  only_if_tamed:                  # runtime check: tamed -> never target; wild -> see sections 2.2 / 2.3
    - minecraft:wolf
    - minecraft:cat
    - minecraft:parrot
    - minecraft:horse
    - minecraft:donkey
    - minecraft:mule
    - minecraft:skeleton_horse
    - minecraft:zombie_horse
    - minecraft:llama
    - minecraft:trader_llama
    - minecraft:camel
    - minecraft:happy_ghast       # (verify) id
```

Named (name-tagged) hostile mobs are still hostile.

Additional hard rules:
- Never attack a mob that is currently fighting for a player (e.g. a wolf attacking a hostile). Do not hit it.
- Golems and tamed wolves may attack hostile mobs near the bot: do not block them or hit them by accident (check line of attack for friendlies).
- Never hit anything while the target ray passes through a friendly hitbox.

### 2.2 NEUTRAL_UNTIL_PROVOKED
Not a threat until the trigger. Before the trigger: ignore, keep out of the trigger condition, and path around. After the trigger: treat as hostile via the entry in section 3 where one exists, else via `response`.

```yaml
NEUTRAL_UNTIL_PROVOKED:
  - id: minecraft:enderman
    aggro_when: bot looks at its head/face (gaze), or bot/any player damages it
    response: section 3 entry (avoid; low_ceiling_fight if cornered)
    never: lookAtEntity on it, hit it first, hit an endermite near it
  - id: minecraft:zombie_pigman        # zombified piglin (Bedrock id)
    aggro_when: any player or bot damages one; all in about 16 blocks aggro together (verify range)
    response: sprint_away; fight only with shield_hold if already surrounded
    never: hit first; hit one in a group; break blocks next to a sleeping group
  - id: minecraft:bee
    aggro_when: damaged, or its hive/nest is broken or smoked wrong, or bot stands at a nest harvesting
    response: sprint_away 12+ blocks; a stung bot gets poison
    never: hit bees; break bee_nest/beehive
  - id: minecraft:wolf                 # wild
    aggro_when: damaged by the bot or any player; the whole pack joins (neutral wolves become angry for the provoker)
    response: shield_hold, fight 8 HP wolves with melee_strafe; wolf damage easy 3 / normal 4 / hard 6 (verify)
    never: hit a wild wolf first; hit one that is being fed or tamed by a player
  - id: minecraft:polar_bear
    aggro_when: bot comes near its cub, or damages it
    response: sprint_away (bear is fast on ice); polar bear hp 30, damage 4/6/9 (verify)
    never: approach cubs
  - id: minecraft:llama
    aggro_when: damaged (spits); wild llamas follow caravans
    response: ignore spit (1 dmg), move away
    never: hit it
  - id: minecraft:trader_llama
    aggro_when: its wandering trader is damaged; then it attacks the attacker
    response: move away
    never: hit the trader or llamas
  - id: minecraft:spider
    aggro_when: provoked (the bot damages it), or NOT (`is_daylight` AND light level at its feet >= 12). It is neutral only when both hold (D18); unknown light = hostile. Light 12 per config `spiderNeutralLight`; probe P15 (light semantics)
    response: section 3 entry
  - id: minecraft:cave_spider
    aggro_when: ALWAYS hostile in Bedrock regardless of light (verify)
    response: section 3 entry
  - id: minecraft:piglin
    aggro_when: bot wears no gold armour piece, opens chests, mines gold-ore/gold blocks near it, or damages one; group aggros
    response: section 4 stub (avoid); Nether only
  - id: minecraft:goat
    aggro_when: random ram at players/mobs within range, not provoked
    response: keep >5 blocks; shield_hold absorbs the ram; damage 2/2/3 + big knockback (verify), knockback can push bot off ledges/into lava
    never: stand on an edge near a goat
  - id: minecraft:dolphin
    aggro_when: damaged by the bot
    response: ignore
    never: hit
  - id: minecraft:panda
    aggro_when: only the "aggressive" personality is aggro when hit; others neutral
    response: ignore
    never: hit
  - id: minecraft:iron_golem            # listed here only as a warning: NEVER_TARGET, but it attacks players who damaged a villager or itself
    aggro_when: bot damages a villager/golem
    response: sprint_away; never retaliate
  - id: minecraft:fox
    aggro_when: damaged, or when it is hunting passive animals (not the bot)
    response: ignore
  - id: minecraft:pufferfish
    aggro_when: touched in water -> poison + nausea + hunger
    response: leave water area; do not melee
  - id: minecraft:sulfur_cube          # newer mob, id in @minecraft/vanilla-data 1.26.52; behaviour unknown (verify)
    aggro_when: damaged by the bot
    response: ignore; path around
    never: hit
  - id: minecraft:nautilus             # newer mob, id in @minecraft/vanilla-data 1.26.52; behaviour unknown (verify)
    aggro_when: damaged by the bot
    response: ignore
    never: hit
```

Transcription note: `minecraft:iron_golem` stays in NEVER_TARGET. Keep it in this list only as a "do not provoke" marker (set `neverTarget: true` in TS). `minecraft:cave_spider` is not neutral: it is a threat (section 3) and is not part of `NEUTRAL_UNTIL_PROVOKED`. `minecraft:iron_golem` and `minecraft:cave_spider` are the only two entries in 2.2 that are not copied to `NEUTRAL_UNTIL_PROVOKED_IDS`.

### 2.3 IGNORE
Passive mobs. Never a threat, never targeted, never chased. They only matter as obstacles for pathing and as shield-line-of-fire friendlies.

```yaml
IGNORE:
  - minecraft:chicken
  - minecraft:cow
  - minecraft:mooshroom
  - minecraft:pig
  - minecraft:sheep
  - minecraft:rabbit
  - minecraft:turtle
  - minecraft:frog
  - minecraft:tadpole
  - minecraft:axolotl
  - minecraft:glow_squid
  - minecraft:squid
  - minecraft:cod
  - minecraft:salmon
  - minecraft:tropicalfish
  - minecraft:bat
  - minecraft:ocelot
  - minecraft:armadillo
  - minecraft:sniffer
  - minecraft:strider
  - minecraft:fox                # unless provoked, see 2.2
  - minecraft:horse              # wild; tamed see 2.1
  - minecraft:donkey
  - minecraft:mule
  - minecraft:camel
  - minecraft:parrot
  - minecraft:cat
```

---

## 3. Phase 3 mobs

Key for tactic parameters: see section 5. All `danger` values assume one mob, iron sword, shield, iron-or-better armour.

```yaml
id: minecraft:zombie
variants: []                      # baby zombie = same id; check the is_baby runtime flag
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}
attack_range_blocks: 2
move_speed: slow                  # baby: fast (see notes)
special: [burns_in_daylight, breaks_doors_hard]
danger: 2
engage_policy: engage
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: melee_crit
    when: not_mob_is_baby AND ground_flat AND count_at_least: 1
  - name: melee_strafe
    when: mob_is_baby
  - name: shield_hold
    when: count_at_least: 3
  - name: hit_and_back_off
    when: always
counter_gear: [sword, shield, armor]
do:
  - Fight on open flat ground or in a corridor so only 1-2 zombies reach the bot at once.
  - Kill babies first; they are fast (see notes) and hit as hard as adults.
  - In daylight, after breaking line of sight a zombie in sun burns; retreat into shade to let it burn if not blocking.
  - Pick up drops after the fight only when no other hostile is within 12 blocks.
dont:
  - Do not fight with the back to a drop/lava/water edge (knockback).
  - Do not chase beyond the leash into unlit caves.
  - Do not stand in a doorway on Hard difficulty; zombies break wooden doors (Hard only).
flee_if: [hp_below: 8, count_at_least: 5, armor_durability_below_pct: 10]
notes: >
  Iron sword: 4 hits (3 with a crit). Bedrock zombies do NOT summon reinforcements as far as known (verify; Java does on Hard). Treat count_at_least: 5 as flee anyway.
  Baby zombie (is_baby): speed about 1.5x adult (about 0.35 vs 0.23 attribute, verify) = outruns sprinting bot, smaller hitbox, 20 HP, same damage. Chicken jockeys possible.
  Zombies pick up items and may carry gear. They burn in daylight unless under a roof/water/helmet. Hunger-free; easy kill; main risk is crowds in the dark.
```

```yaml
id: minecraft:husk
variants: []
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}
attack_range_blocks: 2
move_speed: slow
special: [inflicts_hunger, breaks_doors_hard]
danger: 3
engage_policy: engage
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: melee_crit
    when: not_mob_is_baby AND ground_flat
  - name: melee_strafe
    when: mob_is_baby
  - name: shield_hold
    when: count_at_least: 3
  - name: hit_and_back_off
    when: count_at_least: 2
counter_gear: [sword, shield, armor, food]
do:
  - Fight like a zombie; kill before it lands a second hit to limit Hunger.
  - After each fight, eat if the food bar is below 14 (Hunger drains the food bar; verify).
  - Husk packs at desert temples/villages come at night: prefer shield_hold in a corridor.
dont:
  - Do not rely on natural regeneration while Hunger is active.
  - Do not retreat to burn it; husks do not burn in daylight.
flee_if: [hp_below: 8, count_at_least: 5]
notes: >
  Immune to daylight burn. Hit applies Hunger (about 7 s on Normal, scaled with difficulty; assumed value, no probe; behaviour does not depend on it). 4 iron-sword hits (3 crits).
  Desert only (and temples/villages). Same base stats as the zombie.
```

```yaml
id: minecraft:drowned
variants: []
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}      # trident throw: about 8 (verify)
attack_range_blocks: 2                            # trident variant: 12 (verify)
move_speed: slow                                  # in water: normal-fast (swims faster than the bot) (verify)
special: [ranged_projectile, water_vulnerable]
danger: 3                                         # in water: 6
engage_policy: engage                             # only when BOTH bot and drowned are on land; else avoid
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: avoid_path_around
    when: mob_in_water OR bot_in_water
  - name: shield_hold
    when: dist_at_least: 5 AND mob_has_los
  - name: melee_crit
    when: ground_flat
  - name: hit_and_back_off
    when: always
counter_gear: [sword, shield, armor]
do:
  - Fight only with both on solid ground; lure it onto land by standing 3+ blocks from the shoreline, then strike.
  - If it holds a trident (visible main hand), raise the shield and close the distance zigzag; trident hits hard.
  - Drowned drop tridents/nautilus shells; picking them up is fine but only after the fight.
dont:
  - Do not enter water to fight; swimming bots lose reach, shield and crit, and drowned grab and drag.
  - Do not stand on a one-block ledge above deep water.
flee_if: [hp_below: 8, bot_in_water AND hp_below: 12, count_at_least: 4]
notes: >
  Spawns in deep water and, at night, from zombie drowning conversion. On land behaves like a zombie.
  Trident carriers (about 6-15% of spawns, verify) throw tridents at up to about 12 blocks; shield blocks them.
  Does not burn in daylight (verify once with the first drowned seen); do not use `burns_in_daylight` for it.
  Drowned in water: danger 6, engage_policy avoid; only fight if it blocks the objective AND the bot has air.
```

```yaml
id: minecraft:zombie_villager_v2
variants: [minecraft:zombie_villager]
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}
attack_range_blocks: 2
move_speed: slow                  # baby variant: fast
special: [burns_in_daylight, breaks_doors_hard]
danger: 2
engage_policy: engage
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: melee_crit
    when: not_mob_is_baby AND ground_flat
  - name: melee_strafe
    when: mob_is_baby
  - name: shield_hold
    when: count_at_least: 3
counter_gear: [sword, shield, armor]
do:
  - Treat exactly like a zombie.
  - Kill it; curing (golden apple + weakness) is out of scope.
dont:
  - Do not confuse with a living villager (minecraft:villager_v2): a villager is NEVER_TARGET. Match the exact id.
flee_if: [hp_below: 8, count_at_least: 5]
notes: >
  Same stats as zombie. Four iron-sword hits (3 crits). Found in villages after zombie sieges, in igloo basements and ruined villages.
```

```yaml
id: minecraft:spider
variants: []
phase: 3
hp: 16
attack_damage: {easy: 2, normal: 2, hard: 3}
attack_range_blocks: 2
move_speed: fast
special: [climbs_walls, jump_attack, neutral_in_daylight]
danger: 3
engage_policy: engage
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: melee_strafe
    when: ground_flat AND not_mob_is_baby
  - name: shield_hold
    when: count_at_least: 3
  - name: hit_and_back_off
    when: always
counter_gear: [sword, shield, armor]
do:
  - Fight on flat ground away from walls; a spider on a wall or ceiling jumps onto the bot from above.
  - Stand with a block behind (not a ledge) so the spider cannot flank; move out of 3-block-high gaps it can climb.
  - In daylight with light level >= 12 at the spider's feet (`is_daylight` AND `lightLevel >= 12`, D18) leave it alone unless it has attacked the bot. At night, or in a dark cave in daytime, it is hostile.
dont:
  - Do not fight at the base of a cliff or tree where it can climb above the bot.
  - Do not try to outrun it; it is as fast as a sprinting bot.
flee_if: [hp_below: 8, count_at_least: 4]
notes: >
  Wide hitbox (1.4) but only 0.9 tall. Leaps at its target from about 4 blocks (jump_attack). Neutral only when `is_daylight` AND light level at its feet >= 12 (config `spiderNeutralLight`; probe P15), until hit; unknown light = hostile.
  3 iron-sword hits (2 crits). Spider jockeys: skeleton on top shoots; kill the skeleton first with shield up.
```

```yaml
id: minecraft:cave_spider
variants: []
phase: 3
hp: 12
attack_damage: {easy: 2, normal: 2, hard: 3}      # (verify)
attack_range_blocks: 1.5
move_speed: fast
special: [poison, climbs_walls, jump_attack]
danger: 4
engage_policy: engage
preferred_range_blocks: {min: 1.5, max: 3}
tactics:
  - name: retreat_and_regen
    when: poisoned_and_hp_below: 8
  - name: hit_and_back_off
    when: poisoned_and_hp_below: 12
  - name: melee_strafe
    when: always
counter_gear: [sword, shield, armor, milk_bucket, food]
do:
  - Kill each in 2 hits (6 dmg x 2 on 12 HP); do not wait to be bitten.
  - After a bite, keep fighting only while hp_at_least: 8; poison cannot kill (it stops at 1 HP) but disables regen.
  - Treat a mineshaft spawner (cobwebs, small spiders) as a hot zone; avoid the room unless it blocks the objective.
dont:
  - Do not stay in a 1-wide tunnel with cave spiders on both sides; they fit through 1-block gaps.
  - Do not eat spider eyes or poisoned food to "cure" poison.
  - Do not stand in cobwebs (mineshafts); never fight beside the spawner without a roof.
flee_if: [poisoned_and_hp_below: 8, count_at_least: 4]
notes: >
  Poison I: Easy none, Normal about 7 s, Hard about 15 s (verify). Bedrock cave spiders are hostile in any light (verify). Hitbox 0.7x0.5 can enter 1-block gaps.
  Only spawns in mineshaft spawners in the Overworld. Milk or food-based cures not required for Phase 3.
```

```yaml
id: minecraft:skeleton
variants: []
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}      # arrow, (verify)
attack_range_blocks: 15
move_speed: normal
special: [ranged_projectile, burns_in_daylight]
danger: 4
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: break_line_of_sight
    when: not_bot_has_shield AND has_cover_within_8
  - name: shield_advance_zigzag
    when: bot_has_shield AND dist_at_least: 6
  - name: melee_strafe
    when: dist_below: 4
  - name: shield_hold
    when: count_at_least: 2
  - name: retreat_and_regen
    when: hp_below: 10
  - name: break_line_of_sight
    when: always
counter_gear: [shield, sword, armor]
do:
  - Close in with the shield up (or zig-zag if the shield is down) and finish with melee_strafe at 2-3 blocks.
  - Use cover: if arrows land, step behind a block, then approach along cover until within 4 blocks, then sprint the rest.
  - In daylight, break line of sight and let it burn unless it blocks the objective.
  - Face the shooter while the shield is up; arrows from the side or behind are not blocked.
dont:
  - Do not run in a straight line away or toward it at range 6-15; arrows hit.
  - Do not stand still in the open at 6-15 blocks without a shield.
  - Do not fight on a 1-block-wide ledge (skeleton arrow knockback).
flee_if: [hp_below: 8, count_at_least: 4, shield_durability_below_pct: 10 AND count_at_least: 2]
notes: >
  Strafes while shooting. Shot interval about 1-3 s (verify). Arrow hits are about 1-6 depending on difficulty and draw (verify). Aims at the target's current position: lateral motion dodges.
  Burns in daylight unless under a roof or wearing a helmet. 4 iron-sword hits (3 crits). Skeleton horse traps (thunderstorm) = 4 armed skeletons: flee.
  Axe cannot be used by skeletons; shield-disable not a threat.
  No shield, no cover, dist >= 4: every tactic's Pre fails and the section 5 fallback runs (D15: `hit_and_back_off`, i.e. a charge). This is accepted: standing still at 6-15 blocks is worse. The same holds for stray and bogged.
```

```yaml
id: minecraft:stray
variants: []
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 3, hard: 4}
attack_range_blocks: 15
move_speed: normal
special: [ranged_projectile, slowness, burns_in_daylight]
danger: 5
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: break_line_of_sight
    when: not_bot_has_shield AND has_cover_within_8
  - name: shield_advance_zigzag
    when: bot_has_shield AND dist_at_least: 6
  - name: melee_strafe
    when: dist_below: 4
  - name: shield_hold
    when: count_at_least: 2
  - name: retreat_and_regen
    when: hp_below: 10
  - name: break_line_of_sight
    when: always
counter_gear: [shield, sword, armor, milk_bucket]
do:
  - Same as skeleton. Slowness arrows make zig-zag and retreat slower: prefer the shield approach.
  - After a slowness hit, stop sprinting plans; shield_hold until the effect ends, or break_line_of_sight.
dont:
  - Do not commit to a long open-ground approach when slowed.
flee_if: [hp_below: 8, slowed_and_hp_below: 12, count_at_least: 3]
notes: >
  Spawns in snowy biomes (snow plains, ice spikes, frozen oceans). Arrows apply Slowness I (about 30 s; assumed value, no probe; behaviour does not depend on it). Burns in daylight (assumed, verify).
  4 iron-sword hits (3 crits). The slowness makes sprint_away unreliable: avoid being in the open.
```

```yaml
id: minecraft:bogged
variants: []
phase: 3
hp: 16
attack_damage: {easy: 2, normal: 3, hard: 4}
attack_range_blocks: 15
move_speed: normal
special: [ranged_projectile, poison, burns_in_daylight]
danger: 5
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: break_line_of_sight
    when: not_bot_has_shield AND has_cover_within_8
  - name: shield_advance_zigzag
    when: bot_has_shield AND dist_at_least: 6
  - name: melee_strafe
    when: dist_below: 4
  - name: retreat_and_regen
    when: poisoned_and_hp_below: 8
  - name: break_line_of_sight
    when: always
counter_gear: [shield, sword, armor, milk_bucket]
do:
  - Same as skeleton; poison arrows make every hit cost health over time (stops at 1 HP).
  - When poisoned, finish the fight quickly (3 sword hits, 2 crits) then retreat_and_regen.
dont:
  - Do not stay at range 6-15 in the open without a shield.
flee_if: [hp_below: 8, poisoned_and_hp_below: 8, count_at_least: 3]
notes: >
  Swamps and mangrove swamps; also trial chambers. Arrows apply Poison I (about 4-6 s; assumed value, no probe; behaviour does not depend on it). Burns in daylight (assumed, verify).
  16 HP: 3 iron-sword hits (2 crits). Dropped mushrooms; shearing is not a Phase 3 action.
```

```yaml
id: minecraft:pillager
variants: []
phase: 3
hp: 24
attack_damage: {easy: 4, normal: 5, hard: 6}      # crossbow arrow, (verify)
attack_range_blocks: 15                           # (verify)
move_speed: fast                                  # (verify)
special: [ranged_projectile, bad_omen_if_captain]
danger: 5
engage_policy: engage_if_blocking
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: shield_advance_zigzag
    when: bot_has_shield AND dist_at_least: 6
  - name: break_line_of_sight
    when: not_bot_has_shield AND has_cover_within_8
  - name: melee_strafe
    when: dist_below: 4
  - name: retreat_and_regen
    when: hp_below: 10
counter_gear: [shield, sword, armor]
do:
  - Fight only if it targets the bot or blocks the objective.
  - Crossbow reloads for about 1.25 s (25 ticks, verify) after each shot: advance during reload, raise shield when it aims.
  - A patrol (3-5 pillagers) = hostile_count_at_least: 3 -> break line of sight and withdraw.
dont:
  - Never kill the banner-carrying patrol captain / outpost captain unless it is attacking the bot and no alternative exists: it gives Bad Omen (starts a raid at a village).
  - Do not approach a pillager outpost (cages, crossbow towers) unless it is the objective.
flee_if: [hp_below: 10, hostile_count_at_least: 3, count_at_least: 3]
notes: >
  Crossbow shots hit from further than skeleton arrows and with more damage; they ignore nothing, so a raised shield blocks them.
  24 HP: 4 iron-sword hits (3 crits). Patrol captain carries an ominous banner; drops it on death (verify).
```

```yaml
id: minecraft:creeper
variants: []
phase: 3
hp: 20
attack_damage: {easy: 22, normal: 43, hard: 64}   # max point-blank explosion damage, unarmoured, (verify)
attack_range_blocks: 3                            # ignition starts at 3 blocks; blast damage radius about 6
move_speed: normal
special: [explodes]
danger: 6
engage_policy: engage_if_blocking
preferred_range_blocks: {min: 7, max: 16}
tactics:
  - name: shield_hold
    when: mob_charged AND mob_aggroed_on_bot AND bot_has_shield AND dist_below: 4
  - name: sprint_away
    when: mob_charged AND mob_aggroed_on_bot
  - name: knockback_then_retreat
    when: mob_aggroed_on_bot AND not_mob_charged
  - name: avoid_path_around
    when: not_mob_aggroed_on_bot
counter_gear: [shield, sword, armor]
do:
  - If the creeper is not targeting the bot or blocking the objective, route around it at 7+ blocks.
  - If it is blocking or chasing, use knockback_then_retreat: sprint-hit it once at 2.5-3 blocks, then back away to 7+ blocks within 24 ticks (otherwise shield_hold) and wait for the hiss to stop, then repeat. Three or four cycles kill it.
  - If a creeper is within 3 blocks and hissing, retreat at once; shield_hold only as a last resort.
  - While harvesting, a creeper within 8 blocks pauses the task; keep the shield raised while mining only if the creeper is within 8 blocks and aggroed.
dont:
  - Never fight a creeper in a 1-wide tunnel or a closed room (no retreat space, blast bounces).
  - Never melee a charged creeper; just leave (blast radius doubles).
  - Never place TNT or lead a creeper near chests, beds or the home.
  - Do not stand next to a creeper during a thunderstorm (lightning charges it).
flee_if: [mob_charged, hp_below: 12, hostile_count_at_least: 3]
notes: >
  Fuse about 30 ticks (1.5 s) from the moment it starts hissing within 3 blocks of its target; it stops and the fuse winds down if the target gets beyond about 6 blocks (verify both).
  Explosion power 3 (blast and block damage radius 3; entity damage reaches about 6 blocks, falling off with distance). Charged creeper: power 6 (verify). Bedrock explosion damage scales by difficulty (about 22 / 43 / 64 max, verify).
  A raised shield facing the creeper reduces or blocks explosion damage (verify; do not rely on it). Armour with Blast Protection helps; plain armour reduces by ~20-60%.
  4 iron-sword hits (3 crits). Creepers flee from cats/ocelots; not a bot tool. Sprint-hit knockback is the key defensive lever. Cat-scared creepers will not be baited.
  API caveat: if the creeper's ignition state cannot be read, use dist_below: 3 as the hissing proxy and assume the fuse started when it came within 3 blocks.
```

```yaml
id: minecraft:witch
variants: []
phase: 3
hp: 26
attack_damage: {easy: 6, normal: 6, hard: 6}      # Instant Damage I splash (verify)
attack_range_blocks: 10                           # (verify)
move_speed: normal
special: [ranged_projectile, throws_potions, poison, slowness, weakness, self_heals]
danger: 5
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: rush_kill
    when: hp_at_least: 12
  - name: retreat_and_regen
    when: poisoned_and_hp_below: 8
  - name: break_line_of_sight
    when: hp_below: 12
counter_gear: [sword, armor, milk_bucket, food]
do:
  - Rush in a straight sprint (do not zigzag; it wastes closing time) and keep attacking; kill within 3-5 hits.
  - After the kill, eat and wait out poison/slowness before resuming.
  - Leave witch huts alone unless they block the objective.
dont:
  - Do not waste time raising a shield: splash potions are not blocked.
  - Do not stand and trade at range 5-10; its poison/slowness/weakness stack.
  - Do not fight it while another hostile is attacking; leave first.
flee_if: [hp_below: 8, poisoned_and_hp_below: 8, slowed_and_hp_below: 12, count_at_least: 2]
notes: >
  Throws splash: Poison I if target HP >= 8 and not already poisoned (about 45 s, verify), Slowness I at range, Weakness I when adjacent, Instant Damage I otherwise (about 6 HP, verify). Choices follow Java logic; Bedrock likely the same (verify).
  Drinks potions to counter: healing when low, speed when the target is far, fire resistance when burning, water breathing in water. Drinking takes about 1-3 s during which it does not throw.
  Poison cannot kill (stops at 1 HP) but halts regen. 26 HP: 5 iron-sword hits (3 crits). Spawns in swamp huts and as raid members; also from lightning striking a villager.
```

```yaml
id: minecraft:enderman
variants: []
phase: 3
hp: 40
attack_damage: {easy: 4, normal: 7, hard: 10}     # (verify)
attack_range_blocks: 2
move_speed: fast
special: [teleports, gaze_aggro, water_vulnerable]
danger: 8
engage_policy: avoid
preferred_range_blocks: {min: 16, max: 32}
tactics:
  - name: avoid_path_around
    when: not_mob_aggroed_on_bot
  - name: low_ceiling_fight
    when: mob_aggroed_on_bot AND has_low_ceiling_within_8
  - name: shield_hold
    when: mob_aggroed_on_bot AND bot_has_shield AND dist_below: 4
  - name: retreat_and_regen
    when: hp_below: 12
  - name: hit_and_back_off
    when: mob_aggroed_on_bot AND dist_below: 4
  - name: shield_hold
    when: always
counter_gear: [carved_pumpkin, shield, sword, armor]
do:
  - Never look at its face. Do not call lookAtEntity on it while it is within 64 blocks and not aggroed. If a look target is needed, aim at the ground a block in front of the mob or at its feet (y below its eye line), or look at the feet position.
  - If a carved pumpkin is in the inventory, wear it as a helmet while in a zone with endermen (a pumpkin on the head prevents gaze aggro); never craft one, and swap back to the helmet afterwards.
  - If an enderman is within 20 blocks and not aggroed, path away (avoid_path_around radius 16) and keep the camera pointed at the ground or away.
  - If aggroed: step into a 2-block-high space (low_ceiling_fight), or fight with the shield up and attack only when it has just hit the shield.
  - It teleports behind the bot; keep the back to a wall.
dont:
  - Do not attack it first, and do not hit it with arrows/projectiles (provokes).
  - Never fight in the open with 2+ endermen.
  - Do not fight in water or rain for protection: it teleports away and returns; only treat water as a hazard for it, not a tactic.
  - Do not break eye contact by turning the head quickly toward it; pitch down.
flee_if: [hp_below: 12, count_at_least: 2, hostile_count_at_least: 3]
notes: >
  Aggro on gaze: the bot's view direction within the face hit region at up to 64 blocks (Bedrock check uses the player's look vector and the mob's head; verify range). Simulated players have a real head rotation, so lookAtEntity on it triggers aggro.
  40 HP: 7 iron-sword hits (5 crits). It hits for 7 Normal about once per second: a straight brawl costs the bot most of its HP, hence danger 8.
  Cannot enter spaces under about 3 blocks tall (2.9). Takes damage from water/rain (1 per tick of contact, verify) and teleports away. Teleports when hit by projectiles. Avoid mining next to one.
  Endermen attack endermites; endermites do not matter to the bot.
```

```yaml
id: minecraft:slime
variants: []
phase: 3
hp: 16                                            # size 4 (large); medium 4; small 1
attack_damage: {easy: 3, normal: 4, hard: 6}      # large; medium 2/2/3; small 0 (verify)
attack_range_blocks: 2
move_speed: slow
special: [splits_on_death, jump_attack]
danger: 3
engage_policy: engage_if_blocking
preferred_range_blocks: {min: 2.5, max: 3}
tactics:
  - name: hit_and_back_off
    when: mob_size_large
  - name: melee_crit
    when: mob_size_medium
  - name: melee_strafe
    when: mob_size_small
  - name: avoid_path_around
    when: not_mob_aggroed_on_bot
counter_gear: [sword, shield, armor]
do:
  - Large slime (size 4): hit and step back; it hops once per ~20 ticks and only damages on landing contact.
  - Each death spawns 2-4 of the next size; kill mediums with 1-2 hits, ignore smalls (0 damage) unless blocking.
  - Fight on flat ground in the swamp or below Y 40 in slime chunks; kill all medium slimes before they surround.
dont:
  - Do not chase slimes beyond the leash; they are slow and harmless unless contacted.
  - Do not fight in a pit where 6+ small slimes can pile on knockback.
flee_if: [hp_below: 8, hostile_count_at_least: 6]
notes: >
  Large 16 HP / medium 4 HP / small 1 HP. 3 hits for large (2 crits), 1 per medium/small. Spawns in swamps at night (Y 51-70) and in slime chunks below Y 40 (verify).
  Small slimes deal no damage but block movement and still knock back. Slimeball drops from small ones.
```

```yaml
id: minecraft:magma_cube
variants: []
phase: 3
hp: 16                                            # large; medium 4; small 1
attack_damage: {easy: 4, normal: 6, hard: 9}      # large; medium 3/4/6; small 2/3/4 (verify)
attack_range_blocks: 2
move_speed: slow
special: [splits_on_death, jump_attack, fire_immune]
danger: 4
engage_policy: engage_if_blocking
preferred_range_blocks: {min: 3, max: 4}
tactics:
  - name: hit_and_back_off
    when: mob_size_large
  - name: avoid_path_around
    when: always
counter_gear: [sword, shield, armor]
do:
  - Overworld relevance: they do not spawn in the Overworld naturally; only handle one that came through a portal or sits on the objective.
  - Fight only on solid, non-lava ground; use hit_and_back_off.
dont:
  - Never fight next to lava (it is fire immune and its knockback pushes the bot in).
  - Do not chase.
flee_if: [hp_below: 10, hostile_count_at_least: 4]
notes: >
  Nether only (basalt deltas, nether fortresses, lava lakes). Bedrock sizes match slime splits. Large 3 sword hits; small cubes still deal damage (unlike slime smalls). Phase 5 will own Nether combat.
```

```yaml
id: minecraft:silverfish
variants: []
phase: 3
hp: 8
attack_damage: {easy: 1, normal: 1, hard: 1}
attack_range_blocks: 1.5
move_speed: normal
special: [hides_in_blocks, calls_allies]
danger: 2
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: melee_strafe
    when: always
counter_gear: [sword, armor]
do:
  - Kill any silverfish in sight immediately (2 hits); a hurt one wakes nearby infested blocks.
  - When a silverfish appears, stop mining and breaking stone-type blocks (stone, cobblestone, stone bricks, mossy, cracked, chiseled, deepslate variants): the neighbours may be infested.
  - After the area is clear, resume mining; do not resume until no silverfish remain within 12 blocks.
dont:
  - Do not break more stone-type blocks next to a revealed infested block.
  - Do not fight in a spot where it can slip into a wall (block hiding).
flee_if: [hp_below: 8, count_at_least: 6]
notes: >
  8 HP: 2 iron-sword hits. Damage 1 per hit; the danger is the swarm in strongholds and in mountain infested blocks. It merges back into stone blocks.
  Bedrock has silverfish_wake_up_friends and silverfish_merge_with_stone behaviours (verify). Infested blocks look like normal stone; break time is faster (cannot be used as a fair-information tell).
```

```yaml
id: minecraft:endermite
variants: []
phase: 3
hp: 8
attack_damage: {easy: 2, normal: 2, hard: 2}
attack_range_blocks: 1.5
move_speed: normal
special: [pearl_aggro_endermen]
danger: 1
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: melee_strafe
    when: always
counter_gear: [sword]
do:
  - Kill it (2 hits). It despawns after about 2 minutes (verify).
dont:
  - Do not use ender pearls near it or while endermen are around.
flee_if: [hp_below: 6]
notes: >
  Appears when a thrown ender pearl lands (about 5% chance, verify). Endermen attack endermites: if an enderman is aggroed on the endermite, step back and avoid looking at either.
```

```yaml
id: minecraft:phantom
variants: []
phase: 3
hp: 20
attack_damage: {easy: 2, normal: 4, hard: 6}      # (verify)
attack_range_blocks: 2
move_speed: fast
special: [flying, swoops, burns_in_daylight]
danger: 4
engage_policy: engage
preferred_range_blocks: {min: 0, max: 3}
tactics:
  - name: take_cover_overhead
    when: hostile_count_at_least: 3 OR hp_below: 10
  - name: swoop_counter
    when: bot_has_shield
  - name: melee_crit
    when: mob_is_diving AND not_bot_has_shield
counter_gear: [shield, sword, armor]
do:
  - Hold the shield up when a phantom starts a dive; attack once it is within 2.5 blocks after the swoop.
  - Seek a roof when three or more are circling; phantoms do not attack under solid cover but wait outside.
  - In daylight they burn; staying under a roof until sunrise is acceptable.
dont:
  - Do not stand in the open on a hill at night with the shield down.
  - Do not chase them up; they fly higher than the bot can jump.
flee_if: [hp_below: 8, count_at_least: 5]
notes: >
  Spawn above a player after about 3 in-game days (72000 ticks) without sleeping, at night under open sky (verify that this "time since rest" counter exists for simulated players). Bots do not sleep; expect phantoms on long night jobs.
  Circle at about 15-20 blocks then dive; two dives per cycle. 20 HP: 4 iron-sword hits (3 crits). Shield blocks dive damage; a phantom that overshoots hits again on the next pass.
  Harmless inside a covered tunnel or building.
```

```yaml
id: minecraft:warden
variants: []
phase: 3
hp: 500
attack_damage: {easy: 16, normal: 30, hard: 45}   # melee; (verify)
attack_range_blocks: 3                            # melee; sonic boom 15 (verify)
move_speed: fast
special: [vibration_sensing, ignores_shield, ignores_armor, darkness_pulse]
danger: 10
engage_policy: flee
preferred_range_blocks: {min: 30, max: 64}
tactics:
  - name: flee_sneak
    when: not_mob_aggroed_on_bot
  - name: sprint_away
    when: mob_aggroed_on_bot AND dist_at_least: 10
  - name: avoid_path_around
    when: always
counter_gear: [none]
do:
  - Warden message or Darkness effect or a sculk shrieker sound => stop mining, placing, jumping, sprinting and fighting at once; set sneaking and leave.
  - Set `isSneaking = true`, walk away from the darkness source and away from sculk blocks; keep the warden as far as possible. Never walk over sculk sensors, sculk shriekers or calibrated sculk sensors; avoid sculk veins and catalysts.
  - If targeted by the warden within 10 blocks, trigger the colony escape-rejoin (snapshot, disconnect, respawn at home/owner) instead of fighting.
  - Treat any deep dark (Y below 0, ancient city) as a no-go zone for mining and exploration.
dont:
  - Never attack it; its HP is 500 and one hit does 30.
  - Never shoot, break blocks, place blocks, open chests, throw items, jump or sprint within 20 blocks while it is not aggroed on the bot.
  - Do not break sculk sensors or sculk shriekers (breaking makes vibrations and can summon). Do not place or break blocks near a shrieker.
  - Do not use a shield: sonic boom ignores shields.
flee_if: [always]
notes: >
  Blind; senses vibrations (walking, jumping, block break/place, combat, item use; sneaking is silent) and smell within about 6 blocks. Becomes angry at the source of noise; anger rises with each detected sound.
  Melee 30 Normal can one-shot a half-health bot; armour reduces it but not enough. Sonic boom: about 10 damage, range about 15 blocks horizontal, bypasses armour and shield (Bedrock numbers verify); it fires at range when it has a target and is not adjacent.
  Darkness: it pulses the Darkness effect to players within about 20 blocks every few seconds (verify); this is the alarm that a warden is near.
  Spawns from a sculk shrieker only in the Deep Dark / ancient city when it shrieks enough times (a 4th activation, verify), and spawns in ancient cities. It digs out slowly (emerge about 5 s) giving a short head start. Loses interest when it cannot detect the bot for a while.
  Speed is about the same as a sprinting bot (verify), so outrunning in the open is unreliable; breaking contact (sneak) and distance are the only defences.
```

---

## 4. Phase 5 mobs (stubs; flee/avoid only until Combat II)

Use these entries in the decision loop as danger and engage policy only; no tactics yet.

```yaml
id: minecraft:blaze
phase: 5
danger: 6
engage_policy: avoid
notes: Nether fortress. Fire immune, fireball volleys (fire + damage). Never fight in Phase 3.
```
```yaml
id: minecraft:ghast
phase: 5
danger: 7
engage_policy: avoid
notes: Nether. Fireball explodes (power 1 + fire); 10 HP, flies. Out of Phase 3 scope; avoid the Nether.
```
```yaml
id: minecraft:piglin
phase: 5
danger: 4
engage_policy: avoid
notes: Nether. Neutral if the bot wears a gold armour piece; otherwise hostile. Group aggro. Do not open chests or mine gold near it.
```
```yaml
id: minecraft:piglin_brute
phase: 5
danger: 8
engage_policy: flee
notes: Bastion remnant. Always hostile (ignores gold armour), axe damage 7/13/16 (verify). Flee.
```
```yaml
id: minecraft:hoglin
phase: 5
danger: 6
engage_policy: avoid
notes: Nether. 40 HP, strong knockback, tusk attack 5/6/8 (verify). Avoid; zombifies in the Overworld.
```
```yaml
id: minecraft:zoglin
phase: 5
danger: 6
engage_policy: avoid
notes: Zombified hoglin. Hostile to everything nearby, 40 HP. Avoid.
```
```yaml
id: minecraft:vindicator
phase: 5
danger: 7
engage_policy: avoid
notes: 24 HP, axe damage 7 / 13 / 19 on Easy / Normal / Hard (verify). Disables shields (axe). Mansion/raid member. Avoid; flee from groups.
```
```yaml
id: minecraft:evocation_illager
phase: 5
danger: 7
engage_policy: avoid
notes: Mansion/raid (Java name "evoker"; the Bedrock id is evocation_illager, D19). Fangs (entity `minecraft:evocation_fang`) and summons vex. Avoid; leave the area.
```
```yaml
id: minecraft:vex
phase: 5
danger: 5
engage_policy: avoid
notes: Flying, passes through blocks, 14 HP, sword; summoned by evokers. Avoid.
```
```yaml
id: minecraft:ravager
phase: 5
danger: 9
engage_policy: flee
notes: 100 HP, massive knockback, raid mob. Flee.
```
```yaml
id: minecraft:guardian
phase: 5
danger: 5
engage_policy: avoid
notes: Ocean monument; underwater laser. Avoid water near monuments.
```
```yaml
id: minecraft:elder_guardian
phase: 5
danger: 8
engage_policy: flee
notes: Ocean monument. Mining Fatigue III on sight; strong laser. Flee.
```
```yaml
id: minecraft:breeze
phase: 5
danger: 6
engage_policy: avoid
notes: Trial chambers. Wind charges (knockback), leaps. Avoid.
```
```yaml
id: minecraft:creaking
phase: 5
danger: 6
engage_policy: avoid
notes: Pale garden. Frozen while seen, invulnerable until its creaking heart is destroyed (verify). Avoid.
```
```yaml
id: minecraft:shulker
phase: 5
danger: 5
engage_policy: avoid
notes: End cities. Levitation bullets; 30 HP, shell armour. Avoid.
```
```yaml
id: minecraft:wither_skeleton
phase: 5
danger: 7
engage_policy: avoid
notes: Nether fortress. Wither effect on hit; 3 ft tall. Avoid. Decision pending from Jaycob (ROADMAP Phase 3 says "skeleton family"); default = avoid, kept as a Phase 5 stub. It never spawns in the Overworld.
```
```yaml
id: minecraft:wither
phase: 5
danger: 10
engage_policy: flee
notes: Boss. Flee at once; skulls explode, wither effect, blasts blocks.
```
```yaml
id: minecraft:ender_dragon
phase: 5
danger: 10
engage_policy: flee
notes: Boss in the End. Flee; never enter The End in Phase 3.
```
```yaml
id: minecraft:parched
phase: 5
danger: 4
engage_policy: avoid
notes: Newer skeleton-family archer (id confirmed in @minecraft/vanilla-data 1.26.52; stats unknown, verify). Treat as a ranged mob: avoid, break line of sight.
```
```yaml
id: minecraft:camel_husk
phase: 5
danger: 4
engage_policy: avoid
notes: Newer husk-family mob, usually mounted (id confirmed in vanilla-data 1.26.52; stats unknown, verify). Avoid.
```
```yaml
id: minecraft:zombie_nautilus
phase: 5
danger: 4
engage_policy: avoid
notes: Newer undead water mob (id confirmed in vanilla-data 1.26.52; stats unknown, verify). Avoid; stay out of deep water.
```

Drift rule: every hostile entity id in `@minecraft/vanilla-data` (`mojang-entity.d.ts`) must appear in exactly one of: a section 3 or 4 entry, `NEVER_TARGET`, `NEUTRAL_UNTIL_PROVOKED`, `IGNORE`. A unit test `test/mobs-drift.test.ts` (S6 owns it) fails and prints the missing ids when one does not; an id in no list falls to the default entry (section 6) unseen otherwise.

---

## 5. TACTICS catalogue

Common rules for every tactic:
- **Selection:** walk the entry's `tactics` in order; take the first whose `when` is true AND whose `Gear` and `Pre` hold. A tactic runs only if its `Gear` and `Pre` hold. It aborts when any `Abort` holds, handing control back to the decision loop (which may pick `retreat_and_regen`).
- **Fallback (D15):** if no tactic of the entry is eligible (every `when` false, or every eligible one fails `Gear`/`Pre`), the executor uses the first of: `hit_and_back_off` if melee is allowed (engage policy `engage` or `engage_if_blocking` with the mob attacking or blocking, a weapon or fists in hand, and `hit_and_back_off` `Gear`/`Pre` hold); else `avoid_path_around`; else `sprint_away`. Unarmed means fist damage 1 and the same tactics (D14).
- `Interval` = minimum 10 ticks between attacks (Bedrock invulnerability window, verify).
- Never attack if the line passes through a NEVER_TARGET hitbox.
- All timings are ticks; all distances blocks, measured bot feet to mob feet unless stated.

### melee_crit
- Gear: sword (any), armour. Shield optional.
- Pre: `ground_flat`; target on the same Y level (within 1 block); no ceiling lower than 3 blocks over the fight spot; not more than 2 melee enemies.
- Steps:
  1. Approach to 3.5 blocks (sprint).
  2. Jump when the target is at 3.0-3.5 blocks (tick 0).
  3. At tick 7-11 (y velocity < 0, bot falling, target within 3 blocks): attack. This is the crit window.
  4. Land (about tick 12-13), stand still 0 ticks (no sprint reset needed) and repeat from step 2 as soon as at least 10 ticks have passed since the last hit and the target is within 3.5.
  5. Strafe sideways 1 block on landing ticks if the target is a melee mob preparing to hit.
- Abort: hp_below the entry's `flee_if`; a ranged mob enters line of sight; target dist_at_least: 6; 3+ attackers.
- Note: airborne bots take knockback poorly; do not use next to a drop.

### melee_strafe
- Gear: sword, armour.
- Pre: target within 6 blocks.
- Steps:
  1. Hold 2.5-3 blocks from the target.
  2. Circle sideways (alternate direction every 12-15 ticks) while facing the target.
  3. Attack when the target's reach is closed or just after it attacks; max once per 10 ticks.
  4. If it closes to under 2 blocks, step back about 1 block (4 ticks, one pump) then attack.
- Abort: hp_below per entry; 3+ attackers (switch to shield_hold); target out of reach for 40 ticks (leash).

### hit_and_back_off
- Gear: sword.
- Pre: target hits harder than the bot wants to trade (slimes, spiders, hordes), or knockback is useful.
- Steps:
  1. Sprint-hit the target (knockback).
  2. Immediately walk backwards 2 blocks in 10 ticks (4.3 b/s = 0.215 b/tick, so 10 ticks = 2.15 blocks), keeping the target in front.
  3. Wait until the target re-enters 3.5 blocks; if it does not within 40 ticks, abort.
  4. Repeat.
- Abort: hp_below; terrain behind the bot has a drop within 3 blocks; stuck against a wall.

### shield_advance_zigzag
- Gear: shield (offhand, durability at least 20%), sword.
- Pre: ranged attacker with LOS at distance 6-15; clear ground between.
- Steps:
  1. Raise shield (sneak) and face the shooter. Time to raise: about 5 ticks.
  2. Advance at sneak speed while keeping the shield facing it; every 20 ticks sidestep 1 block left or right in alternation to break the aim.
  3. At 6 blocks, drop the shield and sprint zigzag (8-tick lateral swings) to 3 blocks.
  4. Switch to melee_strafe.
- Abort: shield_durability_below_pct 10; new attacker from the side or behind; hp_below 8; more than 2 shooters (use break_line_of_sight).

### shield_hold
- Gear: shield, sword.
- Pre: bot can stand with its back covered.
- Steps:
  1. Raise shield facing the highest-threat mob (nearest attacker or shooter).
  2. When it hits the shield (or after its attack windup ends), drop the shield, attack once (the mob is in its cooldown), and re-raise within 5 ticks.
  3. Repeat. If more than one attacker, hold the shield toward the strongest and accept the weaker.
- Abort: shield_durability_below_pct 10; a shield-disabling attacker (axe) is present; bot hp_below the entry flee value; no regen is possible.
- Note: does not stop splash potions, sonic boom, magic or poison.

### knockback_then_retreat
- Gear: sword, armour; shield optional.
- Pre: the creeper is not charged; the bot has 7+ blocks of open retreat path; the creeper is alone.
- Steps:
  1. Sprint to within 2.5 blocks of the creeper (approach from its side if possible).
  2. At tick 0 sprint-hit it (sprint knockback sends it back 2-3 blocks).
  3. Ticks 1-24: back away to 7+ blocks (start immediately; sprint speed 5.6 b/s = 0.28 b/tick, so 24 ticks cover about 6.7 blocks plus the 2-3 blocks of knockback, i.e. 7+ blocks from the creeper). Keep the creeper in view. If the distance is still below 7 at tick 24, go to the Fallback (shield_hold).
  4. If the fuse started (hissing) the explosion occurs at tick 30 after ignition; the bot's distance must exceed 6 before then so the fuse winds down (that is why the retreat budget is 24 ticks, 6 ticks of margin).
  5. When the creeper stops hissing and is within 7-9 blocks, repeat from step 1. Kill takes 3-4 cycles.
- Abort: hp_below 12; the creeper becomes charged; the retreat path is blocked; a second hostile attacks.
- Fallback: if retreat is impossible and it is within 3 and hissing, shield_hold facing the creeper and accept reduced damage.

### low_ceiling_fight
- Gear: sword, shield optional. Optional: carved pumpkin on head.
- Pre: `has_low_ceiling_within_8`: a 2-block-high space (tunnel, notch under blocks) the bot can enter within 8 blocks; the enderman is aggroed.
- Steps:
  1. Move into the 2-high space (do not look at the enderman while moving; look at the floor).
  2. Stand with at least one solid block wall behind the bot and the opening toward the enderman.
  3. The enderman cannot enter (needs about 3 blocks of height); it hovers at the opening. Attack only when it is within reach (3 blocks) and has just attacked; hold the shield between.
  4. Repeat attacks every 10-20 ticks; retreat deeper if it is out of reach.
- Abort: hp_below 12; a second enderman; it teleports into reach and the bot cannot withstand 2 hits.
- Note: verify in-game that the enderman cannot enter the 2-block gap and that melee reach works.

### rush_kill
- Gear: sword, armour.
- Pre: target within 12 blocks; hp_at_least 12; no other hostile engaged.
- Steps:
  1. Sprint in a straight line at the target.
  2. On reaching 3 blocks, melee_crit or attack every 10 ticks.
  3. Chase (up to 6 blocks) if it drinks speed; stop after 60 ticks if not within reach.
  4. After the kill, retreat_and_regen if poisoned or slowed.
- Abort: poisoned_and_hp_below 8; slowed_and_hp_below 12; another hostile joins; hp_below 8.

### swoop_counter
- Gear: shield, sword.
- Pre: phantom within 16 blocks; the bot is outside, with open ground around.
- Steps:
  1. Watch for the dive: phantom y dropping and approaching at under 8 horizontal blocks.
  2. About 10 ticks before contact, raise the shield facing it (bot rotates to face it).
  3. After the pass (phantom within 2.5 blocks or moving away), lower the shield and attack once if it is within reach and below eye level + 1.
  4. Re-raise the shield for the next dive (it circles for about 100-200 ticks, verify).
- Abort: hostile_count_at_least 3; hp_below 10 (switch to take_cover_overhead).

### break_line_of_sight
- Gear: none.
- Pre: `has_cover_within_8`.
- Steps:
  1. Pick the nearest solid block (or wall) such that a ray from the shooter to the bot's eyes and feet is blocked.
  2. Move there by the shortest unexposed path; stop 1 block behind it.
  3. Wait up to 40 ticks (shooters reposition).
  4. Advance along the cover to within 4 blocks of the shooter, then sprint the last 4 blocks (exposure about 14 ticks).
- Abort: a second shooter flanks; cover is destroyed; hp_below 8 (switch to retreat_and_regen).

### retreat_and_regen
- Gear: food optional.
- Pre: any.
- Steps:
  1. Sprint away from the threats until out of line of sight and at least 16 blocks away (or past the leash), preferably toward home/owner.
  2. Stop sprinting once beyond 12 blocks of every hostile.
  3. Eat the highest-saturation food (per the food table) until hunger is full enough to regenerate (about 18 of 20); natural regen then runs.
  4. Resume only when `hp_at_least: config.combat.recoverHp` (16 HP) and no hostile within `config.combat.countRadius` (12) blocks.
- Abort: new hostile within 8 blocks and targeting the bot (switch to flee/escape logic).

### flee_sneak
- Gear: none.
- Pre: a warden (or unknown vibration-sensing mob) is nearby and not aggroed on the bot.
- Steps:
  1. Tick 0: stop all actions (mining, placing, jumping, sprinting, item use).
  2. Set `isSneaking = true`.
  3. Walk away from the warden/darkness source at sneak speed, avoiding sculk sensors, shriekers and calibrated sensors; leave the Deep Dark region by the shortest route.
  4. When 30+ blocks away and the Darkness effect has ended, resume.
- Abort: warden is aggroed on the bot and within 10 blocks -> sprint_away / colony escape-rejoin.

### avoid_path_around
- Gear: none.
- Pre: a mob that the entry says to avoid.
- Steps:
  1. Mark a no-go circle around the mob (radius: enderman 16, creeper 8, warden 30, phantom none, others 6).
  2. Re-plan the path every 20 ticks, treating the circle as impassable.
  3. If no route exists, wait up to 100 ticks or ask for override.
- Abort: the mob targets the bot (switch to its tactics list); the path stays blocked after 100 ticks.

### sprint_away
- Gear: none.
- Pre: threat approaches faster or equal; open ground.
- Steps:
  1. Face away from the mob, sprint (jump only over obstacles).
  2. Prefer a path that breaks line of sight within 40 ticks.
  3. Continue until 24+ blocks away or the colony escape-rejoin is triggered.
- Abort: the mob is `fast` and within 3 blocks (cannot outrun): turn and use the entry's other tactic or escape-rejoin.

### take_cover_overhead
- Gear: none.
- Pre: `has_roof_within_10`: a block-roofed area (tunnel, cave, building) within 10 blocks.
- Steps:
  1. Move under a solid roof (at least 2 blocks above) by the shortest path.
  2. Wait there (shield up toward the open side) until the threat leaves or it is daytime.
  3. Resume the task after 200 ticks without sightings.
- Abort: other hostile mobs inside the cover.

---

## 6. Default entry for unknown hostile mobs

Applies to any mob with the `monster` family not found in this table (mods, new versions) and not in NEVER_TARGET/IGNORE.

A provoked `minecraft:wolf` and a provoked `minecraft:zombie_pigman` (zombified piglin; `zombie_pigman` is its Bedrock id, `@minecraft/vanilla-data`) use this default entry. This is intended in Phase 3. `test/mobs-golden.test.ts` gets one golden row for each (provoked wolf, provoked zombie_pigman: expect `engage_policy: avoid`, first tactic `shield_hold` when aggroed with a shield at under 4 blocks).

The section 5 fallback (D15) applies to this entry too: if no tactic is eligible, `avoid_path_around` (the default entry is `avoid`, so melee is not allowed), else `sprint_away`.

```yaml
id: default
variants: []
phase: 0
hp: 20
attack_damage: {easy: 3, normal: 5, hard: 7}
attack_range_blocks: 3
move_speed: normal
special: []
danger: 6
engage_policy: avoid
preferred_range_blocks: {min: 8, max: 24}
tactics:
  - name: avoid_path_around
    when: not_mob_aggroed_on_bot
  - name: shield_hold
    when: mob_aggroed_on_bot AND bot_has_shield AND dist_below: 4
  - name: retreat_and_regen
    when: hp_below: 12
  - name: sprint_away
    when: mob_aggroed_on_bot AND dist_at_least: 6
counter_gear: [shield, sword, armor]
do:
  - Do not initiate; route around at 8+ blocks.
  - If it attacks the bot, shield up, retreat toward home/owner, fight only to clear a blocked path.
  - Log the outcome (damage taken, time, result) so Phase 8 and the table can learn it.
dont:
  - Do not assume it is passive because it has not attacked yet.
  - Do not chase it.
flee_if: [hp_below: 12, count_at_least: 2, hostile_count_at_least: 3]
notes: Conservative defaults; replace with a real entry once the mob is added to this file.
```

---

## Revision log (review pass 1)

Decisions applied: D15 (fallback, section 5 intro and section 6), D18 (spider: neutral only when `is_daylight` AND light >= 12; sections 2.2, 3 spider, 1.6), D19 (`minecraft:evocation_illager`).

- MOBS--completeness#1: changed (D15 wins: fallback order is `hit_and_back_off` if melee allowed, else `avoid_path_around`, else `sprint_away`; the finding's `melee_strafe` / `sprint_away` order is not used; written in section 5 and section 6)
- MOBS--completeness#2: applied (new section 1.6 atom-evaluation table; mob_size thresholds follow S2b 6.1: max HP primary, box width fallback 0.75/1.5)
- MOBS--completeness#3: applied (OR in the section 1.5 grammar; the S3 union change is owned by S3's reviser and S3 already parses OR)
- MOBS--completeness#4: applied (wither_skeleton stays a Phase 5 stub; "Decision pending from Jaycob; default = avoid" added)
- MOBS--completeness#5: applied (D19; `evoker` entry renamed; S1 section 6.1 is another reviser's file)
- MOBS--completeness#6: applied (stubs `parched`, `camel_husk`, `zombie_nautilus`; `sulfur_cube`, `nautilus` in 2.2; drift rule and test name `test/mobs-drift.test.ts` added, S6 owns the test; ids confirmed in vanilla-data 1.26.52)
- MOBS--completeness#7: applied (section 6 note; golden rows for provoked wolf and zombie_pigman; Bedrock id is `zombie_pigman`, there is no `zombified_piglin` in vanilla-data)
- MOBS--completeness#8: applied (counter_gear sentence in 1.2)
- MOBS--consistency#1: applied (grammar rewritten in 1.5; the S3 l.321 note is S3's file)
- MOBS--consistency#2: applied (`config.combat.recoverHp` = 16 in retreat_and_regen step 4)
- MOBS--consistency#3: applied (`config.combat.countRadius` (12) in retreat_and_regen step 4)
- MOBS--game-api#1: applied (D19)
- MOBS--game-api#2: skipped (stale: the cave_spider `do` / `dont` / `notes` already describe a cave spider: 12 HP, 2 hits, mineshaft spawners; no zombie_villager text present). Cheap part applied: cobweb / spawner `dont` line added
- MOBS--game-api#3: changed (spider neutrality wording now follows D18: `is_daylight` AND light >= 12, config `spiderNeutralLight`, probe P15; in 2.2, the spider entry `notes` and `do`)
- MOBS--game-api#4: applied (drowned does not burn in daylight; verify once with the first drowned seen)
- MOBS--game-api#5: applied (copper_golem, husk Hunger, stray Slowness, bogged Poison now "assumed value, no probe; behaviour does not depend on it"; header line 5 says these are not verify tags)
- MOBS--logic#1: changed (cave_spider order: `retreat_and_regen` (poisoned < 8), `hit_and_back_off` (poisoned < 12), `melee_strafe` always; the 8 rule also moved above the 12 rule, otherwise it was shadowed)
- MOBS--logic#2: applied (spider: `shield_hold` before `hit_and_back_off always`)
- MOBS--logic#3: changed (creeper list: charged+aggroed+shield+<4 -> `shield_hold`; charged+aggroed -> `sprint_away`; aggroed+not charged -> `knockback_then_retreat`; not aggroed -> `avoid_path_around`; the unreachable hissing `shield_hold` row removed, its case is the `knockback_then_retreat` Fallback)
- MOBS--logic#4: changed (enderman: `hit_and_back_off` when `mob_aggroed_on_bot AND dist_below: 4`, then `shield_hold always`; "provoked" is not an atom, aggroed is used)
- MOBS--logic#5: applied (skeleton, stray: `retreat_and_regen hp_below: 10` then `break_line_of_sight always`; bogged: `break_line_of_sight always` after its existing retreat; note on the D15 charge when no cover exists)
- MOBS--logic#6: applied (`not_mob_is_baby AND` on husk and zombie_villager `melee_crit`; husk also gets `melee_strafe` for babies and `shield_hold` moved before `hit_and_back_off count>=2`, which shadowed it)
- MOBS--logic#7: applied (hit_and_back_off: 2 blocks in 10 ticks, arithmetic shown)
- MOBS--logic#8: applied (creeper retreat budget 24 ticks, otherwise `shield_hold`; arithmetic shown)
- MOBS--logic#9: skipped (the pillager `hp_below: 10` and bogged `poisoned_and_hp_below: 8` flee_if items are not redundant: the matching tactic rows come after earlier rows that shadow them, so flee_if is the only reliable trigger)
- MOBS--precision#1: applied (grammar, same text as consistency#1)
- MOBS--precision#2: changed (mob_size definition in 1.6 uses max HP first and the box second, to match S2b 6.1; box threshold 0.75 instead of 0.8)
- MOBS--precision#3: applied (`config.combat.recoverHp`)
- MOBS--precision#4: applied (transcription note: cave_spider and iron_golem are not copied to `NEUTRAL_UNTIL_PROVOKED_IDS`)
- MOBS--precision#5: applied (`phase` type cell: 0, 3 or 5)
- MOBS--precision#6: applied (vindicator: 24 HP, axe 7 / 13 / 19, verify)
- MOBS--precision#7: applied (melee_strafe step 4: about 1 block, 4 ticks, one pump)
- MOBS--precision#8: applied (config names `config.body.meleeReach`, `config.body.attackIntervalTicks`; no `MIN_ATTACK_INTERVAL_TICKS`)
