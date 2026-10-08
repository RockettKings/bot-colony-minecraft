# Review: TABLES — logic

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | Example 3 (starving trigger) and `eligible()` | Chicken is tagged `raw`, so the starving trigger fires on it, and raw chicken can also be eaten in topup against the never-eat list. | `eligible()` excludes never_eat items unless `starving`; the starving trigger ignores items tagged `avoid`. |
| 2 | major | §3.3 golden_carrot | golden_carrot is tagged `main`, so topup can eat it despite §3.3 reserving it. | Add an explicit topup exclusion: `topup` skips golden_carrot and enchanted_golden_apple. |
| 3 | major | §4.5 gearValue | The mainhand item is counted separately and again in the inventory sum. | Do not count mainhand separately; count it once through inventory. |
| 4 | minor | enchant level-sum | Ambiguity about whether mending's level counts. | Exclude mending's level from the sum (gives multiplier 2.2). |
| 5 | minor | Example 2 | sat_gain numbers are pre-apple. | Recompute after the apple is consumed. |
| 6 | minor | topup "missing >= 2" and starving tags | The condition is redundant and the starving tags are dead. | Delete the "missing >= 2" clause and the unused starving tags. |
