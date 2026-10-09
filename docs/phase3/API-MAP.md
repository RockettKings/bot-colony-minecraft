# Phase 3 API map (Combat I): verified against the pinned d.ts

**Scope.** Every call below was found in one of these two files. The line numbers (`S:` and `G:`) refer to them:
- `S:` = `node_modules/@minecraft/server/index.d.ts` (2.11.0-beta.1.26.52-stable)
- `G:` = `node_modules/@minecraft/server-gametest/index.d.ts` (1.0.0-beta.1.26.52-stable)

**Rule for builders:** use only what is listed here. If you need something that isn't listed, ask the architect. Don't guess.

**Legend**
- **Stability.** The whole `@minecraft/server 2.11.0-beta` module needs Beta APIs ON, which the player already has. In this file, **beta** marks a *member* tagged `@beta` in the d.ts. Those members are the most likely to change between game versions, so isolate them in the adapter. The whole gametest module is `@beta` (G:10).
- **Privileges.** These are the `@privilege` tags in the d.ts.
  - **NRE** = `no-restricted-execution`: can't be called inside a restricted-execution callback (before-events, shutdown).
  - **RERO** = `restricted-execution-read-only`: the property can be read anywhere but can't be *written* in restricted mode.
  - **EEA** = `early-execution-allowed`. **EER** = `early-execution-readable`.
  - "none" = no privilege tag.
- **throws** = the d.ts says "can throw". Treat every engine call as throwing anyway (see §Safe usage rules).
- **Probe?** = whether the behaviour needs an in-game probe because the d.ts can't settle it.

---

## A. Sensing

### A1. Entities near a location
| Action | Call | Privileges | Notes |
|---|---|---|---|
| Query entities | `Dimension.getEntities(options?: EntityQueryOptions): Entity[]` S:8536 | none, throws (CommandError, InvalidArgumentError) | stable. Already used in Phase 2 (`world.ts itemsNear`). |
| Query players only | `Dimension.getPlayers(options?: EntityQueryOptions): Player[]` S:8617; `World.getPlayers(options?)` S:24381; `World.getAllPlayers(): Player[]` S:24177 | none, throws | stable. Simulated players are Players and appear in these lists. |
| Entities in one block | `Dimension.getEntitiesAtBlockLocation(location: Vector3): Entity[]` S:8546 | none | stable |
| Test one entity against a filter | `Entity.matches(options: EntityQueryOptions): boolean` S:10336 | throws | stable |

**`EntityQueryOptions extends EntityFilter`** (S:27270, filter at S:26844). All fields are optional:
- `location?: Vector3` S:27296. This is the seed for `closest`, `farthest`, `maxDistance`, `minDistance` and `volume`.
- `maxDistance?: number` S:27304 ("less than this distance"); `minDistance?: number` S:27311.
- `closest?: number` S:27279: the N closest. **Requires `location`.** `farthest?: number` S:27288.
- `volume?: Vector3` S:27318: a cuboid extent from `location`.
- `type?: string` S:26960 (a single type id); `excludeTypes?: string[]` S:26878.
- `families?: string[]` S:26885: **the entity must match ALL listed families** (AND). `excludeFamilies?: string[]` S:26851: excluded if it matches **one or more** (OR).
- `tags?` / `excludeTags?` S:26954 / S:26872; `name?: string` S:26940; `excludeNames?: string[]` S:26865.
- `gameMode?` / `excludeGameModes?` S:26892 / S:26858.
- `propertyOptions?`, `scoreOptions?`, plus rotation and level ranges, which aren't needed.

**Gotchas**
- `families: ["monster", "undead"]` means monster AND undead. For "any of these families", run one query per family, or query wider and filter with `getComponent('minecraft:type_family')`.
- A query only returns entities in **loaded** chunks.
- An entity from the result can become invalid on a later tick. Re-check `isValid` before you use it again (see §Safe usage rules).

**Probe?** No.

### A2. Type id and families
| Action | Call | Privileges / stability |
|---|---|---|
| Type id | `Entity.typeId: string` S:9642 | none, stable. **Readable even when `isValid` is false.** |
| Families | `entity.getComponent('minecraft:type_family')` returns `EntityTypeFamilyComponent` S:13969 (componentId S:13971). Then `.getTypeFamilies(): string[]` S:13975 and `.hasTypeFamily(typeFamily: string): boolean` S:13979 | throws, stable |
| Generic component access | `Entity.getComponent<T extends string>(componentId: T): EntityComponentReturnType<T> \| undefined` S:10036; `Entity.hasComponent(componentId: string): boolean` S:10246 | throws (InvalidEntityError), stable. Both the short id (`'type_family'`) and `'minecraft:type_family'` are typed in the component map (S:3203). |

**Probe?** No.

### A3. Health
- `entity.getComponent('minecraft:health')` returns `EntityHealthComponent` S:11693 (componentId S:11695), which extends `EntityAttributeComponent` S:10778. Members:
  - `currentValue: number` (readonly) S:10786
  - `effectiveMax: number` S:10801
  - `defaultValue` S:10793
  - `effectiveMin` S:10809
- All throw; stable.
- `setCurrentValue` S:10854 and `resetToMaxValue` S:10829 exist but **are forbidden for gameplay** (they heal for free).
- **Probe?** No.

### A4. Kinematics and state (all on `Entity`, stable)
| Field | Signature | Line | Notes |
|---|---|---|---|
| location | `readonly location: Vector3` | S:9589 | throws. Feet position. |
| head/eye | `getHeadLocation(): Vector3` | S:10150 | throws. Use as the ray origin for line of sight. |
| velocity | `getVelocity(): Vector3` | S:10218 | throws. `y < 0` means falling (crit window). |
| view dir | `getViewDirection(): Vector3` | S:10229 | throws |
| rotation | `getRotation(): Vector2` | S:10181 | throws. SimulatedPlayer also has `readonly headRotation: Vector2` G:531. |
| on ground | `readonly isOnGround: boolean` | S:9523 | throws |
| in water | `readonly isInWater: boolean` | S:9511 | throws |
| falling | `readonly isFalling: boolean` | S:9502 | throws |
| climbing | `readonly isClimbing: boolean` | S:9492 | throws |
| swimming | `readonly isSwimming: boolean` | S:9562 | throws |
| sneaking | `isSneaking: boolean` (**writable**) | S:9541 | RERO: can't be written in restricted mode. See C6. |
| sprinting | `readonly isSprinting: boolean` (Entity) | S:9552 | Writable on SimulatedPlayer, see C5. |
| collision box | `getAABB(): AABB` (`center`, `extent`) | S:9970, S:25838 | throws. Use for reach to the hitbox. |
| block below feet | `getBlockStandingOn(options?: GetBlocksStandingOnOptions): Block \| undefined` | S:10018 | throws. undefined while flying or jumping. |
| on fire | `getComponent('minecraft:onfire')` returns `EntityOnFireComponent`, `.onFireTicksRemaining: number` | S:12958, S:12965 | The component is absent when the entity isn't burning. |
| riding | `getComponent('minecraft:riding')` returns `.entityRidingOn: Entity` | S:13449, S:13457 | Detects spider and chicken jockeys. |
| dimension | `readonly dimension: Dimension` | S:9470 | throws (EngineError, InvalidEntityError), stable. Throws if the entity is invalid. Used by the sensor and the escape flow. |

**Probe?** No.

### A5. Is a mob targeting someone?
- **The API exists:** `Entity.target?: Entity` S:9634. It's **@beta**, `readonly`, and throws (InvalidEntityError).
  - The doc says "Retrieves or sets", but the d.ts declares it `readonly`. Treat it as read-only.
  - Value: "an entity that is used as the target of AI-related behaviors, like attacking. If the entity currently has no target returns undefined."
- **Gotchas**
  - It's beta, so wrap it in the adapter and expect it to vanish or change.
  - It's unverified whether it reports a SimulatedPlayer as a target, and how quickly it updates.
  - Neutral mobs (enderman, spider in daylight) have no target until they're provoked.
- **Fallback proxy (always compute it as well):** `mob_aggroed_on_bot` is true if any of these holds. The numbers live only in S1 §10 (`config.combat.*`); this section must not repeat them:
  - (a) `target?.id === bot.id`, OR
  - (b) this mob hurt or hit the bot (`entityHurt` / `entityHitEntity`) within `config.combat.provokeMemoryTicks`, OR
  - (c) the mob is classified `threat`, its distance to the bot is <= `config.combat.approachRadius` (6 blocks), and it **moved toward the bot** by >= `config.combat.approachMinDelta` since the previous scan, at most 20 ticks earlier. Use the mob's own displacement, so the bot's own movement does not count: `dist3(prev.mobPos, self.posNow) - distance >= approachMinDelta`, where `prev.mobPos` is the mob's position at the previous scan and `self.posNow` and `distance` are current. (S1 §5.3 currently writes `prev.dist - distance`, which also counts the bot's own movement; S1 must adopt this form.)
- **Probe?** **Yes.** Does `mob.target` return the SimulatedPlayer for a zombie chasing it? Is it undefined for a passive or neutral mob?

### A6. Creeper ignition and charged state
- **Component:** `minecraft:is_ignited` returns `EntityIsIgnitedComponent` S:12067 (id S:12069). It's a marker component with no fields, so test presence with `hasComponent('minecraft:is_ignited')` S:10246.
  - **Caution:** its d.ts class comment says "this entity this currently on fire", which looks like a copy-paste mistake. Its meaning for a creeper fuse is **unverified**.
- **Charged creeper:** `minecraft:is_charged` returns `EntityIsChargedComponent` S:12027 (marker). Use `hasComponent('minecraft:is_charged')`.
- **Alternative signal:** `world.afterEvents.dataDrivenEntityTrigger` S:24671. Its event `DataDrivenEntityTriggerAfterEvent` S:8029 has:
  - `entity` S:8036
  - `eventId: string` S:8042
  - `getModifiers(): DefinitionModifier[]` S:8049, whose `addedComponentGroups` / `removedComponentGroups` are at S:26604 / S:26611.
  - Subscribe: `subscribe(callback, options?: EntityDataDrivenTriggerEventOptions)` S:8069, with options `{ entities?, entityTypes?, eventTypes? }` at S:26777. NRE, EEA. stable.
  - A creeper starting or stopping its fuse should appear here as a behaviour-pack event. The exact `eventId` strings are not in the d.ts, so the probe has to log them.
