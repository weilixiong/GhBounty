# Bypass stake — default `mcp_status='active'` design spec

**Date:** 2026-05-17
**Linear:** [GHB-196](https://linear.app/ghbounty/issue/GHB-196)
**Branch:** `gastonfoncea09/ghb-196-bypass-stake-en-signup-mcp_statusactive-por-default-hasta`
**Status:** Design approved, pending implementation plan
**Related:** [GHB-195](https://linear.app/ghbounty/issue/GHB-195) (re-enable when program redeployed)

## Problem

The frontend onboarding flow shipped in GHB-188 forces every new user through a stake step (`/app/stake`) that calls the on-chain `init_stake_deposit` instruction. That instruction is missing from the binary currently deployed in Solana devnet (the program `CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg` predates the stake commits `88c3896`, `352cb93`, `6094161`). Result: every signup hits `AnchorError: InstructionFallbackNotFound. Error Number: 101.` and cannot mint an API key, blocking all MCP usage.

Without real users on devnet, the spam-prevention rationale for stake doesn't apply yet. The team decided 2026-05-17 to **park the stake feature** until the Anchor program is redeployed (tracked separately in GHB-195) and unblock signups by defaulting new profiles directly to `mcp_status = 'active'`.

## Goals

- Unblock signup → API key → MCP connection for new users with zero on-chain interaction.
- Preserve all existing infrastructure (StakeClient, `/api/stake`, gas-station validator) frozen in the repo so reactivation is a small revert PR, not a rebuild.
- Preserve the `suspended` state of `mcp_status` for moderation — the gating logic stays in place.
- Keep the change reversible via a single follow-up migration.

## Non-goals

- Rebuilding or redeploying the Anchor program (lives in GHB-195).
- Removing any stake-related code paths from the repo.
- Modifying the MCP auth middleware or any backend gate that checks `mcp_status === 'active'`.
- Touching the `agent_accounts` table or `pending_oauth` state.

## Architecture

### Strategy: change the default at the canonical source (DB schema)

The single source of truth for `mcp_status`'s default is `packages/db/src/schema.ts:195`:

```ts
mcpStatus: agentStatusEnum("mcp_status").notNull().default("pending_stake"),
```

Changing this to `.default("active")` and generating a corresponding Drizzle migration covers every insert path, including future code paths and direct SQL inserts. The two existing INSERTs in `frontend/lib/auth-privy.tsx` (signup dev at line 151, signup company at line 100) don't pass `mcp_status` explicitly — they rely on the DB default — so no code change there.

### Files touched

```
packages/db/
├── src/schema.ts                          MODIFY: .default("pending_stake") → .default("active")
├── drizzle/0025_bypass_stake.sql          NEW: ALTER default + UPDATE backfill
├── drizzle/meta/_journal.json             AUTO-updated by `pnpm db:generate`
└── (possibly) drizzle/meta/0025_snapshot.json  AUTO-generated

frontend/app/
├── app/stake/page.tsx                     MODIFY: thin redirect to /app/credentials
├── app/stake/StakeClient.tsx              UNCHANGED — frozen, awaiting GHB-195
├── app/credentials/CredentialsClient.tsx  MODIFY: remove stakeRequired banner + prop
├── app/credentials/ApiKeysSection.tsx     MODIFY: remove `disabled` prop and its consumers
├── app/credentials/ConnectedAppsSection.tsx  MODIFY (if applicable): remove `disabled` prop
└── agents/page.tsx                        MODIFY: link to /app/credentials (not /app/stake)
```

### Files NOT touched (frozen, ready for GHB-195 reactivation)

- `frontend/app/api/stake/route.ts`
- `frontend/lib/stake-route-core.ts`
- `frontend/app/app/stake/StakeClient.tsx`
- `frontend/app/api/gas-station/sponsor/route.ts`
- `packages/shared/src/gas-station/solana-validator.ts` (PR #93 hotfix that added `init_stake_deposit` to the allowlist stays; harmless when nothing calls it)
- `apps/mcp/lib/auth/middleware.ts` — still rejects non-`active` profiles (protects against `suspended`)
- `frontend/lib/api-keys-route-core.ts:103` — still requires `'active'`; works because new users start at `'active'`
- `frontend/lib/oauth-authorize-core.ts:96` — same

## The migration SQL

`packages/db/drizzle/0025_bypass_stake.sql`:

```sql
-- GHB-196: bypass stake feature, default new profiles to 'active'
-- so users skip the on-chain stake step (deferred per GHB-195).
-- See docsGaso/Engineering/tech-debt.md → "Stake del agente — feature parkeada"

BEGIN;

-- 1. Change DB default for new profile rows
ALTER TABLE profiles
  ALTER COLUMN mcp_status SET DEFAULT 'active';

-- 2. Flip existing pending_stake users to active (test data; no real users yet)
-- Does NOT touch 'active', 'suspended', 'revoked', 'pending_oauth' — only the
-- ones literally stuck at 'pending_stake' because they never reached the stake step.
UPDATE profiles
   SET mcp_status = 'active'
 WHERE mcp_status = 'pending_stake';

COMMIT;
```

### Generation workflow (per CLAUDE.md)

1. Edit `packages/db/src/schema.ts` — change `.default("pending_stake")` to `.default("active")`.
2. From repo root: `pnpm db:generate`. Drizzle Kit writes `0025_bypass_stake.sql` (containing only the `ALTER`).
3. Manually append the `UPDATE ... WHERE mcp_status = 'pending_stake'` and the explanatory comments to the generated file.
4. Confirm `_journal.json` has the new entry and matches the SQL filename hash.
5. Commit `.sql`, `_journal.json`, any new `*_snapshot.json`, and `schema.ts` together.

### Apply workflow (per CLAUDE.md)

A human (Gaston) runs `pnpm db:migrate` from local with `DATABASE_URL` pointing to prod Supabase, **before** or **at the same time as** the PR merge. CI does not apply migrations. The PR description flags "migration pending human apply" so reviewers know.

## Frontend changes (concrete)

### `frontend/app/app/stake/page.tsx`

Replace the whole file with a thin server-component redirect:

```tsx
import { redirect } from "next/navigation";

export default function StakePage() {
  // GHB-196: stake feature parked until Anchor program redeploy (tracked in GHB-195).
  // StakeClient.tsx is preserved as frozen code for fast reactivation later.
  redirect("/app/credentials");
}
```

### `frontend/app/app/credentials/CredentialsClient.tsx`

- Remove the `const stakeRequired = profile.mcpStatus !== "active";` computation
- Remove the conditional banner block `{stakeRequired && (<div role="status" ...>...</div>)}` (currently lines ~101-126)
- Remove the `disabled={stakeRequired}` prop on `<ApiKeysSection>`
- Update the docstring at the top to drop the "stake-required banner" reference

The hook `useProfileGate` itself can stay — it still reads `mcp_status` and the loading state is still useful. Drop the `stakeRequired` derivation but keep the hook intact.

### `frontend/app/app/credentials/ApiKeysSection.tsx`

- Change signature from `export function ApiKeysSection({ disabled }: { disabled: boolean })` to `export function ApiKeysSection()` — drop the prop entirely.
- In the `<Button>` block, drop `disabled={disabled}` and the conditional `title={disabled ? "Activá tu cuenta de MCP primero..." : undefined}`.

### `frontend/app/app/credentials/ConnectedAppsSection.tsx`

Audit-only: check if it receives a `disabled` prop. If yes, drop it. If no, no change.

### `frontend/app/agents/page.tsx:103`

The link currently points to `/app/stake`. Update to point to `/app/credentials` (the new starting point of the agent onboarding flow).

## What survives unchanged

- The `useProfileGate` hook in `CredentialsClient.tsx` (still useful for the loading state and future suspended-detection UI)
- All backend gates on `mcp_status === 'active'` — they keep working because every new profile is `'active'` from creation
- The MCP middleware in `apps/mcp/lib/auth/middleware.ts` — still rejects `suspended` (and any non-`active` state)
- All stake-related infrastructure (route, client, gas-station validator) frozen for GHB-195 reactivation
- `pending_stake` enum value — stays in the `agent_status` enum so existing rows (if any survive without the migration) and historical data remain valid

## Testing

### Existing tests to audit

| File | What it asserts | Expected outcome |
|---|---|---|
| `frontend/tests/stake-route-core.test.ts` (if present) | `/api/stake` flips `pending_stake → active` | Passes — endpoint untouched |
| `frontend/tests/api-keys-route-core.test.ts` | Rejects with non-`active` profile | Passes — gate logic unchanged |
| `apps/mcp/tests/auth/middleware.test.ts` | Rejects `pending_stake`, `suspended` with `Forbidden` | Passes — middleware unchanged |
| `packages/db/tests/mcp-rls.test.ts` | RLS + default fixtures | **May need fixture update** if it asserts `'pending_stake'` as initial state for profile rows |

If any test breaks, the fix is to update the test's expected default value, not to change implementation back.

### New test

Add a minimal assertion in `packages/db/tests/` (a new file or appended to an existing one) that verifies the post-migration default:

> Inserting a profile row with no explicit `mcp_status` results in `mcp_status === 'active'`.

Pattern: open a real Supabase connection (the existing tests already do this), insert a profile, read it back, assert.

### Manual smoke test (post-merge, post-migration)

1. Open `https://ghbounty.com/app/auth/signup/dev` in incognito, sign up as a new dev.
2. After Privy auth completes, the app should land in `/app/credentials` directly (no `/app/stake` detour).
3. The "Generate new API key" button should be enabled — no "Activá tu cuenta de MCP primero" banner.
4. Mint a `ghbk_live_*` key.
5. From a separate Claude Code session, configure the MCP server with the new key and call `whoami` — it should return the profile with `mcp_status: 'active'`.

If any of those steps fails, revert the migration and the frontend commits before debugging further.

## Verification on Vercel preview

The PR will auto-deploy preview environments for `gh-bounty-frontend` and `ghbounty-mcp`. Verify on the preview:

1. `curl https://<preview-url>/api/health` → 200
2. Walk through signup → credentials on the preview frontend
3. Confirm the redirect from `/app/stake` to `/app/credentials` (HTTP 307 with `Location: /app/credentials`)

## Commit story

Three small commits inside the GHB-196 branch:

```
1. feat(db): default profiles.mcp_status to 'active' — GHB-196
   files: packages/db/src/schema.ts, packages/db/drizzle/0025_bypass_stake.sql,
          packages/db/drizzle/meta/_journal.json, packages/db/tests/...

2. feat(frontend): redirect /app/stake to /app/credentials — GHB-196
   files: frontend/app/app/stake/page.tsx

3. feat(frontend): drop stakeRequired gating in credentials UI — GHB-196
   files: frontend/app/app/credentials/CredentialsClient.tsx,
          frontend/app/app/credentials/ApiKeysSection.tsx,
          frontend/app/app/credentials/ConnectedAppsSection.tsx (if applicable),
          frontend/app/agents/page.tsx
```

Each commit is self-contained. `git revert` works cleanly on any of the three.

## Reversal plan (when GHB-195 reactivates stake)

1. Run a new migration that flips the default back:
   ```sql
   BEGIN;
   ALTER TABLE profiles ALTER COLUMN mcp_status SET DEFAULT 'pending_stake';
   COMMIT;
   ```
2. Revert commit 2 (un-redirect `/app/stake/page.tsx` back to rendering `StakeClient`).
3. Revert commit 3 (restore the `stakeRequired` banner and `disabled` prop wiring).
4. Existing users who had `'active'` stay `'active'` — the reversal applies only to *new* signups.

Total reversal effort: one migration + two `git revert` commits. ~30 min.

## Risks

| Risk | Mitigation |
|---|---|
| Existing users with `pending_stake` get auto-promoted to `active` without explicit consent | All current `pending_stake` users are confirmed test accounts (no real users yet). The migration's WHERE clause limits scope to just that state. |
| The redirect breaks some flow that linked to `/app/stake` | Audit pre-merge: grep `/app/stake` across the codebase (already done — only `agents/page.tsx:103` and `CredentialsClient.tsx:122` link there; both updated). |
| Frozen stake code rots and becomes hard to reactivate | Mitigated by `tech-debt.md` entry + GHB-195 tracker. Reactivation is a small revert PR. |
| Tests with `pending_stake` fixtures silently pass and miss the change | Pre-merge audit; if any test relies on the old default, update the fixture. |

## Open decisions (resolved during this brainstorming)

| Question | Decision |
|---|---|
| Where to change the default — DB migration or code? | **DB migration** (canonical source of truth) |
| Migrate existing `pending_stake` users? | **Yes, all of them** in the same SQL transaction |
| `/app/stake` page handling? | **Redirect to `/app/credentials`**, StakeClient.tsx preserved |
| Delete `/api/stake` endpoint? | **No, freeze it for GHB-195 reactivation** |
| What about `pending_oauth`? | Out of scope; lives in `agent_accounts.status`, not `profiles.mcp_status` |
