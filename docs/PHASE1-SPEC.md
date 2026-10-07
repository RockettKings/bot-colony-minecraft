# Phase 1 spec: walking skeleton

The contract every Phase 1 job builds against. If code and this doc disagree, fix one of them; don't leave both.

## Goal

A player types a `!` command in chat. It is parsed, turned into a task, and executed by a bot (a simulated player), and the bot replies in chat. This works on a normal client-hosted world with **Beta APIs on and cheats off**. The same `!` text also works through a fallback slash command.

## Definition of done

1. `npm run check` passes: typecheck, unit tests, and bundle.
2. On a cheats-off world: `!spawn` → a bot appears; `!come` → it walks to you and says it arrived; `!status` → correct state; `!stop` → it stops.
3. Collision: with every bot busy, a second player's `!come` gets a "busy" reply naming the bot and owner. `!override` takes the bot and notifies the previous owner, whose task is requeued. `!queue` waits instead. Unanswered offers expire after 30 s.
4. GameTests for goto and the override flow exist and run on a dev world with `/gametest runset colony` (or `/gametest run colony:<name>`).
5. The spike probes run in-game and answer the open questions below. Results are recorded in `docs/SPIKE-CHECKLIST.md`.

Out of scope: chest and inventory work (Phase 3), the Claude bridge (Phase 2), persistence across world reload (Phase 5), combat and `!defend` (Phase 6).

**Scope note:** the original roadmap put chest/inventory work in Phase 1. It moved to Phase 3 so that Phase 1 first proves the integration risks (simulated players on a cheats-off world, chat interception, navigation coordinates, chunk loading, reload survival) before building on them.

## Layering and ownership

```
src/core/           pure TS, NO @minecraft imports (enforced by a test)
  types.ts          shared contracts (lead)
  commands/         parser + help text             (Job 1)
  colony/           task model, allocator, offers  (Job 2)
  index.ts          glue: chat text -> effects     (lead)
src/game/           everything touching the game   (Job 3)
  adapter/          the only place in src/game importing @minecraft/server-gametest
  frontends/        chatSend + /colony:c slash command
  bots/             goto executor
  runtime.ts        wiring: events in, effects out
src/probes/         spike probes                   (Job 4)
src/gametests/      GameTests                      (Job 4)
src/main.ts         entry (lead)
```

Only `src/game/adapter/`, `src/probes/` and `src/gametests/` may import `@minecraft/server-gametest` (enforced by `test/boundaries.test.ts`).

Pattern: **functional core, imperative shell.** `Colony.handle(event) → Effect[]` is deterministic. Time comes in on events as ticks. The game layer turns game happenings into `ColonyEvent`s and executes `Effect`s. All types live in `src/core/types.ts`.

## Command grammar (Job 1)

The prefix is `!`. `isCommand(text)` is true when the trimmed text starts with the prefix **followed by an ASCII letter**, so `!!!` and `! hi` are ordinary chat. Command names are case-insensitive. A bot name may be written `Bot-1` or `@Bot-1`.

| Command | Args | Notes |
|---|---|---|
| `!help [command]` | | Handled by glue using `helpText()` |
| `!status [bot]` | | |
| `!spawn [name]` | name `^[A-Za-z0-9_-]{1,16}$` | |
| `!goto <x> <y> <z> [count]` | coord = number or `~` or `~n`; `^` is rejected; absolute y −64..320, \|~y\| ≤ 384, \|x\|,\|z\| ≤ 3e7 | count is an int 1–16, default 1 |
| `!come [count]` | | Target = sender position |
| `!stop [bot]` | | |
| `!override` / `!queue` | none | Answers to a pending offer |

Errors: an unknown command gives `Unknown command '!xyz'. Type !help.` Bad, missing or extra args give an error line plus `Usage: <usage line>`. `!help <unknown>` gives the same `Unknown command` line. Echoed player text is clipped to 20 characters with `§` removed. A goto whose resolved Y falls outside −64..320 is rejected by the colony (`Target Y … is outside the world`).

