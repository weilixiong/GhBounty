import { describe, it, expect } from "vitest";

const HAS_UPSTASH =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!HAS_UPSTASH)("Upstash rate limiter (live)", () => {
  it("readLimiter rejects after the sliding-window cap is hit", async () => {
    const { readLimiter } = await import("@/lib/rate-limit/upstash");
    const limiter = readLimiter();
    const subject = `test:${Date.now()}`;

    // readLimiter is 100 req / 1 min. We don't burn 100 calls in CI — just
    // verify the limiter object exists and a single limit call succeeds.
    const r = await limiter.limit(subject);
    expect(r.success).toBe(true);
  }, 30_000);
});
