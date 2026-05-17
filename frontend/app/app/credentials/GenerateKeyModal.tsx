"use client";

/**
 * GHB-188 — reveal-once "Generate API key" modal.
 *
 * Two-phase UI inside one modal:
 *
 *   Phase 1 — input  : user names the key, hits Generar.
 *                      → POST /api/api-keys → response contains plaintext.
 *   Phase 2 — reveal : plaintext shown in monospace, copy button.
 *                      → close wipes plaintext from React state.
 *
 * Security invariants:
 *   - The plaintext lives ONLY in this component's React state, in
 *     memory. It never goes to localStorage, never to a URL, never to
 *     `console.log`. When the modal unmounts (close → ApiKeysSection
 *     drops the element) the plaintext is gone.
 *   - Re-opening the modal starts at Phase 1 with empty state — there
 *     is no way to view the same plaintext twice.
 *   - The route handler also never returns the plaintext on subsequent
 *     calls (it's never stored — only its hash is in the DB).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";

const NAME_MAX = 64;

interface CreateResponse {
  id?: string;
  name?: string;
  key_prefix?: string;
  plaintext?: string;
  error?: string;
}

/**
 * `onClose(created)` — `created` is true if a key was minted, so the
 * parent should refresh its list. False on plain Cancel.
 */
export function GenerateKeyModal({
  onClose,
}: {
  onClose: (created: boolean) => void;
}) {
  const privy = usePrivy();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const trimmed = name.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  // Close on Escape — only when we're not in the middle of a request.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        onClose(plaintext != null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting, plaintext]);

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) {
        setError("Sesión expirada. Iniciá sesión otra vez.");
        return;
      }
      const r = await fetch("/api/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await r.json().catch(() => ({}))) as CreateResponse;
      if (!r.ok || !body.plaintext) {
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      setPlaintext(body.plaintext);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPlaintext() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Insecure context — the <pre><code> below is still selectable.
    }
  }

  if (typeof document === "undefined") return null;

  // Whether the parent should refresh — true once we've revealed the
  // plaintext (a key was definitely created).
  const created = plaintext != null;

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={submitting ? undefined : () => onClose(created)}
    >
      <div
        className="modal modal-narrow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-key-title"
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Cerrar"
          disabled={submitting}
          onClick={() => onClose(created)}
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

        {plaintext == null ? (
          /* ── Phase 1: name input ─────────────────────────────────── */
          <>
            <div className="modal-head">
              <div className="eyebrow">API Keys</div>
              <h2 className="modal-title" id="generate-key-title">
                Generar API key
              </h2>
            </div>

            <label className="field" style={{ marginBottom: 16 }}>
              <span className="field-label">
                Nombrá tu key{" "}
                <span className="field-label-aux">
                  (ej. &ldquo;Claude Code laptop&rdquo;, máx. {NAME_MAX})
                </span>
              </span>
              <input
                autoFocus
                type="text"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit && !submitting) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Claude Code laptop"
              />
            </label>

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
                className="btn btn-primary"
                onClick={submit}
                disabled={!canSubmit || submitting}
              >
                {submitting ? "Generando…" : "Generar"}
              </button>
            </div>
          </>
        ) : (
          /* ── Phase 2: reveal-once ────────────────────────────────── */
          <>
            <div className="modal-head">
              <div className="eyebrow">API Keys</div>
              <h2 className="modal-title" id="generate-key-title">
                Copiá tu key ahora
              </h2>
            </div>

            <p className="modal-note">
              Esta es la única vez que vas a ver esta key.{" "}
              <strong>Guardala ahora.</strong> Una vez que cierres este
              modal, no la vas a poder ver de nuevo — solo el prefijo.
            </p>

            <pre
              style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid var(--border-strong)",
                borderRadius: 10,
                padding: "12px 14px",
                margin: "4px 0 16px 0",
                overflowX: "auto",
              }}
            >
              <code
                className="mono-inline"
                style={{
                  fontSize: 13,
                  color: "var(--accent)",
                  userSelect: "text",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {plaintext}
              </code>
            </pre>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={copyPlaintext}
              >
                {copied ? "Copiado!" : "Copiar al portapapeles"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onClose(true)}
              >
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
