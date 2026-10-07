# Bot Colony: how to use it and what to test

Phase 1 build. You give bots orders in chat with `!` commands, and they walk where you send them and reply. That's all Phase 1 does: no chests, no building, no combat. The point is to prove spawning, chat commands and movement work on a normal survival world.

---

## 1. Install

**Requires Minecraft Bedrock 1.26.5x.** The pack is pinned to that version's script APIs and won't load on other versions.

1. Double-click `bot-colony.mcpack`. Minecraft opens and says **Bot Colony BP** was imported.
2. To install a newer build later, delete the old copy first (Settings → Storage), because a re-import with the same version number is refused.

## 2. Make a test world

1. **Create New World.**
2. **Experiments → Beta APIs: ON.** This is required.
3. **Cheats: OFF.** This is the setting we're testing.
4. **Behavior Packs → Bot Colony BP → Activate.**
5. Create it. A **flat** world makes the chunk test easier.

> Beta APIs permanently turns off achievements for that world. Use a throwaway world, not your main survival world.

**Recommended:** turn on **Settings → Creator → Content Log GUI**. It shows errors on screen, which is the fastest way to see why something isn't working.

**Friends:** they join your world normally. The pack downloads to them automatically, and the bots run on your game.

## 3. Commands

Type these in chat. `!` messages are hidden from everyone else, and replies to your commands are visible only to you.

| Command | What it does |
|---|---|
| `!help` / `!help goto` | List commands, or show details for one |
| `!spawn` / `!spawn Bob` | Spawn a bot (default names Bot-1, Bot-2, …). Max 3 bots |
| `!come` / `!come 2` | Bring 1 (or 2) bots to you |
| `!goto x y z [count]` | Send bots to a spot. `~` means "relative to me", e.g. `!goto ~10 ~ ~` = 10 blocks east |
| `!status` / `!status Bot-1` | What each bot is doing, plus how many tasks are queued |
| `!stop` / `!stop Bot-1` | Stop all your tasks, or one bot |
| `!override` / `!queue` | Answer to a "bots are busy" reply (see below) |

**When every bot is busy**, you get a reply such as *"Need 1 bot: 0 free, 1 busy. Bot-1 is going to … for Alex. Reply !override to take over or !queue to wait (expires in 30s)."*
- `!override` takes the bot. The other player is told, and their task is queued to resume later.
- `!queue` waits your turn.
- If you don't answer within 30 s, the offer expires.

**Fallback:** if `!` commands get no reply at all, the slash command takes the same text: `/colony:c come`, `/colony:c goto 10 64 10`, `/colony:c status`.

**Things that are normal in Phase 1:**
- Commands sent less than 1 s apart get "Slow down…".
- A failed task says why ("no path", "timed out", "I died") and isn't retried.
- A bot that dies respawns by itself.
- Bots are **not** re-linked after you quit and reopen the world. Old bodies may stay around but won't respond, and that's expected until Phase 5. Use a throwaway world.

---

## 4. What you need to test

Work through these in order and tick each box. Anything in **Record** goes back to me. The four probes print a line like `[probe] spawn: RESULT PASS - …`. Copy those lines exactly; a screenshot is fine too.

### A. Does it load? (1 min)
- [ ] About 3 s after joining, a `[probe] startup` line appears in chat.
- [ ] `!help` shows the command list.

If both fail, go to Troubleshooting below. Nothing else will work until this does.
**Record:** the startup line, and any red errors in the Content Log.

