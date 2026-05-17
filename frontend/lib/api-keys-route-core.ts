/**
 * GHB-188 — pure logic for the three API key management routes:
 *   GET  /api/api-keys          → listApiKeys
 *   POST /api/api-keys          → createApiKey
 *   DELETE /api/api-keys/[id]   → revokeApiKey
 *
 * All functions receive a service-role SupabaseClient (bypasses RLS).
 * Ownership is enforced in code via `.eq("user_id", user_id)` on every
 * query — the service-role client is the only security gate.
 */

import { mintApiKey } from "@ghbounty/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

// ---------------------------------------------------------------------------
// Exported result types
// ---------------------------------------------------------------------------

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type CreateApiKeyResult =
  | { ok: true; id: string; name: string; key_prefix: string; plaintext: string }
  | { ok: false; error: "invalid_name" | "profile_missing" | "stake_required" | "insert_failed" };

export type RevokeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_revoked" | "update_failed" };

// ---------------------------------------------------------------------------
// listApiKeys
// ---------------------------------------------------------------------------

/**
 * Return key metadata for `user_id`, newest first.
 * Never returns `key_hash` or `user_id` — only safe summary fields.
 */
export async function listApiKeys(
  supabase: SupabaseClient<Database>,
  user_id: string,
): Promise<ApiKeySummary[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listApiKeys DB error: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }));
}

// ---------------------------------------------------------------------------
// createApiKey
// ---------------------------------------------------------------------------

/**
 * Mint and persist a new API key.
 *
 * Guards:
 *   - name must be 1–64 chars
 *   - profile must exist
 *   - profile.mcp_status must be 'active'
 *
 * Returns the plaintext key exactly once — it is never stored or logged.
 */
export async function createApiKey(
  supabase: SupabaseClient<Database>,
  { user_id, name }: { user_id: string; name: string },
): Promise<CreateApiKeyResult> {
  // Validate name before hitting the DB.
  if (!name || name.length < 1 || name.length > 64) {
    return { ok: false, error: "invalid_name" };
  }

  // Fetch profile to check mcp_status.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("mcp_status")
    .eq("user_id", user_id)
    .maybeSingle();

  if (profileError) throw new Error(`createApiKey profile lookup error: ${profileError.message}`);

  if (!profile) {
    return { ok: false, error: "profile_missing" };
  }

  if (profile.mcp_status !== "active") {
    return { ok: false, error: "stake_required" };
  }

  // Mint the key.
  const { plaintext, prefix, hash } = mintApiKey();

  // Insert the row.
  const { data: inserted, error: insertError } = await supabase
    .from("api_keys")
    .insert({
      user_id,
      name,
      key_hash: hash,
      key_prefix: prefix,
    })
    .select("id, name, key_prefix")
    .single();

  if (insertError || !inserted) {
    return { ok: false, error: "insert_failed" };
  }

  return {
    ok: true,
    id: inserted.id,
    name: inserted.name,
    key_prefix: inserted.key_prefix,
    plaintext,
  };
}

// ---------------------------------------------------------------------------
// revokeApiKey
// ---------------------------------------------------------------------------

/**
 * Set `revoked_at = now()` on a key owned by `user_id`.
 *
 * Ownership is enforced by querying with BOTH `id` AND `user_id`.
 * Returns `not_found` when no matching row exists (covers wrong owner).
 * Returns `already_revoked` without re-updating when `revoked_at` is set.
 */
export async function revokeApiKey(
  supabase: SupabaseClient<Database>,
  { id, user_id }: { id: string; user_id: string },
): Promise<RevokeResult> {
  // Look up by both id AND user_id to enforce ownership.
  const { data: key, error: selectError } = await supabase
    .from("api_keys")
    .select("id, revoked_at")
    .eq("id", id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (selectError) throw new Error(`revokeApiKey lookup error: ${selectError.message}`);

  if (!key) {
    return { ok: false, error: "not_found" };
  }

  if (key.revoked_at) {
    return { ok: false, error: "already_revoked" };
  }

  const { error: updateError } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user_id);

  if (updateError) {
    return { ok: false, error: "update_failed" };
  }

  return { ok: true };
}
