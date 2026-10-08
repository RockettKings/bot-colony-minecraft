# Review: S5-commands — logic

| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
|---|---|---|---|---|
| 1 | major | §4.7 `assign` effect (with S1 carry executor) | On escape-rejoin the carry executor already holds the task, and the `assign` effect then installs it again: the task is run twice and cargo is double-consumed. | State: "`assign` is idempotent: if `executor?.taskId === task.id` it is a no-op. A rejoin never emits `assign` for the carried task." |
| 2 | major | §botStatus push ("only on change") + 100-tick stale hide | The status is pushed only on change and the HUD hides a segment after 100 ticks without update. A long stable combat phase (no change for more than 100 ticks) makes the combat segment vanish while still fighting. | Add `statusHeartbeatTicks = 80` to config: re-push the current status every 80 ticks even when unchanged. Stale hide stays 100. |
| 3 | minor | §botStatus `recovering` field | `recovering` is a second field that is always derivable from `combatPhase === "recover"`; two sources can disagree. | Remove the `recovering` field, derive it on the reader side from `combatPhase`. |
| 4 | minor | §flow timeout | A flow that times out can still complete late; the late completion is applied to a flow that was already reported as failed. | Add: "After a flow-timeout, the flow id is marked `expired`; a late completion for an expired id is dropped and logged." |
