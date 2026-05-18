/**
 * submissions.create — happy-path test (GHB-187).
 * Error-case tests live in Task 10.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module mocks (hoisted before imports) ---

vi.mock("@/lib/auth/middleware", () => ({
  authenticate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));

vi.mock("@ghbounty/shared", () => ({
  verifyPrOwnership: vi.fn(),
}));

vi.mock("@/lib/privy/delegated-signer", () => ({
  getPrivyServerClient: vi.fn(),
  signSolanaTransaction: vi.fn(),
}));

vi.mock("@/lib/solana/build-submit-solution-tx", () => ({
  buildSubmitSolutionTx: vi.fn(),
}));

vi.mock("@/lib/solana/rpc", () => ({
  solanaRpc: vi.fn(),
}));

vi.mock("@/lib/gas-station/server", () => ({
  submitSponsoredTx: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getChainId: () => "solana-devnet",
  getProgramAddress: () => "test_program_addr",
}));

// --- Imports after mocks ---
import { handleSubmissionsCreate } from "@/lib/tools/submissions/create";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyPrOwnership } from "@ghbounty/shared";
import {
  getPrivyServerClient,
  signSolanaTransaction,
} from "@/lib/privy/delegated-signer";
import { buildSubmitSolutionTx } from "@/lib/solana/build-submit-solution-tx";
import { solanaRpc } from "@/lib/solana/rpc";
import { submitSponsoredTx } from "@/lib/gas-station/server";

// --- Fixtures ---

const baseProfile = {
  user_id: "did:privy:alice",
  role: "dev" as const,
  mcp_status: "active" as const,
  wallet_pubkey: "Solver111",
  github_handle: "alice",
};

function buildSupabase(
  opts: { existingSubmission?: boolean; bountyState?: string } = {}
) {
  return {
    from: (table: string) => {
      if (table === "agent_delegations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { revoked_at: null }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "issues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "bounty-1",
                    pda: "BountyPda1",
                    chain_id: "solana-devnet",
                    github_issue_url:
                      "https://github.com/acme/proj/issues/42",
                    state: opts.bountyState ?? "open",
                    submission_count: 0,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "submissions") {
        // First call: idempotency check (no existing submission by default)
        // Second call: insert
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.existingSubmission
                        ? { id: "sub-dup", state: "pending" }
                        : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
          upsert: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "sub-new" }, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({}) };
    },
  } as any;
}

// --- Tests ---

describe("submissions.create — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (authenticate as any).mockResolvedValue({
      ok: true,
      profile: baseProfile,
      credentialId: "k1",
      credentialKind: "api_key",
    });

    (supabaseAdmin as any).mockReturnValue(buildSupabase());

    (verifyPrOwnership as any).mockResolvedValue({ ok: true });

    (getPrivyServerClient as any).mockReturnValue({});
    (signSolanaTransaction as any).mockResolvedValue({
      ok: true,
      signedTx: new Uint8Array([7, 7, 7]),
    });

    (buildSubmitSolutionTx as any).mockResolvedValue({
      unsignedTx: new Uint8Array([1, 2, 3]),
      submissionPda: "Sub111",
      submissionIndex: 0,
    });

    (solanaRpc as any).mockReturnValue({
      getLatestBlockhash: () => ({
        send: async () => ({
          value: { blockhash: "Bh1", lastValidBlockHeight: 1 },
        }),
      }),
    });

    (submitSponsoredTx as any).mockResolvedValue({
      ok: true,
      signature: "tx_sig_123",
    });

    process.env.GAS_STATION_PUBKEY = "Ga1111";
    process.env.SOLANA_RPC_URL = "https://example.invalid";
    process.env.CHAIN_ID = "solana-devnet";
  });

  it("creates a submission and returns the id + tx signature", async () => {
    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect(result).toMatchObject({
      submission_id: "sub-new",
      status: "pending",
      tx_signature: "tx_sig_123",
      submission_pda: "Sub111",
    });
    expect((result as any).idempotent).toBeUndefined();
  });

  it("returns idempotent result when submission already exists", async () => {
    (supabaseAdmin as any).mockReturnValue(
      buildSupabase({ existingSubmission: true })
    );

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect(result).toMatchObject({
      submission_id: "sub-dup",
      status: "pending",
      tx_signature: null,
      idempotent: true,
    });
    // Gas station should NOT have been called
    expect(submitSponsoredTx).not.toHaveBeenCalled();
  });

  it("returns Forbidden when role is company", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      profile: { ...baseProfile, role: "company" },
      credentialId: "k1",
      credentialKind: "api_key",
    });

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect((result as any).error?.code).toBe("Forbidden");
  });

  it("returns Forbidden when PR ownership check fails", async () => {
    (verifyPrOwnership as any).mockResolvedValue({
      ok: false,
      reason: "author_mismatch",
    });

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect((result as any).error?.code).toBe("Forbidden");
    expect(submitSponsoredTx).not.toHaveBeenCalled();
  });

  it("returns Conflict when bounty is not open", async () => {
    (supabaseAdmin as any).mockReturnValue(
      buildSupabase({ bountyState: "resolved" })
    );

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect((result as any).error?.code).toBe("Conflict");
  });

  it("returns idempotent even if the bounty was closed after the original submission", async () => {
    // Scenario: the agent submitted successfully, bounty was then resolved, and
    // the agent retries the same call. Idempotency check runs BEFORE the state
    // check, so the existing submission is found and returned — NOT 409 Conflict.
    (supabaseAdmin as any).mockReturnValue(
      buildSupabase({ existingSubmission: true, bountyState: "resolved" })
    );

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect(result).toMatchObject({
      submission_id: "sub-dup",
      status: "pending",
      tx_signature: null,
      idempotent: true,
    });
    expect((result as any).error).toBeUndefined();
    // Gas station must NOT have been called
    expect(submitSponsoredTx).not.toHaveBeenCalled();
  });

  it("returns ServiceUnavailable when PR ownership check fails with rate_limited", async () => {
    (verifyPrOwnership as any).mockResolvedValue({
      ok: false,
      reason: "rate_limited",
    });

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect((result as any).error?.code).toBe("ServiceUnavailable");
    expect(submitSponsoredTx).not.toHaveBeenCalled();
  });

  it("returns ServiceUnavailable when PR ownership check fails with upstream_error", async () => {
    (verifyPrOwnership as any).mockResolvedValue({
      ok: false,
      reason: "upstream_error",
    });

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: "https://github.com/acme/proj/pull/1",
    });

    expect((result as any).error?.code).toBe("ServiceUnavailable");
    expect(submitSponsoredTx).not.toHaveBeenCalled();
  });

  it("returns InvalidInput when pr_url exceeds 200 characters", async () => {
    const longUrl = "https://github.com/acme/proj/pull/" + "x".repeat(200);

    const result = await handleSubmissionsCreate({
      authorization: "Bearer x",
      bounty_id: "00000000-0000-0000-0000-000000000001",
      pr_url: longUrl,
    });

    expect((result as any).error?.code).toBe("InvalidInput");
  });
});
