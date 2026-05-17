/**
 * GHB-188 — `POST /api/oauth/register` (RFC 7591 Dynamic Client Registration).
 *
 * Public endpoint — no auth. MCP clients call once to obtain a client_id.
 * PKCE replaces client_secret; none is issued.
 *
 * Response: 201 Created with { id, client_name, redirect_uris }
 */

import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";
import { registerClient } from "@/lib/oauth-register-core";

export const runtime = "nodejs";

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((y) => typeof y === "string");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.client_name !== "string" ||
    !isStringArray(body.redirect_uris)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await registerClient(getServiceRoleClient(), {
    client_name: body.client_name,
    redirect_uris: body.redirect_uris,
  });

  if (!result.ok) {
    const status = result.error === "invalid_request" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result.client, { status: 201 });
}
