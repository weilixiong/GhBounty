/**
 * GHB-188 — tests for `lib/oauth-authorize-core.ts`.
 *
 * Tests run against the exported function:
 *   - createAuthorizationCode(supabase, AuthorizeInput)
 *
 * Uses hand-rolled Supabase mocks (no network), mirroring the pattern
 * in `oauth-register-core.test.ts`. The mock dispatches by table name
 * because the function touches three: `profiles`, `oauth_clients`, and
 * `oauth_codes`.
 */

import { describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthorizationCode } from "@/lib/oauth-authorize-core";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface SupabaseMockOpts {
  /** profiles row returned by `.from("profiles").select(...).eq(...).maybeSingle()`. */
  profile?: { mcp_status: string } | null;
  /** oauth_clients row returned by `.from("oauth_clients").select(...).eq(...).maybeSingle()`. */
  client?: { id: string; redirect_uris: string[] } | null;
  /** When set, the insert into `oauth_codes` rejects with this error object. */
  insertError?: { message: string } | null;
}

interface SupabaseMock {
  supabase: SupabaseClient;
  /** Capture the row inserted into `oauth_codes` (null if never called). */
  getInsertedCode: () => Record<string, unknown> | null;
  /** Did `.insert()` get called on `oauth_codes`? */
  insertCalled: () => boolean;
}

function makeSupabaseMock(opts: SupabaseMockOpts): SupabaseMock {
  let insertedCode: Record<string, unknown> | null = null;
  let insertCalledFlag = false;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.profile ?? null,
                error: null,
              }),
            }),
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
      if (table === "oauth_codes") {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            insertCalledFlag = true;
            insertedCode = row;
            return Promise.resolve({
              data: null,
              error: opts.insertError ?? null,
            });
          }),
        };
      }
      throw new Error(`unexpected supabase.from(${table})`);
    }),
  } as unknown as SupabaseClient;

  return {
    supabase,
    getInsertedCode: () => insertedCode,
    insertCalled: () => insertCalledFlag,
  };
}

// Reusable, valid input. Tests override fields as needed.
function makeInput(overrides: Partial<Parameters<typeof createAuthorizationCode>[1]> = {}) {
  return {
    user_id: "did:privy:u1",
    client_id: "cl_x",
    redirect_uri: "http://localhost/cb",
    code_challenge: "abc",
    code_challenge_method: "S256",
    scope: "full",
    state: "xyz",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createAuthorizationCode
// ---------------------------------------------------------------------------

describe("createAuthorizationCode", () => {
  // 1. Happy path → redirect_url has code+state, oauth_codes row written.
  test("happy path returns redirect_url and inserts oauth_codes row", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const before = Date.now();
    const result = await createAuthorizationCode(mock.supabase, makeInput());
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.redirect_url).toMatch(
      /^http:\/\/localhost\/cb\?code=code_[A-Za-z0-9_-]{43}&state=xyz$/,
    );

    const row = mock.getInsertedCode();
    expect(row).not.toBeNull();
    if (!row) return;

    expect(row.user_id).toBe("did:privy:u1");
    expect(row.client_id).toBe("cl_x");
    expect(row.redirect_uri).toBe("http://localhost/cb");
    expect(row.code_challenge).toBe("abc");
    expect(row.scope).toBe("full");
    expect(typeof row.code).toBe("string");
    expect((row.code as string).startsWith("code_")).toBe(true);
    expect((row.code as string).length).toBe(48); // "code_" + 43 base64url chars

    // expires_at should be ~now + 60s
    const expiresAt = new Date(row.expires_at as string).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 50);
    expect(expiresAt).toBeLessThanOrEqual(after + 60_000 + 50);
  });

  // 2. Non-S256 challenge method → short-circuit, no DB writes.
  test("rejects code_challenge_method != S256 with unsupported_challenge_method", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const result = await createAuthorizationCode(
      mock.supabase,
      makeInput({ code_challenge_method: "plain" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_challenge_method");
    expect(mock.insertCalled()).toBe(false);
  });

  // 3. Missing profile → profile_missing, no DB writes.
  test("returns profile_missing when no profile row exists", async () => {
    const mock = makeSupabaseMock({
      profile: null,
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const result = await createAuthorizationCode(mock.supabase, makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("profile_missing");
    expect(mock.insertCalled()).toBe(false);
  });

  // 4. Profile exists but mcp_status != 'active' → stake_required.
  test("returns stake_required when mcp_status = pending_stake", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "pending_stake" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const result = await createAuthorizationCode(mock.supabase, makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("stake_required");
    expect(mock.insertCalled()).toBe(false);
  });

  // 5. Unknown client_id → invalid_client.
  test("returns invalid_client when client_id not found", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: null,
    });

    const result = await createAuthorizationCode(mock.supabase, makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_client");
    expect(mock.insertCalled()).toBe(false);
  });

  // 6. redirect_uri not in registered list → invalid_redirect_uri.
  test("returns invalid_redirect_uri when uri is not registered", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const result = await createAuthorizationCode(
      mock.supabase,
      makeInput({ redirect_uri: "http://evil.example/steal" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_redirect_uri");
    expect(mock.insertCalled()).toBe(false);
  });

  // 7. Localhost redirect_uri matching registered → happy path.
  test("accepts http://localhost callback when exactly registered", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: {
        id: "cl_x",
        redirect_uris: ["http://localhost:3334/cb"],
      },
    });

    const result = await createAuthorizationCode(
      mock.supabase,
      makeInput({ redirect_uri: "http://localhost:3334/cb" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirect_url).toMatch(
      /^http:\/\/localhost:3334\/cb\?code=code_[A-Za-z0-9_-]{43}&state=xyz$/,
    );
  });

  // 8. Trailing slash mismatch → invalid_redirect_uri (exact match).
  test("rejects trailing-slash variant as invalid_redirect_uri", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
    });

    const result = await createAuthorizationCode(
      mock.supabase,
      makeInput({ redirect_uri: "http://localhost/cb/" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_redirect_uri");
    expect(mock.insertCalled()).toBe(false);
  });

  // 9. Existing query params on redirect_uri are preserved.
  test("preserves existing query params on redirect_uri and appends code+state", async () => {
    const redirectUri = "http://localhost/cb?foo=bar";
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: [redirectUri] },
    });

    const result = await createAuthorizationCode(
      mock.supabase,
      makeInput({ redirect_uri: redirectUri }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = new URL(result.redirect_url);
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("state")).toBe("xyz");
    const code = url.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(code!.startsWith("code_")).toBe(true);
    expect(code!.length).toBe(48);
  });

  // 10. DB insert fails → db_error.
  test("returns db_error when insert into oauth_codes fails", async () => {
    const mock = makeSupabaseMock({
      profile: { mcp_status: "active" },
      client: { id: "cl_x", redirect_uris: ["http://localhost/cb"] },
      insertError: { message: "connection refused" },
    });

    const result = await createAuthorizationCode(mock.supabase, makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("db_error");
  });
});
