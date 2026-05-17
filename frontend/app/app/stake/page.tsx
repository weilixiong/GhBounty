"use client";

/**
 * GHB-188 — `/app/stake` route.
 *
 * Single-shot account activation. The user stakes 0.035 SOL via the
 * `init_stake_deposit` instruction (gas-station-sponsored) and on
 * confirmation we POST to `/api/stake` to flip
 * `profiles.mcp_status → 'active'`.
 *
 * This file is intentionally thin: it wires the auth/status guard
 * (mirroring the rest of `/app/*` which uses `<Guard>` from the client
 * because Privy stores its session in localStorage, not cookies — there
 * is no working server-side session helper in this repo) and hands off
 * to `StakeClient` for the actual state machine. The `next` search
 * param is consumed by `/oauth/authorize` to bounce the user back to
 * the consent screen after activation; default is `/app/credentials`.
 */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Guard } from "@/components/Guard";
import { StakeClient } from "./StakeClient";

function StakePageInner() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/app/credentials";
  return (
    <Guard>
      <StakeClient next={next} />
    </Guard>
  );
}

export default function StakePage() {
  // `useSearchParams` requires a Suspense boundary at the page level —
  // Next throws at build time otherwise.
  return (
    <Suspense
      fallback={
        <div className="app-loading">
          <span className="loading-dot" />
        </div>
      }
    >
      <StakePageInner />
    </Suspense>
  );
}
