import { describe, it, expect, vi } from "vitest";
import { handleSubmissionsList } from "@/lib/tools/submissions/list";

vi.mock("@/lib/auth/middleware", () => ({
  authenticate: vi.fn().mockResolvedValue({
    ok: true,
    profile: {
      user_id: "did:privy:abc",
      role: "dev",
      mcp_status: "active",
      wallet_pubkey: "Solver111",
      github_handle: "alice",
    },
    credentialId: "k1",
    credentialKind: "api_key",
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: "sub-1",
                    pr_url: "https://github.com/x/y/pull/1",
                    state: "scored",
                    rank: 1,
                    created_at: "2026-05-18T00:00:00Z",
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

describe("submissions.list", () => {
  it("returns the caller's submissions", async () => {
    const result = await handleSubmissionsList({ authorization: "Bearer x" });
    expect(result).toMatchObject({
      items: [
        expect.objectContaining({
          id: "sub-1",
          state: "scored",
        }),
      ],
    });
  });

  it("returns Forbidden when caller is a company", async () => {
    const { authenticate } = await import("@/lib/auth/middleware");
    (authenticate as any).mockResolvedValueOnce({
      ok: true,
      profile: {
        user_id: "did:privy:co",
        role: "company",
        mcp_status: "active",
        wallet_pubkey: null,
        github_handle: null,
      },
      credentialId: "k1",
      credentialKind: "api_key",
    });

    const result = await handleSubmissionsList({ authorization: "Bearer x" });
    expect(result).toEqual({
      error: expect.objectContaining({ code: "Forbidden" }),
    });
  });
});
