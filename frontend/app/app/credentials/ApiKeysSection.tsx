"use client";

/**
 * GHB-188 — API Keys section of `/app/credentials`.
 *
 * Responsibilities:
 *   - Fetch the caller's key metadata via `GET /api/api-keys` on mount.
 *   - Render a row per key (active or revoked).
 *   - Expose `[+ Generar nueva key]` and per-row `[Revocar]` buttons
 *     that open `<GenerateKeyModal>` / `<RevokeKeyModal>`.
 *   - Refresh the list after either modal closes successfully.
 *
 * Auth: the route handler verifies a Privy JWT in the `Authorization`
 * header (no cookie session). We fetch the token via
 * `usePrivy().getAccessToken()`, matching the rest of `/app/*`.
 */

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { Button } from "@/components/ui/button";

import { GenerateKeyModal } from "./GenerateKeyModal";
import { RevokeKeyModal } from "./RevokeKeyModal";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface ListResponse {
  keys?: ApiKey[];
  error?: string;
}

/**
 * Human-readable relative time in Spanish. No date library — the route
 * spec only needs the buckets below. Falls back to a localized date
 * once we're past ~30 days.
 */
function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "nunca";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Apr 12" / "12 abr" style — keep it short for the row. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysSection() {
  const privy = usePrivy();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        // Not logged in — Guard will redirect; render empty meanwhile.
        setKeys([]);
        setLoading(false);
        return;
      }
      const r = await fetch("/api/api-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await r.json().catch(() => ({}))) as ListResponse;
      if (!r.ok) {
        setError(body.error ?? `HTTP ${r.status}`);
        setKeys([]);
      } else {
        setKeys(body.keys ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
      setKeys([]);
    } finally {
      setLoading(false);
    }
    // The Privy context object's identity changes on every render. Depending on
    // it caused refresh → useEffect → setState → render → new refresh → loop.
    // Capturing privy via closure on mount is fine here — token refresh
    // happens server-side and one initial load is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="flex flex-col gap-[18px] rounded-2xl border border-border-brand bg-gradient-to-b from-surface to-surface-2 p-7!">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          API Keys
        </h2>
        <Button
          type="button"
          size="sm"
          onClick={() => setShowGenerate(true)}
        >
          + Generar nueva key
        </Button>
      </div>
      <p className="text-[12.5px] leading-[1.55] text-text-muted">
        Las API keys permiten que tu agente hable con{" "}
        <code className="mono-inline">mcp.ghbounty.com</code>.
      </p>

      {loading && (
        <div className="pick-summary-row" style={{ gap: 12 }}>
          <span className="loading-dot" aria-hidden />
          <span>Cargando keys…</span>
        </div>
      )}

      {!loading && error && (
        <div className="form-error" role="alert">
          No pudimos cargar tus keys ({error}).
        </div>
      )}

      {!loading && !error && keys.length === 0 && (
        <p className="modal-note" style={{ marginBottom: 0 }}>
          Todavía no generaste ninguna key.
        </p>
      )}

      {!loading && !error && keys.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {keys.map((k) => {
            const revoked = !!k.revoked_at;
            return (
              <li
                key={k.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  background: revoked
                    ? "rgba(0,0,0,0.18)"
                    : "rgba(0,0,0,0.3)",
                  opacity: revoked ? 0.55 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      color: "var(--text)",
                      fontWeight: 500,
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{k.name}</span>
                    {revoked && (
                      <span className="field-label-aux">(Revocada)</span>
                    )}
                  </div>
                  <code
                    className="mono-inline"
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      marginBottom: 4,
                      wordBreak: "break-all",
                    }}
                  >
                    {k.key_prefix}…
                  </code>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    Creada {shortDate(k.created_at)} · Último uso{" "}
                    {timeAgo(k.last_used_at)}
                  </div>
                </div>
                {!revoked && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setToRevoke(k)}
                  >
                    Revocar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showGenerate && (
        <GenerateKeyModal
          onClose={(created) => {
            setShowGenerate(false);
            if (created) void refresh();
          }}
        />
      )}
      {toRevoke && (
        <RevokeKeyModal
          apiKey={toRevoke}
          onClose={(revoked) => {
            setToRevoke(null);
            if (revoked) void refresh();
          }}
        />
      )}
    </section>
  );
}
