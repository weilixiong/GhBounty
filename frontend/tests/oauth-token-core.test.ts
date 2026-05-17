/**
 * GHB-188 — tests for `lib/oauth-token-core.ts`.
 *
 * Tests run against the exported function:
 *   - exchangeCodeForToken(supabase, ExchangeInput)
 *
 * Uses hand-rolled Supabase mocks (no network), dispatching by table
 * name (`oauth_codes`, `oauth_clients`, `oauth_tokens`). PKCE
 * verifier/challenge pairs are generated deterministically with
 * `crypto.createHash` so we exercise the real S256 path.
 */

import { describe, expect, test, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exchangeCodeForToken } from "@/lib/oauth-token-core";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function makeVerifierAndChallenge(): { verifier: string; challenge: string } {
  const verifier = `verifier_${randomBytes(32).toString("base64url")}`;
  return { verifier, challenge: s256(verifier) };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type CodeRow = {
  code: string;
  user_id: string;
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  scope: string;
  expires_at: string;
  consumed_at: string | null;
};

type ClientRow = { id: string; client_name: string } | null;

interface SupabaseMockOpts {
  /** Row returned by `.from("oauth_codes").select(...).eq("code", ...).maybeSingle()`. */
  codeRow?: CodeRow | null;
  /** Error returned by the SELECT on `oauth_codes`. */
  codeSelectError?: { message: string } | null;
  /** Number of rows affected by the UPDATE on `oauth_codes` (single-use race). */
  updateCount?: number;
  /** Error returned by the UPDATE on `oauth_codes`. */
  updateError?: { message: string } | null;
  /** Row returned by `.from("oauth_clients").select(...).eq("id", ...).maybeSingle()`. */
  client?: ClientRow;
  /** Error returned by the INSERT on `oauth_tokens`. */
  tokenInsertError?: { message: string } | null;
}

interface SupabaseMock {
  supabase: SupabaseClient;
  /** Captured UPDATE patch on oauth_codes (null if never called). */
  getCodeUpdate: () => Record<string, unknown> | null;
  /** Did `.update()` on oauth_codes get called? */
  updateCalled: () => boolean;
  /** Captured row inserted into oauth_tokens (null if never called). */
  getInsertedToken: () => Record<string, unknown> | null;
  /** Did `.insert()` on oauth_tokens get called? */
  tokenInsertCalled: () => boolean;
}

function makeSupabaseMock(opts: SupabaseMockOpts): SupabaseMock {
  let codeUpdatePatch: Record<string, unknown> | null = null;
  let updateCalledFlag = false;
  let insertedToken: Record<string, unknown> | null = null;
  let tokenInsertCalledFlag = false;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "oauth_codes") {
        return {
          // SELECT chain: .select(...).eq("code", ...).maybeSingle()
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.codeRow ?? null,
                error: opts.codeSelectError ?? null,
              }),
            }),
          }),
          // UPDATE chain: .update(patch).eq("code", ...).is("consumed_at", null)
          update: vi.fn((patch: Record<string, unknown>) => {
            updateCalledFlag = true;
            codeUpdatePatch = patch;
            return {
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({
                  data: null,
                  error: opts.updateError ?? null,
                  count: opts.updateCount ?? 1,
                }),
              }),
            };
          }),
        };
      }
      if (table === "oauth_clients") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.client ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "oauth_tokens") {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            tokenInsertCalledFlag = true;
            insertedToken = row;
            return Promise.resolve({
              data: null,
              error: opts.tokenInsertError ?? null,
            });
          }),
        };
      }
      throw new Error(`unexpected supabase.from(${table})`);
    }),
  } as unknown as SupabaseClient;

  return {
    supabase,
    getCodeUpdate: () => codeUpdatePatch,
    updateCalled: () => updateCalledFlag,
    getInsertedToken: () => insertedToken,
    tokenInsertCalled: () => tokenInsertCalledFlag,
  };
}

