import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticate } from "@/lib/auth/middleware";

// Mock the supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase/admin";

describe("authenticate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns Unauthorized when header is missing", async () => {
    const result = await authenticate(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns Unauthorized for malformed Bearer header", async () => {
    const result = await authenticate("Token abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns Unauthorized for token with invalid prefix (not ghbk_live_ or ghbo_live_)", async () => {
    const result = await authenticate("Bearer foobar_invalid_token_format");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
      expect(result.error.message).toBe("Invalid token format");
    }
  });

  it("returns ok with credentialKind 'oauth_token' for valid ghbo_live_ token + active profile", async () => {
    const { mintOAuthToken } = await import("@ghbounty/shared");
    const { plaintext, hash } = mintOAuthToken();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "oauth-uuid",
                    token_hash: hash,
                    user_id: "did:privy:user-uuid",
                    scopes: ["full"],
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "active",
                      wallet_pubkey: "7xK...",
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            then: (cb: any) => cb(),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.role).toBe("dev");
      expect(result.profile.mcp_status).toBe("active");
      expect(result.profile.user_id).toBe("did:privy:user-uuid");
      expect(result.credentialKind).toBe("oauth_token");
      expect(result.credentialId).toBe("oauth-uuid");
    }
  });

  it("returns Unauthorized when ghbo_live_ token prefix not found in DB", async () => {
    const { mintOAuthToken } = await import("@ghbounty/shared");
    const { plaintext } = mintOAuthToken();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns Unauthorized when ghbo_live_ bcrypt verify fails", async () => {
    const { mintOAuthToken } = await import("@ghbounty/shared");
    const { plaintext } = mintOAuthToken();
    const { hash: wrongHash } = mintOAuthToken();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "oauth-uuid",
                    token_hash: wrongHash,
                    user_id: "did:privy:user-uuid",
                    scopes: ["full"],
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "active",
                      wallet_pubkey: null,
                      github_handle: null,
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
      expect(result.error.message).toBe("OAuth token mismatch");
    }
  });

  it("returns Forbidden when ghbo_live_ profile mcp_status is pending_stake", async () => {
    const { mintOAuthToken } = await import("@ghbounty/shared");
    const { plaintext, hash } = mintOAuthToken();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "oauth-uuid",
                    token_hash: hash,
                    user_id: "did:privy:user-uuid",
                    scopes: ["full"],
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "pending_stake",
                      wallet_pubkey: null,
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
      expect(result.error.message).toBe("Account is pending_stake, not active");
    }
  });

  it("returns Forbidden when ghbo_live_ profile mcp_status is suspended", async () => {
    const { mintOAuthToken } = await import("@ghbounty/shared");
    const { plaintext, hash } = mintOAuthToken();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "oauth-uuid",
                    token_hash: hash,
                    user_id: "did:privy:user-uuid",
                    scopes: ["full"],
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "suspended",
                      wallet_pubkey: null,
                      github_handle: null,
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
      expect(result.error.message).toBe("Account is suspended, not active");
    }
  });

  it("returns Unauthorized when prefix not found in DB", async () => {
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate("Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns profile with credentialKind 'api_key' when prefix matches and bcrypt verifies", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    user_id: "did:privy:user-uuid",
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "active",
                      wallet_pubkey: "7xK...",
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            then: (cb: any) => cb(),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.role).toBe("dev");
      expect(result.profile.mcp_status).toBe("active");
      expect(result.profile.user_id).toBe("did:privy:user-uuid");
      expect(result.credentialKind).toBe("api_key");
      expect(result.credentialId).toBe("key-uuid");
    }
  });

  it("returns profile with credentialKind 'api_key' when profiles is returned as array", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    user_id: "did:privy:user-uuid",
                    profiles: [
                      {
                        user_id: "did:privy:user-uuid",
                        role: "dev",
                        mcp_status: "active",
                        wallet_pubkey: "7xK...",
                        github_handle: "claudebot42",
                      },
                    ],
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            then: (cb: any) => cb(),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.mcp_status).toBe("active");
      expect(result.credentialKind).toBe("api_key");
    }
  });

  it("returns Forbidden when profile mcp_status is pending_stake", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    user_id: "did:privy:user-uuid",
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "pending_stake",
                      wallet_pubkey: null,
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
      expect(result.error.message).toBe("Account is pending_stake, not active");
    }
  });

  it("returns Forbidden when profile mcp_status is suspended", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    user_id: "did:privy:user-uuid",
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "suspended",
                      wallet_pubkey: null,
                      github_handle: null,
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
      expect(result.error.message).toBe("Account is suspended, not active");
    }
  });

  it("returns Unauthorized when bcrypt verify fails", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext } = mintApiKey();
    // Use a different key's hash — so verify will fail
    const { hash: wrongHash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: wrongHash,
                    user_id: "did:privy:user-uuid",
                    profiles: {
                      user_id: "did:privy:user-uuid",
                      role: "dev",
                      mcp_status: "active",
                      wallet_pubkey: null,
                      github_handle: null,
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
      expect(result.error.message).toBe("API key mismatch");
    }
  });
});
