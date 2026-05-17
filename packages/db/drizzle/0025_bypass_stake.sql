-- GHB-196: bypass stake feature, default new profiles to 'active'
-- so users skip the on-chain stake step (deferred per GHB-195).
-- See docsGaso/Engineering/tech-debt.md → "Stake del agente — feature parkeada"

BEGIN;

-- 1. Change DB default for new profile rows
ALTER TABLE "profiles" ALTER COLUMN "mcp_status" SET DEFAULT 'active';

-- 2. Flip existing pending_stake users to active (test data; no real users yet)
-- Does NOT touch 'active', 'suspended', 'revoked', 'pending_oauth' — only the
-- ones literally stuck at 'pending_stake' because they never reached the stake step.
UPDATE "profiles"
   SET "mcp_status" = 'active'
 WHERE "mcp_status" = 'pending_stake';

COMMIT;
