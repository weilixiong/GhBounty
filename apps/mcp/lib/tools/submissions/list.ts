import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";
import { requireRole } from "@/lib/tools/role-guard";

const ListInput = z.object({
  authorization: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function handleSubmissionsList(raw: unknown) {
  const parsed = ListInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const roleCheck = requireRole(auth.profile, "dev");
  if (!roleCheck.ok) return { error: mcpError("Forbidden", roleCheck.error.message) };

  if (!auth.profile.wallet_pubkey) {
    return { error: mcpError("Forbidden", "Profile has no wallet pubkey.") };
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("submissions")
    .select("id, pr_url, state, rank, created_at")
    .eq("solver", auth.profile.wallet_pubkey)
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit ?? 50);

  if (error) return { error: mcpError("InternalError", error.message) };

  return {
    items: (data ?? []).map((row: any) => ({
      id: row.id,
      pr_url: row.pr_url,
      state: row.state,
      rank: row.rank,
      created_at: row.created_at,
    })),
  };
}

export function registerSubmissionsList(server: McpServer): void {
  server.tool(
    "submissions.list",
    { limit: z.number().int().min(1).max(50).optional() },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleSubmissionsList({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
