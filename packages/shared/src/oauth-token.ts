// OAuth token generation + verification. Format: `ghbo_live_<32 hex chars>`.
//
// Storage:
// - Plaintext is shown to the user ONCE (via web onboarding flow).
// - bcrypt hash + first 12 chars (prefix) are stored in oauth_tokens table.
// - Lookup is by prefix (indexed); bcrypt verifies on match.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbo_live_";
const SECRET_HEX_LEN = 32; // 16 bytes → 32 hex chars
const PREFIX_HEX_LEN = 12; // first 12 chars of the hex part used as table lookup index
const BCRYPT_ROUNDS = 12;

export interface MintedOAuthToken {
  /** Full plaintext token. Show to the user ONCE; never store. */
  plaintext: string;
  /** First 12 hex chars (prefixed). Indexed in DB for O(1) lookup. */
  prefix: string;
  /** bcrypt hash. Store this in the oauth_tokens table. */
  hash: string;
}

export function mintOAuthToken(): MintedOAuthToken {
  const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
  const plaintext = `${PREFIX}${secret}`;
  const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
  const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
  return { plaintext, prefix, hash };
}

export function extractOAuthTokenPrefix(plaintext: string): string {
  if (!plaintext.startsWith(PREFIX)) {
    throw new Error("Invalid OAuth token format");
  }
  if (plaintext.length < PREFIX.length + PREFIX_HEX_LEN) {
    throw new Error("Invalid OAuth token format");
  }
  return plaintext.slice(0, PREFIX.length + PREFIX_HEX_LEN);
}

export function verifyOAuthToken(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}
