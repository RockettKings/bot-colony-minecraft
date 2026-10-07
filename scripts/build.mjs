// Bundles src/main.ts -> packs/BP/scripts/main.js (after regenerating the GameTest structures).
// With --pack, also zips packs/BP into dist/bot-colony.mcpack with manifest.json at the zip root.
// The zip is written in Node (node:zlib), so no `zip` CLI is needed.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { makeStructures } from "./make-structure.mjs"; // GameTest structures (Job 4)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BP = join(ROOT, "packs", "BP");
const OUT_PACK = join(ROOT, "dist", "bot-colony.mcpack");

makeStructures();

await build({
  absWorkingDir: ROOT,
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  // Bedrock's QuickJS handles ES2020 reliably; esbuild lowers newer syntax (class fields etc.).
  target: "es2020",
  outfile: "packs/BP/scripts/main.js",
  external: ["@minecraft/*"],
  sourcemap: false,
  logLevel: "info",
});


function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store" || name === "Thumbs.db") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs));
    else out.push(abs);
  }
  return out;
}

// ---- minimal zip writer (deflate or stored per entry, no zip64; packs are tiny) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fixed DOS timestamp (1980-01-01 00:00) so builds are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    // extra len, comment len, disk start, internal attrs = 0
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Last, so the module-level constants above are initialised (top-level await precedes them otherwise).
if (process.argv.includes("--pack")) {
  mkdirSync(dirname(OUT_PACK), { recursive: true });
  rmSync(OUT_PACK, { force: true });
  const files = listFiles(BP).map((abs) => ({ name: relative(BP, abs).split(sep).join("/"), data: readFileSync(abs) }));
  if (!files.some((f) => f.name === "manifest.json")) throw new Error("packs/BP/manifest.json missing");
  files.sort((a, b) => (a.name === "manifest.json" ? -1 : b.name === "manifest.json" ? 1 : a.name.localeCompare(b.name)));
  writeFileSync(OUT_PACK, zip(files));
  console.log(`packed ${relative(ROOT, OUT_PACK)} (${files.length} files)`);
}
