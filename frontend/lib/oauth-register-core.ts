/**
 * GHB-188 — pure logic for `POST /api/oauth/register` (RFC 7591 DCR).
 *
 * Public endpoint — no auth required. PKCE replaces client_secret.
 * Anyone may register a client; rate limiting is a v2 concern (spec §12).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Exported result types
// ---------------------------------------------------------------------------

export type RegisterResult =
  | { ok: true; client: { id: string; client_name: string; redirect_uris: string[] } }
  | { ok: false; error: "invalid_request" | "db_error" };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES = new Set(["https:", "http:"]);
const REJECTED_SCHEMES = new Set(["javascript:", "data:", "file:"]);

function isValidRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  // Reject dangerous schemes explicitly
  if (REJECTED_SCHEMES.has(parsed.protocol)) return false;

  // Only allow https or http
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return false;

  // For http, only allow localhost (native client dev per OAuth 2.1 best practice)
  if (parsed.protocol === "http:") {
    return parsed.hostname === "localhost";
  }

  return true;
}

// ---------------------------------------------------------------------------
// registerClient
// ---------------------------------------------------------------------------

/**
 * Validate input and insert a new OAuth client row.
 *
 * Validation:
 *   - client_name: 1–128 chars (trimmed)
 *   - redirect_uris: non-empty; each must be https:// or http://localhost
 *
 * On success: id = "cl_" + crypto.randomUUID()
 * On DB error: { ok: false, error: "db_error" }
 */
export async function registerClient(
  supabase: SupabaseClient,
  input: { client_name: string; redirect_uris: string[] },
): Promise<RegisterResult> {
  const trimmedName = input.client_name.trim();

  // Validate client_name
  if (trimmedName.length < 1 || trimmedName.length > 128) {
    return { ok: false, error: "invalid_request" };
  }

  // Validate redirect_uris
  if (!input.redirect_uris.length) {
    return { ok: false, error: "invalid_request" };
  }
  for (const uri of input.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return { ok: false, error: "invalid_request" };
    }
  }

  const id = `cl_${crypto.randomUUID()}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("oauth_clients")
    .insert({ id, client_name: trimmedName, redirect_uris: input.redirect_uris })
    .select("id, client_name, redirect_uris")
    .single();

  if (error || !data) {
    return { ok: false, error: "db_error" };
  }

  return {
    ok: true,
    client: {
      id: data.id,
      client_name: data.client_name,
      redirect_uris: data.redirect_uris,
    },
  };
}
