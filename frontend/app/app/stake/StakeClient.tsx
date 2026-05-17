"use client";

/**
 * GHB-188 — client-side state machine for `/app/stake`.
 *
 * Pipeline (mirrors `PickWinnerModal.runRealFlow` since that's the
 * canonical sign-and-send shape in this repo):
 *
 *   1. `building`      → derive PDA, build the `init_stake_deposit` ix.
 *   2. `awaiting_sig`  → Privy's `useSignTransaction` partial-signs.
 *   3. `submitting`    → `submitSponsored` POSTs to the gas station.
 *   4. `confirming`    → wait for cluster confirmation, then POST
 *                        `/api/stake` so the backend flips
 *                        `profiles.mcp_status → 'active'`.
 *   5. `success`       → auto-redirect to `next` after 2s.
 *   6. `error`         → show message + Retry (returns to idle).
 *
 * Profile gating (mcp_status === 'active' → redirect, wallet missing
 * → "connect a wallet" CTA) is done in this component too because
 * the codebase has no server-side session helper to do it earlier:
 * Privy stores its JWT in localStorage, not cookies, so a server
 * component can't see the user. The rest of `/app/*` follows the
 * same client-guard convention.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import {
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { usePrivy } from "@privy-io/react-auth";

import { useAuth } from "@/lib/auth";
import { createClient } from "@/utils/supabase/client";
import {
  buildInitStakeDepositIx,
  deriveStakeDepositPda,
  getConnection,
  MIN_STAKE_LAMPORTS,
  STAKE_LOCK_SECONDS,
} from "@/lib/solana";
import {
  formatGasStationError,
  GAS_STATION_ENABLED,
  submitSponsored,
} from "@/lib/gas-station-client";

/** All six visible states from the spec §5 state machine, plus `idle`. */
type Phase =
  | "idle"
  | "building"
  | "awaiting_sig"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

