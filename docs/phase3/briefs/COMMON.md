# Common rules for every Phase 3 docs-stage agent

- **Stage: DOCS ONLY.** Never create or edit anything under `src/`, `test/`, `scripts/`, `packs/`, and never touch `package.json`. No git commands. Write only the output file your brief names.
- **Project:** a Minecraft Bedrock behavior pack (TypeScript, Script API) for a colony of simulated-player bots. Repo: `/home/claude/bot-colony`, branch `phase-3-combat`.
- **Background (read first, quickly):**
  - `CLAUDE.md`: hard rules.
  - `docs/ROADMAP.md`: the agreed decisions. **It overrides everything.** In particular: never attack players, villagers, golems or tamed pets; no escape cooldown; snapshot restore is exactly once and never duplicates; objective cargo dominates the escape decision.
  - `docs/PHASE3-SPEC.md`: the skeleton, vocabulary and section index. Use its names exactly.
- **Readers:** the documents will be implemented by lower-capability models. Precision means:
  - numbers with units, not adjectives
  - exact TypeScript in code blocks
  - state machines as tables: state | trigger | guard | action | next
  - exact chat strings
  - worked examples with the arithmetic shown
- **Ground truth:**
  - Engine calls: `docs/phase3/API-MAP.md` (only APIs listed there exist).
  - Mobs: `docs/phase3/MOBS.md`.
  - Food and item values: `docs/phase3/TABLES.md`.
- **Read only the files your brief lists,** plus this file and the three background files.
- **Final message: 8 lines or fewer.**
