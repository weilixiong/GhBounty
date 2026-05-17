// 302 redirect to the canonical OAuth metadata on the frontend.
// MCP clients that start discovery from mcp.ghbounty.com land here
// and follow the redirect to ghbounty.com/.well-known/oauth-authorization-server.

import { NextResponse } from "next/server";

const FRONTEND_BASE =
  process.env.NEXT_PUBLIC_APP_BASE_URL ?? "https://ghbounty.com";

export async function GET() {
  return NextResponse.redirect(
    `${FRONTEND_BASE}/.well-known/oauth-authorization-server`,
    302,
  );
}
