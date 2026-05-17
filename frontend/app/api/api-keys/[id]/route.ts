/**
 * GHB-188 — `DELETE /api/api-keys/[id]`.
 *
 * Thin wrapper over `lib/api-keys-route-core.ts`. Auth via Privy JWT.
 * Ownership is enforced in `revokeApiKey` via user_id equality on the DB query.
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { revokeApiKey } from "@/lib/api-keys-route-core";

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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const user_id = await resolveUserId(req);
  if (!user_id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await revokeApiKey(getServiceRoleClient(), { id, user_id });

  if (!result.ok) {
    const status =
      result.error === "not_found"
        ? 404
        : result.error === "already_revoked"
          ? 410
          : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
