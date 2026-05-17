# Bypass Stake — `mcp_status='active'` by Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `profiles.mcp_status` default from `pending_stake` to `active` via DB migration so new signups skip the broken on-chain stake step. Redirect `/app/stake` to `/app/credentials`, drop the `stakeRequired` gating in the UI, and leave the stake infrastructure frozen in the repo for future reactivation via GHB-195.

**Architecture:** One DB migration (`0025_bypass_stake.sql`) changes the DEFAULT and backfills existing `pending_stake` rows. Frontend changes are limited to: a one-line redirect for `/app/stake/page.tsx`, removal of the `stakeRequired` banner/prop in the credentials flow, and a copy update on the public `/agents` landing. No backend gates change — the MCP middleware and api-keys/oauth gates continue to require `'active'`, which now is the default state for every new profile.

**Tech Stack:** Next.js 16 App Router · Drizzle ORM · Supabase Postgres · pnpm workspace

**Spec:** `docs/superpowers/specs/2026-05-17-bypass-stake-mcp-status-design.md`
**Linear:** [GHB-196](https://linear.app/ghbounty/issue/GHB-196)
**Branch:** `gastonfoncea09/ghb-196-bypass-stake-en-signup-mcp_statusactive-por-default-hasta`

**Working directory for all commands:** repo root (`/Users/gastonfoncea/Documents/Startups/GhBounty`) unless explicitly stated.

---

## Phase 0 — Pre-flight

### Task 0: Confirm clean working tree

**Files:** none

- [ ] **Step 1: Verify branch + clean tree**

Run:
```bash
git status
git branch --show-current
```

Expected:
```
On branch gastonfoncea09/ghb-196-bypass-stake-en-signup-mcp_statusactive-por-default-hasta
nothing to commit, working tree clean
```

If not clean: stop and resolve before continuing.

---

## Phase 1 — DB migration (Commit 1)

### Task 1: Edit schema default for `profiles.mcp_status`

**Files:**
- Modify: `packages/db/src/schema.ts:195`

- [ ] **Step 1: Read current schema line 195**

Run:
```bash
sed -n '195p' packages/db/src/schema.ts
```

Expected:
```
  mcpStatus: agentStatusEnum("mcp_status").notNull().default("pending_stake"),
```

- [ ] **Step 2: Edit the default**

Use the Edit tool on `packages/db/src/schema.ts`:

- `old_string`:
  ```
    mcpStatus: agentStatusEnum("mcp_status").notNull().default("pending_stake"),
  ```
- `new_string`:
  ```
    mcpStatus: agentStatusEnum("mcp_status").notNull().default("active"),
  ```

- [ ] **Step 3: Verify edit**

Run:
```bash
sed -n '195p' packages/db/src/schema.ts
```

Expected: line shows `default("active")`.

---

### Task 2: Generate the Drizzle migration

**Files:**
- Create: `packages/db/drizzle/0025_bypass_stake.sql` (auto-generated)
- Modify: `packages/db/drizzle/meta/_journal.json` (auto-updated)
- Possibly create: `packages/db/drizzle/meta/0025_snapshot.json`

- [ ] **Step 1: Run db:generate from repo root**

Run:
```bash
pnpm db:generate
```

Expected output: Drizzle Kit writes a new `0025_<slug>.sql` file. The slug Drizzle picks is automatic; rename it after if it doesn't match `0025_bypass_stake.sql`.

- [ ] **Step 2: Inspect what Drizzle wrote**

Run:
```bash
ls -la packages/db/drizzle/0025_*.sql 2>/dev/null
ls -la packages/db/drizzle/meta/0025_snapshot.json 2>/dev/null
cat packages/db/drizzle/0025_*.sql
```

Expected: one file with content roughly:
```sql
ALTER TABLE "profiles" ALTER COLUMN "mcp_status" SET DEFAULT 'active';
```

- [ ] **Step 3: If Drizzle named the file differently, rename it**

If the file is `0025_some_other_slug.sql`, rename to match the spec:
```bash
mv packages/db/drizzle/0025_*.sql packages/db/drizzle/0025_bypass_stake.sql
```

And update the matching entry in `packages/db/drizzle/meta/_journal.json`: find the `"tag"` field with the auto-generated name and replace with `"0025_bypass_stake"`.

- [ ] **Step 4: Verify _journal.json updated**

Run:
```bash
tail -10 packages/db/drizzle/meta/_journal.json
```

Expected: a new entry with `"idx": 22` (or whatever the next idx is), `"tag": "0025_bypass_stake"`.

If the journal wasn't updated (this can happen because of the tech-debt issue described in `docsGaso/Engineering/tech-debt.md` → "Migrations sin proceso de deploy automático"): manually append the entry. Follow the existing pattern:

```json
,
    {
      "idx": 22,
      "version": "7",
      "when": <unix-ms-now>,
      "tag": "0025_bypass_stake",
      "breakpoints": true
    }
```

(Adjust `idx` to match the next available index — read the file and pick `max(idx) + 1`. Use the current Unix milliseconds for `when`.)

---

### Task 3: Append the UPDATE backfill to the generated SQL

**Files:**
- Modify: `packages/db/drizzle/0025_bypass_stake.sql`

The Drizzle-generated file only has the `ALTER`. We need to append the backfill UPDATE for existing `pending_stake` rows.

- [ ] **Step 1: Replace file content with the full migration**

Use the Write tool on `packages/db/drizzle/0025_bypass_stake.sql` with exactly this content:

```sql
-- GHB-196: bypass stake feature, default new profiles to 'active'
-- so users skip the on-chain stake step (deferred per GHB-195).
-- See docsGaso/Engineering/tech-debt.md → "Stake del agente — feature parkeada"

BEGIN;

-- 1. Change DB default for new profile rows
ALTER TABLE "profiles" ALTER COLUMN "mcp_status" SET DEFAULT 'active';

-- 2. Flip existing pending_stake users to active (test data; no real users yet)
-- Does NOT touch 'active', 'suspended', 'revoked', 'pending_oauth' — only the
-- ones literally stuck at 'pending_stake' because they never reached the stake step.
UPDATE "profiles"
   SET "mcp_status" = 'active'
 WHERE "mcp_status" = 'pending_stake';

COMMIT;
```

- [ ] **Step 2: Verify file content**

Run:
```bash
cat packages/db/drizzle/0025_bypass_stake.sql
```

Expected: the full SQL block shown above, BEGIN/COMMIT wrapping the ALTER and UPDATE.

---

### Task 4: Verify typecheck still passes

**Files:** none (verification only)

- [ ] **Step 1: Run workspace typecheck**

Run:
```bash
pnpm typecheck
```

Expected: all 7 packages pass. The schema change is a literal change; no type errors should appear.

If a test fixture asserts the old default value `'pending_stake'`, update the fixture to `'active'` (don't touch the migration). Re-run typecheck.

---

### Task 5: Commit the migration (Commit 1 of 3)

**Files:** none (just staging + commit)

- [ ] **Step 1: Stage**

Run:
```bash
git add packages/db/src/schema.ts \
        packages/db/drizzle/0025_bypass_stake.sql \
        packages/db/drizzle/meta/_journal.json
# Add the snapshot file too if Drizzle created one:
git add packages/db/drizzle/meta/0025_snapshot.json 2>/dev/null || true
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(db): default profiles.mcp_status to 'active' — GHB-196

Migration 0025_bypass_stake: change the DEFAULT of profiles.mcp_status
from 'pending_stake' to 'active' and backfill existing pending_stake
rows. Unblocks new signups from the broken on-chain init_stake_deposit
step (the Anchor program deployed on devnet predates that instruction).

The stake feature is parked, not removed: StakeClient, /api/stake, and
the gas-station validator are frozen for reactivation via GHB-195.

Migration must be applied by a human (pnpm db:migrate against prod
Supabase) per CLAUDE.md — CI does not run migrations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Verify commit**

```bash
git log -1 --stat
```

Expected: the commit shows ~4 files changed: schema.ts, 0025_bypass_stake.sql, _journal.json, (maybe) 0025_snapshot.json.

---

## Phase 2 — Redirect `/app/stake` (Commit 2)

### Task 6: Replace `/app/stake/page.tsx` with a redirect

**Files:**
- Modify: `frontend/app/app/stake/page.tsx`

- [ ] **Step 1: Read current page.tsx**

Run:
```bash
cat frontend/app/app/stake/page.tsx
```

(Just to confirm there's nothing surprising; expected to import `Suspense`, `Guard`, `StakeClient` and render them.)

- [ ] **Step 2: Replace the entire file content**

Use the Write tool on `frontend/app/app/stake/page.tsx` with exactly this content:

```tsx
import { redirect } from "next/navigation";

/**
 * GHB-196: stake feature parked until the Anchor program is redeployed
 * (tracked in GHB-195). StakeClient.tsx is preserved as frozen code for
 * fast reactivation — restore this file by uncommenting the previous
 * implementation when GHB-195 lands.
 */
export default function StakePage() {
  redirect("/app/credentials");
}
```

- [ ] **Step 3: Verify**

Run:
```bash
cat frontend/app/app/stake/page.tsx
```

Expected: file matches the snippet above.

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: passes. The redirect import resolves, no dangling imports of StakeClient.

---

### Task 7: Local smoke test — `/app/stake` should redirect

**Files:** none (verification only)

- [ ] **Step 1: Stop any running dev servers**

```bash
pkill -f "next dev" 2>/dev/null
lsof -ti:3000 2>/dev/null | xargs -r kill -9
```

- [ ] **Step 2: Start frontend dev server in background**

Run from repo root:
```bash
pnpm --filter frontend dev > /tmp/frontend-dev.log 2>&1 &
sleep 8
tail -15 /tmp/frontend-dev.log
```

Expected: `✓ Ready in ...` in the log.

- [ ] **Step 3: Curl with `-i` (show headers) and NO `-L` (don't follow redirect)**

```bash
curl -sS -m 5 -i http://localhost:3000/app/stake 2>&1 | head -10
```

Expected: HTTP 307 (or 308) with `Location: /app/credentials` in the headers.

If you get a 200 OK, the redirect didn't take effect — check the file edit.

- [ ] **Step 4: Kill dev server**

```bash
pkill -f "next dev"
```

---

### Task 8: Commit the redirect (Commit 2 of 3)

**Files:** none

- [ ] **Step 1: Stage + commit**

```bash
git add frontend/app/app/stake/page.tsx
git commit -m "feat(frontend): redirect /app/stake to /app/credentials — GHB-196

Stake feature parked per GHB-195 (Anchor program redeploy pending).
StakeClient.tsx preserved as frozen code; only page.tsx changes to a
thin redirect so users with old bookmarks land somewhere sensible
instead of hitting a 404.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Drop `stakeRequired` UI gating (Commit 3)

### Task 9: Remove the `stakeRequired` banner from `CredentialsClient.tsx`

**Files:**
- Modify: `frontend/app/app/credentials/CredentialsClient.tsx:86-128`

- [ ] **Step 1: Read the current return block (lines 86-133)**

Run:
```bash
sed -n '86,133p' frontend/app/app/credentials/CredentialsClient.tsx
```

Expected: lines 86-128 contain the `const stakeRequired = ...` and the conditional banner block, followed by `<ApiKeysSection disabled={stakeRequired} />` and `<ConnectedAppsSection />`.

- [ ] **Step 2: Edit — remove `stakeRequired` derivation + banner block + `disabled` prop**

Use the Edit tool on `frontend/app/app/credentials/CredentialsClient.tsx`:

- `old_string`:
  ```
    const stakeRequired = profile.mcpStatus !== "active";

    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">MCP</div>
            <h1 className="dash-title">API &amp; Credentials</h1>
            <p className="dash-sub">
              Gestioná las credenciales que tus agentes usan para hablar con{" "}
              <code className="mono-inline">mcp.ghbounty.com</code>.
            </p>
          </div>
        </section>

        {stakeRequired && (
          <div
            role="status"
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255, 165, 0, 0.25)",
              background: "rgba(255, 165, 0, 0.06)",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              Activá tu cuenta de MCP para gestionar credenciales.
            </span>
            <Link href="/app/stake" className="btn btn-primary btn-sm">
              Stakear ahora
            </Link>
          </div>
        )}

        <ApiKeysSection disabled={stakeRequired} />

        <ConnectedAppsSection />
      </div>
    );
  ```
- `new_string`:
  ```
    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">MCP</div>
            <h1 className="dash-title">API &amp; Credentials</h1>
            <p className="dash-sub">
              Gestioná las credenciales que tus agentes usan para hablar con{" "}
              <code className="mono-inline">mcp.ghbounty.com</code>.
            </p>
          </div>
        </section>

        <ApiKeysSection />

        <ConnectedAppsSection />
      </div>
    );
  ```

- [ ] **Step 3: Remove now-unused `Link` import**

Run:
```bash
grep -n "from \"next/link\"" frontend/app/app/credentials/CredentialsClient.tsx
```

If `Link` is no longer used anywhere else in the file, remove the import line. Check usage first:

```bash
grep -n "<Link\b\|Link\." frontend/app/app/credentials/CredentialsClient.tsx
```

If only the import remains (no usages), Edit the file to remove:
- `old_string`: `import Link from "next/link";\n`
- `new_string`: `` (empty)

If there are other `<Link>` usages, leave the import alone.

- [ ] **Step 4: Update the file's docstring**

The header docstring (top of file) mentions the stake-required banner as item 2 of "Renders". Update that list:

Run:
```bash
sed -n '1,15p' frontend/app/app/credentials/CredentialsClient.tsx
```

Find the bullet that mentions "A persistent banner when `profile.mcp_status !== 'active'`" and either remove that bullet or change it to reflect the new state. Use Edit with surrounding context to make the change unique.

Specifically the `old_string` for the bullet is the line(s) starting with `* 2. A persistent banner when ...` — change it to reflect "no banner; status-aware UI removed pending GHB-195".

(If finding the exact original text is hard, this step can be deferred or marked as a follow-up cleanup. The code change is more important than the comment.)

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: passes. If TS complains about unused `Link` import, remove it now.

---

### Task 10: Remove `disabled` prop from `ApiKeysSection`

**Files:**
- Modify: `frontend/app/app/credentials/ApiKeysSection.tsx`

- [ ] **Step 1: Find the function signature**

Run:
```bash
grep -n "export function ApiKeysSection" frontend/app/app/credentials/ApiKeysSection.tsx
```

Expected output: a single line with `export function ApiKeysSection({ disabled }: { disabled: boolean }) {` (approximate).

- [ ] **Step 2: Edit signature — drop the `disabled` prop**

Use the Edit tool. The old signature is:

```tsx
export function ApiKeysSection({ disabled }: { disabled: boolean }) {
```

Replace with:

```tsx
export function ApiKeysSection() {
```

- [ ] **Step 3: Find all `disabled` references inside this file**

Run:
```bash
grep -n "disabled" frontend/app/app/credentials/ApiKeysSection.tsx
```

Expected: lines that pass `disabled` to the `<Button>` and to the `title` conditional. Remove both.

- [ ] **Step 4: Edit the Button block**

The Button currently looks like:

```tsx
<Button
  type="button"
  size="sm"
  disabled={disabled}
  onClick={() => setShowGenerate(true)}
  title={
    disabled
      ? "Activá tu cuenta de MCP primero para generar keys"
      : undefined
  }
>
  + Generar nueva key
</Button>
```

Replace with:

```tsx
<Button
  type="button"
  size="sm"
  onClick={() => setShowGenerate(true)}
>
  + Generar nueva key
</Button>
```

- [ ] **Step 5: Verify all `disabled` refs are gone**

Run:
```bash
grep -n "disabled" frontend/app/app/credentials/ApiKeysSection.tsx
```

Expected: no output (or only matches inside HTML `disabled={...}` for other unrelated controls — review each carefully).

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: passes. No `disabled` prop errors from CredentialsClient calling `<ApiKeysSection />` (because Task 9 already updated that call).

---

### Task 11: Audit `ConnectedAppsSection` for `disabled` prop

**Files:**
- Modify (conditionally): `frontend/app/app/credentials/ConnectedAppsSection.tsx`

- [ ] **Step 1: Check if `ConnectedAppsSection` accepts `disabled`**

Run:
```bash
grep -n "disabled" frontend/app/app/credentials/ConnectedAppsSection.tsx
grep -n "export function ConnectedAppsSection" frontend/app/app/credentials/ConnectedAppsSection.tsx
```

- [ ] **Step 2: If it does NOT have `disabled`**

Skip this task entirely. Run the next step's typecheck to confirm no issues.

- [ ] **Step 3: If it DOES have `disabled`**

Apply the same pattern as Task 10: remove from signature, remove from any Button/control that uses it.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

---

### Task 12: Update `/agents` landing — collapse the stake step

**Files:**
- Modify: `frontend/app/agents/page.tsx`

The public landing at `/agents` currently has three "Paso N" sections, with Paso 2 dedicated to the stake. With stake parked, the flow becomes 2 steps: signup → connect agent. Renumber accordingly.

- [ ] **Step 1: Read the current copy around lines 95-115**

Run:
```bash
sed -n '85,120p' frontend/app/agents/page.tsx
```

Confirm the layout: `Paso 2 — Activá tu cuenta` section followed by `Paso 3 — Conectá tu agente`.

- [ ] **Step 2: Remove the entire `Paso 2 — Activá tu cuenta` section**

Use the Edit tool. The exact old content is the whole `<div className={styles.section}>...</div>` block that wraps the `<h2>Paso 2 — Activá tu cuenta</h2>`. Remove it entirely (the block from the opening `<div className={styles.section}>` of Paso 2 to its closing `</div>`).

The next sibling (`<div className={styles.section}>` of "Paso 3 — Conectá tu agente") becomes the new Paso 2.

- [ ] **Step 3: Renumber "Paso 3" to "Paso 2"**

Edit:
- `old_string`: `<h2 className={styles.sectionTitle}>Paso 3 — Conectá tu agente</h2>`
- `new_string`: `<h2 className={styles.sectionTitle}>Paso 2 — Conectá tu agente</h2>`

- [ ] **Step 4: Look for any other references to "Paso 3" further down in the same file**

Run:
```bash
grep -n "Paso 3\|Paso 4" frontend/app/agents/page.tsx
```

If there's a "Paso 4" anywhere, renumber it to "Paso 3". Continue cascading if needed.

- [ ] **Step 5: Look for any stale references to `/app/stake` in the same file**

Run:
```bash
grep -n "/app/stake\|stake" frontend/app/agents/page.tsx
```

If anything remains, decide case by case: either remove or rephrase to remove the stake context.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

---

### Task 13: Local smoke test — credentials flow

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

```bash
pnpm --filter frontend dev > /tmp/frontend-dev.log 2>&1 &
sleep 8
tail -15 /tmp/frontend-dev.log
```

Expected: server boots cleanly.

- [ ] **Step 2: Smoke check the credentials route returns 200**

```bash
curl -sS -m 5 -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/app/credentials
```

Expected: HTTP 200 (or HTTP 307 if it redirects to auth — depends on whether you're logged in for the curl).

- [ ] **Step 3: Verify the `/agents` landing still renders**

```bash
curl -sS -m 5 http://localhost:3000/agents | grep -c "Paso"
```

Expected: 2 (Paso 1 + Paso 2). If 3, the renumber didn't happen.

- [ ] **Step 4: Kill dev server**

```bash
pkill -f "next dev"
```

---

### Task 14: Commit the UI cleanup (Commit 3 of 3)

**Files:** none

- [ ] **Step 1: Stage + commit**

```bash
git add frontend/app/app/credentials/CredentialsClient.tsx \
        frontend/app/app/credentials/ApiKeysSection.tsx \
        frontend/app/app/credentials/ConnectedAppsSection.tsx \
        frontend/app/agents/page.tsx
git commit -m "feat(frontend): drop stakeRequired gating in credentials UI — GHB-196

CredentialsClient.tsx: remove the 'Activá tu cuenta de MCP' banner and
the stakeRequired derivation. ApiKeysSection: drop the 'disabled' prop
and its consumers (Button disabled + tooltip). Audit ConnectedAppsSection
for the same prop (no-op if absent).

Public /agents landing: collapse the 'Paso 2 — Activá tu cuenta' stake
step; renumber 'Paso 3 — Conectá tu agente' as the new Paso 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Verification

### Task 15: Workspace typecheck + tests

**Files:** none

- [ ] **Step 1: Run workspace typecheck**

```bash
pnpm typecheck
```

Expected: all 7 packages pass.

- [ ] **Step 2: Run workspace tests**

```bash
pnpm test
```

Expected: all packages green. If a fixture in `packages/db/tests/` or `apps/mcp/tests/` asserts the old `'pending_stake'` default and fails: update the fixture to `'active'` and re-run.

If a test specifically tests the `pending_stake → active` transition via `/api/stake`: leave the test, it still passes because the endpoint code is unchanged.

---

### Task 16: Production build (frontend)

**Files:** none

- [ ] **Step 1: Build**

```bash
pnpm --filter frontend build
```

Expected: build succeeds. No errors about missing imports (StakeClient still exists; it's just not rendered from page.tsx anymore).

---

### Task 17: Sanity check the branch diff

**Files:** none

- [ ] **Step 1: List commits on the branch**

```bash
git log --oneline main..HEAD
```

Expected: ~4 commits (1 spec doc from earlier + 3 new commits from this plan).

- [ ] **Step 2: Diff stat**

```bash
git diff --stat main..HEAD
```

Expected files:
- `docs/superpowers/specs/2026-05-17-bypass-stake-mcp-status-design.md` (from the brainstorming commit)
- `docs/superpowers/plans/2026-05-17-bypass-stake-mcp-status.md` (this plan, if it was committed — see Task 18)
- `packages/db/src/schema.ts`
- `packages/db/drizzle/0025_bypass_stake.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/drizzle/meta/0025_snapshot.json` (if Drizzle generated it)
- `frontend/app/app/stake/page.tsx`
- `frontend/app/app/credentials/CredentialsClient.tsx`
- `frontend/app/app/credentials/ApiKeysSection.tsx`
- `frontend/app/app/credentials/ConnectedAppsSection.tsx` (maybe — only if Task 11 modified it)
- `frontend/app/agents/page.tsx`

If any unexpected file appears, investigate before opening the PR.

---

## Phase 5 — PR + human migration apply

### Task 18: Push branch and open PR (HUMAN CONSENT)

**Files:** none

This task requires explicit user consent (git push affects shared state).

- [ ] **Step 1: Push branch**

```bash
git push -u origin gastonfoncea09/ghb-196-bypass-stake-en-signup-mcp_statusactive-por-default-hasta
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: bypass stake — default mcp_status='active' (GHB-196)" --body "$(cat <<'EOF'
Closes [GHB-196](https://linear.app/ghbounty/issue/GHB-196). Related: [GHB-195](https://linear.app/ghbounty/issue/GHB-195) (re-enable stake when Anchor program redeployed).

## Summary

The on-chain \`init_stake_deposit\` instruction is missing from the Anchor program deployed in devnet — the binary predates the stake commits. Every new signup hits \`AnchorError: InstructionFallbackNotFound\` and gets stuck.

Until the program is redeployed (tracked separately in GHB-195), this PR parks the stake feature in the product: new profiles default to \`mcp_status='active'\` so they skip the stake step entirely.

## Changes

1. **DB migration** (\`packages/db/drizzle/0025_bypass_stake.sql\`) — change the DEFAULT of \`profiles.mcp_status\` from \`'pending_stake'\` to \`'active'\` and backfill existing \`'pending_stake'\` rows.
2. **Frontend redirect** (\`frontend/app/app/stake/page.tsx\`) — \`/app/stake\` now redirects to \`/app/credentials\`. \`StakeClient.tsx\` preserved as frozen code.
3. **UI cleanup** (\`CredentialsClient.tsx\`, \`ApiKeysSection.tsx\`, \`agents/page.tsx\`) — drop the \`stakeRequired\` banner, \`disabled\` prop, and collapse the stake step in the \`/agents\` landing.

## Frozen for reactivation (NOT touched)

- \`frontend/lib/stake-route-core.ts\` and \`frontend/app/api/stake/route.ts\`
- \`frontend/app/app/stake/StakeClient.tsx\`
- \`frontend/app/api/gas-station/sponsor/route.ts\` and \`packages/shared/src/gas-station/\`
- \`apps/mcp/lib/auth/middleware.ts\` (still rejects non-\`active\`, protecting \`suspended\`)
- All backend gates checking \`mcp_status === 'active'\`

## ⚠️ Migration: HUMAN APPLY REQUIRED

Per CLAUDE.md, CI does NOT run migrations. **Before or at merge time**, apply manually:

\`\`\`bash
DATABASE_URL=<prod-supabase-url> pnpm db:migrate
\`\`\`

The migration is wrapped in \`BEGIN; ... COMMIT;\` — atomic, safe to retry.

## Test plan

- [x] \`pnpm typecheck\` (workspace-wide) passes
- [x] \`pnpm test\` (workspace-wide) passes
- [x] \`pnpm --filter frontend build\` succeeds
- [x] Local \`/app/stake\` → 307 redirect to \`/app/credentials\`
- [x] Local \`/agents\` shows 2 "Paso" sections (was 3)
- [ ] Post-deploy + post-migration: signup new dev → lands on \`/app/credentials\` directly → mint API key → \`whoami\` against \`mcp.ghbounty.com\` returns \`mcp_status: 'active'\`

## Spec & plan

- Spec: \`docs/superpowers/specs/2026-05-17-bypass-stake-mcp-status-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-17-bypass-stake-mcp-status.md\`

## Reversal plan

When GHB-195 reactivates stake:

1. New migration: \`ALTER TABLE profiles ALTER COLUMN mcp_status SET DEFAULT 'pending_stake'\`
2. \`git revert\` commits 2 + 3 (un-redirect, restore banner/prop)
3. Total revert effort: ~30 min

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL to the user**

---

## Phase 6 — Post-merge (informational)

This phase is NOT part of the automated plan execution. It runs after the PR is merged.

- [ ] **HUMAN: Apply migration to prod Supabase**

```bash
# From your local machine, with DATABASE_URL pointing to prod Supabase:
pnpm db:migrate
```

Verify with a query:
```sql
SELECT mcp_status, COUNT(*) FROM profiles GROUP BY mcp_status;
```

Expected: no rows with `'pending_stake'`. Or only the rows you knew you wanted to keep there.

- [ ] **HUMAN: Smoke test on prod**

1. Open `https://ghbounty.com/app/auth/signup/dev` in incognito.
2. Sign up as a new dev. Confirm you land on `/app/credentials` (no `/app/stake` detour).
3. Mint an API key. Confirm the "Generate" button is enabled and there is no "Activá tu cuenta" banner.
4. Configure Claude Code MCP with the new key + `https://mcp.ghbounty.com/api/mcp/mcp`.
5. Call `whoami` — should return profile with `mcp_status: 'active'`.

If any step fails, open a hotfix issue immediately. Likely culprits: migration didn't apply, or a stale build is still cached.

---

## Self-review checklist (for the implementing engineer)

Before marking this plan complete:

1. **Migration is human-applied.** Don't auto-apply via CI. Don't push migrate from the agent.
2. **Stake code is preserved, not deleted.** `StakeClient.tsx`, `/api/stake`, gas-station files all stay.
3. **MCP middleware unchanged.** Don't touch `apps/mcp/lib/auth/middleware.ts` even though it looks related.
4. **Backend gates unchanged.** `api-keys-route-core.ts:103` and `oauth-authorize-core.ts:96` keep checking `'active'` — that's correct, no edits.
5. **`Link` import in CredentialsClient.tsx**: remove only if no other `<Link>` usages remain in the file.
6. **3 commits, not 1.** Each commit independently revertable.
7. **Pre-commit hook never bypassed.** Per CLAUDE.md.
