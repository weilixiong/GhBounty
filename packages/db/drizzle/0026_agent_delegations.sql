-- GHB-187: agent_delegations table — tracks server-side signing consent
-- for MCP submit_pr flow (Privy wallet delegation).

BEGIN;

CREATE TABLE "agent_delegations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"chain_type" text NOT NULL,
	"delegated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_delegations" ADD CONSTRAINT "agent_delegations_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_agent_delegations_active"
  ON "agent_delegations" ("user_id")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "agent_delegations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_delegations_own_read"
  ON "agent_delegations"
  FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

-- Reload PostgREST schema cache so the new table is immediately visible
-- (same pattern as 0024_mcp_rls_rebuild.sql / GHB-191).
NOTIFY pgrst, 'reload schema';

COMMIT;
