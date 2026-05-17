"use client";

/**
 * GHB-188 — `/oauth/authorize` consent UI.
 *
 * Renders the explicit "Autorizar / Cancelar" decision after we've
 * verified:
 *   1. All 6 required OAuth query params are present.
 *   2. The user is authenticated (handled upstream by `<Guard>`).
 *   3. The user's profile has `mcp_status === 'active'`.
 *   4. The client_id resolves (so we can show its display name).
 *
 * Anything else (missing param, unknown client, stake required) is
 * surfaced inline so the user never clicks "Autorizar" only to hit a
 * backend error.
 *
 * The page MUST NOT auto-submit — explicit consent on click. On
 * Authorize → POST `/api/oauth/authorize` → `window.location.href`
 * to the returned URL (full nav, we're leaving our domain).
 * On Cancel → `<redirect_uri>?error=access_denied&state=<state>`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

import { useAuth } from "@/lib/auth";
import { createClient } from "@/utils/supabase/client";

interface ProfileGate {
  loading: boolean;
  /** Raw `profiles` row — null when the lookup failed or row is missing. */
  mcpStatus: string | null;
  email: string | null;
  userId: string | null;
}

/**
 * Read the caller's `profiles.mcp_status` + display fields. Returns
 * nulls on any error so the UI can fall back to an inert state.
 * Mirrors the helper in `StakeClient` / `CredentialsClient`.
 */
