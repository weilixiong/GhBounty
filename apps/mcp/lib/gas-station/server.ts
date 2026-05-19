/**
 * Server-side SolanaGasStation singleton for the MCP app.
 *
 * Rather than going through the frontend's HTTP endpoint at
 * /api/gas-station/sponsor, the MCP app uses the SolanaGasStation class
 * directly — no extra network hop, no service-to-service auth token needed,
 * and full control over error handling.
 *
 * Wired in GHB-187 (submissions.create / submit_pr).
 */

import { Connection } from "@solana/web3.js";
import {
  SolanaGasStation,
  GasStationError,
  loadGasStationKeypair,
  makeConnectionRpcSubmitter,
} from "@ghbounty/shared";
import type { ChainId } from "@ghbounty/shared";

let cached: SolanaGasStation | null = null;

function get(): SolanaGasStation {
  if (cached) return cached;

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL must be set");

  const chainId = (process.env.CHAIN_ID ?? "solana-devnet") as ChainId;

  cached = new SolanaGasStation({
    chainId,
    keypair: loadGasStationKeypair(),
    rpc: makeConnectionRpcSubmitter(new Connection(rpcUrl, "confirmed")),
  });
  return cached;
}

export async function submitSponsoredTx(
  signedTxBytes: Uint8Array
): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  const gasStation = get();
  const chainId = (process.env.CHAIN_ID ?? "solana-devnet") as ChainId;
  try {
    const result = await gasStation.sponsor({
      chainId,
      payload: {
        kind: "solana",
        partiallySignedTxB64: Buffer.from(signedTxBytes).toString("base64"),
      },
    });
    return { ok: true, signature: result.txHash };
  } catch (err: unknown) {
    // Return only safe, structured codes — never raw error messages that may
    // contain internal details (pubkeys, discriminator codes, RPC responses).
    const reason =
      err instanceof GasStationError
        ? err.code // "validator_rejected" | "rpc_error" | "unsupported_chain" — safe
        : "unexpected_error";
    return { ok: false, reason };
  }
}
