# MCP Frontend Onboarding — OAuth + API Keys + Stake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken 14-step agentic onboarding with web-based onboarding by merging `agent_accounts` into `profiles`, adding frontend-issued API keys (Stripe-style) and OAuth 2.1 with DCR+PKCE (Linear-MCP-style), and deleting the device-flow code path permanently.

**Architecture:** Single user identity lives in `profiles` (Privy DID). Frontend (`ghbounty.com`) issues credentials via Privy-authenticated routes; MCP (`mcp.ghbounty.com`) only validates Bearer tokens, dispatching by prefix (`ghbk_live_*` → api_keys table, `ghbo_live_*` → oauth_tokens table). OAuth uses Dynamic Client Registration (RFC 7591) + PKCE S256, no client secrets, no refresh tokens. Authorization codes live in a DB table with a 60s TTL.

**Tech Stack:** Next.js 15 App Router (frontend, MCP), Drizzle ORM + Supabase Postgres, pnpm workspaces, Vitest, bcrypt, Privy SDK, Solana web3.js, Anchor (existing stake program).

**Source spec:** `docs/superpowers/specs/2026-05-16-mcp-frontend-onboarding-design.md` — read this in full before starting; it is the source of truth for layout, copy, and error semantics.

**Migration policy:** SQL files are committed but **never auto-applied**. The implementor signals when SQL is ready; Gaston runs `npm run db:migrate` from local against devnet and confirms in PR thread before downstream tasks proceed.

---

## Phase 0 — Branch setup

### Task 0: Create feature branch

**Files:** none yet

- [ ] **Step 1: From `main`, create the feature branch**

```bash
git checkout main
git pull --rebase
git checkout -b gastonfoncea09/ghb-188-mcp-frontend-onboarding
```

- [ ] **Step 2: Confirm clean state**

Run: `git status`
Expected: `nothing to commit, working tree clean`

---

## Phase 1 — MCP cleanup (Days 1–2)

Delete the broken agentic-flow code first. Move shared key utilities to `packages/shared/`. After this phase, Sprint A's 4 read tools must still pass against the **current** (pre-migration) schema — the cleanup must not touch the `agent_accounts` lookup yet.

### Task 1: Delete device-flow and create-account tool files

**Files:**
- Delete: `apps/mcp/lib/tools/create-account/init.ts`
- Delete: `apps/mcp/lib/tools/create-account/poll.ts`
- Delete: `apps/mcp/lib/tools/create-account/complete.ts`
- Delete: `apps/mcp/lib/github/device-flow.ts`
- Delete: `apps/mcp/tests/tools/create-account.test.ts`
- Delete: `apps/mcp/tests/github/device-flow.test.ts`
- Delete: `apps/mcp/tests/e2e/onboarding.test.ts`

- [ ] **Step 1: Remove the files**

```bash
git rm apps/mcp/lib/tools/create-account/init.ts \
       apps/mcp/lib/tools/create-account/poll.ts \
       apps/mcp/lib/tools/create-account/complete.ts
git rm apps/mcp/lib/github/device-flow.ts
git rm apps/mcp/tests/tools/create-account.test.ts \
       apps/mcp/tests/github/device-flow.test.ts \
       apps/mcp/tests/e2e/onboarding.test.ts
# remove the directories if now empty
rmdir apps/mcp/lib/tools/create-account apps/mcp/lib/github 2>/dev/null || true
```

- [ ] **Step 2: Edit `apps/mcp/lib/tools/register.ts` — remove the 3 create-account registrations**

Open the file. Delete the three `server.registerTool("create_account.init", …)`, `…poll…`, `…complete…` blocks AND their imports at the top of the file. The remaining registrations are exactly: `whoami`, `bounties.list`, `bounties.get`, `submissions.get`.

- [ ] **Step 3: Run `grep` to confirm nothing else references the deleted code**

Run: `grep -rE "device-flow|create_account\.(init|poll|complete)|create-account/" apps/mcp/`
Expected: zero matches.

- [ ] **Step 4: Run MCP test suite**

Run: `pnpm --filter @ghbounty/mcp test`
Expected: PASS. (Only the 4 read tools + middleware + api-key suites should remain.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/mcp/
git commit -m "chore(mcp): delete device-flow + create-account tools — GHB-188"
```

### Task 2: Move `mintApiKey` to `packages/shared/`

**Files:**
- Create: `packages/shared/src/api-key.ts`
- Create: `packages/shared/tests/api-key.test.ts`
- Modify: `packages/shared/src/index.ts` (export new module)
- Modify: `apps/mcp/lib/auth/api-key.ts` (becomes a thin re-export of `@ghbounty/shared`)
- Modify: `apps/mcp/lib/auth/middleware.ts` (import from re-export — no functional change)

- [ ] **Step 1: Copy the existing test to `packages/shared/tests/api-key.test.ts`**

Read `apps/mcp/tests/auth/api-key.test.ts` verbatim, copy contents to the new path, change the import to:

```ts
import { mintApiKey, extractPrefix, verifyApiKey } from "../src/api-key";
```

- [ ] **Step 2: Run the new test — expect failure (module missing)**

Run: `pnpm --filter @ghbounty/shared test tests/api-key.test.ts`
Expected: FAIL with "Cannot find module ../src/api-key".

- [ ] **Step 3: Create `packages/shared/src/api-key.ts`**

Move the implementation verbatim from `apps/mcp/lib/auth/api-key.ts`. Confirmed exports:

```ts
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export interface MintedKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

const PREFIX_LITERAL = "ghbk_live_";
const PREFIX_LEN = PREFIX_LITERAL.length + 12; // "ghbk_live_" + 12 hex chars
const RANDOM_HEX_LEN = 32; // 16 bytes -> 32 hex chars after the literal prefix
const BCRYPT_ROUNDS = 10;

export function mintApiKey(): MintedKey {
  const hex = randomBytes(RANDOM_HEX_LEN / 2).toString("hex");
  const plaintext = `${PREFIX_LITERAL}${hex}`;
  const prefix = plaintext.slice(0, PREFIX_LEN);
  const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
  return { plaintext, prefix, hash };
}

export function extractPrefix(plaintext: string): string {
  if (!plaintext.startsWith(PREFIX_LITERAL) || plaintext.length < PREFIX_LEN) {
    throw new Error("Invalid api key format");
  }
  return plaintext.slice(0, PREFIX_LEN);
}

export function verifyApiKey(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}
```

If the original differs in any constant, preserve the original. The point is *move without behavior change*.

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

Add the line:
```ts
export * from "./api-key";
```

- [ ] **Step 5: Make `apps/mcp/lib/auth/api-key.ts` a thin re-export**

Replace its entire contents with:
```ts
export { mintApiKey, extractPrefix, verifyApiKey, type MintedKey } from "@ghbounty/shared";
```

- [ ] **Step 6: Run BOTH test suites**

Run: `pnpm --filter @ghbounty/shared test && pnpm --filter @ghbounty/mcp test`
Expected: BOTH PASS. The MCP api-key test (still present at `apps/mcp/tests/auth/api-key.test.ts`) now tests the re-export, which is fine.

- [ ] **Step 7: Delete the duplicate test from MCP**

```bash
git rm apps/mcp/tests/auth/api-key.test.ts
```

Re-run: `pnpm --filter @ghbounty/mcp test` — PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages/shared/ apps/mcp/
git commit -m "refactor(shared): move mintApiKey to @ghbounty/shared — GHB-188"
```

### Task 3: Add `mintOAuthToken` to `packages/shared/`

**Files:**
- Create: `packages/shared/src/oauth-token.ts`
- Create: `packages/shared/tests/oauth-token.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/oauth-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mintOAuthToken, extractOAuthTokenPrefix, verifyOAuthToken } from "../src/oauth-token";

describe("mintOAuthToken", () => {
  it("produces a token starting with 'ghbo_live_' and a 22-char prefix", () => {
    const k = mintOAuthToken();
    expect(k.plaintext.startsWith("ghbo_live_")).toBe(true);
    expect(k.plaintext.length).toBe("ghbo_live_".length + 32);
    expect(k.prefix.length).toBe("ghbo_live_".length + 12);
    expect(k.prefix).toBe(k.plaintext.slice(0, k.prefix.length));
  });

  it("hash verifies the plaintext", () => {
    const k = mintOAuthToken();
    expect(verifyOAuthToken(k.plaintext, k.hash)).toBe(true);
    expect(verifyOAuthToken(k.plaintext + "x", k.hash)).toBe(false);
  });

  it("extractOAuthTokenPrefix returns the 22-char prefix", () => {
    const k = mintOAuthToken();
    expect(extractOAuthTokenPrefix(k.plaintext)).toBe(k.prefix);
  });

  it("extractOAuthTokenPrefix throws on wrong literal prefix", () => {
    expect(() => extractOAuthTokenPrefix("ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow();
  });

  it("extractOAuthTokenPrefix throws on too short input", () => {
    expect(() => extractOAuthTokenPrefix("ghbo_live_ab")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @ghbounty/shared test tests/oauth-token.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/shared/src/oauth-token.ts`**

```ts
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export interface MintedOAuthToken {
  plaintext: string;
  prefix: string;
  hash: string;
}

const PREFIX_LITERAL = "ghbo_live_";
const PREFIX_LEN = PREFIX_LITERAL.length + 12;
const RANDOM_HEX_LEN = 32;
const BCRYPT_ROUNDS = 10;

export function mintOAuthToken(): MintedOAuthToken {
  const hex = randomBytes(RANDOM_HEX_LEN / 2).toString("hex");
  const plaintext = `${PREFIX_LITERAL}${hex}`;
  const prefix = plaintext.slice(0, PREFIX_LEN);
  const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
  return { plaintext, prefix, hash };
}

export function extractOAuthTokenPrefix(plaintext: string): string {
  if (!plaintext.startsWith(PREFIX_LITERAL) || plaintext.length < PREFIX_LEN) {
    throw new Error("Invalid OAuth token format");
  }
  return plaintext.slice(0, PREFIX_LEN);
}

export function verifyOAuthToken(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

Add:
```ts
export * from "./oauth-token";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `pnpm --filter @ghbounty/shared test tests/oauth-token.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add mintOAuthToken with ghbo_live_ prefix — GHB-188"
```

### Task 4: Sanity check — Sprint A read tools still pass

- [ ] **Step 1: Run full MCP test suite**

Run: `pnpm --filter @ghbounty/mcp test`
Expected: PASS for `auth/middleware`, `tools/whoami`, `tools/bounties`, `tools/submissions`.

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm -r run typecheck` (or whichever script the workspace uses — adjust if scripts are named `tsc --noEmit`).
Expected: no TS errors. If imports broke after the device-flow delete, fix the offending file (likely a leftover import in a now-empty index).

No commit (no changes made).

---

## Phase 2 — DB migration in lockstep with MCP middleware update (Days 3–4)

This phase has a critical sequencing constraint baked into it: **migration SQL is committed first; Gaston runs it manually; THEN the MCP middleware is updated in the same window**. The migration changes the FK target from `agent_accounts.id` to `profiles.user_id`, so the middleware's join must change at the same time or every tool call returns `Unauthorized`.

### Task 5: Drizzle schema updates (`packages/db/src/schema.ts`)

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Read the current schema and plan the diffs**

Run: `pnpm dlx tsx -e 'import("./packages/db/src/schema").then(()=>{})'` (not strictly needed — just confirms the file imports). Then open the file in the editor.

- [ ] **Step 2: Extend `profiles` with the 4 new columns**

In the `profiles` table definition, add (anywhere appropriate inside the column list, before timestamps):

```ts
  mcpStatus: agentStatusEnum("mcp_status").notNull().default("pending_stake"),
  warnings: smallint("warnings").notNull().default(0),
  githubHandle: text("github_handle").unique(),
  walletPubkey: text("wallet_pubkey").unique(),
```

Ensure `smallint` is imported from `drizzle-orm/pg-core` at the top of the file.

- [ ] **Step 3: Modify `apiKeys` table — replace `agentAccountId` FK with `userId`, add `name` and `expiresAt`**

Replace:
```ts
  agentAccountId: uuid("agent_account_id").notNull().references(() => agentAccounts.id, { onDelete: "cascade" }),
```
With:
```ts
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
```

- [ ] **Step 4: Modify `stakeDeposits`, `pendingTxs`, `slashingEvents` — replace `agentAccountId` with `userId`**

For each of the three tables, swap the FK column the same way as Step 3 (without adding `name`/`expiresAt`).

- [ ] **Step 5: Add three new tables — `oauthClients`, `oauthTokens`, `oauthCodes`**

At the end of the schema file, add:

```ts
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: text("scopes").array().notNull().default(sql`ARRAY['full']::text[]`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  prefixIdx: index("oauth_tokens_prefix_idx").on(t.tokenPrefix),
}));

