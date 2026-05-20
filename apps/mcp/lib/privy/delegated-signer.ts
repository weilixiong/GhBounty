import type { PrivyClient } from "@privy-io/node";

export type SignInput = {
  walletAddress: string; // The Solana on-chain pubkey (base58).
  unsignedTx: Uint8Array;
};

export type SignResult =
  | { ok: true; signedTx: Uint8Array }
  | { ok: false; reason: "delegation_revoked" | "upstream_error" };

/**
 * Ask Privy to sign a Solana transaction on behalf of a user whose embedded
 * wallet has our server's signer attached via `addSigners` in the frontend.
 * Returns a partially-signed transaction (only the user's signature slot
 * filled) — the caller still needs to get a fee-payer signature via the
 * gas station.
 *
 * The request is authorized by passing the server's PKCS8 private key in
 * `authorization_context.authorization_private_keys`. Privy verifies it
 * against the public key registered under the key quorum the user
 * authorized in `/app/credentials`.
 */
export async function signSolanaTransaction(
  client: PrivyClient,
  input: SignInput
): Promise<SignResult> {
  const authorizationPrivateKey = process.env.PRIVY_SIGNER_PRIVATE_KEY;
  if (!authorizationPrivateKey) {
    return { ok: false, reason: "upstream_error" };
  }

  let walletId: string;
  try {
    const wallet = await (client.wallets as any).getWalletByAddress({
      address: input.walletAddress,
    });
    walletId = wallet.id;
  } catch (err: any) {
    if (err?.status === 404) {
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
        authorization_context: {
          authorization_private_keys: [authorizationPrivateKey],
        },
      });

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
