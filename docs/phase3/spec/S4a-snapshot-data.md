# S4a: Snapshot data, codec, store, capture/apply, write triggers (Phase 3)

Owner: S4a. Consumers: B4 (all snapshot files and tests), S4b (flows: it calls everything here), the contract writer (types, config), B3 (marks dirty, owns the runtime wiring), TC-B4 case writers.
Names are fixed by `PHASE3-SPEC.md` §4. Event/effect names and strings come from `S5-commands.md` §5/§6; S4a adds none. Probes P4/P5/P12 are in `S6-verification.md` §1.5.
Written in parallel with S4b: S4b owns *when* these functions are called (flows, ordering, invariants, failure mapping). S4a owns *what they do*.

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | One snapshot per bot name (lowercase key). Mainhand is **never** stored: the held item is `inventory[selectedSlot]`. |
| D2 | Items that cannot round-trip (§2) are **never serialized**. `captureSnapshot` reports them; `clearSnapshotted` never touches their slots; S4b decides their fate. |
| D3 | Pure codec (`src/core/snapshot/`), game-side store over an injected `PropertyPort` (`src/game/snapshot/store.ts`), engine item I/O only in `src/game/adapter/snapshot-io.ts`. |
| D4 | Write-then-commit: new chunks, read-back verify, flip the **pointer** (one `setDynamicProperty`), then delete the old seq. A crash at any point leaves the last good snapshot readable. |
| D5 | Exactly-once restore: `markRestored(name, seq)` is persisted **before** the first `setItem`; `read` never returns a consumed seq; `applySnapshot` refuses a second start for the same token. Restore uses `Container.setItem` only (idempotent per slot), never `addItem`. |
| D6 | Failure is never silent loss: a failed write means the caller must not clear the body; a failed apply returns the unplaced remainder as `leftover`. |
| D7 | Never `clearDynamicProperties()`. Keys are namespaced `colony:snap:` and `colony:meta`. |

## 1. Types (`src/core/snapshot/types.ts`, contract writer creates exactly this)

```ts
import type { PlayerRef, Tick, Vec3 } from "../types.js";

export const SNAPSHOT_FORMAT_VERSION = 1;

/** online    = taken while the bot has a body that still holds these items (checkpoint; the Save & Quit safety net).
 *  dismissed = taken by dismiss / idle / far flows just before clearing the body; the bot stays offline until !summon.
 *  escaping  = taken by the escape flow just before clearing the body; the bot is respawned at once. */
export type SnapStatus = "online" | "dismissed" | "escaping";

/** One item stack, payload only. Optional fields are omitted when default. */
export interface SnapStack {
  type: string;                       // "minecraft:iron_sword"; must match /^[a-z0-9_]+:[a-z0-9_./]+$/
  n: number;                          // amount, integer 1..255
  dmg?: number;                       // durability.damage, integer >= 1 (omit when 0)
  unb?: true;                         // durability.unbreakable
  ench?: Array<[string, number]>;     // [enchantment id, level 1..255], max 32 entries
  name?: string;                      // nameTag, <= 255 chars
  lore?: string[];                    // getLore(), <= 20 lines, each <= 50 chars
  keep?: true;                        // keepOnDeath
  lock?: "inventory" | "slot";        // lockMode (omit for "none")
  canDestroy?: string[];              // block ids
  canPlaceOn?: string[];              // block ids
  color?: [number, number, number];   // minecraft:dyeable RGB, each 0..1 as returned by the engine
  potion?: [string, string];          // [potionEffectType.id, potionDeliveryType.id] (potion / splash / lingering only)
  props?: Record<string, string | number | boolean>; // item dynamic properties (non-stackable items only)
}

/** An inventory stack with its container slot (0..35). */
export interface SnapItem extends SnapStack { slot: number }

/** Armour and offhand. Each present value has n === 1. There is deliberately NO `mainhand` key. */
export interface SnapEquipment {
  head?: SnapStack; chest?: SnapStack; legs?: SnapStack; feet?: SnapStack; offhand?: SnapStack;
}

export interface BotSnapshot {
  formatVersion: 1;                   // SNAPSHOT_FORMAT_VERSION
  botName: string;                    // original case, /^[A-Za-z0-9_-]{1,16}$/
  owner?: PlayerRef;
  seq: number;                        // integer >= 1, strictly increasing per bot (assigned by SnapshotStore.write)
  takenAtTick: Tick;
  status: SnapStatus;
  selectedSlot: number;               // selectedSlotIndex, integer 0..8
  inventory: SnapItem[];              // non-empty slots only, strictly ascending `slot`, max 36 entries
  equipment: SnapEquipment;
  stats: string;                      // OutcomeStats serialised by S2b; opaque here; "" when none; <= cfg.maxStatsChars
  lastPos: Vec3;                      // bot position at capture (feet)
  dimensionId: string;                // "minecraft:overworld" | "minecraft:nether" | "minecraft:the_end"
  pausedTaskId?: string;              // TaskId of the task paused/carried at capture; informational (diagnostics, tests). The core re-emits `assign` on botRejoined (D26); nothing rebuilds a task from this
  carryover?: SnapStack[];            // stacks a previous restore could not place; re-offered by the next apply
}

/** Slot identifiers shared by capture, apply, `held` maps and ExcludedStack. */
export type EquipKey = "head" | "chest" | "legs" | "feet" | "offhand";
export type SlotKey = `i${number}` | EquipKey;        // "i0".."i35", "head", ...
export const EQUIP_KEYS: readonly EquipKey[] = ["head", "chest", "legs", "feet", "offhand"];

/** Issued per restore attempt. `nonce` is any unique string (S4b: `${botName}:${seq}:${now}`). */
export interface RestoreToken { botName: string; seq: number; nonce: string; issuedAtTick: Tick }

/** What listRoster returns: one row per bot with an unconsumed snapshot. */
export interface RosterRecord {
  botName: string;                    // original case from the snapshot; lowercase key name if unreadable
  owner?: PlayerRef;
  seq: number;
  status: SnapStatus;
  takenAtTick: Tick;
  lastPos: Vec3;
  dimensionId: string;
  stacks: number;                     // inventory.length + present equipment entries
  unreadable?: true;                  // pointer exists but decode/validate failed; other fields are defaults
}

export type WriteFailReason = "disabled" | "invalid" | "too_large" | "storage_full" | "engine_error" | "verify_failed";
export type WriteResult =
  | { ok: true; seq: number; chunks: number; chars: number; statsDropped: boolean }
  | { ok: false; reason: WriteFailReason; detail: string };
export type ReadResult =
  | { ok: true; snap: BotSnapshot }
  | { ok: false; reason: "no_snapshot" | "consumed" | "snapshot_unreadable"; detail: string };

export interface SnapshotStore {
  /** Assigns seq (= max(pointer seq, restored seq) + 1; any `snap.seq` is ignored), validates, writes, verifies, commits. Never throws. */
  write(snap: BotSnapshot): WriteResult;
  /** The unconsumed snapshot, or undefined (none, consumed, or unreadable). Never throws. */
  read(botName: string): BotSnapshot | undefined;
  /** Same as read but says why not. S4b maps reasons to `SnapshotFailReason` (S5 §5). */
  readDetailed(botName: string): ReadResult;
  /** Persist "seq is consumed". Monotonic, idempotent. THROWS SnapshotStoreError if the write or its read-back fails (caller must then not apply). */
  markRestored(botName: string, seq: number): void;
  /** Remove pointer and chunks; keeps the `:r` high-water mark so seq stays monotonic. Idempotent, never throws. */
  delete(botName: string): void;
  /** Unconsumed snapshots, sorted by botName (case-insensitive). O(bots) decodes: call at world load, not per tick. */
  listRoster(): RosterRecord[];
  /** ColonyMeta (S5 §5) under key `colony:meta`, one JSON string <= chunkChars. */
  readMeta(): ColonyMeta | undefined;
  writeMeta(meta: ColonyMeta): WriteResult;     // reasons: disabled | too_large | engine_error
  /** Lightweight position track (§6.1a), key `colony:snap:<lower>:pos`. Not part of the commit protocol. Never throws; returns false on failure (logged). */
  writePos(botName: string, rec: PosRecord): boolean;
  /** The last position record, or undefined (none or unparsable). Never throws. */
  readPos(botName: string): PosRecord | undefined;
}
/** Where the bot last stood. `tick` is the session tick of the write (comparable only with `takenAtTick` of a snapshot written in the same session). */
export interface PosRecord { dimensionId: string; pos: Vec3; tick: Tick }
export class SnapshotStoreError extends Error {}
```
`ColonyMeta` is imported from `../types.js` (S5). `stacks` in `botDismissed.stacks` (S5) = `RosterRecord.stacks` rule above, counted on the snapshot just written.

