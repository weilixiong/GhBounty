"use client";

/**
 * GHB-188 — top-level client shell for `/app/credentials`.
 *
 * Renders:
 *   1. Title.
 *   2. `<ApiKeysSection />` — list + modals.
 *   3. `<ConnectedAppsSection />` — OAuth tokens.
 *
 * Profile resolution mirrors `StakeClient`: client-side Supabase
 * lookup over the Privy → Supabase JWT bridge. There is no working
 * server-side session helper in this repo (Privy stores the session
 * in localStorage).
 */

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { createClient } from "@/utils/supabase/client";

import { AgentDelegationCard } from "./AgentDelegationCard";
import { ApiKeysSection } from "./ApiKeysSection";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

interface ProfileGate {
  loading: boolean;
  mcpStatus: string | null;
}

/**
 * Read the caller's `profiles.mcp_status`. Returns nulls on any error
 * so the UI renders gracefully — same defensive shape as the equivalent
 * helper in `StakeClient`.
 */
function useProfileGate(userId: string | undefined): ProfileGate {
  const [state, setState] = useState<ProfileGate>({
    loading: true,
    mcpStatus: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, mcpStatus: null });
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("mcp_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, mcpStatus: null });
        return;
      }
      setState({ loading: false, mcpStatus: data.mcp_status });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}

export function CredentialsClient() {
  const { user } = useAuth();
  const profile = useProfileGate(user?.id);

  if (profile.loading) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">MCP</div>
          <h1 className="dash-title">API &amp; Credentials</h1>
          <p className="dash-sub">
            Gestioná las credenciales que tus agentes usan para hablar con{" "}
            <code className="mono-inline">mcp.ghbounty.com</code>.
          </p>
        </div>
      </section>

      <ApiKeysSection />

      <ConnectedAppsSection />

      <AgentDelegationCard />
    </div>
  );
}
