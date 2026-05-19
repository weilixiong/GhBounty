import { describe, it, expect, vi } from "vitest";
import { requireWalletDelegated } from "@/lib/tools/delegation-guard";

const makeSupabase = (row: { revoked_at: string | null } | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
  }) as any;

describe("requireWalletDelegated", () => {
  it("returns ok when an active delegation exists", async () => {
    const supabase = makeSupabase({ revoked_at: null });
    const result = await requireWalletDelegated(supabase, "did:privy:abc");
    expect(result).toEqual({ ok: true });
  });

  it("returns Forbidden when no row exists", async () => {
    const supabase = makeSupabase(null);
    const result = await requireWalletDelegated(supabase, "did:privy:abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
      expect(result.error.message).toMatch(/delegation required/i);
    }
  });

  it("returns Forbidden when the delegation was revoked", async () => {
    const supabase = makeSupabase({ revoked_at: "2026-05-18T00:00:00Z" });
    const result = await requireWalletDelegated(supabase, "did:privy:abc");
    expect(result.ok).toBe(false);
  });
});
