/**
 * GHB-188 — tests for `lib/stake-route-core.ts`.
 *
 * Tests the exported function:
 *   - handleStakeConfirmation(supabase, input)
 *
 * Uses hand-rolled Supabase mocks (no network), following the same
 * pattern as api-keys-route-core.test.ts.
 */

import { describe, expect, test, vi } from "vitest";
import {
  handleStakeConfirmation,
  type StakeConfirmationInput,
} from "@/lib/stake-route-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type StakeDepositRow = Database["public"]["Tables"]["stake_deposits"]["Row"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "did:privy:test_user";
const WALLET = "BPFLoaderUpgradeab1e11111111111111111111111";
const OTHER_WALLET = "So11111111111111111111111111111111111111112";
const TX_SIG = "5KtPcNb2xR1G2GfshkVjh8G4qKdECLwNtq7BRXrFaUWA5sRTkwYZjpQaZuByvUMXu";
const PDA = "Gh9CJuLpb5EMgLgr5Zz4JaGeDbbGe9oHfBHzJgAbFDXa";
const LOCKED_UNTIL = new Date("2026-06-01T00:00:00Z");
const AMOUNT_LAMPORTS = BigInt(35_000_000);

function makeInput(overrides: Partial<StakeConfirmationInput> = {}): StakeConfirmationInput {
  return {
    user_id: USER_ID,
    wallet_pubkey: WALLET,
    tx_signature: TX_SIG,
    pda: PDA,
    locked_until: LOCKED_UNTIL,
    amount_lamports: AMOUNT_LAMPORTS,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: USER_ID,
    role: "dev",
    email: null,
    onboarding_completed: false,
    mcp_status: "pending_stake",
    warnings: 0,
    github_handle: null,
    wallet_pubkey: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Build a minimal chained Supabase mock for `handleStakeConfirmation`.
 * Two tables: `profiles` (select) and `stake_deposits` (insert) + `profiles` (update).
 */
function makeMock({
  profileRow,
  profileError,
  stakeInsertError,
  profileUpdateError,
}: {
  profileRow?: ProfileRow | null;
  profileError?: { message: string } | null;
  stakeInsertError?: { message: string } | null;
  profileUpdateError?: { message: string } | null;
} = {}) {
  const insertMock = vi.fn().mockResolvedValue({
    data: stakeInsertError ? null : { id: "stake-uuid" },
    error: stakeInsertError ?? null,
  });

  const profileUpdateEqMock = vi.fn().mockResolvedValue({
    error: profileUpdateError ?? null,
  });
  const profileUpdateMock = vi.fn().mockReturnValue({
    eq: profileUpdateEqMock,
  });

  let profilesCallCount = 0;

  const mock = {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        profilesCallCount++;
        if (profilesCallCount === 1) {
          // First call: select to look up profile
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: profileRow !== undefined ? profileRow : null,
                  error: profileError ?? null,
                }),
              }),
            }),
          };
        } else {
          // Second call: update after stake insert
          return {
            update: profileUpdateMock,
          };
        }
      }

      if (table === "stake_deposits") {
        return {
          insert: insertMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase: mock as unknown as SupabaseClient<Database>,
    insertMock,
    profileUpdateMock,
    profileUpdateEqMock,
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("handleStakeConfirmation", () => {
  // 1. Happy path: wallet_pubkey was null → set it + activate
  test("happy path: wallet_pubkey=null → inserts stake, updates mcp_status AND wallet_pubkey", async () => {
    const { supabase, insertMock, profileUpdateMock } = makeMock({
      profileRow: makeProfile({ wallet_pubkey: null }),
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: true });

    // stake_deposits insert must have been called
    expect(insertMock).toHaveBeenCalledOnce();
    const insertArg = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.user_id).toBe(USER_ID);
    expect(insertArg.pda).toBe(PDA);
    expect(insertArg.tx_signature).toBe(TX_SIG);
    expect(insertArg.status).toBe("active");
    expect(String(insertArg.amount_lamports)).toBe("35000000");
    expect(typeof insertArg.locked_until).toBe("string");

    // profiles update must include wallet_pubkey
    expect(profileUpdateMock).toHaveBeenCalledOnce();
    const updateArg = profileUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg.mcp_status).toBe("active");
    expect(updateArg.wallet_pubkey).toBe(WALLET);
  });

  // 2. Happy path: wallet_pubkey already set and matches → only update mcp_status
  test("happy path: wallet_pubkey matches → inserts stake, updates mcp_status only", async () => {
    const { supabase, insertMock, profileUpdateMock } = makeMock({
      profileRow: makeProfile({ wallet_pubkey: WALLET }),
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledOnce();

    const updateArg = profileUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg.mcp_status).toBe("active");
    // wallet_pubkey should NOT be updated (already set and matches)
    expect("wallet_pubkey" in updateArg).toBe(false);
  });

  // 3. wallet_pubkey mismatch → wallet_mismatch, no DB writes
  test("wallet_pubkey mismatch → wallet_mismatch, no DB writes", async () => {
    const { supabase, insertMock, profileUpdateMock } = makeMock({
      profileRow: makeProfile({ wallet_pubkey: OTHER_WALLET }),
    });

    const result = await handleStakeConfirmation(supabase, makeInput({ wallet_pubkey: WALLET }));

    expect(result).toEqual({ ok: false, error: "wallet_mismatch" });
    expect(insertMock).not.toHaveBeenCalled();
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  // 4. mcp_status already active → already_staked, no DB writes
  test("mcp_status=active → already_staked, no DB writes", async () => {
    const { supabase, insertMock, profileUpdateMock } = makeMock({
      profileRow: makeProfile({ mcp_status: "active", wallet_pubkey: WALLET }),
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: false, error: "already_staked" });
    expect(insertMock).not.toHaveBeenCalled();
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  // 5. Profile missing → profile_missing, no DB writes
  test("profile missing → profile_missing, no DB writes", async () => {
    const { supabase, insertMock, profileUpdateMock } = makeMock({
      profileRow: null,
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: false, error: "profile_missing" });
    expect(insertMock).not.toHaveBeenCalled();
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  // 6. stake_deposits insert fails → db_error, profile NOT updated
  test("stake_deposits insert fails → db_error, profile not updated", async () => {
    const { supabase, profileUpdateMock } = makeMock({
      profileRow: makeProfile({ wallet_pubkey: null }),
      stakeInsertError: { message: "unique violation" },
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: false, error: "db_error" });
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  // 7. profiles update fails after stake insert → db_error (partial state, logged)
  test("profiles update fails after stake insert → db_error (partial state)", async () => {
    const { supabase, insertMock } = makeMock({
      profileRow: makeProfile({ wallet_pubkey: null }),
      profileUpdateError: { message: "connection reset" },
    });

    const result = await handleStakeConfirmation(supabase, makeInput());

    expect(result).toEqual({ ok: false, error: "db_error" });
    // stake insert still happened
    expect(insertMock).toHaveBeenCalledOnce();
  });
});
