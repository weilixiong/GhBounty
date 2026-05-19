/**
 * GHB-187 — `GET /api/agent-delegation` and `POST /api/agent-delegation`.
 *
 * Thin wrapper over `lib/agent-delegation-route-core.ts`. Auth via Privy JWT.
 *
 * POST body: { action: "delegate", wallet_pubkey: string, chain_type?: string }
 *          | { action: "revoke" }
 *
 * GET — returns { delegation: { wallet_pubkey, chain_type, delegated_at,
 *                               revoked_at } | null }
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import {
  delegateWallet,
  revokeWallet,
  getDelegation,
} from "@/lib/agent-delegation-route-core";

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

  const result = await getDelegation(getServiceRoleClient(), user_id);
  if (!result.ok)
    return NextResponse.json({ error: "internal" }, { status: 500 });

  return NextResponse.json({ delegation: result.delegation });
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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const action = b.action;

  if (action === "delegate") {
    if (typeof b.wallet_pubkey !== "string" || b.wallet_pubkey.length === 0) {
      return NextResponse.json(
        { error: "wallet_pubkey required" },
        { status: 400 },
      );
    }
    const chain_type =
      typeof b.chain_type === "string" ? b.chain_type : "solana";

    const result = await delegateWallet(getServiceRoleClient(), {
      user_id,
      wallet_pubkey: b.wallet_pubkey,
      chain_type,
    });
    if (!result.ok)
      return NextResponse.json({ error: "internal" }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  if (action === "revoke") {
    const result = await revokeWallet(getServiceRoleClient(), user_id);
    if (!result.ok)
      return NextResponse.json({ error: "internal" }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
