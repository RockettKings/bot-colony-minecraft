# Review: MOBS — logic

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | cave_spider tactic list | `melee_strafe always` precedes two other tactics, so they are unreachable (shadowed). | Move `melee_strafe always` to the last position in the list. |
| 2 | major | spider tactic list | `hit_and_back_off always` precedes `shield_hold`, so shield_hold never runs. | Move `shield_hold` before `hit_and_back_off always`. |
| 3 | major | creeper charged+aggroed entry | The charged+aggroed case runs `avoid_path_around`, which fails immediately when the creeper is already aggroed; shield_hold is reachable only by fall-through. | Put `shield_hold` first for `charged AND aggroed` and use `avoid_path_around` only for `not aggroed`. |
| 4 | minor | enderman | Tactic gap: no entry for a provoked enderman at close range. | Add `hit_and_back_off when provoked`, then `shield_hold always` as the final entry. |
| 5 | minor | skeleton/stray/bogged no-shield no-cover | Fallback runs melee, contradicting the DON'T that forbids closing on ranged mobs without cover. | Replace the fallback with `retreat when hp < 10` then `break_line_of_sight always`. |
| 6 | minor | husk and zombie_villager `melee_crit` | The condition matches babies, which cannot be crit-timed. | Prefix with `not_mob_is_baby AND`. |
| 7 | minor | hit_and_back_off "3 blocks in 10 ticks" | At 0.215 blocks/tick this is 2.15 blocks. | Change to "2 blocks in 10 ticks" (or "3 blocks in 14 ticks"). |
| 8 | minor | creeper retreat timing | Retreat timing figure is inconsistent with the 30-tick fuse. | Require the retreat to reach 7 blocks within 24 ticks, otherwise `shield_hold`. |
| 9 | minor | bogged, pillager `flee_if` | Redundant flee_if entries duplicate the retreat rule. | Delete them. |
