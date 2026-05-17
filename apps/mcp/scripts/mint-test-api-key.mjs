#!/usr/bin/env node
// Mints a test api_key for devnet smoke testing — post-GHB-188 identity model.
// Usage: node apps/mcp/scripts/mint-test-api-key.mjs <privy_user_id> [name]
//
// <privy_user_id>  Privy DID of an existing profile (e.g. "did:privy:cm…").
// [name]           Optional label for the key (default "test-script").
//
// Prints the plaintext key (copy it — only shown once) and the SQL
// statements to:
//   1. Ensure the profile is in mcp_status='active' (required by middleware).
//   2. Insert the api_keys row joining via user_id.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbk_live_";
const SECRET_HEX_LEN = 32;
const PREFIX_HEX_LEN = 12;
const BCRYPT_ROUNDS = 12;

const userId = process.argv[2];
const name = process.argv[3] || "test-script";
if (!userId) {
  console.error("Usage: node mint-test-api-key.mjs <privy_user_id> [name]");
  console.error("");
  console.error("Find your <privy_user_id> with:");
  console.error("  SELECT user_id FROM profiles WHERE email = '<your-email>';");
  process.exit(1);
}

const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
const plaintext = `${PREFIX}${secret}`;
const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);

console.log("=========================================");
console.log("API key plaintext (COPY NOW — shown once):");
console.log("");
console.log("  " + plaintext);
console.log("");
console.log("=========================================");
console.log("");
console.log("SQL to run in Supabase SQL Editor:");
console.log("");
console.log("-- Step 1: ensure your profile is active (required by middleware).");
console.log(`UPDATE profiles SET mcp_status = 'active' WHERE user_id = '${userId}';`);
console.log("");
console.log("-- Step 2: insert the api_key.");
console.log("INSERT INTO api_keys (user_id, name, key_hash, key_prefix)");
console.log(`VALUES ('${userId}', '${name}', '${hash}', '${prefix}');`);
console.log("");
console.log("=========================================");