## 2. Excluded and lossy items (`src/core/snapshot/excluded.ts`, pure)

An item is **excluded** (never snapshotted, never written to dynamic properties) if any rule matches, checked in this order:

```ts
export type ExcludeReason = "type_excluded" | "has_inventory_component" | "has_book_component" | "unknown_enchant" | "serialize_error";

const EXCLUDED_EXACT = new Set<string>([
  "minecraft:shulker_box", "minecraft:undyed_shulker_box", "minecraft:bundle", "minecraft:banner",
  "minecraft:filled_map", "minecraft:written_book", "minecraft:writable_book", "minecraft:enchanted_book",
  "minecraft:firework_rocket", "minecraft:firework_star", "minecraft:goat_horn", "minecraft:lodestone_compass",
  "minecraft:crossbow", "minecraft:suspicious_stew", "minecraft:tipped_arrow", "minecraft:ominous_bottle",
]);
const EXCLUDED_SUFFIX = ["_shulker_box", "_bundle", "_banner"];   // all 16 colours of each

export function excludedTypeReason(typeId: string): ExcludeReason | undefined {
  if (EXCLUDED_EXACT.has(typeId) || EXCLUDED_SUFFIX.some((s) => typeId.endsWith(s))) return "type_excluded";
  return undefined;
}
```
Game-side (in `snapshot-io.ts`) three more checks, each in try/catch, any throw = `serialize_error`:
1. `stack.hasComponent("minecraft:inventory")` true -> `has_inventory_component` (storage items).
2. `stack.hasComponent("minecraft:book")` true -> `has_book_component`.
3. any id from `getEnchantments()` where `EnchantmentTypes.get(id)` is `undefined` -> `unknown_enchant`.

Why each (API-MAP D5): shulker contents, filled-map ids, banner patterns, firework/star data, horn instrument, lodestone target, crossbow charge, stew effect, tipped-arrow potion, ominous amplifier have no API. Bundles and books are excluded as a Phase 3 simplification (bundles are out of scope per `PHASE3-SPEC` §2; book generation is lost). `enchanted_book` stored enchantments are unverified (Q2).

**Invisible losses (cannot be detected, so cannot be excluded):** armour trims and the banner pattern on a shield. They are serialized as the plain item. They survive in-session flows (the `held` stack is reused, §5.4) and are lost only across Save & Quit. Accepted (Q1).

**Rule:** an excluded stack is never serialized and its slot is never cleared by S4a. Capture returns it in `CaptureResult.excluded` together with the live `ItemStack` copy in `held`. S4b must, before any disconnect, deposit it, drop it, or keep the `held` stack for the in-session restore. If an excluded stack is still in the body at `disconnect()` it is lost or dropped by the engine (P4): S4b must never allow that silently.

## 3. Codec (`src/core/snapshot/codec.ts`, pure, no `@minecraft`)

### 3.1 Exports

```ts
export interface EncodedSnapshot { chunks: string[]; chars: number; checksum: string; contentHash: string }
export type DecodeResult =
  | { ok: true; snap: BotSnapshot }
  | { ok: false; reason: "length" | "checksum" | "json" | "version" | "invalid"; detail: string };
export type ValidateResult = { ok: true; snap: BotSnapshot } | { ok: false; errors: string[] };

export function fnv1a32(s: string): string;                       // 8 lowercase hex chars
export function stableStringify(v: unknown): string;              // sorted keys, drops `undefined`
export function asciiEscape(s: string): string;                   // every UTF-16 unit >= 0x7f -> \uXXXX
export function splitChunks(s: string, chunkChars: number): string[];
export function encodeSnapshot(snap: BotSnapshot, chunkChars: number): EncodedSnapshot;
export function decodeSnapshot(chunks: readonly string[], expect: { chars: number; checksum: string }): DecodeResult;
export function validateSnapshot(raw: unknown, maxStatsChars?: number): ValidateResult;   // default 8000
export function migrateSnapshot(raw: unknown): unknown;
export function formatPointer(p: PointerInfo): string;
export function parsePointer(s: unknown): PointerInfo | undefined;
export function contentHashOf(snap: BotSnapshot): string;
export function planApplySteps(snap: BotSnapshot, heldKeys: ReadonlySet<SlotKey>, skip: ReadonlySet<SlotKey>): ApplyStep[];
export function makeRestoreToken(snap: BotSnapshot, nonce: string, now: Tick): RestoreToken;
export interface PointerInfo { codec: 1; seq: number; chunks: number; chars: number; checksum: string }
export interface ApplyStep { key: SlotKey | `c${number}`; stack: SnapStack }   // c<n> = carryover entry n
```

### 3.2 Exact algorithms

