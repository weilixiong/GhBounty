/**
 * GHB-188 — pure logic for `POST /api/oauth/token`.
 *
 * The authorization-code → access-token exchange with PKCE S256
 * verification. This is the security-critical endpoint of the OAuth
 * flow: it consumes single-use codes from `oauth_codes` (inserted by
 * `oauth-authorize-core.ts`) and mints rows in `oauth_tokens` that the
 * MCP middleware (Phase 4F) will later look up by token_prefix.
 *
 * Validation order (strict — short-circuit on first failure):
 *   1. grant_type === "authorization_code"
 *   2. oauth_codes row exists, not consumed, not expired
 *   3. PKCE: SHA256(verifier).b64url() === row.code_challenge
 *   4. row.client_id === input.client_id
 *   5. row.redirect_uri === input.redirect_uri
 *   6. UPDATE oauth_codes SET consumed_at = now() WHERE code = $1
 *      AND consumed_at IS NULL — affected count must be 1.
 *      (Without the `consumed_at IS NULL` guard, two concurrent
 *      requests that both passed step 2 would each succeed → forked
 *      tokens. This is the single most security-critical line.)
 *   7. Mint ghbo_live_* and INSERT into oauth_tokens.
 *
 * If step 7 fails after step 6 succeeded, the code remains consumed
 * (no rollback). The client retrying gets `invalid_grant` at step 2
 * on retry — they must restart the flow. Acceptable v1 behavior.
 *
 * Caller MUST inject a service-role Supabase client.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mintOAuthToken } from "@ghbounty/shared";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ExchangeInput = {
  grant_type: string;
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
};

export type ExchangeResult =
  | {
      ok: true;
      access_token: string;
      token_type: "Bearer";
      scope: string;
    }
  | {
      ok: false;
      error:
        | "invalid_grant"
        | "unsupported_grant_type"
        | "invalid_client"
        | "db_error";
    };

// ---------------------------------------------------------------------------
// exchangeCodeForToken
// ---------------------------------------------------------------------------

export async function exchangeCodeForToken(
  supabase: SupabaseClient,
  input: ExchangeInput,
): Promise<ExchangeResult> {
  // 1. Only authorization_code grant is supported in v1.
  if (input.grant_type !== "authorization_code") {
    return { ok: false, error: "unsupported_grant_type" };
  }

  // 2. Look up the code. `oauth_codes` is not typed in db.types yet,
  //    so we cast (matches the pattern in oauth-authorize-core.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error: selectError } = await (supabase as any)
    .from("oauth_codes")
    .select(
      "code, user_id, client_id, code_challenge, redirect_uri, scope, expires_at, consumed_at",
    )
    .eq("code", input.code)
    .maybeSingle();

  if (selectError) {
    return { ok: false, error: "db_error" };
  }
  if (!row) {
    return { ok: false, error: "invalid_grant" };
  }
  if (row.consumed_at) {
    return { ok: false, error: "invalid_grant" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }

  // 3. PKCE S256 verify. crypto.createHash + "base64url" digest
  //    produces the correct unpadded URL-safe encoding directly.
  const expectedChallenge = createHash("sha256")
    .update(input.code_verifier)
    .digest("base64url");
  if (expectedChallenge !== row.code_challenge) {
    return { ok: false, error: "invalid_grant" };
  }

  // 4. client_id binding (defense in depth).
  if (row.client_id !== input.client_id) {
    return { ok: false, error: "invalid_grant" };
  }

  // 5. redirect_uri binding (defense in depth — RFC 6749 §4.1.3).
  if (row.redirect_uri !== input.redirect_uri) {
    return { ok: false, error: "invalid_grant" };
  }

  // 6. Mark code consumed ATOMICALLY. The `.is("consumed_at", null)`
  //    guard turns this into a CAS — if a concurrent request already
  //    consumed the code between our SELECT and this UPDATE, the
  //    affected row count is 0 and we bail without minting a token.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateRes = await (supabase as any)
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() }, { count: "exact" })
    .eq("code", input.code)
    .is("consumed_at", null);

  if (updateRes.error) {
    return { ok: false, error: "db_error" };
  }
  if (updateRes.count !== null && updateRes.count !== undefined && updateRes.count < 1) {
    // Race lost: someone else consumed the code between SELECT and UPDATE.
    return { ok: false, error: "invalid_grant" };
  }

  // 7. Resolve the human-readable client name for `oauth_tokens.name`.
  //    Falls back to a generic label if the client record vanished
  //    (e.g. cascade delete in flight).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: client } = await (supabase as any)
    .from("oauth_clients")
    .select("client_name")
    .eq("id", row.client_id)
    .maybeSingle();

  const clientName: string =
    (client && typeof client.client_name === "string" && client.client_name) ||
    "OAuth client";

  // 8. Mint the access token. The plaintext is returned exactly once
  //    — to the API caller. Only the hash + prefix are persisted.
  const minted = mintOAuthToken();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any)
    .from("oauth_tokens")
    .insert({
      user_id: row.user_id,
      client_id: row.client_id,
      name: clientName,
      token_hash: minted.hash,
      token_prefix: minted.prefix,
      scopes: [row.scope || "full"],
      expires_at: null, // forever-until-revoked in v1
    });

  if (insertError) {
    // Code is already marked consumed. We accept this — the client
    // will retry, get `invalid_grant`, and restart the flow.
    return { ok: false, error: "db_error" };
  }

  return {
    ok: true,
    access_token: minted.plaintext,
    token_type: "Bearer",
    scope: row.scope || "full",
  };
}