export const oauthCodes = pgTable("oauth_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
  codeChallenge: text("code_challenge").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope").notNull().default("full"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  expiresIdx: index("oauth_codes_expires_idx").on(t.expiresAt),
}));
```

Ensure `index` and `sql` are imported from `drizzle-orm` / `drizzle-orm/pg-core` at the top.

- [ ] **Step 6: Remove `agentAccounts` export at the BOTTOM of the file (after data migration, it will be dropped)**

Do NOT delete the `agentAccounts` table definition yet — `0023` still needs it for the data-migration step. Leave it in place; it will be removed in Task 8 after both migration SQL files are in.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @ghbounty/db run typecheck` (or `tsc --noEmit` from that package).
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): extend profiles + new oauth tables in Drizzle schema — GHB-188"
```

### Task 6: Migration `0023_mcp_identity_merge.sql`

**Files:**
- Create: `packages/db/drizzle/0023_mcp_identity_merge.sql`

This migration is additive + data-copy + FK swap. It assumes Gaston has wiped `agent_accounts`/`api_keys`/`stake_deposits`/`pending_txs`/`slashing_events` rows pre-flight, so the data-copy step is a no-op in practice but is still written for correctness.

- [ ] **Step 1: Write the migration**

```sql
-- GHB-188: merge agent_accounts into profiles. Additive + data-copy + FK swap.
-- Pre-flight: Gaston wipes existing test rows from agent_accounts and the four
-- FK-bearing tables on devnet before running this. With sources empty the data
-- step is a no-op; it is included so the SQL is correct if reused later.

BEGIN;

-- 1. Add new columns to profiles.
ALTER TABLE profiles
  ADD COLUMN mcp_status agent_status NOT NULL DEFAULT 'pending_stake',
  ADD COLUMN warnings smallint NOT NULL DEFAULT 0,
  ADD COLUMN github_handle text,
  ADD COLUMN wallet_pubkey text;

ALTER TABLE profiles ADD CONSTRAINT profiles_github_handle_unique UNIQUE (github_handle);
ALTER TABLE profiles ADD CONSTRAINT profiles_wallet_pubkey_unique UNIQUE (wallet_pubkey);

-- 2. Best-effort data migration from agent_accounts → profiles.
--    Only rows where the agent_account has a profile (matched by wallet_pubkey
--    in profiles, or by some external mapping) are copied. With the pre-flight
--    wipe this is a no-op.
--    NOTE: leaving this as a placeholder; the pre-flight makes it unnecessary.
--    If you ever re-run on populated tables, write a UPDATE that joins on
--    wallet_pubkey and copies status → mcp_status, warnings, github_handle,
--    wallet_pubkey.

-- 3. Swap FKs on api_keys, stake_deposits, pending_txs, slashing_events.
--    These tables are empty (per pre-flight), so we can drop the old FK column
--    and add the new one cleanly.

ALTER TABLE api_keys
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
  ADD COLUMN name text,
  ADD COLUMN expires_at timestamptz;
-- Backfill user_id would go here if there were data. For empty tables, NOT NULL
-- can be added directly:
ALTER TABLE api_keys ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE api_keys DROP COLUMN agent_account_id;

ALTER TABLE stake_deposits
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE stake_deposits ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE stake_deposits DROP COLUMN agent_account_id;

ALTER TABLE pending_txs
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE pending_txs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pending_txs DROP COLUMN agent_account_id;

ALTER TABLE slashing_events
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE slashing_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE slashing_events DROP COLUMN agent_account_id;

-- 4. New OAuth tables.
CREATE TABLE oauth_clients (
  id           text        PRIMARY KEY,
  client_name  text        NOT NULL,
  redirect_uris text[]     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id     text        NOT NULL REFERENCES oauth_clients(id)  ON DELETE CASCADE,
  name          text        NOT NULL,
  token_hash    text        NOT NULL,
  token_prefix  text        NOT NULL,
  scopes        text[]      NOT NULL DEFAULT ARRAY['full']::text[],
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_prefix_idx ON oauth_tokens(token_prefix);

CREATE TABLE oauth_codes (
  code           text        PRIMARY KEY,
  user_id        text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id      text        NOT NULL REFERENCES oauth_clients(id)  ON DELETE CASCADE,
  code_challenge text        NOT NULL,
  redirect_uri   text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'full',
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_codes_expires_idx ON oauth_codes(expires_at);

COMMIT;
```

- [ ] **Step 2: Commit (do not run yet)**

```bash
git add packages/db/drizzle/0023_mcp_identity_merge.sql
git commit -m "feat(db): 0023 mcp identity merge migration — GHB-188"
```

### Task 7: Migration `0024_mcp_rls_rebuild.sql`

**Files:**
- Create: `packages/db/drizzle/0024_mcp_rls_rebuild.sql`

- [ ] **Step 1: Write the migration**

```sql
-- GHB-188: rebuild RLS policies after identity merge. Drops old policies that
-- referenced agent_accounts; recreates them against profiles.user_id matching
-- the Privy DID in auth.jwt() ->> 'sub'. Finally drops the now-orphaned
-- agent_accounts table.

BEGIN;

-- Drop all policies referencing agent_accounts on the four FK-bearing tables.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE tablename IN ('api_keys','stake_deposits','pending_txs','slashing_events')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Recreate user-owned policies on the four tables.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_owner_select ON api_keys
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY api_keys_owner_delete ON api_keys
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');
-- INSERT only via service_role (frontend mint endpoint).

ALTER TABLE stake_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY stake_deposits_owner_select ON stake_deposits
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

ALTER TABLE pending_txs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_txs_owner_select ON pending_txs
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

ALTER TABLE slashing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY slashing_events_owner_select ON slashing_events
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

-- OAuth tables RLS.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_clients_public_read ON oauth_clients
  FOR SELECT USING (true);
-- INSERT/UPDATE/DELETE only via service_role.

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_tokens_owner_select ON oauth_tokens
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY oauth_tokens_owner_delete ON oauth_tokens
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');
-- INSERT only via service_role.

ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service_role only.

-- Drop the now-orphaned table.
DROP TABLE IF EXISTS agent_accounts CASCADE;

-- Reload PostgREST schema cache (lesson from GHB-191).
NOTIFY pgrst, 'reload schema';

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/drizzle/0024_mcp_rls_rebuild.sql
git commit -m "feat(db): 0024 mcp rls rebuild migration — GHB-188"
```

### Task 8: Remove `agentAccounts` from Drizzle schema (post-migration)

This task happens AFTER Gaston confirms the migrations ran. The Drizzle schema must reflect the post-migration state to keep `db:generate` honest.

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **STOP — wait for Gaston's PR-thread confirmation that `0023` + `0024` ran on devnet.**

Do not proceed until Gaston posts confirmation. If you skip this gate, `db:generate` will diverge from the live schema and the next migration will conflict.

- [ ] **Step 1: Delete the `agentAccounts` table block and the `agentRoleEnum` export**

Open `packages/db/src/schema.ts`. Delete the entire `export const agentAccounts = pgTable("agent_accounts", { … })` block. If `agentRoleEnum` (a `pgEnum` declared specifically for `agentAccounts.role`) is no longer referenced anywhere else in the schema, delete it too.

**Keep** `agentStatusEnum` — it is now used by `profiles.mcpStatus`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ghbounty/db run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "chore(db): drop agentAccounts from schema after 0023/0024 — GHB-188"
```

### Task 9: Migration integration test

**Files:**
- Create: `packages/db/tests/migration.test.ts`

This test re-applies `0023` + `0024` to a fresh test database, then asserts schema invariants. It only runs locally (CI does not run migrations).

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_URL = process.env.TEST_DB_URL; // skip if unset

describe.skipIf(!TEST_DB_URL)("migrations 0023 + 0024", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB_URL });
    await client.connect();
    // Caller is responsible for resetting the DB to a state at migration 0022.
  });

  it("0023 creates the new columns and tables", async () => {
    const sql = readFileSync(join(__dirname, "../drizzle/0023_mcp_identity_merge.sql"), "utf8");
    await client.query(sql);

    const { rows: profileCols } = await client.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'profiles'
         AND column_name IN ('mcp_status','warnings','github_handle','wallet_pubkey')
    `);
    expect(profileCols.map(r => r.column_name).sort()).toEqual(
      ["github_handle","mcp_status","wallet_pubkey","warnings"].sort()
    );

    const { rows: oauthTables } = await client.query(`
      SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('oauth_clients','oauth_tokens','oauth_codes')
    `);
    expect(oauthTables.length).toBe(3);
  });

  it("0024 drops agent_accounts and creates RLS policies on user_id", async () => {
    const sql = readFileSync(join(__dirname, "../drizzle/0024_mcp_rls_rebuild.sql"), "utf8");
    await client.query(sql);

    const { rows: aa } = await client.query(`
      SELECT to_regclass('agent_accounts') AS reg
    `);
    expect(aa[0].reg).toBeNull();

    const { rows: pol } = await client.query(`
      SELECT policyname FROM pg_policies
       WHERE tablename = 'api_keys' AND policyname = 'api_keys_owner_select'
    `);
    expect(pol.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test (skipped without TEST_DB_URL)**

Run: `pnpm --filter @ghbounty/db test tests/migration.test.ts`
Expected: skipped if no `TEST_DB_URL`, otherwise PASS. (Local-only verification.)

- [ ] **Step 3: Commit**

```bash
git add packages/db/tests/migration.test.ts
git commit -m "test(db): integration test for 0023/0024 — GHB-188"
```

### Task 10: Rename `AgentAccount` → `MCPProfile` and update read-tool handlers

**Files:**
- Modify: `apps/mcp/lib/tools/types.ts`
- Modify: `apps/mcp/lib/tools/whoami.ts`
- Modify: `apps/mcp/lib/tools/bounties/list.ts`
- Modify: `apps/mcp/lib/tools/bounties/get.ts`
- Modify: `apps/mcp/lib/tools/submissions/get.ts`
- Modify: every test under `apps/mcp/tests/tools/`

- [ ] **Step 1: Edit `apps/mcp/lib/tools/types.ts`**

Replace the `AgentAccount` interface with:

```ts
export interface MCPProfile {
  user_id: string;          // Privy DID
  role: "company" | "dev";
  mcp_status: "pending_stake" | "active" | "suspended" | "revoked" | "pending_oauth";
  wallet_pubkey: string | null;
  github_handle: string | null;
}

export type AuthResult =
  | { ok: true; profile: MCPProfile; credentialId: string; credentialKind: "api_key" | "oauth_token" }
  | { ok: false; error: { code: "Unauthorized" | "Forbidden"; message: string } };
```

- [ ] **Step 2: Edit each read tool handler**

In each of `whoami.ts`, `bounties/list.ts`, `bounties/get.ts`, `submissions/get.ts`:
- Rename the imported type `AgentAccount` → `MCPProfile` and the handler parameter `agent` → `profile`.
- Replace field accesses: `agent.id` → `profile.user_id`, `agent.status` → `profile.mcp_status`, others unchanged.

- [ ] **Step 3: Update tests in `apps/mcp/tests/tools/`**

In `whoami.test.ts`, `bounties.test.ts`, `submissions.test.ts`: substitute the `AgentAccount` fixture with the `MCPProfile` shape:

```ts
const profile: MCPProfile = {
  user_id: "did:privy:test_user",
  role: "dev",
  mcp_status: "active",
  wallet_pubkey: "7xKaPnD…",
  github_handle: "testdev",
};
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ghbounty/mcp run typecheck`
Expected: PASS.

- [ ] **Step 5: Run tool tests**

Run: `pnpm --filter @ghbounty/mcp test tests/tools/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/
git commit -m "refactor(mcp): rename AgentAccount → MCPProfile in tools — GHB-188"
```

### Task 11: Update `apps/mcp/lib/auth/middleware.ts` to query via `profiles`

**Files:**
- Modify: `apps/mcp/lib/auth/middleware.ts`
- Modify: `apps/mcp/tests/auth/middleware.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/mcp/tests/auth/middleware.test.ts`, add (or update) a case that asserts the join via `profiles` and the new return shape:

```ts
it("returns MCPProfile and credentialKind 'api_key' for a valid ghbk_live_ token", async () => {
  const minted = mintApiKey();
  // mock supabase: return api_keys row joined to profiles row with mcp_status='active'
  const result = await authenticate(`Bearer ${minted.plaintext}`);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.credentialKind).toBe("api_key");
    expect(result.profile.user_id).toBe("did:privy:test_user");
    expect(result.profile.mcp_status).toBe("active");
  }
});