```ts
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
// vectors: fnv1a32("") = "811c9dc5", "a" = "e40c292c", "foobar" = "bf9cf968"

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
export function asciiEscape(s: string): string {
  return s.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
```
- `payload = asciiEscape(stableStringify(snap))`. ASCII-only, so characters = bytes and a chunk boundary can never split a surrogate pair.
- `chars = payload.length`; `checksum = fnv1a32(payload)` over the **whole** payload (not per chunk).
- `splitChunks(s, c)`: `Math.ceil(s.length / c)` slices of `c` chars, last one shorter; `s === ""` is never passed (payload is >= 100 chars). `encodeSnapshot` throws `RangeError` if `chunkChars < 1000`.
- `contentHashOf(snap) = fnv1a32(asciiEscape(stableStringify({ ...snap, seq: 0, takenAtTick: 0 })))`. Used to skip a periodic write when nothing changed (§6) and to compare the read-back in §4.3.
- `decodeSnapshot`: join chunks; `joined.length !== expect.chars` -> `length`; `fnv1a32(joined) !== expect.checksum` -> `checksum`; `JSON.parse` throws -> `json`; `migrateSnapshot` throws -> `version`; `validateSnapshot` fails -> `invalid` (detail = errors joined by `"; "`).
- `migrateSnapshot` stub:
```ts
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};  // key = version it upgrades FROM; empty in v1
export function migrateSnapshot(raw: unknown): unknown {
  let o = raw as Record<string, unknown>;
  for (let v = Number(o?.formatVersion); v < SNAPSHOT_FORMAT_VERSION; v++) {
    const m = MIGRATIONS[v]; if (!m) throw new Error(`no migration from v${v}`);
    o = { ...m(o), formatVersion: v + 1 };
  }
  if (o?.formatVersion !== SNAPSHOT_FORMAT_VERSION) throw new Error(`unsupported formatVersion ${String(o?.formatVersion)}`);
  return o;
}
```
- Pointer string: `formatPointer = "1|" + seq + "|" + chunks + "|" + chars + "|" + checksum`. `parsePointer` returns `undefined` unless it is a string with exactly 5 `|` fields, first `"1"`, `seq >= 1`, `1 <= chunks <= 8`, `chars >= 1`, checksum `/^[0-9a-f]{8}$/`.
- `makeRestoreToken(snap, nonce, now) = { botName: snap.botName, seq: snap.seq, nonce, issuedAtTick: now }`.
- `planApplySteps` order (deterministic): (1) `inventory` entries ascending by slot, key `i<slot>`; (2) `equipment` in `EQUIP_KEYS` order for present entries; (3) `held`-only keys (in `heldKeys` but not in 1-2): stack is a placeholder `{ type: "", n: 1 }`, order: `i0..i35` ascending then equipment order; (4) `carryover[j]` as key `c<j>`. Every key in `skip` is omitted. The `held` stack, not the placeholder, is what gets written for step type 3 and for any key in `heldKeys`.

### 3.3 `validateSnapshot` rules (collect all errors, strings like `inventory[2].n must be integer 1..255`)

`raw` is an object; `formatVersion === 1`; `botName` matches `/^[A-Za-z0-9_-]{1,16}$/`; `seq` integer >= 1; `takenAtTick` integer >= 0; `status` in the three values; `selectedSlot` integer 0..8; `inventory` array, <= 36, `slot` integers 0..35 strictly ascending; `equipment` only the five keys (any other key, including `mainhand`, is an error), each with `n === 1`; every stack: `type` regex above and `excludedTypeReason(type) === undefined`, `n` 1..255, `dmg` integer >= 1, `ench` <= 32 pairs with level integer 1..255, `name.length <= 255`, `lore` <= 20 lines of <= 50 chars, `lock` in `inventory|slot`, `color` 3 finite numbers, `potion` 2 non-empty strings, `props` values string/number/boolean; `stats` string with `length <= maxStatsChars`; `lastPos` 3 finite numbers; `dimensionId` matches `/^minecraft:[a-z_]+$/`; `pausedTaskId` string <= 64 chars when present; `carryover` <= 36 valid stacks when present; `owner` has string `id` and `name` when present. Unknown top-level keys are an error.

### 3.4 Worked example (exact output, verified)

Snapshot: `botName "Bot-1"`, owner `{id:"p1",name:"Alex"}`, `seq 7`, `takenAtTick 48000`, `status "dismissed"`, `selectedSlot 0`, inventory `[{slot:0, iron_sword, n 1, dmg 12, ench [["minecraft:sharpness",2]], name "Café"}, {slot:1, cobblestone, n 64}]`, equipment `{offhand: shield}`, `stats ""`, `lastPos (100.5, 64, -20.25)`, overworld.
```
{"botName":"Bot-1","dimensionId":"minecraft:overworld","equipment":{"offhand":{"n":1,"type":"minecraft:shield"}},"formatVersion":1,"inventory":[{"dmg":12,"ench":[["minecraft:sharpness",2]],"n":1,"name":"Café","slot":0,"type":"minecraft:iron_sword"},{"n":64,"slot":1,"type":"minecraft:cobblestone"}],"lastPos":{"x":100.5,"y":64,"z":-20.25},"owner":{"id":"p1","name":"Alex"},"selectedSlot":0,"seq":7,"stats":"","status":"dismissed","takenAtTick":48000}
```
`chars = 455`, `checksum = "e70eb27d"`, `contentHash = "5a8751aa"`, 1 chunk at `chunkChars = 30000`. Pointer value `1|7|1|455|e70eb27d`. The `é` is 6 ASCII chars (counted in 455).
Chunk arithmetic: a 61,200-char payload at 30,000 gives `ceil(61200/30000) = 3` chunks of 30,000 / 30,000 / 1,200.

## 4. Store (`src/game/snapshot/store.ts`)

### 4.1 Port and factory

```ts
/** Adapter binds this to world.getDynamicProperty / setDynamicProperty / getDynamicPropertyIds / getDynamicPropertyTotalByteCount. set(k, undefined) deletes. Methods may throw. */
export interface PropertyPort {
  get(key: string): string | number | undefined;
  set(key: string, value: string | number | undefined): void;
  ids(): string[];
  totalBytes(): number;
}
export interface StoreDeps { port: PropertyPort; cfg: SnapshotStoreConfig; log: (msg: string) => void }   // log prefixes "[colony] "
export type SnapshotStoreConfig = Pick<Phase3Config["snapshot"], "enabled" | "chunkChars" | "maxTotalChars" | "keyOverheadChars" | "maxStatsChars">;   // writePos/readPos need no extra key
export function createSnapshotStore(deps: StoreDeps): SnapshotStore;
```
Tests use an in-memory `PropertyPort` (a `Map`); `ids()` returns its keys, `totalBytes()` the sum of key + value lengths.

### 4.2 Key scheme (`lower = botName.toLowerCase()`)

| Key | Value | Meaning |
|---|---|---|
| `colony:snap:<lower>:p` | pointer string (§3.2) | **Commit point.** Names the live seq, chunk count, length, checksum. |
| `colony:snap:<lower>:<seq>:<i>` | string, <= `chunkChars` | chunk `i` (0-based) of snapshot `seq` |
| `colony:snap:<lower>:r` | number | highest consumed-or-deleted seq (`restoredSeq`, also the seq high-water mark) |
| `colony:snap:<lower>:pos` | string `"<dimensionId>\|<x>\|<y>\|<z>\|<tick>"` (x, y, z with 2 decimals) | `PosRecord` (§6.1a); written every `posIntervalTicks` while live; never swept by §4.6 |
| `colony:meta` | string | `ColonyMeta` JSON (`stableStringify`) |

Example for `Bot-1`, seq 7: `colony:snap:bot-1:p = "1|7|1|455|e70eb27d"`, `colony:snap:bot-1:7:0 = <payload>`, `colony:snap:bot-1:r = 6`. Parse keys with `^colony:snap:([a-z0-9_-]{1,16}):(p|r|pos|(\d+):(\d+))$`. Bot names never contain `:`.

### 4.3 `write(snap)` (steps in order; the numbers are the failure/crash points)

