import { describe, expect, it } from "vitest";

import { MAX_CHUNKS, MAX_LOG_SPAN, expiryText, planScan, shortHex, usdc } from "../src/format.ts";

describe("amounts and times", () => {
  it("prints USDC with 6 decimals and no trailing zeros", () => {
    expect(usdc(0n)).toBe("0 USDC");
    expect(usdc(939_000n)).toBe("0.939 USDC");
    expect(usdc(1_000_000n)).toBe("1 USDC");
    expect(usdc(1n)).toBe("0.000001 USDC");
  });

  it("says whether a tab has expired", () => {
    expect(expiryText(1_000, 2_000)).toBe("expired 1970-01-01T00:16:40Z");
    expect(expiryText(2_000 + 86_400 + 3_600 + 60, 2_000)).toMatch(/\(in 1d 1h 1m\)$/);
  });

  it("shortens a hash and leaves short strings alone", () => {
    expect(shortHex(`0x${"ab".repeat(32)}`)).toBe("0xabababab…ababab");
    expect(shortHex("0x1234")).toBe("0x1234");
  });
});

describe("scanning logs in chunks the RPC accepts", () => {
  it("never asks for 10,000 blocks or more, and covers the range exactly", () => {
    const { chunks, skipped } = planScan(100, 100 + 3 * MAX_LOG_SPAN + 5);
    expect(skipped).toBeNull();
    expect(chunks[0].from).toBe(100);
    expect(chunks.at(-1)!.to).toBe(100 + 3 * MAX_LOG_SPAN + 5);
    for (const [i, c] of chunks.entries()) {
      expect(c.to - c.from + 1).toBeLessThan(10_000);
      if (i > 0) expect(c.from).toBe(chunks[i - 1].to + 1);
    }
  });

  it("scans both ends of a long life and says what it left out", () => {
    const from = 1_000, to = from + 1_000 * MAX_LOG_SPAN;
    const { chunks, skipped } = planScan(from, to);
    expect(chunks).toHaveLength(MAX_CHUNKS);
    expect(chunks[0].from).toBe(from);
    expect(chunks.at(-1)!.to).toBe(to);
    expect(skipped).not.toBeNull();
    expect(skipped!.from).toBe(chunks[MAX_CHUNKS / 2 - 1].to + 1);
    expect(skipped!.to).toBe(chunks[MAX_CHUNKS / 2].from - 1);
  });

  it("handles one block and an empty range", () => {
    expect(planScan(5, 5).chunks).toEqual([{ from: 5, to: 5 }]);
    expect(planScan(6, 5).chunks).toEqual([]);
  });
});
