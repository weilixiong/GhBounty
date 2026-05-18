/**
 * Tests for the server-side submit_solution tx builder.
 *
 * Note on synthetic pubkeys: Solana web3.js v1 `new PublicKey(string)` requires
 * a valid 32-byte base58 string. The task plan's synthetic strings
 * ("Bo111...") are too short to decode to exactly 32 bytes and throw
 * "Invalid public key input". We therefore generate real keypairs via
 * `Keypair.generate()` in the test setup.
 */
import { describe, it, expect } from "vitest";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { buildSubmitSolutionTx } from "@/lib/solana/build-submit-solution-tx";

// Valid base58 pubkeys generated fresh for each test run.
const bountyKp = Keypair.generate();
const solverKp = Keypair.generate();
const gasStationKp = Keypair.generate();

const VALID_INPUT = {
  rpcUrl: "https://example.invalid",
  bountyPda: bountyKp.publicKey.toBase58(),
  solver: solverKp.publicKey.toBase58(),
  gasStationPubkey: gasStationKp.publicKey.toBase58(),
  prUrl: "https://github.com/x/y/pull/1",
  submissionCount: 0,
  blockhash: "11111111111111111111111111111111",
} as const;

describe("buildSubmitSolutionTx", () => {
  it("rejects pr_url longer than 200 chars", async () => {
    await expect(
      buildSubmitSolutionTx({
        ...VALID_INPUT,
        prUrl: "x".repeat(201),
      })
    ).rejects.toThrow(/pr_url too long/);
  });

  it("packs ix into a v0 VersionedTransaction with two signature slots", async () => {
    const result = await buildSubmitSolutionTx(VALID_INPUT);

    expect(result.unsignedTx).toBeInstanceOf(Uint8Array);
    expect(result.submissionPda).toBeDefined();
    expect(result.submissionIndex).toBe(0);

    // Verify the wrapper compiled as v0 with two signature slots (gas station + solver)
    const tx = VersionedTransaction.deserialize(result.unsignedTx);
    expect(tx.version).toBe(0);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
  });
});