0. `!cfg.enabled` -> `{ok:false, reason:"disabled"}`.
1. `lower`; `p = parsePointer(get(pKey))`; `r = Number(get(rKey)) || 0`.
2. `seq = max(p?.seq ?? 0, r) + 1`; `s = { ...snap, seq }`; `validateSnapshot(s, cfg.maxStatsChars)` fails -> `invalid` (detail = errors).
3. `enc = encodeSnapshot(s, cfg.chunkChars)`. `enc.chunks.length > 8` -> retry once with `s.stats = ""` (`statsDropped = true`); still > 8 -> `too_large`.
4. **Budget.** `need = enc.chars + enc.chunks.length * cfg.keyOverheadChars`. `used = port.totalBytes()`. If `used + need > cfg.maxTotalChars`: sweep (§4.6) every key of this bot except `:p`, `:r` and seq `p.seq`; recompute `used`. Still over and `stats !== ""`: re-encode with `stats = ""` (`statsDropped = true`), recompute `need`. Still over -> `{ok:false, reason:"storage_full", detail:"used <u> + need <n> > <max>"}`. The old copy counts toward `used` because it is still stored while the new one is written (peak = old + new).
5. For `i` in order: `set(chunkKey(lower, seq, i), enc.chunks[i])`. Any throw -> best-effort delete the chunks written so far; `engine_error`. The pointer is untouched.
6. **Verify.** Read every new chunk back with `get`, `decodeSnapshot(chunks, {chars, checksum})`, require `contentHashOf(decoded) === enc.contentHash`. Else delete the new chunks, `verify_failed`.
7. **Commit.** `set(pKey, formatPointer({codec:1, seq, chunks, chars, checksum}))`. Throw -> delete new chunks, `engine_error`. Then `get(pKey)` must equal the string just written, else delete new chunks and `engine_error`. After this line `read` returns the new snapshot.
8. **Sweep (best effort).** Delete old chunks (`p.seq`, `0..p.chunks-1`) and every other key of this bot whose seq differs from `seq` (§4.6). Failures are logged and ignored; the next write or `gcAll` removes the leftovers.
9. Return `{ok:true, seq, chunks, chars, statsDropped}`.

Crash analysis (each row is a test case):

| Crash/failure after step | State on next load | `read()` returns |
|---|---|---|
| 2, 3, 4 | nothing changed | old snapshot |
| 5 (some chunks) | orphan chunks at `seq` | old snapshot; next write reuses `seq` and overwrites orphans |
| 6 | all new chunks, old pointer | old snapshot |
| 7 (pointer set) | new pointer, old chunks still present | new snapshot |
| 8 | new pointer, some old chunks | new snapshot; orphans swept later |

Budget example (`maxTotalChars 600000`, `keyOverheadChars 64`, payload 455 chars, 1 chunk): `need = 455 + 64 = 519`. `used = 598,500` -> 599,019 <= 600,000, write. `used = 599,600` -> 600,119 > 600,000: sweep, then if still over `storage_full`.

### 4.4 Other operations

- `readDetailed(name)`: no pointer (or unparsable) -> `no_snapshot`; `p.seq <= r` -> `consumed`; chunk missing, decode or validate failure -> `snapshot_unreadable` (log `[colony] snapshot unreadable <name> seq <n>: <reason>`). `read` returns `snap` or `undefined`.
- `markRestored(name, seq)`: require pointer exists and `seq <= p.seq` (else throw). `set(rKey, max(r, seq))`, read it back, throw `SnapshotStoreError` on any failure or mismatch. Calling twice is a no-op.
- `delete(name)`: if pointer exists, `set(rKey, max(r, p.seq))` first, then delete `:p`, then all chunk keys, then `:pos`. Errors are logged. Used when a bot dies (S5 Q7) and by `testReset`.
- `listRoster()`: for each `ids()` match of `:p`: `readDetailed`; `ok` -> `RosterRecord`; `snapshot_unreadable` -> `{ botName: lower, seq: p.seq, status: "dismissed", takenAtTick: 0, lastPos: {x:0,y:0,z:0}, dimensionId: "minecraft:overworld", stacks: 0, unreadable: true }`; `consumed` skipped.
- `writeMeta(meta)`: `s = stableStringify(meta)` (ASCII-escaped); `s.length > cfg.chunkChars` -> `too_large`; `set("colony:meta", s)`. `readMeta` parses and validates `owners` is an object; any failure -> `undefined`.
- `writePos(name, rec)`: `!cfg.enabled` -> `false` without writing. Else `set(posKey, value)` with `value` = `dimensionId`, `x.toFixed(2)`, `y.toFixed(2)`, `z.toFixed(2)`, `tick` joined by `|`; a throw is logged and returns `false`. `readPos(name)`: split on `|`, 5 fields, numbers finite, else `undefined`.
- `gcAll()` (extra method on the object returned by `createSnapshotStore`, called once at world load): for every `colony:snap:` key not reachable from a valid pointer (wrong seq, no pointer) delete it, except `:r`.

### 4.5 Storage-full behaviour (what callers must do)

`storage_full`, `too_large`, `engine_error`, `verify_failed`: the old snapshot is intact. S4a promises only that. Callers: a periodic/event checkpoint failure is logged at most once per 1200 ticks per bot and retried at the next interval; a **forced** write (dismiss, escape, idle, far) failing means the flow **must not clear the body or disconnect**. S4b maps `WriteFailReason` to `SnapshotFailReason`: `storage_full` -> `"storage_full"` (added to S5 by D7; text `the colony's save space is full`), every other reason -> `"error"`. Items are never trimmed to fit; only `stats` is dropped.

### 4.6 Sweep helper

`keysOf(lower)` = `port.ids()` filtered by `^colony:snap:<lower>:(\d+):(\d+)$`. `sweep(lower, keepSeq?)` deletes every such key whose seq is not in the keep set. It never deletes `:p` or `:r`. Never call `world.clearDynamicProperties()`.

## 5. Capture, clear and apply (game side, `src/game/adapter/snapshot-io.ts`)

Only this file touches `ItemStack`, `Container`, `EntityEquippableComponent`. Every call is in try/catch, logs `[colony] ...`, and returns a failure value; nothing throws out. `SimBot` is the adapter's bot handle (it wraps `SimulatedPlayer`).

```ts
export interface CaptureOptions { now: Tick; status: SnapStatus; owner?: PlayerRef; stats: string; pausedTaskId?: string; carryover?: SnapStack[]; maxStatsChars: number }
export type HeldStacks = Map<SlotKey, ItemStack>;      // live engine copies, same session only
export interface ExcludedStack { key: SlotKey; typeId: string; amount: number; reason: ExcludeReason }
export type CaptureResult =
  | { ok: true; snap: BotSnapshot; held: HeldStacks; excluded: ExcludedStack[] }
  | { ok: false; reason: "invalid_bot" | "no_inventory" | "bad_size" | "engine_error"; detail: string };
export function captureSnapshot(bot: SimBot, opts: CaptureOptions): CaptureResult;

export type ClearResult =
  | { ok: true; cleared: number; remaining: SlotKey[] }            // remaining = slots still non-empty (the excluded stacks)
  | { ok: false; reason: "mismatch" | "clear_failed"; stuck: SlotKey[] };
export function clearSnapshotted(bot: SimBot, snap: BotSnapshot): ClearResult;

export interface ApplyOptions { now: Tick; held?: HeldStacks; scanDrops?: boolean; scanCentre?: ScanCentre; cursor?: ApplyCursor }
export interface ApplyCursor { next: number; attempts: number; restored: number; relocated: number; skip: SlotKey[]; reduce: Partial<Record<SlotKey, number>>; itemsOnGround: number; leftover: SnapStack[]; selected: boolean }
export type ApplyResult =
  | { status: "done"; restored: number; relocated: number; leftover: SnapStack[]; skippedAsDropped: number; itemsOnGround: number }
  | { status: "partial"; cursor: ApplyCursor; leftover: SnapStack[]; detail: string }
  | { status: "refused"; reason: "token_mismatch" | "already_applied" | "bot_invalid" | "not_ready" | "scan_unavailable" | "engine_error"; detail: string };
export function applySnapshot(bot: SimBot, snap: BotSnapshot, token: RestoreToken, opts: ApplyOptions): ApplyResult;
```

