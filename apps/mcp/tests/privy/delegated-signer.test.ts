import { describe, it, expect, vi, beforeEach } from "vitest";
import { signSolanaTransaction } from "@/lib/privy/delegated-signer";

beforeEach(() => {
  // signSolanaTransaction reads PRIVY_SIGNER_PRIVATE_KEY to attach an
  // authorization_context to the SDK call. The mocked Privy client doesn't
  // validate the key, so any non-empty string works for these tests.
  process.env.PRIVY_SIGNER_PRIVATE_KEY = "test-private-key";
});

function makeFakeClient(opts: {
  getByAddressImpl?: (...args: any[]) => any;
  signImpl?: (...args: any[]) => any;
}) {
  return {
    wallets: Object.assign(
      // function form for client.wallets().solana()
      () => ({
        solana: () => ({
          signTransaction: vi.fn(
            opts.signImpl ??
              (async () => {
                throw new Error("signImpl not set");
              })
          ),
        }),
      }),
      // property form for client.wallets.getWalletByAddress(...)
      {
        getWalletByAddress: vi.fn(
          opts.getByAddressImpl ??
            (async () => {
              throw new Error("getByAddressImpl not set");
            })
        ),
      }
    ),
  } as any;
}

describe("signSolanaTransaction", () => {
  it("returns signed bytes when Privy accepts", async () => {
    // base64 of [1, 2, 3] is "AQID"
    const fakeClient = makeFakeClient({
      getByAddressImpl: async ({ address }: { address: string }) => ({
        id: "wallet_xyz",
        address,
      }),
      signImpl: async () => ({
        encoding: "base64",
        signed_transaction: "AQID",
      }),
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletAddress: "Solver111",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: true, signedTx: new Uint8Array([1, 2, 3]) });
  });

  it("returns delegation_revoked when getWalletByAddress returns 404", async () => {
    const err = Object.assign(new Error("not found"), { status: 404 });
    const fakeClient = makeFakeClient({
      getByAddressImpl: async () => {
        throw err;
      },
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletAddress: "Solver111",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "delegation_revoked" });
  });

  it("returns delegation_revoked on 403 from signTransaction", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const fakeClient = makeFakeClient({
      getByAddressImpl: async ({ address }: { address: string }) => ({
        id: "wallet_xyz",
        address,
      }),
      signImpl: async () => {
        throw err;
      },
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletAddress: "Solver111",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "delegation_revoked" });
  });

  it("returns upstream_error on other signTransaction failures", async () => {
    const fakeClient = makeFakeClient({
      getByAddressImpl: async ({ address }: { address: string }) => ({
        id: "wallet_xyz",
        address,
      }),
      signImpl: async () => {
        throw new Error("network");
      },
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletAddress: "Solver111",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("returns upstream_error when getWalletByAddress fails non-404", async () => {
    const fakeClient = makeFakeClient({
      getByAddressImpl: async () => {
        throw new Error("network");
      },
    });

    const result = await signSolanaTransaction(fakeClient, {
      walletAddress: "Solver111",
      unsignedTx: new Uint8Array([0]),
    });

    expect(result).toEqual({ ok: false, reason: "upstream_error" });
  });
});