- **Fallback (MOBS.md already plans it):** `dist_below: 3` means hissing.
- **Probe?** **Yes.** Approach a creeper and log `hasComponent('minecraft:is_ignited')` every tick, plus every `dataDrivenEntityTrigger.eventId` for `entityTypes: ['minecraft:creeper']`.

### A7. Tamed state, owner, baby
| Action | Call | Stability |
|---|---|---|
| Tamed (marker) | `hasComponent('minecraft:is_tamed')`; component `EntityIsTamedComponent` S:12137 (id S:12161) | stable component |
| Owner via is_tamed | `.tamedToPlayer?: Player` S:12149, `.tamedToPlayerId?: string` S:12160 | **beta** members |
| Tameable rules / owner | `getComponent('minecraft:tameable')` returns `EntityTameableComponent` S:13730 (id S:13770): `.isTamed: boolean` S:13745, `.tamedToPlayer?: Player` S:13761, `.tamedToPlayerId?: string` S:13769 | stable, throws |
| Baby | `hasComponent('minecraft:is_baby')`; `EntityIsBabyComponent` S:12017 (id S:12019), a marker | stable |
| Never tame | `EntityTameableComponent.tame(player)` S:13783 | NRE. Not for gameplay. |

**Rules**
- **Don't target if either holds:** `hasComponent('minecraft:is_tamed')` is true, or `getComponent('minecraft:tameable')?.isTamed === true`.
- **Owner id:** prefer the stable `tameable.tamedToPlayerId`.

**Probe?** No. Optionally confirm once that a tamed wolf has `is_tamed`.

### A8. Line of sight and rays
| Call | Line | Notes |
|---|---|---|
| `Dimension.getBlockFromRay(location: Vector3, direction: Vector3, options?: BlockRaycastOptions): BlockRaycastHit \| undefined` | S:8421 | throws. Hit fields: `block` S:26200, `face` S:26206, `faceLocation` S:26213. |
| `Dimension.getEntitiesFromRay(location: Vector3, direction: Vector3, options?: EntityRaycastOptions): EntityRaycastHit[]` | S:8564 | throws (EngineError, InvalidArgument, InvalidEntity, UnsupportedFunctionality). Hit fields: `distance` S:27379, `entity` S:27385. **The result includes the origin entity (the bot itself) when the ray starts inside its box; filter out `hit.entity.id === self.id`.** |
| `Entity.getBlockFromViewDirection(options?: BlockRaycastOptions): BlockRaycastHit \| undefined` | S:10001 | throws |
| `Entity.getEntitiesFromViewDirection(options?: EntityRaycastOptions): EntityRaycastHit[]` | S:10137 | throws |

**Options**
- `BlockRaycastOptions` S:26221: `includeLiquidBlocks?`, `includePassableBlocks?`, `maxDistance?`, plus the `BlockFilter` fields (`includeTypes`, `excludeTypes`, …) at S:26088.
- `EntityRaycastOptions` S:27392: `ignoreBlockCollision?`, `includeLiquidBlocks?`, `includePassableBlocks?`, `maxDistance?`, plus every `EntityFilter` field.

**LOS recipe**
1. `o = bot.getHeadLocation()`, `t = mob.getHeadLocation()`, `d = t − o`, `dist = |d|`.
2. Cast `hit = dim.getBlockFromRay(o, d/dist, { maxDistance: dist, includeLiquidBlocks: false, includePassableBlocks: false })`.
3. There is LOS if `hit` is undefined.
4. `direction` doesn't need to be normalised per the d.ts, but normalise it anyway.

**Probe?** No.

### A9. Light, time, weather, difficulty
| Action | Call | Line | Stability |
|---|---|---|---|
| Total light (block and sky) | `Dimension.getLightLevel(location: Vector3): number` | S:8600 | stable, throws (InvalidArgument, LocationInUnloadedChunk). The d.ts says only "total brightness level of light shining on a certain block position". |
| Sky light | `Dimension.getSkyLightLevel(location: Vector3): number` | S:8633 | stable, throws |
| (Block variants) | `Block.getLightLevel(): number` S:4345, `Block.getSkyLightLevel(): number` S:4397 | | NRE. Prefer the Dimension versions. |
| Time of day | `World.getTimeOfDay(): number` (0–24000) | S:24389 | stable |
| Day count / absolute | `World.getDay()` S:24202, `World.getAbsoluteTime()` S:24159 | | stable |
| Named times | `enum TimeOfDay { Day=1000, Noon=6000, Sunset=12000, Night=13000, Midnight=18000, Sunrise=23000 }` | S:2986 | stable |
| Weather | `Dimension.getWeather(): WeatherType` (`Clear`/`Rain`/`Thunder`, S:3139) | S:8655 | **beta** |
| Difficulty | `World.getDifficulty(): Difficulty` (`Easy`/`Hard`/`Normal`/`Peaceful`, S:500) | S:24220 | stable |
| Ticks per day | `const TicksPerDay = 24000` S:29696; `TicksPerSecond = 20` S:29702 | | stable |

**Light semantics (unverified, D18).** The d.ts does not say whether the sky component of `getLightLevel` is attenuated at night (it may stay 15 under open sky at midnight). Specs must not use `getLightLevel` alone for a daylight decision. `isDaylight` comes from `World.getTimeOfDay()` (default: `t < 12000 || t >= 23000`, i.e. before `TimeOfDay.Sunset` or from `TimeOfDay.Sunrise`, S:2986). A spider is neutral only when `isDaylight && lightLevel >= config.combat.spiderNeutralLight` (12); unknown light is treated as hostile.

**Probe?** **Yes: P15 (light semantics).** `is_thunderstorm` uses `getWeather()` (beta), so wrap it and default to false.