### 5.1 `captureSnapshot` (one synchronous call, no `system.run` inside)

1. `bot.isValid` false -> `invalid_bot`. `inv = bot.getComponent("minecraft:inventory")?.container` missing -> `no_inventory`; `inv.size !== 36` -> `bad_size`. `eq = bot.getComponent("minecraft:equippable")`.
2. For `slot` 0..35: `st = inv.getItem(slot)` (a copy). `undefined` -> skip. Else `classify(st)`: apply `excludedTypeReason(st.typeId)`, then the three checks of §2. Excluded -> push `ExcludedStack{ key:"i<slot>", ... }`, `held.set(key, st)`, no `SnapItem`. Otherwise build the `SnapStack` (§5.5), push `SnapItem{ slot, ... }`, `held.set(key, st)`.
3. For `slot` in `[Head, Chest, Legs, Feet, Offhand]` with keys `head, chest, legs, feet, offhand`: `st = eq.getEquipment(slot)`. Same classification; `EquipmentSlot.Mainhand` is **never read**.
4. `selectedSlot = bot.selectedSlotIndex`; `lastPos = {...bot.location}`; `dimensionId = bot.dimension.id`.
5. `stats = opts.stats.length <= opts.maxStatsChars ? opts.stats : ""`.
6. Return `snap` with `seq: 0` (the store assigns it), `formatVersion: 1`, `botName: bot.name`, and `held` / `excluded`. `inventory` is already ascending by slot.

### 5.2 `clearSnapshotted` (call only after `store.write` returned `ok` for exactly this `snap` content, in the same synchronous call as the capture)

1. For each `SnapItem` in `snap.inventory`: `cur = inv.getItem(slot)`. `cur` undefined, or `typeId`/`amount` differs from the snapshot stack -> `{ok:false, reason:"mismatch"}` **before clearing anything** (check all slots first, clear second). This protects an item that is not in the snapshot.
2. Clear: `inv.setItem(slot, undefined)` for every inventory entry; `eq.setEquipment(slot, undefined)` for every equipment entry (return `false` = failure). **Never `Container.clearAll()`**: it would destroy excluded stacks.
3. Verify: re-read every cleared slot; any non-empty -> `{ok:false, reason:"clear_failed", stuck}`. Then S4b treats the flow as failed and the bot keeps its items; a later `write` (new seq) supersedes the stale `dismissed` snapshot.
4. `remaining` = `i0..i35` and equipment keys that are still non-empty (excluded stacks and anything picked up since).
Order: inventory ascending, then head, chest, legs, feet, offhand. `selectedSlotIndex` is left alone.

### 5.2a `rollbackClearHeld` (undo a failed clear or a failed disconnect; DECISIONS D21 H5)

```ts
/** Put back what clearSnapshotted emptied. For every key k that clearSnapshotted would clear for `snap`
 *  (an `i<slot>` key for each snap.inventory entry, each present snap.equipment key) AND is in `held`:
 *  if that slot is currently EMPTY, write held.get(k) with Container.setItem / setEquipment.
 *  A non-empty slot is never touched. addItem is never used. Excluded stacks are not in `snap`, so they are never touched.
 *  Returns the number of stacks put back. Never throws; each slot is in its own try/catch (a failure is logged and counted as not put back). */
export function rollbackClearHeld(bot: SimBot, held: HeldStacks, snap: BotSnapshot): number;
```
Used by S4b only after `clearSnapshotted` returned `clear_failed` or after `disconnect()` threw (body still valid). It cannot duplicate: it only fills slots that `clearSnapshotted` emptied, with the live copies taken by the same `captureSnapshot` call (`held`). If `bot.isValid` is false it returns 0. Order: inventory ascending, then `EQUIP_KEYS` order. `selectedSlotIndex` is not touched (clear never changed it).

### 5.3 Exactly-once guards in `applySnapshot`

Module state: `startedTokens: Set<string>` of `${botName.toLowerCase()}:${seq}`.
Precondition (caller, S4b): `store.markRestored(name, snap.seq)` already returned without throwing, and the bot is valid and `isOnGround`.
1. `bot.isValid` false -> `refused bot_invalid`. Token's lowercase name or `seq` differs from `snap` -> `refused token_mismatch`.
2. No `opts.cursor`: `!bot.isOnGround` -> `refused not_ready` (token not started, caller retries next pump); key already in `startedTokens` -> `refused already_applied`. With `opts.cursor`: key must be in `startedTokens`, else `refused already_applied`.
3. No cursor and `opts.scanDrops && snap.status === "online"` (the status decides, never the restore cause; a `dismissed` or `escaping` snapshot was cleared before `disconnect()`, so it is never scanned): run the drop scan (§6.3) with `opts.scanCentre ?? scanCentreOf(snap, undefined)` **in this same synchronous call, before any write** (the body cannot pick anything up between the scan and the first pass). `available:false` -> `refused scan_unavailable` (nothing started). Else `cursor.skip = result.skip`, `cursor.reduce = result.reduce`, `cursor.itemsOnGround = result.matched`. S4b passes `scanDrops = cfg.snapshot.dropsOnDisconnect` for every cause.
4. Add the key to `startedTokens` (fresh start only). `inv`/`eq` not obtainable on a fresh start -> remove the key again, `refused engine_error`.

### 5.4 Per-slot cursor loop

`steps = planApplySteps(snap, new Set(opts.held?.keys()), new Set(cursor.skip))`. `cursor` starts `{ next:0, attempts:0, restored:0, relocated:0, skip, reduce, itemsOnGround, leftover:[], selected:false }` (`skip`, `reduce`, `itemsOnGround` from §5.3 step 3; `[]`, `{}`, `0` without a scan). For `i = cursor.next ..`:
1. `stack = opts.held?.get(key) ?? buildStack(step.stack)`. Held (a real copy taken in this session) always wins: it is lossless. `buildStack` returns `undefined` on failure (§5.5): push `step.stack` to `cursor.leftover`, set `next = i+1`, continue. If `cursor.reduce[key]` is defined, set `stack.amount = cursor.reduce[key]` (on the copy; `1 <= reduce < step.stack.n`), and a `leftover` push uses `{ ...step.stack, n: reduce }`.
2. **Inventory key `i<k>`:** `cur = inv.getItem(k)`.
   - `cur` defined and `cursor.attempts > 0 && i === cursor.next` and `sameStack(cur, stack)` (typeId, amount, nameTag): the previous attempt wrote it; count `restored`, no write.
   - `cur` defined otherwise: never overwrite. `e = inv.firstEmptySlot()`; none -> `leftover`; else target `e`, `relocated++`.
   - `inv.setItem(target, stack)`, then `inv.getItem(target)` must match typeId and amount, else treat as a throw.
