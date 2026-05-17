/**
 * GHB-188 — `POST /api/oauth/authorize`.
 *
 * Called by `/oauth/authorize` (the consent page) when the user clicks
 * "Autorizar". Verifies the Privy Bearer token, validates the OAuth
 * request, and returns the redirect URL with a single-use code.
 *
 * This route never renders a page — it's a JSON API the consent page
 * fetches. The actual consent UI lives in `app/oauth/authorize/`.
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { createAuthorizationCode } from "@/lib/oauth-authorize-core";

export const runtime = "nodejs";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_JWKS_URL = PRIVY_APP_ID
  ? new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`)
  : null;
const privyJWKS = PRIVY_JWKS_URL ? createRemoteJWKSet(PRIVY_JWKS_URL) : null;

async function resolveUserId(req: Request): Promise<string | null> {
  if (!PRIVY_APP_ID || !privyJWKS) return null;
  const h = req.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  try {
    const { sub } = await verifyPrivyToken(h.slice("Bearer ".length).trim(), {
      privyAppId: PRIVY_APP_ID,
      verifyKey: privyJWKS,
    });
    return sub;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const user_id = await resolveUserId(req);
  if (!user_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.client_id !== "string" ||
    typeof body.redirect_uri !== "string" ||
    typeof body.code_challenge !== "string" ||
    typeof body.code_challenge_method !== "string" ||
    typeof body.scope !== "string" ||
    typeof body.state !== "string"
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await createAuthorizationCode(getServiceRoleClient(), {
    user_id,
    client_id: body.client_id,
    redirect_uri: body.redirect_uri,
    code_challenge: body.code_challenge,
    code_challenge_method: body.code_challenge_method,
    scope: body.scope,
    state: body.state,
  });

  if (!result.ok) {
    const status =
      result.error === "stake_required"
        ? 403
        : result.error === "profile_missing"
          ? 403
          : result.error === "invalid_client"
            ? 400
            : result.error === "invalid_redirect_uri"
              ? 400
              : result.error === "unsupported_challenge_method"
                ? 400
                : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ redirect_url: result.redirect_url });
}
