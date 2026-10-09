# S5: Commands and colony semantics (Phase 3)

Owner: S5. Consumers: B6 (parser + colony core + tests), B7 (messages.ts strings, help.ts, PLAYTEST), the contract writer (types.ts, config), B3 (runtime wiring), B4/S4 (snapshot flows), S1 (status read), S3 (equipment notices).
House style: `docs/PHASE2-SPEC.md` §Command grammar and §Colony semantics. Phase 1 and Phase 2 behaviour and strings are unchanged unless this file says so. Every new test in `test/commands-p3.test.ts` / `test/colony-p3.test.ts` (TC-B6) asserts the exact strings below.

Terminology: "owner" of a **bot** (new, §1) is not the "owner" field of an `Offer` in `state.ts` (the player who made the request). In code the bot field is `BotRecord.owner`; leave `Offer.owner` alone.

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | Bot owner = the player who ran `!spawn`. Ownerless bots (GameTest/probe spawns) are claimed by the first player who commands them. Owner is keyed by bot **name** and survives dismiss/rejoin/reload (persisted via `persistMeta`). |
| D2 | One colony home: `!home set` stores the sender's **block** position + dimension. Home does not change gather: `GatherTask.chest` stays the deposit target. Home matters for escape, rejoin, `!recall`, idle-deposit destination (S4). |
| D3 | Anyone can run any command on any bot (AGENT-CONTEXT). Busy-for-someone-else rules apply to dismiss/summon exactly as for `!stop <bot>`: a **pinned offer** answered with `!override`. Idle bots and your own tasks need no confirmation. Ownership gives **no** extra authority; it only defines what `all` and `!recall` mean. |
| D4 | `!defend [radius] [bots]` creates one `DefendTask` per bot (default radius 16, range 4-48, default 1 bot). `!defend stop` ends all of the sender's defend tasks. Defend counts as an ordinary busy task for allocation, but `planAllocation` takes other busy bots before defenders. |
| D5 | `!recall` = stop + go home: the sender's bots drop their current task (counted in the reply) and walk to home (else to the sender). Tasks are **dropped, not requeued** (requeueing would make bots walk straight back out on arrival). Bots busy for another player are skipped. |
| D6 | `!summon`: dismissed bot -> `summonBot` effect (snapshot restore at the sender's feet); live bot -> a goto to the sender. `!dismiss`: `dismissBot` effect (snapshot flow). No argument = `all` (the sender's bots). `all` never touches bots owned by or busy for someone else. |
| D7 | Dismissed / rejoining bots stay in the roster (`absent` map), keep their name and owner, and **count against `maxBots`**. They are never allocatable. |
| D8 | Combat info for `!status` is **pushed** into the core by `botStatus` events (<= every `statusPushTicks` = 20 ticks, on change, plus a heartbeat re-push every `statusHeartbeatTicks` = 80 ticks while nothing changed). The core never calls into the game. Info is shown while `now - at <= statusStaleTicks` (100); older than 100 ticks is hidden. |
| D9 | All bot-voiced notices from S1/S3/S4 (equipment request, chest full, excluded items, ...) go through one event `botNotice` with a typed `BotNotice`; the core renders the text and routes it to the bot's owner. S3/S4 never format chat text (S3's equipment asks are `equipNeed { need, low }`, §6). |
| D10 | Colony `chest`, `home` and bot owners are persisted by the game layer through one effect `persistMeta` (emitted at most once per `handle()` call, only when something changed) and restored by one event `rosterRestored`. |

## 1. Owner concept

State (`state.ts`):

```ts
export interface BotRecord {
  id: BotId;
  name: string;
  seq: number;
  task?: Task;
  progress?: TaskProgress;
  // Phase 3
  /** Player who spawned the bot (`!spawn`), or claimed it (first command that targets it). undefined = unclaimed. */
  owner?: PlayerRef;
  /** "live" = has a body and is allocatable. "leaving" = dismissBot effect sent, waiting for botDismissed.
   *  "rejoining" = escaped (botEscaped), waiting for botRejoined; task is retained. */
  presence: "live" | "leaving" | "rejoining";
  /** Tick the current leaving/rejoining state began (for flowTimeoutTicks). */
  flowSince?: Tick;
  /** leaving: who asked (gets the "dismissed" reply). */
  leaveRequestedBy?: PlayerRef;
  /** rejoining after escape: where the bot went. */
  rejoinDest?: EscapeDest;
  /** Latest pushed combat status and the tick it arrived. */
  combat?: { status: BotStatusView; at: Tick };
}

export interface PendingSpawn { name: string; requestedBy: PlayerId; owner: PlayerRef } // owner added

/** A rostered bot with no body: dismissed, or rejoining after a summon. Keyed by lowercase name. */
export interface AbsentBot {
  name: string;
  seq: number;
  owner?: PlayerRef;
  presence: "dismissed" | "rejoining";
  since: Tick;          // when it became dismissed / when the summon was sent
  requestedBy?: PlayerId; // rejoining via summonBot: gets the failure reply
}
```

`ColonyState` additions: `home?: HomeRef; absent: Map<string, AbsentBot>;` (`createState()` sets `absent: new Map()`).