3. **Equipment key:** `cur = eq.getEquipment(slot)`. Defined -> relocate to the first empty inventory slot as above. Else `eq.setEquipment(slot, stack)`; `false` or throw = failure.
4. **Carryover key `c<j>`:** place at `inv.firstEmptySlot()`; none -> `leftover`.
5. Success: `restored++`, `next = i+1`. **Failure (throw/false/readback mismatch):** `attempts++`, return `{status:"partial", cursor, leftover: [...cursor.leftover, ...remaining unwritten step stacks], detail}`. S4b retries after `applyRetryTicks` with `opts.cursor`, at most `applyMaxAttempts` times in total, then reports failure and writes the returned `leftover` into the next checkpoint's `carryover`.
6. After the last step, if `!cursor.selected`: `bot.selectedSlotIndex = snap.selectedSlot` (failure only logged), `selected = true`.
7. Return `{status:"done", restored, relocated, leftover: cursor.leftover, skippedAsDropped: cursor.skip.length + Object.keys(cursor.reduce).length, itemsOnGround: cursor.itemsOnGround}`. The key stays in `startedTokens`.

Why retries cannot duplicate: `setItem` replaces the slot content, it does not add; relocation only targets empty slots; a retried step first checks whether it already succeeded. `addItem` is never used for restore.

### 5.5 `buildStack(s: SnapStack): ItemStack | undefined` (each optional property step in its own try; a failed optional step is logged and skipped, a failed core step returns `undefined`)

1. Core: `ItemTypes.get(s.type)` must exist. If `s.potion`: `Potions.resolve(effectId, deliveryId)` then `stack.amount = s.n`; else `new ItemStack(s.type, s.n)`. Failure -> `undefined`.
2. `dmg` / `unb`: `getComponent("minecraft:durability")`: `.damage = dmg`, `.unbreakable = true`.
3. `ench`: skip unknown ids (`EnchantmentTypes.get(id)` undefined); `getComponent("minecraft:enchantable").addEnchantments(list.map(([id, level]) => ({ type: new EnchantmentType(id), level })))`.
4. `name` -> `nameTag`; `lore` -> `setLore`; `keep` -> `keepOnDeath = true`; `lock` -> `lockMode`; `canDestroy` / `canPlaceOn` -> `setCanDestroy` / `setCanPlaceOn`; `color` -> `getComponent("minecraft:dyeable").color = { red, green, blue }`; `props` -> `setDynamicProperty(k, v)` only if `!stack.isStackable`.

The capture side mirrors this with `getEnchantments()`, `durability`, `getLore()`, `getCanDestroy()`/`getCanPlaceOn()`, `getComponent("minecraft:potion")` (`.potionEffectType.id`, `.potionDeliveryType.id`), `getDynamicPropertyIds()`. Omit every default value (`dmg 0`, empty arrays, `lockMode none`).

## 6. Write triggers (service side; S4b hosts the loop, B3 calls `markDirty`)

### 6.1 Dirty marking and writing

```ts
export type DirtyReason = "inventory" | "pickup" | "equip" | "chest" | "spawn" | "rejoin" | "timer";   // src/core/snapshot/types.ts
```
`markDirty(botName: string, reason: DirtyReason, now: Tick)`. A bot is *writable* when `presence === "live"`, its body is valid, no flow (dismiss, escape, rejoin, apply) is running for it, and `cfg.enabled`. The writer runs inside the runtime pump (every 4 ticks) and, for each writable bot, writes an `online` checkpoint when `dirty && now - lastWriteTick >= dirtyDebounceTicks` or `now - lastWriteTick >= effectiveInterval`. Debounce coalesces bursts (a chest transfer fires many events). `lastWriteTick` starts at `now` on registration; timer phase offset = `parseInt(fnv1a32(lower), 16) % intervalTicks` so bots never write in the same pump.
`effectiveInterval = cfg.inventoryEvent === "all" ? cfg.intervalTicks : min(cfg.intervalTicks, cfg.fallbackIntervalTicks)`.
Skip the write when `contentHashOf(capture.snap)` equals the hash of the last successful write for this bot and `status` is unchanged (nothing to persist; still update `lastWriteTick`).

### 6.1a Position track (drop-scan centre)

A checkpoint's `lastPos` can be `intervalTicks` (200) old; a sprinting bot covers 0.28 x 200 = 56 blocks in that time, so a Save & Quit drop can lie far from it. The writer therefore also keeps a tiny position record per bot:
- In the same pump loop, for each writable bot: if `now - lastPosWriteTick >= cfg.posIntervalTicks` (20) **and** (the dimension changed or the horizontal distance from the last written pos is >= `cfg.posMinMoveBlocks` (1)), call `store.writePos(name, { dimensionId, pos: bot.location, tick: now })` and set `lastPosWriteTick = now`. Every successful `online` checkpoint write also writes the pos record with the same `lastPos` and `tick = takenAtTick`.
- Cost: one property of about 40 chars per bot, at most once per second.
- Staleness bound: the record is at most `posIntervalTicks + 4` ticks (one pump) plus `posMinMoveBlocks` behind the body: `0.28 x 24 + 1 = 7.72` blocks.

```ts
export interface ScanCentre { dimensionId: string; pos: Vec3 }
/** Pure. The pos record wins when it is at least as new as the snapshot (same session wrote both); else snap.lastPos. */
export function scanCentreOf(snap: BotSnapshot, rec: PosRecord | undefined): ScanCentre {
  return rec !== undefined && rec.tick >= snap.takenAtTick ? { dimensionId: rec.dimensionId, pos: rec.pos } : { dimensionId: snap.dimensionId, pos: snap.lastPos };
}
```
S4b computes `scanCentreOf(snap, store.readPos(name))` once in V2 and uses it for the `lastPos` destination, the V3 wait and `ApplyOptions.scanCentre`.

| Trigger | Marks dirty | Notes |
|---|---|---|
| `world.afterEvents.playerInventoryItemChange` (subscribe once, no options; if `event.player.id` is a registered bot id) | `inventory` | Only when `cfg.inventoryEvent === "all"` (probe P5 PASS). Ignore events during that bot's `clearSnapshotted` / `applySnapshot` (set `suppressUntilTick = now + 2` around them). Covers hotbar and main inventory only (`PlayerInventoryType`). |
| `world.afterEvents.entityItemPickup` where `entity.id` is a bot | `pickup` | Always subscribed (cheap); the only pickup signal when `inventoryEvent !== "all"`. |
| Timer | `timer` | Every `effectiveInterval` ticks per bot, dirty or not (equipment changes are invisible to the inventory event). |
| Equipment manager `onChanged()` (S3) | `equip` | After every successful equip/unequip/swap. |
| Chest deposit/fetch finished (Phase 2 `settleTransfer` path) | `chest` | |
| Bot registered or respawned | `spawn` | S3 `markDirty("spawn")`. |
| After `applySnapshot` returns `done` | `rejoin` | Forced write of status `online` (bypasses debounce) so the consumed seq is replaced at once. |
| Before dismiss / idle-dismiss / far-dismiss / escape | forced | S4b: `capture -> write(status dismissed|escaping) -> clearSnapshotted` in one call stack. |
| Bot dies | none | S4b calls `store.delete(name)`; the dropped items are world entities now. |

