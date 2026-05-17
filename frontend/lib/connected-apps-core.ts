/**
 * GHB-188 — pure logic for the Connected Apps routes:
 *   GET    /api/connected-apps          → listConnectedApps
 *   DELETE /api/connected-apps/[id]     → revokeConnectedApp
 *
 * All functions receive a service-role SupabaseClient (bypasses RLS).
 * Ownership is enforced in code via `.eq("user_id", user_id)` on every
 * query — the service-role client is the only security gate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ConnectedApp {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

export type RevokeAppResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_revoked" | "db_error" };

// ---------------------------------------------------------------------------
// listConnectedApps
// ---------------------------------------------------------------------------

/**
 * Return active (non-revoked) OAuth tokens for `user_id`, newest first.
 * Never exposes `client_id`, `token_hash`, `user_id`, or `revoked_at`.
 */
export async function listConnectedApps(
  supabase: SupabaseClient,
  user_id: string,
): Promise<ConnectedApp[]> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, name, scopes, created_at, last_used_at")
    .eq("user_id", user_id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listConnectedApps DB error: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    scopes: row.scopes as string[],
    created_at: row.created_at as string,
    last_used_at: row.last_used_at as string | null,
  }));
}

// ---------------------------------------------------------------------------
// revokeConnectedApp
// ---------------------------------------------------------------------------

/**
 * Set `revoked_at = now()` on an OAuth token owned by `user_id`.
 *
 * Ownership is enforced by querying with BOTH `id` AND `user_id`.
 * Returns `not_found` when no matching row exists (covers wrong owner).
 * Returns `already_revoked` without re-updating when `revoked_at` is set.
 */
export async function revokeConnectedApp(
  supabase: SupabaseClient,
  { id, user_id }: { id: string; user_id: string },
): Promise<RevokeAppResult> {
  const { data: token, error: selectError } = await supabase
    .from("oauth_tokens")
    .select("id, revoked_at")
    .eq("id", id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (selectError)
    throw new Error(`revokeConnectedApp lookup error: ${selectError.message}`);

  if (!token) {
    return { ok: false, error: "not_found" };
  }

  if ((token as { revoked_at: string | null }).revoked_at) {
    return { ok: false, error: "already_revoked" };
  }

  const { error: updateError } = await supabase
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user_id);

  if (updateError) {
    return { ok: false, error: "db_error" };
  }

  return { ok: true };
}
