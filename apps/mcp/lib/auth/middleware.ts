// Bearer token authentication for MCP tool calls.
//
// Flow:
//   1. Parse `Authorization: Bearer <plaintext>` header.
//   2. Dispatch by token prefix:
//        ghbk_live_  → api_key path
//        ghbo_live_  → OAuth path (not yet implemented)
//   3. For api_key path:
//      a. Extract first 22 chars (prefix) for indexed DB lookup.
//      b. Fetch api_keys row joined to profiles (via api_keys.user_id FK).
//      c. bcrypt-verify the plaintext against key_hash.
//      d. Reject if revoked OR profile.mcp_status is not 'active'.
//      e. Return the MCPProfile for the tool to use.

import { extractPrefix, verifyApiKey } from "./api-key";
import { extractOAuthTokenPrefix, verifyOAuthToken } from "@ghbounty/shared";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthResult, MCPProfile } from "@/lib/tools/types";

const API_KEY_PREFIX = "ghbk_live_";
const OAUTH_TOKEN_PREFIX = "ghbo_live_";

export async function authenticate(
  authorizationHeader: string | undefined,
): Promise<AuthResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "Missing or malformed Authorization header" },
    };
  }

  const plaintext = authorizationHeader.slice("Bearer ".length).trim();

  if (plaintext.startsWith(API_KEY_PREFIX)) return authenticateApiKey(plaintext);
  if (plaintext.startsWith(OAUTH_TOKEN_PREFIX)) return authenticateOAuthToken(plaintext);

  return {
    ok: false,
    error: { code: "Unauthorized", message: "Invalid token format" },
  };
}

async function authenticateApiKey(plaintext: string): Promise<AuthResult> {
  let prefix: string;
  try {
    prefix = extractPrefix(plaintext);
  } catch {
    return { ok: false, error: { code: "Unauthorized", message: "Invalid API key format" } };
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, key_hash, user_id, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)",
    )
    .eq("key_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    return { ok: false, error: { code: "Unauthorized", message: "Authentication lookup failed" } };
  }
  if (!data) {
    return { ok: false, error: { code: "Unauthorized", message: "API key not found" } };
  }

  if (!verifyApiKey(plaintext, (data as any).key_hash)) {
    return { ok: false, error: { code: "Unauthorized", message: "API key mismatch" } };
  }

  // The Supabase typed-join syntax returns profiles as either an object
  // or a single-element array depending on the client version. Normalize.
  const rawProfile = (data as any).profiles;
  const profileRow = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  if (!profileRow) {
    return { ok: false, error: { code: "Unauthorized", message: "Profile record missing" } };
  }

  if (profileRow.mcp_status !== "active") {
    return {
      ok: false,
      error: {
        code: "Forbidden",
        message: `Account is ${profileRow.mcp_status}, not active`,
      },
    };
  }

  const profile: MCPProfile = {
    user_id: profileRow.user_id,
    role: profileRow.role,
    mcp_status: profileRow.mcp_status,
    wallet_pubkey: profileRow.wallet_pubkey,
    github_handle: profileRow.github_handle,
  };

  // Async: update last_used_at without blocking the response.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", (data as any).id)
    .then(() => {});

  return {
    ok: true,
    profile,
    credentialId: (data as any).id,
    credentialKind: "api_key",
  };
}

async function authenticateOAuthToken(plaintext: string): Promise<AuthResult> {
  let prefix: string;
  try {
    prefix = extractOAuthTokenPrefix(plaintext);
  } catch {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "Invalid OAuth token format" },
    };
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select(
      "id, token_hash, user_id, scopes, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)",
    )
    .eq("token_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "Authentication lookup failed" },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "OAuth token not found" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!verifyOAuthToken(plaintext, (data as any).token_hash)) {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "OAuth token mismatch" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawProfile = (data as any).profiles;
  const profileRow = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  if (!profileRow) {
    return {
      ok: false,
      error: { code: "Unauthorized", message: "Profile record missing" },
    };
  }

  if (profileRow.mcp_status !== "active") {
    return {
      ok: false,
      error: {
        code: "Forbidden",
        message: `Account is ${profileRow.mcp_status}, not active`,
      },
    };
  }

  const profile: MCPProfile = {
    user_id: profileRow.user_id,
    role: profileRow.role,
    mcp_status: profileRow.mcp_status,
    wallet_pubkey: profileRow.wallet_pubkey,
    github_handle: profileRow.github_handle,
  };

  // Async: update last_used_at without blocking the response.
  supabase
    .from("oauth_tokens")
    .update({ last_used_at: new Date().toISOString() })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .eq("id", (data as any).id)
    .then(() => {});

  return {
    ok: true,
    profile,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credentialId: (data as any).id,
    credentialKind: "oauth_token",
  };
}
