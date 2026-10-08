# S3: Body control (Phase 3, Combat I)

Owner: S3 spec writer. Builder: **B5** (Sonnet). Data sources: `docs/phase3/API-MAP.md` (call bindings; cited as `API-MAP §X`), `docs/phase3/MOBS.md` (cited as `MOBS §n`), `docs/phase3/TABLES.md`.
Names are fixed by `docs/PHASE3-SPEC.md` §4. Where this file adds a name, it says so. If anything here is unclear, B5 **reports the gap**; it does not invent a design.

## 0. Layering and files

`src/game/bots/**` may not import `@minecraft/*` or `adapter/` (`test/boundaries.test.ts`). So:

| Layer | File | Imports | Owner |
|---|---|---|---|
| Port types (`BodyActions`, `BodyReads`, `CombatBody`, helper types) | `src/game/bots/ports.ts` (appended) | none | contract writer, exact code in §1 |
| Tactic/eating shared types (`TacticRunner`, `TacticContext`, `MobView`, `TacticSignals`, `EatContext`) | `src/game/bots/body/types.ts` | `ports.ts`, `core/types.ts`, `core/combat/types.ts` | contract writer, exact code in §3.1 |
| Core data types (`TacticName`, `Condition`, `MobEntry`, `MobKnowledge`) | `src/core/combat/types.ts` | none | contract writer, exact code in §2 |
| Engine binding of every primitive | `src/game/adapter/body.ts` (new) | `@minecraft/server`, `@minecraft/server-gametest` | B5 |
| Pure geometry and block scans | `src/game/bots/body/geometry.ts`, `scan.ts` | `ports.ts` | B5 |
| Tactic runners | `body/tactics.ts` (factory + `break_line_of_sight`, `retreat_and_regen`, `flee_sneak`, `avoid_path_around`, `sprint_away`, `take_cover_overhead`), `body/melee.ts` (`melee_crit`, `melee_strafe`, `hit_and_back_off`, `rush_kill`, `knockback_then_retreat`), `body/shield.ts` (`shield_hold`, `shield_advance_zigzag`, `swoop_counter`, `low_ceiling_fight`) | `ports.ts`, `body/types.ts`, geometry, scan | B5 |
| Eating | `body/eating.ts` | same | B5 |
| Equipment | `body/equipment-logic.ts` (pure), `body/equipment.ts` (manager) | same | B5 |
| Probes | `src/probes/combat/*.ts` | gametest allowed | B5 |
| Tests | `test/body-*.test.ts` (list in §9) | fakes | B5 |

Hard rules for B5:
- Every engine call is inside `adapter/body.ts`, wrapped in `try/catch`, logged with `[colony]` via `rateLimitedLogger(`${name}.body.`)` (from `adapter/world.ts`; 1st failure then every 25th). The port method returns its documented failure value; an engine error never escapes.
- Check `p.isValid` before every call; if invalid return the failure value without logging (the runtime removes the bot).
- Never call a "forbidden for gameplay" API (`API-MAP` safe-usage rule 7). Never use `move()`/`setBodyRotation()`. Always pass `LookDuration` explicitly.
- All adapter methods run from `system.run*`/after-event contexts only (they are NRE). The controller already guarantees this (it runs on the 4-tick pump).
- Time in the adapter = `system.currentTick`. Time in runners = the `now` argument.
- A **pump** is 4 ticks (`config.body.pumpTicks`, must equal the runtime pump). Runners are stepped once per pump, so every time threshold below is checked with `>=` and has 4-tick granularity.

---

## 1. `BodyActions` port

Append to `src/game/bots/ports.ts` (contract writer). `Vec3` and `Tick` come from `core/types.js`, `NavInfo` from `executor-logic.js`, `ItemStackView`/`InventorySnapshot` are already in `ports.ts`.

```ts
// ---------------------------------------------------------------- Phase 3 combat body (S3)

/** A look target: a string is an entity id, an object is a world position. */
export type LookTarget = string | Vec3;

/** "hit" = the attack was performed (the engine accepted it). It does NOT promise damage (invulnerability, shield). */
export type AttackResult = "hit" | "out_of_reach" | "no_los" | "cooldown" | "invalid";

export type ShieldMethod = "sneak" | "use_item";
export type ShieldState = "down" | "raising" | "up";
export type EquipSlotName = "head" | "chest" | "legs" | "feet" | "offhand";
export type StrafeDir = "left" | "right";

export type EatStart = "started" | "no_item" | "not_food" | "failed";
/** idle: nothing started. eating: in progress. done: consumed. interrupted: stopped before completion
 *  (stopUsingItem event or stopEating()). failed: timed out or the engine refused. done/interrupted/failed are
 *  reported once, then the state returns to idle. */
export type EatStatus = "idle" | "eating" | "done" | "interrupted" | "failed";

/** Optional enchantments per stack. Contract writer: add `enchants?` to ItemStackView (see §10 CR-1). */
export interface EnchantView { id: string; level: number } // id WITHOUT "minecraft:" e.g. "sharpness"

/** Armour + offhand as plain data. Never includes Mainhand (it aliases the selected hotbar slot). */
export interface EquipmentView {
  head?: ItemStackView;
  chest?: ItemStackView;
  legs?: ItemStackView;
  feet?: ItemStackView;
  offhand?: ItemStackView;
}

export interface BodySelfState {
  pos: Vec3;            // feet
  eye: Vec3;            // Entity.getHeadLocation()
  vel: Vec3;            // Entity.getVelocity(); vel.y < 0 and !onGround = falling
  onGround: boolean;
  inWater: boolean;
  sneaking: boolean;
  sprinting: boolean;
  hp: number;
  maxHp: number;
  hunger: number;       // player.hunger currentValue; 20 if the component is unreadable
  saturation: number;   // 0 if unreadable
  selectedSlot: number; // hotbar index 0..8
}

export interface BodyEntityState {
  id: string;
  typeId: string;
  valid: boolean;
  pos: Vec3;                                  // feet
  eye: Vec3;                                  // getHeadLocation()
  vel: Vec3;
  aabb: { center: Vec3; extent: Vec3 };       // extent = HALF sizes (API-MAP §A4, S:25838)
  onGround: boolean;
  inWater: boolean;
  isBaby: boolean;                            // hasComponent('minecraft:is_baby')
  charged: boolean;                           // hasComponent('minecraft:is_charged')
  ignited: boolean | undefined;               // hasComponent('minecraft:is_ignited'); undefined = unreadable (P7 unverified)
  tamed: boolean;                             // is_tamed component or tameable.isTamed
}

/** Read-side of the body. Cheap, no side effects. undefined = unreadable/invalid. */
export interface BodyReads {
  self(): BodySelfState | undefined;
  /** Any entity by id (world.getEntity wrapped; invalid ids give undefined). */
  entity(id: string): BodyEntityState | undefined;
  equipment(): EquipmentView | undefined;
  /** Current engine tick (system.currentTick). */
  tick(): Tick;
}

export interface BodyActions {
  // ----- look & move (API-MAP §C)
  /** Face an entity (string id) or a position. Re-issue every pump while tracking. Returns false if the call threw. */
  lookAt(target: LookTarget): boolean;
  /** Straight-line move. `speed` 0..1 (fraction of the current gait). `face` default true (turn toward `pos`). */
  moveToward(pos: Vec3, speed: number, face?: boolean): boolean;
  /** Pathfinding move (navigateToLocation). undefined = threw (e.g. not on ground). */
  navigateToward(pos: Vec3, speed: number): NavInfo | undefined;
  /** Sideways relative to the current facing, until stopMoving()/another move. */
  strafe(dir: StrafeDir, speed: number): boolean;
  /** Move directly away from `fromPos` while the bot keeps its current facing (so it keeps looking at the threat). */
  backOff(fromPos: Vec3, speed: number): boolean;
  stopMoving(): void;
  /** Writes SimulatedPlayer.isSprinting. Returns the state after the write (read back).
   *  setSprinting(true) returns false (and does nothing) if hunger < config.body.sprintMinHunger, the shield is raised,
   *  the bot is eating, or the bot is in water. setSprinting(false) always returns false. */
  setSprinting(on: boolean): boolean;
  /** true only if the bot was on the ground and the engine performed the jump. */
  jump(): boolean;

  // ----- melee
  /** Enforces reach (eye to target AABB <= config.body.meleeReach), line of sight, the never-target list, and
   *  config.body.attackIntervalTicks. See §1.2 for the exact algorithm. */
  attackTarget(entityId: string): AttackResult;

  // ----- shield
  /** Starts raising the shield by config.body.shieldMethod. false if canBlock() is false or the bot is eating. */
  raiseShield(): boolean;
  /** Idempotent. */
  lowerShield(): void;
  /** "up" only after config.body.shieldRaiseTicks have passed since the raise. */
  shieldState(): ShieldState;
  /** config.body.shieldEnabled AND the shield is where the method needs it (offhand for "sneak", hotbar slot
   *  config.body.shieldHotbarSlot for "use_item") AND remaining shield durability > config.body.preserveRemainingPoints.
   *  S1/S2 MUST derive `bot_has_shield` from this (plus the 10% durability rule), not from the inventory alone. */
  canBlock(): boolean;

  // ----- eating (§4)
  startEating(slot: number): EatStart;
  eatStatus(): EatStatus;
  isEating(): boolean;
  /** Stops the use, restores the previously selected hotbar slot. Idempotent. */
  stopEating(): void;

  // ----- inventory / equipment (§5)
  /** Same contract as WorkerBody.selectSlot (one implementation serves both). */
  selectSlot(slot: number): boolean;
  /** Safe ordered swap of inventory slot `slot` with the equipment slot (API-MAP §D3). false = nothing changed. */
  equipFromSlot(slot: number, to: EquipSlotName): boolean;
  /** Move the equipment item into the first free inventory slot (§1.3). false = nothing changed. */
  unequip(from: EquipSlotName): boolean;
  stopBreaking(): void;
  /** Writes Entity.isSneaking; read back. Returns the state after the write. */
  setSneaking(on: boolean): boolean;
  /** One dropSelectedItem() call for the item in `slot` (§1.3). Returns the number of items that left the bot (0 = failed). */
  dropSlot(slot: number): number;
  /** Bot line in chat: world.sendMessage(`<${name}> ${text}`), truncated to 200 chars. */
  chat(text: string): void;
}

/** What the combat layer receives for one bot: Phase 2 worker + Phase 3 body. selectSlot has one signature in both. */
export type CombatBody = WorkerBody & BodyActions & BodyReads;
```

Adapter factory (in `adapter/body.ts`, exported; the runtime calls it once per bot after `adoptBot`/`spawnBot`):

```ts
export function wrapCombatBody(p: SimulatedPlayer, name: string, worker: WorkerBody, cfg: BodyConfig): CombatBody;
/** Call once at worldLoad. Subscribes itemCompleteUse and itemStopUse (API-MAP §B) and records, per player id, the last
 *  event tick + typeId. No-op if called twice. */
export function initBodyEvents(): void;
```
`wrapCombatBody` returns `{ ...worker, ...bodyActions, ...bodyReads }`; `selectSlot` is taken from `worker` (same behaviour).

### 1.1 Binding table (every primitive → engine call)

