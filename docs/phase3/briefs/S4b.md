# Brief S4b: snapshot flows, exactly-once, invariants (role: Section Writer)

**OUTPUT:** `docs/phase3/spec/S4b-snapshot-flows.md` (budget: about 600 lines)

**INPUTS:**
- `docs/ROADMAP.md` (return/escape rules table: the player's decisions).
- `docs/phase3/spec/S5-commands.md` §1–§6: event and effect names (botDismissed, botDismissFailed, botEscaped, botRejoined, botRejoinFailed, rosterRestored, dismissBot, summonBot, persistMeta, ColonyMeta, botNotice ids, presence states, ColonyState.absent). **Use these names; add fields, never rename.**
- `docs/phase3/spec/S1-stack-sensing.md` §2–§3: the BotController hand-off on escape_rejoin and the recover state.
- `docs/phase3/spec/S6-verification.md`: the snapshot GameTests and probes P4, P9 and P12.

**Written in parallel with S4a,** which defines these exact names; use them:
- `BotSnapshot`, `SnapItem`, `RestoreToken`, `RosterRecord`
- `SnapshotStore.write / read / markRestored / delete / listRoster`
- `captureSnapshot`, `applySnapshot`

## Cover (state machines as tables: state | trigger | guard | action | next)
1. **Dismiss:** manual (`!dismiss`), idle, parked far from players. Before dismissing, deposit excluded items to a reachable home or colony chest. For idle dismiss, refuse if none is reachable.
2. **Rejoin and summon:** `!summon` → the summoner's feet.
3. **Escape_rejoin:**
   - Destination: home if set, else the owner's feet. Owner offline and no home → stay dismissed.
   - Order: capture (seq+1) → verify stored → clear → disconnect → spawn the same name at the destination → apply exactly once → mark live → controller recover state → the core re-emits assign on botRejoined.
   - Excluded items when no chest is reachable: drop them as real drops and send the owner the coordinates (botNotice excludedDropped).
   - **No cooldown.**
4. **Idle self-dismiss:**
   - Deposit at the home or colony chest if within `depositWalkMaxBlocks`, else snapshot.
   - Triggers: idle ≥ `idleTicks`, or more than `farFromPlayersBlocks` from every player for `farTicks`.
5. **Save & Quit restore on world load:**
   - Respawn every live roster bot at lastPos. If lastPos is unloaded or unsafe, use the owner's feet or home (decide the order).
   - Restore once. Dismissed bots stay dismissed.
6. **Haul delivery with no home:** rejoin at the owner and drop the objective items at the owner's feet as real drops. Keep tools, armour and food.
7. **Exactly-once restore:** token design, interrupted restore resuming from the per-slot cursor, and double-spawn protection (if the name is already online, don't spawn).
8. **Conservation invariants:** a numbered list.
9. **Failure table:** spawn fails, apply throws, chest full, storage full, decode fails, name collision, destination unloaded. For each: exact handling and the S5 notice or message id.
10. **Exact TS payloads** for the S5-named events and effects. Also what happens to the task while the bot is dismissed: escape → the task stays assigned and paused; manual or idle dismiss → decide (refuse if busy, or requeue).
11. **Snapshot GameTests** (from S6): confirm or fix the pass conditions.
12. **Config keys table "Config keys (S4b)".**
13. **Open questions** with fallbacks.
