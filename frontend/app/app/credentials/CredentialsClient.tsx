"use client";

/**
 * GHB-188 — top-level client shell for `/app/credentials`.
 *
 * Renders:
 *   1. Title.
 *   2. A persistent banner when `profile.mcp_status !== 'active'`
 *      (spec §5): the page still renders but the "Generate" button
 *      below is disabled.
 *   3. `<ApiKeysSection />` — list + modals.
 *   4. Placeholder for `<ConnectedAppsSection />` (Phase 4 / Task 30).
 *
 * Profile resolution mirrors `StakeClient`: client-side Supabase
 * lookup over the Privy → Supabase JWT bridge. There is no working
 * server-side session helper in this repo (Privy stores the session
 * in localStorage).
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { createClient } from "@/utils/supabase/client";

import { ApiKeysSection } from "./ApiKeysSection";

interface ProfileGate {
  loading: boolean;
  mcpStatus: string | null;
}

/**
 * Read the caller's `profiles.mcp_status`. Returns nulls on any error
 * so the UI falls back to the "stake required" banner rather than
 * crashing — same defensive shape as the equivalent helper in
 * `StakeClient`.
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

  const stakeRequired = profile.mcpStatus !== "active";

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

      {stakeRequired && (
        <div
          role="status"
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid rgba(255, 165, 0, 0.25)",
            background: "rgba(255, 165, 0, 0.06)",
            color: "var(--text)",
            fontSize: 14,
            lineHeight: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            Activá tu cuenta de MCP para gestionar credenciales.
          </span>
          <Link href="/app/stake" className="btn btn-primary btn-sm">
            Stakear ahora
          </Link>
        </div>
      )}

      <ApiKeysSection disabled={stakeRequired} />

      {/*
       * Phase 4 (Task 30) wires `<ConnectedAppsSection />` in here. For
       * now we render a placeholder so the layout matches the spec §5
       * shape and users see what's coming.
       */}
      <section className="profile-card">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <h2 className="section-label">Connected Apps</h2>
          <span className="field-label-aux">Próximamente</span>
        </div>
        <p className="modal-note" style={{ marginBottom: 0 }}>
          Apps que autorizaste vía OAuth aparecerán acá. Disponible pronto.
        </p>
      </section>
    </div>
  );
}
