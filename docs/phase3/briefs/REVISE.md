# Reviser brief (role: Section Writer, revise pass)

You apply review findings to **the documents your brief assigns** (one at a time, in place).

## Inputs
- The document.
- Every file matching `docs/phase3/reviews/<DOC>--*.md`.
- Any cross-referenced files a finding points to (read only the cited sections).

## Steps
1. **Apply** every blocker and major finding. Apply minor findings when they're cheap.
2. **If two findings conflict,** pick one and record the choice.
3. **If a finding is wrong,** skip it and record why.
4. **Keep the document's structure and section numbering.** Edit in place.
5. **Append a section `## Revision log (review pass 1)`:** one line per finding: `<review file>#<n>: applied | skipped (reason) | changed (what)`.

Output: the document itself, edited in place. Don't edit the review files or any other document. Docs only: no code, no git.
