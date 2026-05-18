import { describe, it, expect, vi } from "vitest";
import { signSolanaTransaction } from "@/lib/privy/delegated-signer";

function makeFakeClient(impl: (...args: any[]) => any) {
  // Mirrors client.wallets().solana().signTransaction(...)
  return {
    wallets: () => ({
      solana: () => ({
        signTransaction: vi.fn(impl),
      }),
    }),
  } as any;
}

describe("signSolanaTransaction", () => {
  it("returns signed bytes when Privy accepts", async () => {
    // base64 of [1, 2, 3] is "AQID"
    const fakeClient = makeFakeClient(async () => ({
      encoding: "base64",
      signed_transaction: "AQID",
    }));

    const result = await signSolanaTransaction(fakeClient, {
      walletId: "wallet-xyz",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({
      ok: true,
      signedTx: new Uint8Array([1, 2, 3]),
    });
  });

  it("returns delegation_revoked on 403 from Privy", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const fakeClient = makeFakeClient(async () => {
      throw err;
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletId: "wallet-xyz",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "delegation_revoked" });
  });

  it("returns upstream_error on other failures", async () => {
    const fakeClient = makeFakeClient(async () => {
      throw new Error("network");
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletId: "wallet-xyz",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "upstream_error" });
  });
});
