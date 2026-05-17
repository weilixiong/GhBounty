// Shared types for tool handlers.

export interface MCPProfile {
  user_id: string;          // Privy DID
  role: "company" | "dev";
  mcp_status: "pending_stake" | "active" | "suspended" | "revoked" | "pending_oauth";
  wallet_pubkey: string | null;
  github_handle: string | null;
}

export type AuthResult =
  | { ok: true; profile: MCPProfile; credentialId: string; credentialKind: "api_key" | "oauth_token" }
  | { ok: false; error: { code: "Unauthorized" | "Forbidden"; message: string } };
