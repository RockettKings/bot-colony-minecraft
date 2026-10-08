# Review: TABLES — consistency

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | TABLES §4.5 `gearValue` (l.293) vs S4a (equipment keys exclude `mainhand`, S4a l.230) and API-MAP rule 8 | The sum lists "head, chest, legs, feet, offhand, mainhand" plus "INVENTORY stacks". The selected mainhand item is the same stack as one hotbar slot, so it is counted twice (inflating `deathCost` and the escape decision). API-MAP rule 8 and S4a both say mainhand is never an independent slot. | Replace l.293 with: `gearValue = sum over EQUIPPED slots (head, chest, legs, feet, offhand) and INVENTORY stacks (slots 0..35, which include the held mainhand item once)` and add "Never add `mainhand` separately." |
