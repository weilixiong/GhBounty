import { describe, it, expect } from "vitest";
import { requireRole } from "@/lib/tools/role-guard";
import type { MCPProfile } from "@/lib/tools/types";

const baseProfile: MCPProfile = {
  user_id: "did:privy:abc",
  role: "dev",
  mcp_status: "active",
  wallet_pubkey: "Wallet111",
  github_handle: "alice",
};

describe("requireRole", () => {
  it("returns ok when role matches", () => {
    expect(requireRole(baseProfile, "dev")).toEqual({ ok: true });
  });

  it("returns Forbidden when role mismatches", () => {
    const result = requireRole({ ...baseProfile, role: "company" }, "dev");
    expect(result).toEqual({
      ok: false,
      error: {
        code: "Forbidden",
        message: "This tool requires `dev` role.",
      },
    });
  });
});