function futureExpiry(ms = 30_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function pastExpiry(ms = 60_000): string {
  return new Date(Date.now() - ms).toISOString();
}

function makeCodeRow(overrides: Partial<CodeRow> = {}): CodeRow {
  return {
    code: "code_abc",
    user_id: "did:privy:u1",
    client_id: "cl_x",
    code_challenge: "placeholder",
    redirect_uri: "http://localhost/cb",
    scope: "full",
    expires_at: futureExpiry(),
    consumed_at: null,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<Parameters<typeof exchangeCodeForToken>[1]> = {},
) {
  return {
    grant_type: "authorization_code",
    code: "code_abc",
    code_verifier: "placeholder",
    client_id: "cl_x",
    redirect_uri: "http://localhost/cb",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// exchangeCodeForToken
// ---------------------------------------------------------------------------

describe("exchangeCodeForToken", () => {
  // 1. Happy path.
  test("happy path mints access_token, marks code consumed, inserts oauth_tokens row", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge }),
      client: { id: "cl_x", client_name: "Claude Code" },
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.token_type).toBe("Bearer");
    expect(result.scope).toBe("full");
    expect(result.access_token.startsWith("ghbo_live_")).toBe(true);

    // Code was marked consumed.
    expect(mock.updateCalled()).toBe(true);
    const patch = mock.getCodeUpdate();
    expect(patch).not.toBeNull();
    if (patch) {
      expect(typeof patch.consumed_at).toBe("string");
    }

    // Token row inserted with the right fields.
    expect(mock.tokenInsertCalled()).toBe(true);
    const tokenRow = mock.getInsertedToken();
    expect(tokenRow).not.toBeNull();
    if (!tokenRow) return;
    expect(tokenRow.user_id).toBe("did:privy:u1");
    expect(tokenRow.client_id).toBe("cl_x");
    expect(tokenRow.name).toBe("Claude Code");
    expect(typeof tokenRow.token_hash).toBe("string");
    expect(typeof tokenRow.token_prefix).toBe("string");
    expect((tokenRow.token_prefix as string).startsWith("ghbo_live_")).toBe(
      true,
    );
    expect(tokenRow.scopes).toEqual(["full"]);
    expect(tokenRow.expires_at).toBeNull();
  });

  // 2. Unsupported grant_type → no DB activity.
  test("rejects grant_type != authorization_code with unsupported_grant_type", async () => {
    const mock = makeSupabaseMock({});

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ grant_type: "client_credentials" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_grant_type");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 3. Code not found → invalid_grant.
  test("returns invalid_grant when code not found", async () => {
    const mock = makeSupabaseMock({ codeRow: null });

    const result = await exchangeCodeForToken(mock.supabase, makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 4. Code already consumed → invalid_grant (REPLAY detection).
  test("returns invalid_grant when consumed_at is set", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({
        code_challenge: challenge,
        consumed_at: new Date().toISOString(),
      }),
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 5. Code expired → invalid_grant.
  test("returns invalid_grant when expires_at is in the past", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({
        code_challenge: challenge,
        expires_at: pastExpiry(),
      }),
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 6. Wrong verifier → invalid_grant.
  test("returns invalid_grant when verifier hash does not match challenge", async () => {
    const { challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge }),
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: "wrong-verifier" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 7. client_id mismatch → invalid_grant.
  test("returns invalid_grant when client_id does not match code", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge, client_id: "cl_real" }),
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier, client_id: "cl_evil" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 8. redirect_uri mismatch → invalid_grant.
  test("returns invalid_grant when redirect_uri does not match code", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({
        code_challenge: challenge,
        redirect_uri: "http://localhost/cb",
      }),
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({
        code_verifier: verifier,
        redirect_uri: "http://evil.example/cb",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    expect(mock.updateCalled()).toBe(false);
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 9. Race: consumed_at set between SELECT and UPDATE → invalid_grant, no token minted.
  test("returns invalid_grant when UPDATE count is 0 (race lost)", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge }),
      updateCount: 0,
      client: { id: "cl_x", client_name: "Claude Code" },
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_grant");
    // UPDATE was attempted (that's how we detected the race).
    expect(mock.updateCalled()).toBe(true);
    // But the token was NOT minted/inserted.
    expect(mock.tokenInsertCalled()).toBe(false);
  });

  // 10. DB error on token insert → db_error. Code is already consumed (no rollback).
  test("returns db_error when inserting oauth_tokens fails (code already consumed)", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge }),
      client: { id: "cl_x", client_name: "Claude Code" },
      tokenInsertError: { message: "connection refused" },
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("db_error");
    // We do NOT roll back the consume — the row was marked consumed.
    expect(mock.updateCalled()).toBe(true);
    expect(mock.tokenInsertCalled()).toBe(true);
  });

  // 11. Null client lookup → name falls back to "OAuth client".
  test("falls back to 'OAuth client' when oauth_clients lookup returns null", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge }),
      client: null,
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tokenRow = mock.getInsertedToken();
    expect(tokenRow).not.toBeNull();
    if (!tokenRow) return;
    expect(tokenRow.name).toBe("OAuth client");
  });

  // 12. Scope defaults to ["full"] when row.scope is empty.
  test("defaults scopes to ['full'] when row.scope is empty string", async () => {
    const { verifier, challenge } = makeVerifierAndChallenge();
    const mock = makeSupabaseMock({
      codeRow: makeCodeRow({ code_challenge: challenge, scope: "" }),
      client: { id: "cl_x", client_name: "Claude Code" },
    });

    const result = await exchangeCodeForToken(
      mock.supabase,
      makeInput({ code_verifier: verifier }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe("full");

    const tokenRow = mock.getInsertedToken();
    expect(tokenRow).not.toBeNull();
    if (!tokenRow) return;
    expect(tokenRow.scopes).toEqual(["full"]);
  });
});
