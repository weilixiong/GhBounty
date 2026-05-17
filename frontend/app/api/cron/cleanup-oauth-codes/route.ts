// Hourly cron: prune expired oauth_codes rows.
//
// oauth_codes lookups already filter `consumed_at IS NULL AND expires_at > now()`,
// so stale rows are invisible to the OAuth flow. This cron keeps the table small
// by deleting rows that expired more than a day ago. Run from Vercel cron — the
// schedule lives in frontend/vercel.json.
//
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations.
// The route refuses anything else.

import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const supabase = getServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (supabase as any)
    .from("oauth_codes")
    .delete({ count: "exact" })
    .lt("expires_at", cutoff);

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "delete_failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ deleted: count ?? 0 });
}
