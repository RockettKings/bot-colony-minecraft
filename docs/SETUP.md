# Setup: build, install, run

Target: Minecraft Bedrock 1.26.5x, script modules `@minecraft/server 2.11.0-beta` and `@minecraft/server-gametest 1.0.0-beta`. The manifest pins those module versions, so on any other game version the scripts won't load.

## 1. Build

```sh
npm install
npm run check        # typecheck + unit tests + build
npm run pack         # build, then zip packs/BP -> dist/bot-colony.mcpack (pure Node, no `zip` needed)
```

| Script | Does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` for the pack (`tsconfig.json`) and the tests (`tsconfig.test.json`) |
| `npm test` | Vitest unit tests (core, executor logic, runtime, module boundaries) |
| `npm run build` | Regenerates the GameTest structures in `packs/BP/structures/colony/` (`scripts/make-structure.mjs`), then bundles `src/main.ts` into `packs/BP/scripts/main.js` |
| `npm run pack` | `build`, then zips `packs/BP` into `dist/bot-colony.mcpack` |
| `npm run check` | `typecheck`, then `test`, then `build` |

## 2. Install

**Import (simplest):** double-click `dist/bot-colony.mcpack` (or open it with Minecraft). The game starts and reports that it imported **Bot Colony BP**. The pack lands in `behavior_packs`. Re-importing the same `header.version` is refused as a duplicate: delete the old copy first, or bump `version` in `packs/BP/manifest.json`.

**Manual / dev loop (Windows):** copy or symlink `packs/BP` to `development_behavior_packs\bot-colony` in the game's `com.mojang` folder. Packs in `development_behavior_packs` are re-read from disk on every world load, so a rebuild needs no re-import (just reopen the world). Packs in `behavior_packs` are meant for finished versions and can be cached. The `com.mojang` folder is at:

- current (GDK) PC builds: `%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang\`
- older (UWP / Microsoft Store) builds: `%LocalAppData%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\`

If you're unsure which build you have, check which folder exists. `/reload` reloads scripts in place, but it needs cheats, so on the play world reopen the world instead.

## 3. Play world (cheats OFF)

1. **Create New World**. Under **Experiments**, turn on **Beta APIs**.
2. Leave **Cheats OFF** (Game settings). This is the Phase 1 target.
3. Under **Behavior Packs → Available**, select **Bot Colony BP** and **Activate**.
4. **Create**.

Turning on Beta APIs (or any experiment) **permanently disables achievements for that world**. Use a throwaway world.

**Friends (client-hosted world):** every player needs the pack, but you don't send it by hand. The host's world sends its packs to joining players automatically (they may get a download prompt). Bots run on the host.

To see `[colony]` and `[probe]` log lines, go to **Settings → Creator** and turn on **Content Log File** and **Content Log GUI** (the GUI shows warnings and errors on screen in-game).

## 4. First commands

Type these in chat. `!` commands are hidden from public chat. Replies come from the colony (`[Colony] …`, grey tag) or from a bot (`<Bot-1> …`), and only you see replies to your own commands. Coordinates are written `x y z`. `!help` and `!help <command>` list the same commands in-game.

| Command | Expect |
|---|---|
| `!help` | Command list |
| `!help goto` | Usage line and description of one command |
| `!spawn` / `!spawn Bob` | "Spawning Bot-1…", then "Bot-1 joined." to everyone. A simulated player appears at your position |
| `!come` / `!come 2` | The bot says "On my way to x y z.", walks to you, then says "Arrived at x y z." |
| `!goto ~5 ~ ~` | The bot goes 5 blocks east (+x) of you. `!goto 10 64 10 2` sends 2 bots |
| `!status` / `!status Bot-1` | One line per bot ("Bot-1: idle" or "Bot-1: going to x y z for <you>"), then "Queued: n". With a name, just that bot |
| `!stop` / `!stop Bot-1` | Stops all your tasks and drops your queued ones ("Stopped 1 task, dropped 0 queued."), or stops one bot ("Stopped Bot-1.") |

Defaults: up to 3 bots; count 1–16 per command; a bot name is 1–16 letters, digits, `_` or `-`, and `@Bot-1` also works. A command less than 1 s after your previous one gets "Slow down…" (`!help`, `!override` and `!queue` are exempt). A failed task says why: "Couldn't reach x y z: no path." (also `timed out` or `I died`). Failed tasks aren't retried.

**Collision demo (needs a friend on the world):**
1. Make every bot busy with your tasks (`!goto` somewhere far away).
2. Your friend types `!come`. They get "Need 1 bot: 0 free, 1 busy.", "Bot-1 is going to x y z for <you>." and "Reply !override to take over or !queue to wait (expires in 30s)."
3. Your friend types `!override`. The bot heads to them, and you get "Bot-1 was reassigned by <friend>; your task (go to x y z) is queued." When a bot frees up it says "Picking up your queued task: going to x y z."
4. If they type `!queue` instead, they get "Queued 1 task at position 1." and wait in line. If they don't answer within 30 s, they get "Your pending request expired."

`!stop Bot-1` on a bot running someone else's task works the same way: you get the bot's task and "Reply !override to stop it (expires in 30s)."; the owner gets "Bot-1 was stopped by <you>." Stopped tasks are not requeued.

**Fallback:** if `!` commands get no reply (for example, `chatSend` is unavailable), use the slash command: `/colony:c come`, `/colony:c goto 10 64 10`, `/colony:c status Bot-1`. It takes the same text, with or without the `!`, and works with cheats off.

## 5. Spike probes

Run `/colony:probe <spawn|chat|chunks|reload>` on the play world (cheats off). A startup report also appears in chat about 3 s after you join. See [SPIKE-CHECKLIST.md](SPIKE-CHECKLIST.md) for what each probe does, and record the results there.

## 6. Dev world for GameTests (cheats ON)

1. Create a separate world: **Flat**, Beta APIs on, **Cheats ON**, pack active. Stand on open ground, because tests place their structures near you.
2. Don't spawn colony bots on this world. The tests need an empty colony and fail fast if it has bots.
3. Run the tests (all are registered under class `colony` with tag `colony`):
   - All tests: `/gametest runset colony`
   - One test: `/gametest run colony:goto_flat` (also `colony:goto_unreachable`, `colony:override_flow`)
   - Variants whose bot is spawned with the top-level API (absolute coords, the same path as in play): `colony:goto_flat_abs`, `colony:goto_unreachable_abs`, `colony:override_flow_abs`
   - Clean up the test areas: `/gametest clearall 64` (radius in blocks)
4. Results show as in-world markers and in chat. Failure messages print the bot's position in both absolute and test-relative coords.

How to read the results: if `*_abs` passes but the plain variant fails with the bot walking off, bots spawned with `test.spawnSimulatedPlayer` read navigation coords as test-relative. The runtime is fine; only the test-spawn path differs. Record it in [SPIKE-CHECKLIST.md](SPIKE-CHECKLIST.md) §5.

## 7. Scripts don't load?

Symptoms: no reply to `!help`, `/colony:c` and `/colony:probe` are unknown commands, no startup probe line in chat.

1. Turn on **Content Log GUI** (Settings → Creator) and reopen the world. A healthy load logs `[colony] registered /colony:c`, `[colony] chat front-end installed` and `[colony] runtime started`.
2. Errors about `@minecraft/server` or `@minecraft/server-gametest` not found / version not supported: Beta APIs is off, or the game isn't 1.26.5x (the manifest needs `2.11.0-beta` / `1.0.0-beta` and `min_engine_version` 1.26.50).
3. The world doesn't list the pack, or runs old code: check that the pack is **active** on the world (Edit world → Behavior Packs). After a rebuild, re-import with a bumped version, or use `development_behavior_packs` (§2).
4. `!` commands do nothing but `/colony:c help` works: `chatSend` is unavailable or not firing. Run `/colony:probe chat` and use `/colony:c` meanwhile.
