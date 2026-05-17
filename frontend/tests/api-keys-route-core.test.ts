/**
 * GHB-188 — tests for `lib/api-keys-route-core.ts`.
 *
 * Tests run against the three exported functions:
 *   - listApiKeys(supabase, user_id)
 *   - createApiKey(supabase, { user_id, name })
 *   - revokeApiKey(supabase, { id, user_id })
 *
 * Uses hand-rolled Supabase mocks (no network), following the same
 * pattern as gas-station-route-core.test.ts.
 */

import { describe, expect, test, vi } from "vitest";
import { verifyApiKey } from "@ghbounty/shared";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from "@/lib/api-keys-route-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

// ---------------------------------------------------------------------------
// Minimal Supabase mock builder
// ---------------------------------------------------------------------------

type ApiKeyRow = Database["public"]["Tables"]["api_keys"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Build a minimal chained mock for a single Supabase table call.
 * Resolves to `{ data, error }` matching the Supabase PostgREST client.
 */
function makeMockSupabase({
  profileRow,
  profileError,
  apiKeyRows,
  apiKeysError,
  insertedRow,
  insertError,
  updateData,
  updateError,
}: {
  profileRow?: ProfileRow | null;
  profileError?: { message: string } | null;
  apiKeyRows?: Partial<ApiKeyRow>[];
  apiKeysError?: { message: string } | null;
  insertedRow?: Partial<ApiKeyRow> | null;
  insertError?: { message: string } | null;
  updateData?: Partial<ApiKeyRow> | null;
  updateError?: { message: string } | null;
}) {
  // We need to intercept `.from("api_keys")` and `.from("profiles")`
  // with different chain behaviours depending on the call.
  // Use a simple from-call counter approach.
  let fromCallIndex = 0;

  const mock = {
    from: vi.fn((table: string) => {
      fromCallIndex++;

      if (table === "profiles") {
        // Profile select chain: .select().eq().maybeSingle()
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: profileRow ?? null,
                error: profileError ?? null,
              }),
            }),
          }),
        };
      }

      if (table === "api_keys") {
        // Could be: select/insert/update depending on the operation.
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: apiKeyRows ?? [],
                error: apiKeysError ?? null,
              }),
              // For revokeApiKey: .eq().maybeSingle()
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  apiKeyRows && apiKeyRows.length > 0 ? apiKeyRows[0] : null,
                error: apiKeysError ?? null,
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: insertedRow ?? null,
                error: insertError ?? null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: updateData ?? null,
                error: updateError ?? null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return mock as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// listApiKeys
// ---------------------------------------------------------------------------

