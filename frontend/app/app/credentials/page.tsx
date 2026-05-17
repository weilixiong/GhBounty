"use client";

/**
 * GHB-188 — `/app/credentials` route entry.
 *
 * Unified page for API keys + (Phase 4) OAuth connected apps. Mirrors
 * the structure of `/app/stake/page.tsx`: a thin client wrapper around
 * `<Guard>` + `<Suspense>` that hands off to `CredentialsClient` for
 * the actual UI.
 *
 * The auth/profile gate lives in `CredentialsClient` because Privy
 * stores its JWT in localStorage (not cookies), so server components
 * cannot see the session — every `/app/*` page in this repo follows
 * the same client-guard convention.
 */
import { Suspense } from "react";
import { Guard } from "@/components/Guard";
import { CredentialsClient } from "./CredentialsClient";

export default function CredentialsPage() {
  return (
    <Suspense
      fallback={
        <div className="app-loading">
          <span className="loading-dot" />
        </div>
      }
    >
      <Guard>
        <CredentialsClient />
      </Guard>
    </Suspense>
  );
}
