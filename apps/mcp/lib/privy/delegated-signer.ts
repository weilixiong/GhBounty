import type { PrivyClient } from "@privy-io/node";

export type SignInput = {
  walletAddress: string; // The Solana on-chain pubkey (base58).
  unsignedTx: Uint8Array;
};

export type SignResult =
  | { ok: true; signedTx: Uint8Array }
  | { ok: false; reason: "delegation_revoked" | "upstream_error" };

/**
 * Ask Privy to sign a Solana transaction on behalf of a user who has
 * delegated their wallet to our server. Returns a partially-signed
 * transaction (only the user's signature slot filled) — the caller
 * still needs to get a fee-payer signature via the gas station.
 *
 * Privy's signTransaction API takes the internal wallet `id`, not the
 * on-chain pubkey. We resolve the address → id via getWalletByAddress
 * before signing.
 */
export async function signSolanaTransaction(
  client: PrivyClient,
  input: SignInput
): Promise<SignResult> {
  let walletId: string;
  try {
    // Look up the Privy internal wallet ID by on-chain address.
    // Privy's signTransaction API takes the internal id, not the pubkey.
    const wallet = await (client.wallets as any).getWalletByAddress({
      address: input.walletAddress,
    });
    walletId = wallet.id;
  } catch (err: any) {
    if (err?.status === 404) {
      // Either the user never delegated, or revoked off-band via Privy dashboard.
      // From our perspective the signing capability is gone — treat as revoked.
      return { ok: false, reason: "delegation_revoked" };
    }
    return { ok: false, reason: "upstream_error" };
  }

  try {
    const response = await client
      .wallets()
      .solana()
      .signTransaction(walletId, {
        transaction: input.unsignedTx,
      });

    // Privy returns base64 in snake_case. Decode to bytes for callers.
    const signedTx = Buffer.from(response.signed_transaction, "base64");
    return { ok: true, signedTx: new Uint8Array(signedTx) };
  } catch (err: any) {
    if (err?.status === 403) {
      return { ok: false, reason: "delegation_revoked" };
    }
    return { ok: false, reason: "upstream_error" };
  }
}

let cachedClient: PrivyClient | null = null;

/**
 * Lazily construct a singleton Privy client. Throws if env vars are missing.
 * Tests inject their own client and never call this.
 */
export function getPrivyServerClient(): PrivyClient {
  if (cachedClient) return cachedClient;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrivyClient } = require("@privy-io/node");
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET must be set");
  }
  cachedClient = new PrivyClient({ appId, appSecret });
  return cachedClient!;
}
