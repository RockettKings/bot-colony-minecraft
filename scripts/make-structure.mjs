// Generates minimal Bedrock .mcstructure files for the GameTests into packs/BP/structures/colony/.
// GameTest needs a structure for every test (structureName "colony:flat" -> structures/colony/flat.mcstructure);
// structureLocation() only changes where it is placed. Runnable standalone (node scripts/make-structure.mjs)
// and called from scripts/build.mjs.
//
// Format: uncompressed little-endian NBT, root compound "":
//   format_version:Int=1, size:List<Int>[3],
//   structure:{ block_indices:List<List<Int>>[2] (layer 0 = blocks, layer 1 = waterlog, -1 = none),
//               entities:List<Compound>[],
//               palette:{ default:{ block_palette:List<Compound{name,states,version}>, block_position_data:{} } } },
//   (states: Compound of String / Int / Byte tags, e.g. oak_log { pillar_axis: String "y" })
//   structure_world_origin:List<Int>[3]
// Block index order: x outermost, then y, then z  ->  i = (x * sy + y) * sz + z.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packs", "BP", "structures", "colony");
const BLOCK_VERSION = (1 << 24) | (21 << 16); // 1.21.0.0; the engine upgrades older block states on load

const T = { End: 0, Byte: 1, Int: 3, String: 8, List: 9, Compound: 10 };

class W {
  parts = [];
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v); this.parts.push(b); }
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.parts.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  str(s) { const b = Buffer.from(s, "utf8"); this.i16(b.length); this.parts.push(b); }
  buf() { return Buffer.concat(this.parts); }
}

// Value model: { t: "byte"|"int"|"string", v } | { t: "list", of, v: [] } | { t: "compound", v: {k: value} }
const byte = (v) => ({ t: "byte", v });
const int = (v) => ({ t: "int", v });
const string = (v) => ({ t: "string", v });
const list = (of, v) => ({ t: "list", of, v });
const compound = (v) => ({ t: "compound", v });
const TAG = { byte: T.Byte, int: T.Int, string: T.String, list: T.List, compound: T.Compound };

function payload(w, val) {
  switch (val.t) {
    case "byte": w.i8(val.v); break;
    case "int": w.i32(val.v); break;
    case "string": w.str(val.v); break;
    case "list":
      w.u8(val.v.length === 0 && val.of === undefined ? T.End : TAG[val.of]);
      w.i32(val.v.length);
      for (const item of val.v) payload(w, item);
      break;
    case "compound":
      for (const [k, child] of Object.entries(val.v)) {
        w.u8(TAG[child.t]);
        w.str(k);
        payload(w, child);
      }
      w.u8(T.End);
      break;
    default: throw new Error(`bad tag ${val.t}`);
  }
}

function encodeRoot(root) {
  const w = new W();
  w.u8(T.Compound);
  w.str("");
  payload(w, root);
  return w.buf();
}

/**
 * A palette entry: a block name, or { name, states } where each state value is a string (String tag),
 * a boolean (Byte 0/1) or an integer (Int), e.g. { name: "minecraft:oak_log", states: { pillar_axis: "y" } }.
 */
function paletteEntry(entry) {
  const { name, states = {} } = typeof entry === "string" ? { name: entry } : entry;
  const tags = {};
  for (const [k, v] of Object.entries(states)) {
    if (typeof v === "string") tags[k] = string(v);
    else if (typeof v === "boolean") tags[k] = byte(v ? 1 : 0);
    else if (Number.isInteger(v)) tags[k] = int(v);
    else throw new Error(`bad state ${name}.${k}=${v}`);
  }
  return compound({ name: string(name), states: compound(tags), version: int(BLOCK_VERSION) });
}

