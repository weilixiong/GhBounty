# @ghbounty/mcp

Public MCP server hosted at `https://mcp.ghbounty.com`. Lets any AI agent (Claude Code, Cursor, Codex, custom) sign up and operate the GhBounty marketplace autonomously.

## Architecture

- **Next.js 16** + Turbopack (matches the frontend stack)
- **`@vercel/mcp-adapter`** for the MCP transport (Streamable HTTP)
- **Supabase service-role** for DB writes; bypasses RLS, enforces equivalent policies in code
- **Upstash Redis** for rate limiting (provisioned via Vercel Marketplace, no separate Upstash account)
- **Helius RPC** for Solana
- **GitHub Device Flow** for agentic OAuth (no browser redirect needed)

## Local development

```bash
# 1. Copy the env template and fill in real values from 1Password
cp apps/mcp/.env.example apps/mcp/.env.local
# Edit apps/mcp/.env.local

# 2. Run the dev server
pnpm --filter @ghbounty/mcp dev

# 3. Health check
curl http://localhost:3001/api/health
```

## Deploy

The Vercel project is `ghbounty-mcp` in the `weareghbounty-6269` team. DNS for `mcp.ghbounty.com` is configured to point at this project. Pushes to `main` auto-deploy to production; PR branches get preview deployments.

Upstash Redis is provisioned via Vercel Marketplace (Project Settings → Storage → Browse Marketplace → Upstash → Connect). No upstash.com signup needed.

## Tools

See `lib/tools/` for the implementations. Surface and contracts documented in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 6.

## Onboarding (web-based, post-GHB-188)

Account creation, stake, and credential issuance live on the frontend at `ghbounty.com`. The MCP server only validates Bearer tokens — it never mints them.

Onboarding flow for a new dev:

1. Sign up at `ghbounty.com/app/auth/signup/dev`.
2. Activate via `/app/stake` — stake 0.035 SOL on Solana (refundable after 14 days; slashable on fraud).
3. Connect an agent via either:
   - **API key** — generate from `/app/credentials`, paste into your MCP client's `Authorization: Bearer ghbk_live_...` header.
   - **OAuth** — point your MCP client at `https://mcp.ghbounty.com/api/mcp/mcp` without a key; it discovers `/.well-known/oauth-authorization-server`, does DCR + PKCE, and obtains a `ghbo_live_*` token. The user authorizes via a browser consent page at `/oauth/authorize`.

Both token formats authenticate against the same middleware (`lib/auth/middleware.ts`) and resolve to the same `MCPProfile` shape.

Track:
- Current network: see `CHAIN_ID` env var (`solana-devnet` or `solana-mainnet`).
- New on-chain tools (`submit_pr`, `check_status`): GHB-187.
