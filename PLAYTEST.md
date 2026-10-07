# Bot Colony: how to use it and what to test

Phase 2 build (pack version **0.2.0**). You give bots orders in chat with `!` commands. Phase 1 bots could walk where you sent them; Phase 2 bots are **gatherers**: they find logs, stone, dirt, sand or gravel near you, break the blocks themselves over real time, pick up the drops and put them in a colony chest you choose. Everything runs under survival rules: no item is created, except when a bot crafts (the exact ingredients are used up). No building or combat yet.

Phase 1 (sections 4A–C and E) already passed. Phase 2 tests are §4 G–Q. §4 D (multiplayer) and the multiplayer half of §4 O are still deferred until a second player is around.

---

## 1. Install

**Requires Minecraft Bedrock 1.26.5x.** The pack is pinned to that version's script APIs and won't load on other versions.

1. **Delete the old 0.1.0 pack first:** Settings → Storage → Behavior Packs → **Bot Colony BP** → delete. Otherwise the game may keep running the Phase 1 code.
2. Double-click `bot-colony.mcpack`. Minecraft opens and says **Bot Colony BP** was imported.
3. On the world, check that the active pack is the new one (Edit world → Behavior Packs; the description reads "Phase 2 gatherers").
4. To install a newer build later, delete the old copy the same way, because a re-import with the same version number is refused.

## 2. Make a test world

1. **Create New World.**
2. **Experiments → Beta APIs: ON.** This is required.
3. **Cheats: OFF.** This is the setting we're testing.
4. **Behavior Packs → Bot Colony BP → Activate.**
5. Create it. For Phase 1 a **flat** world was easiest. For Phase 2 use a **normal (default terrain) world**, because bots need real trees, stone, sand and gravel. See §4 G for what the spot should look like.

> Beta APIs permanently turns off achievements for that world. Use a throwaway world, not your main survival world.

**Recommended:** turn on **Settings → Creator → Content Log GUI**. It shows errors on screen, which is the fastest way to see why something isn't working.

**Friends:** they join your world normally. The pack downloads to them automatically, and the bots run on your game.

## 3. Commands

Type these in chat. `!` messages are hidden from everyone else, and replies to your commands are visible only to you.

| Command | What it does |
|---|---|
| `!help` / `!help gather` | List commands, or show details for one |
| `!spawn` / `!spawn Bob` | Spawn a bot (default names Bot-1, Bot-2, …). Max 3 bots |
| `!come` / `!come 2` | Bring 1 (or 2) bots to you |
| `!goto x y z [count]` | Send bots to a spot. `~` means "relative to me", e.g. `!goto ~10 ~ ~` = 10 blocks east |
| `!chest set` | Make the chest you're **looking at** (or standing next to) the colony chest. Bots deliver there |
| `!chest` | Show where the colony chest is and what's in it |
| `!gather <item> [amount] [bots]` | Gather an item into the colony chest. Amount 1–256 (default 16), split across 1–16 bots. `!gather logs`, `!gather oak_log 32 2`, `!gather cobblestone 8` |
| `!status` / `!status Bot-1` | What each bot is doing (with gather progress), plus how many tasks are queued |
| `!stop` / `!stop Bot-1` | Stop all your tasks, or one bot |
| `!override` / `!queue` | Answer to a "bots are busy" reply (see below) |

**Items for `!gather`:** `logs` (any tree) or one species (`oak_log`, `birch_log`, `spruce_log`, `jungle_log`, `acacia_log`, `dark_oak_log`, `mangrove_log`, `cherry_log`, `pale_oak_log`), `cobblestone` (mined from stone), `dirt` (from dirt or grass), `sand`, `gravel`. Aliases: `wood` = `logs`, `stone` / `cobble` = `cobblestone`, `grass` = `dirt`. `minecraft:oak_log` also works.