function useProfileGate(userId: string | undefined): ProfileGate {
  const [state, setState] = useState<ProfileGate>({
    loading: true,
    mcpStatus: null,
    email: null,
    userId: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({
        loading: false,
        mcpStatus: null,
        email: null,
        userId: null,
      });
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("mcp_status, email, user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setState({
          loading: false,
          mcpStatus: null,
          email: null,
          userId,
        });
        return;
      }
      setState({
        loading: false,
        mcpStatus: data.mcp_status,
        email: data.email,
        userId: data.user_id,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}

interface ClientInfo {
  id: string;
  client_name: string;
  redirect_uris: string[];
}

type ClientState =
  | { loading: true }
  | { loading: false; client: ClientInfo }
  | { loading: false; error: "not_found" | "internal" };

/** Fetch the OAuth client's display metadata. Public read endpoint. */
function useClientInfo(clientId: string | null): ClientState {
  const [state, setState] = useState<ClientState>({ loading: true });

  useEffect(() => {
    if (!clientId) {
      setState({ loading: false, error: "not_found" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/oauth/clients/${encodeURIComponent(clientId)}`,
        );
        if (cancelled) return;
        if (r.status === 404) {
          setState({ loading: false, error: "not_found" });
          return;
        }
        if (!r.ok) {
          setState({ loading: false, error: "internal" });
          return;
        }
        const body = (await r.json()) as ClientInfo;
        if (cancelled) return;
        setState({ loading: false, client: body });
      } catch {
        if (!cancelled) setState({ loading: false, error: "internal" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return state;
}

interface ConsentParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
}

/**
 * Read the 6 required search params. Returns `null` if any are
 * missing — the page renders an inline error in that case.
 */
function useConsentParams(): ConsentParams | null {
  const sp = useSearchParams();
  return useMemo(() => {
    const client_id = sp.get("client_id");
    const redirect_uri = sp.get("redirect_uri");
    const code_challenge = sp.get("code_challenge");
    const code_challenge_method = sp.get("code_challenge_method");
    const scope = sp.get("scope");
    const state = sp.get("state");
    if (
      !client_id ||
      !redirect_uri ||
      !code_challenge ||
      !code_challenge_method ||
      !scope ||
      !state
    ) {
      return null;
    }
    return {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      state,
    };
  }, [sp]);
}

export default function ConsentClient() {
  const router = useRouter();
  const { user } = useAuth();
  const privy = usePrivy();
  const params = useConsentParams();
  const profile = useProfileGate(user?.id);
  const clientState = useClientInfo(params?.client_id ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the current URL (with all 6 params) so the stake page can
  // bounce back to it via `?next=`.
  const hereParam = useMemo(() => {
    if (!params) return null;
    const u = new URLSearchParams({
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      scope: params.scope,
      state: params.state,
    });
    return `/oauth/authorize?${u.toString()}`;
  }, [params]);

  // If the user is logged in but not active, bounce to stake. We do
  // this in an effect (not during render) to avoid setState-during-
  // render on the router.
  useEffect(() => {
    if (!params) return;
    if (profile.loading) return;
    if (profile.mcpStatus !== null && profile.mcpStatus !== "active") {
      const here = hereParam ?? "/app/credentials";
      router.replace(`/app/stake?next=${encodeURIComponent(here)}`);
    }
  }, [params, profile.loading, profile.mcpStatus, hereParam, router]);

  const onAuthorize = useCallback(async () => {
    if (!params) return;
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        setError("Sesión expirada. Iniciá sesión otra vez.");
        return;
      }
      const r = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          client_id: params.client_id,
          redirect_uri: params.redirect_uri,
          code_challenge: params.code_challenge,
          code_challenge_method: params.code_challenge_method,
          scope: params.scope,
          state: params.state,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        redirect_url?: string;
        error?: string;
      };
      if (!r.ok || !body.redirect_url) {
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      // Full-page nav — we're leaving our domain.
      window.location.href = body.redirect_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setSubmitting(false);
    }
  }, [params, submitting, privy]);

  const onCancel = useCallback(() => {
    if (!params) return;
    try {
      const u = new URL(params.redirect_uri);
      u.searchParams.set("error", "access_denied");
      u.searchParams.set("state", params.state);
      window.location.href = u.toString();
    } catch {
      // Malformed redirect_uri — fall back to the homepage so the user
      // isn't stuck on a screen they cannot exit.
      router.replace("/");
    }
  }, [params, router]);

  // ── Missing / malformed params ──────────────────────────────────
  if (!params) {
    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">OAuth</div>
            <h1 className="dash-title">Solicitud inválida</h1>
            <p className="dash-sub">
              Faltan parámetros OAuth. Cliente mal configurado.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // ── Loading (profile or client info) ───────────────────────────
  if (profile.loading || clientState.loading) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  // ── Stake required → effect above is mid-redirect. Show spinner so
  //     we don't flash the consent UI to a not-yet-active user.
  if (profile.mcpStatus !== null && profile.mcpStatus !== "active") {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  // ── Unknown client ─────────────────────────────────────────────
  if ("error" in clientState) {
    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">OAuth</div>
            <h1 className="dash-title">Cliente desconocido</h1>
            <p className="dash-sub">
              No encontramos esa aplicación. Verificá el{" "}
              <code className="mono-inline">client_id</code> o registrá la
              app vía <code className="mono-inline">/api/oauth/register</code>.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // ── Cross-check redirect_uri against the registered list. The
  //     backend will reject anyway, but doing it here avoids one
  //     round-trip and a confusing "invalid_redirect_uri" error
  //     message after the user has already clicked Autorizar.
  const registered = clientState.client.redirect_uris;
  if (!registered.includes(params.redirect_uri)) {
    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">OAuth</div>
            <h1 className="dash-title">redirect_uri no autorizado</h1>
            <p className="dash-sub">
              La URI de redirección no está registrada para este cliente.
              Esto es un problema de configuración de{" "}
              <strong>{clientState.client.client_name}</strong>.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const clientName = clientState.client.client_name;
  const displayHandle =
    profile.userId ?? user?.id ?? "usuario";
  const displayEmail = profile.email ?? user?.email ?? "sin email";

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">OAuth</div>
          <h1 className="dash-title">Autorizar {clientName}</h1>
          <p className="dash-sub">
            {clientName} pide acceso a tu cuenta de GhBounty.
          </p>
        </div>
      </section>

      <div className="pick-winner-summary">
        <div className="pick-summary-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span className="field-label">
            Esto le va a permitir a {clientName}:
          </span>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Leer tus bounties y submissions</li>
            <li>Submitir PRs en tu nombre</li>
            <li>Acceder a tu agent profile</li>
          </ul>
        </div>

        <div className="pick-summary-row">
          <span className="field-label">Conectado como</span>
          <span>
            <code className="mono-inline">{displayHandle}</code>
            <span className="field-label-aux" style={{ marginLeft: 8 }}>
              ({displayEmail})
            </span>
          </span>
        </div>

        <p className="modal-note">
          Podés revocar este acceso en cualquier momento desde{" "}
          <a href="/app/credentials">API &amp; Credentials</a>.
        </p>

        {error && (
          <div className="pick-summary-row" style={{ gap: 12 }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAuthorize}
            disabled={submitting}
          >
            {submitting ? "Procesando…" : "Autorizar"}
          </button>
        </div>
      </div>
    </div>
  );
}