/** blockAt(x, y, z) -> palette index. */
function structure([sx, sy, sz], palette, blockAt) {
  const layer0 = [];
  const layer1 = [];
  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++) {
        const idx = blockAt(x, y, z);
        if (!Number.isInteger(idx) || idx < 0 || idx >= palette.length) throw new Error(`bad palette index ${idx} at ${x},${y},${z}`);
        layer0.push(int(idx));
        layer1.push(int(-1));
      }
  return encodeRoot(
    compound({
      format_version: int(1),
      size: list("int", [int(sx), int(sy), int(sz)]),
      structure: compound({
        block_indices: list("list", [list("int", layer0), list("int", layer1)]),
        entities: list("compound", []),
        palette: compound({
          default: compound({
            block_palette: list(
              "compound",
              palette.map(paletteEntry),
            ),
            block_position_data: compound({}),
          }),
        }),
      }),
      structure_world_origin: list("int", [int(0), int(0), int(0)]),
    }),
  );
}

const AIR = 0;
const STONE = 1;
const GLASS = 2;
const PALETTE = ["minecraft:air", "minecraft:stone", "minecraft:glass"];

/** Glass box enclosing the target cell (12, 1..2, 12): walls x/z 11..13 at y 1..2, full roof at y 3. */
export const WALLED_TARGET = { x: 12, y: 1, z: 12 };

function walled(x, y, z) {
  if (y === 0) return STONE;
  const inBox = x >= 11 && x <= 13 && z >= 11 && z <= 13;
  if (!inBox) return AIR;
  if (y === 3) return GLASS;
  if (y <= 2 && !(x === WALLED_TARGET.x && z === WALLED_TARGET.z)) return GLASS;
  return AIR;
}

// Phase 2 scenes. Separate palette so flat/walled stay byte-identical to Phase 1.
const G_AIR = 0;
const G_STONE = 1;
const G_LOG = 2;
const GATHER_PALETTE = ["minecraft:air", "minecraft:stone", { name: "minecraft:oak_log", states: { pillar_axis: "y" } }];

/** Oak log columns (x, z) of colony:grove, 4 high at y 1..4. */
export const GROVE_TREES = [
  { x: 8, z: 8 },
  { x: 11, z: 5 },
  { x: 5, z: 11 },
];
export const GROVE_LOG_HEIGHT = 4;

function grove(x, y, z) {
  if (y === 0) return G_STONE;
  if (y <= GROVE_LOG_HEIGHT && GROVE_TREES.some((t) => t.x === x && t.z === z)) return G_LOG;
  return G_AIR;
}

/** 4x4 stone pad of colony:quarry at y = 1, x/z 9..12. */
export const QUARRY_PAD = { min: 9, max: 12, y: 1 };

function quarry(x, y, z) {
  if (y === 0) return G_STONE;
  const inPad = x >= QUARRY_PAD.min && x <= QUARRY_PAD.max && z >= QUARRY_PAD.min && z <= QUARRY_PAD.max;
  if (y === QUARRY_PAD.y && inPad) return G_STONE;
  return G_AIR;
}

/** name -> encoded .mcstructure buffer (exported for tests / decoding checks). */
export function buildStructures() {
  return {
    // 16x4x16: stone floor at y=0, 3 layers of air above.
    "flat.mcstructure": structure([16, 4, 16], PALETTE, (_x, y) => (y === 0 ? STONE : AIR)),
    // 16x5x16: same floor, plus a sealed glass box around (12,1,12).
    "walled.mcstructure": structure([16, 5, 16], PALETTE, walled),
    // 16x8x16: stone floor, three oak_log columns (pillar_axis y) 4 high. Chests are placed in-test.
    "grove.mcstructure": structure([16, 8, 16], GATHER_PALETTE, grove),
    // 16x6x16: stone floor, a 4x4 stone pad at y=1 (x,z 9..12).
    "quarry.mcstructure": structure([16, 6, 16], GATHER_PALETTE, quarry),
  };
}

export function makeStructures() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = buildStructures();
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(OUT_DIR, name), buf);
  console.log(`structures: wrote ${Object.keys(files).join(", ")} -> packs/BP/structures/colony/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) makeStructures();
