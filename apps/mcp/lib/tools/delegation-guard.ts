import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardResult } from "./role-guard";

export async function requireWalletDelegated(
  supabase: SupabaseClient,
  userId: string
): Promise<GuardResult> {
  const { data, error } = await supabase
    .from("agent_delegations")
    .select("revoked_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: { code: "Forbidden", message: "Delegation check failed." },
    };
  }

  if (!data || data.revoked_at !== null) {
    return {
      ok: false,
      error: {
        code: "Forbidden",
        message:
          "Wallet delegation required — visit /app/credentials to authorize.",
      },
    };
  }

  return { ok: true };
}