const SOLANA_EXPLORER_TX = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function shortAddr(s: string | null | undefined): string {
  if (!s) return "";
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

interface ProfileGate {
  /** True while we're still resolving the profile row. */
  loading: boolean;
  /** Profile-side wallet pubkey (may differ from currently-connected wallet). */
  walletPubkey: string | null;
  /** Current MCP activation status. */
  mcpStatus: string | null;
}

/**
 * Resolve the relevant `profiles` columns for the logged-in user. We do
 * this client-side because Supabase auth in this app is bridged via
 * Privy → HS256, no cookie session. Returns nulls on any error so the
 * UI can fall back to an inert state rather than blow up.
 */
function useProfileGate(userId: string | undefined): ProfileGate {
  const [state, setState] = useState<ProfileGate>({
    loading: true,
    walletPubkey: null,
    mcpStatus: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, walletPubkey: null, mcpStatus: null });
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("wallet_pubkey, mcp_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, walletPubkey: null, mcpStatus: null });
        return;
      }
      setState({
        loading: false,
        walletPubkey: data.wallet_pubkey,
        mcpStatus: data.mcp_status,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}

export function StakeClient({ next }: { next: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useProfileGate(user?.id);

  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const privy = usePrivy();
  const wallet = wallets[0];
  const walletAddress = wallet?.address ?? null;

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  // Guards the flow against double-submit when the user double-clicks
  // the primary button (the state transition is async).
  const inFlightRef = useRef(false);

  // If the profile is already active when the page mounts, bounce to
  // /app/credentials immediately. This mirrors the spec entry condition
  // and prevents accidental double-stakes.
  useEffect(() => {
    if (!profile.loading && profile.mcpStatus === "active") {
      router.replace("/app/credentials");
    }
  }, [profile.loading, profile.mcpStatus, router]);

  // Auto-redirect on success after 2s (spec §5).
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => router.push(next), 2000);
    return () => clearTimeout(t);
  }, [phase, next, router]);

  /** Reset to idle so the user can retry after an error. */
  const reset = useCallback(() => {
    inFlightRef.current = false;
    setError(null);
    setTxSig(null);
    setPhase("idle");
  }, []);

  const onStake = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setTxSig(null);

    try {
      if (!walletAddress || !wallet) {
        throw new Error("No hay wallet conectada. Volvé a iniciar sesión.");
      }
      if (!GAS_STATION_ENABLED) {
        throw new Error(
          "La gas station no está configurada. Pedile al admin que setee NEXT_PUBLIC_GAS_STATION_PUBKEY.",
        );
      }

      const owner = new PublicKey(walletAddress);
      const amount = MIN_STAKE_LAMPORTS;
      const connection = getConnection();
      const [stakePda] = deriveStakeDepositPda(owner);

      // 1. Build instruction.
      setPhase("building");
      const ix = await buildInitStakeDepositIx(owner, amount, connection);

      // 2. Sign in wallet.
      setPhase("awaiting_sig");
      const submitPromise = submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken: () => privy.getAccessToken(),
        connection,
      });

      // `submitSponsored` runs sign + POST in one Promise. We can't
      // distinguish the two boundaries from out here, so we flip to
      // `submitting` once the Promise has had a tick to start (the
      // wallet prompt blocks until the user clicks).
      // The simpler approach: just leave `awaiting_sig` visible while
      // the user signs; flip to `submitting` only if the Promise
      // hasn't resolved yet after a microtask. This avoids racing the
      // wallet prompt — `awaiting_sig` stays up while the popup is open.
      const submittingTimer = setTimeout(() => setPhase("submitting"), 0);
      let result: { txHash: string };
      try {
        result = await submitPromise;
      } finally {
        clearTimeout(submittingTimer);
      }
      const sig = result.txHash;
      setTxSig(sig);

      // 3. Wait for cluster confirmation. The gas-station server
      //    already submitted+confirmed, but the spec asks for an
      //    explicit `confirming` state so the UI shows the tx
      //    signature while we wait. Confirms returning immediately is
      //    fine; this is a belt-and-suspenders idempotency check.
      setPhase("confirming");
      await connection.confirmTransaction(sig, "confirmed");

      // 4. POST /api/stake so the backend flips mcp_status → 'active'
      //    and inserts the stake_deposits row.
      const lockedUntil = new Date(Date.now() + STAKE_LOCK_SECONDS * 1000);
      const accessToken = await privy.getAccessToken();
      if (!accessToken) {
        throw new Error("Sesión expirada. Iniciá sesión otra vez.");
      }

      const r = await fetch("/api/stake", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          wallet_pubkey: walletAddress,
          tx_signature: sig,
          pda: stakePda.toBase58(),
          locked_until: lockedUntil.toISOString(),
          amount_lamports: amount.toString(),
        }),
      });

      if (!r.ok) {
        // Best-effort error extraction. `.json()` is allowed to fail
        // (e.g. proxy HTML) — fall back to the status line.
        let msg: string | null = null;
        try {
          const body = (await r.json()) as { error?: string };
          msg = body.error ?? null;
        } catch {
          // ignored
        }
        throw new Error(msg ?? `HTTP ${r.status}`);
      }

      setPhase("success");
    } catch (err) {
      console.error("[StakeClient] failed:", err);
      setError(formatGasStationError(err));
      setPhase("error");
      inFlightRef.current = false; // allow retry
    }
  }, [walletAddress, wallet, signTransaction, privy]);

  const copyTx = useCallback(async () => {
    if (!txSig) return;
    try {
      await navigator.clipboard.writeText(txSig);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1200);
    } catch {
      // Some browsers (file://, insecure context) reject clipboard
      // writes. Silently no-op — the explorer link still works.
    }
  }, [txSig]);

  const walletLabel = useMemo(() => {
    if (!wallet) return null;
    // Privy types `walletClientType` as `string`. Common values:
    // "phantom", "solflare", "privy" (embedded), etc.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kind = (wallet as any).walletClientType as string | undefined;
    if (!kind) return shortAddr(wallet.address);
    return `${shortAddr(wallet.address)} (${kind})`;
  }, [wallet]);

  // ── Loading / not-authenticated guards ───────────────────────────
  if (profile.loading) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  // Already active — `useEffect` above already replaced the route.
  // Render the spinner instead of the stake card to avoid flashing it.
  if (profile.mcpStatus === "active") {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  // No wallet connected via Privy → CTA to connect.
  const hasConnectedWallet = walletsReady && wallet;
  if (!hasConnectedWallet) {
    return (
      <div className="dash">
        <section className="dash-hero">
          <div>
            <div className="eyebrow">MCP</div>
            <h1 className="dash-title">Activá tu cuenta de MCP</h1>
            <p className="dash-sub">
              Necesitás una wallet de Solana conectada para stakear. Conectá
              Phantom, Solflare o tu wallet embebida de Privy.
            </p>
          </div>
        </section>
        <div className="pick-winner-summary">
          <p className="modal-note">
            No detectamos ninguna wallet en tu sesión. Iniciá sesión otra vez
            con una wallet conectada para continuar.
          </p>
          <div className="modal-foot">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => privy.login()}
            >
              Conectar wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main state machine ──────────────────────────────────────────
  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">MCP</div>
          <h1 className="dash-title">Activá tu cuenta de MCP</h1>
          <p className="dash-sub">
            Stakeá 0.035 SOL (~$3) para activar tu cuenta. Reembolsable
            después de 14 días. Slasheable por fraude.
          </p>
        </div>
      </section>

      <div className="pick-winner-summary">
        <div className="pick-summary-row">
          <span className="field-label">Wallet conectada</span>
          <code className="mono-inline pick-solver">{walletLabel}</code>
        </div>
        <div className="pick-summary-row">
          <span className="field-label">Monto del stake</span>
          <span className="pick-amount">
            <strong>0.035</strong>
            <span className="token-pill">SOL</span>
          </span>
        </div>
        <div className="pick-summary-row">
          <span className="field-label">Bloqueo</span>
          <span>14 días</span>
        </div>

        {/* ── idle ─────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div className="modal-foot">
            <a
              className="btn btn-ghost btn-sm"
              href="/agents"
              target="_blank"
              rel="noopener noreferrer"
            >
              Saber más
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onStake}
              disabled={!walletsReady}
            >
              Stakear 0.035 SOL
            </button>
          </div>
        )}

        {/* ── in-flight states (building/awaiting_sig/submitting/confirming) */}
        {(phase === "building" ||
          phase === "awaiting_sig" ||
          phase === "submitting" ||
          phase === "confirming") && (
          <div className="pick-summary-row" style={{ gap: 12 }}>
            <span className="loading-dot" aria-hidden />
            <span>
              {phase === "building" && "Preparando transacción…"}
              {phase === "awaiting_sig" && "Confirmá en tu wallet"}
              {phase === "submitting" && "Enviando a Solana…"}
              {phase === "confirming" && "Esperando confirmación…"}
            </span>
          </div>
        )}

        {/* ── tx signature reveal (visible from `confirming` on) ── */}
        {txSig && (phase === "confirming" || phase === "success") && (
          <div className="pick-summary-row">
            <span className="field-label">Tx</span>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <a
                href={SOLANA_EXPLORER_TX(txSig)}
                target="_blank"
                rel="noopener noreferrer"
                className="mono-inline"
              >
                {shortAddr(txSig)}
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={copyTx}
                aria-label="Copiar firma"
              >
                {copyOk ? "Copiado" : "Copiar"}
              </button>
            </span>
          </div>
        )}

        {/* ── success ─────────────────────────────────────────── */}
        {phase === "success" && (
          <div className="pick-summary-row" style={{ gap: 12 }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <strong>¡Cuenta activada!</strong>
            <span className="field-label-aux">
              Redirigiendo a credenciales…
            </span>
          </div>
        )}

        {/* ── error ───────────────────────────────────────────── */}
        {phase === "error" && (
          <>
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
              <span>{error ?? "Algo salió mal."}</span>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={reset}
              >
                Reintentar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
