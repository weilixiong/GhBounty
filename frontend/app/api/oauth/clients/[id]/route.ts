/**
 * GHB-188 — `GET /api/oauth/clients/[id]`.
 *
 * Public read of `oauth_clients`. RLS allows SELECT to all roles
 * (see migration 0024). Returns the client's display name so the
 * consent page at `/oauth/authorize` can render "Autorizar Claude
 * Code" instead of the opaque "Autorizar cl_abc-uuid".
 *
 * Response: `{ id, client_name, redirect_uris }` or `{ error: "not_found" }`.
 */

import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Service-role client is used despite the public RLS policy because
  // this app already centralises Supabase access through it for backend
  // routes — keeps the wire shape consistent (no anon-key roundtrip).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getServiceRoleClient() as any)
    .from("oauth_clients")
    .select("id, client_name, redirect_uris")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id,
    client_name: data.client_name,
    redirect_uris: data.redirect_uris,
  });
}
