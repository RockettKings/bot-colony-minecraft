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
//   structure_world_origin:List<Int>[3]
// Block index order: x outermost, then y, then z  ->  i = (x * sy + y) * sz + z.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packs", "BP", "structures", "colony");
const BLOCK_VERSION = (1 << 24) | (21 << 16); // 1.21.0.0; the engine upgrades older block states on load

const T = { End: 0, Int: 3, String: 8, List: 9, Compound: 10 };

class W {
  parts = [];
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v); this.parts.push(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.parts.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); }
  str(s) { const b = Buffer.from(s, "utf8"); this.i16(b.length); this.parts.push(b); }
  buf() { return Buffer.concat(this.parts); }
}

// Value model: { t: "int", v } | { t: "string", v } | { t: "list", of, v: [] } | { t: "compound", v: {k: value} }
const int = (v) => ({ t: "int", v });
const string = (v) => ({ t: "string", v });
const list = (of, v) => ({ t: "list", of, v });
const compound = (v) => ({ t: "compound", v });
const TAG = { int: T.Int, string: T.String, list: T.List, compound: T.Compound };

function payload(w, val) {
  switch (val.t) {
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

/** blockAt(x, y, z) -> palette index. */
function structure([sx, sy, sz], palette, blockAt) {
  const layer0 = [];
  const layer1 = [];
  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++) {
        layer0.push(int(blockAt(x, y, z)));
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
              palette.map((name) => compound({ name: string(name), states: compound({}), version: int(BLOCK_VERSION) })),
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

export function makeStructures() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = {
    // 16x4x16: stone floor at y=0, 3 layers of air above.
    "flat.mcstructure": structure([16, 4, 16], PALETTE, (_x, y) => (y === 0 ? STONE : AIR)),
    // 16x5x16: same floor, plus a sealed glass box around (12,1,12).
    "walled.mcstructure": structure([16, 5, 16], PALETTE, walled),
  };
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(OUT_DIR, name), buf);
  console.log(`structures: wrote ${Object.keys(files).join(", ")} -> packs/BP/structures/colony/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) makeStructures();
