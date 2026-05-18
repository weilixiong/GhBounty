# CLAUDE.md

Instructions for Claude (and other AI coding agents) working in this repo.

## Database schema changes — always go through Drizzle migrations

**Never apply a schema change by pasting SQL into Supabase Studio.** Every schema change (new table, new column, new index, new RLS policy, FK swap, drop, etc.) must be a Drizzle migration committed to git.

### How to write a migration

1. Edit `packages/db/src/schema.ts`.
2. Run `pnpm db:generate` from the repo root. Drizzle Kit writes a new `packages/db/drizzle/NNNN_<slug>.sql` and updates `meta/_journal.json`.
3. Review the generated SQL. If it's wrong, edit the schema and regenerate (delete the bad file + journal entry first).
4. If you need bespoke SQL that Drizzle can't generate (RLS policies, complex backfills, custom indexes), write the `NNNN_<slug>.sql` by hand AND add the corresponding entry to `meta/_journal.json` manually.
5. The migration must be wrapped in `BEGIN; ... COMMIT;` so failures roll back atomically.
6. Commit the `.sql`, the updated `_journal.json`, and any new `*_snapshot.json`.

### How migrations are applied

- A human (currently Gaston) runs `pnpm db:migrate` from their local machine, with `DATABASE_URL` pointing to the target environment.
- CI does not apply migrations. Vercel does not apply migrations. There is no automation here — it is a deliberate human-approval gate.
- If you (the AI agent) wrote a migration, signal in the PR comment that the SQL is ready for review. Do not attempt to run it yourself.

### Supabase Studio SQL Editor — when it's OK to use

- Read-only queries (debugging, exploration, audits).
- Ad-hoc data operations on devnet (`TRUNCATE` of test data, fixture seeding, manual fixes).
- **Never** for structural changes. If the change should persist as part of the schema, it's a migration.

### When in doubt

Ask. Migrations are destructive; getting it wrong loses data. Better to clarify than guess.

## Specs and plans

- Specs live in `docs/superpowers/specs/YYYY-MM-DD-<slug>.md`.
- Implementation plans live in `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`.
- For non-trivial work, write the spec first, get it approved, then write the plan, then execute.
- See the `superpowers:brainstorming`, `superpowers:writing-plans`, and `superpowers:subagent-driven-development` skills for the workflow.

## Pre-commit hook

The repo has a pre-commit hook that runs `pnpm typecheck && pnpm test` workspace-wide. **Do not bypass with `--no-verify`.** If the hook fails, fix the underlying issue and re-commit.

## Package manager

This is a **pnpm workspace**, not npm. Use `pnpm` and `pnpm --filter @ghbounty/<name>` for package-scoped commands.

## Linear issues

Issues are tracked in Linear. The repo branch naming convention is `<github-handle>/<issue-slug>` (e.g. `gastonfoncea09/ghb-188-mcp-frontend-onboarding`). Commit messages should reference the Linear issue (`— GHB-188`).

### Linear-tracked work always goes on its own branch

**Never commit directly to `main`** (or any base branch) when implementing a Linear issue. This applies to **everything** tied to the issue: spec docs, implementation plans, code, migrations, tests, runbooks. All of it lives on the feature branch and reaches `main` only via a merged PR.

Workflow when starting a Linear issue:

1. Move the Linear issue to **In Progress** (and re-assign to yourself if needed).
2. Create the feature branch using the Linear-provided `gitBranchName` (Linear shows it on the issue page). `git checkout -b <branch>`.
3. All commits for the issue go on that branch — including the spec/plan docs in `docs/superpowers/`.
4. Open a PR when ready. Merge only after review + CI green.

The only commits that may land on `main` directly are repo-wide chores not tied to a Linear issue (workflow docs, root README typos, etc.) — and even then, prefer a branch + PR when in doubt.