| Port method | Engine binding | API-MAP ref | Notes |
|---|---|---|---|
| `lookAt(id)` | `p.lookAtEntity(entity, LookDuration.Continuous)` | §C "Look at entity" G:737 | **Enderman guard:** if the target `typeId === "minecraft:enderman"` use `lookAtLocation({x: pos.x, y: pos.y + 0.1, z: pos.z}, Continuous)` (feet) instead. Never aim at its head (gaze aggro, MOBS §3 enderman). Also if `minecraft:warden`, aim at feet. |
| `lookAt(pos)` | `p.lookAtLocation(pos, LookDuration.Continuous)` | §C G:749 | Probe P10: if `Continuous` does not track a moving target, the result is still correct because runners re-issue `lookAt` every pump (≤ 4 ticks stale). |
| `moveToward(pos, speed, face=true)` | `p.moveToLocation(pos, { speed: clamp01(speed), faceTarget: face })` | §C G:804, `MoveToOptions` G:2693 | Overrides any current move/navigation. |
| `navigateToward(pos, speed)` | `p.navigateToLocation(pos, clamp01(speed))` → `{ pathLength: r.getPath().length, isFullPath: r.isFullPath }` | §C G:864 | Needs the bot on the ground; a throw returns `undefined`. Same pattern as `wrapSimulatedPlayer.navigateTo`. |
| `strafe(dir, speed)` | `config.body.relativeMoveMethod === "relative"`: `p.moveRelative(dir === "left" ? s : -s, 0, speed)` with `s = config.body.strafeLeftSign` (±1); `"move_to"`: `moveToLocation(self + lateral*3, { speed, faceTarget: false })` where lateral = unit perpendicular of the bot's facing (from `getViewDirection()`), sign by `dir` and `strafeLeftSign` | §C `moveRelative` G:775, probe P10 | Sign of `leftRight` is not documented in the d.ts: P10 sets `strafeLeftSign`. |
| `backOff(fromPos, speed)` | `"relative"`: `p.moveRelative(0, -s, speed)` (backward relative to facing); `"move_to"`: `moveToLocation(self + unit(self − fromPos)*4, { speed, faceTarget: false })` | §C G:775 / G:804 | Sprint is forced off first (no sprinting backwards). |
| `stopMoving()` | `p.stopMoving()` | §C G:1005 | |
| `setSprinting(on)` | `p.isSprinting = on` then read back `p.isSprinting` | §C "Sprint" G:539 (writable on SimulatedPlayer, RERO) | Probe (light): if the flag drops while moving, runners re-assert `setSprinting(true)` **every pump** (they already do, see tables). |
| `jump()` | `if (!p.isOnGround) return false; return p.jump()` | §C G:709 | |
| `attackTarget(id)` | `p.attackEntity(entity)` after the checks in §1.2 | §C G:564 + §A4 `getHeadLocation` S:10150, `getAABB` S:9970 + §A8 rays | The engine ignores reach and LOS, so this method is the only enforcement point. |
| `raiseShield()` / `lowerShield()` / `shieldState()` | `"sneak"`: offhand shield + `p.isSneaking = true/false`. `"use_item"`: `p.selectedSlotIndex = shieldHotbarSlot; p.useItemInSlot(shieldHotbarSlot)` / `p.stopUsingItem()` + restore the previously selected slot | §C6 candidates A and B (S:9541, G:1059, G:1026) | Probe P1 decides the default. Both variants are specified in §1.4. |
| `startEating(slot)` / `eatStatus()` / `stopEating()` | `p.selectedSlotIndex`, `p.useItemInSlot(slot)`, `p.stopUsingItem()`, events `world.afterEvents.itemCompleteUse` S:24840 / `itemStopUse` S:24877, hunger via `getComponent('minecraft:player.hunger')` | §C7 Primary approach, §A11 | §4. The fallback `Player.eatItem` needs player approval and is OFF (`allowManualEat=false`). |
| `selectSlot(slot)` | `p.selectedSlotIndex = slot` (0..8 only) | §C S:18131 | Reuse the Phase 2 implementation. |
| `equipFromSlot(slot, to)` | `Container.getItem/setItem`, `EntityEquippableComponent.getEquipment/setEquipment` (ordered, §1.5) | §D3 | No engine move into equipment exists. |
| `unequip(from)` | `Container.setItem` on a free slot, then `setEquipment(slot, undefined)` (ordered, §1.5) | §D3 | |
| `stopBreaking()` | `p.stopBreakingBlock()` | §C G:961 | Idempotent. |
| `setSneaking(on)` | `p.isSneaking = on` then read back | §C S:9541 | Probe P6 (if not writable → `config.body.sneakEnabled=false`, see §6). |
| `dropSlot(slot)` | select a hotbar slot holding the stack, `p.dropSelectedItem()` | §C G:611 | §1.3. |
| `chat(text)` | `world.sendMessage(`<${name}> ${text}`)` | §C "Chat" row and Safe rule: **not** `p.chat` | `p.chat` probably goes through chat events and could be parsed as a `!` command. |
| `self()` | `p.location`, `getHeadLocation()`, `getVelocity()`, `isOnGround`, `isInWater`, `isSneaking`, `isSprinting`, health `currentValue/effectiveMax`, `player.hunger/saturation` `currentValue`, `selectedSlotIndex` | §A3, §A4, §A11 | Each component read in its own `try`; a failed hunger read gives `hunger = 20`, `saturation = 0`. Only `pos`, `eye`, `hp` failing returns `undefined`. |
| `entity(id)` | `world.getEntity(id)` (throws for bad ids → `undefined`), then `isValid`, `location`, `getHeadLocation()`, `getVelocity()`, `getAABB()`, `isOnGround`, `isInWater`, `hasComponent('minecraft:is_baby'/'is_charged'/'is_ignited'/'is_tamed')`, `getComponent('minecraft:tameable')?.isTamed` | §A2, §A4, §A6, §A7, §H | |
| `equipment()` | `getComponent('minecraft:equippable')` + `getEquipment(Head/Chest/Legs/Feet/Offhand)` → `stackView` (durability and `enchants` added) | §D3 | |
| `tick()` | `system.currentTick` | §H | |

### 1.2 `attackTarget(entityId)` exact algorithm

Per-bot state in the closure: `lastAttackTick = -1000`. Steps, first failing step returns:
1. `p.isValid` false → `"invalid"`.
2. `target = world.getEntity(entityId)` in `try`; throws/undefined/`!target.isValid` → `"invalid"`.
3. **Never-target (defence in depth, the brain also filters):** `target.typeId` in `{minecraft:player, minecraft:villager, minecraft:villager_v2, minecraft:wandering_trader, minecraft:iron_golem, minecraft:snow_golem, minecraft:copper_golem, minecraft:allay, minecraft:npc, minecraft:armor_stand}` or tamed (`hasComponent('minecraft:is_tamed')` or `getComponent('minecraft:tameable')?.isTamed`) → `"invalid"` and log once per type.
4. `now - lastAttackTick < config.body.attackIntervalTicks` → `"cooldown"`.
5. **Reach:** `eye = p.getHeadLocation()`, `box = target.getAABB()`. `reachDistance(eye, box) = sqrt(Σ over axes of max(|eye_a − center_a| − extent_a, 0)²)`. If `> config.body.meleeReach` (3.0) → `"out_of_reach"`.
6. **Line of sight** (two rays, both from `eye`, `BlockRaycastOptions { maxDistance: len, includeLiquidBlocks: false, includePassableBlocks: false }`, API-MAP §A8):
   - `q1` = the point of the AABB nearest to `eye` (clamp each axis of `eye` into `[center−extent, center+extent]`).
   - `q2` = `box.center`.
   - For each `q`: if `dist(eye,q) < 0.05` the ray is clear; else `hit = dim.getBlockFromRay(eye, unit(q−eye), { maxDistance: dist(eye,q) − 0.05, ... })`; clear if `hit === undefined`.
   - LOS = `q1 clear OR q2 clear`. Neither → `"no_los"`.
7. **Friendly in the line:** `dim.getEntitiesFromRay(eye, unit(q−eye), { maxDistance: dist(eye,q), ignoreBlockCollision: true })` for the clear `q`; if any hit with `distance < dist(eye,q) − 0.3` has a never-target typeId or is tamed → `"no_los"` (MOBS §2.1 "never hit through a friendly"). A throw here is ignored (treated as no friendly).
8. `p.stopBreakingBlock()` (safe rule 10; ignore throws). The weapon is selected by the caller (`EquipmentManager.ensureWeaponSelected()`), never here.
9. `ok = p.attackEntity(target)`. `true` → `lastAttackTick = now`, return `"hit"`. `false` → return `"cooldown"` (the API says false = on cooldown or no valid target; the engine decided). A throw → log, `"invalid"`.
10. The method never changes the bot's facing, never calls `lookAt*` (keeps the enderman rule safe).

Effective attack spacing: runners are stepped every 4 ticks, so the real minimum spacing is `ceil(10/4)*4 = 12` ticks. This is intended (Bedrock has no attack cooldown but a target is invulnerable to equal damage ~10 ticks; MOBS §1.1, verify via probe P3 which may change `attackIntervalTicks`).

### 1.3 Other adapter algorithms

**`setSprinting(on)`**: `on=false`: `p.isSprinting=false; return false`. `on=true`: return false if `self.hunger < sprintMinHunger (7)` (TABLES §1: sprint only if hunger > 6), or `shieldState() !== "down"`, or eating, or `p.isInWater`. Else write `true`, `p.isSneaking = false` first if it was true (but only when the shield is down, already checked), read back, return the read-back value.

**`jump()`**: refuses while eating or while the shield is up in `use_item` mode; otherwise as in the table.

