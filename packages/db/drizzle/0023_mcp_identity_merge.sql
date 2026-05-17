-- GHB-188: merge agent_accounts into profiles. Additive + data-copy + FK swap.
-- Pre-flight: Gaston wipes existing test rows from agent_accounts and the four
-- FK-bearing tables on devnet before running this. With sources empty the data
-- step is a no-op; it is included so the SQL is correct if reused later.

BEGIN;

-- 1. Add new columns to profiles.
ALTER TABLE profiles
  ADD COLUMN mcp_status agent_status NOT NULL DEFAULT 'pending_stake',
  ADD COLUMN warnings smallint NOT NULL DEFAULT 0,
  ADD COLUMN github_handle text,
  ADD COLUMN wallet_pubkey text;

ALTER TABLE profiles ADD CONSTRAINT profiles_github_handle_unique UNIQUE (github_handle);
ALTER TABLE profiles ADD CONSTRAINT profiles_wallet_pubkey_unique UNIQUE (wallet_pubkey);

-- 2. Best-effort data migration from agent_accounts → profiles.
--    With the pre-flight wipe this is a no-op. Skipped intentionally; if ever
--    re-run on populated tables, write a UPDATE that joins on wallet_pubkey
--    and copies status → mcp_status, warnings, github_handle, wallet_pubkey.

-- 3. Swap FKs on api_keys, stake_deposits, pending_txs, slashing_events.
--    These tables are empty (per pre-flight), so we can drop the old FK column
--    and add the new one cleanly.

ALTER TABLE api_keys
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE,
  ADD COLUMN name text,
  ADD COLUMN expires_at timestamptz;
ALTER TABLE api_keys ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE api_keys DROP COLUMN agent_account_id;

ALTER TABLE stake_deposits
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE stake_deposits ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE stake_deposits DROP COLUMN agent_account_id;

ALTER TABLE pending_txs
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE pending_txs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pending_txs DROP COLUMN agent_account_id;

ALTER TABLE slashing_events
  ADD COLUMN user_id text REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE slashing_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE slashing_events DROP COLUMN agent_account_id;

-- 4. New OAuth tables.
CREATE TABLE oauth_clients (
  id           text        PRIMARY KEY,
  client_name  text        NOT NULL,
  redirect_uris text[]     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id     text        NOT NULL REFERENCES oauth_clients(id)  ON DELETE CASCADE,
  name          text        NOT NULL,
  token_hash    text        NOT NULL,
  token_prefix  text        NOT NULL,
  scopes        text[]      NOT NULL DEFAULT ARRAY['full']::text[],
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_prefix_idx ON oauth_tokens(token_prefix);

CREATE TABLE oauth_codes (
  code           text        PRIMARY KEY,
  user_id        text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id      text        NOT NULL REFERENCES oauth_clients(id)  ON DELETE CASCADE,
  code_challenge text        NOT NULL,
  redirect_uri   text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'full',
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_codes_expires_idx ON oauth_codes(expires_at);

COMMIT;