### A10. Effects
| Action | Call | Line |
|---|---|---|
| One effect | `Entity.getEffect(effectType: EffectType \| string): Effect \| undefined` | S:10105. throws (InvalidArgumentError if the id doesn't exist; InvalidEntityError). |
| All effects | `Entity.getEffects(): Effect[]` | S:10116 |
| Effect fields | `amplifier: number` S:9137 (0 = level I), `duration: number` S:9154 (ticks), `typeId: string` S:9168, `displayName` S:9144, `isValid` S:9161 | stable |
| Validate an id | `EffectTypes.get(identifier: string): EffectType \| undefined` | S:9324 |

**Ids** (from `@minecraft/vanilla-data` 1.26.52 `mojang-effect.d.ts`, a types-only reference that isn't imported at runtime): `"minecraft:poison"`, `"minecraft:wither"`, `"minecraft:hunger"`, `"minecraft:darkness"`, `"minecraft:fatal_poison"`, `"minecraft:slowness"`, `"minecraft:fire_resistance"`. These seven are the only ids the colony reads (`slowness`: S2b `slowed_and_hp_below`; `fire_resistance`: S1 fire reflex). Any other id passed to `hasEffect` / `getEffect` is a bug.

**Gotchas**
- `getEffect` **throws** on an unknown id; it doesn't return undefined. Prefer `getEffects()` and filter by `typeId`.
- `duration` is documented as "the entire specified duration". Whether it counts down as the effect runs is **unverified**. Log it twice, 20 ticks apart, during any fight that applies poison.
- `addEffect` S:9714 / `removeEffect` S:10386 are NRE and **forbidden for gameplay**.

**Probe?** Light (the duration semantics only).

### A11. Player hunger, saturation, exhaustion
These exist as attribute components that extend `EntityAttributeComponent`, so they have `currentValue`, `effectiveMax`, `effectiveMin` and `defaultValue`. All stable:
- `getComponent('minecraft:player.hunger')` returns `EntityHungerComponent` S:11820 (id S:11822).
- `getComponent('minecraft:player.saturation')` returns `EntitySaturationComponent` S:13466 (id S:13468).
- `getComponent('minecraft:player.exhaustion')` returns `EntityExhaustionComponent` S:11355 (id S:11357).

**Use:** `food = hunger.currentValue` (expected range 0..20) and `sat = saturation.currentValue`.
**Never:** `setCurrentValue` (S:10854) for gameplay.
**Probe?** Light. Confirm that the components exist on a SimulatedPlayer, and that `currentValue` falls after sprinting.

### A12. Equipment of other entities
`getComponent('minecraft:equippable')` returns `EntityEquippableComponent` S:11289. Its `getEquipment(slot)` S:11321 works on any entity that has the component. Not needed in Phase 3.

### A13. Air supply (drowning), D20
- `entity.getComponent('minecraft:breathable'): EntityBreathableComponent | undefined` (component map S:3206 and S:3241, id enum S:795). Class `EntityBreathableComponent` S:10877; `static readonly componentId = 'minecraft:breathable'` S:10956. Privilege: none on reads; throws.

| Member | Signature | Line | Notes |
|---|---|---|---|
| air supply | `airSupply: number` (read/write) | S:10890 | **@beta**, RERO on write. Throws "if the air supply is out of bounds [suffocationTime, maxAirSupply]". Unit not stated (ticks expected). Read only; never write it (free air is a cheat). |
| total supply | `readonly totalSupply: number` | S:10955 | "Time in **seconds** the entity can hold its breath". Throws. |
| can breathe | `readonly canBreathe: boolean` | S:10926 | **@beta**. Throws. |
| breathes air / water | `readonly breathesAir: boolean` S:10897; `readonly breathesWater: boolean` S:10918 | | Throws. |
| inhale / suffocate | `readonly inhaleTime: number` S:10941; `readonly suffocateTime: number` S:10948 | | Seconds. Not needed. |

- **Unit risk:** `totalSupply` is in seconds while `airSupply` has no stated unit. Probe P18 measures both. Until P18 has run, the adapter reports `airSupplyTicks` only if `airSupply` is a finite number and `totalSupply` is a finite number > 0; otherwise unknown.
- **Rule:** wrap every read in `try/catch`. Undefined component or a throw means "air unknown", which the sensor treats as full (no drowning reflex from this source).
- **Fallback if the component throws or is absent:** the controller assumes `airTicks = 300` at the tick the bot becomes submerged (`isInWater` plus head block is water) and counts it down 1 per tick, resetting to 300 when the head leaves water. Used by S1 §5 and §9.
- **Probe?** **Yes: P18.**

### A14. Dropped item entities (D8)
- A dropped item is an entity with `typeId === 'minecraft:item'`. Find them with `Dimension.getEntities({ type: 'minecraft:item', location, maxDistance })` (A1).
- `entity.getComponent('minecraft:item'): EntityItemComponent | undefined` (component map S:3270, id enum S:991). Class `EntityItemComponent` S:12195, `static readonly componentId = 'minecraft:item'` S:12204.
- `readonly itemStack: ItemStack` S:12203. "Item stack represented by this entity in the world." Throws; no `@privilege` tag, no `@beta` tag (stable). The d.ts does not say whether it is a copy or a live view: treat it as read-only and `clone()` before keeping or modifying it.
- Used by the drop scan (S4a `scanDroppedItems`) and probe P4. Check `entity.isValid` first (A1 gotcha); an item entity despawns or is picked up between ticks.

---

## B. Events

Subscribing to these is always fine from a `worldLoad`, `startup` or normal script context. Every `subscribe` is NRE and EEA. **Callbacks of after-events run unrestricted. Callbacks of before-events run restricted** (the d.ts says "This closure is called with restricted-execution privilege").

| Event | Signal | Event fields | Subscribe options |
|---|---|---|---|
| **entityHurt (after)** | `world.afterEvents.entityHurt` S:24744; `subscribe(callback, options?: EntityHurtAfterEventOptions)` S:11866 | `EntityHurtAfterEvent` S:11828: `damage: number` S:11835, `damageSource: EntityDamageSource` S:11842, `hurtEntity: Entity` S:11848 | S:27001: `allowedDamageCauses?: EntityDamageCause[]`, `entities?: Entity[]`, `entityFilter?: EntityFilter`, `entityTypes?: string[]` |
| `EntityDamageSource` S:26752 | | `cause: EntityDamageCause` S:26758, `damagingEntity?: Entity` S:26764, `damagingProjectile?: Entity` S:26770 | For projectile damage `damagingEntity` may be the shooter and the projectile is in `damagingProjectile`. Unverified (probe P17). |
| `EntityDamageCause` S:1250 | | `anvil, blockExplosion, campfire, charging, contact, drowning, entityAttack, entityExplosion, fall, fallingBlock, fire, fireTick, fireworks, flyIntoWall, freezing, lava, lightning, maceSmash, magic, magma, none, override, piston, projectile, ramAttack, selfDestruct, sonicBoom, soulCampfire, stalactite, stalagmite, starve, suffocation, temperature, thorns, 'void', wither` | |
| entityHurt (before) | `world.beforeEvents.entityHurt` S:25268 | `EntityHurtBeforeEvent` S:11885: `cancel`, `damage` (writable), `damageSource`, `hurtEntity` | **Don't use.** Cancelling or altering damage is a cheat, and the callback is restricted. |
| **entityHitEntity** | `world.afterEvents.entityHitEntity` S:24736 | `EntityHitEntityAfterEvent` S:11766: `damagingEntity: Entity` S:11773, `hitEntity: Entity` S:11779 | Fires on a melee hit attempt. Its only subscriber is S1 `subscribeHits` (adapter/sense.ts), which feeds `ProvocationMemory.lastHit`. Pairs with entityHurt to measure shield blocks (see probes). |
| **entityDie** | `world.afterEvents.entityDie` S:24704; `subscribe(callback, options?: EntityEventOptions)` S:11232 | `EntityDieAfterEvent` S:11192: `damageSource` S:11200, `deadEntity: Entity` S:11206 | `EntityEventOptions` S:26824: `entities?`, `entityTypes?`. Phase 1 already uses `{ entityTypes: ['minecraft:player'] }` (`runtime.ts:93`). |
| entityHealthChanged | `world.afterEvents.entityHealthChanged` S:24718; subscribe S:11654 (options `EntityEventOptions`) | S:11616: `entity`, `newValue`, `oldValue` | Covers regen and eating heals. |
| entityHeal | `world.afterEvents.entityHeal` S:24710 | S:11476: `healedEntity`, `healing`, `healSource.cause` | |
| **projectileHitEntity** | `world.afterEvents.projectileHitEntity` S:25119 | `ProjectileHitEntityAfterEvent` S:21140: `dimension`, `hitVector`, `location`, `projectile: Entity`, `source?: Entity` S:21171, `getEntityHit(): EntityHitInformation` S:21180 (NRE; `.entity?` S:26994) | |
| **playerInventoryItemChange** | `world.afterEvents.playerInventoryItemChange` S:25025; `subscribe(callback, options?: InventoryItemEventOptions)` S:19803 | `PlayerInventoryItemChangeAfterEvent` S:19749: `beforeItemStack?: ItemStack` S:19756, `inventoryType: PlayerInventoryType` S:19762, `itemStack?: ItemStack` S:19768, `player: Player` S:19774, `slot: number` S:19780 | S:27629: `allowedSlots?`, `excludeItems?`, `excludeTags?`, `ignoreQuantityChange?`, `includeItems?`, `includeTags?`, `inventoryType?` |
| `PlayerInventoryType` S:2647 | | `Hotbar`, `Inventory` **only** | |
| playerHotbarSelectedSlotChange | `world.afterEvents.playerHotbarSelectedSlotChange` S:24984 | | Not needed |
| entityItemPickup | `world.afterEvents.entityItemPickup` S:24760; subscribe S:12296 (options S:27083 `entityFilter?`, `itemFilter?`) | S:12264: `entity`, `items: ItemStack[]` | Useful snapshot-dirty trigger |
| entityItemDrop | `world.afterEvents.entityItemDrop` S:24752; subscribe S:12243 | S:12211: `entity`, `items: Entity[]` | Detects items dropped on disconnect or death (probe) |
| **playerSpawn** | `world.afterEvents.playerSpawn` S:25061 | `PlayerSpawnAfterEvent` S:20107: `initialSpawn: boolean` S:20117, `player: Player` S:20125 | |
| playerJoin | `world.afterEvents.playerJoin` S:25035 | S:19826: `playerId`, `playerName` (no entity) | |
| playerLeave (after) | `world.afterEvents.playerLeave` S:25043 | S:19876: `playerId`, `playerName` (the entity is gone) | |
| playerLeave (before) | `world.beforeEvents.playerLeave` S:25348; subscribe S:19941+ | `PlayerLeaveBeforeEvent` S:19927: `player: Player` | **Restricted callback.** See the shutdown note below. |
| entityRemove | `world.afterEvents.entityRemove` S:24777 | S:13169: `removedEntityId`, `typeId` | |
| **worldLoad** | `world.afterEvents.worldLoad` S:25199; `subscribe(callback): …` S:25824 | `WorldLoadAfterEvent` S:25811 (no fields) | The first point where the world API is usable (outside early execution). Already used in `src/probes/index.ts:187`. |
| startup | `system.beforeEvents.startup` S:23314; subscribe S:22617 | `StartupEvent` S:22630: registries (custom commands etc.) | Already used (`slash.ts`). Runs in **early execution**: no world access there. |
| **shutdown** | `system.beforeEvents.shutdown` S:23308; `ShutdownBeforeEventSignal.subscribe(callback: (arg0: ShutdownEvent) => void)` S:22292 (NRE, EEA) | `ShutdownEvent` S:22314 (no fields) | See below |
| **itemStartUse** | `world.afterEvents.itemStartUse` S:24857 | S:16484: `itemStack`, `source: Player`, `useDuration` | "chargeable item starts charging" |
| **itemCompleteUse** | `world.afterEvents.itemCompleteUse` S:24840; `subscribe(callback)` S:15184 (no options) | `ItemCompleteUseAfterEvent` S:15145: `itemStack: ItemStack` S:15152, `source: Player` S:15158, `useDuration: number` S:15165 | "chargeable item completes charging". The candidate "finished eating" signal. |
| itemStopUse | `world.afterEvents.itemStopUse` S:24877; subscribe S:16652 | S:16610: `itemStack?` S:16619, `source: Player`, `useDuration` | Use was interrupted |
| itemReleaseUse | `world.afterEvents.itemReleaseUse` S:24849 | S:15901: `itemStack?`, `source`, `useDuration` | Phase 5 bows |
| itemUse | `world.afterEvents.itemUse` S:24896 | S:16773: `itemStack`, `source` | |
| **effectAdd** | `world.afterEvents.effectAdd` S:24680; `subscribe(callback, options?: EntityEventOptions)` S:9207 | `EffectAddAfterEvent` S:9175: `effect: Effect` S:9182, `entity: Entity` S:9188 | Use `entityTypes: ['minecraft:player']` and filter by bot id. |
| entityStartSneaking / entityStopSneaking | S:24793 / S:24801 | S:13610 / S:13656: `entity` | Verifies a sneak write took effect |

### The shutdown privilege (confirmed)
- The `system.beforeEvents.shutdown` callback "is called with **restricted-execution privilege**" (S:22289–22291).
- The signal's own comment says it "occurs **after players have left**, but before the world has closed" (S:22270–22274).
- **Can't run inside it:** any NRE function, and any write to a RERO property.
- **Note:** `World.setDynamicProperty` (S:24588) and `setDynamicProperties` (S:24509) carry **no** `@privilege` tag. The d.ts therefore doesn't forbid them in restricted mode.
- **It's still useless for saving bots,** because the players (bots included) have already left by then: there's no inventory left to read.
- **Keep the ROADMAP rule:** snapshot on change and on a timer, never at shutdown.
- **Optional extra (probe):** in `world.beforeEvents.playerLeave` (restricted, `player` still readable), read the bot's inventory and call `world.setDynamicProperty`. Two things to check: does it persist, and does the event even fire for SimulatedPlayers on Save & Quit? Treat this as a bonus, not the mechanism.

### Probes for events
- `playerInventoryItemChange` firing for SimulatedPlayers, and for script-driven `Container.setItem` changes: **yes, probe**.
- `itemCompleteUse` firing when a bot finishes eating via `useItemInSlot`: **yes, probe**.
- `playerSpawn`, `playerJoin` and `playerLeave` firing for SimulatedPlayers: **yes, probe** (cheap; log all three around spawn, respawn and disconnect).
- **Equipment changes are invisible to the inventory event.** Armour and offhand aren't `Hotbar` or `Inventory`, so `playerInventoryItemChange` won't report them. Equipment snapshots must be timer-driven and also taken right after every adapter equip call.

---

## C. Acting (SimulatedPlayer, gametest module, entirely beta)

Every method below is **NRE** and "can throw". Call them only from `system.run*` callbacks or after-events, **never** inside a before-event (`chatSend` etc.); defer with `system.run`.

| Action | Signature | Line | Semantics / gotchas | Probe? |
|---|---|---|---|---|
| Attack a given entity | `attackEntity(entity: minecraftserver.Entity): boolean` | G:564 | "Returns true if the attack was performed - for example, the player was not on cooldown and had a valid target. **The attack can be performed at any distance and does not require line of sight**." So the adapter **must enforce reach (≤ `config.body.meleeReach`, default 3.0 blocks, eye to AABB) and LOS itself**; the API won't. | **Yes:** cooldown (how often true), damage vs `entityHurt.damage`, whether crits apply while falling |
| Swing (raycast target) | `attack(): boolean` | G:551 | "Target selection is performed by raycasting from the player's head". This is the fair alternative: `lookAtEntity` then `attack()`. | Yes (compare with attackEntity) |
| Look at entity | `lookAtEntity(entity: minecraftserver.Entity, duration?: LookDuration): void` | G:737 | Default "2". **Always pass the enum explicitly.** | No |
| Look at location | `lookAtLocation(location: minecraftserver.Vector3, duration?: LookDuration): void` | G:749 | | No |
| Look at block | `lookAtBlock(blockLocation: minecraftserver.Vector3, duration?: LookDuration): void` | G:725 | Used in Phase 2 | No |
| `LookDuration` | `enum { Continuous='Continuous', Instant='Instant', UntilMove='UntilMove' }` | G:45 | Use `Continuous` to keep facing a mob while strafing. | Yes (whether Continuous tracks a moving entity or freezes on its old position) |
| Navigate (pathfind) | `navigateToLocation(location: minecraftserver.Vector3, speed?: number): NavigationResult` | G:864 | speed bounds [0,1]. "The player must be touching the ground in order to start navigation"; stops if stuck. Absolute coords for top-level bots (Phase 1 verified). `NavigationResult` G:244: `isFullPath`, `getPath(): Vector3[]`. | No |
| Navigate to entity | `navigateToEntity(entity: minecraftserver.Entity, speed?: number): NavigationResult` | G:843 | Follows to within 1 block. Good for "rejoin owner" and chase. | Light |
| Straight-line move | `moveToLocation(location: minecraftserver.Vector3, options?: MoveToOptions): void` | G:804 | `MoveToOptions` G:2693: `faceTarget?: boolean`, `speed?: number`. Overrides the current move/navigation. Good for back-off and retreat steps. | No (used in Phase 1 probes) |
| Relative move | `moveRelative(leftRight: number, backwardForward: number, speed?: number): void` | G:775 | Relative to the bot's current rotation. Strafe = `moveRelative(±1, 0)`, back off = `moveRelative(0, -1)`. | **Yes:** does it continue until `stopMoving`? Does it break a `Continuous` look? |
| GameTest-relative move | `move(westEast: number, northSouth: number, speed?: number): void` | G:762 | "relative to the GameTest". **Don't use** for top-level bots. | n/a |
| Stop | `stopMoving(): void` | G:1005 | | No |
| Jump | `jump(): boolean` | G:709 | "True if a jump was performed". Crit = `attackEntity` while `getVelocity().y < 0` and not `isOnGround`. | Yes (as part of the crit probe) |
| Sprint | `isSprinting: boolean` (**writable on SimulatedPlayer**) | G:539 | RERO. Overrides the readonly `Entity.isSprinting` (S:9552). | Light (does it stay set while moving?) |
| Sneak | `isSneaking: boolean` (writable on `Entity`, so also on Player and SimulatedPlayer) | S:9541 | RERO. Confirm with `entityStartSneaking` (S:24793). | **Yes:** does setting it on a bot make it sneak and raise an offhand shield? |
| Use (hold) item in slot | `useItemInSlot(slot: number): boolean` | G:1059 | "Causes the simulated player to **hold and use** an item in their inventory". `slot` = inventory container index (0..35). **The offhand is not reachable by slot index.** | **Yes:** eat to completion? Consumed? Does it need `stopUsingItem`? Does a shield in a hotbar slot raise? |
| Stop using | `stopUsingItem(): minecraftserver.ItemStack \| undefined` | G:1026 | "Returns the item that was in use. Undefined if no item was in use." | (part of the same probe) |
| Use a script ItemStack | `useItem(itemStack: minecraftserver.ItemStack): boolean` | G:1047 | "**Does not consume the item.**" **Forbidden for gameplay** (free uses). | n/a |
| Selected hotbar slot | `Player.selectedSlotIndex: number` (writable) | S:18131 | RERO. Used in Phase 2. | No |
| Drop held stack | `dropSelectedItem(): boolean` | G:611 | For "drop items at owner's feet". | **Yes:** whole stack or one item? Can the bot pick it back up immediately? |
| Disconnect | `disconnect(): void` | G:602 | | **Yes:** are items dropped? (duplication risk, see E) |
| Respawn | `respawn(): boolean` | G:894 | Used in Phase 1 after death | No |
| Chat | `chat(message: string): void` | G:592 | Probably goes through chat events like a real player (inference, not stated in the d.ts), so a bot line starting with `!` could be parsed as a command. **Keep using `world.sendMessage`** (S:24459) for bot lines, as Phase 1 does. | n/a |
| Interact with block/entity | `interactWithBlock(blockLocation, direction?)` G:682; `interactWithEntity(entity)` G:698; `interact()` G:662; `stopInteracting()` G:995 | | Not needed in Phase 3. **Never** `interactWithEntity` on a tameable (could feed or tame). | n/a |
| Break block | `breakBlock(blockLocation: Vector3, direction?: Direction): boolean` G:585; `stopBreakingBlock(): void` G:961 | | Phase 2. A combat interrupt **must** call `stopBreakingBlock()` before attacking (attacking while breaking is undefined). | No |
| Rotate | `rotateBody(angleInDegrees: number): void` G:904; `setBodyRotation(angleInDegrees)` G:914 ("relative to the GameTest") | | Prefer `lookAt*` | n/a |
| Items: forbidden | `giveItem` G:636, `setItem` G:930, `useItemOnBlock` G:1116 | | Create items. Only `Container.setItem` is used, and only for snapshot restore (see D). | n/a |

### Shield blocking (C6)
- There is **no `block()` / `raiseShield()` API.**
- **Candidate A:** shield in `EquipmentSlot.Offhand`, plus `bot.isSneaking = true` (Bedrock raises the shield while sneaking).
- **Candidate B:** shield in a hotbar slot, plus `useItemInSlot(slot)` (hold use), then `stopUsingItem()`. This leaves the main hand without the sword while blocking.
- **Probe required** before the decision loop relies on either one.

### Eating (C7)
- **Primary:** select the food's hotbar slot, `useItemInSlot(slot)`, then poll.
  - Expect `itemStartUse`, then `itemCompleteUse` (or the stack's amount dropping by 1), and hunger rising.
  - If nothing completes within `useDuration + 10` ticks, call `stopUsingItem()`.
- **Fallback:** `Player.eatItem(itemStack: ItemStack): void` S:18206.
  - It's **beta**, NRE, and throws if the item isn't food.
  - It applies hunger and saturation but **takes a script ItemStack, not a slot.** The d.ts doesn't say it consumes anything.
  - Using it means the adapter must decrement the stack itself. That's an abstraction like crafting, so it needs **player approval**. Treat it as last resort only.
- **Cooldowns:** `Player.getItemCooldown(cooldownCategory: string): number` S:18239.
  - Also `ItemCooldownComponent` (`minecraft:cooldown`) S:15458: `cooldownCategory` S:15467, `cooldownTicks` S:15475, `getCooldownTicksRemaining(player)` S:15483 (NRE).
  - Use it for the chorus fruit and ender pearl cooldowns, and possibly to read **shield disabled by axe** (probe: log `getItemCooldown('shield')` after an axe hit; the category name isn't in the d.ts).

---

## D. Inventory, equipment and items

### D1. Containers
**Get the bot's inventory:** `bot.getComponent('minecraft:inventory')?.container`.
- `EntityInventoryComponent` S:11952: `container: Container` S:11979 (throws), `inventorySize` S:11993.
- Player container size is **36**: 0..8 hotbar, 9..35 main (S:7223 doc). **Armour and offhand are NOT in it.**

| Member | Signature | Line | Kind | Semantics |
|---|---|---|---|---|
| size | `readonly size: number` | S:7223 | read | throws if invalid |
| emptySlotsCount | `readonly emptySlotsCount: number` | S:7204 | read | |
| isValid | `readonly isValid: boolean` | S:7212 | read | |
| getItem | `getItem(slot: number): ItemStack \| undefined` | S:7351 | read | Returns a **copy**; doesn't change the slot. Throws on an invalid container or out-of-bounds slot. |
| getSlot | `getSlot(slot: number): ContainerSlot` | S:7365 | read | A live reference to the slot |
| find / findLast / firstEmptySlot / firstItem / contains | S:7285 / S:7297 / S:7306 / S:7315 / S:7273 | | read | |
| **setItem** | `setItem(slot: number, itemStack?: ItemStack): void` | S:7439 | **WRITE (creates)** | NRE. Writes a *script* stack into the slot; `undefined` clears it. Conservation: the caller must remove the same items elsewhere. |
| **addItem** | `addItem(itemStack: ItemStack): ItemStack \| undefined` | S:7252 | **WRITE (creates)** | NRE. First available slot(s), stacks with matching items. Returns the leftover, or undefined if everything fit. |
| clearAll | `clearAll(): void` | S:7262 | **WRITE (destroys)** | NRE. Only after a successful serialize (snapshot). |
| **moveItem** | `moveItem(fromSlot: number, toSlot: number, toContainer: Container): void` | S:7418 | **MOVE (engine)** | NRE. Conserving. The d.ts doesn't say what happens if `toSlot` is occupied, so only target an empty `toSlot`, or use `swapItems`. Check `container.getItem(toSlot) === undefined` in the same synchronous block as the `moveItem` call; if not empty, use `swapItems`. |
| **swapItems** | `swapItems(slot: number, otherSlot: number, otherContainer: Container): void` | S:7463 | **MOVE (engine)** | NRE. Conserving. Works within one container or across two. |
| **transferItem** | `transferItem(fromSlot: number, toContainer: Container): ItemStack \| undefined` | S:7517 | **MOVE (engine)** | NRE. Into the first available slots of `toContainer`. Returns "the items that couldn't be transferred". Phase 2 already handles the leftover (`settleTransfer`). |

**Engine moves vs script writes**
- `moveItem`, `swapItems` and `transferItem` keep all item data, because the engine moves the real stack.
- `setItem` and `addItem` write whatever the script `ItemStack` holds. They're only lossless if that `ItemStack` came from `getItem()` / `clone()` in the same session (see D5).

### D2. ContainerSlot (S:7524), a live slot reference
- `amount` S:7538 (RERO)
- `typeId` S:7628
- `maxAmount` S:7591
- `nameTag?` S:7604
- `isValid` S:7558
- `hasItem()` S:7765
- `getItem(): ItemStack | undefined` S:7715, which returns a copy
- `setItem(itemStack?: ItemStack): void` S:7891 (NRE)
- `getLore()` S:7729
- `getTags()` S:7756, `hasTag()` S:7780
- `isStackableWith()` S:7799
- `keepOnDeath` S:7568
- `lockMode` S:7579
- dynamic properties S:7639–S:7874

There's no swap or move on `ContainerSlot`.

### D3. Equipment
**Get it:** `bot.getComponent('minecraft:equippable')` returns `EntityEquippableComponent` S:11289 (id S:11309).
- `getEquipment(equipmentSlot: EquipmentSlot): ItemStack | undefined` S:11321. throws. Returns a copy.
- `getEquipmentSlot(equipmentSlot: EquipmentSlot): ContainerSlot` S:11334. throws.
- `setEquipment(equipmentSlot: EquipmentSlot, itemStack?: ItemStack): boolean` S:11347. NRE, throws. `undefined` clears the slot. The meaning of the return value isn't documented, so treat `false` as failure.
- `totalArmor: number` S:11299, `totalToughness: number` S:11308. Useful for `!status` and danger scoring.
- **`EquipmentSlot`** S:1612: `Body` (**beta**, non-humanoid mobs only), `Chest`, `Feet`, `Head`, `Legs`, `Mainhand`, `Offhand`.

**Gotchas**
- **`Mainhand` is "the currently active hotbar slot" for players.** It aliases `container[selectedSlotIndex]`. **Never snapshot or restore Mainhand separately**; that would duplicate the held item. Snapshot only `Head`, `Chest`, `Legs`, `Feet` and `Offhand`, plus the 36 container slots and `selectedSlotIndex`.
- There's no engine "move inventory to equipment", so an equip is a script read/write pair. To conserve items:
  1. `prev = eq.getEquipment(S)`; `item = inv.getItem(i)`.
  2. `inv.setItem(i, prev)` (`undefined` if there was nothing).
  3. `ok = eq.setEquipment(S, item)`.
  4. If step 3 throws or returns `false`:
     - (a) `inv.setItem(i, item)`;
     - (b) `cur = eq.getEquipment(S)`; if `cur` is not the same type and amount as `prev`, call `eq.setEquipment(S, prev)`;
     - (c) if (b) throws or returns `false`, log `[colony] equip rollback failed slot=<S>` and return failure with the slot left as found.
     - Items are never duplicated: `item` is only in the inventory and `prev` only in the equipment slot.
  
  This order is chosen so a failure part-way never leaves two copies. Don't run two equips in the same tick for the same slot.
- **Probe?** Light. Confirm `setEquipment(Offhand, shield)` shows the shield and that it then blocks (part of the shield probe).

### D4. ItemStack (S:16032)
**Constructor:** `constructor(itemType: ItemType | string, amount?: number)` S:16142. It **creates** items and throws on an invalid type or an amount outside 1–255; the amount is clamped to max stack size. Allowed only in crafting (Phase 2) and snapshot restore.

**Fields**
- `typeId: string` S:16114
- `amount: number` S:16045 (RERO; 1–255, clamped)
- `maxAmount: number` S:16088
- `isStackable` S:16053
- `nameTag?: string` S:16100 (RERO, ≤ 255 chars)
- `keepOnDeath` S:16061
- `lockMode: ItemLockMode` S:16080 (`inventory`/`none`/`slot`, S:2288)

**Methods**
- `clone(): ItemStack` S:16158 ("exact copy… including any custom data")
- `getLore(): string[]` S:16270; `setLore(loreList?: (RawMessage | string)[]): void` S:16477 (NRE; ≤ 20 lines × 50 chars)
- `isStackableWith(itemStack: ItemStack): boolean` S:16326
- `getTags(): string[]` S:16287; `hasTag(tag: string): boolean` S:16310
- `getComponent<T>(componentId: T): ItemComponentReturnType<T> | undefined` S:16222; `hasComponent` S:16298
- `getCanDestroy()` / `getCanPlaceOn()` S:16167 / S:16176 (NRE); `setCanDestroy` / `setCanPlaceOn` S:16373 / S:16407 (NRE)
- dynamic properties: `getDynamicPropertyIds()` S:16249, `getDynamicProperty` S:16240, `setDynamicProperty` S:16440 (**throws on stackable items**)

**Item components** (component map S:3357):

| Component id | Class / line | Members |
|---|---|---|
| `minecraft:durability` | `ItemDurabilityComponent` S:15555 | `damage: number` S:15564 (RERO, writable), `maxDurability: number` S:15572, `unbreakable: boolean` S:15582 (RERO), `getDamageChance(unbreakingLevel?)` S:15600 (NRE). Remaining = `maxDurability − damage`. |
| `minecraft:enchantable` | `ItemEnchantableComponent` S:15643 | `getEnchantments(): Enchantment[]` S:15758, `getEnchantment(type)` S:15749, `hasEnchantment(type)` S:15774, `addEnchantment(enchantment: Enchantment): void` S:15679 (NRE), `addEnchantments(enchantments: Enchantment[]): void` S:15709 (NRE), `canAddEnchantment` S:15733, `removeAllEnchantments` S:15783, `slots` S:15648 |
| `Enchantment` (interface) S:26676 | | `level: number` S:26682, `type: EnchantmentType` S:26688. `EnchantmentType` S:9353: `id: string` S:9359, `maxLevel` S:9365, `constructor(enchantmentType: string)` S:9369. Registry: `EnchantmentTypes.get(enchantmentId: string)` S:9389. |
| `minecraft:food` | `ItemFoodComponent` S:15810 | `nutrition: number` S:15827, `saturationModifier: number` S:15836 (saturation gained = `nutrition × saturationModifier × 2`, per the d.ts), `usingConvertsTo: string` S:15844 (e.g. bowl), `canAlwaysEat: boolean` S:15819 |
| `minecraft:cooldown` | `ItemCooldownComponent` S:15458 | see C7 |
| `minecraft:dyeable` | `ItemDyeableComponent` S:15618 | `color?: RGB` S:15627 (RERO, writable), `defaultColor?` S:15634 |
| `minecraft:potion` | `ItemPotionComponent` S:15869 | `potionEffectType: PotionEffectType` S:15892 (`.id`), `potionDeliveryType: PotionDeliveryType` S:15881 (`.id`). Rebuild with `Potions.resolve(effectType, deliveryType): ItemStack` S:20787. |
| `minecraft:book` | `ItemBookComponent` S:14939 | `contents` S:14960, `title?` S:14998, `author?` S:14950, `isSigned` S:14969, `pageCount` S:14978, `setContents(...)` S:15091 (NRE), `signBook(title, author)` S:15138 (NRE) |
| `minecraft:inventory` (item) | `ItemInventoryComponent` S:15854 | `container: Container` S:15861. Only for items with the `Storage Item` component (bundles). |

### D5. What can and can't be round-tripped (snapshot serialization)
**In the same session (escape, summon, dismiss/rejoin without Save & Quit):** keep the `ItemStack` objects themselves in script memory and write them back with `Container.setItem` / `setEquipment`.
- `getItem()` / `clone()` copy "any custom data". `ItemStack` has no `isValid` and is not bound to an entity, so this is **lossless** for every item type.
- **Probe once:** take an enchanted, named, damaged item from a bot, disconnect the bot, respawn the same name, `setItem` the held stack, and check that everything survived.

**Across Save & Quit:** the stacks must be serialized to strings (dynamic properties). Fidelity by data type:

| Data | Round-trip via API? | How |
|---|---|---|
| type, amount | yes | `typeId`, `amount`; rebuild with `new ItemStack(typeId, amount)` |
| durability damage | yes | `durability.damage` (writable), `unbreakable` |
| enchantments | yes | `getEnchantments()` gives `[{id, level}]`, rebuilt with `addEnchantments([{ type: new EnchantmentType(id), level }])` |
| custom name | yes | `nameTag` |
| lore | yes (plain strings) | `getLore()` / `setLore()`. Raw/JSON lore via `getRawLore()` S:16281 can be lossy. |
| keepOnDeath, lockMode | yes | properties |
| canDestroy / canPlaceOn | yes | get/set pairs |
| item dynamic properties | yes (non-stackable items only) | ids + get/set |
| leather/dyeable colour | yes | `minecraft:dyeable` `.color` |
| potion type (potion / splash / lingering) | yes, via a rebuild | `Potions.resolve(effectId, deliveryId)` returns a new ItemStack (S:20787) |
| writable / written books | mostly | `book.contents`, `title`, `author`, then `setContents` + `signBook`. Generation (copy-of-copy) isn't exposed, so **it's lost**. |
| bundle contents | yes (recursive) | `getComponent('minecraft:inventory').container` |
| **enchanted book stored enchantments** | **unknown** | It's unverified that `enchantable` reports them on `minecraft:enchanted_book`. Probe, or treat as lossy. |
| **shulker box contents** | **NO** | No API exposes a shulker *item's* contents (`ItemInventoryComponent` is documented only for Storage Item items). Lost. |
| **map id (filled maps)** | **NO** | No API |
| **armour trims** | **NO** | Only the loot function `SetArmorTrimFunction` S:22045, not on ItemStack |
| **banner patterns, firework/star data, goat-horn instrument, lodestone compass target, crossbow loaded projectile, suspicious-stew effect, tipped-arrow potion, anvil repair cost, any other custom NBT** | **NO** | Not exposed |

S4a calls the NO rows *excluded* (`excluded.ts`, `ExcludeReason`); armour trims and shield banner patterns are the *invisible* losses (S4a §2).

**Rule for the snapshot code**
- The serializer understands exactly these component ids: `minecraft:durability`, `minecraft:enchantable`, `minecraft:dyeable`, `minecraft:potion`, `minecraft:book`, `minecraft:inventory` (bundle), plus `typeId`, `amount`, `nameTag`, lore, `keepOnDeath`, `lockMode`, canDestroy, canPlaceOn and dynamic properties.
- `lossy = true` if the type id is in the NO list of the table above, or if the stack has any other item component outside that list, ignoring `minecraft:food` and `minecraft:cooldown` (both derived from the type). (S4a may refine this; this is the default.)
- **Escape / dismiss** must never serialize a lossy stack to disk. It keeps lossy stacks as in-memory `ItemStack` objects only (same session) and never deposits them in a chest. If the session ends before the restore (Save & Quit), the stack is lost and S4 logs `[colony] lossy stack dropped <typeId>`.
- On Save & Quit a lossy stack gets degraded. Log it with `[colony]` and tell the owner in chat on the next load.

---

## E. Spawning and lifecycle

- **Spawn (top level):**
  ```ts
  spawnSimulatedPlayer(
    location: minecraftserver.DimensionLocation,
    name: string,
    gameMode: minecraftserver.GameMode,
  ): SimulatedPlayer
  ```
  G:2911. It's NRE, throws (EngineError), beta module.
  - `DimensionLocation` S:26626 = `{ dimension: Dimension, x, y, z }`.
  - `GameMode` S:1699 = `Adventure | Creative | Spectator | Survival`.
  - **Phase 1 call:** `spawnSimulatedPlayer(where, name, GameMode.Survival)` in `src/game/adapter/index.ts:41` (`spawnBot`). Verified in-game with cheats off; uses absolute coords.
- **Test-bound spawn (GameTests only):** `Test.spawnSimulatedPlayer(blockLocation: Vector3, name?: string, gameMode?: GameMode): SimulatedPlayer` G:2277. Takes test-relative coords.
- **Respawn after death:** `SimulatedPlayer.respawn(): boolean` G:894.
- **Disconnect:** `SimulatedPlayer.disconnect(): void` G:602.
- **Name reuse after disconnect:** not specified in the d.ts. Escape/summon/dismiss all spawn the same name again. **Probe:** disconnect `Bot-1`, wait 1, 5 and 20 ticks, then spawn `Bot-1`. Check whether it succeeds, whether the `id` is new, and that `world.getPlayers({ name: 'Bot-1' })` returns exactly one.
- **Items on disconnect:** not specified. **Probe:**
  - Before disconnect: count item entities within 3 blocks (`getEntities({ type: 'minecraft:item', location, maxDistance: 3 })`) and subscribe to `entityItemDrop` (S:24752).
  - Then disconnect a bot carrying a marked item (`nameTag = 'probe-<tick>'`).
  - Count the items again 1 and 20 ticks later.
  - **If items drop:** the snapshot must `clearAll()` the inventory and clear every equipment slot **before** `disconnect()`, otherwise items get duplicated (dropped copy plus restored copy). The ROADMAP order (serialize, then clear, then disconnect) already does this; the probe decides whether the clear is mandatory or only defensive. **Keep it mandatory either way.**
- **Death drops:** `world.gameRules.keepInventory: boolean` S:14693 is readable. If true, a dead bot keeps its items. Read it, don't write it.

---

## F. Persistence

**World storage** (the only storage that survives Save & Quit for bots, because SimulatedPlayers don't persist; Phase 1 probe "reload" FAILED):
- `World.setDynamicProperty(identifier: string, value?: boolean | number | string | Vector3): void` S:24588. throws (ArgumentOutOfBoundsError). Passing `undefined` deletes the key. **No privilege tag.**
- `World.setDynamicProperties(values: Record<string, boolean | number | string | Vector3 | undefined>): void` S:24509. Batch version, throws.
- `World.getDynamicProperty(identifier: string): boolean | number | string | Vector3 | undefined` S:24310. throws.
- `World.getDynamicPropertyIds(): string[]` S:24319.
- `World.getDynamicPropertyTotalByteCount(): number` S:24327.
- `World.clearDynamicProperties(): void` S:24153. **Never call it**; it would wipe every key.
- **Value types:** boolean, number, string, Vector3. Objects go through `JSON.stringify`.
- **Size limit:** **not documented in the d.ts.** The d.ts example only warns "be very careful to ensure your serialized JSON str cannot exceed limits" (S:24305).
  - **Design (S4a §4.2 is authoritative; `lower = botName.toLowerCase()`):**
    - chunks: `colony:snap:<lower>:<seq>:<i>`, each <= `chunkChars` (default 30,000);
    - pointer: `colony:snap:<lower>:p`, written **last** (the commit point);
    - restored seq: `colony:snap:<lower>:r`;
    - colony meta: `colony:meta`.
  - **Write order:** (1) write all chunks of the new `seq` (new key names, so the last good snapshot is never overwritten); (2) read them back and compare lengths; (3) write `:p`; (4) delete the chunks of the old `seq`. A reader trusts only the chunks the pointer names, so a crash part-way never corrupts the last good snapshot.
  - **Unit:** chunk size is in UTF-16 characters of a JSON string that contains only ASCII (the serializer escapes every char > 0x7E as `\uXXXX`), so characters equal bytes.
  - The commonly cited community limit is 32,767 chars per string. That's unverified here; probe P12 confirms it.
- **Entity dynamic properties:** `Entity.setDynamicProperty` S:10476, `getDynamicProperty` S:10060, `getDynamicPropertyIds` S:10072, `getDynamicPropertyTotalByteCount` S:10086 (all throw InvalidEntityError).
  - On SimulatedPlayers they die with the entity: a disconnected or re-spawned bot is a new entity, and bots don't survive reload.
  - **Don't use them for snapshots.** They're fine for per-session tags.
- **Probe?** Yes, light: P12 (sizes 1,000 to 40,000 ASCII chars; S6 §1.5 P2-b extends the list and owns the verdict).

---

## G. Blocks

| Action | Call | Line | Notes |
|---|---|---|---|
| Block at a position | `Dimension.getBlock(location: Vector3): Block \| undefined` | S:8381 | throws LocationInUnloadedChunkError / LocationOutOfWorldBoundariesError. undefined is possible. |
| First solid block below / above | `Dimension.getBlockBelow(location: Vector3, options?: BlockRaycastOptions): Block \| undefined` S:8407; `getBlockAbove` S:8394 | | "by default will find the first solid block below". **Use for safe ground** under a retreat point. |
| Topmost block | `Dimension.getTopmostBlock(locationXZ: VectorXZ, minHeight?: number): Block \| undefined` | S:8645 | "the highest block at the given XZ". It can be leaves or water. Check `isLiquid` and the block above. `VectorXZ` S:29002. |
| Chunk loaded | `Dimension.isChunkLoaded(location: Vector3): boolean` | S:8664 | Check before getBlock or a path target |
| Height range | `Dimension.heightRange` | S:8098 | |
| Block fields | `isAir` S:4032, `isLiquid` S:4046, `typeId` S:4134, `location` S:4098, `isWaterlogged` S:4079, `isSolid` S:4060 (**beta**), `isValid` S:4068 | | `isSolid` is already used in Phase 2 (`world.ts blockAt`). Keep it in the adapter only. |
| Neighbours | `above(steps?)` S:4167, `below(steps?)` S:4182, `north/south/east/west(steps?)`, `offset(offset)` S:4566 | | throw |
| Bulk find | `Dimension.getBlocks(volume, options, allowUnloadedChunks?)` | S:8451 | Phase 2 |
| Standing-on | `Entity.getBlockStandingOn(options?)` | S:10018 | |

**Gotchas**
- **Lava check:** `typeId === 'minecraft:lava'` / `'minecraft:flowing_lava'`, or `isLiquid` combined with a type check.
- **Safe cell for the bot:** `getBlock(feet)?.isAir`, `getBlock(head)?.isAir`, and `getBlock(below)` defined with `!isAir && !isLiquid`. An `undefined` block (unloaded chunk) means not safe. Tall grass or flowers at the feet make the cell unsafe (conservative).
- **Never:** `setType` S:4601, `setPermutation` S:4583.

---

## H. Misc

- **Scheduling** (all EEA, stable):
  - `system.run(callback: () => void): number` S:23151
  - `system.runTimeout(callback: () => void, tickDelay?: number): number` S:23234
  - `system.runInterval(callback: () => void, tickInterval?: number): number` S:23179
  - `system.clearRun(runId: number): void` S:23114
  - `system.runJob(generator: Generator<void, void, void>): number` S:23218 (for chunked serialization)
  - `system.currentTick: number` S:23077 (EER)
- **Players**
  - `world.getPlayers({ name: 'Bot-1' })` S:24381 uses `EntityFilter.name` S:26940.
  - `Player.name: string` S:18098 throws (it's NOT readable on an invalid player). Cache the name at spawn, as Phase 1 does.
  - `Player.getGameMode(): GameMode` S:18228.
- **Ids**
  - `Entity.id: string` S:9481 is readable even when invalid and consistent across loads of a world instance.
  - `world.getEntity(id: string): Entity | undefined` S:24339 "Throws if the given entity id is invalid".
- **Validity:** `Entity.isValid: boolean` is a **property** in this version (S:9570). A Player is valid when its lifetime state is Loaded. `Container.isValid` S:7212, `Block.isValid` S:4068, `Effect.isValid` S:9161, `ContainerSlot.isValid` S:7558.
- **Dimensions**
  - `Dimension.id: string` S:8104 is `"minecraft:overworld"` / `"minecraft:nether"` / `"minecraft:the_end"`. That's the format Phase 2 stores (`OVERWORLD` in `world.ts`), and it matches vanilla-data `mojang-dimension.d.ts`.
  - `world.getDimension(dimensionId: string): Dimension` S:24233 accepts e.g. "overworld" and throws on an invalid name.
- **Messages:** `world.sendMessage(message)` S:24459; `Player.sendMessage(message)` S:18484.
- **Forbidden for gameplay:** see Safe usage rule 7, which is the single authoritative list (superset of the cheats `Entity.teleport` S:10624 / `tryTeleport` S:10693, `applyDamage` S:9819, `applyImpulse` S:9849, `applyKnockback` S:9886, `kill` S:10296, `addEffect` S:9714, `runCommand` S:10445, `Entity.addItem` S:9734, `Dimension.spawnItem` S:8959, attribute `setCurrentValue` S:10854). Fixture-only exceptions are in section I.

---

## I. Fixture-only APIs (probes and GameTests, never gameplay)

Used only by `src/probes/` (inside `fixtures.ts`) and `test/` (inside `combat-helpers.ts`), in functions named `fixture*` / `testOnly*`. Verified in `index.d.ts` (privilege checked on each doc comment). All are NRE (no-restricted-execution) and throw, except `new ItemStack` (no privilege tag, throws) and the game-rule fields (RERO on write).

| API | Signature | Line | Use |
|---|---|---|---|
| spawn a mob | `Dimension.spawnEntity<T = never>(identifier, location: Vector3, options?: SpawnEntityOptions): Entity` | S:8901 | spawn fixture mobs |
| teleport | `Entity.teleport(location: Vector3, teleportOptions?: TeleportOptions): void` | S:10624 | hold a mob at a spot |
| clear velocity | `Entity.clearVelocity(): void` | S:9921 | stop a held mob drifting |
| kill / remove | `Entity.kill(): boolean` S:10296; `Entity.remove(): void` | S:10367 | cleanup |
| trigger event | `Entity.triggerEvent(eventName: string): void` | S:10668 | creeper `minecraft:start_exploding_forced` (d.ts example) |
| add effect | `Entity.addEffect(effectType, duration, options?): Effect \| undefined` | S:9714 | `fire_resistance` on skeletons |
| container write | `Container.setItem(slot, itemStack?)` | S:7439 | give marked items to a probe bot |
| new item | `new ItemStack(itemType, amount?)` | S:16142 | same |
| equip | `EntityEquippableComponent.setEquipment(slot, itemStack?): boolean` | S:11347 | offhand and armour fixtures |
| set attribute | `EntityAttributeComponent.setCurrentValue(value): boolean` | S:10854 | top-up HP, set hunger |
| game rules | `world.gameRules: GameRules` S:24091 (class S:14584): `doMobSpawning: boolean` S:14645, `mobGriefing: boolean` S:14705, `keepInventory: boolean` S:14693 | | RERO on write. Probes set and always restore them in `finally`. |
| time | `World.setTimeOfDay(timeOfDay: number \| TimeOfDay): void` | S:24601 | NRE. Throws outside 0..24000. P15 and light fixtures. |

Probes and tests restore every game rule and the time of day they change.

---

## Impossible / not available, with the chosen fallback

| Wanted | Status | Fallback |
|---|---|---|
| Mob target query | **Available but beta:** `Entity.target` S:9634 | Use it when defined. Always also run the proxy from A5 (hurt or hit within `provokeMemoryTicks`, or a hostile closing in). |
| Creeper ignition | **Probably** `hasComponent('minecraft:is_ignited')` S:12067 or `dataDrivenEntityTrigger` S:24671. Unverified. | `dist_below: 3` is hissing (MOBS.md) |
| Per-player ender chest | **Available:** `getComponent('minecraft:ender_inventory').container` S:11256, "always present on players". Out of scope per ROADMAP; persistence for SimulatedPlayers is unknown. | Don't use it in Phase 3 |
| Raise shield | **No API.** | `isSneaking = true` with an offhand shield, and/or `useItemInSlot` with a hotbar shield (probe) |
| Eat (consuming the item) | No dedicated API. `useItemInSlot` is a general hold-use; `Player.eatItem` (beta) applies the food but doesn't consume the stack. | `useItemInSlot` (probe). `eatItem` + manual decrement only with player approval. |
| Reach / LOS enforcement in attacks | `attackEntity` ignores both | The adapter enforces reach ≤ `config.body.meleeReach` (default 3.0 blocks, eye to AABB) and LOS (A8), or uses `lookAtEntity` + `attack()` |
| Saving at shutdown | The callback is restricted and fires after players left | Save on change, every `config.snapshot.intervalTicks`, and before every disconnect (ROADMAP) |
| Lossless item serialization | Not possible for shulker contents, maps, trims, banners, fireworks, horns, lodestone, crossbow charge, stew, tipped arrows, repair cost, custom NBT | In-session: keep `ItemStack` objects in memory. Across reload: serialize what's listed in D5, and flag lossy stacks. |
| Inventory-change event for armour/offhand | `PlayerInventoryType` is only `Hotbar` or `Inventory` | Snapshot equipment on a timer and after every adapter equip |
| Engine move between inventory and equipment | No `moveItem` to an equipment slot | The ordered script read/write in D3 |
| Dynamic property size limit | Not documented | Chunk at ≤ 30,000 chars (probe P12) |
| Air supply | Component read: `minecraft:breathable` (A13, beta `airSupply`) | Controller counts submerged ticks (A13 fallback) |
| Light at night | `getLightLevel` semantics unverified (A9) | `isDaylight` from `getTimeOfDay()`; probe P15 |

---

## Needs in-game probe

Thresholds and verdicts are defined only in S6 §1.5; the procedures there (a husk, not a zombie or skeleton, for P1; the hunger method of P0-e for P2) override the wording in this table.

| # | Probe | What to do / measure | Decides |
|---|---|---|---|
| P1 | **Shield block** | Bot with an iron sword in the hotbar and a shield in `Offhand`. Three modes in turn: (a) `isSneaking = true`; (b) shield in hotbar slot + `useItemInSlot(slot)`; (c) neither. A zombie (or skeleton) attacks from the front for 10 s per mode. Log per hit: `entityHitEntity` count vs `entityHurt` count and damage on the bot, and `entityStartSneaking` firing. | Which mode blocks; raise delay |
| P2 | **Eating via useItemInSlot** | Starve the bot to hunger ≤ 14, put `minecraft:cooked_beef` ×2 in slot 0, call `useItemInSlot(0)`. Each tick log `player.hunger.currentValue`, `player.saturation.currentValue`, slot 0 amount, and `itemStartUse`/`itemCompleteUse`/`itemStopUse` (with `useDuration`). Then repeat, calling `stopUsingItem()` at tick 10. | Ticks to eat, whether the item is consumed, whether it auto-stops, whether interrupting is safe |
| P3 | **attackEntity reach/cooldown** | Bot and a stationary target (zombie in a 1×1 hole). Call `attackEntity` every tick at distances of 2, 3, 4, 6 and 10 blocks, and through a wall. Log the return value, `entityHurt.damage`, and target HP per tick. Repeat with `jump()` then attack while `getVelocity().y < 0` (crit). Also compare `lookAtEntity` + `attack()`. | `config.body.attackIntervalTicks`, crit multiplier, whether the adapter reach cap is mandatory (it is anyway) |
| P4 | **Items on disconnect** | Mark items with `nameTag 'probe-<tick>'`. Disconnect the bot. Count `minecraft:item` entities within 3 blocks at +1 and +20 ticks, and log `entityItemDrop`. | Whether clear-before-disconnect is required (keep it regardless) |
| P5 | **playerInventoryItemChange for bots** | Subscribe without a filter. Have the bot pick up an item, eat, break a block, and have the script `setItem`/`transferItem`. Log `player.name`, `slot`, `inventoryType`, before/after. | Whether the snapshot can be event-driven or must be timer-only |
| P6 | **isSneaking writable on SimulatedPlayer** | Set `true`, check the next tick: read it back, check `entityStartSneaking`, and measure speed over 40 ticks of `moveRelative(0, 1)`. | Sneak-away (warden) and shield mode A |
| P7 | **Creeper ignition readable** | A creeper approaches the bot. Each tick log `hasComponent('minecraft:is_ignited')`, the distance, and every `dataDrivenEntityTrigger` `eventId` for creepers. Repeat with a charged creeper (`is_charged`). | `mob_hissing` atom |
| P8 | **Entity.target** | Zombie chasing a bot, skeleton shooting a bot, a passive cow. Log `target?.id` each second. | `mob_aggroed_on_bot` source |
| P9 | **Name reuse and in-memory ItemStack** | Disconnect `Bot-1`. Spawn `Bot-1` again at +1, +5 and +20 ticks. `setItem` stacks held from the old bot (an enchanted, named, damaged sword). Check uniqueness, the new id, and that data survived. | Escape/summon flow |
| P10 | **Movement primitives** | `moveRelative(1, 0)` with `lookAtEntity(mob, Continuous)`: does the strafe persist, and does the look keep tracking? `dropSelectedItem()`: whole stack or one? | Strafe/back-off tactics, haul drop |
| P11 | **Hunger/saturation on bots, effect duration** | Read `player.hunger` / `player.saturation` on a fresh bot. Get poisoned by a cave spider and log `getEffects()` `.duration` at t and t+20 ticks. | Food logic, poison timer |
| P12 | **Dynamic property size** | Write and read back ASCII strings of 1,000, 5,000, 10,000, 20,000, 30,000, 31,000 and 40,000 chars with `world.setDynamicProperty`; record the largest size that round-trips. | Chunk size: `chunkChars = floor(0.9 * largest / 1000) * 1000` when the largest is under 30,000, else keep 30,000 (as S6 `judgePropSize`) |
| P13 | **Lifecycle events for bots** | Log `playerSpawn` (`initialSpawn`), `playerJoin`, `playerLeave` (before and after) for spawn, death+respawn and disconnect. In the before-event, try a `world.setDynamicProperty` and read it back after reload. | Bonus save path; rejoin detection |
| P14 | **Shield disabled by axe** | A vindicator (or a player with an axe) hits the blocking bot. Log `bot.getItemCooldown('shield')` each tick. The category name is a guess, so also try reading `getComponent('minecraft:cooldown')` from the shield `ItemStack`. | `bot_shield_disabled` atom |
| P15 | **Light semantics** (D18) | At open sky, log `Dimension.getLightLevel(pos)` and `getSkyLightLevel(pos)` at time-of-day 6000, 13000 and 18000 (set with `World.setTimeOfDay`); repeat in a sealed room with one torch at distance 2 and at distance 10, at night. Then stand a bot within 4 blocks of a spider at each setting and log whether `spider.target` is the bot (a spider only attacks unprovoked in low light). | Whether `getLightLevel` drops at night; the real spider neutrality threshold (`config.combat.spiderNeutralLight`); the `isDaylight` rule |
| P16 | **Sprint knockback** | Bot at 4 blocks from a husk on flat ground. (a) Attack standing still; (b) set `isSprinting = true`, `moveRelative(0, 1)` for 5 ticks, then `attackEntity`. Log the husk position at 0 and 10 ticks after the hit. | Whether S3 `knockback_then_retreat` gains distance; if (b) minus (a) < 1 block, S3 treats it as plain `rush_kill` (no failure) |
| P17 | **Projectile attacker** | A skeleton shoots a bot. Log `damageSource.cause`, `damageSource.damagingEntity?.typeId` and `damageSource.damagingProjectile?.typeId` in `entityHurt` (S:26770). | Whether S1 can attribute arrow hits to the skeleton |
| P18 | **Air supply unit and rate** | Bot underwater (no cheats on the bot): log `breathable.airSupply` and `breathable.totalSupply` every 20 ticks until `airSupply` stops decreasing or damage starts. Then surface and log recovery. | Unit of `airSupply` vs `totalSupply` (seconds), decrement per tick, and the A13 fallback (`airTicks = 300`) |
| P19 | **Save & Quit drops** (D32) | Bot holding three marked stacks (named `p19a` cobblestone 40, `p19b` cobblestone 40, `p19c` iron_sword) with the player standing 6 blocks away. The probe writes the bot's position to a dynamic property every 20 ticks and tells the player to Save & Quit within 200 ticks while the bot sprints in a straight line (`moveRelative(0, 1)`, `isSprinting = true`). On the next world load (`/colony:probe reloaddrops check`): `getEntities({ type: "minecraft:item", location: <recorded pos>, maxDistance: 64 })`, log each item's typeId, amount, nameTag and distance from the recorded position. | Whether Save & Quit leaves item entities at all (`snapshot.dropsOnDisconnect` for the reload path); whether the two 40-stacks merge; the maximum distance from the last recorded position (must be <= `snapshot.reloadDropScanRadius` 16, else raise it) |

---

## Safe usage rules for builders

1. **Only `src/game/adapter/` touches engine objects** (gametest imports only there, `test/boundaries.test.ts`).
   - Every engine call goes in `try/catch` and logs via the existing `rateLimitedLogger` / `logError` with `[colony]`.
   - Return the port's documented failure value; never let an engine error escape into the core.
2. **Validity first.** Check `entity.isValid` (a property, not a method) before every use of a cached `Entity`, `Player` or `SimulatedPlayer` handle, and again after any `system.run` delay.
   - `id` and `typeId` are readable on invalid entities. `name`, `location` and components are not.
   - Store **ids**, not handles, in the core.
3. **Re-query mobs every pump** with `getEntities`. Never keep a mob handle across ticks without re-checking `isValid`.
4. **Privileges**
   - Inside any `beforeEvents.*` callback (`chatSend`, `playerLeave`, `entityHurt`, shutdown, startup): no NRE calls (all SimulatedPlayer methods, every `Container` write, `setEquipment`, `addEffect`…), and no writes to RERO props (`isSneaking`, `isSprinting`, `selectedSlotIndex`, `amount`, `nameTag`, `durability.damage`).
   - Copy what you need, then `system.run(() => …)`.
   - `startup` is also **early execution**: no world or dimension access, only EEA calls.
5. **Beta members are isolated:** `Entity.target`, `Player.eatItem`, `EntityIsTamedComponent.tamedToPlayer(Id)`, `Block.isSolid`, `Dimension.getWeather`, `EntityBreathableComponent.airSupply` / `canBreathe`, `EquipmentSlot.Body`, `beforeEvents.chatSend`, and the whole gametest module.
   - One adapter function per beta member, each with a `try/catch` and a safe default:
     - `target` → `undefined`
     - `getWeather` → `Clear`
     - `isSolid` → fall back to `!isAir && !isLiquid`
     - `airSupply` / `canBreathe` → unknown (A13; use the controller's submerged-tick count)
     - `Player.eatItem` → not called (S3 never uses it)
     - `tamedToPlayer(Id)` → `undefined` (treat as tamed with an unknown owner)
     - `EquipmentSlot.Body` → never used
     - `beforeEvents.chatSend` → command parsing disabled, with a `[colony]` log
     - gametest module → adapter-only import (existing boundary test)
6. **Item conservation**
   - Use engine moves (`swapItems`, `transferItem`, `moveItem` into an empty slot) wherever possible.
   - Script writes (`setItem`, `addItem`, `setEquipment`, `new ItemStack`) are only allowed in:
     - (a) Phase 2 crafting
     - (b) the ordered equip swap (D3)
     - (c) snapshot restore, exactly once per snapshot id
   - Mark the snapshot consumed **before** restoring. Restore only when `bot.isValid` and `bot.isOnGround === true` (S:9523) on two consecutive pumps (>= 4 ticks apart).
7. **Never use for gameplay (the single authoritative list):** `SimulatedPlayer.giveItem`/`setItem`/`useItem`/`useItemOnBlock`/`resetTo*`, `SimulatedPlayer.interactWithEntity` (tameables), `Entity.addItem`/`teleport`/`tryTeleport`/`applyDamage`/`applyImpulse`/`applyKnockback`/`kill`/`remove`/`triggerEvent`/`clearVelocity`/`addEffect`/`runCommand`, `EntityTameableComponent.tame`, `Player.eatItem` (unless `allowManualEat` is approved, C7), `Dimension.spawnItem`/`spawnEntity`, attribute `setCurrentValue`/`resetTo*`, `Block.setType`/`setPermutation`, `Dimension.setBlockType`, `move()`, `setBodyRotation`, `World.setTimeOfDay`, game-rule writes, `clearDynamicProperties`. **Exception:** the APIs in section I, only inside `fixtures.ts` / `combat-helpers.ts`.
8. **Never snapshot `EquipmentSlot.Mainhand`.** It's the selected hotbar slot.
9. **Always pass `LookDuration` explicitly.** Never use `move()` or `setBodyRotation()` (GameTest-relative) for top-level bots.
10. **Before attacking:** `stopBreakingBlock()` if the bot is breaking, then select the weapon slot (`selectedSlotIndex`), then check reach and LOS in the adapter, then `attackEntity`.
11. **Unknown ids:** `getEffect`, `ItemStack` constructor, `EnchantmentType` constructor and `getComponent` can throw on unknown ids. Validate with `EffectTypes.get` / `ItemTypes.get` S:16758 / `EnchantmentTypes.get` first, or catch.
12. **Dynamic properties:** namespaced keys (`colony:…`), chunked, written new-chunks-then-pointer (F).  Never `clearDynamicProperties()`.

---

## Revision log (review pass 1)

Every added line number was checked against `node_modules/@minecraft/server/index.d.ts` with `grep -n` / direct line reads (all matched).

DECISIONS rows:
- D8 (`EntityItemComponent.itemStack`): applied. New A14: class S:12195, `itemStack` S:12203 (stable, throws, no privilege), component id S:12204, map S:3270, enum S:991.
- D18 (probe P15 light semantics): applied. A9 row renamed "Total light (block and sky)", semantics paragraph, `isDaylight` from `getTimeOfDay()`, probe P15 added.
- D20 (`minecraft:breathable`): applied. New A13 (class S:10877, `airSupply` S:10890 beta, `totalSupply` S:10955, `canBreathe` S:10926 beta), fallback and probe P18. Sharpness and honey_bottle are not API-MAP items.

Findings:
- API-MAP--completeness#1: applied (A13; line numbers verified).
- API-MAP--completeness#2: applied (A4 `Entity.dimension` S:9470).
- API-MAP--completeness#3: applied (new section I; merged with consistency#1: 12 rows incl. `doMobSpawning` S:14645, `mobGriefing` S:14705, `setTimeOfDay` S:24601, `spawnEntity` S:8901, `kill`/`remove`).
- API-MAP--completeness#4: changed (air-supply probe added as P18, not "P14": P14 is the shield-disabled probe).
- API-MAP--completeness#5: applied (Impossible table row "Air supply").
- API-MAP--consistency#1: applied (section I plus the rule 7 exception; `Entity.teleport`, `clearVelocity`, `remove`, `triggerEvent`, `kill`, `addEffect`, `Container.setItem`, `new ItemStack`, `setEquipment`, `setCurrentValue`).
- API-MAP--consistency#2: applied (F uses S4a §4.2 keys `:p`, `<seq>:<i>`, `:r`, `colony:meta`; pointer written last). Conflicts with precision#1's `:ptr`/`gen` names: S4a is authoritative, so precision#1's write order is kept but its key names are not.
- API-MAP--consistency#3: applied (A5 uses `config.combat.approachRadius`).
- API-MAP--consistency#4: applied (rule 7 is the superset incl. `tame`, `interactWithEntity`, `eatItem`, `move()`, `setBodyRotation`, `spawnEntity`, `setType`/`setBlockType`/`setPermutation`, `clearDynamicProperties`; H points to it).
- API-MAP--consistency#5: applied (one line under the D5 table: NO rows = *excluded*, trims and banner patterns = *invisible*).
- API-MAP--game-api#1: applied (A13; same content as completeness#1; the "used by S1 §5 and §9" note kept).
- API-MAP--game-api#2: applied (A9 row renamed, semantics paragraph).
- API-MAP--game-api#3: applied (P15 row, with `World.setTimeOfDay` for the time changes).
- API-MAP--game-api#4: applied (P16 row; uses a husk per S6 rule 6 instead of a zombie).
- API-MAP--game-api#5: applied (note in the `EntityDamageSource` row, P17; `damagingProjectile` S:26770 verified by grep).
- API-MAP--logic#1: applied (A5 (c) uses the mob's own displacement and radius 6; S1 §5.3 still uses `prev.dist - distance` and must follow: cross-doc hand-off).
- API-MAP--logic#2: applied (`getEntitiesFromRay` row: filter the origin entity).
- API-MAP--precision#1: changed (see consistency#2: pointer-last order and ASCII/size rules applied with S4a's key names).
- API-MAP--precision#2: applied (A5 proxy rewritten with config keys; "N ticks" in the Impossible row replaced by `provokeMemoryTicks`).
- API-MAP--precision#3: applied (D5: exact list of understood components and the `lossy` rule).
- API-MAP--precision#4: applied (D5: in-memory only, no chest deposit, `[colony] lossy stack dropped <typeId>`).
- API-MAP--precision#5: changed (F: ASCII unit sentence added; P12 now tests 1,000 to 40,000 chars. The chunk formula follows S6 `judgePropSize`: `floor(0.9 * largest / 1000) * 1000` below 30,000, else 30,000; S6 §1.5 owns the verdict).
- API-MAP--precision#6: applied (D3 step 4 with (a), (b), (c) rollback).
- API-MAP--precision#7: applied (rule 6: `isValid` and `isOnGround === true` on two pumps >= 4 ticks apart).
- API-MAP--precision#8: applied (A10: seven ids and the allow-list sentence).
- API-MAP--precision#9: applied (H points to rule 7; `tryTeleport` added to rule 7).
- API-MAP--precision#10: applied (G safe cell definition).
- API-MAP--precision#11: applied (`config.snapshot.intervalTicks` in the Impossible row).
- API-MAP--precision#12: applied (`config.body.meleeReach` in the C table row and the Impossible row).
- API-MAP--precision#13: applied (P3: `config.body.attackIntervalTicks`).
- API-MAP--precision#14: applied (sentence above the probe table; S6 §1.5 owns thresholds).
- API-MAP--precision#15: applied (D1 `moveItem` row).
- API-MAP--precision#16: applied (rule 5 defaults for `eatItem`, `tamedToPlayer(Id)`, `EquipmentSlot.Body`, `chatSend`, gametest, plus `airSupply`/`canBreathe`).

Hand-offs: S6 documents "14 probes P1-P14"; it must add P15-P18 (P15 required by D18). S1 §5.3 `approaching` must use the mob's own displacement.