it("rejects token when profiles.mcp_status !== 'active'", async () => {
  // mock supabase: return row with mcp_status='pending_stake'
  const minted = mintApiKey();
  const result = await authenticate(`Bearer ${minted.plaintext}`);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("Forbidden");
  }
});
```

If the existing tests mock `supabase.from("api_keys")` with the old join string, update them to expect `"id, key_hash, user_id, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)"`.

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @ghbounty/mcp test tests/auth/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the new `authenticate()`**

Replace the body of `authenticate()` in `apps/mcp/lib/auth/middleware.ts` with:

```ts
import { extractPrefix, verifyApiKey } from "@ghbounty/shared";
import { supabaseAdmin } from "../supabase";
import type { AuthResult, MCPProfile } from "../tools/types";

export async function authenticate(authorizationHeader: string | undefined): Promise<AuthResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, error: { code: "Unauthorized", message: "Missing or malformed Authorization header" } };
  }
  const plaintext = authorizationHeader.slice("Bearer ".length).trim();
  if (plaintext.startsWith("ghbk_live_")) return authenticateApiKey(plaintext);
  // ghbo_live_ branch is added in Task 27.
  return { ok: false, error: { code: "Unauthorized", message: "Invalid token format" } };
}

async function authenticateApiKey(plaintext: string): Promise<AuthResult> {
  let prefix: string;
  try {
    prefix = extractPrefix(plaintext);
  } catch {
    return { ok: false, error: { code: "Unauthorized", message: "Invalid API key format" } };
  }
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, key_hash, user_id, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)")
    .eq("key_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: { code: "Unauthorized", message: "Authentication lookup failed" } };
  if (!data) return { ok: false, error: { code: "Unauthorized", message: "API key not found" } };
  if (!verifyApiKey(plaintext, (data as any).key_hash)) {
    return { ok: false, error: { code: "Unauthorized", message: "API key mismatch" } };
  }
  const rawProfile = (data as any).profiles;
  const profileRow = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  if (!profileRow) return { ok: false, error: { code: "Unauthorized", message: "Profile record missing" } };
  if (profileRow.mcp_status !== "active") {
    return { ok: false, error: { code: "Forbidden", message: `Account is ${profileRow.mcp_status}, not active` } };
  }
  const profile: MCPProfile = {
    user_id: profileRow.user_id,
    role: profileRow.role,
    mcp_status: profileRow.mcp_status,
    wallet_pubkey: profileRow.wallet_pubkey,
    github_handle: profileRow.github_handle,
  };
  // fire-and-forget last_used_at update
  supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", (data as any).id).then(() => {});
  return { ok: true, profile, credentialId: (data as any).id, credentialKind: "api_key" };
}
```

Update callers of `authenticate()` (search `result.agent` in `apps/mcp/lib/`) to read `result.profile` and pass it to tool handlers.

- [ ] **Step 4: Run middleware tests — expect PASS**

Run: `pnpm --filter @ghbounty/mcp test tests/auth/middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full MCP suite + typecheck**

Run: `pnpm --filter @ghbounty/mcp test && pnpm --filter @ghbounty/mcp run typecheck`
Expected: BOTH PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/
git commit -m "feat(mcp): authenticate() queries profiles via api_keys.user_id — GHB-188"
```

---

## Phase 3 — Frontend stake + API keys (Days 5–7)

Build the simplest credential-issuance UX: a stake page that flips `mcp_status` to `active`, and a credentials page that mints/lists/revokes API keys.

### Task 12: `POST /api/stake` route

**Files:**
- Create: `frontend/lib/stake-route-core.ts`
- Create: `frontend/tests/stake-route-core.test.ts`
- Create: `frontend/app/api/stake/route.ts`

The pattern (see `frontend/app/api/gas-station/sponsor/route.ts`): logic lives in `*-route-core.ts`, tested directly; the route handler is a thin wrapper that resolves Privy auth.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/stake-route-core.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleStakeConfirmation } from "../lib/stake-route-core";

describe("handleStakeConfirmation", () => {
  it("inserts stake_deposit row and flips profile mcp_status to active", async () => {
    const supabase = mockSupabase({ profiles: [{ user_id: "u1", wallet_pubkey: "WALLET", mcp_status: "pending_stake" }] });
    const result = await handleStakeConfirmation(supabase, {
      user_id: "u1",
      wallet_pubkey: "WALLET",
      tx_signature: "TX",
      pda: "PDA",
      locked_until: new Date(Date.now() + 14 * 24 * 3600e3),
    });
    expect(result.ok).toBe(true);
    expect(supabase.tables.stake_deposits[0].user_id).toBe("u1");
    expect(supabase.tables.profiles[0].mcp_status).toBe("active");
  });

  it("rejects when wallet_pubkey does not match profile", async () => {
    const supabase = mockSupabase({ profiles: [{ user_id: "u1", wallet_pubkey: "WALLET", mcp_status: "pending_stake" }] });
    const result = await handleStakeConfirmation(supabase, {
      user_id: "u1",
      wallet_pubkey: "WRONG",
      tx_signature: "TX",
      pda: "PDA",
      locked_until: new Date(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("wallet_mismatch");
  });

  it("rejects when already active", async () => {
    const supabase = mockSupabase({ profiles: [{ user_id: "u1", wallet_pubkey: "WALLET", mcp_status: "active" }] });
    const result = await handleStakeConfirmation(supabase, {
      user_id: "u1", wallet_pubkey: "WALLET", tx_signature: "TX", pda: "PDA", locked_until: new Date(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already_staked");
  });
});

// minimal supabase mock — adapt the shape to whatever fits the codebase's existing test helpers.
function mockSupabase(seed: { profiles: any[] }) { /* ... */ }
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @ghbounty/frontend test tests/stake-route-core.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `frontend/lib/stake-route-core.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface StakeConfirmationInput {
  user_id: string;
  wallet_pubkey: string;
  tx_signature: string;
  pda: string;
  locked_until: Date;
}

export type StakeResult =
  | { ok: true }
  | { ok: false; error: "wallet_mismatch" | "already_staked" | "profile_missing" | "db_error" };

