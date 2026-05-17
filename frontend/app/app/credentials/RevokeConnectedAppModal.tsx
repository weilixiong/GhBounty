"use client";

/**
 * GHB-188 — confirmation modal for DELETE /api/connected-apps/[id].
 *
 * Near-clone of RevokeKeyModal with OAuth-specific copy.
 * `onClose(revoked)` tells the parent whether to refresh. We pass
 * `true` only on a successful DELETE — `Cancelar`, error, or backdrop
 * close all return `false`.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";

interface ConnectedAppLike {
  id: string;
  name: string;
}

interface DeleteResponse {
  ok?: boolean;
  error?: string;
}

export function RevokeConnectedAppModal({
  app,
  onClose,
}: {
  app: ConnectedAppLike;
  onClose: (revoked: boolean) => void;
}) {
  const privy = usePrivy();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        setError("Sesión expirada. Iniciá sesión otra vez.");
        return;
      }
      const r = await fetch(`/api/connected-apps/${app.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await r.json().catch(() => ({}))) as DeleteResponse;
      if (!r.ok) {
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={submitting ? undefined : () => onClose(false)}
    >
      <div
        className="modal modal-narrow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-app-title"
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Cerrar"
          disabled={submitting}
          onClick={() => onClose(false)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="modal-head">
          <div className="eyebrow">Connected Apps</div>
          <h2 className="modal-title" id="revoke-app-title">
            ¿Revocar acceso a &ldquo;{app.name}&rdquo;?
          </h2>
        </div>

        <p className="modal-note">
          El agente va a perder acceso <strong>inmediatamente</strong>. La
          próxima vez que intente conectarse va a tener que autorizar de nuevo.
        </p>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onClose(false)}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? "Revocando…" : "Revocar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
