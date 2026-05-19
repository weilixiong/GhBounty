import type { MCPProfile } from "./types";

export type GuardResult =
  | { ok: true }
  | { ok: false; error: { code: "Forbidden"; message: string } };

export function requireRole(
  profile: MCPProfile,
  expected: "dev" | "company"
): GuardResult {
  if (profile.role === expected) return { ok: true };
  return {
    ok: false,
    error: {
      code: "Forbidden",
      message: `This tool requires \`${expected}\` role.`,
    },
  };
}
