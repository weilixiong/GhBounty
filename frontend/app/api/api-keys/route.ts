/**
 * GHB-188 — `GET /api/api-keys` and `POST /api/api-keys`.
 *
 * Thin wrappers over `lib/api-keys-route-core.ts`. Auth via Privy JWT.
 *
 * GET  — list the caller's API key metadata (no plaintext, no hash).
 * POST — mint a new key; plaintext returned exactly once in the response.
 *         Requires profile.mcp_status === 'active' (stake confirmed).
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { listApiKeys, createApiKey } from "@/lib/api-keys-route-core";

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

export async function GET(req: Request) {
  const user_id = await resolveUserId(req);
  if (!user_id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const keys = await listApiKeys(getServiceRoleClient(), user_id);
    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user_id = await resolveUserId(req);
  if (!user_id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const name =
    body && typeof body === "object" && "name" in body && typeof (body as Record<string, unknown>).name === "string"
      ? ((body as Record<string, unknown>).name as string)
      : null;
  if (!name)
    return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await createApiKey(getServiceRoleClient(), { user_id, name });

  if (!result.ok) {
    const status =
      result.error === "stake_required"
        ? 403
        : result.error === "invalid_name"
          ? 400
          : result.error === "profile_missing"
            ? 403
            : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    id: result.id,
    name: result.name,
    key_prefix: result.key_prefix,
    plaintext: result.plaintext,
  });
}
