# Brief S4a: snapshot data, codec, store (role: Section Writer)

**OUTPUT:** `docs/phase3/spec/S4a-snapshot-data.md` (budget: about 500 lines)

**INPUTS:**
- `docs/phase3/API-MAP.md`: the sections on ItemStack, Container, EntityEquippableComponent, durability/enchantments, dynamic properties, playerInventoryItemChange, shutdown, and the lossy-item list.
- `docs/phase3/spec/S5-commands.md` §5 (contract additions: event and effect names).
- `docs/phase3/spec/S6-verification.md`: probes P4, P5 and P12.
- `docs/ROADMAP.md` (return/escape rules).

**Written in parallel with S4b,** which uses these exact names. Define them fully:
- `BotSnapshot`, `SnapItem`, `SnapEquipment`, `RestoreToken`, `RosterRecord`
- `encodeSnapshot`, `decodeSnapshot`, `validateSnapshot`
- `SnapshotStore` with `write(snap): WriteResult`, `read(botName): BotSnapshot | undefined`, `markRestored(botName, seq): void`, `delete(botName): void`, `listRoster(): RosterRecord[]`
- `captureSnapshot(bot, …): CaptureResult` and `applySnapshot(bot, snap, token): ApplyResult` (game-side signatures)

## Cover
1. **Types** (`src/core/snapshot/types.ts`), full TS:
   - BotSnapshot: format version, botName, owner, seq, takenAtTick, status, inventory SnapItem[] by slot, equipment head/chest/legs/feet/offhand, an outcome-stats opaque string (from S2b), lastPos and dimension, pausedTaskId.
   - **Mainhand is the selected hotbar slot:** never stored separately.
2. **Excluded or lossy items** (from API-MAP): an exact list and the rule that they are never snapshotted. S4b handles what happens to them.
3. **Codec** (`src/core/snapshot/codec.ts`, pure): encode, decode, validate; chunking ≤ `chunkChars`; checksum algorithm (exact); version migration stub.
4. **Store** (`src/game/snapshot/store.ts`):
   - The dynamic-property key scheme.
   - Write-then-commit: write the new seq's chunks, flip the pointer, then delete the old seq.
   - Read; size accounting with `getDynamicPropertyTotalByteCount`; the storage-full behaviour.
5. **Capture and apply,** game-side:
   - Exact read and write procedures per slot, using only API-MAP calls.
   - The clear procedure after a verified write.
   - The apply procedure with a per-slot cursor, so it can resume.
6. **Write triggers:**
   - playerInventoryItemChange, if probe P5 passes.
   - Every `intervalTicks`.
   - After equip, chest transfer or pickup.
   - Before dismiss.
   - Explain why restoring after Save & Quit cannot duplicate (probe P4), and the fallback if P4 shows that items drop.
7. **Config keys table "Config keys (S4a)".**
8. **Open questions** with fallbacks.
