/**
 * GHB-188 — `POST /api/oauth/token`.
 *
 * Public endpoint — no Privy auth. PKCE replaces the client secret:
 * the proof of identity is `code_verifier` whose SHA256 must match the
 * `code_challenge` stored alongside the authorization code.
 *
 * Accepts both `application/json` and `application/x-www-form-urlencoded`
 * per OAuth 2.0 §4.1.3 (most native clients send form; some MCP tooling
 * sends JSON). All other content types are rejected as `invalid_request`.
 *
 * The returned `access_token` (plaintext) is shown to the caller exactly
 * once — only its bcrypt hash + prefix are persisted in `oauth_tokens`.
 */

import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { exchangeCodeForToken } from "@/lib/oauth-token-core";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // OAuth 2.0 spec — token endpoint MUST accept both JSON and
  // form-urlencoded. Some clients send one, some the other.
  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } else {
      const form = await req.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    typeof body.grant_type !== "string" ||
    typeof body.code !== "string" ||
    typeof body.code_verifier !== "string" ||
    typeof body.client_id !== "string" ||
    typeof body.redirect_uri !== "string"
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await exchangeCodeForToken(getServiceRoleClient(), {
    grant_type: body.grant_type,
    code: body.code,
    code_verifier: body.code_verifier,
    client_id: body.client_id,
    redirect_uri: body.redirect_uri,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    access_token: result.access_token,
    token_type: result.token_type,
    scope: result.scope,
  });
}