Rules:
- `cmdSpawn` stores `owner: ref(sender)` in the `PendingSpawn`. `onBotRegistered` copies it onto the new `BotRecord` (match by case-insensitive name, as `dropPendingSpawn` does; read the pending entry **before** dropping it). A `botRegistered` with no pending spawn creates a record with `owner` undefined and `presence: "live"`.
- `claim(rec, sender)`: if `rec.owner === undefined`, set `rec.owner = ref(sender)` and mark meta dirty. Called when: a task is assigned to that bot by `assignNew` (issuer), the bot is named by `!stop|!summon|!dismiss <bot>`, or the bot is included by `all` / `!recall` (`isMine`). Never overwritten once set. There is no owner transfer.
- `isMine(rec, sender) = rec.owner === undefined || rec.owner.id === sender.id`. (Unclaimed bots count as everybody's; the command then claims them.)
- Owner id is the stable player id; the game finds the online player via `owner.id`. "Owner offline" is a game-side fact.
- `ColonyMeta.owners` is keyed by **lowercase bot name** (entity ids change on rejoin).

## 2. Home

```ts
export interface HomeRef { dimensionId: string; pos: Vec3 } // pos = integer block corner: Math.floor of the sender's x, y, z
```
- **Walking target = block centre.** `HomeRef.pos` is an integer block corner; wherever S5, S4 or S1 turn it into a destination for a bot to walk to, use `{ x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 }` (a bot sent to the raw corner stands on the block edge and can fail the arrival tolerance in the next block). The stored `HomeRef` itself is never changed.
- `ColonyState.home?: HomeRef`; `Colony.home(): HomeRef | undefined` (copy) and `ColonySnapshot.home?` expose it.
- `!home set` is synchronous (no locate round trip): `home = { dimensionId: sender.dimensionId ?? "minecraft:overworld", pos: floor(sender.pos) }`; marks meta dirty. This needs the new optional field `Sender.dimensionId?: string`; `src/game/frontends/sender.ts` fills it with `player.dimension.id` (contract writer).
- `!home` (show) is read-only. Neither home command touches offers or the queue.
- Gather: unchanged. `cmdGather` still requires the colony chest and passes it in the task. If both home and chest exist, nothing links them in Phase 3 (Phase 4 sorter will).
- Consumers: escape/rejoin destination (S4: home if set, else owner's feet), `!recall`, idle/far-dismiss deposit destination (S4), `Percept.home` (S1). Runtime reads `colony.home()` when building percepts; no event needed.
- Home is persisted (D10). Home in another dimension than the bot is allowed; navigation may fail (`!recall` -> `Couldn't reach ...: no path.`). See open question Q2.

## 3. Grammar

### 3.1 Command union (add to `src/core/types.ts`)

```ts
export type BotTarget = { kind: "all" } | { kind: "bot"; name: string };

export type Command =
  | /* ...Phase 1 + 2 members unchanged... */
  // Phase 3
  /** `!defend [radius] [bots]` */
  | { kind: "defend"; action: "start"; radius: number; count: number }
  /** `!defend stop` */
  | { kind: "defend"; action: "stop" }
  /** `!home` (show) / `!home set` */
  | { kind: "home"; action: "show" | "set" }
  /** `!summon [bot|all]`; omitted argument = { kind: "all" } */
  | { kind: "summon"; target: BotTarget }
  /** `!dismiss [bot|all]`; omitted argument = { kind: "all" } */
  | { kind: "dismiss"; target: BotTarget }
  /** `!recall` */
  | { kind: "recall" };
```
`CommandKind` gains `"defend" | "home" | "summon" | "dismiss" | "recall"`. `!status` keeps `{ kind: "status"; bot?: string }`; only its output changes (§7).

### 3.2 Specs (`specs.ts`)

New constants (the parser is config-free, so these are constants, not `config.ts` keys):
```ts
export const DEFEND_LIMITS = { minRadius: 4, maxRadius: 48, defaultRadius: 16 } as const;
```
New `ArgType`s: `defendArg` (integer `minRadius..maxRadius`, or literal `stop`, case-insensitive), `botOrAll` (literal `all`, case-insensitive, else `botName` rules), `homeAction` (literal `set`, case-insensitive).

`COMMAND_SPECS` order: help, status, spawn, goto, come, gather, chest, **defend, home, summon, dismiss, recall**, stop, override, queue. Specs (names/labels are exact so the derived usage lines match):

| Command | Args (`name`, `label`, `type`, optional) | Usage (derived) | Description (exact) |
|---|---|---|---|
| `defend` | `radius|stop` / `radius` / `defendArg` / opt; `bots` / `bot count` / `count` / opt | `defend [radius|stop] [bots]` | `Guard where you stand (radius 4-48, default 16) with 1-16 bots. '!defend stop' ends it.` |
| `home` | `set` / `home action` / `homeAction` / opt | `home [set]` | `Show the colony home, or 'set' it to where you stand.` |
| `summon` | `bot|all` / `bot name` / `botOrAll` / opt | `summon [bot|all]` | `Bring a bot (or all your bots) to you. Dismissed bots rejoin with their items.` |
| `dismiss` | `bot|all` / `bot name` / `botOrAll` / opt | `dismiss [bot|all]` | `Send a bot (or all your bots) offline. Items are saved and restored on !summon.` |
| `recall` | none | `recall` | `Send all your bots home (or to you if no home is set) and stand them down.` |

`build()`:
- `defend`: if the first token parsed as `stop` -> `{ kind: "defend", action: "stop" }`; else `{ kind: "defend", action: "start", radius: v.radius ?? DEFEND_LIMITS.defaultRadius, count }` (`count` = parsed bots or `MIN_COUNT`).
- `home`: `{ kind: "home", action: v.homeAction ?? "show" }`.
- `summon` / `dismiss`: `{ kind, target: v.target ?? { kind: "all" } }`; `v.target` is `{kind:"bot", name}` (name without a leading `@`) or `{kind:"all"}`.
- `recall`: `{ kind: "recall" }`.
`Values` gains `radius?: number; stop?: boolean; target?: BotTarget; homeAction?: "show"|"set"`.

`parseArg` fills `Values` exactly like this (one way only): `defendArg` -> `values.stop = true` for the token `stop`, else `values.radius = n`; the optional `bots` arg (`count`) -> `values.count` (existing key); `botOrAll` -> `values.target` (`{kind:"all"}` for `all`, else `{kind:"bot", name}`); `homeAction` -> `values.homeAction = "set"`.
Integer rule: `defendArg` accepts a token as a radius only if it matches `/^[0-9]+$/` and `DEFEND_LIMITS.minRadius <= Number(token) <= DEFEND_LIMITS.maxRadius`; otherwise the radius error of §3.3 (so `+16`, `16.0`, `1e1` and non-ASCII digits are rejected). The literal is compared with `token.toLowerCase() === "stop"`; `all` and `set` likewise with `toLowerCase()`.

### 3.3 Parse errors (each followed by the usage line, as in Phase 1)

| Case | Error text |
|---|---|
| `!defend` radius not an integer in 4..48 and not `stop` (`!defend 3`, `!defend 99`, `!defend abc`, `!defend 1.5`) | `Radius must be a whole number from 4 to 48, or 'stop'.` |
| `!defend stop 2` (anything after `stop`) | `'stop' takes no other arguments.` |
| `!defend 16 0` / `!defend 16 17` / `!defend 16 x` | Phase 1 count error: `Count must be a whole number from 1 to 16.` |
| `!defend 16 2 9` | `Too many arguments.` |
| `!home foo` | `Unknown home action '{echo}'. Use {p}home or {p}home set.` (`{echo}` = `echo(token)`, `{p}` = the `prefix` parameter) |
| `!summon @@x` / `!dismiss bad!name` | Phase 1: `'bad!name' isn't a valid bot name (1-16 letters, digits, _ or -).` |
| `!summon a b`, `!recall now`, `!home set x` | `Too many arguments.` |

Notes: the `stop` token check for `!defend` happens in `parseArg` when `arg.type === "defendArg"`; the "other arguments" check is in `parseCommand` after the loop (`values.stop && args.length > 1`). A bot literally named `all` is not addressable by name; `cmdSpawn` rejects it (`nameReserved`, §6). `/colony:c` fits in 5 tokens (`defend 24 3`).

## 4. Colony semantics

### 4.1 Common rules
- All five new commands, and `!home`, are cooldown-checked (same path as Phase 2). `help` unchanged.
- `botList()` (the allocation pool) = records with `presence === "live"`, **sorted by `seq`** (the Map's insertion order is no longer registration order because rejoined bots are re-inserted). New `roster()` = all records (any presence) plus `absent` entries, sorted by `seq`; used by `!status`, `findBot`, `nameInUse`, the `maxBots` check.
- `maxBots` check in `cmdSpawn`: `s.bots.size + s.absent.size + s.pendingSpawns.length >= max`. `nameInUse` also checks `absent`.
- `findBot(name)` searches `s.bots` (all presences) first, then `s.absent`; returns a discriminated `{ rec } | { absent }`.
- Requests that need live bots (`goto`, `come`, `gather`, `defend`): `bots.length === 0` -> if `s.absent.size > 0` reply `allDismissed` else `noBots`. `n > bots.length` -> if `s.absent.size > 0` reply `tooManyAway(n, live, away)` else `tooMany`.
- Any command that takes effect (defend start/stop, summon, dismiss, recall) first runs `this.s.offers.delete(sender.id)` ("a valid fresh request supersedes the pending offer"); rejected requests (unknown bot, nothing to do) leave the offer alone. `!home` / `!home set` never touch offers.
- Replies go to the sender unless stated. "Bot-voiced" = `botSay(rec, to, text)`; "colony" = `reply(to, text)`.
- `cancel(rec, reason)` and `assign(rec, task)` stay the only emitters of `cancel` / `assign`. Quiet assignment = `assign` + no ack line (used by `!recall` and `!summon all`); `assignNew` keeps its per-kind ack.

### 4.2 `!defend [radius] [bots]`
1. `n = count`. Validation order as Phase 2 step 2 (`noBots`/`allDismissed`, then `tooMany`/`tooManyAway`).
2. Builds `n` specs `{ kind: "defend", center: { ...sender.pos }, radius }` (center keeps the sender's exact x/y/z at command time; the task keeps the floats) and calls the shared `request(sender, now, specs)`: idle bots first, then own tasks (replaced silently), else a task offer that lists each busy bot's **activity** and issuer; `!override` / `!queue` work as for goto/gather (a queued defend is picked up later: `Picking up your queued task: defending x y z (r16).`).
3. Ack per assigned bot (bot-voiced to sender): `defending`. `{pos}` in every defend string (ack, `activity`, `noun`, reports) is the existing `fmtPos` from `messages.ts`, which prints each coordinate as an integer when whole and with one decimal otherwise. Example: sender at (100.5, 64, 200.25) -> `Defending 100.5 64 200.3 (radius 16).` (`Math.round(200.25*10)/10 = 200.3`). The examples in this file use whole coordinates.
4. `DefendTask { id, kind: "defend", center, radius, issuer, createdAt }` never reports `done`. It ends only by: `!stop` (all or `<bot>`), `!defend stop`, an `!override` of a pending offer by another player (`cancel(..., "preempted")`, the defend task is **requeued** at the queue front with a `reassigned` notice, noun `defend x y z (r16)`), `!dismiss`, `!recall`, the issuer's own new task replacing it, or bot removal (requeued like any task, `botLeftRequeued`). A `failed` report prints `defendFailed`. A `done` report (should not happen) is treated as ended with the line `Stopped defending x y z.` (`defendEnded`).
5. Allocation tweak (`allocator.ts`): the busy sort key becomes `rank(b) = (issuer is requester ? 0 : 2) + (b.task.kind === "defend" ? 1 : 0)`, then `createdAt`, then `seq`. So the order of busy bots taken is: requester's non-defend, requester's defend, others' non-defend, others' defend. Idle bots are still first.
6. `!defend` when the sender already has defenders just adds more (a second zone). To move a zone: `!defend stop` then `!defend`.

`!defend stop`: cancels every active `DefendTask` whose `issuer.id === sender.id` (`cancel(rec, "stopped")`), removes the sender's queued defend tasks, deletes the sender's pending task offer if all its specs are defend specs. Reply `defendStopped(active, queued)`; nothing found -> `noDefend`. Then `drainQueue()`. Defend tasks of other players are untouched.

### 4.3 `!home`, `!home set`
See §2. Replies: `homeSet`, `homeShow`, `noHome`. `!home set` marks meta dirty.

### 4.4 `!dismiss [bot|all]`
`beginLeave(rec, requester, now)`: `rec.presence = "leaving"; rec.flowSince = now; rec.leaveRequestedBy = ref(requester)`; push `{ kind: "dismissBot", botId: rec.id, name: rec.name, cause: "command", requestedBy: requester.id }`. Preceded by cancelling the bot's task if any (so the executor is torn down before the snapshot flow).

`all` (default): targets = live records with `isMine(rec, sender)`, claiming unclaimed ones.
- None -> `dismissNone` (no side effects).
- Per target: task issued by someone else -> skip with `skippedBusy(bot, issuerName)`; else `cancel(rec, "stopped")` (own task dropped, not requeued) then `beginLeave`.
- If at least one began: one summary line `dismissingAll(n)` (n >= 2) or `dismissing(bot)` (n = 1). Skip lines come first.

`<bot>`:
- Unknown name -> `unknownBot`.
- Absent/leaving/rejoining -> `botAway(bot, presence)`.
- Live, no task or own task -> `claim`, cancel own task (`"stopped"`, dropped), `beginLeave`, reply `dismissing(bot)`.
- Live, busy with **another player's** task -> **pinned offer** (§4.6): `PinnedOffer { action: "dismiss" }`; replies `offerBusyBot(bot, activity, issuer)` then `dismissOfferHint`.

Justification (D3): dismiss is reversible (`!summon` restores the exact inventory, no cooldown) so ownership is not a gate, but taking a bot off another player's active task is the same harm as `!stop <their bot>`, so it uses the same confirmation. The owner is told when someone else dismisses their bot (`dismissedBy`).

Completion events:
- `botDismissed { botId, name, cause, stacks }`: remove the record from `s.bots`; create `AbsentBot { presence: "dismissed", since: now, owner, seq }`. If the record still had a task (game-initiated dismiss while busy, or a late completion after a timeout): requeue it at the queue front like `onBotRemoved` (without the `left` broadcast) and send `botLeftRequeued` to the task issuer. Replies by cause (colony voice): `command` -> to `leaveRequestedBy` `dismissed(bot, stacks)`, and if the owner is a different player also to the owner `dismissedBy`; `idle` -> to the owner (or `"all"` if unclaimed) `dismissedIdle`; `far` -> `dismissedFar`. Unknown `botId` but known absent name -> ignore (duplicate). Unknown everything -> still create the absent entry (owner undefined).
- `botDismissFailed { botId, name, reason }`: record -> `presence = "live"`, clear `flowSince`/`leaveRequestedBy`; reply to the requester `dismissFailed(bot, reasonText)`. The cancelled task is not restored (the player re-issues it).
- Timeout: `leaving` longer than `flowTimeoutTicks` -> treated as `botDismissFailed` with reason `error`. (S4b's flow deadline is 500 ticks < 600, so this is a safety net.) **Late completion:** a `botDismissed` that arrives after that timeout finds a `live` record whose body is really gone; it is applied as a normal dismissal (record removed, `AbsentBot` created). If the record has a task, the task is requeued at the queue front (as `botRemoved` does) and `botLeftRequeued` is sent to the task issuer; the `dismissed` reply goes to the owner (or `"all"`) because `leaveRequestedBy` was cleared. A late `botDismissFailed` after the timeout is ignored and logged `[colony] late botDismissFailed <name>`.

### 4.5 `!summon [bot|all]`
`all` (default): targets = roster entries (live, absent) with `isMine`, claiming unclaimed. None -> `summonNone`.
- Absent `dismissed`: `presence = "rejoining"`, `since = now`, `requestedBy = sender.id`; effect `summonBot { name, near: { ...sender.pos }, dimensionId: sender.dimensionId ?? "minecraft:overworld", requestedBy: sender.id }`.
- Live: task issued by someone else -> skip with `skippedBusy`; otherwise cancel own task (`"stopped"`, dropped) and quietly assign a goto to `sender.pos` (task issuer = sender).
- leaving / rejoining entries are skipped silently (they are already in flight).
- Summary reply `summoningAll(n)` / `summoning(bot)` with `n` = number of bots actually acted on, after the skip lines. If every target was skipped, only the skip lines are sent.

`<bot>`:
- Unknown -> `unknownBot`. `leaving` / `rejoining` -> `botAway`.
- Absent `dismissed` -> claim, effect as above, reply `summoning(bot)`. This is allowed for any player regardless of owner (D3: summon only brings a bot to *you*; the owner is not harmed).
- Live, idle or own task -> claim, cancel own task (`"stopped"`, dropped), assign goto `sender.pos` via `assignNew` (ack `onMyWay`, Phase 1 string).
- Live, busy with another's task -> pinned offer `action: "summon"` (replies `offerBusyBot`, `summonOfferHint`).

Completion events:
- `botRejoined { botId, name, cause: "summon", ... }`: §4.7. Reply bot-voiced `rejoinedSummon(stacks)` to the summoner (`requestedBy`, else owner, else `"all"`).
- `botRejoinFailed { name, cause: "summon", reason }`: absent entry -> `presence = "dismissed"`; reply to `requestedBy` `summonFailed(bot, reasonText)`.
- Timeout: `rejoining` longer than `flowTimeoutTicks` -> treated as `botRejoinFailed { reason: "error" }`. A `botRejoined` that arrives after that timeout means a body really exists: it is applied as a normal rejoin (the `dismissed` absent entry becomes a live record); a late `botRejoinFailed` is ignored and logged.

### 4.6 Pinned offers (`state.ts`)

```ts
export interface PinnedOffer {
  kind: "pinned";
  owner: PlayerRef;           // the requester (same meaning as other offers' `owner`)
  createdAt: Tick;
  action: "dismiss" | "summon";
  botId: BotId;
  botName: string;
  taskId: TaskId;             // the other player's task that would be taken
  /** summon only: where to bring it (sender's position at command time). */
  near?: Vec3;
}
export type Offer = TaskOffer | StopOffer | PinnedOffer;
```
- `!override`: `takeLiveOffer`; for `pinned`: look up the bot; missing, not `live`, or `bot.task?.id !== taskId` -> `noLongerOnTask(botName)`. Otherwise: remember the victim task (`old`) and its progress; `cancel(bot, "preempted")`; requeue the victim's task at the **queue front** with the notice `dismissedTaskQueued` (dismiss) or `reassigned` (summon) to `old.issuer` (or `reassignedDone`/`dismissedTaskDone` if `requeueable` says it was already complete); then run the normal immediate path: dismiss -> `claim` + `beginLeave` + `dismissing(bot)`; summon -> `assignNew` goto `offer.near` (ack `onMyWay`).
- `!queue` with a pinned offer -> `nothingToQueue` (same as stop offers; the existing `offer.kind !== "task"` branch already does this).
- Offer expiry: the existing tick sweep covers it (`offerExpired`).
- `executeTaskOffer` / `cmdQueue` / `request()` are unchanged except for `TaskSpec` gaining the defend variant.

### 4.7 Escape and rejoin (state side; S4 owns the physical flow)

Events (payloads in §5): `botEscaped` (flow started), `botRejoined` (bot is back, new `botId`), `botRejoinFailed`.
- `botEscaped { botId, name, dest }`: record -> `presence = "rejoining"`, `rejoinDest = dest`, `flowSince = now`; **task and progress are retained**; the record leaves the allocation pool. Reply bot-voiced (still-valid old id) to the owner (`"all"` if unclaimed): `escaping(destText)` where `destText` is `home` for `dest: "home"`, else the owner's name (`the owner` if unclaimed).
- `botRejoined { botId, name, cause, pos, stacks, owner?, dest?, seq?, leftover?, haulDropped? }` (the last three are S4b's optional additions, H3; `pos` and `leftover` are accepted and not used by the core):
  1. **Duplicate guard.** If `s.bots` already has a record with `presence === "live"` and the same lowercase name, ignore the event and log `[colony] duplicate botRejoined <name>`.
  2. Find the record by **name** in `s.bots` (presence != live) or the entry in `s.absent`; else (unknown name) create a fresh record (owner = `e.owner`).
  3. Build the new live record: `{ id: e.botId, name, seq: (kept ?? e.seq ?? next), owner: kept ?? e.owner, presence: "live" }`; delete the old map key, insert the new one.
  4. **Task.** If the old record held a task: `task' = withDelivered(task, progress)`; for `task.kind === "gather"`: `delivered' = progress.delivered + (haulDropped ? min(haulDropped.count, progress.held) : 0)` (H3: items the restore dropped on purpose count as delivered-equivalent; `held` items that are back in the inventory stay held). If `task.kind === "gather"` and `delivered' >= task.amount`: drop the task silently. **Every other task kind** (`goto`, `defend`) is re-assigned unchanged. Otherwise `assign(newRec, task')` -> `assign` effect with the same task id.
  5. Reply bot-voiced by cause (to the right audience): `escape` -> owner: `rejoinedEscape(destText)`; `summon` -> `requestedBy` ?? owner: `rejoinedSummon(stacks)`; `reload` -> owner: `rejoinedReload`; `owner_returned` -> owner: `rejoinedOwner(ownerName)`. Then `drainQueue()`.
  - Worked example (H3): gather 16 oak_log, `progress = {delivered: 3, held: 12}`, `haulDropped = {count: 12}` -> `delivered' = 3 + min(12, 12) = 15 < 16`: the task continues with 1 log to go. With `haulDropped.count = 14` and `held = 12`: `3 + min(14, 12) = 15`, the same.
  - **Single task owner (D26).** The controller carry (`exportCarry`) holds only `brainState`, `recover`, `objectiveItemIds` and `stats`; it never holds the task. The core is the only side that re-installs it: the `assign` above is emitted on `botRejoined`, and the controller creates the executor from it, started in the paused/recover layer when `recover` is set (S1 H4). A controller that already has an executor with `taskId === task.id` replaces it silently, so a task is never running twice and cargo is never consumed twice.
- `botRejoinFailed { name, cause, reason }`: record (escape) -> remove it, requeue its task (`requeueable`, front of queue, reply `botLeftRequeued` to the task issuer), create `AbsentBot dismissed`; absent entry -> back to `dismissed`. Reply `summonFailed` (cause `summon`, to `requestedBy`) or `rejoinFailed` (other causes, to the owner / `"all"`).
- `botRemoved` for a record whose presence is not `live`: the flow ended without its event. Do **not** drop the roster entry: treat as `botDismissed { cause: "command" }` without replies, except reason text `"died"` which deletes the roster entry as today (`left`). The runtime must not emit `botRemoved` for service-driven disconnects (S4 contract); this is only a safety net.
- `taskReport` / `taskProgress` / `botStatus` for a record whose presence is not `live` -> ignored.
- `!stop` (all or `<bot>`) iterates **all** records: for a non-live record holding the sender's task it clears `task`/`progress` with no `cancel` effect (the executor is already gone), so the bot will not resume after rejoin.
- Reload: `rosterRestored { meta, names }` (once per world load, before any `botRejoined`): `home`/`chest` restored, `owners` restored by name; each name gets `AbsentBot { presence: "dismissed", seq: next, owner: meta.owners[lower] }`; reply `rosterRestored(n)` to `"all"` if `n > 0`. S4's service then rejoins bots whose owner is online (or home is set); each rejoin arrives as `botRejoined { cause: "reload" | "owner_returned" }`. Bots it cannot rejoin yet stay `dismissed` and S4 emits `botNotice { name, notice: { id: "rejoinDeferred", owner } }`.

### 4.8 `!recall`
Targets: live records with `isMine`, claiming unclaimed ones. Absent/leaving/rejoining bots are ignored (use `!summon`).
1. None -> `recallNone`.
2. Destination `dest` = `{ x: home.pos.x + 0.5, y: home.pos.y, z: home.pos.z + 0.5 }` if home is set, else `{ ...sender.pos }` (§2: walking target = block centre). Word: `home` / `you`.
3. Per target: task issued by someone else -> skipped (`skippedBusy`, lines first). Otherwise, if it has a task (necessarily the sender's): `cancel(rec, "stopped")`, `dropped++`; defend tasks are included. Then quietly assign `goto(dest)` (issuer = sender; Y of home as stored). Example: home `pos (12, 64, 3)` -> `dest (12.5, 64, 3.5)`; the arrival line is `Arrived at 12.5 64 3.5.`
4. Reply once: `recalling(n, word, dropped)` where `n` = bots recalled; if `n = 0` only skip lines + `recallNone`.
5. Queued tasks are untouched. The arrival report is the Phase 1 `Arrived at x y z.` per bot.

Why drop, not requeue: `drainQueue` gives queue heads to idle bots, so requeued tasks would restart the moment a recalled bot arrived. A player who wants the work back re-issues it; a player who wants a pause uses `!recall`.

### 4.9 Status read, reports, misc
- `botStatus { botId, status }` (§5) -> `rec.combat = { status, at: now }` for live records (heartbeat re-pushes simply refresh `at`).
- `botNotice` rate limit: `ColonyState.lastNotice: Map<string, Tick>` keyed `${lowercaseName}:${notice.id}`; a notice whose key was delivered less than `noticeMinIntervalTicks` (200 = 10 s) ago is dropped (not queued). `createState()` sets it to `new Map()`.
- `cmdStatus` renders per §7. It now takes `now`.
- Bot `owner` and `presence` appear in `ColonySnapshot` (§5).
- Report texts: `reportText` gets the defend branch (§4.2 item 4). `taskActivity` / `taskNoun` get the defend case:
  - activity: `defending {x y z} (r{radius})` e.g. `defending 100 64 200 (r16)`.
  - noun: `defend {x y z} (r{radius})`.
- `pickingUp` already prints `taskActivity`.
- `onTick(now)` also: for each record `leaving`/`rejoining` with `now - flowSince >= flowTimeoutTicks`, and each absent `rejoining` with `now - since >= flowTimeoutTicks`, apply the timeout rule of §4.4 / §4.5 / §4.7 (reason `error`).
- Meta persistence: `this.metaDirty = true` whenever `chest`, `home` or any `owner` changes (chestLocated, `!home set`, claim, spawn registration, rosterRestored does **not** set it). At the end of `handle()`, if dirty, push one `{ kind: "persistMeta", meta }` and clear. `meta.owners` contains an entry for every roster bot (live or absent) with an owner. Removal of a bot (`botRemoved` with `died`) deletes its owner entry and marks dirty.

## 5. Contract additions (exact TS; `src/core/types.ts`, contract writer applies)

S4 owns the exact payloads of the snapshot events/effects; the fields below are what the core needs. S4 may **add** fields; it must not remove or rename these.

```ts
import type { BotStatusView, LayerKind, OptionKind } from "./combat/types.js"; // BotStatusView: S1 §1 (D25: exactly the shape below); OptionKind: S2b

// ---- primitives
export interface Sender extends PlayerRef { pos: Vec3; /** e.g. "minecraft:overworld"; absent = overworld */ dimensionId?: string }
export interface HomeRef { dimensionId: string; pos: Vec3 }
export type BotPresence = "live" | "leaving" | "rejoining" | "dismissed";
export type EscapeDest = "home" | "owner";
export type DismissCause = "command" | "idle" | "far";
export type RejoinCause = "summon" | "escape" | "reload" | "owner_returned";
export type SnapshotFailReason =
  | "busy" | "no_snapshot" | "snapshot_unreadable" | "spawn_failed" | "name_in_use" | "owner_offline" | "storage_full" | "error"; // storage_full: D7 / S4b H7

/** Persisted by the game layer next to the bot snapshots (S4 store). Owners keyed by lowercase bot name. */
export interface ColonyMeta { chest?: ChestRef; home?: HomeRef; owners: Record<string, PlayerRef> }

/** What S3's equipment manager can ask for (declared once, here; S3 §5.2 imports it). */
export type AskNeed = "weapon" | "shield" | "helmet" | "chestplate" | "leggings" | "boots" | "food";

/** Bot-voiced chat lines raised by game-side code; the core renders and routes them (see §6). */
export type BotNotice =
  | { id: "equipNeed"; need: AskNeed; low: boolean }       // D24. low = the item exists but is almost broken; rendering depends on need, low and whether a colony chest is set (§6)
  | { id: "chestFull" }
  | { id: "excludedDropped"; count: number; pos: Vec3 }
  | { id: "restoreLeftover"; count: number }
  | { id: "escapeBlocked" }                                // low HP, no home, owner offline
  | { id: "rejoinDeferred"; owner?: PlayerRef };           // absent bot waits for its owner (colony voice)

// ---- tasks
export interface DefendTask {
  id: TaskId; kind: "defend";
  center: Vec3;        // sender position at command time (exact, not floored)
  radius: number;      // 4..48
  issuer: PlayerRef; createdAt: Tick;
}
export type Task = GotoTask | GatherTask | DefendTask;       // TaskOf / TaskKind follow

// ---- events (game -> core) additions to ColonyEvent
  | { kind: "botStatus"; now: Tick; botId: BotId; status: BotStatusView }
  | { kind: "botDismissed"; now: Tick; botId: BotId; name: string; cause: DismissCause; stacks: number; seq?: number }
  | { kind: "botDismissFailed"; now: Tick; botId: BotId; name: string; reason: SnapshotFailReason }
  | { kind: "botEscaped"; now: Tick; botId: BotId; name: string; dest: EscapeDest; pos?: Vec3 }
  | { kind: "botRejoined"; now: Tick; botId: BotId; name: string; cause: RejoinCause; pos: Vec3;
      stacks: number; owner?: PlayerRef; dest?: EscapeDest;
      /** S4b additions (H3): */ seq?: number; leftover?: number; haulDropped?: { itemIds: string[]; count: number } }
  | { kind: "botRejoinFailed"; now: Tick; name: string; cause: RejoinCause; reason: SnapshotFailReason; botId?: BotId }
  | { kind: "rosterRestored"; now: Tick; meta: ColonyMeta; names: string[] }
  | { kind: "botNotice"; now: Tick; name: string; botId?: BotId; notice: BotNotice }

// ---- effects (core -> game) additions to Effect
  /** Run the dismiss flow (S4): task already cancelled. Answer: botDismissed or botDismissFailed. */
  | { kind: "dismissBot"; botId: BotId; name: string; cause: "command"; requestedBy: PlayerId }
  /** Rejoin a dismissed bot at `near` in `dimensionId` (the requester's dimension). Answer: botRejoined or botRejoinFailed. */
  | { kind: "summonBot"; name: string; near: Vec3; dimensionId: string; requestedBy: PlayerId }
  /** Store `meta` (S4 store). Emitted at most once per handle() call, only on change. No answer. */
  | { kind: "persistMeta"; meta: ColonyMeta }

// ---- read model
export interface BotView {
  id: BotId;                    // the entity id for `live`, `leaving` and `rejoining` records (rejoining: the OLD id, no longer valid); `dismissed:${lowercaseName}` only for `presence: "dismissed"`
  name: string;
  state: BotState;              // "busy" iff `task` set (a rejoining-after-escape bot keeps its task)
  task?: Task;
  progress?: TaskProgress;
  owner?: PlayerRef;
  presence: BotPresence;
  /** Latest pushed status, raw (no staleness filter; `!status` shows it while now - at <= statusStaleTicks). Live records only. */
  combat?: BotStatusView;
}
export interface ColonySnapshot { bots: BotView[]; queued: Task[]; pendingOffers: number; chest?: ChestRef; home?: HomeRef }

export interface ColonyConfig { /* existing */ statusStaleTicks: Tick; statusPushTicks: Tick; statusHeartbeatTicks: Tick; flowTimeoutTicks: Tick; noticeMinIntervalTicks: Tick }
```
- `snapshot().bots` lists the whole roster (live, leaving, rejoining, dismissed) by `seq`. Existing tests only contain live bots, so only the new `presence` field appears.
- Accessors on `Colony` for the runtime (cheap, no event): `home(): HomeRef | undefined`, `ownerOf(botId: BotId): PlayerRef | undefined`.
- Executor registry (B3): `"defend"` -> `DefendExecutor` (S1/B3). The core only needs the task kind.
- `TaskSpec` (state.ts) gains `| { kind: "defend"; center: Vec3; radius: number }`; `newTask`, `copyTask`, `assignNew` ack, `reportText` get the defend case. `assignNew` ack for defend: `defending`.

### Fields `!status` needs from `BotStatusView`
`BotStatusView` is defined in S1 §1. D25: S5's shape wins, so S1 **must** define exactly these names and types (the contract writer does not rename; S5 and S6 assertions use them); any field below that is absent from S1 §1 is added there:
```ts
layer: LayerKind;                    // "reflex" | "combat" | "task" | "idle"
option: OptionKind;                  // current committed option; meaningful only while layer === "combat" (S1)
target?: { typeId: string };         // current combat target
hp: number; maxHp: number; hunger: number;       // hunger 0..20 (food level)
recovering: boolean;                 // true while the controller state is RECOVER or `carry.recover` is set (post-escape / post-fight recovery)
gear: { weaponTypeId?: string; armorPieces: number /* 0..4 */; hasShield: boolean; foodCount: number };
```
Runtime pushes `botStatus` per live bot at most every `statusPushTicks` (20), when `layer`, `option`, `target?.typeId`, `Math.round(hp)`, `Math.round(hunger)`, `recovering` or `gear` changed, **and** re-pushes the current status every `statusHeartbeatTicks` (80) when nothing changed, so a long stable fight is never older than 80 ticks and the 100-tick stale hide (§7) cannot fire while the bot is still reporting.

## 6. Chat strings (`src/core/colony/messages.ts`, key = message id)

Colony-voice lines are bare strings (the runtime adds `§7[Colony]§r`). Bot-voice lines go through `botSay` (the runtime adds `<Bot-1> `). `{pos}` = `fmtPos`, `plural(n, w)` = existing helper, `{secs}` = `offerSecs()`, `{p}` = command prefix. The `fmtPos` rounding (integer when whole, else one decimal) applies to every `{pos}`. Em dash is U+2014, ellipsis is U+2026.

| id | voice / to | when | exact text |
|---|---|---|---|
| `nameReserved` | colony / sender | `!spawn all` | `'all' is reserved. Pick another bot name.` |
| `allDismissed(p)` | colony / sender | request needs live bots, none live, some dismissed | `All bots are dismissed. Type {p}summon.` |
| `tooManyAway(n, live, away, p)` | colony / sender | `n > live`, some dismissed | `Only {plural(live,"bot")} available ({away} dismissed); can't send {n}. Try {p}summon.` |
| `defending(center, radius)` | bot / sender | defend task assigned | `Defending {pos} (radius {radius}).` |
| `defendStopped(active, queued)` | colony / sender | `!defend stop` found something | `Stopped {plural(active,"defender")}, dropped {queued} queued.` |
| `noDefend` | colony / sender | `!defend stop`, nothing found | `You aren't defending anywhere.` |
| `defendFailed(center, reason)` | bot / issuer | defend task `failed` report | `Stopped defending {pos}: {FAIL_TEXT[reason]}.` |
| `defendEnded(center)` | bot / issuer | defend task `done` report (defensive) | `Stopped defending {pos}.` |
| `homeSet(pos, dim)` | colony / sender | `!home set` | `Home set to {pos} ({dim}).` (`dim` = `shortId(dimensionId)`: `overworld`, `nether`, `the_end`) |
| `homeShow(pos, dim)` | colony / sender | `!home`, home set | `Home: {pos} ({dim}).` |
| `noHome(p)` | colony / sender | `!home`, no home | `No home yet. Stand where you want it and type {p}home set.` |
| `dismissing(bot)` | colony / sender | one bot began leaving | `Dismissing {bot}…` |
| `dismissingAll(n)` | colony / sender | `n >= 2` bots began leaving | `Dismissing {n} bots…` |
| `dismissed(bot, stacks, p)` | colony / requester | `botDismissed` cause `command`, `stacks > 0` | `Dismissed {bot} ({plural(stacks,"stack")} saved). Type {p}summon {bot} to bring it back.` |
| `dismissed(bot, 0, p)` | colony / requester | same, `stacks = 0` | `Dismissed {bot}. Type {p}summon {bot} to bring it back.` |
| `dismissedBy(bot, by)` | colony / owner (if not the requester) | someone else's dismiss completed | `{bot} was dismissed by {by}.` |
| `dismissedIdle(bot, p)` | colony / owner (`"all"` if unclaimed) | `botDismissed` cause `idle` | `{bot} went offline (idle). Type {p}summon {bot} to bring it back.` |
| `dismissedFar(bot, p)` | colony / owner (`"all"` if unclaimed) | `botDismissed` cause `far` | `{bot} went offline (parked far from every player). Type {p}summon {bot} to bring it back.` |
| `dismissFailed(bot, reason)` | colony / requester | `botDismissFailed` or timeout | `Couldn't dismiss {bot}: {SNAPSHOT_FAIL_TEXT[reason]}.` |
| `dismissNone` | colony / sender | `!dismiss`/`all`, no eligible bot | `You have no bots to dismiss.` |
| `dismissOfferHint(p, secs)` | colony / sender | pinned dismiss offer | `Reply {p}override to dismiss it (expires in {secs}s).` |
| `dismissedTaskQueued(bot, by, noun)` | colony / preempted issuer | pinned dismiss overridden, task requeued | `{bot} was dismissed by {by}; your task ({noun}) is queued.` |
| `dismissedTaskDone(bot, by, noun)` | colony / preempted issuer | same, task already complete | `{bot} was dismissed by {by}; your task ({noun}) was already done.` |
| `botAway(bot, presence, p)` | colony / sender | command names a non-live bot | `dismissed`: `{bot} is dismissed. Type {p}summon {bot}.`; `rejoining`: `{bot} is rejoining.`; `leaving`: `{bot} is leaving.` |
| `skippedBusy(bot, issuer)` | colony / sender | `all`/recall skipped a bot busy for another player | `Skipped {bot}: busy for {issuer}.` |
| `summoning(bot)` | colony / sender | one dismissed bot summoned | `Summoning {bot}…` |
| `summoningAll(n)` | colony / sender | `n >= 2` bots acted on | `Summoning {n} bots…` |
| `summonNone` | colony / sender | no eligible bot | `You have no bots to summon.` |
| `summonFailed(bot, reason)` | colony / requester | `botRejoinFailed` cause `summon`, or timeout | `Couldn't summon {bot}: {SNAPSHOT_FAIL_TEXT[reason]}.` |
| `summonOfferHint(p, secs)` | colony / sender | pinned summon offer | `Reply {p}override to call it anyway (expires in {secs}s).` |
| `recalling(n, word, dropped)` | colony / sender | recall done | `Recalling {plural(n,"bot")} to {word}.` + (`dropped > 0` ? ` Dropped {plural(dropped,"task")}.` : ``) ; `word` = `home` or `you` |
| `recallNone` | colony / sender | no eligible bot | `You have no bots to recall.` |
| `escaping(dest)` | bot / owner | `botEscaped` (S4: Escape flow start) | `Too hurt — escaping to {dest}.` (`dest` = `home` or owner name) |
| `escapeBlocked` | bot / owner | notice `escapeBlocked` | `Too hurt, but there's no home and {owner} is offline.` (`owner` = owner name, `the owner` if unclaimed) |
| `rejoinedEscape(dest)` | bot / owner | `botRejoined` cause `escape` | `Safe at {dest}. Recovering.` |
| `rejoinedSummon(stacks)` | bot / summoner | `botRejoined` cause `summon` | `Back — {plural(stacks,"stack")} restored.` ; `stacks = 0` -> `Back.` |
| `rejoinedReload` | bot / owner | `botRejoined` cause `reload` | `Back after the reload.` |
| `rejoinedOwner(owner)` | bot / owner | `botRejoined` cause `owner_returned` | `Welcome back, {owner}.` |
| `rejoinFailed(bot, reason)` | colony / owner (`"all"` if unclaimed) | `botRejoinFailed` cause != `summon` | `Couldn't bring {bot} back: {SNAPSHOT_FAIL_TEXT[reason]}. Its items are kept.` |
| `rejoinDeferred(bot, owner, p)` | colony / `"all"` | notice `rejoinDeferred` | `{bot} stays dismissed until {owner} returns. Anyone can type {p}summon {bot}.` (`owner` = `its owner` if unknown) |
| `rosterRestored(n)` | colony / `"all"` | `rosterRestored`, `n > 0` | `Restored {plural(n,"saved bot")}.` |
| `equipNeed(need, low, chestSet)` | bot / owner | notice `equipNeed` (S3 equipment manager, D24). `chestSet` = `colony.chest !== undefined` at render time. First matching row of the sub-table below | see the sub-table |
| `chestFull` | bot / owner | notice `chestFull` (deposit refused) | `The colony chest is full.` |
| `excludedDropped(count, pos)` | bot / owner | notice `excludedDropped` (S4: items not snapshot-able dropped) | `Dropped {plural(count,"item")} I can't carry offline at {pos}.` |
| `restoreLeftover(count)` | bot / owner | notice `restoreLeftover` | `Couldn't restore {plural(count,"item")} — kept in my snapshot.` |
| `statusAbsent(bot, owner)` | colony / sender | status of a dismissed bot | `{bot}: dismissed` + (owner known ? ` (owner {owner})` : ``) |
| `statusLeaving(bot)` | colony / sender | status of a leaving bot | `{bot}: leaving` |
| `statusRejoining(bot, activity?, issuer?)` | colony / sender | status of a rejoining bot | `{bot}: rejoining` + (task kept ? ` · {activity} for {issuer}` : ``) |

`equipNeed` variants (exact; `{need}` is the `AskNeed` value verbatim: `weapon`, `shield`, `helmet`, `chestplate`, `leggings`, `boots`). The first six are S3's cases; the last two cover `askForMissingGear` (S3 `cfg.askForMissingGear`, default false):

| # | `need` | `low` | `chestSet` | exact text |
|---|---|---|---|---|
| 1 | `weapon` | false | true | `I have no weapon. Please put a sword in the colony chest.` |
| 2 | `weapon` | false | false | `I have no weapon. Please give me a sword.` |
| 3 | not `food` | true | true | `My {need} is almost broken. Please put a spare in the colony chest.` |
| 4 | not `food` | true | false | `My {need} is almost broken. Please give me a spare.` |
| 5 | `food` | any | true | `I am out of food. Please put some in the colony chest.` |
| 6 | `food` | any | false | `I am out of food. Please give me some.` |
| 7 | not `weapon`, not `food` | false | true | `I have no {need}. Please put one in the colony chest.` |
| 8 | not `weapon`, not `food` | false | false | `I have no {need}. Please give me one.` |

There is no a/an article rule any more. Rows are matched top to bottom; `weapon` with `low = true` matches row 3/4.

Shared tables in `messages.ts`:
```ts
const SNAPSHOT_FAIL_TEXT: Record<SnapshotFailReason, string> = {
  busy: "it is busy right now",
  no_snapshot: "no saved inventory found",
  snapshot_unreadable: "its saved inventory couldn't be read",
  spawn_failed: "the spawn failed",
  name_in_use: "the old copy is still leaving; try again",
  owner_offline: "its owner is offline",
  storage_full: "the colony's save space is full",   // D7 / S4b H7; used by dismissFailed, summonFailed and rejoinFailed
  error: "something went wrong",
};
```
Routing of `botNotice` (D9, S4b H1): resolve `name` (and `botId` if given, name wins) to a record in **any presence** (`live`, `leaving`, `rejoining`): dismiss and escape notices (`chestFull`, `excludedDropped`, `restoreLeftover`) are sent while the record is `leaving` or `rejoining`. Bot-voiced notices go `botSay(rec, rec.owner?.id ?? "all", text)`; `botSay` takes the `<Bot-N> ` prefix from `rec.name`, so it needs no body. If no record resolves (the bot is `dismissed` or unknown), bot-voiced notices are dropped (logged by the runtime) except `rejoinDeferred` (always colony voice, never needs a record). Before routing, the per-key limit of §4.9 applies (`noticeMinIntervalTicks` = 200).

**Id coverage.** Every message id used anywhere in §3 to §9 is a key of this table, or is a Phase 1/2 id that already exists in `messages.ts` (`unknownBot`, `offerBusyBot`, `noLongerOnTask`, `reassigned`, `reassignedDone`, `nothingToQueue`, `offerExpired`, `onMyWay`, `botLeftRequeued`, `left`, `pickingUp`, `arrived`, `failed`, `noBots`, `tooMany`, `statusIdle`, `statusBusy`). Test TC-B7-ids (§10) enforces both directions.

Voice rules for the S4/S3 writers: a message that may be sent while the bot has no body (dismissed, rejoining) must be colony voice; the ids marked "colony" above are the only ones S4 may rely on for that.

## 7. `!status` format

Phase 1/2 lines are unchanged **when there is no fresh combat info and presence is live**: `Bot-1: idle`, `Bot-1: going to 1 2 3 for Alex`, `Bot-1: gathering oak_log 7/16 for Alex`, then `Queued: N`.

Template for a live bot with fresh combat info (`status` present and `now - at <= statusStaleTicks`, i.e. age 100 is still shown, age 101 is hidden; D8):

```
{base} · {fight?} · HP {hp}/{maxHp} · food {hunger}
```
- `{base}` = the existing `statusBusy` / `statusIdle` text, unchanged.
- `{fight?}` (omitted when empty), by `status.layer` / `status.option`. **Guard:** the option rows apply only when `status.layer === "combat"`. For layer `task` or `idle` the `{fight?}` segment is omitted unless `recovering` is true (then `recovering`); a stale `attack` option under layer `task` never prints "fighting":

| condition | text |
|---|---|
| `layer === "reflex"` | `avoiding danger` |
| option `attack` | `fighting {mob}` (no target: `fighting`) |
| option `shield` | `blocking {mob}` (no target: `blocking`) |
| option `back_off` | `backing off {mob}` (no target: `backing off`) |
| option `retreat` | `retreating from {mob}` (no target: `retreating`) |
| option `flee` | `fleeing from {mob}` (no target: `fleeing`) |
| option `eat` | `eating` |
| option `escape_rejoin` | `escaping` (the combat/status view of S1; the roster line `rejoining` of a bot already offline is separate) |
| `recovering` and nothing above applied | `recovering` |
| option `resume_task` / `idle` and not recovering | omitted |

  `{mob}` = `shortId(status.target.typeId)` (`zombie`, `skeleton`). Only the first matching row is used (reflex first, then option rows, then recovering).
- `HP {hp}/{maxHp}` = `Math.round` of both (`HP 12/20`); `food {hunger}` = `Math.round(hunger)`.
- Segments are joined with ` · ` (space, U+00B7, space).

Examples:
- `Bot-1: gathering oak_log 7/16 for Alex · fighting zombie · HP 12/20 · food 15`
- `Bot-2: idle · HP 20/20 · food 20`
- `Bot-3: defending 100 64 200 (r16) for Alex · retreating from creeper · HP 6/20 · food 9`
- `Bot-1: gathering oak_log 7/16 for Alex · recovering · HP 8/20 · food 14`
- `Bot-2: idle · escaping · HP 5/20 · food 12` (layer `combat`, option `escape_rejoin`)
- `Bot-3: gathering oak_log 2/16 for Alex · HP 20/20 · food 20` (layer `task` with a stale option `attack`: no fight segment)
- non-live: `Bot-4: dismissed (owner Alex)`, `Bot-4: leaving`, `Bot-4: rejoining · gathering oak_log 7/16 for Alex`

`!status <bot>` (single bot, fresh info) adds a second reply line:
`{bot} gear: {weapon} · armor {n}/4 · {shield} · {k} food` where `weapon` = `shortId(weaponTypeId)` or `no weapon`, `shield` = `shield` or `no shield`, `n` = `armorPieces`, `k` = `foodCount`. Example: `Bot-1 gear: iron_sword · armor 3/4 · shield · 5 food`. (`!status` without a name never prints gear lines.)

Order of lines for `!status`: one line per roster entry by `seq` (live, leaving, rejoining, dismissed), then `Queued: N`. With an empty roster: `No bots yet. Type !spawn.`.

The S1 threat/escape details beyond these fields are not part of `BotStatusView` (D25), so there is no separate `threat:` segment: the fight segment (`fighting zombie`, `retreating from creeper`, `escaping`) is the threat display.

New `msg` helpers: `statusCombat(base, segments[])` (joins), `statusGear(bot, ...)`; the segment builder lives in `messages.ts` as `combatSegments(status, now)`, pure and unit-tested.

## 8. Help text (`help.ts`)

`helpText()` (no topic) stays header + one usage line per spec, so it now also lists:
```
!defend [radius|stop] [bots]
!home [set]
!summon [bot|all]
!dismiss [bot|all]
!recall
```
(in `COMMAND_SPECS` order, after `!chest`). `!help <cmd>` prints usage, description (§3.2), then the extra lines in `extraHelp`:

| Topic | Extra lines (exact; `{p}` = prefix) |
|---|---|
| `defend` | `Bots guard players and each other and only attack mobs.` / `Example: {p}defend 24 2 (two bots guard a 24-block radius around you).` |
| `home` | `Escaping bots, summons and {p}recall use the home. Without one, bots go to you.` |
| `summon` | `Example: {p}summon Bot-1, or {p}summon all for every bot you own.` |
| `dismiss` | `Dismissed bots keep their items and still count toward the bot limit.` |
| `recall` | `Drops your bots' current tasks. Bots busy for another player are skipped.` |

## 9. Config keys (S5)

The `colony` group (`ColonyConfig`) is listed in PHASE3-SPEC §4 `Phase3Config` (the Lead adds `colony: ColonyConfig` there; the contract writer generates `config.ts` from it).

| Key (in `ColonyConfig` / `DEFAULT_CONFIG`) | Default | Unit | Meaning |
|---|---|---|---|
| `statusStaleTicks` | 100 | ticks | A pushed `botStatus` is shown while `now - at <= statusStaleTicks`; older is hidden |
| `statusPushTicks` | 20 | ticks | Minimum spacing between `botStatus` events per bot (runtime throttle for changes) |
| `statusHeartbeatTicks` | 80 | ticks | Re-push the current status this often even when unchanged (must be < `statusStaleTicks`) |
| `noticeMinIntervalTicks` | 200 | ticks | Core drops a `botNotice` with the same bot name and id that was delivered less than this long ago (10 s) |
| `flowTimeoutTicks` | 600 | ticks | `leaving` / `rejoining` states with no completion event revert after this (30 s) |
| (existing) `maxBots` | 3 | bots | Now counts live + dismissed + pending bots |
| (existing) `offerTtlTicks` | 600 | ticks | Also applies to pinned offers |

Constants (parser has no config access), exported from `src/core/commands/specs.ts` and re-exported by `commands/index.ts`: `DEFEND_LIMITS = { minRadius: 4, maxRadius: 48, defaultRadius: 16 }`.

## 10. Test cases (TC-B6 / TC-B7)

Parser (`test/commands-p3.test.ts`): every row of §3.3 (error + usage line); happy paths: `!defend` -> radius 16 count 1; `!defend 24 3`; `!defend STOP`; `!home`, `!home SET`; `!summon`, `!summon all`, `!summon ALL`, `!summon @Bot-1`, `!dismiss Bot-2`; `!recall`; `COMMAND_SPECS` order; derived usage lines of §3.2; `/colony:c defend 24 3` join; extend the "covers every command kind" list; `helpText()` lists the five new usages.

Colony (`test/colony-p3.test.ts`): owner set by spawn, claimed by first assign, never overwritten; defend allocation (idle first, own non-defend before own defend before others'), offer/override/queue with defend, `!defend stop` scope, defend requeue on preempt; `!home` set/show/none and `persistMeta` emission count (exactly one per changing event, none otherwise); dismiss: own, idle, other's busy -> pinned offer -> override requeues the victim task, `all` skips others' busy, `botDismissed` cause texts, `botDismissFailed`, timeout; summon: dismissed -> `summonBot` effect + `rejoining` -> `botRejoined`/`botRejoinFailed`/timeout, live bot walk, pinned summon; escape: `botEscaped` keeps task, `botRejoined` re-`assign`s with `delivered` folded and `haulDropped` folded (H3 example: 3 + min(12, 12) = 15), non-gather tasks re-assigned unchanged, duplicate `botRejoined` for a live name ignored, `!stop` while rejoining clears the task, failed escape rejoin requeues; `maxBots` counts absent; `nameReserved`; `allDismissed`/`tooManyAway`; `rosterRestored`; `botNotice` routing (any presence, H1) and the eight `equipNeed` variants of §6 (exact strings, chest set / not set, `low`, food); `botNotice` rate limit (second identical notice within 200 ticks dropped, after 200 delivered); recall (home vs sender, drops counted, skipped busy-for-other); status lines (all templates in §7, staleness at age 100 shown / 101 hidden, layer guard, gear line, heartbeat refresh); snapshot fields (`presence`, `owner`, `home`, non-live `id`). Phase 1/2 tests pass unchanged.

B7: `test/help-p3.test.ts` (new file; `test/help.test.ts` stays untouched and passes unchanged) extra-line cases for the five topics; `PLAYTEST.md` Phase 3 manual list: `!home set` then escape/recall destination, dismiss then summon from far away, someone else's busy bot dismiss -> override, reload with owner online/offline, `!defend` with 2 bots vs a zombie, `!status` combat line.

Additional cases (each: input -> expected message id and state change):
- `TC-B6-offer-expiry`: `!dismiss Bot-1` on a bot busy for Bob creates a pinned offer at tick 0; tick sweep at `offerTtlTicks` (600) -> `offerExpired` to the requester, `s.offers` has no entry for the requester, Bot-1 still live and on Bob's task; `!override` at tick 601 -> `nothingToOverride`.
- `TC-B6-defend-no-home`: no home set; Alex `!defend` with an idle bot -> `defending` ack (`Defending {pos} (radius 16).`), `assign` effect with a `defend` task, no error; then `!recall` -> goto `sender.pos`, `recalling(1, "you", 1)`.
- `TC-B6-dismiss-all-escaping`: Bot-1 live (Alex), Bot-2 `rejoining` after `botEscaped`; Alex `!dismiss all` -> only Bot-1 gets `dismissBot`, reply `dismissing(Bot-1)`; with only Bot-2 present -> `dismissNone`; `!dismiss Bot-2` -> `botAway(Bot-2, "rejoining")` = `Bot-2 is rejoining.`; no state change on Bot-2.
- `TC-B6-owner-leaves`: Alex owns Bot-1 and goes offline (no event reaches the core; owner is a game-side fact): `rec.owner` unchanged (no transfer); Bob `!dismiss all` skips it (`isMine` false), Bob `!summon Bot-1` on a dismissed Bot-1 is allowed (D3); `rosterRestored` with the owner offline leaves the bot `dismissed` and S4's `rejoinDeferred` notice renders `Bot-1 stays dismissed until Alex returns. Anyone can type !summon Bot-1.`
- `TC-B6-recall-unloaded`: home `(12, 64, 3)`; Bot-1 live but far/unloaded; `!recall` -> goto `(12.5, 64, 3.5)`; then `taskReport failed unreachable` -> bot-voiced `Couldn't reach 12.5 64 3.5: no path.`; Bot-1 idle afterwards.
- `TC-B6-dismiss-during-escape`: `botDismissFailed { reason: "busy" }` for a bot whose escape started first -> `Couldn't dismiss Bot-1: it is busy right now.`; record back to `live` (Q11).
- `TC-B6-late-completions`: `botDismissed` after the leaving timeout (task requeued at the front, `botLeftRequeued`); late `botRejoinFailed` ignored; late `botDismissFailed` ignored.
- `TC-B7-ids`: the set of message-id keys in `messages.ts` equals the ids in the §6 table plus the Phase 1/2 ids listed under "Id coverage"; every id string appearing in §3 to §9 of this file is in that set.
- `TC-B7-help-lists-all`: `helpText()` contains each of the five new usage lines of §8 and every Phase 1/2 usage line, in `COMMAND_SPECS` order.
- `TC-B7-parse-error-usage`: one case per row of §3.3 (`!defend 3`, `!defend stop 2`, `!defend 16 0`, `!defend 16 2 9`, `!home foo`, `!summon @@x`, `!recall now`): reply is the exact error text followed by the usage line of that command.
- `TC-B7-status-fight`: the layer guard (stale `attack` under layer `task` prints no fight segment), the `escaping` example, age 100 shown / 101 hidden.

## 11. Open questions (chosen fallbacks)

| # | Question | Fallback chosen |
|---|---|---|
| Q1 | `Sender` has no dimension; `!home set` and `summonBot` need one. | Optional `Sender.dimensionId`, default `"minecraft:overworld"`. Contract writer + `sender.ts` fill it; GameTest senders may omit it. |
| Q2 | `!recall` / escape to a home in another dimension than the bot. | Not special-cased: goto fails with `no path`; S4's escape flow spawns in the home's dimension itself. |
| Q3 | Should a request auto-summon dismissed bots when too few are live? | No. `tooManyAway` tells the player to `!summon`. |
| Q4 | Default bot count for `!defend`. | 1, like `goto`/`gather`; `!defend 16 3` for more. |
| Q5 | Where are queued tasks after Save & Quit? | Lost (Phase 9). `rosterRestored` restores only chest, home, owners and the dismissed roster. |
| Q6 | `!recall` prints one `Arrived at x y z.` per bot. | Accepted noise in Phase 3; a quiet-arrival flag can be added later. |
| Q7 | Bot dies (`botRemoved` reason `died`). | Roster entry and owner are removed as in Phase 1 (`left (died)`); S4 deletes its stored snapshot. No auto-respawn in Phase 3. |
| Q8 | Is the entity id stable across rejoin? | Assumed **no**. Everything is keyed by name across a rejoin; `botRejoined` carries the new `botId`. If S4 finds ids are stable, nothing changes. |
| Q9 | Idle-dismissed bots whose owner never returns. | Stay `dismissed`; anyone may `!summon` them. They keep a `maxBots` slot (D7). |
| Q10 | Two players race to dismiss/summon the same bot. | Second command sees `leaving`/`rejoining` and gets `botAway`. |
| Q11 | `!dismiss` on a bot whose escape the controller has decided but `botEscaped` has not arrived yet (the core still sees `live`). | No new message id. The `dismissBot` effect reaches S4's service, which refuses with `busy` while an escape flow is active (S4b L1); the core gets `botDismissFailed { reason: "busy" }`, reverts the record to `live` and replies `Couldn't dismiss {bot}: it is busy right now.` Once `botEscaped` has arrived the record is `rejoining` and `!dismiss <bot>` gives `botAway` (`{bot} is rejoining.`); `all` skips it. |

---

## Revision log (review pass 1)

Decisions applied: D7 (`storage_full` in `SnapshotFailReason` and `SNAPSHOT_FAIL_TEXT`), D21 H1 (notice routing by name in any presence), H3 (`haulDropped` fold and optional event fields), H7 (text `the colony's save space is full`), D24 (`equipNeed { need, low }` with S3's six wordings plus two), D25 (S5's `BotStatusView` shape; S1 must match), D26 (core is the single task owner on escape rejoin; carry has no task), D8 as binding (`<=` 100).

S5-commands--completeness.md
- #1: changed (D24 wins: one `equipNeed { need, low }` notice with eight rendered variants instead of `ask_*` ids; S3 already emits it and has no chat text)
- #2: applied (`TC-B7-ids` both directions; "Id coverage" paragraph lists the Phase 1/2 ids; every new id was already in the table)
- #3: skipped (D25 fixes the `BotStatusView` fields and has no threat count, distance or `escapePending`; the fight segment and the `escaping` example are the threat display; `TC-B7-status-fight` added)
- #4: changed (sentence now: `BotStatusView` is defined in S1 §1 and S1 must use exactly S5's names, D25 / consistency #3)
- #5: applied (all seven test cases added to §10, plus `TC-B6-dismiss-during-escape` and `TC-B6-late-completions`)
- #6: changed (Q11 added with a fallback, but no `dismiss_blocked_escape` id: S4b L1 already refuses with `busy` while an escape flow is active, rendered by `dismissFailed`; after `botEscaped` `botAway` applies)
- #7: applied (`noticeMinIntervalTicks` = 200 in §9, state `lastNotice` in §4.9, cited in §6 routing; flat key name instead of `notices.minIntervalTicks` to match `ColonyConfig`)

S5-commands--consistency.md
- #1: applied (D24: `AskNeed` and the new `BotNotice.equipNeed` in §5, eight-row variant table in §6, test text "six variants" now eight; message id is the single `equipNeed(need, low, chestSet)`)
- #2: applied (§4.7 single-owner sentence; per D26 the carry holds `brainState`, `recover`, `objectiveItemIds`, `stats` only)
- #3: applied (S1 must define exactly the listed names; `recovering` provenance stated)
- #4: applied (`OptionKind`, `LayerKind` imported)
- #5: applied (`test/help-p3.test.ts`; the PHASE3-SPEC B7 row is the Lead's)
- #6: applied (no change in S5; `HomeRef` stays)
- #7: changed (S5 §9 notes that the `colony` group is listed in PHASE3-SPEC §4; adding it there is the Lead's)

S5-commands--game-api.md: no findings.

S5-commands--logic.md
- #1: changed (D26 wins: a rejoin does re-emit `assign`, so "never emits" is rejected; the idempotence half is applied: an executor with the same task id is replaced silently, never run twice)
- #2: applied (`statusHeartbeatTicks` = 80, §0 D8, §5, §9)
- #3: skipped (D25 lists `recovering` in the binding `BotStatusView`; its provenance is defined instead)
- #4: changed (late completions are applied when they report a physical fact: `botDismissed` and `botRejoined` are handled as normal, with the task requeued per precision #13; late failures are ignored and logged; an `expired` flag would orphan a real body)

S5-commands--precision.md
- Skipped as already decided (reviewer note): D6, D7, D11.
- #1: applied (layer guard in §7, example, test)
- #2: applied (`<=` in §0, §5 comment via §7, §9, tests)
- #3: applied (`+0.5` rule in §2 and §4.8 with an example)
- #4: applied (`"stopped"` in both summon paths)
- #5: applied (§4.7 step 4: drop silently only for gather)
- #6: applied (duplicate `botRejoined` guard)
- #7: applied (`Unknown home action '{echo}'. Use {p}home or {p}home set.`)
- #8: applied (`/^[0-9]+$/` rule, `toLowerCase()` comparisons)
- #9: applied (`parseArg` to `Values` mapping)
- #10: applied (`BotView.id` comment)
- #11: applied (checked `src/core/colony/messages.ts`: `fmtPos` prints one decimal when not whole; rule and a worked example added, examples keep whole coordinates)
- #12: skipped (obsolete after D24: `{need}` is the plain `AskNeed` word and there is no article)
- #13: applied (late `botDismissed` requeues the task at the queue front and sends `botLeftRequeued`)