### B. Basic commands (3 min)
- [ ] `!spawn` → "Spawning Bot-1…", then "Bot-1 joined.", and a player-like bot appears next to you.
- [ ] `!come` (walk ~20 blocks away first) → "On my way…", it walks to you, then "Arrived at x y z."
- [ ] `!goto ~10 ~ ~` → it walks 10 blocks east.
- [ ] `!goto ~ ~ ~2` → it arrives (a very short hop shouldn't fail with "no path").
- [ ] `!status` while it's walking → "Bot-1: going to x y z for <you>".
- [ ] `!stop` mid-walk → it stops and says "Stopped 1 task…".
- [ ] Your `!` messages don't show in chat for other players (check with a friend if you can).

**Record:** anything that didn't match, especially if the bot walks to the **wrong place**. Note where it went compared with where you sent it.

### C. The four probes: the most important part (10 min)
These answer the questions the rest of the project depends on. Each probe prints PASS, FAIL or INCONCLUSIVE. All results are useful, including FAIL.

- [ ] **Spawn:** stand on flat open ground and run `/colony:probe spawn`. *Question: can bots spawn with cheats off, and do they read coordinates correctly?*
- [ ] **Chat:** run `/colony:probe chat`, then type `!probe-chat` within 30 s. *Question: are `!` commands hidden from chat properly?* Also note whether `!probe-chat` showed up in chat. The "Unknown command" reply is expected.
- [ ] **Chunks:** on a flat world (or with clear ground to the east), run `/colony:probe chunks` and **don't move** for up to 2 minutes. A bot walks 340 blocks away. *Question: do bots keep working when you're far away?* Afterwards, check whether the probe bot is gone.
- [ ] **Reload:** `!spawn` a bot, run `/colony:probe reload`, then **Save & Quit**, reopen the world, wait 5 s and run `/colony:probe reload` again. *Question: do bots survive a reload?*

**Record:** the `RESULT` line and the `facts:` line before it, for each probe.

### D. Multiplayer collision (5 min, needs a friend)
- [ ] You: `!spawn`, then `!goto` somewhere far so the bot is busy.
- [ ] Friend: `!come` → they get the "busy" reply naming your bot and you.
- [ ] Friend: `!override` → the bot turns toward them, and you get "Bot-1 was reassigned by <friend>; your task … is queued." When the bot finishes, it comes back to your task ("Picking up your queued task…").
- [ ] Repeat, but the friend types `!queue` instead → "Queued 1 task at position 1."
- [ ] Repeat, but the friend doesn't answer → after 30 s, "Your pending request expired."
- [ ] Friend: `!stop Bot-1` while it's on your task → they're asked to `!override`. If they do, you get "Bot-1 was stopped by <friend>."

**Record:** any step where the wrong person got a message, or no one did.

### E. Edge checks (5 min)
- [ ] Slash fallback: `/colony:c status` and `/colony:c goto ~5 ~ ~` both get bot or colony replies, not a "syntax error".
- [ ] Quoted fallback: `/colony:c "goto ~3 ~ ~"` also works.
- [ ] Death: give a bot a long `!goto`, then kill it on the way (hit it yourself, or let mobs get it at night). Expect "Couldn't reach …: I died.", and the bot respawns. It should **not** say "Bot-1 left (gone)". (Sending it into lava may just give "no path", because the pathfinder avoids lava.)
- [ ] Bad input: `!goto 0 400 0` → a "Y must be from -64 to 320" reply, with no crash and no bot movement.

**Record:** anything that broke.

### F. Optional: automated GameTests (5 min)
These need a **separate** world: flat, Beta APIs on, **cheats ON**, pack active, and **no** bots spawned. Stand on open ground and run `/gametest runset colony`.

**Record:** which of the 6 tests passed or failed (`goto_flat`, `goto_unreachable`, `override_flow`, plus each one's `_abs` version). A mismatch between a test and its `_abs` twin is useful information, not a bug report.

---

## 5. What to send back

Paste this filled in:

```
Game version:            Platform:
A load:      ok / failed (+ errors)
B basics:    ok / notes
C spawn:     [probe] ... RESULT ...
C chat:      [probe] ... RESULT ...   shown in chat? yes/no
C chunks:    [probe] ... RESULT ...   probe bot gone afterwards? yes/no
C reload:    [probe] ... RESULT ...
D collision: ok / notes (or skipped)
E edges:     ok / notes
F gametests: passed: ...  failed: ...  (or skipped)
```

The most useful results are C (all four probes) and B (whether bots go to the right place). With those I can close Phase 1 and plan Phase 2.

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No startup line, `!help` does nothing, `/colony:c` is "unknown command" | Beta APIs is off, the pack isn't **active** on this world, or the game isn't 1.26.5x. Check the Content Log for "module not found / version not supported" |
| `/colony:c help` works but `!` commands don't | Chat hook isn't firing. Run `/colony:probe chat` and use `/colony:c` meanwhile |
| `!spawn` says "Couldn't spawn…" | Copy the full message. It's the key result for the spawn probe |
| Bot walks to the wrong place | Note target vs. where it went. This is the coordinate question the spawn probe checks |
| Still running old code after updating | Delete the old pack in Settings → Storage, then re-import |
