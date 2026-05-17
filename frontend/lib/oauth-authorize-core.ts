/**
 * GHB-188 — pure logic for `POST /api/oauth/authorize`.
 *
 * Validates the OAuth authorization request, mints a single-use
 * authorization code (43 base64url chars + `code_` prefix, 60s TTL),
 * persists it to `oauth_codes`, and returns the redirect URL the
 * browser should land on. The code is consumed once by
 * `POST /api/oauth/token` (Phase 4D) — this endpoint never marks it
 * consumed.
 *
 * Security:
 *   - PKCE-only (S256). `plain` is rejected.
 *   - `redirect_uri` must match EXACTLY one of the registered URIs for
 *     the client (no normalization, no prefix/suffix matching). This is
 *     OAuth 2.1 best practice — any normalization (trailing slash,
 *     case, scheme upgrade) is an open redirect waiting to happen.
 *   - Active stake gate: profile.mcp_status must be 'active'.
 *
 * Caller MUST inject a service-role Supabase client (the `oauth_codes`
 * table has no permissive RLS policies).
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const CODE_TTL_MS = 60_000; // spec §6: 60-second authorization code lifetime
const SUPPORTED_CHALLENGE_METHOD = "S256";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type AuthorizeInput = {
  /** Privy DID — resolved from the Bearer JWT in the route handler. */
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
};

export type AuthorizeResult =
  | { ok: true; redirect_url: string }
  | {
      ok: false;
      error:
        | "invalid_client"
        | "invalid_redirect_uri"
        | "unsupported_challenge_method"
        | "stake_required"
        | "profile_missing"
        | "db_error";
    };

// ---------------------------------------------------------------------------
// createAuthorizationCode
// ---------------------------------------------------------------------------

/**
 * Validate an OAuth authorize request and persist a single-use code.
 *
 * Validation order (short-circuit on first failure):
 *   1. code_challenge_method === "S256"
 *   2. profile exists for user_id
 *   3. profile.mcp_status === "active"
 *   4. client_id resolves in oauth_clients
 *   5. redirect_uri exactly matches one of client.redirect_uris
 *
 * On success: inserts `oauth_codes` row and returns the redirect URL
 * the browser should navigate to. The URL preserves any existing query
 * params on `redirect_uri` and adds `code=<48-char>&state=<state>`.
 */
export async function createAuthorizationCode(
  supabase: SupabaseClient,
  input: AuthorizeInput,
): Promise<AuthorizeResult> {
  // 1. PKCE method must be S256. `plain` is forbidden by OAuth 2.1.
  if (input.code_challenge_method !== SUPPORTED_CHALLENGE_METHOD) {
    return { ok: false, error: "unsupported_challenge_method" };
  }

  // 2. Profile lookup — must exist.
  const { data: profile } = await supabase
    .from("profiles")
    .select("mcp_status")
    .eq("user_id", input.user_id)
    .maybeSingle();

  if (!profile) {
    return { ok: false, error: "profile_missing" };
  }

  // 3. Active stake required.
  if ((profile as { mcp_status: string }).mcp_status !== "active") {
    return { ok: false, error: "stake_required" };
  }

  // 4. Client lookup. `oauth_clients` typing is not in db.types yet,
  //    so we cast to any to call the untyped select — matches the
  //    pattern in `oauth-register-core.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: client } = await (supabase as any)
    .from("oauth_clients")
    .select("id, redirect_uris")
    .eq("id", input.client_id)
    .maybeSingle();

  if (!client) {
    return { ok: false, error: "invalid_client" };
  }

  // 5. Exact-match redirect_uri against the registered list. No
  //    normalization (a trailing slash is a different URI for OAuth's
  //    purposes — see RFC 6749 §3.1.2.3).
  const registered: string[] = Array.isArray(client.redirect_uris)
    ? client.redirect_uris
    : [];
  if (!registered.includes(input.redirect_uri)) {
    return { ok: false, error: "invalid_redirect_uri" };
  }

  // 6. Mint code: 32 random bytes → 43 base64url chars + 5-char prefix = 48.
  const code = `code_${randomBytes(32).toString("base64url")}`;
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();

  // 7. Persist. We never mark `consumed_at` here — that happens at
  //    token exchange (Phase 4D).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any)
    .from("oauth_codes")
    .insert({
      code,
      user_id: input.user_id,
      client_id: input.client_id,
      code_challenge: input.code_challenge,
      redirect_uri: input.redirect_uri,
      scope: input.scope || "full",
      expires_at,
    });

  if (insertError) {
    return { ok: false, error: "db_error" };
  }

  // 8. Build the redirect URL. `new URL` + `searchParams.set` correctly
  //    handles `redirect_uri` values that already carry query params.
  const url = new URL(input.redirect_uri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", input.state);

  return { ok: true, redirect_url: url.toString() };
}
