/*
 * The demo seller's settlement_pending branch.
 *
 * It has never run against a live pending answer in this repository: Circle
 * returned none in 179 Testnet settlements. What can be done honestly is to feed
 * it the one real pending answer that was ever recorded, and the real /status
 * answer that resolved it. Both are in fixtures/circle-settlement-pending.recorded.json,
 * which says where they came from and what was not recorded (headers).
 *
 * Tests named "recorded" use those bodies unchanged. Tests named "simulated" use
 * answers I wrote, because no such answer from Circle was ever captured; they
 * follow the shapes in Circle's documentation and are labelled as such.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { afterEach, describe, expect, it } from "vitest";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { CircleAnswer } from "../src/demo/circle.ts";
import { startSeller, type DemoSeller, type Facilitator } from "../src/demo/seller.ts";
import { NET, TAB_ADDRESS } from "./helpers.ts";

const recorded = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/circle-settlement-pending.recorded.json"), "utf8")) as {
  provenance: Record<string, unknown>;
  settlePending: CircleAnswer;
  statusCompleted: CircleAnswer;
};

const sellerKey = privateKeyToAccount(generatePrivateKey());
let seller: DemoSeller | undefined;
afterEach(() => seller?.close());

/** A facilitator that answers from a script and counts what it was asked. */
function scripted(settle: CircleAnswer, statuses: CircleAnswer[]) {
  const calls = { verify: 0, settle: 0, status: [] as string[] };
  const facilitator: Facilitator = {
    verify: async () => (calls.verify++, { httpStatus: 200, body: { isValid: true, payer: TAB_ADDRESS } }),
    settle: async () => (calls.settle++, settle),
    status: async (paymentId: string) => (calls.status.push(paymentId), statuses[Math.min(calls.status.length - 1, statuses.length - 1)]),
  };
  return { facilitator, calls };
}

const header = (nonce = toHex(1, { size: 32 })) =>
  encodePaymentSignatureHeader({ x402Version: 2, accepted: {}, payload: { signature: `0x${"00".repeat(213)}`, authorization: { from: TAB_ADDRESS, nonce } } } as never);

const start = async (f: Facilitator, statusWaitMs = 200) =>
  (seller = await startSeller(NET, sellerKey, { "/haiku": { amount: "1000" } }, { facilitator: f, statusWaitMs, statusPollMs: 1 }));

describe("the fixture", () => {
  it("is Circle's real pending answer and the real /status answer that resolved it, and says where it came from", () => {
    expect(recorded.settlePending.body).toMatchObject({ success: false, errorReason: "settlement_pending", transaction: "" });
    expect(recorded.statusCompleted.body).toMatchObject({ status: "completed", paymentId: "72ef4b26-4f82-405a-a01b-bcc5f3964fc7" });
    expect(recorded.provenance.source).toMatch(/doneTests\.circleTrial\.stoppedBy/);
    expect(recorded.provenance.fidelity).toMatch(/headers were not recorded/);
  });
});

describe("settlement_pending, recorded answers", () => {
  it("recorded: does not serve on pending, asks /status for the paymentId Circle gave, then serves with the transaction /status reports", async () => {
    const { facilitator, calls } = scripted(recorded.settlePending, [recorded.statusCompleted]);
    const s = await start(facilitator);

    const res = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    expect(res.status).toBe(200);
    expect(decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: "0x503e92a74c7c056704c9f8e4cb1b530f2496c5c0a772739599cbf188cf3f62b5" });

    expect(calls.settle).toBe(1); // pending is never answered with a second settle
    expect(calls.status).toEqual(["72ef4b26-4f82-405a-a01b-bcc5f3964fc7"]);
    expect(s.pendingSeen).toBe(1);
    expect(s.log.map((l) => l.step)).toEqual(["verify", "settle", "status", "served"]);
  });

  it("recorded, then simulated: keeps asking while /status still says pending (that intermediate answer was never captured)", async () => {
    const stillPending: CircleAnswer = { httpStatus: 200, body: { ...recorded.statusCompleted.body, status: "pending", transaction: null } };
    const { facilitator, calls } = scripted(recorded.settlePending, [stillPending, stillPending, recorded.statusCompleted]);
    const s = await start(facilitator);

    const res = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    expect(res.status).toBe(200);
    expect(calls.status).toHaveLength(3);
    expect(calls.settle).toBe(1);
  });

  it("recorded: the same authorization presented again after it resolved is served, not settled again", async () => {
    const { facilitator, calls } = scripted(recorded.settlePending, [recorded.statusCompleted]);
    const s = await start(facilitator);
    await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    const again = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });

    expect(again.status).toBe(200);
    expect(calls.settle).toBe(1);
    expect(calls.verify).toBe(1);
  });
});

describe("settlement_pending, simulated answers (no such answer from Circle was ever recorded)", () => {
  it("simulated: /status reports failed, so the resource is not served and the buyer is told why", async () => {
    const failed: CircleAnswer = { httpStatus: 200, body: { ...recorded.statusCompleted.body, status: "failed", reason: "simulated_failure", transaction: null } };
    const { facilitator, calls } = scripted(recorded.settlePending, [failed]);
    const s = await start(facilitator);

    const res = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ errorReason: "settlement_failed: simulated_failure" });
    expect(calls.settle).toBe(1);
    expect(s.log.at(-1)?.step).toBe("refused");
  });

  it("simulated: /status never resolves within the wait, so the resource is not served and nothing is settled twice", async () => {
    const stillPending: CircleAnswer = { httpStatus: 200, body: { ...recorded.statusCompleted.body, status: "pending", transaction: null } };
    const { facilitator, calls } = scripted(recorded.settlePending, [stillPending]);
    const s = await start(facilitator, 30);

    const res = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    expect(res.status).toBe(402);
    expect(calls.settle).toBe(1);
    expect(calls.status.length).toBeGreaterThan(1);
  });

  it("simulated: a pending answer without a paymentId cannot be reconciled, and is not served", async () => {
    const noId: CircleAnswer = { httpStatus: 200, body: { success: false, errorReason: "settlement_pending", transaction: "" } };
    const { facilitator, calls } = scripted(noId, [recorded.statusCompleted]);
    const s = await start(facilitator);

    const res = await fetch(`${s.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": header() } });
    expect(res.status).toBe(402);
    expect(calls.status).toEqual([]);
  });
});
