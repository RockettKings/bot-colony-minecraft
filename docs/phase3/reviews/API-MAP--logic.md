# Review: API-MAP — logic

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | A5 proxy ("distance fell") | The proxy uses a drop in distance, which includes the bot's own movement, and its 16-block radius differs from S1's 6. | Replace with the mob's own displacement toward the bot (`dist3(prev.entityPos, self.pos) - distance >= approachMinDelta`) and radius 6. |
| 2 | minor | `getEntitiesFromRay` row | The result includes the origin entity (the bot itself). | Add: "Result includes the origin entity; filter `entity.id === self.id`." |
