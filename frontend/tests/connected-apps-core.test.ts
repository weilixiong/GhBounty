/**
 * GHB-188 — tests for `lib/connected-apps-core.ts`.
 *
 * Tests run against the two exported functions:
 *   - listConnectedApps(supabase, user_id)
 *   - revokeConnectedApp(supabase, { id, user_id })
 *
 * Uses hand-rolled Supabase mocks (no network), same pattern as
 * api-keys-route-core.test.ts.
 */

import { describe, expect, test, vi } from "vitest";
import { listConnectedApps, revokeConnectedApp } from "@/lib/connected-apps-core";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// listConnectedApps
// ---------------------------------------------------------------------------

describe("listConnectedApps", () => {
  const USER_ID = "did:privy:test_user";

  test("returns rows owned by user_id, sorted created_at DESC", async () => {
    const rows = [
      {
        id: "tok-2",
        user_id: USER_ID,
        client_id: "cl_secret",
        name: "Claude Code",
        scopes: ["submissions:read"],
        created_at: "2026-02-01T00:00:00Z",
        last_used_at: "2026-02-10T00:00:00Z",
        revoked_at: null,
      },
      {
        id: "tok-1",
        user_id: USER_ID,
        client_id: "cl_other",
        name: "Another App",
        scopes: ["submissions:read", "submissions:write"],
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
      },
    ];

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await listConnectedApps(supabase, USER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("tok-2");
    expect(result[1]!.id).toBe("tok-1");
  });

  test("filters out revoked rows (revoked_at IS NULL enforced)", async () => {
    // The mock simulates the DB already filtering via IS NULL; we verify
    // the chain includes the .is() call with null.
    const isMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ is: isMock }),
        }),
      }),
    } as unknown as SupabaseClient;

    await listConnectedApps(supabase, USER_ID);

    expect(isMock).toHaveBeenCalledWith("revoked_at", null);
  });

  test("returns empty array when user has no tokens", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await listConnectedApps(supabase, USER_ID);
    expect(result).toEqual([]);
  });

  test("throws on DB error", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "connection refused" },
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listConnectedApps(supabase, USER_ID)).rejects.toThrow(
      "connection refused",
    );
  });

  test("returned objects have ONLY the 5 allowed fields (no client_id, no token_hash)", async () => {
    const rows = [
      {
        id: "tok-1",
        user_id: USER_ID,
        client_id: "cl_should_not_leak",
        name: "Claude Code",
        scopes: ["submissions:read"],
        created_at: "2026-01-01T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
        token_hash: "hash-should-not-leak",
      },
    ];

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await listConnectedApps(supabase, USER_ID);

    expect(result).toHaveLength(1);
    const app = result[0]!;
    // Only these 5 fields allowed
    expect(Object.keys(app).sort()).toEqual(
      ["id", "name", "scopes", "created_at", "last_used_at"].sort(),
    );
    expect("client_id" in app).toBe(false);
    expect("token_hash" in app).toBe(false);
    expect("user_id" in app).toBe(false);
    expect("revoked_at" in app).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// revokeConnectedApp
// ---------------------------------------------------------------------------

describe("revokeConnectedApp", () => {
  const USER_ID = "did:privy:test_user";
  const TOKEN_ID = "tok-uuid-abc";

  test("happy path: revokes a token owned by the user", async () => {
    const activeToken = { id: TOKEN_ID, user_id: USER_ID, revoked_at: null };

    const updateEq2Mock = vi.fn().mockResolvedValue({ error: null });
    const updateEq1Mock = vi.fn().mockReturnValue({ eq: updateEq2Mock });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq1Mock });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "oauth_tokens") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: activeToken,
                    error: null,
                  }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await revokeConnectedApp(supabase, { id: TOKEN_ID, user_id: USER_ID });
    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalled();
  });

  test("returns not_found when id doesn't belong to caller or doesn't exist", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "oauth_tokens") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await revokeConnectedApp(supabase, {
      id: TOKEN_ID,
      user_id: "other-user",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });

  test("returns already_revoked when revoked_at is already set", async () => {
    const revokedToken = {
      id: TOKEN_ID,
      user_id: USER_ID,
      revoked_at: "2026-01-01T00:00:00Z",
    };
    const updateMock = vi.fn();

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "oauth_tokens") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: revokedToken,
                    error: null,
                  }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await revokeConnectedApp(supabase, { id: TOKEN_ID, user_id: USER_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_revoked");
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("returns db_error on update failure", async () => {
    const activeToken = { id: TOKEN_ID, user_id: USER_ID, revoked_at: null };

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "oauth_tokens") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: activeToken,
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  error: { message: "db write failed" },
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await revokeConnectedApp(supabase, { id: TOKEN_ID, user_id: USER_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("db_error");
  });
});
