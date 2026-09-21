import { describe, expect, it } from "vitest";

import { presentPayResult } from "../src/index.ts";

describe("what pay_and_fetch shows", () => {
  const base = { tab_id: "tab_0123456789ab", url: "https://seller.test/haiku", http_status: 200, paid: true, replayed: false, amount: "0.001 USDC", pay_to: "0x33", tx: "0xaa", explorer: "https://explorer.testnet.arc.io/tx/0xaa", body: "hello", body_truncated: false };

  it("keeps a normal success short", () => {
    const { summary, body } = presentPayResult(base);
    expect(body).toBe("hello");
    expect(Object.keys(summary)).toEqual(["tab_id", "url", "paid", "amount", "pay_to", "tx", "explorer"]);
  });

  it("says so when no new payment was made, when the status is unusual, and when the body was cut", () => {
    const { summary } = presentPayResult({ ...base, replayed: true, http_status: 502, body_truncated: true, note: "recovered" });
    expect(summary).toMatchObject({ replayed: true, http_status: 502, body_truncated: true, note: "recovered" });
    expect(summary.replay_note).toMatch(/No new payment was made/);
  });
});
