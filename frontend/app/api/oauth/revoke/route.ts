// POST /api/oauth/revoke — RFC 7009 token revocation.
//
// Public route. Accepts the token either as the Authorization Bearer
// header OR as `token` in the JSON/form body. Per RFC 7009 §2.2, the
// endpoint always responds 200, regardless of whether the token was
// found or already revoked — this prevents token-enumeration attacks.

import { NextResponse } from "next/server";
import {
  extractOAuthTokenPrefix,
  verifyOAuthToken,
} from "@ghbounty/shared";
import { getServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

async function readToken(req: Request): Promise<string | null> {
  // Header first — preferred per RFC 6750.
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  // Body fallback — JSON or form.
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as
        | { token?: unknown }
        | null;
      if (body && typeof body.token === "string") return body.token;
    } else {
      const form = await req.formData();
      const t = form.get("token");
      if (typeof t === "string") return t;
    }
  } catch {
    // fall through — return null below
  }
  return null;
}

export async function POST(req: Request) {
  const plaintext = await readToken(req);
  if (!plaintext) return NextResponse.json({ ok: true });

  let prefix: string;
  try {
    prefix = extractOAuthTokenPrefix(plaintext);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const supabase = getServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("oauth_tokens")
    .select("id, token_hash")
    .eq("token_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: true });
  }
  if (!verifyOAuthToken(plaintext, data.token_hash)) {
    return NextResponse.json({ ok: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.id);

  return NextResponse.json({ ok: true });
}
