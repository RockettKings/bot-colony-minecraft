# Reviewer brief (role: Doc Reviewer)

You review **every document in your group** through **one lens** and write one findings file per document: `docs/phase3/reviews/<DOC>--<lens>.md` (DOC = the file name without `.md`, e.g. `S1-stack-sensing`). **Do not edit any document.** Revisers apply the findings afterwards.

**Groups:**
- **existing:** `spec/S1-stack-sensing.md`, `spec/S3-body.md`, `spec/S5-commands.md`, `spec/S6-verification.md`, `MOBS.md`, `TABLES.md`, `API-MAP.md`.
- **new:** `spec/S2a-scoring.md`, `spec/S2b-commit-tactics.md`, `spec/S4a-snapshot-data.md`, `spec/S4b-snapshot-flows.md`.

Paths are relative to `docs/phase3/`. Docs in your group may cross-reference the other group; read only the cited sections there.

## Lenses (one reviewer per lens)
- **precision:** Could a lower-capability model implement this without guessing? Flag:
  - adjectives without numbers, and missing units
  - undefined names, types without exact TS
  - state machines missing transitions or guards
  - "should" or "maybe" wording, unstated defaults
  - internal contradictions
- **consistency:** Does it match `ROADMAP.md`, the `PHASE3-SPEC.md` vocabulary, and the other docs (names, fields, event and effect ids, config keys, file ownership, chat-string ids)? Flag every cross-doc mismatch with both locations, and say which side should change.
- **game-api:** Are Bedrock mechanics correct (not Java)? Check mob stats, food values, tactics and timings, and flag doubtful values. Engine APIs: only those in `API-MAP.md`. Check every cited signature, privilege and throw against `node_modules/@minecraft/server/index.d.ts` and `node_modules/@minecraft/server-gametest/index.d.ts`. Grep them; don't read them whole.
- **logic:** Recompute every formula and worked example. Look for deadlocks, unreachable states, oscillation, loops that never end, and race conditions between ticks and events. Safety: no path can attack a player or never-target entity, and no path can duplicate or lose items (snapshots).
- **completeness:** Does it cover everything `PHASE3-SPEC.md` §5, its brief (`briefs/<id>.md`, if any) and `ROADMAP.md` Phase 3 require? Every option, flow, failure case and config key. Testability: can each behaviour be checked by a unit test or GameTest? Every open question needs a chosen fallback.

## Findings file format (60 findings or fewer, most severe first)
```
# Review: <DOC> — <lens>
| # | Severity (blocker/major/minor) | Location (§ / line) | Problem | Exact fix (replacement text, number, or decision) |
```
Every finding must carry an **exact fix**: a replacement sentence, a value or a decision. A reviser applies it mechanically. If there are no problems, write "No findings" and stop.

## Pass 2 (2026-10-09)
- **Output name:** write findings to `docs/phase3/reviews/<DOC>--<lens>--p2.md`. Never overwrite pass-1 files.
- **Already decided:** read `docs/phase3/DECISIONS.md` first. Every `decided` row is settled, so don't re-raise it. D31 is `open`: check each item in it and report it as a finding (closed, or the exact fix still needed).
- **Revision logs:** each doc now ends with `## Revision log (review pass 1)`. Don't review the log itself. Review the doc text.
- **Groups for pass 2:**
  - **new:** S2a, S2b, S4a, S4b, all 5 lenses.
  - **seam-A:** consistency between S1, S3 and S6 and every other doc.
  - **seam-B:** consistency between S5, MOBS, TABLES and API-MAP and every other doc.
  - For a seam group, only flag cross-doc mismatches (names, fields, signatures, config keys, ids, ownership), plus anything the pass-1 revisions broke inside the doc.
