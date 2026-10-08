# Review: S6-verification — logic

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | boundaries-p3 single-attack-guard test | The test expects exactly one `attack()` call site, but `attackTarget` also contains the `attack()` fallback, so the test fails on a correct implementation. | Replace the assertion with: "every `.attack(` call lies inside `attackTarget` in ATTACK_FILE, and the count is 1 or 2". |
| 2 | major | DoD 32 and leash test | `config.combat.leash` does not exist. | Replace with `radius + config.combat.defendLeashExtra` (value 12) in the test and in DoD 32. |
| 3 | major | `snapshot_escape_rejoin` test | Flaky: HP 3 with zombies adjacent can kill the bot before escape, and item-entity count is affected by logs and drops. | Use ESCAPE_HP 6, place zombies 7-8 blocks away, and count only marked kit items (tag-matched), not all item entities. |
| 4 | minor | shulker terminology | The test calls shulker boxes "lossy" while S4a calls them "excluded". | Use "excluded" in S6. |
| 5 | minor | namereuse "smallest ok w" | The width search is not monotonic: a smaller w can pass while a larger fails. | Define as "the largest w such that all widths in 1..w pass", or iterate every w and require all pass. |
| 6 | minor | `shieldUpTicks` | Counting method is undefined (consecutive vs. total). | Define: "total ticks with `isUsingItem` on the shield within the window". |
