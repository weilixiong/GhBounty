"use client";

/**
 * GHB-188 — Connected Apps section of /app/credentials.
 *
 * Responsibilities:
 *   - Fetch the caller's non-revoked OAuth tokens via GET /api/connected-apps on mount.
 *   - Render a row per token with a [Revocar] button that opens
 *     <RevokeConnectedAppModal>.
 *   - Refresh the list after a successful revoke so the row disappears.
 *
 * Auth: the route handler verifies a Privy JWT in the `Authorization`
 * header (no cookie session). Same pattern as ApiKeysSection.
 */

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { RevokeConnectedAppModal } from "./RevokeConnectedAppModal";

interface ConnectedApp {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

interface ListResponse {
  apps?: ConnectedApp[];
  error?: string;
}

/**
 * Human-readable relative time in Spanish. Same buckets as ApiKeysSection.
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

/** "Apr 12" style short date. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ConnectedAppsSection() {
  const privy = usePrivy();
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<ConnectedApp | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        // Not logged in — Guard will redirect; render empty meanwhile.
        setApps([]);
        setLoading(false);
        return;
      }
      const r = await fetch("/api/connected-apps", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await r.json().catch(() => ({}))) as ListResponse;
      if (!r.ok) {
        setError(body.error ?? `HTTP ${r.status}`);
        setApps([]);
      } else {
        setApps(body.apps ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
      setApps([]);
    } finally {
      setLoading(false);
    }
    // See ApiKeysSection — same fix: `privy` identity changes on every render
    // and caused an infinite render loop. Capture via closure on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="flex flex-col gap-[18px] rounded-2xl border border-border-brand bg-gradient-to-b from-surface to-surface-2 p-7!">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Connected Apps
        </h2>
      </div>
      <p className="text-[12.5px] leading-[1.55] text-text-muted">
        Apps que autorizaste vía OAuth.
      </p>

      {loading && (
        <div className="pick-summary-row" style={{ gap: 12 }}>
          <span className="loading-dot" aria-hidden />
          <span>Cargando apps…</span>
        </div>
      )}

      {!loading && error && (
        <div className="form-error" role="alert">
          No pudimos cargar tus apps ({error}).
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <p className="modal-note" style={{ marginBottom: 0 }}>
          Todavía no autorizaste ninguna app.
        </p>
      )}

      {!loading && !error && apps.length > 0 && (
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
          {apps.map((app) => (
            <li
              key={app.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "14px 16px",
                background: "rgba(0,0,0,0.3)",
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
                  }}
                >
                  {app.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  Autorizado {shortDate(app.created_at)} · Último uso{" "}
                  {timeAgo(app.last_used_at)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setToRevoke(app)}
              >
                Revocar
              </button>
            </li>
          ))}
        </ul>
      )}

      {toRevoke && (
        <RevokeConnectedAppModal
          app={toRevoke}
          onClose={(revoked) => {
            setToRevoke(null);
            if (revoked) void refresh();
          }}
        />
      )}
    </section>
  );
}
