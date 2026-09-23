import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs build script without types
import { refusalsFrom } from "../scripts/extract-record.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const record = JSON.parse(readFileSync(join(repo, "deployments/arc-testnet.json"), "utf8"));

describe("what the page takes from the deployment record", () => {
  const refusals = refusalsFrom(record) as Array<Record<string, unknown>>;

  it("is the four refused attempts, each with the transaction that reverted", () => {
    expect(refusals.map((r) => r.id)).toEqual(["A2", "A3", "A5", "A4"]);
    for (const r of refusals) {
      expect(r.tx).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.tab).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(r.tabAnswer).toBe("0xffffffff");
      expect(String(r.revertReason)).toMatch(/^FiatTokenV2: /);
    }
  });

  it("takes nothing else: no bill, no Circle answers, no request ids", () => {
    const text = JSON.stringify(refusals);
    expect(text).not.toMatch(/requestId|receipts|paymentId|x-request-id/);
    expect(Object.keys(refusals[0]).sort()).toEqual(["beforeSigning", "block", "facilitator", "id", "revertReason", "tab", "tabAnswer", "tx", "what"]);
  });

  it("copes with a network that has no record", () => {
    expect(refusalsFrom({})).toEqual([]);
  });
});