**Tools:** a bot holds the best matching tool it has (axe for logs, pickaxe for stone, shovel for dirt/sand/gravel). Stone needs a pickaxe: if the bot has none it takes one from the colony chest, and if the chest has none it **crafts a wooden pickaxe** (logs → planks → sticks → crafting table, which it places on the ground, → pickaxe), using logs from its inventory, the chest, or ones it chops by hand. Axes and shovels are optional: a bot that's at the chest anyway and has none takes one.

**When every bot is busy**, you get a reply such as *"Need 1 bot: 0 free, 1 busy. Bot-1 is gathering oak_log 3/16 for Alex. Reply !override to take over or !queue to wait (expires in 30s)."*
- `!override` takes the bot. The other player is told, and their task is queued to resume later (a gather task resumes with what was already delivered).
- `!queue` waits your turn.
- If you don't answer within 30 s, the offer expires.
- If the busy bots are running **your own** tasks, there's no offer: your new command simply replaces your old task.

**Fallback:** if `!` commands get no reply at all, the slash command takes the same text: `/colony:c come`, `/colony:c gather oak_log 16 2`, `/colony:c chest set`.

**Things that are normal:**
- Commands sent less than 1 s apart get "Slow down…".
- A failed task says why ("no path", "timed out", "I died", "nothing left to gather nearby", …) and isn't retried.
- A bot that dies respawns by itself (without its items).
- Bots only gather within about **16 blocks** (horizontally, ±8 up/down) of where you stood when you gave the command, and only blocks they can reach from the ground. They don't dig tunnels or build up, so the top logs of tall trees are left floating. A big tree gives fewer logs than it has.
- Bots don't put saplings, apples or flint in the chest; those stay in the bot's inventory.
- Bots and the colony chest setting are **not** kept after you quit and reopen the world. Old bot bodies don't come back, and you need `!spawn` and `!chest set` again. That's expected until the persistence phase (Phase 8).

---

## 4. What you need to test

Work through these in order and tick each box. Anything in **Record** goes back to me. Phase 1 probes print a line like `[probe] spawn: RESULT PASS - …`. Copy those lines exactly; a screenshot is fine too.

Phase 1 sections **A–C and E already passed**; after installing 0.2.0, just redo **A** and the first two lines of **B** as a quick check that nothing broke. **D** stays deferred.

### Phase 1 (done)

#### A. Does it load? (1 min)
- [ ] About 3 s after joining, a `[probe] startup` line appears in chat.
- [ ] `!help` shows the command list, now including `!gather <item> [amount] [bots]` and `!chest [set]`.

If both fail, go to Troubleshooting below. Nothing else will work until this does.
**Record:** the startup line, and any red errors in the Content Log.

