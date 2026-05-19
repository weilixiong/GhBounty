/**
 * Server-side helper to build a `submit_solution` Solana instruction
 * and wrap it in a v0 VersionedTransaction ready for Privy signing.
 *
 * Mirrors `frontend/lib/solana.ts:buildSubmitSolutionIx` but:
 *   - Runs on the server (MCP app).
 *   - Accepts a pre-fetched `submissionCount` and `blockhash` so the
 *     caller controls RPC usage (no implicit network calls here).
 *   - Returns a serialized `VersionedTransaction` with two signer slots:
 *       [0] solver  — filled by Privy
 *       [1] gasStation — filled by the gas station service
 */
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import idl from "@/lib/idl/ghbounty_escrow.json";

const SUBMISSION_SEED = Buffer.from("submission");
const PROGRAM_ID = new PublicKey(idl.address);

/** Encode a u32 as 4-byte little-endian buffer (matches on-chain u32 seed). */
function u32LE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0, 0);
  return buf;
}

/**
 * Read-only wallet stub — identical to the frontend pattern.
 * Only used to satisfy AnchorProvider; signing always goes through Privy.
 */
function readonlyWallet(): Wallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("readonly wallet — sign through Privy");
    },
    signAllTransactions: async () => {
      throw new Error("readonly wallet — sign through Privy");
    },
  } as unknown as Wallet;
}

export type BuildSubmitInput = {
  /** Solana JSON-RPC endpoint (only used to instantiate the AnchorProvider). */
  rpcUrl: string;
  /** Base58 address of the bounty PDA. */
  bountyPda: string;
  /** Base58 address of the solver's Solana wallet (will sign via Privy). */
  solver: string;
  /** Base58 address of the gas station wallet (fee payer). */
  gasStationPubkey: string;
  /** GitHub PR URL (max 200 chars, enforced on-chain). */
  prUrl: string;
  /**
   * Current value of `bounty.submission_count` fetched from the chain.
   * Used as the seed index to derive the submission PDA.
   */
  submissionCount: number;
  /** Recent blockhash for the transaction. */
  blockhash: string;
  /**
   * 32-byte hash of the off-chain Opus report. Defaults to 32 zero bytes
   * (matches the frontend: for manual submissions the relayer fills it later).
   */
  opusReportHash?: Uint8Array;
};

export type BuildSubmitResult = {
  /** Serialized v0 VersionedTransaction (unsigned). */
  unsignedTx: Uint8Array;
  /** Base58 address of the submission PDA that will be initialized. */
  submissionPda: string;
  /** The submission index used (equals `submissionCount` from input). */
  submissionIndex: number;
};

export async function buildSubmitSolutionTx(
  input: BuildSubmitInput
): Promise<BuildSubmitResult> {
  if (input.prUrl.length > 200) {
    throw new Error(`pr_url too long (${input.prUrl.length} chars, max 200)`);
  }

  const opusReportHash = input.opusReportHash ?? new Uint8Array(32);
  if (opusReportHash.length !== 32) {
    throw new Error(
      `opus_report_hash must be 32 bytes (got ${opusReportHash.length})`
    );
  }

  const bountyPda = new PublicKey(input.bountyPda);
  const solver = new PublicKey(input.solver);
  const gasStation = new PublicKey(input.gasStationPubkey);

  const [submissionPda] = PublicKey.findProgramAddressSync(
    [SUBMISSION_SEED, bountyPda.toBuffer(), u32LE(input.submissionCount)],
    PROGRAM_ID
  );

  const connection = new Connection(input.rpcUrl, "confirmed");
  const provider = new AnchorProvider(
    connection,
    readonlyWallet(),
    AnchorProvider.defaultOptions()
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idl as any, provider);

  const ix = await program.methods
    .submitSolution(
      input.prUrl,
      Array.from(opusReportHash) as unknown as number[]
    )
    .accountsStrict({
      solver,
      bounty: bountyPda,
      submission: submissionPda,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();

  const message = new TransactionMessage({
    payerKey: gasStation,
    recentBlockhash: input.blockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const unsignedTx = tx.serialize();

  return {
    unsignedTx,
    submissionPda: submissionPda.toBase58(),
    submissionIndex: input.submissionCount,
  };
}
