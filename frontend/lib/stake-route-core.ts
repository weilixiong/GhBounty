/**
 * GHB-188 — pure logic for `POST /api/stake`.
 *
 * Registers a confirmed on-chain stake transaction:
 *   1. Look up the profile.
 *   2. Guard: profile missing, wallet mismatch, already active.
 *   3. Insert into stake_deposits.
 *   4. Update profiles.mcp_status → 'active' (and wallet_pubkey if not yet set).
 *
 * Does NOT submit any Solana transaction — that happens client-side before
 * this route is ever called.
 *
 * All DB ops use a service-role client (bypasses RLS).
 * Ownership is enforced in code via `.eq("user_id", user_id)`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StakeConfirmationInput {
  user_id: string;
  wallet_pubkey: string;
  tx_signature: string;
  pda: string;
  locked_until: Date;
  amount_lamports: bigint | string;
}

export type StakeResult =
  | { ok: true }
  | { ok: false; error: "wallet_mismatch" | "already_staked" | "profile_missing" | "db_error" };

// ---------------------------------------------------------------------------
// handleStakeConfirmation
// ---------------------------------------------------------------------------

export async function handleStakeConfirmation(
  supabase: SupabaseClient<Database>,
  input: StakeConfirmationInput,
): Promise<StakeResult> {
  // 1. Look up profile.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("mcp_status, wallet_pubkey")
    .eq("user_id", input.user_id)
    .maybeSingle();

  if (profileError) {
    console.error("handleStakeConfirmation: profile lookup error", profileError.message);
    return { ok: false, error: "db_error" };
  }

  // 2a. Profile missing.
  if (!profile) {
    return { ok: false, error: "profile_missing" };
  }

  // 2b. Already active — idempotency guard.
  if (profile.mcp_status === "active") {
    return { ok: false, error: "already_staked" };
  }

  // 2c. Wallet mismatch — only when profile has a wallet set.
  if (profile.wallet_pubkey !== null && profile.wallet_pubkey !== input.wallet_pubkey) {
    return { ok: false, error: "wallet_mismatch" };
  }

  // 3. Insert stake_deposits row.
  const { error: insertError } = await supabase
    .from("stake_deposits")
    .insert({
      user_id: input.user_id,
      pda: input.pda,
      tx_signature: input.tx_signature,
      amount_lamports: input.amount_lamports.toString(),
      status: "active",
      locked_until: input.locked_until.toISOString(),
    });

  if (insertError) {
    return { ok: false, error: "db_error" };
  }

  // 4. Update profile: flip mcp_status; set wallet_pubkey if it was null.
  const profileUpdate: Database["public"]["Tables"]["profiles"]["Update"] = {
    mcp_status: "active",
  };
  if (profile.wallet_pubkey === null) {
    profileUpdate.wallet_pubkey = input.wallet_pubkey;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(profileUpdate)
    .eq("user_id", input.user_id);

  if (updateError) {
    // Partial state: stake row inserted but profile not updated.
    // Log for investigation but don't attempt rollback (v1 limitation).
    console.error(
      "handleStakeConfirmation: partial state — stake inserted but profile update failed",
      updateError.message,
    );
    return { ok: false, error: "db_error" };
  }

  return { ok: true };
}