Exports from `src/core/commands/index.ts`:
`isCommand(text, prefix = "!")`, `parseCommand(text, prefix = "!"): ParseResult | null` (null when not a command), `helpText(topic?, prefix = "!"): string[]`, `COMMAND_SPECS`.

## Colony semantics (Job 2)

`export class Colony { readonly config: ColonyConfig; constructor(config?: Partial<ColonyConfig>); handle(e: ColonyEvent): Effect[]; snapshot(): ColonySnapshot }` in `src/core/colony/index.ts`. Task ids are `t1`, `t2`, … from a counter.

Defaults (`DEFAULT_CONFIG`): prefix `!`, `maxBots` 3, `offerTtlTicks` 600 (30 s), `commandCooldownTicks` 20 (1 s), bot names `Bot-N`.

- **Cooldown:** a command within `commandCooldownTicks` of the same player's last accepted command gets "Slow down…" and nothing else. `!override` and `!queue` are exempt; `!help` and parse errors never reach the colony.
- **status:** one line per bot (idle, or "going to x y z for Name"), plus the queued count ("No bots yet." first if there are none). With a bot name, only that bot's line. An unknown bot name gives an error.
- **spawn:** refused if `bots + pendingSpawns ≥ maxBots`, or if the name is taken. The default name is the lowest unused `Bot-N`. Emits `spawn` and replies "Spawning…". On `botRegistered`, broadcast "joined" and drain the queue. On `spawnFailed`, reply to the requester.
- **goto / come (count n):**
  - Resolve `~` against `sender.pos`. A new request replaces the sender's pending offer. With no bots, reply "No bots yet."; if n is greater than the number of registered bots, return an error.
  - If there are at least n idle bots, assign one `GotoTask` per bot. Each bot acknowledges to the sender.
  - Otherwise, pick the busy bots that would be taken, preferring the sender's own tasks first, then the oldest others. If all of them run the sender's own tasks, preempt immediately with no offer.
  - Otherwise, create a **pending offer** for the sender (one per player; a new one replaces the old) and reply with free/busy counts, each busy bot's task and owner, and the hint "Reply !override to take over or !queue to wait (expires in 30s)."
- **override:** requires a live offer, else "Nothing to override."
  - For a goto offer: re-plan against the current bots, then assign the idle ones. For each busy bot taken, emit `cancel(preempted)`; if the old task belongs to someone else, put it at the **front** of the queue (keeping order) and notify its issuer that the bot was reassigned by X and their task is queued (the sender's own old tasks are dropped). Then `assign` the new task.
  - For a stop offer: if the bot is still on that task, `cancel(stopped)` and notify the issuer; otherwise reply that the bot is no longer on that task. The task is not requeued.
- **queue:** requires a live goto offer, else reply. Assign the idle bots now and enqueue the remaining tasks at the back. Reply with the queue position.
- **stop:**
  - No bot named: drop the sender's pending offer, cancel all of their active tasks and drop their queued tasks, then reply with the counts (or "You have no active or queued tasks.").
  - Bot named and idle: say so.
  - Bot named and running the sender's own task: cancel it.
  - Bot named and running someone else's task: create a stop offer (reply with the bot's task and owner; needs `!override`).
- **When a bot becomes idle** (task done, failed, stopped, or on registration), assign the queue head. The bot tells the issuer it is picking up the queued task.
- **taskReport:** done gives a bot reply "arrived at x y z". Failed gives a bot reply with the reason; failed tasks are not retried in Phase 1. A report for a task that isn't the bot's current one is ignored.
- **botRegistered** for a bot id that is already known (e.g. a respawn) keeps its task and doesn't broadcast.
- **botRemoved:** requeue its task at the front, notify the issuer, and broadcast that the bot left (with the reason).
- **tick:** expire offers older than `offerTtlTicks` and tell their owners. Drain the queue if any bots are idle.
- **Reply routing:** acknowledgements go to the sender. Notices that affect someone else go to that player. Joins and leaves go to `"all"`. Bot-spoken lines set `from`.

