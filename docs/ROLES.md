# Agent roles

These roles are reusable across every phase. Each agent gets **one role and one brief**, and the brief bounds the work. The goal: an agent does a small job, reads little, and finishes fast.

## Rules for every role
1. **Read only what the brief lists.** Don't explore the repo. If the listed inputs aren't enough, stop and report what's missing. Don't go hunting for it.
2. **Write only the output files the brief names.**
3. **Stay within the size budget.** If the job won't fit, split it and report the split instead of overrunning.
4. **Decide, don't defer.** Write numbers instead of adjectives, and exact names. Put anything you can't decide under "Open questions" with the fallback you chose.
5. **Keep the final message to 10 lines or fewer:** what you produced, decisions others must know, open questions.
6. **No git operations.** The Lead commits and pushes.
7. **Stage gate:** in the **Docs stage**, no role writes or edits anything under `src/`, `test/`, `scripts/` or `packs/`. Code starts only after Jaycob approves the spec.

## Brief template (the Lead fills this in for each dispatch)
```
ROLE:     <role name from this file>
TASK:     <one sentence>
INPUTS:   <exact file paths (and § numbers) to read — nothing else>
OUTPUT:   <exact file path(s)>
MUST USE: <names/types/ids already fixed by other docs>
BUDGET:   <max lines of output>
DONE WHEN:<checklist of 3–6 items>
```

## Docs stage roles

| Role | Model | Job | Typical output | Budget |
|---|---|---|---|---|
| **Lead** | Opus | Plans the phase, writes briefs, merges results, resolves conflicts, commits and pushes, keeps `CLAUDE.md` "Current state" up to date. The only role that talks to Jaycob. | Briefs, `CLAUDE.md`, decision log | – |
| **Fact Checker** | Opus | Verifies one narrow topic against a source of truth (the d.ts files, game mechanics), with line references. | `docs/phaseN/facts/<topic>.md` | 200 lines |
| **Data Author** | Sonnet | Fills in one rigid table (mob entries, food, item values) in a fixed format. Marks unsure values `(verify)`. | One table file or section | 400 lines |
| **Section Writer** | Opus for logic and state machines, Sonnet for grammar and messages | Writes **one** spec subsection: types, formulas, state tables, exact strings, worked examples. | `docs/phaseN/spec/<id>.md` | 400 lines |
| **Reconciler** | Opus | Reads the finished sections, lists every name or field mismatch, and writes the decision for each. Doesn't rewrite sections. | `docs/phaseN/DECISIONS.md` | 200 lines |
| **Case Writer** | Sonnet | Turns one section into given/when/then test cases with exact numbers. No test code. | `docs/phaseN/cases/<id>.md` | 250 lines |
| **Doc Reviewer** | Sonnet | Checks one section against one lens (consistency with ROADMAP, ambiguity a weak model would trip on, missing numbers) and lists issues. Doesn't edit. | Final message only | 30 lines |

## Code stage roles (only after spec approval)

| Role | Model | Job | Budget |
|---|---|---|---|
| **Contract Writer** | Opus | Types and stub signatures from `DECISIONS.md`, so everything compiles. No logic. | Stubs only |
| **Implementer** | Sonnet | Fills in **one module** (1–3 files) against its stubs and its case file. Reports out-of-scope problems instead of fixing them. | About 400 lines of source |
| **Transcriber** | Haiku | Copies one data table into a TS data file. No logic. | One file |
| **Test Implementer** | Sonnet | Turns one case file into vitest tests. | One test file |
| **Lens Reviewer** | Opus for correctness, integration, item conservation and API; Sonnet for tests, data and docs | One lens over one module group. Fixes only within the files the brief lists, otherwise reports. | Brief-listed files |
| **Doc Writer** | Haiku | Help text, PLAYTEST section, README, from a list of exact strings. | One doc section |

## Why this is cheaper
- **Narrow inputs:** agents stop re-reading the whole repo. Most of the usage in the first Phase 3 run went to reading.
- **Smaller outputs:** a 400-line section finishes in one pass. A 3,000-line spec got cut off by usage limits twice.
- **One owner per mismatch:** the Reconciler fixes cross-section mismatches once, instead of every writer guessing.
- **Model by risk:** reviews and logic go on Opus; transcription and docs go on Sonnet or Haiku.
