/**
 * GHB-188 — tests for `lib/oauth-register-core.ts`.
 *
 * Tests run against the exported function:
 *   - registerClient(supabase, { client_name, redirect_uris })
 *
 * Uses hand-rolled Supabase mocks (no network), following the same
 * pattern as api-keys-route-core.test.ts.
 */

import { describe, expect, test, vi } from "vitest";
import { registerClient } from "@/lib/oauth-register-core";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Supabase mock for `oauth_clients` insert.
 * Resolves `.from("oauth_clients").insert(...).select().single()`.
 */
function makeInsertMock(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function makeInsertCapture() {
  let capturedRow: unknown = null;
  const supabase = {
    from: vi.fn().mockReturnValue({
      insert: vi.fn((row: unknown) => {
        capturedRow = row;
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: row,
              error: null,
            }),
          }),
        };
      }),
    }),
  } as unknown as SupabaseClient;
  return { supabase, getCaptured: () => capturedRow };
}

// ---------------------------------------------------------------------------
// registerClient
// ---------------------------------------------------------------------------

describe("registerClient", () => {
  // 1. Happy path — https scheme
  test("happy path with https redirect URI returns client with id starting cl_", async () => {
    const { supabase, getCaptured } = makeInsertCapture();

    const result = await registerClient(supabase, {
      client_name: "My MCP App",
      redirect_uris: ["https://app.example/callback"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.client.id).toMatch(/^cl_/);
    expect(result.client.client_name).toBe("My MCP App");
    expect(result.client.redirect_uris).toEqual(["https://app.example/callback"]);

    // Row was actually inserted
    expect(getCaptured()).not.toBeNull();
  });

  // 2. Happy path — http://localhost native client
  test("accepts http://localhost redirect URI for native clients", async () => {
    const { supabase } = makeInsertCapture();

    const result = await registerClient(supabase, {
      client_name: "Native Dev Client",
      redirect_uris: ["http://localhost:3334/callback"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.redirect_uris).toEqual(["http://localhost:3334/callback"]);
  });

  // 3. Rejects empty client_name
  test("rejects empty client_name", async () => {
    const supabase = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await registerClient(supabase, {
      client_name: "",
      redirect_uris: ["https://app.example/callback"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_request");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // 4. Rejects client_name > 128 chars
  test("rejects client_name longer than 128 chars", async () => {
    const supabase = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await registerClient(supabase, {
      client_name: "a".repeat(129),
      redirect_uris: ["https://app.example/callback"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_request");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // 5. Rejects empty redirect_uris array
  test("rejects empty redirect_uris array", async () => {
    const supabase = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await registerClient(supabase, {
      client_name: "My App",
      redirect_uris: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_request");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // 6. Rejects javascript: scheme
  test("rejects javascript: redirect URI", async () => {
    const supabase = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await registerClient(supabase, {
      client_name: "My App",
      redirect_uris: ["javascript:alert(1)"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_request");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // 7. Rejects malformed URLs (no scheme)
  test("rejects malformed URLs with no scheme", async () => {
    const supabase = { from: vi.fn() } as unknown as SupabaseClient;

    const result = await registerClient(supabase, {
      client_name: "My App",
      redirect_uris: ["not-a-url"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_request");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // 8. DB error from insert → db_error
  test("returns db_error when insert fails", async () => {
    const supabase = makeInsertMock({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await registerClient(supabase, {
      client_name: "My App",
      redirect_uris: ["https://app.example/callback"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("db_error");
  });
});
