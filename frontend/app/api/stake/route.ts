/**
 * GHB-188 — `POST /api/stake`.
 *
 * Thin wrapper over `lib/stake-route-core.ts`. Auth via Privy JWT.
 *
 * POST — registers a confirmed on-chain stake, flips profiles.mcp_status to 'active'.
 *         The browser has already submitted and confirmed the transaction before
 *         calling this route. This route is the confirmation step only.
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import { verifyPrivyToken } from "@/lib/gas-station-route-core";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { handleStakeConfirmation } from "@/lib/stake-route-core";

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

function isValidBody(json: unknown): json is {
  wallet_pubkey: string;
  tx_signature: string;
  pda: string;
  locked_until: string;
  amount_lamports: string;
} {
  if (!json || typeof json !== "object") return false;
  const b = json as Record<string, unknown>;

  if (typeof b.wallet_pubkey !== "string" || b.wallet_pubkey.length < 32 || b.wallet_pubkey.length > 44) return false;
  if (typeof b.tx_signature !== "string" || b.tx_signature.length < 32) return false;
  if (typeof b.pda !== "string" || b.pda.length < 32) return false;
  if (typeof b.locked_until !== "string" || isNaN(Date.parse(b.locked_until))) return false;
  if (typeof b.amount_lamports !== "string" || !/^\d+$/.test(b.amount_lamports)) return false;

  return true;
}

export async function POST(req: Request) {
  const user_id = await resolveUserId(req);
  if (!user_id)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!isValidBody(json))
    return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await handleStakeConfirmation(getServiceRoleClient(), {
    user_id,
    wallet_pubkey: json.wallet_pubkey,
    tx_signature: json.tx_signature,
    pda: json.pda,
    locked_until: new Date(json.locked_until),
    amount_lamports: BigInt(json.amount_lamports),
  });

  if (!result.ok) {
    const status =
      result.error === "already_staked" ? 409 :
      result.error === "wallet_mismatch" ? 400 :
      result.error === "profile_missing" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