#### B. Basic commands (3 min)
- [ ] `!spawn` → "Spawning Bot-1…", then "Bot-1 joined.", and a player-like bot appears next to you.
- [ ] `!come` (walk ~20 blocks away first) → "On my way…", it walks to you, then "Arrived at x y z."
- [ ] `!goto ~10 ~ ~` → it walks 10 blocks east.
- [ ] `!goto ~ ~ ~2` → it arrives (a very short hop shouldn't fail with "no path").
- [ ] `!status` while it's walking → "Bot-1: going to x y z for <you>".
- [ ] `!stop` mid-walk → it stops and says "Stopped 1 task…".
- [ ] Your `!` messages don't show in chat for other players (check with a friend if you can).

**Record:** anything that didn't match, especially if the bot walks to the **wrong place**. Note where it went compared with where you sent it.

#### C. The four probes (done: spawn, chat, chunks PASS; reload FAIL as expected)
These answer the questions the rest of the project depends on. Each probe prints PASS, FAIL or INCONCLUSIVE. All results are useful, including FAIL.

- [ ] **Spawn:** stand on flat open ground and run `/colony:probe spawn`. *Question: can bots spawn with cheats off, and do they read coordinates correctly?*
- [ ] **Chat:** run `/colony:probe chat`, then type `!probe-chat` within 30 s. *Question: are `!` commands hidden from chat properly?* Also note whether `!probe-chat` showed up in chat. The "Unknown command" reply is expected.
- [ ] **Chunks:** on a flat world (or with clear ground to the east), run `/colony:probe chunks` and **don't move** for up to 2 minutes. A bot walks 340 blocks away. *Question: do bots keep working when you're far away?* Afterwards, check whether the probe bot is gone.
- [ ] **Reload:** `!spawn` a bot, run `/colony:probe reload`, then **Save & Quit**, reopen the world, wait 5 s and run `/colony:probe reload` again. *Question: do bots survive a reload?*

**Record:** the `RESULT` line and the `facts:` line before it, for each probe.

#### D. Multiplayer collision (5 min, needs a friend; deferred)
- [ ] You: `!spawn`, then `!goto` somewhere far so the bot is busy.
- [ ] Friend: `!come` → they get the "busy" reply naming your bot and you.
- [ ] Friend: `!override` → the bot turns toward them, and you get "Bot-1 was reassigned by <friend>; your task … is queued." When the bot finishes, it comes back to your task ("Picking up your queued task…").
- [ ] Repeat, but the friend types `!queue` instead → "Queued 1 task at position 1."
- [ ] Repeat, but the friend doesn't answer → after 30 s, "Your pending request expired."
- [ ] Friend: `!stop Bot-1` while it's on your task → they're asked to `!override`. If they do, you get "Bot-1 was stopped by <friend>."

**Record:** any step where the wrong person got a message, or no one did.

#### E. Edge checks (5 min)
- [ ] Slash fallback: `/colony:c status` and `/colony:c goto ~5 ~ ~` both get bot or colony replies, not a "syntax error".
- [ ] Quoted fallback: `/colony:c "goto ~3 ~ ~"` also works.
- [ ] Death: give a bot a long `!goto`, then kill it on the way (hit it yourself, or let mobs get it at night). Expect "Couldn't reach …: I died.", and the bot respawns. It should **not** say "Bot-1 left (gone)". (Sending it into lava may just give "no path", because the pathfinder avoids lava.)
- [ ] Bad input: `!goto 0 400 0` → a "Y must be from -64 to 320" reply, with no crash and no bot movement.

**Record:** anything that broke.

#### F. Optional: automated GameTests
Superseded by §4 Q, which runs the Phase 1 and Phase 2 GameTests together.

### Phase 2: gatherers

Replies below are written as you'll see them: `[Colony] …` lines come from the colony, `<Bot-1> …` lines from a bot. `x y z` is a real position and `<you>` is your name.

#### G. Set up the test spot (10 min)
Find (or make) one spot in **survival** where all of this is within about **12 blocks** of where you'll stand:

- [ ] **Trees:** at least 3–4 small trees, ideally **oak** (the hand tests use `oak_log`; birch is fine if you use `birch_log` or `logs` instead). Small trees are best: bots only reach logs about 5 blocks above the ground.
- [ ] **Exposed stone:** a hillside, cliff or cave mouth with bare stone the bot can walk up to, about 10+ blocks of it. No natural stone nearby? Dig a **walk-in** pit: a 1-wide staircase down 3–4 blocks into a 4×4 room with stone walls and floor. A sealed vertical shaft won't work (bots don't dig or climb out).
- [ ] **Sand and gravel:** a beach or riverbank with both, if you can. Dirt/grass is everywhere.
- [ ] **A chest** (8 planks) placed on the ground in the open, with free space around it so a bot can stand next to it. Keep a **second chest** in your inventory for test I.
- [ ] **Tools for the bot:** a **stone pickaxe** and a **stone axe** (or wooden), kept in **your** inventory for now. You'll put them in the chest during the tests.
- [ ] Some **logs** (5–10) in your inventory, and a stack of **any junk blocks** (dirt is fine) for the chest-full test.
- [ ] Daytime, and nothing hostile nearby. Mobs killing bots ruins the results (except in test O, where it's the point).
- [ ] `!spawn` one bot. You'll add a second one in test M.

**Record:** what's around the spot (tree species, natural stone or dug pit, beach or not).

#### H. Colony chest (3 min)
- [ ] Before setting it: `!chest` → "[Colony] No colony chest yet. Look at a chest and type !chest set."
- [ ] Before setting it: `!gather logs` → the same "No colony chest yet…" reply, and the bot doesn't move.
- [ ] **By looking:** stand 3–4 blocks from the chest, put your crosshair on it, `!chest set` → "[Colony] Colony chest set to x y z." Check x y z is the chest's block (turn on Settings → Game → Show Coordinates).
- [ ] **By standing near:** look at the sky or the ground, stand right next to the chest, `!chest set` → the same "Colony chest set to x y z." with the same position.
- [ ] **None found:** walk 10+ blocks away from any chest, look at the sky, `!chest set` → "[Colony] No chest found. Look at a chest (or stand next to one) and type !chest set." The old chest stays the colony chest (`!chest` still shows it).
- [ ] `!chest` with the chest empty → "[Colony] Colony chest at x y z: empty."
- [ ] Put a few logs and a dirt block in, `!chest` → "[Colony] Colony chest at x y z: 5 oak_log, 1 dirt" (largest count first). Take them back out afterwards.
- [ ] `!help chest` and `!help gather` → a usage line, a description and the extra lines (gather: item list + aliases + an example; chest: how to set it).

**Record:** any mismatch, and whether "by looking" and "by standing near" picked the same chest.

#### I. Do bots pick up drops? The key risk (5 min)
Everything in Phase 2 depends on this, and it hasn't been tested yet: the code assumes a survival bot picks up items it walks over, like a player. There's no other way for it to collect drops.

1. Empty colony chest, bot next to you, a tree within ~10 blocks.
2. `!gather oak_log 4` → "<Bot-1> Gathering 4 oak_log."
3. **Watch the bot closely** for the first log:
   - [ ] It walks to a tree, looks at a log and swings at it for a few seconds (by hand an oak log takes about 3 s), and the log breaks.
   - [ ] The dropped log item **disappears when the bot walks over it** (pickup sound / item flies to the bot).
   - [ ] `!status` → "Bot-1: gathering oak_log 1/4 for <you>". The count includes logs the bot is **holding**, not only ones in the chest, so it rises after each pickup.
4. Let it finish:
   - [ ] It walks back to the chest and you get "<Bot-1> Delivered 4 oak_log to the chest."
   - [ ] `!chest` shows at least `4 oak_log`.

**If pickup fails:** the bot breaks a log, walks to the item, stands around for about 5 s, moves on to the next log, and the drops stay on the ground; status stays at `0/4`. In the end it says "Stopped gathering oak_log at 0/4: …". Then:
- [ ] Stand still and watch one drop for 5 s: does it ever get picked up? Does it get picked up if you push the bot onto it?
- [ ] Note whether **you** can pick the item up normally.

**Record:** picked up yes / no / sometimes; roughly how long breaking one log took; the final bot message.

#### J. Gather logs: progress, trips, tools (10 min)
- [ ] Put the **axe** in the chest. `!gather oak_log 16` → "<Bot-1> Gathering 16 oak_log."
- [ ] `!status` every 20 s or so → "Bot-1: gathering oak_log n/16 for <you>", with n going up.
- [ ] The first logs are chopped by hand. Once the bot visits the chest it **takes the axe** (it's then holding it, and `!chest` no longer lists `stone_axe`), and later logs break noticeably faster.
- [ ] It only chops logs it can reach from the ground; leaves and tree tops are left alone.
- [ ] Done → "<Bot-1> Delivered 16 oak_log to the chest." (it may say slightly more than 16 if it picked up extra), and `!chest` shows ≥ 16 oak_log.
- [ ] `!gather logs 8` near **mixed** trees → it takes any species, and status reads "gathering logs n/8". (Skip if all trees are one species.)
- [ ] Ask for more than the area has, e.g. `!gather oak_log 200` near only a few trees → it delivers what it found, then "<Bot-1> Stopped gathering oak_log at n/200: nothing left to gather nearby." and n matches what's in the chest.

**Record:** total time for 16 logs (roughly), whether it took the axe, any log it kept trying and failing on.

#### K. Cobblestone: three ways to get a pickaxe (15 min)
Make sure the bot has **no pickaxe** before each part (if it's holding one from a previous run, `!stop`, kill it and let it respawn empty-handed, or spawn a fresh bot).

- [ ] **Pickaxe in the chest:** put the stone pickaxe in the chest. `!gather cobblestone 8` → "<Bot-1> Gathering 8 cobblestone.". The bot walks to the chest first, takes the pickaxe (`!chest` no longer lists it), then mines stone. Done → "<Bot-1> Delivered 8 cobblestone to the chest."
- [ ] **Only logs in the chest:** remove all pickaxes. Put exactly **3 oak logs** in the chest (nothing else). `!gather cobblestone 4` → the bot takes the logs, then **crafts and places a crafting table** next to itself (it appears in the world, and the logs are used up), crafts a wooden pickaxe and mines. Done → "Delivered 4 cobblestone to the chest." Check the chest: no logs left in it (they became the table and the pickaxe).
- [ ] **Empty chest:** empty the chest, bot without a pickaxe, trees nearby. `!gather cobblestone 4` → the bot first **chops a few logs by hand** (status still says "gathering cobblestone 0/4"), crafts a table + pickaxe as above, then mines. Those logs are **not** put in the chest.
- [ ] **No way to get one:** empty chest and **no trees** within ~16 blocks (walk out onto open stone or a beach, `!chest set` a chest there, or skip this one if that's hard). `!gather stone 4` → "<Bot-1> Stopped gathering cobblestone at 0/4: no pickaxe and couldn't make one."
- [ ] `!gather stone 2` and `!gather cobble 2` are accepted as cobblestone.

**Record:** for each part, whether it worked, where the crafting table ended up, and the final message.

#### L. Dirt, sand, gravel, bad input (5 min)
- [ ] `!gather dirt 8` → it digs dirt or grass blocks (grass gives dirt). Delivered 8 dirt.
- [ ] `!gather grass 4` → accepted as dirt.
- [ ] Near a beach: `!gather sand 8` and `!gather gravel 8` → delivered. (Gravel sometimes drops flint instead; flint stays with the bot, so it may need an extra block or two.)
- [ ] If you put a shovel in the chest first, the bot takes it on its first chest visit and digs faster afterwards.
- [ ] Far from any sand: `!gather sand 4` → "<Bot-1> Stopped gathering sand at 0/4: nothing left to gather nearby." quickly, without wandering off.
- [ ] `!gather diamond` → "[Colony] Unknown item 'diamond'. Try: logs (or oak_log, birch_log, ...), cobblestone, dirt, sand, gravel." then "Usage: !gather <item> [amount] [bots]".
- [ ] `!gather logs 0` and `!gather logs 300` → "Amount must be a whole number from 1 to 256." + usage.
- [ ] `!gather logs 4 20` → "Count must be a whole number from 1 to 16." + usage.
- [ ] `!chest open` → "Unknown chest action 'open'. Use !chest or !chest set." + usage.
- [ ] Slash fallback: `/colony:c gather oak_log 4 1` and `/colony:c chest` work like the `!` versions.

**Record:** anything that broke or any wrong message.

#### M. Two bots, one request (5 min)
- [ ] `!spawn` a second bot (two bots total, both idle). `!gather oak_log 8 2` → both bots say "Gathering 4 oak_log." (the amount is split: 4 each; `!gather oak_log 9 2` would be 5 + 4).
- [ ] `!status` → both show "gathering oak_log n/4 for <you>".
- [ ] They don't fight over the same log forever (one may lose a race for a log; it should just pick another).
- [ ] Both report "Delivered 4 oak_log to the chest.", and the chest has ≥ 8 more oak_log than before.
- [ ] With only 2 bots: `!gather oak_log 8 3` → "[Colony] Only 2 bots exist; can't send 3."

**Record:** whether both finished, total time, and anything odd when they went for the same tree.

#### N. Interruptions (10 min)
- [ ] **Re-command your own bot:** `!gather oak_log 16`, then mid-task `!gather dirt 4` → no busy offer (it's your own task); the bot switches to dirt. `!status` shows "gathering dirt n/4". The log task is dropped, not queued.
- [ ] **Stop mid-gather:** `!gather oak_log 16`, wait until it's swinging at a log, `!stop` → "[Colony] Stopped 1 task, dropped 0 queued." The bot stops swinging (the log stays half-broken or unbroken), and logs it's holding stay in its inventory.
- [ ] **Chest full:** put **one junk item in every slot** of the chest (27 slots; right-click a stack to split it into single items), so nothing can be added. `!gather oak_log 4` → the bot chops, walks to the chest, then "<Bot-1> Stopped gathering oak_log at 0/4: the chest is full."
- [ ] **Chest broken mid-task:** empty the chest, `!gather oak_log 16`, and while the bot is chopping, **break the colony chest**. On its next trip: "<Bot-1> Stopped gathering oak_log at n/16: can't reach the colony chest." Then `!chest` → "[Colony] Colony chest at x y z can't be read (gone or unloaded)." Place a chest and `!chest set` again before going on.
- [ ] **Bot death mid-gather:** `!gather oak_log 16`, and after it has delivered some but is chopping again, kill it (hit it with a sword). Expect "<Bot-1> Stopped gathering oak_log at n/16: I died.", where n is what's in the chest. The bot respawns empty-handed, its held items drop where it died, and the task is not retried. It should **not** say "Bot-1 left (gone)".

**Record:** each message you got, and for the death test whether n matched the chest.

#### O. Busy bots and gather tasks (5 min)
**Solo part:**
- [ ] With 1 bot: `!gather oak_log 32`, then while it runs, `!status` → "Bot-1: gathering oak_log n/32 for <you>", then "Queued: 0".

**Multiplayer part (needs a friend; deferred like §D):**
- [ ] You: `!gather oak_log 32`. Friend: `!come` → they get "Need 1 bot: 0 free, 1 busy.", "Bot-1 is gathering oak_log n/32 for <you>.", and the `!override` / `!queue` hint.
- [ ] Friend: `!override` → you get "Bot-1 was reassigned by <friend>; your task (gather oak_log n/32) is queued." When the friend's task ends, the bot says "Picking up your queued task: gathering oak_log n/32." and continues from n (it doesn't start over at 0).
- [ ] Repeat with `!queue` → "Queued 1 task at position 1."; the friend's task runs after yours.

**Record:** whether the resumed gather started from the right count.

#### P. Distance and loaded chunks (optional, 5 min)
- [ ] Give a long gather (`!gather oak_log 32`), then walk ~100 blocks away and come back after a minute. The bot kept working (Phase 1 showed bots tick far away), and the drops weren't lost.

**Record:** progress before and after.

#### Q. Automated GameTests (10 min)
These need a **separate** world: **flat**, Beta APIs on, **cheats ON**, pack active, and **no** bots spawned. Stand on open ground (tests build their own small scenes nearby) and run `/gametest runset colony`. To run one: `/gametest run colony:gather_logs`. To clean up: `/gametest clearall 64`.

Phase 2 tests (all use the absolute-coordinate spawn):
- `colony:chest_set`: `!chest set` next to a chest, then `!chest` says empty.
- `colony:gather_logs`: one bot, 3 small oak trees, `!gather oak_log 6` → chest has ≥ 6 oak_log. **This one also answers test I automatically.**
- `colony:gather_two_bots`: two bots split `!gather oak_log 8 2`.
- `colony:gather_cobble_craft`: chest with 3 oak logs, `!gather cobblestone 3` → bot crafts a table and pickaxe, chest gets ≥ 3 cobblestone.
- `colony:gather_no_source`: `!gather sand 4` with no sand → "nothing left".

Phase 1 tests still run too: `goto_flat`, `goto_unreachable`, `override_flow`, plus each one's `_abs` version.

**Record:** which tests passed or failed, with the failure text for any that failed. A mismatch between a Phase 1 test and its `_abs` twin is useful information, not a bug report.

---

## 5. What to send back

Paste this filled in (Phase 1 lines can stay as they were):

```
Game version:            Platform:            Pack: 0.2.0
--- Phase 1 (re-check) ---
A load:      ok / failed (+ errors)
B basics:    ok / notes
D collision: skipped / ok / notes
--- Phase 2 ---
G spot:        trees: ...   stone: natural / dug pit   sand+gravel: yes / no
H chest:       look: ok/notes   near: ok/notes   none found: ok/notes   !chest list: ok/notes
I pickup:      picked up: yes / no / sometimes   one log by hand took ~__ s   final msg: ...
J logs:        16 logs in ~__ min   took axe: yes/no   nothing-left msg: ok/notes
K cobble:      pickaxe from chest: ok/notes
               craft from chest logs: ok/notes   table placed at: ...
               chop then craft: ok/notes
               no tool: ok/notes/skipped
L dirt/sand/gravel + bad input: ok / notes
M two bots:    ok / notes
N interrupts:  re-command: ok/notes   stop: ok/notes   chest full: ok/notes
               chest broken: ok/notes   death: msg "..." n matched chest: yes/no
O busy:        solo status: ok/notes   multiplayer: skipped / notes
P far away:    skipped / ok / notes
Q gametests:   passed: ...   failed: ... (+ failure text)
Content Log:   any red [colony] errors (copy them)
```

The most useful results are **I** (do bots pick items up?), **K** (does crafting and table placement work?) and **Q**. With those I can close Phase 2 and plan Phase 3.

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| No startup line, `!help` does nothing, `/colony:c` is "unknown command" | Beta APIs is off, the pack isn't **active** on this world, or the game isn't 1.26.5x. Check the Content Log for "module not found / version not supported" |
| `!help` has no `!gather` / `!chest` | The old 0.1.0 pack is still loaded. Delete it in Settings → Storage, re-import, and check the world's active pack |
| `/colony:c help` works but `!` commands don't | Chat hook isn't firing. Run `/colony:probe chat` and use `/colony:c` meanwhile |
| `!spawn` says "Couldn't spawn…" | Copy the full message. It's the key result for the spawn probe |
| Bot walks to the wrong place | Note target vs. where it went. This is the coordinate question the spawn probe checks |
| Bot breaks blocks but status stays at 0 and drops stay on the ground | Item pickup doesn't work for bots: the key risk in §4 I. Record it |
| Bot swings at a block forever, or never starts swinging | Note the block and how far the bot stood from it. The bot gives up on a block after about twice the expected break time |
| "nothing left to gather nearby" right away | No reachable source within ~16 blocks of where you stood, or only high/buried ones. Move closer and retry |
| "can't reach the colony chest" | Chest broken, or nowhere to stand next to it. Clear the blocks around it and `!chest set` again |
| `!gather` says "No colony chest yet" after reopening the world | Expected: the chest setting isn't saved yet. `!chest set` again |
| Still running old code after updating | Delete the old pack in Settings → Storage, then re-import |