### 6.2 Why restoring after Save & Quit cannot duplicate (probe P4)

1. SimulatedPlayers are not persisted (Phase 1 `reload` probe FAILED), so after a reload no body holds the old items. The only copies are the store and any `minecraft:item` entities the engine left in the world.
2. P4 variant X (`disconnect` without clearing) measures whether a leaving bot's items become item entities. Variant Y proves clear-before-disconnect leaves nothing behind. **Dismiss, escape, idle, far:** always clear before `disconnect()`, so no drop is possible in either P4 outcome.
3. **Save & Quit has no clear step** (the bot is gone before any callback can run, API-MAP §F). Its bodies leave through the same player-removal path as `disconnect()`, which is assumed, not proven.
4. `exactly once` holds regardless: the consumed seq is persisted before the first `setItem` (D5); `read` never returns it again; a crash mid-restore can lose the unwritten remainder but cannot place anything twice (Q4).
5. **P4 says items vanish** (`snapshot.dropsOnDisconnect=false`): the checkpoint is the only copy. Restore it as is (`scanDrops: false`).
6. **P4 says items drop (`true`, the default until P4 runs):** a checkpoint of status `online` restored after the body left without a clear step may duplicate stacks that were dropped on the ground near where the body stood (the scan centre, §6.1a). Fallback = the drop scan below, run inside `applySnapshot` when S4b passes `scanDrops: true`. The scan runs **for any restore cause** whenever `snap.status === "online"` (D21 H5); the status, not the cause, tells whether the body left without a clear step. It never runs for `dismissed` / `escaping` snapshots.

### 6.3 Drop scan (`scanDroppedItems`, adapter, used by §5.3 step 3)

Rule: **the restore never writes more of an item kind than `snapshot amount - amount found on the ground or already in the new body`.** Matching is by aggregate amount per kind, not by exact stack, because Bedrock merges nearby item entities of one type (two dropped 40-stacks become one 64 and one 16) and a stack can split on pickup.

```ts
export type DropScanResult =
  | { available: true; skip: SlotKey[]; reduce: Partial<Record<SlotKey, number>>; matched: number }   // matched = items counted against the snapshot
  | { available: false };
/** `steps` = planApplySteps(snap, new Set(), new Set()); only steps whose key is a SlotKey are considered (carryover `c<n>` steps are never skipped or reduced). */
export function scanDroppedItems(bot: SimBot, snap: BotSnapshot, steps: readonly ApplyStep[], centre: ScanCentre, radius: number): DropScanResult;
/** True iff every chunk overlapping the square [x - r, x + r] x [z - r, z + r] around `centre` is loaded. */
export function scanAreaLoaded(centre: ScanCentre, radius: number): boolean;
/** Session-scoped module state: amount of each item entity already counted by an earlier scan this session. */
const claimed: Map<string, number> = new Map();   // key: item Entity.id
```
`kindKey(typeId, nameTag)` = `typeId + "|" + (nameTag ?? "")` (durability, enchantments and lore are not compared).
1. **Area.** `dim = world.getDimension(centre.dimensionId)`. For `cx` from `floor((x - radius) / 16)` to `floor((x + radius) / 16)` and `cz` likewise: `dim.isChunkLoaded({ x: cx * 16 + 8, y: centre.pos.y, z: cz * 16 + 8 })`; any `false` -> `{ available: false }`. A scan never runs on a partly loaded area, because an unloaded chunk hides dropped items. With radius 16 this is at most 3 x 3 chunks.
2. **Pool.** `pool: Map<kindKey, Array<{ src: string; avail: number }>>`.
   a. **Already in the new body first** (items it picked up between spawn and apply): for every non-empty inventory slot and equipment slot of `bot`, add `{ src: "body", avail: amount }` under its kind.
   b. **Ground:** `ents = dim.getEntities({ type: "minecraft:item", location: centre.pos, maxDistance: radius })`, sorted by distance to `centre.pos` ascending, then `id`. For each valid entity: `st = e.getComponent("minecraft:item")?.itemStack` (API-MAP D8); `avail = st.amount - (claimed.get(e.id) ?? 0)`; if `avail > 0` add `{ src: e.id, avail }` under `kindKey(st.typeId, st.nameTag)`.
3. **Match.** Walk the SlotKey steps in plan order. `want = step.stack.n`; take from the pool entries of `kindKey(step.stack.type, step.stack.name)` in list order until `want` is met or they are empty; each take decrements `avail` and, for a ground entry, adds the amount to `claimed[src]`. `took = step.stack.n - want`:
   - `took === step.stack.n` -> push `key` to `skip`;
   - `0 < took < step.stack.n` -> `reduce[key] = step.stack.n - took`;
   - `matched += took`.
4. Return `{ available: true, skip, reduce, matched }`. Nothing on the ground is touched: skipped and reduced amounts stay where they are (conserved), or are already in the body.

Why it cannot duplicate within its assumptions: for every kind, `restored = snapshot - min(snapshot, body + ground in radius)`, so `restored + body + ground <= snapshot` whenever all of the bot's dropped items lie inside the radius. The shared `claimed` map makes two bots that dropped the same kind near each other split the ground amount instead of both counting it (which would under-restore). Residual risks are listed in §8 Q4, Q10, Q11.

Example A (merged): snapshot cobblestone 40 in `i1` and 40 in `i5`; ground one 64 entity and one 16 entity. Pool `minecraft:cobblestone|` = 64 + 16 = 80. `i1`: take 40 (from the 64, 24 left), skip. `i5`: take 24 + 16 = 40, skip. `matched = 80`; nothing restored; 80 stay on the ground.
Example B (partial): snapshot cobblestone 40 in `i1`; ground 30. `i1`: take 30, `reduce.i1 = 10`; the restore writes 10; 40 total exist again (30 ground + 10 body).
Example C (picked up): the new body already holds iron_ingot 5 when apply starts; snapshot iron_ingot 12 in `i3`; ground 7. Pool = 5 (body) + 7 = 12; `i3` skipped; nothing is written; the body keeps its 5, 7 stay on the ground.
Example D (unrelated stack): the snapshot has a named sword `Cara`; the ground has an unnamed iron_sword. Kinds differ (`minecraft:iron_sword|Cara` vs `minecraft:iron_sword|`), so the sword is restored.

## 7. Config keys (S4a)

Added to `config.snapshot` (`Phase3Config`) by the contract writer. Names marked S6 are the ones `S6-verification.md` §1.4 already prints in `SET` tokens.

