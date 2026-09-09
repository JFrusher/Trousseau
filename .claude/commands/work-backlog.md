---
description: Triage and fix bugs/quirks from docs/BUG-BACKLOG.md, one at a time, root-cause first
---

Read `docs/BUG-BACKLOG.md`. Work through every entry under **Open**, in the
order they appear (top to bottom = oldest first), unless the user gives a
different priority for this run.

For each entry:

1. **Understand it first.** If "What happened" is vague, or Repro is
   missing/unclear, ask the user directly before touching code — don't
   guess at a repro. One focused question beats three wrong fixes.
2. **Find the root cause, not the symptom.** Use the
   `superpowers:systematic-debugging` skill for this — a backlog entry
   names what the user saw, not why. Trace it to the actual cause before
   proposing a fix, and check other callers of whatever you're about to
   touch so the same class of bug isn't left in a sibling code path.
3. **Decide scope before fixing:**
   - Trivial, single-file fix with an obvious correct diff: fix directly
     on `main` in this checkout, with a test, and commit.
   - Anything touching multiple files, needing design judgment, or risky
     enough to want isolation: use `superpowers:using-git-worktrees` for a
     dedicated worktree, then `superpowers:finishing-a-development-branch`
     when it's done, same as any other change in this repo.
   - If several open entries are related (same root cause, same area),
     say so and offer to fix them together rather than one at a time.
4. **Test it.** Follow this repo's existing test conventions (Vitest,
   PGlite for anything Supabase-migration-shaped) — a fix with no
   regression test isn't done.
5. **Update the backlog entry** — move it from Open to Resolved, newest
   first, with the commit SHA(s) that fixed it and a one-line note on the
   actual root cause (not just "fixed"). If you decide something isn't a
   bug, or is out of scope, say so and move it to Resolved with that
   reasoning instead of leaving it to rot in Open.

Don't silently skip an entry. If you can't reproduce it, can't find a root
cause, or need a product decision only the user can make, stop on that
entry and ask — then continue to the next one once resolved.

When every Open entry for this run is handled, summarize what got fixed,
what's still open (and why), and whether any changes still need pushing or
merging.
