"use client";

/**
 * GHB-188 — confirmation modal for `DELETE /api/api-keys/[id]`.
 *
 * Single-step: confirm + revoke. The server marks the row revoked
 * (sets `revoked_at`); the row stays in the list but is greyed out.
 *
 * `onClose(revoked)` tells the parent whether to refresh. We pass
 * `true` only on a successful DELETE — `Cancelar`, error, or backdrop
 * close all return `false`.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";

interface ApiKeyLike {
  id: string;
  name: string;
}

interface DeleteResponse {
  ok?: boolean;
  error?: string;
}

export function RevokeKeyModal({
  apiKey,
  onClose,
}: {
  apiKey: ApiKeyLike;
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
      const r = await fetch(`/api/api-keys/${apiKey.id}`, {
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
        aria-labelledby="revoke-key-title"
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
          <div className="eyebrow">API Keys</div>
          <h2 className="modal-title" id="revoke-key-title">
            ¿Revocar la key &ldquo;{apiKey.name}&rdquo;?
          </h2>
        </div>

        <p className="modal-note">
          Cualquier agente usando esta key va a perder acceso{" "}
          <strong>inmediatamente</strong>. Esta acción no se puede
          deshacer.
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