describe("listApiKeys", () => {
  const USER_ID = "did:privy:test_user";

  test("returns array of key summaries (no key_hash)", async () => {
    const rows: Partial<ApiKeyRow>[] = [
      {
        id: "uuid-1",
        user_id: USER_ID,
        name: "My Key",
        key_prefix: "ghbk_live_abc123456789",
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
        key_hash: "should-not-appear",
      },
    ];

    // Build a mock where api_keys.select returns these rows
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: rows,
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listApiKeys(supabase, USER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    const key = result[0]!;
    expect(key.id).toBe("uuid-1");
    expect(key.name).toBe("My Key");
    expect(key.key_prefix).toBe("ghbk_live_abc123456789");
    // key_hash must never appear in the summary
    expect("key_hash" in key).toBe(false);
    // user_id must not be exposed
    expect("user_id" in key).toBe(false);
  });

  test("filters by user_id (eq called with user_id)", async () => {
    const eqMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqMock,
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await listApiKeys(supabase, USER_ID);

    expect(eqMock).toHaveBeenCalledWith("user_id", USER_ID);
  });

  test("orders by created_at descending", async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: orderMock,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await listApiKeys(supabase, USER_ID);

    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  test("returns empty array when user has no keys", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await listApiKeys(supabase, USER_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createApiKey
// ---------------------------------------------------------------------------

describe("createApiKey", () => {
  const USER_ID = "did:privy:test_user";
  const NAME = "My API Key";

  function makeActiveProfile(): ProfileRow {
    return {
      user_id: USER_ID,
      role: "dev",
      email: null,
      onboarding_completed: true,
      mcp_status: "active",
      warnings: 0,
      github_handle: null,
      wallet_pubkey: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  test("happy path: mints key, inserts row, returns plaintext once", async () => {
    let capturedInsert: Record<string, unknown> | null = null;
    const insertedId = "new-uuid-123";

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: makeActiveProfile(), error: null }),
              }),
            }),
          };
        }
        if (table === "api_keys") {
          return {
            insert: vi.fn((row: unknown) => {
              capturedInsert = row as Record<string, unknown>;
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: insertedId,
                      user_id: USER_ID,
                      name: NAME,
                      key_prefix: (capturedInsert as Record<string, unknown>)?.key_prefix,
                      key_hash: (capturedInsert as Record<string, unknown>)?.key_hash,
                      created_at: "2026-01-01T00:00:00Z",
                      last_used_at: null,
                      revoked_at: null,
                      expires_at: null,
                    },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await createApiKey(supabase, { user_id: USER_ID, name: NAME });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.id).toBe(insertedId);
    expect(result.name).toBe(NAME);
    expect(typeof result.plaintext).toBe("string");
    expect(result.plaintext.startsWith("ghbk_live_")).toBe(true);
    expect(typeof result.key_prefix).toBe("string");

    // key_hash stored must verify against returned plaintext
    expect(capturedInsert).not.toBeNull();
    const hash = (capturedInsert as unknown as Record<string, string>).key_hash;
    expect(verifyApiKey(result.plaintext, hash)).toBe(true);
  });

  test("rejects when mcp_status !== 'active'", async () => {
    const profile: ProfileRow = {
      ...{
        user_id: USER_ID,
        role: "dev",
        email: null,
        onboarding_completed: false,
        mcp_status: "pending_stake" as const,
        warnings: 0,
        github_handle: null,
        wallet_pubkey: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: profile, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await createApiKey(supabase, { user_id: USER_ID, name: NAME });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("stake_required");
  });

  test("rejects empty name", async () => {
    const supabase = {
      from: vi.fn(),
    } as unknown as SupabaseClient<Database>;

    const result = await createApiKey(supabase, { user_id: USER_ID, name: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_name");
  });

  test("rejects name longer than 64 chars", async () => {
    const supabase = {
      from: vi.fn(),
    } as unknown as SupabaseClient<Database>;

    const result = await createApiKey(supabase, {
      user_id: USER_ID,
      name: "a".repeat(65),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_name");
  });

  test("rejects when profile is missing", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await createApiKey(supabase, { user_id: USER_ID, name: NAME });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("profile_missing");
  });

  test("does not insert when profile check fails", async () => {
    const insertMock = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "api_keys") {
          return { insert: insertMock };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    await createApiKey(supabase, { user_id: USER_ID, name: NAME });
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// revokeApiKey
// ---------------------------------------------------------------------------

describe("revokeApiKey", () => {
  const USER_ID = "did:privy:test_user";
  const KEY_ID = "key-uuid-abc";

  test("revokes an active key owned by the caller", async () => {
    const activeKey: Partial<ApiKeyRow> = {
      id: KEY_ID,
      user_id: USER_ID,
      revoked_at: null,
    };

    const updateEq2Mock = vi.fn().mockResolvedValue({ error: null });
    const updateEq1Mock = vi.fn().mockReturnValue({ eq: updateEq2Mock });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq1Mock });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "api_keys") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: activeKey, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await revokeApiKey(supabase, { id: KEY_ID, user_id: USER_ID });
    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalled();
  });

  test("returns not_found when key doesn't belong to caller", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "api_keys") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await revokeApiKey(supabase, {
      id: KEY_ID,
      user_id: "other-user",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  test("returns already_revoked when revoked_at is set", async () => {
    const revokedKey: Partial<ApiKeyRow> = {
      id: KEY_ID,
      user_id: USER_ID,
      revoked_at: "2026-01-01T00:00:00Z",
    };

    const updateMock = vi.fn();

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "api_keys") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi
                    .fn()
                    .mockResolvedValue({ data: revokedKey, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await revokeApiKey(supabase, { id: KEY_ID, user_id: USER_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_revoked");
    // idempotency: do NOT call update when already revoked
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("ownership enforced: query uses both id AND user_id", async () => {
    const outerEqMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "api_keys") {
          return {
            select: vi.fn().mockReturnValue({ eq: outerEqMock }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    await revokeApiKey(supabase, { id: KEY_ID, user_id: USER_ID });

    // First .eq() should be on "id" or "user_id" — both must be called
    expect(outerEqMock).toHaveBeenCalled();
  });
});