## Glue (lead): `src/core/index.ts`

`createColony(config?)`, `handleChat(colony, text, sender, now): { handled: boolean; effects: Effect[] }`. It returns `handled: false` for non-commands, renders parse errors and `!help` itself, and forwards everything else as a `command` event.

## Game layer (Job 3)

`src/game/runtime.ts` exports:

```ts
export interface ColonyRuntime {
  submitText(sender: Sender, text: string): void;    // same path as chat; replies to unknown ids are dropped
  adoptBot(player: SimulatedPlayer, name: string): BotId; // used by GameTests
  botIds(): BotId[];
  snapshot(): ColonySnapshot;                         // read model (copy) of the core; used by GameTests
}
export function startColonyRuntime(): ColonyRuntime;   // idempotent
export function getRuntime(): ColonyRuntime | undefined;
```

- **Front-ends:**
  - `world.beforeEvents.chatSend`: if `isCommand`, cancel the message and defer it with `system.run` (before-events are read-only).
  - Fallback slash command `/colony:c <text>`: permission `Any`, no cheats required, registered in `system.beforeEvents.startup`. It takes up to 5 string tokens (enough for `goto x y z count`), joins them, and adds the prefix if missing.
  - If `chatSend` is unavailable, log a warning and keep running.
- **Spawning:** use the top-level `spawnSimulatedPlayer({dimension, x, y, z}, name, GameMode.Survival)` (no GameTest needed). Wrap it in the adapter.
- **Goto executor:**
  - Navigate to the target and poll the distance; arrival is ≤ 1.5 blocks.
  - Re-path if there's been no progress (≥ 0.5 blocks closer) for about 5 s. Time out after `200 + 20 × distance` ticks. A navigation result with no path means `unreachable`, as does a partial path that stalls again after a re-path. A navigation call that throws (e.g. while airborne) is retried on a later pump.
  - Cancel stops movement.
- **Bot death:** report the task as failed with `bot_died`, then respawn the bot (up to 5 attempts, 1 s apart; then disconnect it and emit `botRemoved` with "couldn't respawn"). If a bot entity becomes invalid, emit `botRemoved` with "gone".
- **Effect rendering:** bot lines appear as `<Bot-1> text`, colony lines as `§7[Colony]§r text`. `to: "all"` uses `world.sendMessage`; otherwise send to that player, and drop the message if they're offline.
- **Pump:** `system.runInterval` every 4 ticks. It updates the executors and sends `tick` to the colony.

## Probes and GameTests (Job 4)

These are triggered via `/colony:probe <name>` (permission `Any`, no cheats). A startup probe also logs whether the APIs exist. Results go to chat and the content log, tagged `[probe]`. Each probe answers one spike question:

1. **spawn**: does the top-level `spawnSimulatedPlayer` work on a cheats-off world, and are its movement coords absolute?
2. **chat**: does `chatSend` fire and cancel correctly?
3. **chunks**: does a simulated player keep ticking and moving when every real player is more than 160 blocks away (horizontal)?
4. **reload**: do simulated players survive a save, quit, and reload?

GameTests (dev world, cheats on, class and tag `colony`): `goto_flat`, `goto_unreachable` (fails as unreachable before the timeout), and `override_flow` with two bots. Each is also registered as `<name>_abs`, whose bots come from the top-level spawn instead of `test.spawnSimulatedPlayer`, to settle the nav-coordinate frame question (SPIKE-CHECKLIST §5). They drive the real runtime via `adoptBot` and `submitText` and assert on `snapshot()`.

## API ground rules for all game-facing code

- `node_modules/@minecraft/*/index.d.ts` is the source of truth. Never use a method or property that isn't in those type definitions.
- The pinned versions are `@minecraft/server` `2.11.0-beta` and `@minecraft/server-gametest` `1.0.0-beta`, matching game 1.26.5x.
- Before-event callbacks run in read-only mode; defer writes with `system.run`.
- Wrap every experimental API call in try/catch at the adapter boundary, and log with a `[colony]` tag.
