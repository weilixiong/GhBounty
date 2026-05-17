// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// Public discovery endpoint that MCP clients (Claude Code, Cursor, etc.)
// fetch first to learn where to register, authorize, and exchange codes.

import { NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_APP_BASE_URL ?? "https://ghbounty.com";

export async function GET() {
  return NextResponse.json({
    issuer: BASE,
    authorization_endpoint: `${BASE}/oauth/authorize`,
    token_endpoint: `${BASE}/api/oauth/token`,
    registration_endpoint: `${BASE}/api/oauth/register`,
    revocation_endpoint: `${BASE}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["full"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
