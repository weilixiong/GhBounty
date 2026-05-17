/**
 * GHB-188 — GET /api/connected-apps
 *
 * Returns the caller's non-revoked OAuth tokens as ConnectedApp objects.
 * Auth via Privy JWT in Authorization: Bearer header.
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { listConnectedApps } from "@/lib/connected-apps-core";

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
    const apps = await listConnectedApps(getServiceRoleClient(), user_id);
    return NextResponse.json({ apps });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
