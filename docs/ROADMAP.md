# Bot Colony roadmap (agreed 2026-10-07)

Runs entirely in-pack (no API, no dedicated server). Solo or friends world, Beta APIs on, cheats off.
Each phase: 1 architect, 3–5 builders, 5–10 reviewers → `npm run check` passes → commit → `.mcpack` + source zip to the player → summary in the Claude project.

## Status
- **Phase 1: Walking skeleton.** Done: spawn, `!` chat commands, goto, override/queue.
- **Phase 2: Gatherers.** Built (`!chest set`, `!gather`, tools, wooden-pickaxe crafting, deposit). It gets reviewed inside Phase 3.

## Core principles
- **Every bot is a combat bot first.** Each tick a priority stack runs: survival reflexes → combat → task → idle. A fight **pauses** the current task, and the task resumes after it.
- **Bots attack mobs only, never players.** Villagers, golems and tamed pets are never targets either.
- **Objective relevance decides aggression:**
  - A mob attacking or targeting the bot gets handled.
  - A mob blocking the objective (the target block, the path, the chest) gets cleared aggressively.
  - Anything else is ignored or avoided, never chased (leash distance).
- **Fair information:** bots only know blocks a player could see. No x-ray for prospecting.
- **Items are conserved:** nothing is created or duplicated.
  - Approved exception: **bot snapshot**. The bot's inventory and equipment are serialized, cleared, then restored exactly once when it respawns.
  - Snapshots are saved on every inventory change and on a timer, never only at shutdown, because `system.beforeEvents.shutdown` is restricted and can't save.
- **Timers and thresholds** live in one config, biased toward the bot's survival. Tune freely.
- **Owner** = the player who spawned the bot.

## Return and escape rules
| Event | Where the bot goes |
|---|---|
| Escape (low HP and valuable cargo) | Home if set, otherwise the owner's feet. Snapshot → disconnect → spawn same name at destination → restore. **No cooldown.** Recover (eat, regen) before resuming |
| Haul (task done or escape) | Home set → put in home chests (the sorter files it). No home → rejoin at the owner and drop the items at their feet |
| `!summon` | The summoning player's feet |
| Idle timeout or parked far from every player | Deposit to the home or colony chest if reachable, else snapshot; then dismiss |
| Save & Quit | Bots rejoin after reload with their inventories |
| Owner offline and no home | Stays dismissed until the owner returns or someone `!summon`s it |

**Cargo value for the escape decision:**
- Highest: progress toward the objective. Holding ≥ the amount asked for is top priority to preserve.
- Then rare items and gear. Common blocks are worth very little.
- The cost of dying includes the gear it would lose.

## Phases
### 3. Combat I (every bot inherits it)
- **Priority stack:** tasks pause and resume around fights.
- **Scored decision loop:**
  - Options: attack, shield, back off, retreat, eat, flee, escape-rejoin, resume task.
  - Hysteresis and a minimum commit time keep it from dithering.
  - Not a script: retreat → eat → fight should emerge from the scores.
- **Per-mob knowledge base** (`src/core/combat/mobs.ts`): danger, engage-or-avoid, preferred range, ranked tactics, counter-gear, explicit DO and DON'T rules.
  - Phase 3 covers zombies (all variants), spiders, the skeleton family plus pillager, creeper, witch, enderman, slimes, silverfish/endermite and phantom.
  - **Warden: always flee.** Stop making noise, sneak away.
- **Outcome stats:** each fight logs mob × tactic → damage taken, time, result. The bot mostly picks the best allowed tactic and sometimes explores another. The logs also feed Phase 8.
- **Food:** a table of hunger, saturation and effects, chosen by situation.
  - Top up with small foods.
  - Before re-engaging, eat the highest-saturation food.
  - Golden apple only in an emergency; chorus fruit to escape.
  - Rotten flesh, spider eye, raw chicken and pufferfish only when starving.
- **Equipment:** auto-equip the best armour, offhand shield and weapon (from inventory or chest). Read real durability, swap before something breaks, and fetch a replacement or ask in chat.
- **Snapshot system:** dismiss, rejoin, escape, idle self-dismiss, and bots surviving Save & Quit.
- **Commands:** `!defend [radius]` (protects players and bots), `!home set`, `!summon [bot]`, `!dismiss [bot]`, `!recall`, and a richer `!status` (HP, gear, threat).
- **In-game probes:**
  - shield block (sneak + offhand shield)
  - eating via `useItemInSlot`
  - `attackEntity` reach and cooldown
  - whether items drop on disconnect (duplication risk)
  - whether `playerInventoryItemChange` fires for bots
- **Review of the Phase 2 gather code.**

### 4. Home logistics
- **`!sort` task:** the bot moves items from the deposit chest into category chests. A deposit wakes the sorter (it rejoins at home if dismissed).
- **Chest labels:** a sign on or above the chest, e.g. `[ores]`.
- **Default categories:**
  - ores and ingots (coal, iron, copper, gold, diamond, emerald, lapis, redstone, raw ores)
  - wood
  - stone (incl. dirt, sand, gravel)
  - animal drops
  - mob drops
  - food
  - tools and gear
  - junk
  - overflow
- **Overrides:**
  - In game: `!sort set <item> <category>`, saved in world storage. These win.
  - In a file: a plain JS config shipped un-bundled in the pack (`scripts/config/sorting.js`). Edit it in the installed pack folder and reload the world.
- **Full category chest:** put the item in the overflow chest and send a chat message.

### 5. Combat II
- Bows and crossbows (draw and release).
- The remaining mobs: blaze, ghast (deflect fireballs), piglin/brute, hoglin/zoglin, the raid mobs (vindicator, evoker, vex, ravager), guardians, breeze, creaking, shulker. Wither and Ender Dragon are flee-only.
- Bots help each other, and defenders answer distress calls.

### 6. Harvesters v2
- `!mine diamond,coal,iron,copper [amounts]`.
- Fair exploration: caves and ravines, then strip-mining at each ore's best Y.
- Tool tiers are planned automatically (stone → iron → diamond), with smelting.
- Durability-driven crafting of replacement tools.

### 7. Scale and outposts

### 8. Learned combat
A Node fight simulator, calibrated against the Phase 3 outcome logs. Train a small policy there and ship it as plain JS weights that replace weak parts of the rules.

### 9. Persistence (remainder)
Resume queued tasks across reloads. Bots and inventories already persist from Phase 3.

## Out of scope for now
Builders, shulker boxes and bags, ender-chest emulation, PvP.
