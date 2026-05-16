-- GHB-188: rebuild RLS policies after identity merge. Drops old policies that
-- referenced agent_accounts; recreates them against profiles.user_id matching
-- the Privy DID in auth.jwt() ->> 'sub'. Finally drops the now-orphaned
-- agent_accounts table.

BEGIN;

-- Drop all policies referencing agent_accounts on the four FK-bearing tables.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE tablename IN ('api_keys','stake_deposits','pending_txs','slashing_events')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Recreate user-owned policies on the four tables.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_owner_select ON api_keys
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY api_keys_owner_delete ON api_keys
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');
-- INSERT only via service_role (frontend mint endpoint).

ALTER TABLE stake_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY stake_deposits_owner_select ON stake_deposits
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

ALTER TABLE pending_txs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_txs_owner_select ON pending_txs
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

ALTER TABLE slashing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY slashing_events_owner_select ON slashing_events
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');

-- OAuth tables RLS.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_clients_public_read ON oauth_clients
  FOR SELECT USING (true);
-- INSERT/UPDATE/DELETE only via service_role.

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_tokens_owner_select ON oauth_tokens
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY oauth_tokens_owner_delete ON oauth_tokens
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');
-- INSERT only via service_role.

ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
-- No permissive policies — service_role only.

-- Drop the now-orphaned table.
DROP TABLE IF EXISTS agent_accounts CASCADE;

-- Reload PostgREST schema cache (lesson from GHB-191).
NOTIFY pgrst, 'reload schema';

COMMIT;
