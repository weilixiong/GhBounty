"use client";

/**
 * GHB-188 — `/oauth/authorize` consent page entry.
 *
 * This is the URL an MCP client (Claude Code, etc.) opens in the
 * user's browser as part of the OAuth Authorization Code + PKCE flow.
 * The page receives `client_id`, `redirect_uri`, `code_challenge`,
 * `code_challenge_method`, `scope`, `state` as query params and asks
 * the user to authorize the app.
 *
 * Mirrors the `<Guard>` + `<Suspense>` pattern used by `/app/stake`
 * and `/app/credentials` — Privy stores its session in localStorage,
 * not cookies, so server components cannot see the user. All
 * profile/status gating happens in `ConsentClient`.
 */
import { Suspense } from "react";
import { Guard } from "@/components/Guard";
import ConsentClient from "./ConsentClient";

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="app-loading">
          <span className="loading-dot" />
        </div>
      }
    >
      <Guard>
        <ConsentClient />
      </Guard>
    </Suspense>
  );
}