**`dropSlot(slot)`** (used by S4 for "drop items at the owner's feet"; one call = one drop; S4 loops once per pump until the slot is empty):
1. `c = inventory container`; `s0 = c.getItem(slot)`; none → return 0. `before = s0.amount`.
2. If `slot >= 9`: `scratch = config.body.dropScratchSlot (8)`; `c.swapItems(slot, scratch, c)` (engine swap, conserving) and remember to swap back. Else `scratch = slot`.
3. `prev = p.selectedSlotIndex`; `p.selectedSlotIndex = scratch`; `ok = p.dropSelectedItem()`; `p.selectedSlotIndex = prev`.
4. If a swap was made: `c.swapItems(slot, scratch, c)` again (the scratch slot's original item returns). 
5. Return `before − (c.getItem(slot)?.amount ?? 0)` if `ok` and the same typeId remains/empties; else 0. Dropped items can be picked up again by the bot after ~40 ticks; the caller must move ≥ 3 blocks away (conservation holds either way).

**`unequip(from)`** and **`equipFromSlot`** use §1.5.

### 1.4 Shield variants (config switch `config.body.shieldMethod`)

| | `"sneak"` (default, candidate A) | `"use_item"` (candidate B) |
|---|---|---|
| Shield must be in | `Offhand` (placed by the equipment manager) | hotbar slot `config.body.shieldHotbarSlot` (8); offhand left alone |
| `raiseShield()` | `canBlock()` else false; `setSprinting(false)`; `p.isSneaking = true`; read back must be `true` (else log once, return false); `raisedAt = now` if it was down | `canBlock()` else false; `prevSelected = p.selectedSlotIndex`; `p.selectedSlotIndex = shieldHotbarSlot`; `ok = p.useItemInSlot(shieldHotbarSlot)`; `raisedAt = now` |
| `lowerShield()` | `p.isSneaking = false` (only if the adapter raised it; never clears a sneak requested by `setSneaking`) | `p.stopUsingItem()`; `p.selectedSlotIndex = prevSelected` |
| `shieldState()` | `down` if not raised; `raising` while `now − raisedAt < shieldRaiseTicks (5)`; else `up`. Also `down` if the read-back `p.isSneaking` is false (something else cleared it) | same, plus `down` if `stopUsingItem` ended the use |
| Side effects | sneak speed (about 1.3 b/s); cannot sprint | main hand holds the shield: the sword is not selected, so `attackTarget` needs `lowerShield()` first (this is why runners always lower before striking) |
| Eating | allowed while sneaking, but `startEating` lowers first | `startEating` lowers first (it needs the use) |

Probe P1 result mapping is in §6. If neither variant blocks: `config.body.shieldEnabled = false`, `canBlock()` returns false, every shield tactic is skipped by S2 (`bot_has_shield` false) and the equipment manager keeps the shield in the inventory unused.

### 1.5 Ordered swap (the only way an item enters or leaves an equipment slot; "never duplicate")

All steps run **synchronously in one call**, no `system.run`, no await, so nothing can interleave. A per-slot guard refuses a second equip of the same `EquipSlotName` in the same tick. `inv` = the bot's `Container`, `eq` = `EntityEquippableComponent`, `S` = the engine `EquipmentSlot` for `to`.

`equipFromSlot(i, to)`:
1. Validate before touching anything: `item = inv.getItem(i)` exists; item is valid for `to` (`head/chest/legs/feet` by typeId suffix `_helmet`/`_chestplate`/`_leggings`/`_boots`, excluding `minecraft:elytra`; `offhand` accepts `minecraft:shield` only); the item has no `binding` enchantment; the current equipment item is not `binding`-enchanted and is not `minecraft:totem_of_undying` in `offhand`. Any failure → `false`, nothing changed.
2. `prev = eq.getEquipment(S)` (a copy), `item = inv.getItem(i)` (a copy).
3. `inv.setItem(i, prev)` (`prev` may be `undefined` → clears the slot). *(`prev` now exists twice, once in the slot and once still in equipment; `item` exists only in memory. This window is closed within this same call.)*
4. `ok = eq.setEquipment(S, item)`.
5. If step 3 or 4 threw, or `ok === false`, or the read-back check fails (`eq.getEquipment(S)?.typeId !== item.typeId` or `inv.getItem(i)?.typeId !== prev?.typeId`): **rollback**: `inv.setItem(i, item)` then `eq.setEquipment(S, prev)`; each retried up to 3 times on throw. Return `false`. If the rollback itself fails 3 times, log `[colony] EQUIP FAULT <bot> <slot>` at error level (`logError`) so the player sees it; nothing else is attempted. 
6. Success: return `true`; the caller (equipment manager) calls `onChanged()` so the snapshot is marked dirty (equipment changes are invisible to `playerInventoryItemChange`, API-MAP §B).

`unequip(from)`:
1. `item = eq.getEquipment(S)`; none → `false`. If binding-enchanted → `false`.
2. Find `e` = first empty slot in `9..35`, then `0..8` excluding `config.body.weaponSlot`, `config.body.foodSlot`, `config.body.shieldHotbarSlot`. None → `false`.
3. `inv.setItem(e, item)`; then `ok = eq.setEquipment(S, undefined)`.
4. If throw or `ok === false`: rollback `inv.setItem(e, undefined)` (retry 3x). Return `false`. Else `true`.

Hotbar/inventory-only moves (weapon to the weapon slot, food to the food slot, shield to the shield slot in `use_item` mode) use `WorkerBody.swapSlots(a, b)` = `Container.swapItems` (engine swap, conserving). Never `setItem` for those.

---

## 2. Core data shapes (`src/core/combat/types.ts`, contract writer)

### 2.1 TacticName (exactly MOBS §5)

```ts
export type TacticName =
  | "melee_crit" | "melee_strafe" | "hit_and_back_off" | "shield_advance_zigzag" | "shield_hold"
  | "knockback_then_retreat" | "low_ceiling_fight" | "rush_kill" | "swoop_counter" | "break_line_of_sight"
  | "retreat_and_regen" | "flee_sneak" | "avoid_path_around" | "sprint_away" | "take_cover_overhead";
export const TACTIC_NAMES: readonly TacticName[] = [/* the 15 names above, same order */];
```

### 2.2 Condition grammar (MOBS §1.5) as a discriminated union

```ts
export type BoolAtom =
  | "always" | "mob_in_water" | "bot_in_water" | "mob_is_baby" | "mob_hissing" | "mob_aggroed_on_bot"
  | "mob_has_los" | "bot_has_shield" | "bot_shield_disabled" | "has_cover_within_8" | "has_low_ceiling_within_8"
  | "has_roof_within_10" | "ground_flat" | "mob_is_diving" | "is_daylight" | "is_thunderstorm" | "mob_charged"
  | "mob_size_large" | "mob_size_medium" | "mob_size_small" | "target_is_objective_blocker";

export type NumAtom =
  | "hp_below" | "hp_at_least" | "dist_below" | "dist_at_least" | "count_at_least" | "hostile_count_at_least"
  | "poisoned_and_hp_below" | "slowed_and_hp_below" | "wither_and_hp_below"
  | "shield_durability_below_pct" | "armor_durability_below_pct";

export type Condition =
  | { kind: "bool"; atom: BoolAtom; negated: boolean }   // `not_` prefix => negated: true
  | { kind: "num"; atom: NumAtom; n: number }
  | { kind: "and"; terms: Condition[] }                  // >= 2 terms
  | { kind: "or"; terms: Condition[] };                  // >= 2 terms
```

**Parser** (`parseCondition(src: string): Condition`, in `core/combat/mobs.ts`, B2; spec here so both sides agree):
1. `src.trim()`; split on the regex `/\s+OR\s+/` into groups; split each group on `/\s+AND\s+/` into terms. **AND binds tighter than OR; no parentheses.** A group with one term is that term (no `and` wrapper); a single group is returned without an `or` wrapper.
2. Term regex: `^(not_)?([a-z0-9_]+)(?::\s*(-?\d+(?:\.\d+)?))?$`.
   - If the name (without `not_`) is a `NumAtom`: a number is required and `not_` is forbidden → `{kind:"num"}`.
   - Else if it is a `BoolAtom`: a number is forbidden; `not_always` is forbidden → `{kind:"bool", negated: !!not_}`.
   - Anything else: `throw new Error(`bad condition term "${term}" in "${src}"`)`.
3. Divergence from MOBS §1.5 (which says "conjunction only"): MOBS §3 uses `OR` in three places (drowned `mob_in_water OR bot_in_water`, creeper `not_mob_aggroed_on_bot OR mob_charged`, phantom `hostile_count_at_least: 3 OR hp_below: 10`), so `or` is supported. A `flee_if` list item may itself be an `AND` conjunction (e.g. `bot_in_water AND hp_below: 12`); the list means any-of.
4. Examples that must round-trip in `test/combat-kb.test.ts`: `"not_mob_is_baby AND ground_flat AND count_at_least: 1"`, `"mob_in_water OR bot_in_water"`, `"shield_durability_below_pct: 10 AND count_at_least: 2"`, `"always"`.

### 2.3 MobEntry / MobKnowledge (keys are the YAML keys, snake_case, same order as MOBS §1.2)

```ts
export type Difficulty = "easy" | "normal" | "hard";                 // Peaceful is treated as "normal"
export type MoveSpeed = "slow" | "normal" | "fast";
export type EngagePolicy = "engage" | "engage_if_blocking" | "avoid" | "flee";
export type CounterGear = "shield" | "sword" | "axe" | "armor" | "carved_pumpkin" | "food" | "milk_bucket" | "water_bucket" | "blocks" | "none";
export type Special =
  | "burns_in_daylight" | "breaks_doors_hard" | "inflicts_hunger" | "poison" | "slowness" | "weakness" | "explodes"
  | "teleports" | "gaze_aggro" | "water_vulnerable" | "ranged_projectile" | "throws_potions" | "self_heals"
  | "climbs_walls" | "jump_attack" | "splits_on_death" | "hides_in_blocks" | "calls_allies" | "flying" | "swoops"
  | "vibration_sensing" | "ignores_shield" | "ignores_armor" | "darkness_pulse" | "fire_immune"
  | "bad_omen_if_captain" | "neutral_in_daylight" | "pearl_aggro_endermen";

export interface TacticRule {
  name: TacticName;
  when: Condition;      // parsed
  whenSrc: string;      // the original text, for logs and tests
}

export interface MobEntry {
  id: string;                                       // "minecraft:zombie", or "default"
  variants: string[];
  phase: 0 | 3 | 5;                                 // 0 only for the default entry
  hp: number;
  attack_damage: Record<Difficulty, number>;
  attack_range_blocks: number;
  move_speed: MoveSpeed;
  special: Special[];
  danger: number;                                   // 0..10
  engage_policy: EngagePolicy;
  preferred_range_blocks: { min: number; max: number };
  tactics: TacticRule[];                            // ranked best first
  counter_gear: CounterGear[];
  do: string[];
  dont: string[];
  flee_if: Condition[];                             // any-of
  notes: string;
  verify: string[];                                 // YAML keys that carried "(verify)"; "tactics" for tactic lines, "notes" for notes
}

/** Phase 5 stubs (MOBS §4): only these fields exist in the file. */
export interface MobStub {
  id: string;
  phase: 5;
  danger: number;
  engage_policy: "avoid" | "flee";
  notes: string;
}

export interface NeutralEntry { id: string; aggro_when: string; response: string; never?: string }

export interface MobKnowledge {
  entries: Record<string, MobEntry>;                 // Phase 3 entries by id
  variantIndex: Record<string, string>;              // variant id -> entry id
  stubs: Record<string, MobStub>;
  default: MobEntry;                                 // MOBS §6
  neverTarget: { always: string[]; onlyIfTamed: string[] };   // MOBS §2.1
  neutralUntilProvoked: NeutralEntry[];              // MOBS §2.2
  ignore: string[];                                  // MOBS §2.3
}
```

**Lookup order** (pure function `lookupMob(kb, typeId): MobEntry`, B2): `entries[typeId]` → `entries[variantIndex[typeId]]` → `stubToEntry(stubs[typeId])` → `kb.default`. `neverTarget`/`ignore` are checked by S1 before lookup.

**`stubToEntry(stub): MobEntry`** (fixed rule so the brain never special-cases stubs): `variants: []`, `hp: 20`, `attack_damage: {easy:3, normal:5, hard:7}`, `attack_range_blocks: 3`, `move_speed: "fast"`, `special: []`, `preferred_range_blocks: {min: 12, max: 32}`, `counter_gear: []`, `do: []`, `dont: []`, `verify: ["stub"]`, `phase: 5`. `tactics` for `avoid`: `[{avoid_path_around, "not_mob_aggroed_on_bot"}, {shield_hold, "mob_aggroed_on_bot AND bot_has_shield AND dist_below: 4"}, {sprint_away, "mob_aggroed_on_bot AND dist_at_least: 6"}]`, `flee_if: ["hp_below: 12", "count_at_least: 2"]`. For `flee`: `tactics: [{sprint_away, "always"}]`, `flee_if: ["always"]`.

`difficulty` for `attack_damage[...]` comes from `world.getDifficulty()` read by S1 (`Peaceful` → `"normal"`).

---

## 3. Tactic execution

### 3.1 Shared types (`src/game/bots/body/types.ts`, contract writer)

```ts
import type { Tick, Vec3 } from "../../../core/types.js";
import type { MobEntry, TacticName } from "../../../core/combat/types.js";
import type { CombatBody, WorldPort } from "../ports.js";
import type { BodyConfig } from "../../../core/config.js";   // config.body (contract writer defines BodyConfig, §7)

export type TacticStatus = "running" | "done" | "failed";

/** One mob, as a tactic sees it. Built by the combat-executor (B3) every pump from BodyReads.entity + Percept. */
export interface MobView {
  id: string;
  typeId: string;
  pos: Vec3;
  eye: Vec3;
  vel: Vec3;
  aabb: { center: Vec3; extent: Vec3 };
  distance: number;        // 3D, bot feet to mob feet
  reach: number;           // reachDistance(bot eye, mob aabb) (geometry.ts)
  hasLos: boolean;         // rayBlocked(world, bot eye, mob eye) === false (geometry.ts)
  aggroed: boolean;        // mob_aggroed_on_bot (S1)
  hissing: boolean;        // see below
  charged: boolean;
  diving: boolean;         // vel.y < -0.1 AND horizontal distance < 8 (phantom)
  isBaby: boolean;
  inWater: boolean;
  ranged: boolean;         // entry.special includes "ranged_projectile"
  flying: boolean;         // entry.special includes "flying"
}
// hissing = state.ignited === true
//        || (config.body.hissProxyEnabled && typeId === "minecraft:creeper" && distance < config.body.hissProxyDist)

/** Numbers a tactic needs that are not geometry. Built by B3 from the Percept each pump. */
export interface TacticSignals {
  hostileCount12: number;          // all threat-classified mobs within 12 blocks
  sameTypeCount12: number;         // of the target's typeId
  shieldDurabilityPct: number | undefined;   // 0..100; undefined = no shield
  shieldDisabled: boolean;         // bot_shield_disabled (S1; false when unknown)
  poisoned: boolean;
  slowed: boolean;
  darkness: boolean;               // Darkness effect active (warden alarm)
  canRegen: boolean;               // hunger >= 18 OR the bot holds an eligible food
  reengageHp: number;              // config.combat re-engage threshold (S2)
  fleeHp: number;                  // first `hp_below: N` in entry.flee_if, else config.body.fleeDefaultHp (8)
  hitDamage: number;               // entry.attack_damage[difficulty]
}

export interface NoGoZone { center: Vec3; radius: number; expiresAt: Tick; mobId: string }

export interface TacticContext {
  body: CombatBody;
  world: WorldPort;
  cfg: BodyConfig;                           // config.body
  entry: MobEntry;
  /** Primary target (the mob the tactic acts on). undefined for flee_sneak without a visible warden. */
  targetId: string | undefined;
  /** Where the dangerous thing was last known (warden/darkness); used by flee_sneak and avoid_path_around. */
  awayFrom: Vec3 | undefined;
  mob(id: string): MobView | undefined;      // fresh read this pump
  threats(): MobView[];                      // classification "threat" within 24 blocks, fresh this pump
  signals(): TacticSignals;
  /** Tick of the last entityHitEntity where `mobId` hit the bot (S1 events); undefined = none/unknown. */
  mobAttackedAt(mobId: string): Tick | undefined;
  home: Vec3 | undefined;
  owner: Vec3 | undefined;                   // nearest owner position, if online
  isNeverTarget(typeId: string): boolean;    // B2 lists
  publishNoGo(zone: NoGoZone): void;         // avoid_path_around only
  equip: { ensureWeaponSelected(): boolean };   // EquipmentManager facade
  /** S2's food chooser for retreat_and_regen (situation "pre_engage_heal"); undefined = nothing eligible. */
  chooseFood(): { slot: number; typeId: string; eatTicks: number } | undefined;
  log(msg: string): void;                    // "[colony] ..." line
}

export interface TacticRunner {
  readonly tactic: TacticName;
  /** Set when step() returns "done" or "failed" (and by a start() that returned false). Short snake_case code. */
  readonly reason: string | undefined;
  /** A tactic the decision loop should consider next (the MOBS text says "switch to X"). Advisory. */
  readonly handoff: TacticName | undefined;
  /** Number of attackTarget calls that returned "hit" (for outcome stats). */
  readonly hits: number;
  /** false = the Pre conditions fail; nothing was done and `reason` is set. Idempotent per instance: call once. */
  start(ctx: TacticContext): boolean;
  /** Called once per pump. Never throws. After "done"/"failed" it must not be stepped again. */
  step(now: Tick): TacticStatus;
  /** Idempotent. Always: stopMoving(), setSprinting(false), lowerShield(), setSneaking(false), stopEating(). */
  stop(): void;
}

export function createTactic(name: TacticName): TacticRunner;   // factory in body/tactics.ts
```

### 3.2 Constants, helpers and common prologue

Notation used in every table. `t` = the target `MobView` (re-read each pump with `ctx.mob(targetId)`), `S` = `body.self()`.
- `age` = `now − phaseStartedAt`. `total` = `now − startedAt`.
- `D` = `t.distance` (3D feet to feet). `R` = `t.reach` (eye to AABB).
- `inReach` = `R <= cfg.meleeReach − 0.05` (2.95).
- `ready` = `now − lastAttackAt >= cfg.attackIntervalTicks` (`lastAttackAt` starts at −1000).
- `canSprint` = `S.hunger >= cfg.sprintMinHunger (7)`.
- `tryAttack()` = `r = body.attackTarget(t.id)`; `"hit"` → `lastAttackAt = now`, `hits++`; returns `r`.
- `HANDOFF(x)` = set `handoff = x` before returning.
- `FAIL(code)` = set `reason = code`, return `"failed"`; `DONE(code)` = set `reason = code`, return `"done"`.

**Prologue P0** (every `step(now)`, before the phase table, in this order):
1. `S = body.self()`; undefined → `FAIL("self_unreadable")`.
2. If the tactic has a target: `t = ctx.mob(targetId)`; undefined, or the entity is invalid/dead → `body.stopMoving()`, `DONE("target_gone")`.
3. If `ctx.isNeverTarget(t.typeId)` → `FAIL("never_target")` (a bug upstream; log it).
4. The tactic's **Abort** list (rows below, evaluated top to bottom; `signals()` read once per pump).
5. `total > cfg.tacticTimeoutTicks (600)` unless the table gives its own cap → `FAIL("timeout")`.

**Start guard P1** (every `start(ctx)`): `body.stopBreaking()`; `body.stopEating()`; if `body.isEating()` still true → return false (`reason = "eating"`).

**Geometry** (`body/geometry.ts`, pure, takes a `WorldPort` where blocks are needed):

```ts
export function dist3(a: Vec3, b: Vec3): number;
export function distXZ(a: Vec3, b: Vec3): number;
export function unitXZ(from: Vec3, to: Vec3): { x: number; z: number };           // (0,0) if equal
export function rotateXZ(u: { x: number; z: number }, degrees: number): { x: number; z: number };
export function reachDistance(eye: Vec3, aabb: { center: Vec3; extent: Vec3 }): number;   // §1.2 step 5
/** Samples points every `step` blocks (default 0.4) strictly between a and b; true if any sampled cell is solid.
 *  An unloaded cell (blockAt undefined) counts as solid when `unknownSolid` (default true). */
export function rayBlocked(world: WorldPort, a: Vec3, b: Vec3, step?: number, unknownSolid?: boolean): boolean;
/** feet cell and head cell are neither solid nor liquid; the cell below is solid, not liquid, and not lava; (x,z) are block coords. */
export function standable(world: WorldPort, cell: Vec3): boolean;
/** true if any solid block exists within `depth` cells below `cell`. */
export function hasGround(world: WorldPort, cell: Vec3, depth: number): boolean;
/** true if any of the 16 cells at Chebyshev distance 1 and 2 around `pos` (same y) has no ground within `depth`
 *  (a drop). Used as the "do not fight next to a drop" rule. */
export function dropNear(world: WorldPort, pos: Vec3, radius: number, depth: number): boolean;
/** true if the cells from `from` along unit direction `dir` for `len` blocks (step 1) are each standable, allowing
 *  ±1 vertical step. Returns the number of consecutive good blocks (0..len). */
export function freeRun(world: WorldPort, from: Vec3, dir: { x: number; z: number }, len: number): number;
```
Cell = integer block coords (`Math.floor`). A "cell centre" = `x+0.5, y, z+0.5`. Every function that reads blocks counts calls against an optional `budget: { left: number }` argument; when `left` hits 0 it stops and returns its best partial result (scans below).

**Scans** (`body/scan.ts`, pure, each with its own budget `cfg.scanBlockBudget` blockAt calls; each returns `undefined` when nothing valid is found within the budget; all ring loops go ring `r = 1..radius` (Chebyshev around the bot's block), and inside a ring iterate `x` ascending then `z` ascending, so results are deterministic):

1. `findCover(world, shooterEye, bot, radius = cfg.coverSearchRadius (8), budget)` → `{ stand: Vec3; coverBlock: Vec3 } | undefined`. For every column `(x, z)` in the ring: cover candidate if blocks `(x, y0, z)` and `(x, y0+1, z)` are both solid (`y0` = bot's feet y). `u` = unitXZ(shooter → column centre). `stand` = cell of `(columnCentre + u)` at `y0`. Valid if `standable(stand)` AND `rayBlocked(shooterEye, stand + (0.5, 1.62, 0.5))` AND `rayBlocked(shooterEye, stand + (0.5, 0.3, 0.5))`. Finish the whole ring, pick the candidate with the smallest `dist3(bot, stand)`, tie smaller x then z. A ring with a valid candidate ends the search.
2. `findLowCeiling(world, bot, threatPos, radius = cfg.ceilingSearchRadius (8), budget)` → `{ stand: Vec3; openDir: {x,z}; depth: 2|3 } | undefined`. Two passes: pass A requires depth 3, pass B depth 2. A cell `P` (at `y0`) is valid if: `standable(P)`; the block at `(P.x, y0+2, P.z)` is solid (ceiling exactly 2 above the feet); at least one orthogonal neighbour has solid blocks at both `y0` and `y0+1` (back covered); and no "tall cell" within Chebyshev radius `depth − 1`, where a tall cell has the three cells `y0, y0+1, y0+2` all non-solid (the enderman needs about 3 blocks, MOBS §5). Pick by smallest `dist3(bot, P)`, tie smaller x then z. `openDir` = unitXZ(P → nearest tall cell within Chebyshev radius 4; if none, toward `threatPos`).
3. `findRoof(world, bot, radius = cfg.roofSearchRadius (10), budget)` → `Vec3 | undefined`. A cell `P` is roofed if `standable(P)` and some block at `(P.x, y0+k, P.z)`, `k = 2..6`, is solid. Valid if `P` and all 8 neighbours at the same y are roofed ("deep" roof). Nearest ring wins, then smallest `dist3`, then x, z.
4. `pickFleeDirection(world, bot, threats, minRun = 6)` → `{ waypoint: Vec3; freeLen: number } | undefined`. 12 bearings (every 30°, bearing 0 = +x). `away` = normalized `Σ (bot − threat.pos) / max(dist², 1)` over `threats` (if the sum is zero use `+x`). For each bearing `dir`: `freeLen = freeRun(world, bot, dir, 24)`; skip if `< minRun`. `score = freeLen/24 + 1.5 * dot(dir, away)`. Highest score wins, tie lowest bearing index. `waypoint = bot + dir * min(freeLen, 12)` (y = bot.y). `undefined` = boxed in.

Cost guard: a scan stops when `budget.left <= 0` and returns the best partial result found so far.

### 3.3 Per-tactic scripts

Conventions in the tables: every action listed in "Each pump" runs in the order written. "→" = next phase. Unless a row says otherwise, `lookAt(t.id)` is the first action of every pump (the adapter turns it into a feet-aim for endermen), and the exit/abort lists are evaluated before the actions (after P0).

#### 3.3.1 `melee_crit`

Gear/Pre (checked in `start`): a weapon is selected (`ctx.equip.ensureWeaponSelected()` true); `hostileCount12 <= 2`; ground flat: `|t.pos.y − S.pos.y| <= 1` and `!dropNear(world, S.pos, cfg.edgeCheckRadius (2), cfg.edgeDepth (3))` (a drop behind or beside the bot makes airborne knockback deadly: `FAIL("unsafe_ground")`); no block within 3 cells above the bot's feet that is solid (`cfg.critMinCeiling` 3). Otherwise `start` returns false.
Mode `PLAIN_ONLY`: if `t.flying` (phantom), or `!cfg.critEnabled`, or only the ceiling pre-check fails, the runner skips APPROACH/JUMP/AIR/LAND and uses phase PLAIN only.
Abort: `S.hp < signals.fleeHp`; any `ctx.threats()` entry with `ranged && hasLos && distance > 6`; `D >= 6`; `hostileCount12 >= 3`.
Own cap: none besides `cfg.tacticNoProgressTicks (120)` without any `hit` → `FAIL("no_progress")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| APPROACH | `start`, or from LAND when `D > 3.5` | `setSprinting(canSprint)`; `moveToward(t.pos, 1.0)` | `D <= 3.5` and `S.onGround` | JUMP |
| JUMP | `D <= 3.5`, on ground (age 0) | `setSprinting(false)`; `stopMoving()`; `jumped = body.jump()`; if true `jumpAt = now` | `jumped` true | AIR |
| JUMP (retry) | `jump()` false | next pump repeats; after 2 failed pumps | | PLAIN |
| AIR | after JUMP | **age < 8:** only `lookAt`. **age >= 8:** if `!S.onGround && S.vel.y < 0` (falling edge; expected at tick 8, since the apex is about tick 6): if `inReach` → `tryAttack()`; then → LAND whatever the result. If `S.onGround` at age 8: `tryAttack()` if `inReach && ready` (the jump did nothing) → LAND. If `S.vel.y >= 0` at age 8: wait one more pump. | attacked, or `age >= 16` | LAND |
| LAND | after AIR | `lookAt`. If `!S.onGround`: wait (if still airborne at age 24 → `FAIL("no_landing")`). On the ground: if `!t.ranged && D < 2.5`: `strafe(dir, 1.0)` for this pump, `dir` alternates every cycle (starts "left"), next pump `stopMoving()` | `S.onGround` | `D > 3.5` → APPROACH; else JUMP (cadence: `now − lastAttackAt >= 4`, which always holds because the attack was at the previous AIR pump) |
| PLAIN | `PLAIN_ONLY` mode, or jumps failed | `setSprinting(false)`; if `!inReach`: `moveToward(t.pos, 1.0)`; else `stopMoving()`; if `inReach && ready`: `tryAttack()`; for a flying target also require `t.pos.y <= S.eye.y + 1` | target gone / abort | stays |

Timing summary (normal cycle): tick 0 jump, tick 4 no action, tick 8 attack (crit window 7–11), tick 12 landed, tick 12 jump again, next attack at tick 20: spacing 12 ticks.

#### 3.3.2 `melee_strafe`

Pre: `D <= 6` (else `start` returns false, `reason="target_far"`); weapon selected.
Abort: `signals.hostileCount12 >= 3` and `ctx.entry` counts toward `count_at_least: 3` → `HANDOFF("shield_hold")`, `FAIL("three_attackers")`; `S.hp < fleeHp`; leash: `R > cfg.meleeReach` continuously for 40 ticks (`outOfReachSince`) → `FAIL("leash")`.
State: `dir` ("left" first), `dirUntil`, `cycle` (0), `lastBackstepAt`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| ENGAGE | `start` | `setSprinting(canSprint && D > 4.5)`; if `D > 3.0`: `moveToward(t.pos, 1.0)` else `stopMoving()` | `D <= 3.0` | CIRCLE (`setSprinting(false)`, `dir="left"`, `dirUntil = now + 12`) |
| CIRCLE | from ENGAGE/BACKSTEP | if `D < 2.0` → BACKSTEP (no other action). Else if `D > 3.4`: `moveToward(t.pos, 1.0)` (close the gap). Else `strafe(dir, 1.0)`. If `now >= dirUntil`: flip `dir`, `cycle++`, `dirUntil = now + (cycle % 2 === 0 ? 12 : 16)`. **Attack:** if `inReach && ready && (mobJustAttacked || D > entry.attack_range_blocks + 0.3)` then `tryAttack()`, where `mobJustAttacked = ctx.mobAttackedAt(t.id) !== undefined && now − that <= 8` | target gone / abort | stays |
| BACKSTEP | `D < 2.0` | pump 0: `setSprinting(false)`; `backOff(t.pos, 1.0)` (4 ticks, about 0.9 block). Pump 1 (age >= 4): `stopMoving()`; if `inReach && ready` `tryAttack()` | `age >= 4` | CIRCLE |

#### 3.3.3 `hit_and_back_off`

Pre: weapon selected; `!dropNear(world, S.pos, 2, 3)`.
Abort: `S.hp < fleeHp`; during BACKOFF the cell 1 block behind (opposite to `t`) has no ground within 3 or is solid → `FAIL("terrain_behind")`; no movement progress for 8 ticks while backing (`distXZ` change < 0.2) → `FAIL("stuck")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| APPROACH | `start` / WAIT hit | `setSprinting(canSprint)`; `moveToward(t.pos, 1.0)` | `inReach` | HIT |
| HIT | `inReach` | `setSprinting(canSprint)` (sprint-hit knockback); if `ready`: `r = tryAttack()`; | `r === "hit"` | BACKOFF (`backFrom = S.pos`) |
| HIT (retry) | `r` is `"cooldown"`/`"out_of_reach"`/`"no_los"` | repeat next pump; after 8 pumps without a hit | | `FAIL("no_hit")` |
| BACKOFF | after a hit | `setSprinting(false)`; `lookAt(t.id)`; `backOff(t.pos, 1.0)` | `dist3(S.pos, backFrom) >= 3.0` or `age >= 12` | WAIT (`stopMoving()`) |
| WAIT | after BACKOFF | `lookAt`; no movement | `D <= 3.5` | HIT (if `inReach`) else APPROACH; if `age >= 40` → `FAIL("mob_not_closing")` |

#### 3.3.4 `rush_kill`

Pre: `D <= 12`; `S.hp >= 12`; `signals.hostileCount12 === 1`; weapon selected.
Abort: `signals.poisoned && S.hp < 8`; `signals.slowed && S.hp < 12`; `signals.hostileCount12 >= 2`; `S.hp < 8`.
Cap: SPRINT phase `age > 60` without reaching `inReach` → `FAIL("no_contact")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| SPRINT | `start` | `setSprinting(canSprint)`; `moveToward(t.pos, 1.0)` (a straight line, no zigzag) | `inReach` | STRIKE |
| STRIKE | `inReach` | `setSprinting(false)`. If the target is on the same level (`|t.pos.y − S.pos.y| <= 1`) run the **melee_crit cycle** (JUMP / AIR / LAND rows of §3.3.1 sharing the same state machine; implement it once as `CritCycle` in `melee.ts`); else plain: `if (!inReach) moveToward(t.pos, 1.0) else stopMoving(); if (inReach && ready) tryAttack()`. If `R > 4` for 2 pumps (it ran away, e.g. drank speed): back to SPRINT without resetting its 60-tick cap | target gone | on `done`: if `signals.poisoned \|\| signals.slowed` → `HANDOFF("retreat_and_regen")`; `DONE("killed")` |

#### 3.3.5 `knockback_then_retreat` (creeper)

Pre (`start`): `!t.charged`; `signals.hostileCount12 === 1`; weapon selected; open retreat: `pickFleeDirection(world, S.pos, [t], 7)` returns a result (7+ free blocks) else `FAIL("no_retreat_space")`. (A 1-wide tunnel/closed room has no 7-block run away from the creeper; MOBS §3 creeper DON'T.)
Abort: `t.charged`; `S.hp < 12`; `signals.hostileCount12 >= 2`; retreat blocked (no distance gain for 8 ticks while RETREAT, creeper `D < 3`): if `body.canBlock() && t.hissing` → `HANDOFF("shield_hold")`; `FAIL("retreat_blocked")`; `cycles >= cfg.creeperMaxCycles (6)` → `FAIL("too_many_cycles")`.
State: `cycles`, `hissStartAt` (set the first pump `t.hissing` is true, cleared when false), `retreatDir`, `retreatPoint`.
Hard rule evaluated before the table every pump: if `t.hissing && D < 5` and phase is APPROACH/HIT → jump straight to RETREAT.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| APPROACH | `start` / cycle restart | `lookAt(t.id)`; `setSprinting(canSprint)`; `moveToward(t.pos, 1.0)` | `D <= 2.5` (tick 0 of the cycle) | HIT |
| HIT | `D <= 2.5` or `inReach` | `setSprinting(canSprint)` (must be sprinting for the knockback); `r = tryAttack()` | `r === "hit"` | RETREAT |
| HIT (retry) | `r !== "hit"` | next pump again (`"cooldown"`/`"out_of_reach"`); after 5 pumps → `FAIL("no_hit")` | | |
| RETREAT | after the hit (age 0) | At age 0 compute `retreatPoint = pickFleeDirection(world, S.pos, [t], 7).waypoint` (extended to `S.pos + dir*9`). `setSprinting(canSprint)`; `moveToward(retreatPoint, 1.0, true)` (faces the run direction; you cannot sprint backwards). Re-issue every pump. | `dist3(S.pos, t.pos) >= cfg.creeperRetreatDist (7)` (plan: about 25 ticks) or `age >= 40` | WAIT_FUSE (`stopMoving()`; `setSprinting(false)`; `cycles++`) |
| WAIT_FUSE | arrived | `lookAt(t.id)`; no movement. Explosion deadline `hissStartAt + 30`; if `t.hissing && D < 6` and `now < hissStartAt + 22` keep distance: `backOff(t.pos, 1.0)` one pump. | `!t.hissing && D <= 9` | APPROACH (new cycle) |
| WAIT_FUSE (far) | `D > 9` | wait; if `age >= 60` and the creeper is not coming → `DONE("creeper_left")` | | |

Timing of one cycle: tick 0 sprint-hit (knockback 2–3 blocks), ticks 0–25 sprint away to 7+ blocks, fuse (if started) explodes at ignition + 30 so the bot is 7+ blocks away by tick 25; typical kill is 3–4 cycles.

#### 3.3.6 `low_ceiling_fight` (enderman)

Pre (`start`): `t.aggroed`; weapon selected; `findLowCeiling(...)` returns a spot, else `FAIL("no_ceiling")`. Never `lookAt` the mob's head (adapter guard; this tactic additionally only looks at floor points, see MOVE/HOLD).
Abort: `signals.sameTypeCount12 >= 2` (second enderman); `S.hp < fleeHp`; `S.hp <= 2 * signals.hitDamage && D <= 3` → `FAIL("burst_risk")`; in HOLD, the mob is gone (`!ctx.mob`) for 100 ticks → `DONE("mob_gone")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| MOVE | `start` | `lookAt(floorAhead)` where `floorAhead = {x: S.pos.x + 1.0*dirToStand.x, y: S.pos.y, z: S.pos.z + 1.0*dirToStand.z}` (pitch down about 58°); `setSprinting(canSprint)`; `navigateToward(stand, 1.0)` (if it returns `undefined` or `pathLength === 0` after 2 tries: `moveToward(stand, 1.0, false)`) | `distXZ(S.pos, stand) <= 0.7` | HOLD |
| HOLD | at the stand cell | `setSprinting(false)`; `stopMoving()`; `lookAt({x: stand.x + 2*openDir.x, y: S.pos.y, z: stand.z + 2*openDir.z})` (the floor toward the opening, never the mob); `raiseShield()` if `canBlock()`. **Strike:** if `inReach && t.hasLos && ready && (mobAttackedAt within 12 ticks \|\| age since last strike >= 20)`: `lowerShield()`; `tryAttack()`; the next pump `raiseShield()` again | mob gone / abort | stays |
| HOLD (reach lost) | `R > 3.0` for 40 ticks | no action (it cannot enter); if `R > 3.0` for 120 ticks | | `DONE("no_contact")` |

#### 3.3.7 `shield_hold`

Pre (`start`): `body.canBlock()`; a weapon selected; `!dropNear(world, S.pos, 2, 3)` (else `FAIL("no_cover_back")`).
Abort: `signals.shieldDurabilityPct !== undefined && < 10`; `signals.shieldDisabled`; `S.hp < fleeHp`; `!signals.canRegen && S.hp < fleeHp + 4`. No threat within 16 for 40 ticks → `DONE("threat_gone")`.
Primary selection each pump (`pickShieldTarget`): among `ctx.threats()` with `distance <= 16` and `hasLos`: first a hissing creeper; else a `ranged` mob with `distance <= 15`; else the smallest `distance`; tie lowest `id`. If `targetId` is set and still valid and a hissing creeper or ranged mob is not present, keep `targetId`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| RAISE | `start` | `setSprinting(false)`; `stopMoving()`; `lookAt(primary.id)`; `raiseShield()` | `shieldState() === "up"` (about age 8 given the 5-tick delay and 4-tick pumps) | HOLD |
| HOLD | shield up | `lookAt(primary.id)`; `raiseShield()` (idempotent); `stopMoving()`. Strike trigger: `inReach(primary) && primary.hasLos && ready && (mobAttackedAt(primary) within 12 ticks \|\| now − lastStrikeAt >= cfg.shieldFallbackStrikeTicks (24))` | strike trigger | STRIKE |
| STRIKE | trigger | If `cfg.attackWhileShielded` is false (default): `lowerShield()`; `tryAttack(primary)`. If true: `tryAttack(primary)` only (shield stays up) | next pump | RAISE (re-raise within one pump = 4 ticks; with the 5-tick delay the exposure is about 9 ticks, matching MOBS "re-raise within 5 ticks") |

More than one attacker: the shield faces the strongest (`pickShieldTarget`), the weaker ones are accepted. Does not stop splash potions, sonic boom, magic, poison (MOBS §5 note).

#### 3.3.8 `shield_advance_zigzag` (skeleton family, pillager)

Pre: `body.canBlock()` with `signals.shieldDurabilityPct >= 20`; `t.hasLos`; `6 <= D <= 15`; `freeRun(world, S.pos, unitXZ(S.pos, t.pos), min(D,15)) >= D − 1` (clear ground toward it); weapon selected.
Abort: `shieldDurabilityPct < 10`; `S.hp < 8`; `ctx.threats().filter(m => m.ranged && m.hasLos).length > 2` → `HANDOFF("break_line_of_sight")`, `FAIL("too_many_shooters")`; a non-ranged threat with `distance < 8` whose bearing differs from the bot's facing by more than 90° → `FAIL("flank")`; `t.hasLos === false` for 60 ticks → `FAIL("lost_shooter")`; `total > 400` → `FAIL("timeout")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| RAISE | `start` | `setSprinting(false)`; `stopMoving()`; `lookAt(t.id)`; `raiseShield()` | `shieldState() === "up"` | ADVANCE (`nextSidestepAt = now + 20`, `sideDir="left"`) |
| ADVANCE | shield up, `D > 6` | `lookAt(t.id)`; `raiseShield()`; `moveToward(t.pos, 1.0, false)` (sneak speed applies; the bot keeps facing the shooter). When `now >= nextSidestepAt` → SIDESTEP | `D <= 6` | DASH |
| SIDESTEP | every 20 ticks | `lookAt`; `raiseShield()`; `strafe(sideDir, 1.0)` for `cfg.zigzagSidestepPumps (4)` pumps (16 ticks, about 1 block at sneak speed); then `stopMoving()`, flip `sideDir`, `nextSidestepAt = now + 20` | 4 pumps elapsed | ADVANCE |
| DASH | `D <= 6` | `lowerShield()` once; `setSprinting(canSprint)`; zigzag: `swingSign` flips every 8 ticks (2 pumps); `moveToward(t.pos + perp(S→t) * (2.0 * swingSign), 1.0)`; `lookAt(t.id)` | `D <= 3.5` | `HANDOFF("melee_strafe")`, `DONE("closed")` |

Rate estimate: 20 ticks of advance gains about 1.3 blocks at sneak speed (1.3 b/s), plus 16 ticks of sidestep; going from 15 to 6 blocks takes about 7 cycles (about 250 ticks). Accepted (MOBS design).

#### 3.3.9 `swoop_counter` (phantom)

Pre: `body.canBlock()`; `ctx.mob` within 16; the bot is outside (`!roofed(S.pos)`: a solid block within 6 above the head → `FAIL("under_roof")`); weapon selected.
Abort: `signals.hostileCount12 >= 3` or `S.hp < 10` → `HANDOFF("take_cover_overhead")`, `FAIL("too_many_or_hurt")`; `signals.shieldDurabilityPct < 10`; the phantom `D > 16` for 200 ticks → `DONE("left")`.
State per pump: `closing = (prevD − D) / 4` blocks per tick (first pump: undefined), `prevD`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| WATCH | `start` | `lowerShield()`; `stopMoving()`; `lookAt(t.id)` (rotate to face it). Dive detected: `t.diving`. `eta = closing > 0.02 ? D / closing : (t.diving && horizontalDistance <= 8 ? 14 : Infinity)` | `t.diving && eta <= 14` (about 10 ticks before contact plus a pump of slack) | GUARD |
| GUARD | dive imminent | `lookAt(t.id)`; `raiseShield()`; `stopMoving()` | after the pass: `D <= 2.5`, or `D` increased for 2 consecutive pumps after having been `<= 4` | COUNTER |
| COUNTER | pass over | `lowerShield()`; if `inReach && ready && t.pos.y <= S.eye.y + 1`: `tryAttack()` | same pump | WATCH |
| (GUARD timeout) | `age >= 60` | no contact: | | WATCH |

#### 3.3.10 `break_line_of_sight`

Pre: `findCover(...)` finds a spot (`has_cover_within_8`) else `FAIL("no_cover")`; target = the shooter (`ranged`).
Abort: `signals.hostileCount12 >= 2` with a second shooter having LOS to the bot (`ctx.threats().filter(m => m.ranged && m.id !== t.id && m.hasLos).length >= 1` while in WAIT) → `FAIL("flanked")`; `S.hp < 8` → `HANDOFF("retreat_and_regen")`, `FAIL("hp_low")`; the cover block is no longer solid (`world.blockAt(cover).isSolid` false) → re-run FIND once, second time `FAIL("cover_destroyed")`; `total > 400` → `FAIL("timeout")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| FIND | `start` / after a leg | `spot = findCover(world, t.eye, S.pos, 8, budget)`; none → `FAIL("no_cover")` | spot found | MOVE |
| MOVE | spot | `setSprinting(canSprint)`; `navigateToward(spot.stand, 1.0)` (fallback `moveToward(spot.stand, 1.0, false)`); `lookAt(spot.stand + 2 in direction of cover)` (floor point; do not stare at the shooter) | `distXZ(S.pos, spot.stand) <= 0.8` | WAIT |
| WAIT | at cover | `setSprinting(false)`; `stopMoving()`; if `!rayBlocked(world, t.eye, S.eye)` (the shooter sees the bot again) → FIND | `age >= 40` (`cfg.coverWaitTicks`) | ADVANCE |
| ADVANCE | after WAIT | `nearer = findCover(world, t.eye, S.pos, 8, budget)` restricted to spots with `dist3(spot.stand, t.pos) <= D − 2`; found → MOVE with `waitTicks = cfg.coverLeapWaitTicks (12)` instead of 40 (leapfrog). None → DASH | | MOVE or DASH |
| DASH | no closer cover | `setSprinting(canSprint)`; `moveToward(t.pos, 1.0)`; `lookAt(t.id)` (exposure about 14 ticks for the last 4 blocks) | `D <= 3.5` | `HANDOFF("melee_strafe")`, `DONE("closed")` |

#### 3.3.11 `retreat_and_regen`

Pre: any.
Abort: a new threat with `aggroed && distance < 8` that was not in the set at `start` → `FAIL("new_threat")` (the loop then picks flee/escape).
State: `threatsAtStart`, `lastReplanAt`, `eats` (count).

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| RUN | `start` | Every 20 ticks (and at age 0) pick the destination: `ctx.home` if defined and `dist3(S.pos, home) <= 64` and `dist3(home, nearestThreat) > dist3(S.pos, nearestThreat)`; else `ctx.owner` under the same test; else `pickFleeDirection(world, S.pos, ctx.threats(), 6).waypoint`; none → `FAIL("boxed_in")`. `setSprinting(canSprint)`. Home/owner: `navigateToward(dest, 1.0)` (fallback `moveToward`); waypoint: `moveToward(dest, 1.0)`. If sprinting stalls (displacement < 0.4 blocks over the last pump while on ground): `jump()` | `minD >= cfg.retreatSafeDist (16)` or `(minD >= cfg.retreatSafeDistNoLos (12) && no threat hasLos)` where `minD` = min distance to any threat | SETTLE |
| SETTLE | out of danger | `setSprinting(false)`; `stopMoving()` | same pump | REGEN |
| REGEN | settled | If `S.hunger < 18 \|\| S.hp < S.maxHp` and `eats < cfg.regenMaxEats (4)`: `food = ctx.chooseFood()`; if defined and no threat within `cfg.eatHardMinThreatDist` run an `EatRunner` (§4) as a sub-step (one at a time; `eats++` when it ends `done`). Else just wait (`stopMoving()`), keep `lookAt(nearest threat)` | `S.hp >= signals.reengageHp` and `minD >= 12`; or `age >= cfg.regenMaxTicks (1200)` | `DONE("recovered")` / `DONE("regen_timeout")` |

#### 3.3.12 `flee_sneak` (warden, vibration sensing)

Pre: none beyond P1. `awayFrom` = `t.pos` if a target exists, else `ctx.awayFrom`, else `ctx.home ?? ctx.owner`, else the bot's facing reversed.
Abort: the warden is aggroed on the bot and `D < 10` → `HANDOFF("sprint_away")`, `FAIL("warden_aggro")`. `total > 600` → `FAIL("timeout")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| FREEZE | `start` (tick 0) | `stopBreaking()`; `stopMoving()`; `setSprinting(false)`; `lowerShield()`; `stopEating()`; `setSneaking(true)` (if `!cfg.sneakEnabled`: skip sneaking, walk, and `HANDOFF("sprint_away")` on the first abort) | same pump | SNEAK |
| SNEAK | after FREEZE | `setSneaking(true)` (re-assert every pump); no jump, no sprint, no item use, no block break/place. Every 20 ticks plan a point 10 blocks away: for angles `0, ±30, ±60, ±90, ±120, ±150, 180` degrees from the direction `unitXZ(awayFrom → S.pos)` take the first whose first 6 cells along it are `standable` and none has a block with typeId containing `sculk` (`sculk_sensor`, `calibrated_sculk_sensor`, `sculk_shrieker`, `sculk`, `sculk_vein`, `sculk_catalyst`) at `y−1..y+1`. `navigateToward(point, 1.0)` (fallback `moveToward(point, 1.0, true)`) | `dist3(S.pos, awayFrom) >= cfg.sneakAwayDist (30)` and `!signals.darkness` | RESUME |
| RESUME | clear | `setSneaking(false)` | same pump | `DONE("clear")` |

#### 3.3.13 `avoid_path_around`

No-go radius (blocks) from `cfg.avoidRadius[typeId] ?? cfg.avoidRadiusDefault (6)`: enderman 16, creeper 8, warden 30, phantom 0, others 6. Radius 0 → `start` returns false (`reason="no_zone"`).
Abort: `t.aggroed` (the mob targets the bot) → `FAIL("mob_aggroed")` (the loop switches to the entry's other tactics); `total > 100` after the zone is blocked → `FAIL("path_blocked")` (S5/colony may then offer override).
This tactic does not drive a long walk; it clears the bot out of the zone and publishes the zone so executors re-plan.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| CLEAR | `start` and `D < radius` | `setSprinting(canSprint && D < radius * 0.5)`; point = `t.pos + unitXZ(t.pos → S.pos) * (radius + 2)`; if not `standable`, try rotating ±30°, ±60°, ±90° (first standable); `navigateToward(point, 1.0)`; do NOT `lookAt` the mob if it is `gaze_aggro` (enderman); else `lookAt` the point | `D >= radius + 1` | HOLD |
| HOLD | outside the zone | `setSprinting(false)`; `stopMoving()`. Every 20 ticks: `ctx.publishNoGo({ center: t.pos, radius, expiresAt: now + 40, mobId: t.id })` (B3 gives it to the executor's `resume()` re-plan). | `D > radius + 12` or the mob is gone | `DONE("clear")` |

#### 3.3.14 `sprint_away`

Pre: P1. `canSprint` may be false: the bot then runs at walk speed (still `moveToward(..., 1.0)`), logged once.
Abort (the "cannot outrun" rule): `t.entry.move_speed === "fast"` (the entry in `ctx.entry`) and `D < 3` → `FAIL("cannot_outrun")` (no handoff set; the loop picks the entry's other tactic or escape-rejoin). `total > 400` → `FAIL("timeout")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| TURN | `start` (tick 0) | `stopBreaking()`; `lowerShield()`; `setSneaking(false)`; `pick = pickFleeDirection(world, S.pos, ctx.threats(), 6)`; none → `FAIL("boxed_in")` | same pump | RUN |
| RUN | after TURN | `setSprinting(canSprint)`; every 20 ticks re-pick the direction (prefer one that puts a solid 2-high block between the bot and `t` within 40 ticks: add `+0.5` to the score of a bearing whose first 10 cells contain such a block next to the path); `moveToward(waypoint, 1.0, true)` (faces the run direction). If displacement over the last pump < 0.4 and `S.onGround` → `jump()` (at most once per 2 pumps) | `min distance to all threats >= cfg.sprintAwayDist (24)` | `setSprinting(false)`, `stopMoving()`, `DONE("clear")` |

#### 3.3.15 `take_cover_overhead`

Pre: `findRoof(...)` returns a spot else `FAIL("no_roof")`.
Abort: a non-flying threat within 4 blocks of the spot while in WAIT (`hostile in cover`) → `FAIL("hostile_in_cover")`. `total > 1500` → `FAIL("timeout")`.

| Phase | Entry | Each pump | Exit | Next |
|---|---|---|---|---|
| MOVE | `start` | `setSprinting(canSprint && any threat within 12)`; `navigateToward(roof, 1.0)` (fallback `moveToward`) | `distXZ(S.pos, roof) <= 0.8` | WAIT |
| WAIT | under the roof | `setSprinting(false)`; `stopMoving()`; `openDir = unitXZ(roof → nearest non-roofed cell within 4)`; `lookAt({x: roof.x + 2*openDir.x, y: S.pos.y, z: roof.z + 2*openDir.z})`; `raiseShield()` if `canBlock()`. `lastSightingAt = now` on every pump where some threat within 24 has LOS | `now − lastSightingAt >= cfg.takeCoverQuietTicks (200)` | `lowerShield()`, `DONE("quiet")` |

### 3.4 Tactic stats for outcome logs
`runner.hits` and `total` ticks are read by B3 when the runner ends. Damage taken is measured by S2/S1 from HP deltas; the body does not compute it.

---

## 4. Eating execution (`body/eating.ts`)

API-MAP §C7 approach: select the food slot, `useItemInSlot(slot)`, poll. There is no call that consumes a stack by slot other than this hold-use, so completion is detected, never assumed. `Player.eatItem` is the fallback only with player approval (`config.body.allowManualEat`, default `false`, not implemented in Phase 3: `TODO(phase-3-approval)`).

```ts
export interface EatContext {
  body: CombatBody;
  threats(): MobView[];
  log(msg: string): void;
}
export interface EatRequest {
  slot: number;            // inventory slot 0..35 holding the food
  typeId: string;          // expected item type (verified at start)
  eatTicks: number;        // TABLES: 32 normal, 16 dried_kelp, 40 honey_bottle
  mode: "normal" | "emergency";   // emergency = golden apples / chorus fruit (TABLES §3.1)
}
export type EatResult = "running" | "done" | "interrupted" | "failed";
export class EatRunner {
  readonly reason: string | undefined;
  start(ctx: EatContext, req: EatRequest): boolean;   // false = refused, reason set
  step(now: Tick): EatResult;
  stop(): void;                                       // idempotent: body.stopEating()
}
```

**Start guard** (all must hold; first failure sets `reason` and returns false):
1. The slot holds `req.typeId` (`body.startEating` returns `"no_item"` otherwise).
2. `body.eatStatus() === "idle"`.
3. No threat in `ctx.threats()` within `cfg.eatHardMinThreatDist` (4 blocks) in `normal` mode (`reason = "threat_near"`). In `emergency` mode the floor is 2 blocks unless `S.hp <= 4` (then no floor), matching TABLES §3.1 "not while a melee mob is already within 2 unless HP <= 4".
4. `S.hunger < 20` unless the typeId is always-edible (`golden_apple`, `enchanted_golden_apple`, `chorus_fruit`, `honey_bottle`); the engine refuses otherwise and `startEating` returns `"failed"`.
(The larger "eat_guard" distance of TABLES §3.1, `eat_ticks/20*5 + 2` blocks, is S2's decision input; the body only enforces the hard floor.)

**Script** (a pump = 4 ticks; 32-tick food = 8 pumps):

| When | Actions | Notes |
|---|---|---|
| `start` (tick 0) | `stopBreaking()`; `stopMoving()`; `setSprinting(false)`; `lowerShield()`; `r = body.startEating(slot)`; `"started"` → record `startedAt = now`, `hp0 = S.hp`; else `reason = r`, return false | `startEating` does the hotbar work (below) |
| each pump (age 4, 8, ...) | `st = body.eatStatus()`; `lookAt(nearest threat)` if any within 16 (keeps the bot oriented, no movement) | |
| `st === "done"` | `step` returns `"done"` | item consumed (verified) |
| `st === "interrupted"` | returns `"interrupted"` | |
| `st === "failed"` | returns `"failed"` (`reason = "timeout"` or the adapter's) | |
| guard breach (normal mode): a threat within `cfg.eatAbortDist` (3.5) with LOS, or `hp0 − S.hp >= cfg.eatAbortDamage` (4) | `body.stopEating()`; returns `"interrupted"`, `reason = "threat_near"` or `"damaged"` | emergency mode never aborts for threats or damage |
| `now − startedAt > req.eatTicks + cfg.eatTimeoutExtraTicks (10)` | `body.stopEating()`; returns `"failed"`, `reason = "timeout"` | |

**Adapter `startEating(slot)`** (in `adapter/body.ts`):
1. `item = inv.getItem(slot)`; undefined → `"no_item"`. `item.getComponent('minecraft:food')` undefined → `"not_food"`.
2. `setSprinting(false)`; `lowerShield()`.
3. If `slot >= 9`: `inv.swapItems(slot, cfg.foodSlot, inv)` (engine swap, conserving); `useSlot = cfg.foodSlot`; else `useSlot = slot`. Remember `swapped = {from: slot, to: foodSlot}` (not swapped back; the equipment manager normalises the hotbar later).
4. `prevSelected = p.selectedSlotIndex`; `p.selectedSlotIndex = useSlot`.
5. `before = { amount: inv.getItem(useSlot).amount, typeId, hunger: self.hunger, sat: self.saturation, tick: now }`.
6. `ok = p.useItemInSlot(useSlot)`. `false`/throw → undo steps 4 and 3 (select `prevSelected`; swap back), return `"failed"`.
7. State becomes `eating`, return `"started"`. Event bookkeeping is by `initBodyEvents()`: for this bot's id the adapter has `lastComplete?: {tick, typeId}` and `lastStop?: {tick, typeId}`.

**Adapter `eatStatus()`** (evaluated lazily at each call, cheap):
- `done` if any of: (a) `lastComplete.tick >= before.tick` (itemCompleteUse); (b) the stack in `useSlot` has fewer items than `before.amount`, or the slot is empty, or its typeId changed; (c) `self.hunger > before.hunger` (covers a missing event). Then: `p.stopUsingItem()` (ignore result), restore `prevSelected`, state → idle, return `"done"` once.
- `interrupted` if `lastStop.tick >= before.tick` and not done (itemStopUse without completion): restore slot, idle, return once.
- `failed` if `now − before.tick > eatTicks + 10` (the adapter knows `eatTicks` from `startEating`'s table lookup `config.body.eatTicksByType[typeId] ?? 32`); call `stopUsingItem()`, restore slot, idle, return once.
- else `eating`; `idle` if nothing started.
`stopEating()`: `stopUsingItem()`; restore `prevSelected`; state idle (reports nothing).

Interruption rules summary: switching the held slot, `stopUsingItem`, death. Damage does not cancel (MOBS/TABLES verify); the runner decides about damage. After a normal-mode abort the food is NOT consumed (partial eating loses nothing, TABLES §1 "can be interrupted by").

After `done`: the runner leaves the held slot restored (`prevSelected`); the controller calls `EquipmentManager.ensureWeaponSelected()` before the next fight tactic starts.

---

## 5. Equipment manager

### 5.1 Ranking tables (`body/equipment-logic.ts`, pure; all ids with `minecraft:`)

Armour protection points `[head, chest, legs, feet]`, toughness per piece, material rank (tie-break, higher wins):

| Material | head | chest | legs | feet | toughness/piece | material rank |
|---|---|---|---|---|---|---|
| leather | 1 | 3 | 2 | 1 | 0 | 1 |
| golden | 2 | 5 | 3 | 1 | 0 | 2 |
| copper (verify exists) | 2 | 4 | 3 | 1 | 0 | 3 |
| chainmail | 2 | 5 | 4 | 1 | 0 | 4 |
| iron | 2 | 6 | 5 | 2 | 0 | 5 |
| diamond | 3 | 8 | 6 | 3 | 2 | 6 |
| netherite | 3 | 8 | 6 | 3 | 3 | 7 |
| turtle (head only: `turtle_helmet`) | 2 | - | - | - | 0 | 3 |

Slot by typeId suffix: `_helmet` → head, `_chestplate` → chest, `_leggings` → legs, `_boots` → feet. `minecraft:elytra`, `minecraft:carved_pumpkin` and anything else are not armour here.

`armorScore(stack) = points + 0.5*toughness + enchantBonus`, with `enchantBonus = 1.0*protection + 0.5*blast_protection + 0.5*projectile_protection + 0.25*fire_protection + 0.25*feather_falling(boots only) + 0.25*unbreaking + 0.5*(mending ? 1 : 0)` (levels summed per id). Ids without the `minecraft:` prefix, from `ItemStackView.enchants`.

Weapon damage (Bedrock, consistent with MOBS §1.1; `kind` rank in brackets):

| Tier | sword [3] | axe [2] | pickaxe [1] | shovel [0.5] |
|---|---|---|---|---|
| wooden | 4 | 3 | 2 | 1 |
| golden | 4 | 3 | 2 | 1 |
| stone | 5 | 4 | 3 | 2 |
| copper (verify exists) | 5 | 4 | 3 | 2 |
| iron | 6 | 5 | 4 | 3 |
| diamond | 7 | 6 | 5 | 4 |
| netherite | 8 | 7 | 6 | 5 |

Spears (`*_spear`) and every other item: not weapons in Phase 3. `weaponScore = damage + (sharpness ? 0.5 + 0.5*level : 0)`; ties: higher `kind`, then more remaining durability points, then lower slot. Durability cost per hit: sword 1, others 2 (a tool used as a weapon loses 2).

Shield: `minecraft:shield`; score = remaining durability fraction + 0.25*unbreaking + 0.5*mending.

**Durability** of a stack: `remaining = durability.max − durability.damage` (points), `frac = remaining / max`; no durability component → `remaining = Infinity`, `frac = 1`.
- `low(stack)` = `remaining <= cfg.swapDurabilityPoints (5)` **or** `frac <= cfg.swapDurabilityFraction (0.10)`.
- `usable(stack)` = `!low(stack)`.
- Weapons and shields are **not used** (deselected/unequipped, kept in the inventory) at `remaining <= cfg.preserveRemainingPoints (2)`. Armour is worn until it breaks (protection matters more) but is replaced as soon as a usable replacement exists.

### 5.2 Planner

```ts
export interface EquipState {
  inventory: InventorySnapshot;          // 36 slots
  equipment: EquipmentView;
  chest?: InventorySnapshot;             // only when the bot is within container reach of the colony chest
  method: ShieldMethod;                  // cfg.shieldMethod
  cfg: BodyConfig;
  selectedSlot: number;
}
export type AskNeed = "weapon" | "shield" | "helmet" | "chestplate" | "leggings" | "boots" | "food";
export type EquipAction =
  | { kind: "equip"; fromSlot: number; to: EquipSlotName; why: string }
  | { kind: "hotbar_swap"; a: number; b: number; why: string }     // WorkerBody.swapSlots
  | { kind: "select"; slot: number }
  | { kind: "fetch"; chestSlot: number; typeId: string; why: string }
  | { kind: "ask"; need: AskNeed; low: boolean };
export interface EquipReport {
  weaponSlot: number | undefined;        // inventory slot of the chosen weapon (undefined = none usable)
  weaponTypeId: string | undefined;
  hasWeapon: boolean;
  hasShield: boolean;                    // a usable shield is placed for cfg.shieldMethod
  armorPoints: number;                   // sum of points of worn pieces
  low: AskNeed[];                        // worn/held items that are low() with no usable replacement
  missing: AskNeed[];                    // weapon only (shield/armour are never "missing": the bot may never have owned them)
}
export function planEquipment(s: EquipState): { actions: EquipAction[]; report: EquipReport };
```

Deterministic algorithm (for each step candidates come from `inventory`; chest candidates only produce `fetch` actions):
1. **Armour, per slot S in order chest, legs, head, feet:**
   - `cands` = inventory stacks valid for S (not binding-enchanted), plus chest stacks if `chest` given.
   - `bestUsable` = max `armorScore` among `usable(c)`; ties: higher material rank, higher `frac`, lower slot; inventory before chest.
   - `cur = equipment[S]`.
     - `cur` undefined and `bestUsable` exists → `equip`/`fetch`.
     - `cur` exists and `low(cur)` and `bestUsable` exists → replace (even if the score is lower: durability swap).
     - `cur` exists, `usable(cur)` and `bestUsable.score >= armorScore(cur) + cfg.upgradeMinGainArmor (1.0)` → upgrade.
     - `cur` low and no usable replacement → add `S` to `report.low`.
   - A `fetch` is only emitted for a chest stack; it replaces the equip for this plan (the next plan equips from inventory).
2. **Weapon:** `bestUsable` among inventory stacks with a weapon score and `usable` (ties per §5.1). Chest stacks only fetch **swords** (never axes/pickaxes: the gatherer needs those). If `bestUsable` is undefined: fall back to the best stack with `remaining > cfg.preserveRemainingPoints`; if that exists put it in `report.low`; if none, `hasWeapon = false` and `missing = ["weapon"]`. If the chosen weapon is already in the hotbar at slot `j`: `select j`; else `hotbar_swap(chosenSlot, cfg.weaponSlot)` then `select cfg.weaponSlot`. If the selected weapon is only `+< cfg.upgradeMinGainWeapon (1.0)` better than the current one and the current is usable, keep the current.
3. **Shield:** `bestShield` = highest shield score with `remaining > cfg.preserveRemainingPoints` and `usable` (if none usable, the best non-preserved one goes to `report.low`).
   - `method "sneak"`: target `offhand`. If offhand holds a different item: never displace `minecraft:totem_of_undying` (then `hasShield=false`); any other item is displaced by the swap (it lands in the shield's old slot). `equip`/`fetch` as for armour.
   - `method "use_item"`: if the shield is not at `cfg.shieldHotbarSlot` → `hotbar_swap(its slot, shieldHotbarSlot)` (displaces that slot's item into the shield's old slot). Offhand untouched.
   - Chest shields are fetchable.
4. Ask decisions (only emitted if the manager's rate limit allows, §5.4): `ask(weapon)` when `missing` has weapon, or the weapon is `low` with no usable replacement; `ask(<slot name>)` for each `report.low` armour/shield entry. Never for never-owned gear (`cfg.askForMissingGear`, default false).
5. Output order: `equip`/`hotbar_swap` for armour (chest, legs, head, feet), weapon swap/select, shield, then `fetch`es, then at most one `ask`.

Items in the colony chest that the plan wants but the bot cannot carry (no free inventory slot) are skipped with a log.

### 5.3 Manager (`body/equipment.ts`)

```ts
export class EquipmentManager {
  constructor(deps: {
    body: CombatBody; world: WorldPort; cfg: BodyConfig;
    colonyChest: () => ChestRef | undefined;        // from colony state (Phase 2 `!chest set`)
    onChanged: () => void;                          // marks the snapshot dirty (S4); called after every successful equip/unequip/swap
    botName: string;
  });
  /** Run the planner and execute at most cfg.equipActionsPerPump (1) mutating action. Call from BotController.tick. */
  tick(now: Tick, ctx: { threatsNear: number; fighting: boolean }): void;
  markDirty(reason: "spawn" | "rejoin" | "pickup" | "chest" | "fight_end" | "periodic"): void;
  /** Re-select the best weapon's hotbar slot (cheap, no scan, no chest). false = no usable weapon. */
  ensureWeaponSelected(): boolean;
  /** Call when the bot stands within container reach of a chest (after a deposit, on rejoin at home). */
  onNearChest(chest: ChestRef): void;
  report(): EquipReport | undefined;                // last plan's report, for S1 (sensor) and `!status`
  suspend(): void; resume(): void;                  // S4 flows pause the manager while a snapshot is taken
  ask(need: AskNeed, low: boolean, now: Tick): boolean;   // exact chat lines, rate limited (§5.4)
}
```

**When it runs** (`tick`):
- `markDirty("spawn")` right after the bot is spawned or restored (S4 calls `markDirty("rejoin")` after `RestoreToken` is consumed and the snapshot service says restored).
- `markDirty("pickup")` on `entityItemPickup` for this bot (B3 forwards); `markDirty("chest")` after any deposit/withdraw the bot did; `markDirty("fight_end")` when a combat tactic ends; `markDirty("periodic")` every `cfg.equipCheckTicks` (600) from `tick`.
- A dirty flag triggers one planner run on the next pump. The plan's actions are queued and executed one per pump (so a full re-kit of 6 actions takes 6 pumps = 24 ticks).
- While `suspend()`ed: no planning, no mutation.
- Mutations are allowed only when `ctx.threatsNear === 0` (no threat within `cfg.equipBusyThreatDist` 6 blocks), **except** these urgent actions, allowed any time except while eating: the weapon swap/select when the current weapon became `low`/missing, and the shield swap when the current shield became `low`.
- `ensureWeaponSelected()` is called by the combat executor before starting any melee tactic and after eating; it only does `selectSlot` (and a `hotbar_swap` if the chosen weapon is outside the hotbar).

**Execution of one action:** `equip` → `body.equipFromSlot(fromSlot, to)`; `hotbar_swap` → `body.swapSlots(a, b)`; `select` → `body.selectSlot(slot)`; `fetch` → `worker.withdrawSlot(chest, chestSlot, 1)` only if `nearContainer(S.pos, chest.pos)` (same limits as `withinContainerReach`: horizontal `DEFAULT_GATHER_CONFIG.containerReach` 2.5, `|dy| <= 2`, imported from `../executor.js`) and `inventory` has a free slot; `ask` → `ask(...)`. After every mutating success: `onChanged()`, and the next pump re-plans (dirty = true) so the result is verified against the real inventory.
A failed action (returns false) is not retried for `cfg.equipRetryTicks` (200) and is logged `[colony] equip <action> failed`.

**Durability swap rule (explicit):** the plan replaces a worn/selected item as soon as `low(item)` (`remaining <= 5` points OR `frac <= 0.10`) and a `usable` replacement exists in the inventory or (when adjacent) the colony chest. Because `periodic` runs every 600 ticks and `fight_end` after each fight, a weapon dropping below the threshold mid-fight is caught within one fight at most; the combat executor also calls `markDirty("fight_end")` every 400 ticks of continuous fighting.

**Fetch from the colony chest:** `onNearChest(chest)` reads `world.containerAt(chest.pos)` once (an `InventorySnapshot`), runs the planner with `chest` filled, and executes at most `cfg.chestFetchMaxPerVisit` (3) `fetch` actions, one per pump. It never takes axes/pickaxes/shovels or anything that is not a sword, armour piece or shield. It never walks to the chest (Phase 3 only fetches when already adjacent; walking there is a task executor concern).

### 5.4 Ask in chat

`ask(need, low, now)` sends (via `body.chat`, which prefixes `<Bot-N> `) one of these exact lines, `{item}` ∈ `weapon, shield, helmet, chestplate, leggings, boots`:

| Condition | Colony chest set | Text |
|---|---|---|
| need = weapon, not low (none owned) | yes | `I have no weapon. Please put a sword in the colony chest.` |
| need = weapon, not low | no | `I have no weapon. Please give me a sword.` |
| low item | yes | `My {item} is almost broken. Please put a spare in the colony chest.` |
| low item | no | `My {item} is almost broken. Please give me a spare.` |
| need = food (called by S2) | yes | `I am out of food. Please put some in the colony chest.` |
| need = food | no | `I am out of food. Please give me some.` |

Rate limit (ledger kept in a module-level `Map<botName, ...>` so it survives dismiss/rejoin within a session):
- Per bot and per `need`: at most one ask every `cfg.askCooldownTicks` (6000 = 5 minutes).
- Per bot, any need: at least `cfg.askGlobalGapTicks` (600 = 30 s) between two asks.
- Not while `ctx.fighting` or `threatsNear > 0`.
- At most one ask per planner run (the first by priority: weapon, shield, chestplate, leggings, helmet, boots).
`ask` returns `true` only if a line was sent.

---

## 6. Probes owned by B5 and the fallback per probe

B5 writes `src/probes/combat/*.ts` for the probes the body depends on. Each probe prints one summary line `[colony-probe] P<n> <result>` and returns the data below. The player/lead copies the result into `config.body`. Until a probe has run, the **default** column applies.

| Probe (API-MAP) | Body feature that depends on it | Config it decides | Default until probed | Fallback if the result is negative |
|---|---|---|---|---|
| **P1 shield block** (modes: sneak+offhand, hotbar+`useItemInSlot`, none) | `raiseShield`, `canBlock`, every shield tactic, equipment shield placement | `shieldMethod`, `shieldEnabled`, `shieldRaiseTicks` | `"sneak"`, enabled, 5 | Mode A fails and B works → `"use_item"`. Neither works → `shieldEnabled=false`: shield tactics are never chosen (S2 sees `bot_has_shield=false`), the bot relies on armour and `back_off`/`retreat` options. |
| **P2 eating via `useItemInSlot`** | `startEating`/`eatStatus`, `EatRunner`, retreat_and_regen | `eatEnabled`, `eatTicksByType`, whether `stopUsingItem` is needed after completion | enabled, TABLES ticks | Not consumed / never completes → `eatEnabled=false`: S2 treats `eat` as unavailable, bots recover only by natural regen (retreat_and_regen waits) until the player approves `allowManualEat` (`Player.eatItem` + manual decrement, API-MAP §C7). |
| **P3 `attackEntity` reach/cooldown/crit** | `attackTarget` interval and reach, `melee_crit`, `rush_kill` | `attackIntervalTicks`, `meleeReach` (reach cap stays regardless), `critEnabled` | 10, 3.0, true | No crit bonus → `critEnabled=false` (melee_crit/rush_kill use PLAIN). Engine cooldown longer than 10 → raise `attackIntervalTicks` to the measured value. If `attackEntity` is flaky: use `lookAtEntity(Instant)` + `p.attack()` inside `attackTarget` (still behind the same reach/LOS checks). |
| **P6 `isSneaking` writable** | `setSneaking`, shield method `"sneak"`, `flee_sneak` | `sneakEnabled` | true | Not writable → `sneakEnabled=false`: `shieldMethod` must be `"use_item"`; `flee_sneak` degrades to walking away at walk speed without jumping/sprinting and hands off to `sprint_away` when the warden aggros. |
| **P10 movement primitives** (`moveRelative` + `Continuous` look; `dropSelectedItem`) | `strafe`, `backOff`, `lookAt` tracking, `dropSlot` | `relativeMoveMethod`, `strafeLeftSign` | `"relative"`, +1 | `moveRelative` breaks the look or does not persist → `relativeMoveMethod="move_to"` (`moveToLocation` lateral/back points, 3 blocks away, re-issued each pump). `Continuous` look does not track → no change needed (runners re-issue `lookAt` each pump). `dropSelectedItem` drops 1 → S4 loops (already designed). |
| **P7 creeper ignition readable** | `MobView.hissing` for `knockback_then_retreat`, `shield_hold` | `hissProxyEnabled` | true (proxy: creeper within `hissProxyDist` 3) | `is_ignited` works → set `hissProxyEnabled=false` and use the component. |
| **P11 hunger/saturation on bots** | `setSprinting` gating (hunger >= 7), eat completion by hunger increase | none (if the component is missing the adapter returns `hunger=20`) | n/a | Components missing → sprint is never gated; completion relies on events + stack amount. |
| **P5 `playerInventoryItemChange` for bots** | not required by the body | n/a | n/a | The body never relies on it (equipment changes call `onChanged()` directly). |
| **P14 shield disabled by axe** | `signals.shieldDisabled` is read-only input from S1 | n/a (S1 owns the atom) | `false` | If unknown: `shield_hold` still aborts at `shieldDurabilityPct < 10`. |
| **Equip readback** (part of P1, light) | `equipFromSlot` ordered swap; confirm `setEquipment(Offhand, shield)` shows the shield and `inv.getItem(i)` shows `prev` | none | assumed OK | If `setEquipment` returns `false` for valid items: log; `canBlock()` false for `"sneak"`; armour is not auto-equipped (bots keep armour in the inventory; `report.armorPoints` reflects only worn pieces). |

---

## 7. Config keys (S3)

Merged by the contract writer into `config.body` (`BodyConfig`). All numeric ticks are game ticks.

| key | default | unit | meaning |
|---|---|---|---|
| `pumpTicks` | 4 | ticks | runtime pump; must equal the runtime constant |
| `meleeReach` | 3.0 | blocks | max eye-to-AABB distance for `attackTarget` |
| `attackIntervalTicks` | 10 | ticks | min ticks between two attacks (invulnerability window; set by P3) |
| `attackWhileShielded` | false | bool | strike without lowering the shield (test via P1/P3) |
| `critEnabled` | true | bool | melee_crit/rush_kill jump for crits (P3) |
| `critMinCeiling` | 3 | blocks | clear height needed above the feet to jump |
| `shieldMethod` | `"sneak"` | `"sneak"\|"use_item"` | how the shield is raised (P1) |
| `shieldEnabled` | true | bool | false disables every shield tactic |
| `sneakEnabled` | true | bool | false if `isSneaking` is not writable (P6) |
| `shieldRaiseTicks` | 5 | ticks | delay before a raised shield counts as up |
| `shieldHotbarSlot` | 8 | slot 0..8 | shield slot for `"use_item"` |
| `shieldFallbackStrikeTicks` | 24 | ticks | `shield_hold` strikes this often if no attack events are available |
| `weaponSlot` | 0 | slot 0..8 | hotbar slot the best weapon is swapped into when it is outside the hotbar |
| `foodSlot` | 7 | slot 0..8 | hotbar slot food is swapped into before eating |
| `dropScratchSlot` | 8 | slot 0..8 | hotbar slot used to drop from inventory slots >= 9 |
| `sprintMinHunger` | 7 | hunger points | sprint allowed at hunger >= this (TABLES) |
| `relativeMoveMethod` | `"relative"` | `"relative"\|"move_to"` | strafe/back-off implementation (P10) |
| `strafeLeftSign` | 1 | ±1 | sign of `moveRelative(leftRight)` that means left (P10) |
| `hissProxyEnabled` | true | bool | creeper hissing = within `hissProxyDist` until P7 passes |
| `hissProxyDist` | 3 | blocks | proxy distance |
| `eatEnabled` | true | bool | false disables eating (P2) |
| `allowManualEat` | false | bool | `Player.eatItem` fallback; needs player approval, not implemented in Phase 3 |
| `eatTicksByType` | `{ dried_kelp: 16, honey_bottle: 40 }` (others 32) | ticks | eat duration overrides (TABLES §1) |
| `eatTimeoutExtraTicks` | 10 | ticks | wait beyond `eatTicks` before giving up |
| `eatHardMinThreatDist` | 4 | blocks | never start eating with a threat closer (normal mode) |
| `eatAbortDist` | 3.5 | blocks | abort an eat when a threat with LOS gets this close (normal mode) |
| `eatAbortDamage` | 4 | HP | abort an eat after losing this much HP (normal mode) |
| `equipCheckTicks` | 600 | ticks | periodic equipment re-check |
| `equipActionsPerPump` | 1 | count | mutating equipment actions per pump |
| `equipBusyThreatDist` | 6 | blocks | no non-urgent equipment changes with a threat this close |
| `equipRetryTicks` | 200 | ticks | wait before retrying a failed equipment action |
| `swapDurabilityFraction` | 0.10 | fraction | swap an item when remaining/max <= this |
| `swapDurabilityPoints` | 5 | points | swap an item when remaining points <= this |
| `preserveRemainingPoints` | 2 | points | weapon/shield are not used at or below this |
| `upgradeMinGainArmor` | 1.0 | armour score | min score gain to swap a usable piece for a better one |
| `upgradeMinGainWeapon` | 1.0 | damage | min damage gain to switch weapons |
| `chestFetchMaxPerVisit` | 3 | count | max items taken from the colony chest per visit |
| `askCooldownTicks` | 6000 | ticks | per bot, per need, min gap between chat asks |
| `askGlobalGapTicks` | 600 | ticks | per bot, min gap between any two asks |
| `askForMissingGear` | false | bool | also ask when a never-owned shield/armour piece is missing |
| `scanBlockBudget` | 1500 | blockAt calls | per scan (cover, ceiling, roof, flee direction) |
| `coverSearchRadius` | 8 | blocks | `findCover` radius |
| `ceilingSearchRadius` | 8 | blocks | `findLowCeiling` radius |
| `roofSearchRadius` | 10 | blocks | `findRoof` radius |
| `edgeCheckRadius` | 2 | blocks | `dropNear` radius |
| `edgeDepth` | 3 | blocks | a drop is "no ground within this many blocks below" |
| `tacticTimeoutTicks` | 600 | ticks | default cap for a tactic |
| `tacticNoProgressTicks` | 120 | ticks | melee_crit: no hit for this long fails |
| `fleeDefaultHp` | 8 | HP | `signals.fleeHp` when the entry has no `hp_below` |
| `creeperRetreatDist` | 7 | blocks | knockback_then_retreat: required distance before the next cycle |
| `creeperMaxCycles` | 6 | count | give up after this many sprint-hit cycles |
| `zigzagSidestepPumps` | 4 | pumps | shield_advance_zigzag sidestep length |
| `coverWaitTicks` | 40 | ticks | break_line_of_sight wait behind the first cover |
| `coverLeapWaitTicks` | 12 | ticks | wait behind each later cover leg |
| `retreatSafeDist` | 16 | blocks | retreat_and_regen: done running at this distance |
| `retreatSafeDistNoLos` | 12 | blocks | ... or this distance with no LOS |
| `regenMaxEats` | 4 | count | foods eaten inside one retreat_and_regen |
| `regenMaxTicks` | 1200 | ticks | cap on the regen wait |
| `sprintAwayDist` | 24 | blocks | sprint_away stops this far from every threat |
| `sneakAwayDist` | 30 | blocks | flee_sneak: distance to resume |
| `takeCoverQuietTicks` | 200 | ticks | take_cover_overhead: ticks without sightings |
| `avoidRadius` | `{ "minecraft:enderman": 16, "minecraft:creeper": 8, "minecraft:warden": 30, "minecraft:phantom": 0 }` | blocks | avoid_path_around no-go radii |
| `avoidRadiusDefault` | 6 | blocks | radius for other mobs |

---

## 8. Open questions (with the fallback chosen so builders are not blocked)

| # | Question | Chosen fallback |
|---|---|---|
| OQ-1 | Does `attackEntity` apply the engine cooldown (return false) and crit when falling? (P3) | `attackIntervalTicks = 10`; map engine `false` to `"cooldown"`; `critEnabled` true until the probe says otherwise. |
| OQ-2 | Does `moveRelative` persist until `stopMoving` and keep a `Continuous` look? Sign of `leftRight`? (P10) | `relativeMoveMethod="relative"` default; runners re-issue every pump; `"move_to"` switch ready. |
| OQ-3 | Does sneaking raise an offhand shield for a SimulatedPlayer? (P1) | `"sneak"` default; `"use_item"` and `shieldEnabled=false` are config switches; `canBlock()` is what S1/S2 must use. |
| OQ-4 | Is `useItemInSlot` on an unselected slot valid, and does food auto-stop after completion? (P2) | The adapter always selects the slot first and always calls `stopUsingItem()` after completion; completion = event OR stack decrease OR hunger rise. |
| OQ-5 | Does `Player.eatItem` + manual decrement count as allowed? | No: needs player approval; not implemented (`allowManualEat=false`). |
| OQ-6 | `is_ignited` meaning for creepers (P7) | Proxy `distance < 3`. |
| OQ-7 | Does an enderman need no head-aim to avoid gaze aggro for a SimulatedPlayer? | Adapter always aims at its feet; tactics also only look at floor points. |
| OQ-8 | Carved pumpkin on head near endermen (MOBS enderman DO) | Not implemented in Phase 3 (`TODO(phase-5)`): gaze is avoided by never looking and by `avoid_path_around` radius 16. |
| OQ-9 | Sculk/Deep Dark exit path for `flee_sneak` (leave by the shortest route) | Phase 3 only moves away from `awayFrom` over sculk-free cells; leaving a Y < 0 region is not planned (`TODO(phase-5)`). |
| OQ-10 | MOBS grammar says "no other atoms" but uses `OR` | `or` supported in the union (§2.2). |
| OQ-11 | `copper_*` armour/tools and `*_spear` ids exist in 1.26? (TABLES verify) | Copper rows kept (unused if the id never appears); spears are ignored as weapons. |
| OQ-12 | Do Bedrock tools lose 2 durability per hit as weapons? | Assumed (sword 1, other tools 2); affects only the swap prediction, the 5-point/10% rule still protects. |
| OQ-13 | Is `Mainhand` switching by `selectedSlotIndex` instant? | Assumed instant; `attackTarget` is only called after `ensureWeaponSelected()` in the same or an earlier pump. |

---

## 9. Test cases for B5 (`test/body-*.test.ts`, TC-B5)

All against fakes (`FakeCombatBody` recording calls, `FakeWorld` implementing `WorldPort`); no engine.
- `body-geometry`: `reachDistance` (inside box = 0; 3 blocks away; each axis), `rayBlocked` (wall, open, unloaded=blocked), `standable` (lava below, liquid feet), `dropNear`, `freeRun` (steps ±1).
- `body-scan`: `findCover` picks the nearest valid ring and honours the budget; `findLowCeiling` pass A vs B and `openDir`; `findRoof` needs the 8-neighbour roof; `pickFleeDirection` boxed-in returns undefined.
- `body-melee`: scripted ticks for `melee_crit`: jump at 0, no attack at 4, attack at 8 only if `vel.y < 0 && !onGround`, LAND strafe alternation, 12-tick spacing; PLAIN fallback when `jump()` returns false twice; `hit_and_back_off` terrain abort; `melee_strafe` BACKSTEP; `rush_kill` abort on poison; `knockback_then_retreat` hit → RETREAT at tick 0, WAIT_FUSE, `hissing` hard rule, cycle cap.
- `body-shield`: `shield_hold` RAISE → HOLD → STRIKE → RAISE with `attackWhileShielded` false/true; abort at `shieldDurabilityPct 9`; `swoop_counter` GUARD timing from `eta`; `low_ceiling_fight` never calls `lookAt` with an entity id; `shield_advance_zigzag` sidestep cadence (20 ticks, 4 pumps).
- `body-tactics`: `break_line_of_sight` leapfrog; `retreat_and_regen` destination choice and `done` at 16 blocks; `flee_sneak` re-asserts sneaking each pump and skips sculk cells; `avoid_path_around` publishes the zone every 20 ticks, radius 0 start refusal; `sprint_away` `cannot_outrun`; `take_cover_overhead` quiet timer.
- `body-eating`: start refusals (threat 3.9 in normal, 2.1 in emergency, hp 4 override), completion by event / stack decrease / hunger rise, timeout at `eatTicks + 10`, normal abort at 3.4 blocks, emergency never aborts, slot restore.
- `body-equipment`: tables (armor and weapon scores, sword over axe at equal tier), durability swap at exactly 5 points and exactly 10 %, no swap at 6 points / 11 %, weapon deselected at 2 points, shield placement for both methods, totem never displaced, binding items skipped, chest only fetches swords/armour/shield, ask strings exact, cooldowns (6000 / 600), no ask while fighting.
- `adapter` test (extend `test/adapter.test.ts` style with `vi.mock`): `attackTarget` return codes for each step 1–9, `equipFromSlot` rollback when `setEquipment` returns false (no duplicate, no loss), same-tick double equip refused, `unequip` rollback.

---

## 10. Requests to other sections / the contract writer

- **CR-1:** add `enchants?: ReadonlyArray<EnchantView>` to `ItemStackView` in `ports.ts`; `stackView` in `adapter/world.ts` fills it from `getComponent('minecraft:enchantable')?.getEnchantments()` (ids without the `minecraft:` prefix), inside the existing `try`.
- **CR-2:** `BodyConfig` interface = the keys of §7 with the listed types; merged into `config.body`.
- **CR-3 (S1/S2):** `bot_has_shield` and `canBlock` must come from `CombatBody.canBlock()` and `EquipmentManager.report()`, with the 10 % durability rule from `signals.shieldDurabilityPct`. `bot_shield_disabled` comes from S1 (P14) as `signals.shieldDisabled`.
- **CR-4 (S1/B3):** B3 builds `MobView`, `TacticSignals`, `TacticContext`, calls `initBodyEvents()` once at worldLoad, `wrapCombatBody` once per bot, forwards `entityItemPickup`/chest events to `EquipmentManager.markDirty`, and calls `EquipmentManager.tick` every pump. `ctx.mobAttackedAt` is fed from `world.afterEvents.entityHitEntity` (damagingEntity = mob, hitEntity = bot).
- **CR-5 (S4):** call `EquipmentManager.suspend()` before taking a snapshot / disconnecting and `markDirty("rejoin")` after restore. `dropSlot` semantics (one call per invocation) are in §1.3. The equipment slots S4 serialises are `head, chest, legs, feet, offhand` only (never Mainhand), taken via `BodyReads.equipment()` plus the raw `ItemStack` copies S4 reads itself.
- **CR-6 (S2):** a `retreat_and_regen` tactic eats internally with `ctx.chooseFood()`; S2 may also choose the `eat` option separately. When the loop picks `eat`, it starts an `EatRunner` with the S2 food choice and `mode` = `emergency` for golden apples/chorus fruit, else `normal`.
- **CR-7 (S5):** `!status` can show `EquipmentManager.report()` (`armorPoints`, `hasWeapon`, `hasShield`, `low`).
