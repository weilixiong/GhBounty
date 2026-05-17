import { describe, it, expect } from "vitest";
import { mintOAuthToken, extractOAuthTokenPrefix, verifyOAuthToken } from "../src/oauth-token";

describe("mintOAuthToken", () => {
  it("produces a token starting with 'ghbo_live_' and a 22-char prefix", () => {
    const k = mintOAuthToken();
    expect(k.plaintext.startsWith("ghbo_live_")).toBe(true);
    expect(k.plaintext.length).toBe("ghbo_live_".length + 32);
    expect(k.prefix.length).toBe("ghbo_live_".length + 12);
    expect(k.prefix).toBe(k.plaintext.slice(0, k.prefix.length));
  });

  it("hash verifies the plaintext", () => {
    const k = mintOAuthToken();
    expect(verifyOAuthToken(k.plaintext, k.hash)).toBe(true);
    expect(verifyOAuthToken(k.plaintext + "x", k.hash)).toBe(false);
  });

  it("extractOAuthTokenPrefix returns the 22-char prefix", () => {
    const k = mintOAuthToken();
    expect(extractOAuthTokenPrefix(k.plaintext)).toBe(k.prefix);
  });

  it("extractOAuthTokenPrefix throws on wrong literal prefix", () => {
    expect(() => extractOAuthTokenPrefix("ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow();
  });

  it("extractOAuthTokenPrefix throws on too short input", () => {
    expect(() => extractOAuthTokenPrefix("ghbo_live_ab")).toThrow();
  });
});