| Key | Default | Unit | Meaning |
|---|---|---|---|
| `enabled` (S6) | `true` | bool | Master switch. `false`: `write` returns `disabled`; S4b refuses dismiss/escape/idle/far |
| `dropsOnDisconnect` (S6) | `true` | bool | P4 result. `true` enables the reload drop scan (§6.3). Clear-before-disconnect is mandatory either way |
| `inventoryEvent` (S6) | `"all"` | `"all" \| "partial" \| "off"` | P5 result. `"all"`: event-driven dirty marking |
| `intervalTicks` | 200 | ticks | Periodic checkpoint spacing per bot (10 s). The single name everywhere (D6; S6's `timerTicks` is renamed) |
| `fallbackIntervalTicks` | 100 | ticks | Used instead when `inventoryEvent !== "all"` (the P5 FAIL value) |
| `dirtyDebounceTicks` | 20 | ticks | Minimum spacing between two event-driven writes of one bot |
| `chunkChars` (S6) | 30000 | chars | Max length of one property string. Minimum accepted 1000 |
| `maxTotalChars` (S6) | 600000 | chars | Soft cap compared with `getDynamicPropertyTotalByteCount()` (peak = old + new copy) |
| `keyOverheadChars` | 64 | chars | Per-chunk allowance for key length and engine overhead in the budget |
| `maxStatsChars` | 8000 | chars | `stats` longer than this is stored as `""` |
| `applyRetryTicks` | 2 | ticks | Wait before resuming a `partial` apply |
| `applyMaxAttempts` | 5 | attempts | `cursor.attempts` limit before S4b gives up and writes `leftover` to `carryover` |
| `reloadDropScanRadius` | 16 | blocks | Radius of the drop scan around the scan centre (§6.1a): `ceil(0.28 x (posIntervalTicks + 4) + posMinMoveBlocks) + 8` = 8 + 8, the second 8 for the toss and merge spread of dropped items |
| `posIntervalTicks` | 20 | ticks | Minimum spacing of position-record writes per bot (§6.1a) |
| `posMinMoveBlocks` | 1 | blocks | Horizontal move since the last record that triggers a new one |

Constants (not config): `MAX_CHUNKS = 8`, key prefix `colony:snap:`, meta key `colony:meta`.

## 8. Open questions (chosen fallbacks)

| # | Question | Fallback chosen |
|---|---|---|
| Q1 | Trims and shield banners cannot be detected, so they cannot be excluded. | Serialize the plain item. Kept in-session via `held`; lost only across Save & Quit. Document in PLAYTEST. |
| Q2 | Do `enchanted_book` stored enchantments appear in `enchantable`? | Excluded for now. A later probe may remove it from `EXCLUDED_EXACT`. |
| Q3 | Real property size limit (P12 decides `chunkChars`). | 30,000 default; `maxTotalChars` 600,000; payloads are ASCII so chars = bytes. If `getDynamicPropertyTotalByteCount` counts more than chars, lower `maxTotalChars`. |
| Q4 | Mid-restore crash loses the unwritten remainder; the drop scan counts any same-kind item in the radius (another player's, another bot's) as the bot's own. | Accepted: both lose or leave items on the ground, never duplicate (ROADMAP: no duplication outranks no loss). The aggregate rule never restores more of a kind than `snapshot - (body + ground in radius)`. A restore is one synchronous call in the normal case. |
| Q10 | Dropped items outside the scan radius (carried by water, pushed by pistons, or a pos-record write that failed) or picked up by a player before the restore are not seen, so they can still be duplicated. | Accepted residual risk, bounded by the 7.72-block staleness bound and the 16-block radius. A failed `writePos` is logged; the next one fixes it within 20 ticks. Probe P19 (hand-off D32) measures the real Save & Quit behaviour: if items do **not** survive Save & Quit as entities, `dropsOnDisconnect` stays as P4 says but the scan always matches nothing and is harmless. |
| Q11 | Item entities persist through a reload but keep ageing (6000-tick despawn) only while their chunk is loaded. | No action: a despawned stack was lost by the engine, not duplicated. |
| Q5 | `SnapshotFailReason` (S5) had no `storage_full`. | RESOLVED (D7): S5 adds `"storage_full"` with message id and text `the colony's save space is full` in S5 §6; S4b maps `WriteFailReason "storage_full"` to it. |
| Q6 | S6 named the interval `snapshot.timerTicks`; S4a uses `intervalTicks`. | RESOLVED (D6): `snapshot.intervalTicks` everywhere; S6 changes. |
| Q7 | `EntityItemComponent.itemStack` (d.ts line 12203, map line 3270) is not in API-MAP. | Used only by the drop scan and the P4 probe. The architect adds it to API-MAP. If refused, the scan degrades to counting `minecraft:item` entities (skip `min(count, steps)` stacks of largest amount first). |
| Q8 | `readMeta`/`writeMeta` are not in the brief's store list (S5 D10 needs persistence). | Added to `SnapshotStore`; S4b/runtime call them from the `persistMeta` effect and at world load. |
| Q9 | `testReset` (S6 C3) must delete snapshot keys. | Implemented as `store.delete(name)` per roster bot plus `port.set(key, undefined)` for every `colony:snap:*` and `colony:meta` id; never `clearDynamicProperties()`. |

## Revision log (review pass 1)

No review files exist for S4a (`docs/phase3/reviews/S4a-snapshot-data--*.md` matches nothing); this pass applies `DECISIONS.md` rows only.

- DECISIONS D6: applied. `snapshot.intervalTicks` is the only name; §7 row and Q6 now say so (S6 changes, not S4a).
- DECISIONS D7: applied. `"storage_full"` is in S5's `SnapshotFailReason`; §4.5 states the mapping (`storage_full` -> `"storage_full"`, others -> `"error"`); Q5 marked resolved. `WriteFailReason` already contained `storage_full`.
- DECISIONS D9: accepted as is. `readDetailed`, `readMeta`, `writeMeta`, `gcAll`, `clearSnapshotted`, `planApplySteps`, `scanDroppedItems` stay. Added the missing exact signature of `scanDroppedItems` (+ `DropScanResult`) in §6.3 and the named type `DirtyReason` in §6.1, because S4b uses both by name.
- DECISIONS D21 H5: applied. New §5.2a defines `rollbackClearHeld(bot, held, snap): number` (fills only emptied slots, never `addItem`, never touches excluded stacks). §5.3 step 3 and §6.2 item 6 now run the drop scan for any restore cause when `snap.status === "online"` and `scanDrops` is set; never for `dismissed` / `escaping`.
- DECISIONS D26 (consequence, no S4a row): `pausedTaskId` comment changed to "informational"; the core re-emits `assign` on `botRejoined`, so nothing in S4a/S4b rebuilds a task from the snapshot.
- DECISIONS D8, D10: not S4a rows (D8: API-MAP row for `EntityItemComponent.itemStack`; D10: S4b flows). Q7 unchanged.

## Revision log (review pass 2, Lead fix 2026-10-09)

- S4a--game-api--p2#1 (merged entities): applied as the aggregate per-kind rule (§6.3), `DropScanResult.reduce`, `ApplyCursor.reduce` / `itemsOnGround`, `ApplyResult.itemsOnGround`, examples A-D.
- S4a--game-api--p2#2 (radius 8 vs stale `lastPos`): **changed.** Instead of radius 64 around a 200-tick-old position: a position record (`:pos` key, `writePos`/`readPos`, `PosRecord`, §6.1a) written every 20 ticks, `scanCentreOf`, radius 16, whole-area loaded check (`scanAreaLoaded`). Smaller area = fewer false matches and at most 3 x 3 chunks.
- S4a--game-api--p2#5 (pickup before apply): applied as pool step 2a (items already in the new body count as found) plus "scan and first pass in one synchronous call".
- New: session-scoped `claimed` ledger so two bots never count the same ground entity. New Q10, Q11. Cross-doc hand-offs recorded as DECISIONS D32 (S4b, S6, API-MAP).
