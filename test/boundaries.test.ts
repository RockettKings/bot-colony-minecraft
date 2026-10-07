// Architectural guards: the core stays game-free; only the adapter touches experimental modules.
// Module specifiers are extracted with the TypeScript scanner, so every form counts: static import
// (incl. type-only and side-effect), export-from, dynamic import(), require(), import = require(),
// and /// <reference types>. Comments and plain strings don't produce false positives.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : SOURCE_EXT.test(path) ? [path] : [];
  });
}

function specifiers(code: string): string[] {
  const info = ts.preProcessFile(code, true, true);
  return [...info.importedFiles, ...info.typeReferenceDirectives, ...info.referencedFiles].map((r) => r.fileName);
}

const isMinecraft = (s: string) => s === "@minecraft" || s.startsWith("@minecraft/");

/** Repo-relative paths (with "/") of files under `dir` that reference a module matching `pred`. */
function offenders(dir: string, pred: (spec: string) => boolean): string[] {
  return sourceFiles(join(ROOT, dir))
    .filter((f) => specifiers(readFileSync(f, "utf8")).some(pred))
    .map((f) => relative(ROOT, f).split(sep).join("/"));
}

describe("import scanner self-test", () => {
  it.each([
    `import { world } from "@minecraft/server";`,
    `import type { Player } from '@minecraft/server';`,
    `import "@minecraft/server";`,
    `import * as mc from "@minecraft/server";`,
    `export { world } from "@minecraft/server";`,
    `export * from "@minecraft/server";`,
    `export type { Player } from "@minecraft/server";`,
    `const m = await import("@minecraft/server");`,
    `const m = import(\n  "@minecraft/server"\n);`,
    `const m = require("@minecraft/server");`,
    `import mc = require("@minecraft/server");`,
    `/// <reference types="@minecraft/server" />`,
    `import {\n  world,\n} from\n  "@minecraft/server-gametest";`,
  ])("detects %j", (code) => {
    expect(specifiers(code).some(isMinecraft)).toBe(true);
  });
  it.each([
    `// no @minecraft imports here: import { x } from "@minecraft/server"`,
    `/* import "@minecraft/server" */`,
    `const s = "@minecraft/server";`,
    `import { x } from "./minecraft/server.js";`,
  ])("ignores %j", (code) => {
    expect(specifiers(code).some(isMinecraft)).toBe(false);
  });
});

describe("module boundaries", () => {
  it("finds the source files it is meant to scan", () => {
    expect(sourceFiles(join(ROOT, "src/core")).length).toBeGreaterThan(3);
  });

  it("src/core never imports @minecraft/*", () => {
    expect(offenders("src/core", isMinecraft)).toEqual([]);
  });

  it("src/game/bots (executors + pure logic) never imports @minecraft/* or the adapter", () => {
    // Executors only see ports (src/game/bots/ports.ts), so they are unit-tested against plain fakes.
    expect(offenders("src/game/bots", (s) => isMinecraft(s) || /(^|\/)adapter(\/|$)/.test(s))).toEqual([]);
  });

  it("only src/game/adapter, src/probes and src/gametests import @minecraft/server-gametest", () => {
    const allowed = ["src/game/adapter/", "src/probes/", "src/gametests/"];
    const found = offenders("src", (s) => s === "@minecraft/server-gametest" || s.startsWith("@minecraft/server-gametest/"));
    expect(found.filter((f) => !allowed.some((a) => f.startsWith(a)))).toEqual([]);
  });
});