export async function handleStakeConfirmation(
  supabase: SupabaseClient,
  input: StakeConfirmationInput,
): Promise<StakeResult> {
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, wallet_pubkey, mcp_status")
    .eq("user_id", input.user_id)
    .maybeSingle();
  if (pErr) return { ok: false, error: "db_error" };
  if (!profile) return { ok: false, error: "profile_missing" };
  if (profile.wallet_pubkey !== input.wallet_pubkey) return { ok: false, error: "wallet_mismatch" };
  if (profile.mcp_status === "active") return { ok: false, error: "already_staked" };

  const { error: insErr } = await supabase.from("stake_deposits").insert({
    user_id: input.user_id,
    pda: input.pda,
    tx_signature: input.tx_signature,
    status: "active",
    locked_until: input.locked_until.toISOString(),
  });
  if (insErr) return { ok: false, error: "db_error" };

  const { error: upErr } = await supabase
    .from("profiles")
    .update({ mcp_status: "active" })
    .eq("user_id", input.user_id);
  if (upErr) return { ok: false, error: "db_error" };

  return { ok: true };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @ghbounty/frontend test tests/stake-route-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the route handler `frontend/app/api/stake/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { handleStakeConfirmation } from "@/lib/stake-route-core";

const Body = z.object({
  wallet_pubkey: z.string().min(32),
  tx_signature: z.string().min(64),
  pda: z.string().min(32),
  locked_until: z.string().datetime(),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }
  const user_id = await resolveUserIdFromPrivy(authHeader.slice("Bearer ".length));
  if (!user_id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await handleStakeConfirmation(supabaseAdmin(), {
    user_id,
    wallet_pubkey: parsed.data.wallet_pubkey,
    tx_signature: parsed.data.tx_signature,
    pda: parsed.data.pda,
    locked_until: new Date(parsed.data.locked_until),
  });
  if (!result.ok) {
    const status = result.error === "already_staked" ? 409 : result.error === "wallet_mismatch" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
```

(If `resolveUserIdFromPrivy` does not exist as a helper, create it — it should take a Privy access token and return the Privy DID `sub`, leveraging `verifyAndMintToken` from `frontend/lib/privy-bridge-core.ts` or its underlying JWKS verification.)

- [ ] **Step 6: Smoke test the route locally**

Run dev server: `pnpm --filter @ghbounty/frontend dev`
Use a logged-in Privy session to POST `/api/stake` with valid input; expect `200 {ok:true}`. Verify `profiles.mcp_status` flipped via Supabase studio.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/stake confirms tx + flips mcp_status — GHB-188"
```

### Task 13: `GET /api/api-keys` route

**Files:**
- Create: `frontend/lib/api-keys-route-core.ts`
- Create: `frontend/tests/api-keys-route-core.test.ts`
- Create: `frontend/app/api/api-keys/route.ts`

- [ ] **Step 1: Write the failing test for `listApiKeys`**

```ts
// frontend/tests/api-keys-route-core.test.ts
import { describe, it, expect } from "vitest";
import { listApiKeys } from "../lib/api-keys-route-core";

describe("listApiKeys", () => {
  it("returns only keys owned by the caller, without hashes", async () => {
    const supabase = mockSupabase({
      api_keys: [
        { id: "k1", user_id: "u1", name: "laptop", key_hash: "secret", key_prefix: "ghbk_live_abc",
          created_at: "2026-04-12", last_used_at: null, revoked_at: null },
        { id: "k2", user_id: "u2", name: "other", key_hash: "secret", key_prefix: "ghbk_live_xyz",
          created_at: "2026-04-12", last_used_at: null, revoked_at: null },
      ],
    });
    const keys = await listApiKeys(supabase, "u1");
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty("key_hash");
    expect(keys[0].id).toBe("k1");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `listApiKeys`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function listApiKeys(supabase: SupabaseClient, user_id: string): Promise<ApiKeySummary[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApiKeySummary[];
}
```

- [ ] **Step 4: Add the route handler `frontend/app/api/api-keys/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { listApiKeys, createApiKey } from "@/lib/api-keys-route-core";

async function authed(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return resolveUserIdFromPrivy(h.slice("Bearer ".length));
}

export async function GET(req: NextRequest) {
  const user_id = await authed(req);
  if (!user_id) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const keys = await listApiKeys(supabaseAdmin(), user_id);
  return NextResponse.json({ keys });
}

// POST handler added in Task 14
```

- [ ] **Step 5: Test passes**

Run: `pnpm --filter @ghbounty/frontend test tests/api-keys-route-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): GET /api/api-keys returns user's keys — GHB-188"
```

### Task 14: `POST /api/api-keys` route (mint + reveal once)

**Files:**
- Modify: `frontend/lib/api-keys-route-core.ts` (add `createApiKey`)
- Modify: `frontend/tests/api-keys-route-core.test.ts`
- Modify: `frontend/app/api/api-keys/route.ts` (add `POST`)

- [ ] **Step 1: Write the failing test**

```ts
import { createApiKey } from "../lib/api-keys-route-core";

describe("createApiKey", () => {
  it("mints, stores hash+prefix, returns plaintext exactly once", async () => {
    const supabase = mockSupabase({
      profiles: [{ user_id: "u1", mcp_status: "active" }],
      api_keys: [],
    });
    const result = await createApiKey(supabase, { user_id: "u1", name: "laptop" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plaintext.startsWith("ghbk_live_")).toBe(true);
    expect(supabase.tables.api_keys[0].name).toBe("laptop");
    expect(supabase.tables.api_keys[0].key_hash).not.toBe(result.plaintext);
  });
  it("rejects when mcp_status !== 'active'", async () => {
    const supabase = mockSupabase({ profiles: [{ user_id: "u1", mcp_status: "pending_stake" }], api_keys: [] });
    const result = await createApiKey(supabase, { user_id: "u1", name: "laptop" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("stake_required");
  });
  it("rejects empty / too-long names", async () => {
    const supabase = mockSupabase({ profiles: [{ user_id: "u1", mcp_status: "active" }], api_keys: [] });
    expect((await createApiKey(supabase, { user_id: "u1", name: "" })).ok).toBe(false);
    expect((await createApiKey(supabase, { user_id: "u1", name: "x".repeat(65) })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `createApiKey`**

Append to `frontend/lib/api-keys-route-core.ts`:

```ts
import { mintApiKey } from "@ghbounty/shared";

export type CreateApiKeyResult =
  | { ok: true; id: string; name: string; key_prefix: string; plaintext: string }
  | { ok: false; error: "stake_required" | "invalid_name" | "db_error" | "profile_missing" };

export async function createApiKey(
  supabase: SupabaseClient,
  input: { user_id: string; name: string },
): Promise<CreateApiKeyResult> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) return { ok: false, error: "invalid_name" };

  const { data: profile, error: pErr } = await supabase
    .from("profiles").select("mcp_status").eq("user_id", input.user_id).maybeSingle();
  if (pErr) return { ok: false, error: "db_error" };
  if (!profile) return { ok: false, error: "profile_missing" };
  if (profile.mcp_status !== "active") return { ok: false, error: "stake_required" };

  const minted = mintApiKey();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: input.user_id,
      name,
      key_hash: minted.hash,
      key_prefix: minted.prefix,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "db_error" };

  return { ok: true, id: data.id, name, key_prefix: minted.prefix, plaintext: minted.plaintext };
}
```

- [ ] **Step 4: Add the `POST` handler in `frontend/app/api/api-keys/route.ts`**

```ts
import { z } from "zod";

const PostBody = z.object({ name: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const user_id = await authed(req);
  if (!user_id) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await createApiKey(supabaseAdmin(), { user_id, name: parsed.data.name });
  if (!result.ok) {
    const status = result.error === "stake_required" ? 403 : result.error === "invalid_name" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({
    id: result.id, name: result.name, key_prefix: result.key_prefix, plaintext: result.plaintext,
  });
}
```

- [ ] **Step 5: Test passes**

Run: `pnpm --filter @ghbounty/frontend test tests/api-keys-route-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/api-keys mints + reveals plaintext once — GHB-188"
```

### Task 15: `DELETE /api/api-keys/[id]` route

**Files:**
- Modify: `frontend/lib/api-keys-route-core.ts` (add `revokeApiKey`)
- Modify: `frontend/tests/api-keys-route-core.test.ts`
- Create: `frontend/app/api/api-keys/[id]/route.ts`

- [ ] **Step 1: Failing test**

```ts
import { revokeApiKey } from "../lib/api-keys-route-core";

describe("revokeApiKey", () => {
  it("revokes a key owned by the caller", async () => {
    const supabase = mockSupabase({ api_keys: [{ id: "k1", user_id: "u1", revoked_at: null }] });
    const r = await revokeApiKey(supabase, { id: "k1", user_id: "u1" });
    expect(r.ok).toBe(true);
    expect(supabase.tables.api_keys[0].revoked_at).not.toBeNull();
  });
  it("returns not_found for someone else's key", async () => {
    const supabase = mockSupabase({ api_keys: [{ id: "k1", user_id: "u2", revoked_at: null }] });
    const r = await revokeApiKey(supabase, { id: "k1", user_id: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_found");
  });
  it("returns already_revoked for revoked keys", async () => {
    const supabase = mockSupabase({ api_keys: [{ id: "k1", user_id: "u1", revoked_at: "2026-04-15" }] });
    const r = await revokeApiKey(supabase, { id: "k1", user_id: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("already_revoked");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

Append to `frontend/lib/api-keys-route-core.ts`:

```ts
export type RevokeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_revoked" | "db_error" };

export async function revokeApiKey(
  supabase: SupabaseClient,
  input: { id: string; user_id: string },
): Promise<RevokeResult> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, revoked_at")
    .eq("id", input.id)
    .eq("user_id", input.user_id)
    .maybeSingle();
  if (error) return { ok: false, error: "db_error" };
  if (!data) return { ok: false, error: "not_found" };
  if (data.revoked_at) return { ok: false, error: "already_revoked" };

  const { error: upErr } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("user_id", input.user_id);
  if (upErr) return { ok: false, error: "db_error" };
  return { ok: true };
}
```

- [ ] **Step 4: Route handler `frontend/app/api/api-keys/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { revokeApiKey } from "@/lib/api-keys-route-core";

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const user_id = await resolveUserIdFromPrivy(h.slice("Bearer ".length));
  if (!user_id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const result = await revokeApiKey(supabaseAdmin(), { id: ctx.params.id, user_id });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "already_revoked" ? 410 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Tests pass**

Run: `pnpm --filter @ghbounty/frontend test tests/api-keys-route-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): DELETE /api/api-keys/[id] revokes — GHB-188"
```

### Task 16: `/app/stake` page

**Files:**
- Create: `frontend/app/app/stake/page.tsx`
- Create: `frontend/app/app/stake/StakeClient.tsx`

- [ ] **Step 1: Create the server component `page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/profile-server";
import StakeClient from "./StakeClient";

export default async function StakePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/app/auth/login?next=${encodeURIComponent("/app/stake")}`);
  if (profile.mcp_status === "active") redirect("/app/credentials");
  return <StakeClient profile={profile} next={(await searchParams).next ?? "/app/credentials"} />;
}
```

(If `getCurrentProfile` does not exist yet, create it as a server-side helper that reads the Privy session cookie and joins to `profiles`. Mirror existing server-component patterns under `frontend/app/app/`.)

- [ ] **Step 2: Create the client component `StakeClient.tsx`**

Implement the visible state machine from spec §5: states `idle | building | awaiting_sig | submitting | confirming | success | error`. Use the existing Privy wallet hook to sign the transaction (search the codebase for `useWallets` or `useSignTransaction` patterns already used by other on-chain UI). Build the `init_stake_deposit` Anchor instruction using whatever helper currently exists (look at the gas-station sponsor flow's caller for analogues).

Layout per spec §5: title "Activate your MCP account", copy ("Stake 0.035 SOL ≈ $3 to activate", refundable after 14 days, slashable on fraud), wallet display, `[Stake 0.035 SOL]` primary, `[Learn more]` secondary. On `success`, `setTimeout(() => router.push(next), 2000)`.

The transaction-submission step calls `POST /api/stake` with `{ wallet_pubkey, tx_signature, pda, locked_until }` after on-chain confirmation. On non-2xx, transition to `error` state with the error code as the message.

- [ ] **Step 3: Smoke test**

Run dev server, hit `/app/stake` while logged-in with a wallet on devnet, complete the flow. Verify:
- All six visible states render.
- DB row appears in `stake_deposits`.
- `profiles.mcp_status === 'active'` after.
- Auto-redirect to `/app/credentials` fires.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/app/stake/
git commit -m "feat(frontend): /app/stake page with on-chain stake flow — GHB-188"
```

### Task 17: `/app/credentials` page — scaffold + API Keys section

**Files:**
- Create: `frontend/app/app/credentials/page.tsx`
- Create: `frontend/app/app/credentials/CredentialsClient.tsx`
- Create: `frontend/app/app/credentials/ApiKeysSection.tsx`
- Create: `frontend/app/app/credentials/GenerateKeyModal.tsx`
- Create: `frontend/app/app/credentials/RevokeKeyModal.tsx`

- [ ] **Step 1: `page.tsx` (server component)**

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/profile-server";
import CredentialsClient from "./CredentialsClient";

export default async function CredentialsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/app/auth/login?next=${encodeURIComponent("/app/credentials")}`);
  return <CredentialsClient profile={profile} />;
}
```

- [ ] **Step 2: `CredentialsClient.tsx` — layout, banner, and section wiring**

```tsx
"use client";
import { useEffect, useState } from "react";
import ApiKeysSection from "./ApiKeysSection";

export default function CredentialsClient({ profile }: { profile: any }) {
  const stakeRequired = profile.mcp_status !== "active";
  return (
    <main className="credentials-page">
      <h1>API & Credentials</h1>
      {stakeRequired && (
        <div className="banner banner-warning">
          Activate your MCP account to manage credentials →{" "}
          <a href="/app/stake">Stake now</a>
        </div>
      )}
      <ApiKeysSection disabled={stakeRequired} />
      {/* ConnectedAppsSection added in Task 31 */}
    </main>
  );
}
```

- [ ] **Step 3: `ApiKeysSection.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import GenerateKeyModal from "./GenerateKeyModal";
import RevokeKeyModal from "./RevokeKeyModal";

interface ApiKey { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export default function ApiKeysSection({ disabled }: { disabled: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);

  async function refresh() {
    const r = await fetch("/api/api-keys", { credentials: "include" });
    const j = await r.json();
    setKeys(j.keys ?? []);
  }
  useEffect(() => { refresh(); }, []);

  return (
    <section>
      <header>
        <h2>API Keys</h2>
        <button disabled={disabled} onClick={() => setShowGen(true)}>+ Generate new key</button>
      </header>
      <p>API keys let your agents talk to mcp.ghbounty.com.</p>
      <ul className="key-list">
        {keys.map(k => (
          <li key={k.id} className={k.revoked_at ? "revoked" : ""}>
            <div className="name">{k.name}</div>
            <code>{k.key_prefix}…</code>
            <div className="meta">
              Created {new Date(k.created_at).toLocaleDateString()}
              {" · "}
              Last used {k.last_used_at ? timeAgo(k.last_used_at) : "never"}
            </div>
            {!k.revoked_at && <button onClick={() => setToRevoke(k)}>Revoke</button>}
          </li>
        ))}
      </ul>
      {showGen && <GenerateKeyModal onClose={() => { setShowGen(false); refresh(); }} />}
      {toRevoke && <RevokeKeyModal apiKey={toRevoke} onClose={() => { setToRevoke(null); refresh(); }} />}
    </section>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}
```

- [ ] **Step 4: `GenerateKeyModal.tsx` — reveal-once UX**

```tsx
"use client";
import { useState } from "react";

export default function GenerateKeyModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true); setError(null);
    const r = await fetch("/api/api-keys", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${r.status}`);
      setSubmitting(false);
      return;
    }
    const j = await r.json();
    setPlaintext(j.plaintext);
    setSubmitting(false);
  }

  if (plaintext) {
    return (
      <div className="modal">
        <h3>Copy your key now</h3>
        <p>This is the only time you'll see this key. Store it now.</p>
        <pre><code>{plaintext}</code></pre>
        <button onClick={() => navigator.clipboard.writeText(plaintext)}>Copy</button>
        <button onClick={onClose}>Done</button>
      </div>
    );
  }
  return (
    <div className="modal">
      <h3>Generate API key</h3>
      <label>Name your key (e.g. Claude Code laptop)
        <input value={name} onChange={e => setName(e.target.value)} maxLength={64} />
      </label>
      {error && <p className="error">{error}</p>}
      <button onClick={onClose} disabled={submitting}>Cancel</button>
      <button onClick={submit} disabled={submitting || name.trim().length === 0}>Generate</button>
    </div>
  );
}
```

- [ ] **Step 5: `RevokeKeyModal.tsx`**

```tsx
"use client";
import { useState } from "react";

export default function RevokeKeyModal({ apiKey, onClose }: { apiKey: { id: string; name: string }; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setSubmitting(true); setError(null);
    const r = await fetch(`/api/api-keys/${apiKey.id}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${r.status}`);
      setSubmitting(false);
      return;
    }
    onClose();
  }
  return (
    <div className="modal">
      <h3>Revoke key "{apiKey.name}"?</h3>
      <p>Any agent using it will lose access immediately.</p>
      {error && <p className="error">{error}</p>}
      <button onClick={onClose} disabled={submitting}>Cancel</button>
      <button onClick={submit} disabled={submitting} className="danger">Revoke</button>
    </div>
  );
}
```

- [ ] **Step 6: Smoke test**

Run dev. Navigate to `/app/credentials`. Generate a key, copy it, close modal. Confirm:
- Plaintext appears exactly once.
- Closing reveal modal removes plaintext from memory (reopen page; prefix-only shown).
- Revoke flow greys out the entry.
- With `mcp_status !== 'active'` (test by manually updating the row), banner shows and Generate button is disabled.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/app/credentials/
git commit -m "feat(frontend): /app/credentials with API Keys section — GHB-188"
```

### Task 18: AppNav "API & Credentials" entry

**Files:**
- Modify: `frontend/components/AppNav.tsx`

- [ ] **Step 1: Insert the menu item**

Between the existing "Profile" and "Logout" entries in the avatar dropdown, add:

```tsx
<button
  type="button"
  role="menuitem"
  className="menu-item"
  onClick={() => {
    setAccountOpen(false);
    router.push("/app/credentials");
  }}
>
  <KeyIcon />
  API & Credentials
</button>
```

If `KeyIcon` is not already imported, use whichever icon library `AppNav.tsx` already imports (e.g. `lucide-react`'s `<Key size={16} />`) and follow the existing icon prop convention.

- [ ] **Step 2: Smoke test**

Run dev, log in, click avatar — the new item appears and navigates to `/app/credentials`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/AppNav.tsx
git commit -m "feat(frontend): AppNav avatar dropdown entry → /app/credentials — GHB-188"
```

### Task 19: End-of-Phase-3 manual smoke

- [ ] **Step 1: Run full manual flow on devnet**

Signup new dev → reach `/app/dev` → click avatar → API & Credentials → see banner → click "Stake now" → complete stake → return to `/app/credentials` → generate "Test laptop" key → copy plaintext.

Use the plaintext as `Authorization: Bearer ghbk_live_...` in a `curl` against `mcp.ghbounty.com` `/whoami` → receive correct profile.

Revoke the key → next call returns `401`.

If any step fails, file the issue and fix in-place before proceeding to Phase 4.

---

## Phase 4 — OAuth flow (Days 8–11)

Build the OAuth 2.1 endpoints (DCR + PKCE), the consent page, the OAuth branch of MCP middleware, and the Connected Apps section.

### Task 20: `GET /.well-known/oauth-authorization-server` (frontend)

**Files:**
- Create: `frontend/app/.well-known/oauth-authorization-server/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    issuer: "https://ghbounty.com",
    authorization_endpoint: "https://ghbounty.com/oauth/authorize",
    token_endpoint: "https://ghbounty.com/api/oauth/token",
    registration_endpoint: "https://ghbounty.com/api/oauth/register",
    revocation_endpoint: "https://ghbounty.com/api/oauth/revoke",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["full"],
  });
}
```

- [ ] **Step 2: Smoke**

Run dev. `curl http://localhost:3000/.well-known/oauth-authorization-server` returns the JSON above.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/.well-known/
git commit -m "feat(frontend): RFC 8414 discovery metadata endpoint — GHB-188"
```

### Task 21: `mcp.ghbounty.com/.well-known/oauth-authorization-server` → redirect

**Files:**
- Create: `apps/mcp/app/.well-known/oauth-authorization-server/route.ts` (path may differ — verify the MCP app's routing root before placing this file)

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.redirect("https://ghbounty.com/.well-known/oauth-authorization-server", 302);
}
```

- [ ] **Step 2: Smoke**

`curl -i mcp.ghbounty.com/.well-known/oauth-authorization-server` (or local equivalent) returns `302` with `Location: https://ghbounty.com/.well-known/oauth-authorization-server`.

- [ ] **Step 3: Commit**

```bash
git add apps/mcp/
git commit -m "feat(mcp): redirect discovery to frontend metadata — GHB-188"
```

### Task 22: `POST /api/oauth/register` (DCR)

**Files:**
- Create: `frontend/lib/oauth-register-core.ts`
- Create: `frontend/tests/oauth-register-core.test.ts`
- Create: `frontend/app/api/oauth/register/route.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { registerClient } from "../lib/oauth-register-core";

describe("registerClient", () => {
  it("inserts an oauth_clients row and returns the new client_id", async () => {
    const supabase = mockSupabase({ oauth_clients: [] });
    const result = await registerClient(supabase, {
      client_name: "Claude Code",
      redirect_uris: ["http://localhost:3334/callback"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.id.startsWith("cl_")).toBe(true);
    expect(supabase.tables.oauth_clients).toHaveLength(1);
  });
  it("rejects invalid redirect_uris (not http(s) or empty)", async () => {
    const supabase = mockSupabase({ oauth_clients: [] });
    expect((await registerClient(supabase, { client_name: "X", redirect_uris: [] })).ok).toBe(false);
    expect((await registerClient(supabase, { client_name: "X", redirect_uris: ["javascript:alert(1)"] })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement core**

```ts
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RegisterResult =
  | { ok: true; client: { id: string; client_name: string; redirect_uris: string[] } }
  | { ok: false; error: "invalid_request" | "db_error" };

const URI_OK = /^(https?:\/\/|http:\/\/localhost(:\d+)?(\/|$))/;

export async function registerClient(
  supabase: SupabaseClient,
  input: { client_name: string; redirect_uris: string[] },
): Promise<RegisterResult> {
  if (!input.client_name || input.client_name.length > 128) return { ok: false, error: "invalid_request" };
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) return { ok: false, error: "invalid_request" };
  for (const u of input.redirect_uris) {
    if (!URI_OK.test(u)) return { ok: false, error: "invalid_request" };
  }
  const id = `cl_${randomUUID()}`;
  const { error } = await supabase.from("oauth_clients").insert({
    id, client_name: input.client_name, redirect_uris: input.redirect_uris,
  });
  if (error) return { ok: false, error: "db_error" };
  return { ok: true, client: { id, client_name: input.client_name, redirect_uris: input.redirect_uris } };
}
```

- [ ] **Step 4: Route handler**

```ts
// frontend/app/api/oauth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { registerClient } from "@/lib/oauth-register-core";

const Body = z.object({
  client_name: z.string().min(1).max(128),
  redirect_uris: z.array(z.string().url()).min(1),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const result = await registerClient(supabaseAdmin(), parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "invalid_request" ? 400 : 500 });
  return NextResponse.json(result.client, { status: 201 });
}
```

- [ ] **Step 5: Test passes**

Run: `pnpm --filter @ghbounty/frontend test tests/oauth-register-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/oauth/register (DCR) — GHB-188"
```

### Task 23: `POST /api/oauth/authorize` endpoint

**Files:**
- Create: `frontend/lib/oauth-authorize-core.ts`
- Create: `frontend/tests/oauth-authorize-core.test.ts`
- Create: `frontend/app/api/oauth/authorize/route.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { createAuthorizationCode } from "../lib/oauth-authorize-core";

describe("createAuthorizationCode", () => {
  it("returns redirect_url with code and state on valid input", async () => {
    const supabase = mockSupabase({
      oauth_clients: [{ id: "cl_x", client_name: "C", redirect_uris: ["http://localhost/cb"] }],
      profiles: [{ user_id: "u1", mcp_status: "active" }],
    });
    const result = await createAuthorizationCode(supabase, {
      user_id: "u1",
      client_id: "cl_x",
      redirect_uri: "http://localhost/cb",
      code_challenge: "abc",
      code_challenge_method: "S256",
      scope: "full",
      state: "xyz",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect_url).toMatch(/^http:\/\/localhost\/cb\?code=code_[A-Za-z0-9_-]{43}&state=xyz$/);
    expect(supabase.tables.oauth_codes).toHaveLength(1);
    expect(supabase.tables.oauth_codes[0].code_challenge).toBe("abc");
  });
  it("rejects unknown client_id", async () => {
    const supabase = mockSupabase({ oauth_clients: [], profiles: [{ user_id: "u1", mcp_status: "active" }] });
    const r = await createAuthorizationCode(supabase, {
      user_id: "u1", client_id: "cl_missing", redirect_uri: "http://localhost/cb",
      code_challenge: "abc", code_challenge_method: "S256", scope: "full", state: "xyz",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_client");
  });
  it("rejects unregistered redirect_uri", async () => { /* analogous */ });
  it("rejects non-S256 challenge_method", async () => { /* analogous */ });
  it("rejects when mcp_status !== 'active'", async () => { /* analogous */ });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// frontend/lib/oauth-authorize-core.ts
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const CODE_TTL_MS = 60_000;

export type AuthorizeInput = {
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
};

export type AuthorizeResult =
  | { ok: true; redirect_url: string }
  | { ok: false; error: "invalid_client" | "invalid_redirect_uri" | "unsupported_challenge_method" | "stake_required" | "db_error" };

export async function createAuthorizationCode(
  supabase: SupabaseClient, input: AuthorizeInput,
): Promise<AuthorizeResult> {
  if (input.code_challenge_method !== "S256") return { ok: false, error: "unsupported_challenge_method" };

  const { data: profile } = await supabase.from("profiles").select("mcp_status").eq("user_id", input.user_id).maybeSingle();
  if (!profile || profile.mcp_status !== "active") return { ok: false, error: "stake_required" };

  const { data: client } = await supabase.from("oauth_clients")
    .select("id, redirect_uris").eq("id", input.client_id).maybeSingle();
  if (!client) return { ok: false, error: "invalid_client" };
  const uris: string[] = (client as any).redirect_uris ?? [];
  if (!uris.includes(input.redirect_uri)) return { ok: false, error: "invalid_redirect_uri" };

  const code = `code_${randomBytes(32).toString("base64url")}`;
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error } = await supabase.from("oauth_codes").insert({
    code,
    user_id: input.user_id,
    client_id: input.client_id,
    code_challenge: input.code_challenge,
    redirect_uri: input.redirect_uri,
    scope: input.scope || "full",
    expires_at,
  });
  if (error) return { ok: false, error: "db_error" };

  const u = new URL(input.redirect_uri);
  u.searchParams.set("code", code);
  u.searchParams.set("state", input.state);
  return { ok: true, redirect_url: u.toString() };
}
```

- [ ] **Step 4: Route handler `frontend/app/api/oauth/authorize/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { createAuthorizationCode } from "@/lib/oauth-authorize-core";

const Body = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(20),
  code_challenge_method: z.literal("S256"),
  scope: z.string(),
  state: z.string(),
});

export async function POST(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const user_id = await resolveUserIdFromPrivy(h.slice("Bearer ".length));
  if (!user_id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = await createAuthorizationCode(supabaseAdmin(), { user_id, ...parsed.data });
  if (!result.ok) {
    const status = result.error === "stake_required" ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ redirect_url: result.redirect_url });
}
```

- [ ] **Step 5: Test passes**

Run: `pnpm --filter @ghbounty/frontend test tests/oauth-authorize-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/oauth/authorize issues PKCE code — GHB-188"
```

### Task 24: `/oauth/authorize` consent page

**Files:**
- Create: `frontend/app/oauth/authorize/page.tsx`
- Create: `frontend/app/oauth/authorize/ConsentClient.tsx`

- [ ] **Step 1: Server component**

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/profile-server";
import { supabaseAdmin } from "@/lib/supabase";
import ConsentClient from "./ConsentClient";

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const required = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state"];
  for (const k of required) {
    if (!sp[k]) return <main><h1>OAuth error</h1><p>Missing parameter: <code>{k}</code>.</p></main>;
  }

  const here = `/oauth/authorize?${new URLSearchParams(sp).toString()}`;
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/app/auth/login?next=${encodeURIComponent(here)}`);
  if (profile.mcp_status !== "active") redirect(`/app/stake?next=${encodeURIComponent(here)}`);

  const { data: client } = await supabaseAdmin()
    .from("oauth_clients").select("id, client_name, redirect_uris").eq("id", sp.client_id).maybeSingle();
  if (!client) return <main><h1>OAuth error</h1><p>Unknown client.</p></main>;
  if (!(client.redirect_uris as string[]).includes(sp.redirect_uri))
    return <main><h1>OAuth error</h1><p>Redirect URI not registered for this client.</p></main>;

  return <ConsentClient client={client} params={sp} profile={profile} />;
}
```

- [ ] **Step 2: Client component**

```tsx
"use client";
import { useState } from "react";

export default function ConsentClient({ client, params, profile }: { client: any; params: Record<string, string>; profile: any }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorize() {
    setSubmitting(true); setError(null);
    const r = await fetch("/api/oauth/authorize", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        scope: params.scope,
        state: params.state,
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${r.status}`);
      setSubmitting(false);
      return;
    }
    const j = await r.json();
    window.location.href = j.redirect_url;
  }

  function cancel() {
    const u = new URL(params.redirect_uri);
    u.searchParams.set("error", "access_denied");
    u.searchParams.set("state", params.state);
    window.location.href = u.toString();
  }

  return (
    <main className="oauth-consent">
      <h1>Authorize {client.client_name}</h1>
      <p>{client.client_name} is requesting access to your GhBounty account.</p>
      <p>This will allow {client.client_name} to:</p>
      <ul>
        <li>Read your bounties and submissions</li>
        <li>Submit PRs on your behalf</li>
        <li>Access your agent profile</li>
      </ul>
      <p>You can revoke this access anytime from <a href="/app/credentials">API &amp; Credentials</a>.</p>
      <p>Signed in as: {profile.display_name ?? profile.user_id} ({profile.email ?? "no email"})</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={authorize} disabled={submitting}>Authorize</button>
        <button onClick={cancel} disabled={submitting}>Cancel</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Smoke test**

Trigger with a hand-crafted URL: `/oauth/authorize?client_id=<one you registered>&redirect_uri=<one of its registered>&code_challenge=abc&code_challenge_method=S256&scope=full&state=xyz`. Confirm:
- Unauthenticated → bounces to `/app/auth/login?next=...`.
- Authenticated but not staked → bounces to `/app/stake?next=...`.
- Authenticated + active → consent renders; Cancel returns to `<redirect_uri>?error=access_denied&state=xyz`; Authorize redirects to `<redirect_uri>?code=…&state=xyz`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/oauth/
git commit -m "feat(frontend): /oauth/authorize consent page — GHB-188"
```

### Task 25: `POST /api/oauth/token` endpoint (PKCE exchange)

**Files:**
- Create: `frontend/lib/oauth-token-core.ts`
- Create: `frontend/tests/oauth-token-core.test.ts`
- Create: `frontend/app/api/oauth/token/route.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { exchangeCodeForToken } from "../lib/oauth-token-core";

function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("exchangeCodeForToken", () => {
  it("mints an OAuth token and marks the code consumed on valid PKCE", async () => {
    const verifier = "verifier_" + randomBytes(32).toString("base64url");
    const challenge = s256(verifier);
    const supabase = mockSupabase({
      oauth_clients: [{ id: "cl_x", client_name: "Claude Code", redirect_uris: ["http://localhost/cb"] }],
      oauth_codes: [{
        code: "code_abc", user_id: "u1", client_id: "cl_x",
        code_challenge: challenge, redirect_uri: "http://localhost/cb", scope: "full",
        expires_at: new Date(Date.now() + 30_000).toISOString(), consumed_at: null,
      }],
      oauth_tokens: [],
    });
    const result = await exchangeCodeForToken(supabase, {
      grant_type: "authorization_code", code: "code_abc",
      code_verifier: verifier, client_id: "cl_x", redirect_uri: "http://localhost/cb",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access_token.startsWith("ghbo_live_")).toBe(true);
    expect(supabase.tables.oauth_codes[0].consumed_at).not.toBeNull();
    expect(supabase.tables.oauth_tokens).toHaveLength(1);
  });

  it("rejects when code already consumed", async () => { /* analogous */ });
  it("rejects when code expired", async () => { /* analogous */ });
  it("rejects when verifier hash does not match stored challenge", async () => { /* analogous */ });
  it("rejects when client_id does not match code", async () => { /* analogous */ });
  it("rejects when redirect_uri does not match code", async () => { /* analogous */ });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// frontend/lib/oauth-token-core.ts
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mintOAuthToken } from "@ghbounty/shared";

export type ExchangeInput = {
  grant_type: string;
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
};

export type ExchangeResult =
  | { ok: true; access_token: string; token_type: "Bearer"; scope: string }
  | { ok: false; error: "invalid_grant" | "invalid_client" | "unsupported_grant_type" | "db_error" };

export async function exchangeCodeForToken(supabase: SupabaseClient, input: ExchangeInput): Promise<ExchangeResult> {
  if (input.grant_type !== "authorization_code") return { ok: false, error: "unsupported_grant_type" };

  const { data: row, error: cErr } = await supabase
    .from("oauth_codes")
    .select("code, user_id, client_id, code_challenge, redirect_uri, scope, expires_at, consumed_at")
    .eq("code", input.code).maybeSingle();
  if (cErr) return { ok: false, error: "db_error" };
  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.consumed_at) return { ok: false, error: "invalid_grant" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, error: "invalid_grant" };

  const challenge = createHash("sha256").update(input.code_verifier).digest("base64url");
  if (challenge !== row.code_challenge) return { ok: false, error: "invalid_grant" };
  if (row.client_id !== input.client_id) return { ok: false, error: "invalid_grant" };
  if (row.redirect_uri !== input.redirect_uri) return { ok: false, error: "invalid_grant" };

  const { error: cuErr } = await supabase
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", input.code)
    .is("consumed_at", null);
  if (cuErr) return { ok: false, error: "db_error" };

  const { data: client } = await supabase
    .from("oauth_clients").select("client_name").eq("id", row.client_id).maybeSingle();

  const minted = mintOAuthToken();
  const { error: insErr } = await supabase.from("oauth_tokens").insert({
    user_id: row.user_id,
    client_id: row.client_id,
    name: (client as any)?.client_name ?? "OAuth client",
    token_hash: minted.hash,
    token_prefix: minted.prefix,
    scopes: [row.scope || "full"],
    expires_at: null,
  });
  if (insErr) return { ok: false, error: "db_error" };

  return { ok: true, access_token: minted.plaintext, token_type: "Bearer", scope: row.scope || "full" };
}
```

- [ ] **Step 4: Route handler**

```ts
// frontend/app/api/oauth/token/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeCodeForToken } from "@/lib/oauth-token-core";

const Body = z.object({
  grant_type: z.string(),
  code: z.string(),
  code_verifier: z.string().min(32),
  client_id: z.string(),
  redirect_uri: z.string(),
});

export async function POST(req: NextRequest) {
  // OAuth spec: token endpoint accepts application/x-www-form-urlencoded.
  // Support both JSON and form for client tolerance.
  let body: any;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) body = await req.json();
  else body = Object.fromEntries(await req.formData());

  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = await exchangeCodeForToken(supabaseAdmin(), parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    access_token: result.access_token, token_type: result.token_type, scope: result.scope,
  });
}
```

- [ ] **Step 5: Tests pass**

Run: `pnpm --filter @ghbounty/frontend test tests/oauth-token-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/oauth/token with PKCE S256 — GHB-188"
```

### Task 26: `POST /api/oauth/revoke` endpoint

**Files:**
- Create: `frontend/app/api/oauth/revoke/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { extractOAuthTokenPrefix, verifyOAuthToken } from "@ghbounty/shared";

const Body = z.object({ token: z.string().optional() });

export async function POST(req: NextRequest) {
  const h = req.headers.get("authorization");
  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  const plaintext = parsed.success && parsed.data.token
    ? parsed.data.token
    : (h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : null);
  if (!plaintext) return NextResponse.json({ ok: true });

  let prefix: string;
  try { prefix = extractOAuthTokenPrefix(plaintext); } catch { return NextResponse.json({ ok: true }); }

  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("id, token_hash, revoked_at")
    .eq("token_prefix", prefix).is("revoked_at", null).maybeSingle();
  // Per RFC 7009: respond 200 regardless.
  if (data && verifyOAuthToken(plaintext, (data as any).token_hash)) {
    await supabase.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", (data as any).id);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke**

Mint an OAuth token (via DCR + authorize + token), then `curl -X POST /api/oauth/revoke -H "Authorization: Bearer ghbo_live_..."` → `{ok:true}`. DB row's `revoked_at` set.

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): POST /api/oauth/revoke per RFC 7009 — GHB-188"
```

### Task 27: MCP middleware OAuth token branch

**Files:**
- Modify: `apps/mcp/lib/auth/middleware.ts`
- Modify: `apps/mcp/tests/auth/middleware.test.ts`

- [ ] **Step 1: Add failing tests for `ghbo_live_` dispatch**

```ts
it("dispatches to OAuth lookup for ghbo_live_ tokens", async () => {
  const minted = mintOAuthToken();
  // mock supabase: oauth_tokens row joined to profiles
  const result = await authenticate(`Bearer ${minted.plaintext}`);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.credentialKind).toBe("oauth_token");
});

it("returns 401 for revoked OAuth token", async () => {
  const minted = mintOAuthToken();
  // mock supabase: no row found (revoked_at filter)
  const result = await authenticate(`Bearer ${minted.plaintext}`);
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `authenticateOAuthToken` and wire dispatch**

Append to `apps/mcp/lib/auth/middleware.ts`:

```ts
import { extractOAuthTokenPrefix, verifyOAuthToken } from "@ghbounty/shared";

async function authenticateOAuthToken(plaintext: string): Promise<AuthResult> {
  let prefix: string;
  try { prefix = extractOAuthTokenPrefix(plaintext); }
  catch { return { ok: false, error: { code: "Unauthorized", message: "Invalid OAuth token format" } }; }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, token_hash, user_id, scopes, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)")
    .eq("token_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: { code: "Unauthorized", message: "Authentication lookup failed" } };
  if (!data) return { ok: false, error: { code: "Unauthorized", message: "OAuth token not found" } };
  if (!verifyOAuthToken(plaintext, (data as any).token_hash)) {
    return { ok: false, error: { code: "Unauthorized", message: "OAuth token mismatch" } };
  }
  const rawProfile = (data as any).profiles;
  const row = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  if (!row) return { ok: false, error: { code: "Unauthorized", message: "Profile record missing" } };
  if (row.mcp_status !== "active") {
    return { ok: false, error: { code: "Forbidden", message: `Account is ${row.mcp_status}, not active` } };
  }
  const profile: MCPProfile = {
    user_id: row.user_id, role: row.role, mcp_status: row.mcp_status,
    wallet_pubkey: row.wallet_pubkey, github_handle: row.github_handle,
  };
  supabase.from("oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", (data as any).id).then(() => {});
  return { ok: true, profile, credentialId: (data as any).id, credentialKind: "oauth_token" };
}
```

Then update `authenticate()` to dispatch:

```ts
if (plaintext.startsWith("ghbo_live_")) return authenticateOAuthToken(plaintext);
```

- [ ] **Step 4: Tests pass**

Run: `pnpm --filter @ghbounty/mcp test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/
git commit -m "feat(mcp): authenticate ghbo_live_ tokens via oauth_tokens — GHB-188"
```

### Task 28: `GET /api/connected-apps` route

**Files:**
- Create: `frontend/lib/connected-apps-core.ts`
- Create: `frontend/tests/connected-apps-core.test.ts`
- Create: `frontend/app/api/connected-apps/route.ts`

- [ ] **Step 1: Failing test**

```ts
import { listConnectedApps } from "../lib/connected-apps-core";

describe("listConnectedApps", () => {
  it("lists active OAuth tokens with client_name and last_used_at", async () => {
    const supabase = mockSupabase({
      oauth_tokens: [
        { id: "t1", user_id: "u1", client_id: "cl_x", name: "Claude Code",
          scopes: ["full"], created_at: "2026-04-10", last_used_at: "2026-04-11", revoked_at: null },
        { id: "t2", user_id: "u1", client_id: "cl_y", name: "Cursor",
          scopes: ["full"], created_at: "2026-04-10", last_used_at: null, revoked_at: "2026-04-11" },
      ],
    });
    const apps = await listConnectedApps(supabase, "u1");
    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBe("Claude Code");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement core**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConnectedApp {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

export async function listConnectedApps(supabase: SupabaseClient, user_id: string): Promise<ConnectedApp[]> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, name, scopes, created_at, last_used_at")
    .eq("user_id", user_id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConnectedApp[];
}

export type RevokeAppResult = { ok: true } | { ok: false; error: "not_found" | "db_error" };

export async function revokeConnectedApp(
  supabase: SupabaseClient, input: { id: string; user_id: string },
): Promise<RevokeAppResult> {
  const { data, error: sErr } = await supabase
    .from("oauth_tokens").select("id, revoked_at")
    .eq("id", input.id).eq("user_id", input.user_id).maybeSingle();
  if (sErr) return { ok: false, error: "db_error" };
  if (!data) return { ok: false, error: "not_found" };
  if ((data as any).revoked_at) return { ok: true }; // idempotent
  const { error } = await supabase.from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.id).eq("user_id", input.user_id);
  if (error) return { ok: false, error: "db_error" };
  return { ok: true };
}
```

- [ ] **Step 4: Route handler**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { listConnectedApps } from "@/lib/connected-apps-core";

export async function GET(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const user_id = await resolveUserIdFromPrivy(h.slice("Bearer ".length));
  if (!user_id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const apps = await listConnectedApps(supabaseAdmin(), user_id);
  return NextResponse.json({ apps });
}
```

- [ ] **Step 5: Tests pass**

Run: `pnpm --filter @ghbounty/frontend test tests/connected-apps-core.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): GET /api/connected-apps — GHB-188"
```

### Task 29: `DELETE /api/connected-apps/[id]` route

**Files:**
- Create: `frontend/app/api/connected-apps/[id]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveUserIdFromPrivy } from "@/lib/privy-bridge-core";
import { revokeConnectedApp } from "@/lib/connected-apps-core";

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  const user_id = await resolveUserIdFromPrivy(h.slice("Bearer ".length));
  if (!user_id) return NextResponse.json({ error: "invalid_auth" }, { status: 401 });

  const result = await revokeConnectedApp(supabaseAdmin(), { id: ctx.params.id, user_id });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke**

Mint an OAuth token, `DELETE /api/connected-apps/<id>` → 200. Re-call MCP with that token → 401.

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): DELETE /api/connected-apps/[id] — GHB-188"
```

### Task 30: Connected Apps section in `/app/credentials`

**Files:**
- Create: `frontend/app/app/credentials/ConnectedAppsSection.tsx`
- Modify: `frontend/app/app/credentials/CredentialsClient.tsx`

- [ ] **Step 1: Create `ConnectedAppsSection.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

interface App { id: string; name: string; scopes: string[]; created_at: string; last_used_at: string | null }

export default function ConnectedAppsSection() {
  const [apps, setApps] = useState<App[]>([]);
  const [confirming, setConfirming] = useState<App | null>(null);

  async function refresh() {
    const r = await fetch("/api/connected-apps", { credentials: "include" });
    const j = await r.json();
    setApps(j.apps ?? []);
  }
  useEffect(() => { refresh(); }, []);

  async function revoke(a: App) {
    await fetch(`/api/connected-apps/${a.id}`, { method: "DELETE", credentials: "include" });
    setConfirming(null);
    refresh();
  }

  return (
    <section>
      <h2>Connected Apps</h2>
      <p>Apps you've authorized via OAuth.</p>
      <ul>
        {apps.length === 0 && <li className="empty">No connected apps yet.</li>}
        {apps.map(a => (
          <li key={a.id}>
            <div className="name">{a.name}</div>
            <div className="meta">
              Authorized {new Date(a.created_at).toLocaleDateString()}
              {a.last_used_at && ` · Last used ${new Date(a.last_used_at).toLocaleString()}`}
            </div>
            <button onClick={() => setConfirming(a)}>Revoke</button>
          </li>
        ))}
      </ul>
      {confirming && (
        <div className="modal">
          <h3>Revoke {confirming.name}?</h3>
          <p>The app will lose access immediately.</p>
          <button onClick={() => setConfirming(null)}>Cancel</button>
          <button className="danger" onClick={() => revoke(confirming)}>Revoke</button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `CredentialsClient.tsx`**

Add `import ConnectedAppsSection from "./ConnectedAppsSection";` and render `<ConnectedAppsSection />` below `<ApiKeysSection />`.

- [ ] **Step 3: Smoke**

Reload `/app/credentials` — section renders. After completing an OAuth flow, the new entry appears with `last_used_at` ticking forward after MCP tool calls.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/app/credentials/
git commit -m "feat(frontend): Connected Apps section in /app/credentials — GHB-188"
```

### Task 31: Cleanup cron for `oauth_codes`

**Files:**
- Create: `frontend/app/api/cron/cleanup-oauth-codes/route.ts`
- Modify: `frontend/vercel.json` (add cron schedule)

- [ ] **Step 1: Implement the route**

```ts
// frontend/app/api/cron/cleanup-oauth-codes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  // Vercel cron sends an Authorization: Bearer <CRON_SECRET> header.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = supabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { error, count } = await supabase
    .from("oauth_codes")
    .delete({ count: "exact" })
    .lt("expires_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count ?? 0 });
}
```

- [ ] **Step 2: Add cron entry to `frontend/vercel.json`**

Add (or extend) `crons` to include:
```json
{
  "crons": [
    { "path": "/api/cron/cleanup-oauth-codes", "schedule": "0 * * * *" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "chore(frontend): hourly cron to prune expired oauth_codes — GHB-188"
```

### Task 32: Phase 4 manual smoke

- [ ] **Step 1: End-to-end OAuth dance**

From a fresh Claude Code config pointing at `mcp.ghbounty.com` (no api_key), trigger a tool call. Browser opens `/oauth/authorize`. Authorize. Tool call succeeds.

`/app/credentials` shows the connected app with recent `last_used_at`.

Revoke from UI. Next tool call returns 401.

If any step fails, fix in-place before Phase 5.

---

## Phase 5 — Landing rewrite (Day 12)

### Task 33: Rewrite `/agents`

**Files:**
- Modify: `frontend/app/agents/page.tsx` (or wherever the existing `/agents` route lives — verify with `ls frontend/app/agents/`)

- [ ] **Step 1: Replace the page content with a 3-step quickstart**

```tsx
export default function AgentsLanding() {
  return (
    <main className="agents-landing">
      <h1>Connect your agent</h1>
      <p>Three steps to get an AI agent working on bounties.</p>

      <ol>
        <li>
          <h2>1. Sign up</h2>
          <p>Create a GhBounty account at <a href="/app/auth/signup/dev">ghbounty.com</a>.</p>
        </li>
        <li>
          <h2>2. Activate</h2>
          <p>Stake 0.035 SOL to activate your account. <a href="/app/stake">Stake now</a> · <a href="/docs/stake">Learn more</a></p>
        </li>
        <li>
          <h2>3. Connect</h2>
          <p>Pick API key (simple) or OAuth (Claude Code, Cursor).</p>

          <h3>API key</h3>
          <pre><code>{`{
  "mcpServers": {
    "ghbounty": {
      "url": "https://mcp.ghbounty.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ghbk_live_..."
      }
    }
  }
}`}</code></pre>

          <h3>OAuth (recommended for Claude Code)</h3>
          <pre><code>{`{
  "mcpServers": {
    "ghbounty": { "url": "https://mcp.ghbounty.com/api/mcp" }
  }
}`}</code></pre>
          <p>Your agent will open a browser tab for authorization the first time you use it.</p>
        </li>
      </ol>
    </main>
  );
}
```

(Trim or adapt to the codebase's existing landing-page typography/component conventions — read a sibling marketing page like `frontend/app/about/page.tsx` if one exists to match styling.)

- [ ] **Step 2: Smoke**

Run dev, visit `/agents`. All links work; mcp.json snippets render verbatim.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/agents/
git commit -m "docs(frontend): rewrite /agents to 3-step quickstart — GHB-188"
```

---

## Phase 6 — Integration tests + final QA (Day 13)

### Task 34: OAuth E2E integration test

**Files:**
- Create: `frontend/tests/integration/oauth-flow.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";

const FRONTEND = process.env.E2E_FRONTEND_URL ?? "http://localhost:3000";
const MCP = process.env.E2E_MCP_URL ?? "http://localhost:3001";
const PRIVY_BEARER = process.env.E2E_PRIVY_TOKEN; // a test session token

describe.skipIf(!PRIVY_BEARER)("OAuth E2E", () => {
  it("DCR → authorize → token exchange → call MCP", async () => {
    // 1. Register a fake client.
    const reg = await fetch(`${FRONTEND}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "E2E Test", redirect_uris: ["http://localhost/cb"] }),
    });
    const { id: client_id } = await reg.json();
    expect(client_id).toMatch(/^cl_/);

    // 2. Generate PKCE.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    // 3. POST /api/oauth/authorize as the test user.
    const auth = await fetch(`${FRONTEND}/api/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PRIVY_BEARER}` },
      body: JSON.stringify({
        client_id, redirect_uri: "http://localhost/cb",
        code_challenge: challenge, code_challenge_method: "S256",
        scope: "full", state: "s",
      }),
    });
    const { redirect_url } = await auth.json();
    const code = new URL(redirect_url).searchParams.get("code")!;
    expect(code).toMatch(/^code_/);

    // 4. Exchange.
    const tok = await fetch(`${FRONTEND}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code", code, code_verifier: verifier,
        client_id, redirect_uri: "http://localhost/cb",
      }),
    });
    const { access_token } = await tok.json();
    expect(access_token.startsWith("ghbo_live_")).toBe(true);

    // 5. Call MCP whoami.
    const me = await fetch(`${MCP}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(me.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run locally with env vars set; skipped in CI**

Run: `pnpm --filter @ghbounty/frontend test tests/integration/oauth-flow.test.ts`
Expected: PASS (when env set) or skipped.

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/
git commit -m "test(frontend): OAuth E2E integration test — GHB-188"
```

### Task 35: Unified-auth integration test (MCP)

**Files:**
- Create: `apps/mcp/tests/integration/auth-unified.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";

const MCP = process.env.E2E_MCP_URL ?? "http://localhost:3001";
const API_KEY = process.env.E2E_API_KEY;       // ghbk_live_...
const OAUTH_TOKEN = process.env.E2E_OAUTH_TOKEN; // ghbo_live_...

describe.skipIf(!API_KEY || !OAUTH_TOKEN)("MCP unified auth", () => {
  async function whoami(token: string) {
    const r = await fetch(`${MCP}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(r.status).toBe(200);
    return r.json();
  }

  it("returns identical profile for api_key and oauth_token", async () => {
    const a = await whoami(API_KEY!);
    const b = await whoami(OAUTH_TOKEN!);
    expect(a.result).toEqual(b.result);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mcp/tests/integration/
git commit -m "test(mcp): unified auth returns identical results for both creds — GHB-188"
```

### Task 36: Run the 12-item manual E2E checklist

- [ ] **Step 1: Run every item from spec §9 "Manual E2E checklist"**

For each numbered item (1–12), execute on devnet against the deployed preview (or local dev). Tick the box in a fresh comment on the PR. Items 1–11 are happy-path; item 12 is a security check (RLS isolation between two users).

If any item fails, file the issue, fix in-place, re-run the failing item.

- [ ] **Step 2: Document any deviations**

If anything diverges from the spec (e.g., a different error code shows up), update the spec or the implementation — do not leave the PR in a state where docs lie. Commit:

```bash
git add docs/superpowers/specs/2026-05-16-mcp-frontend-onboarding-design.md
git commit -m "docs(spec): corrections from manual QA — GHB-188"
```

---

## Phase 7 — Merge (Day 14)

### Task 37: Done-criteria audit + PR

- [ ] **Step 1: Walk the done-criteria checklist from spec §10**

Run each command and confirm output:

```bash
grep -rE "device-flow|create_account\.(init|poll|complete)" apps/mcp/ && echo "FAIL" || echo "PASS"
# expect PASS
```

```bash
psql "$DEVNET_DB_URL" -c "SELECT to_regclass('agent_accounts');"
# expect (regclass)\n----\n(empty)
psql "$DEVNET_DB_URL" -c "SELECT count(*) FROM oauth_clients;"
# expect a number >= 1 after test runs
```

```bash
curl -i https://mcp.ghbounty.com/.well-known/oauth-authorization-server
# expect 302 redirect to ghbounty.com
curl -s https://ghbounty.com/.well-known/oauth-authorization-server | jq .
# expect the RFC 8414 metadata
```

If anything fails: fix, re-test, re-commit.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(mcp): frontend-driven onboarding (OAuth + API keys + stake) — GHB-188" --body "$(cat <<'EOF'
## Summary
- Merges agent_accounts into profiles (single user identity)
- Replaces 14-step agentic onboarding with web-based stake + API key / OAuth issuance
- Adds OAuth 2.1 (DCR + PKCE, no client secrets, no refresh tokens)
- Deletes device-flow + create-account MCP tools

## Spec
docs/superpowers/specs/2026-05-16-mcp-frontend-onboarding-design.md

## Migrations
- `0023_mcp_identity_merge.sql` — additive, FK swap
- `0024_mcp_rls_rebuild.sql` — RLS recreated against profiles.user_id, drops agent_accounts

Both applied manually by Gaston on devnet; CI does not run migrations.

## Test plan
- [x] All vitest unit + integration suites green
- [x] Spec §9 12-item manual E2E checklist all pass on devnet
- [x] `grep -r "device-flow|create_account.init|create_account.poll|create_account.complete" apps/mcp/` returns 0
- [x] `to_regclass('agent_accounts')` returns NULL
- [x] mcp.ghbounty.com `/.well-known/oauth-authorization-server` redirects to frontend
EOF
)"
```

- [ ] **Step 3: Wait for review, then squash-merge**

Once approved, squash-merge. Vercel auto-deploys. Run a final prod smoke (Phase 6 item 9 against prod) before closing the Linear issue.

---

## Notes for the implementor

1. **Privy bridge helper:** the plan references `resolveUserIdFromPrivy(token)`. If that helper does not exist yet, create it next to `frontend/lib/privy-bridge-core.ts` by re-using its `verifyAndMintToken` JWKS verification and returning the `sub` claim. Make this its own committed task before Task 12.

2. **`getCurrentProfile()` server helper:** referenced by `/app/stake/page.tsx`, `/app/credentials/page.tsx`, `/oauth/authorize/page.tsx`. If a comparable helper already powers `/app/dev` or `/app/profile`, prefer reusing it (rename if it returns the old `agent_accounts` join — switch to `profiles`). Otherwise, write a minimal version that reads the Privy session cookie and joins `profiles`.

3. **`supabaseAdmin()`:** standard Supabase service-role client — the MCP middleware already uses one (`apps/mcp/lib/supabase.ts`). The frontend should already have an equivalent under `frontend/lib/supabase.ts`. If a `supabaseUser()` client exists (one that respects the user's JWT for RLS), prefer it on read paths where appropriate; the routes in this plan use admin because they validate ownership in code via `eq('user_id', user_id)`.

4. **Test mocks:** `mockSupabase({...})` is shorthand. The frontend test suite likely already has a mock helper (or uses something like `@supabase/supabase-js`'s testable double). Inspect a sibling test (e.g., `frontend/tests/gas-station-route-core.test.ts`) before writing tests in this plan — match its conventions instead of inventing a new pattern.

5. **One-file migration is acceptable** (spec §4 "Migration safety"). If RLS dependencies make the split awkward, merge `0023` + `0024` into a single `0023_mcp_identity_overhaul.sql`. Update Tasks 6, 7, and 9 accordingly.

6. **AppNav icon library:** check the existing `AppNav.tsx` import list. Use whatever icon set it already pulls — do not introduce a new dependency for a single icon.

7. **Style/CSS:** every new page (`/app/stake`, `/app/credentials`, `/oauth/authorize`, `/agents`) inherits classNames that the existing app shell expects. Search a sibling `app/` page for examples (`/app/dev`, `/app/profile`) and reuse class patterns. Do not introduce a new design system.

8. **Form-urlencoded support:** the `/api/oauth/token` handler accepts both JSON and `application/x-www-form-urlencoded` because OAuth clients vary. Other endpoints in this plan are JSON-only.
