import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PaymentRequired } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { createPayer, termsRefusal, usableOption, type SignedPayment } from "../src/pay.ts";
import { Store, storedText } from "../src/state.ts";
import { NET, NOW, OUTSIDER, PAYEE, TAB_ADDRESS, challenge, fakeChain, offer, onChainTab, openTabRecord, paid, tempDir } from "./helpers.ts";

const agent = privateKeyToAccount(generatePrivateKey()).address;
const TX = `0x${"aa".repeat(32)}`;

/** A payer wired to a scripted seller and a scripted chain, counting how often anything is signed. */
function setup(responses: Array<Response | Error>, chainState: Parameters<typeof fakeChain>[0] = {}, tabPatch = {}, chainTabPatch = {}) {
  const store = new Store(tempDir());
  const { chain, calls } = fakeChain(chainState);
  const signed: PaymentRequired[] = [];
  const requests: Array<RequestInit | undefined> = [];
  let n = 0;

  const sign = async (_tab: unknown, _onChain: unknown, _max: bigint, required: PaymentRequired): Promise<SignedPayment> => {
    signed.push(required);
    const nonce = toHex(signed.length, { size: 32 });
    return {
      payload: { x402Version: 2, accepted: required.accepts[0], resource: required.resource, payload: { signature: "0x00", authorization: {} } } as never,
      auth: { from: TAB_ADDRESS, to: PAYEE, value: BigInt(required.accepts[0].amount), validAfter: 0n, validBefore: BigInt(NOW + 60), nonce },
      signature: "0x00" as Hex,
    };
  };

  const pay = createPayer({
    store, chain, sign,
    verify: async () => onChainTab(agent, chainTabPatch),
    fetch: (async (_url: string, init?: RequestInit) => {
      requests.push(init);
      const next = responses[n++];
      if (next instanceof Error) throw next;
      if (!next) throw new Error("the scripted seller ran out of answers");
      return next;
    }) as typeof fetch,
    settleWaitMs: 30, settlePollMs: 1, sleep: async () => {},
  });

  return { pay, store, signed, requests, calls, tab: openTabRecord(agent, tabPatch) };
}

const args = { url: "https://seller.test/haiku", max_amount: "0.01" };

describe("which offers a tab can pay", () => {
  it("takes plain EIP-3009 USDC on this network and nothing else", () => {
    expect(usableOption(offer(), NET.caip2)).toBe(true);
    expect(usableOption(offer({ extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" } }), NET.caip2)).toBe(true);
    // Circle Gateway's batched option verifies with ecrecover; a contract payer cannot use it.
    expect(usableOption(offer({ extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ network: "eip155:5042" }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ network: "eip155:8453" }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ asset: OUTSIDER }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ scheme: "upto" }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ extra: { name: "USDC", version: "2", assetTransferMethod: "permit2" } }), NET.caip2)).toBe(false);
    expect(usableOption(offer({ extra: undefined }), NET.caip2)).toBe(false);
  });
});

describe("the tab's terms, checked before signing", () => {
  const ok = onChainTab(agent);
  it("passes a payment the contract would pass", () => expect(termsRefusal(ok, PAYEE, 1_000_000n)).toBeNull());
  it("names the term that forbids it", () => {
    expect(termsRefusal(ok, OUTSIDER, 1n)).toMatch(/not one of this tab's payees/);
    expect(termsRefusal(ok, PAYEE, 1_000_001n)).toMatch(/per-call maximum/);
    expect(termsRefusal({ ...ok, balance: 500n }, PAYEE, 501n)).toMatch(/more than the 0.0005 USDC left/);
    expect(termsRefusal({ ...ok, closed: true }, PAYEE, 1n)).toMatch(/closed on chain/);
    expect(termsRefusal({ ...ok, now: ok.expiry + 1 }, PAYEE, 1n)).toMatch(/expired at/);
    expect(termsRefusal({ ...ok, now: ok.expiry - 5 }, PAYEE, 1n)).toMatch(/too soon/);
  });
});

describe("pay_and_fetch", () => {
  it("returns a free resource without signing anything", async () => {
    const t = setup([new Response("free", { status: 200 })]);
    const result = await t.pay(t.tab, args);
    expect(result).toMatchObject({ paid: false, body: "free" });
    expect(t.signed).toHaveLength(0);
  });

  it("pays, reads the settlement back from the chain, and writes the bill", async () => {
    const t = setup([challenge([offer()]), paid(TX)], { used: true });
    const result = await t.pay(t.tab, args);

    expect(result).toMatchObject({ paid: true, replayed: false, amount: "0.001 USDC", pay_to: PAYEE, tx: TX, body: "the resource" });
    expect(result.explorer).toBe(`https://explorer.testnet.arc.io/tx/${TX}`);
    expect(t.calls.authorizationUsed).toBe(1);
    expect(t.store.receipts().map((r) => r.kind)).toEqual(["payment"]);
    expect(t.requests[1]?.headers).toHaveProperty("PAYMENT-SIGNATURE");
  });

  it("never pays an identical request twice", async () => {
    const t = setup([challenge([offer()]), paid(TX)], { used: true });
    await t.pay(t.tab, args);
    const again = await t.pay(t.tab, args);
    expect(again).toMatchObject({ paid: true, replayed: true, tx: TX });
    expect(t.signed).toHaveLength(1);
    expect(t.requests).toHaveLength(2);
  });

  it("shares one attempt between concurrent identical calls", async () => {
    const t = setup([challenge([offer()]), paid(TX)], { used: true });
    const [a, b] = await Promise.all([t.pay(t.tab, args), t.pay(t.tab, args)]);
    expect(t.signed).toHaveLength(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
  });

  it("pays again when asked to with a new request_id", async () => {
    const t = setup([challenge([offer()]), paid(TX), challenge([offer()]), paid(TX)], { used: true });
    await t.pay(t.tab, args);
    await t.pay(t.tab, { ...args, request_id: "second" });
    expect(t.signed).toHaveLength(2);
  });

  it("refuses a price above max_amount before signing", async () => {
    const t = setup([challenge([offer({ amount: "20000" })])]);
    await expect(t.pay(t.tab, args)).rejects.toThrow(/exceeds max_amount .* Nothing was signed or paid/);
    expect(t.signed).toHaveLength(0);
    expect(t.store.receipts()[0]).toMatchObject({ kind: "refused", refusedBy: "per-call cap" });
  });

  it.each([
    ["a payee not on the list", { payTo: OUTSIDER }, {}, /not one of this tab's payees/],
    ["a price above the per-call maximum", { amount: "1000001" }, {}, /per-call maximum/],
    ["a closed tab", {}, { closed: true }, /closed on chain/],
    ["an expired tab", {}, { now: NOW + 7200 }, /expired at/],
    ["an empty tab", {}, { balance: 0n }, /left in this tab/],
  ])("refuses %s before signing, and says so on the bill", async (_name, offerPatch, chainPatch, message) => {
    const t = setup([challenge([offer(offerPatch)])], {}, {}, chainPatch);
    await expect(t.pay(t.tab, { ...args, max_amount: "5" })).rejects.toThrow(message);
    expect(t.signed).toHaveLength(0);
    expect(t.requests).toHaveLength(1);
    expect(t.store.receipts()[0]).toMatchObject({ kind: "refused", refusedBy: "tab terms" });
    expect(t.store.receipts()[0].reason).toMatch(message);
  });

  it("refuses when the only option is one a tab cannot use", async () => {
    const t = setup([challenge([offer({ extra: { name: "GatewayWalletBatched", version: "1" } })])]);
    await expect(t.pay(t.tab, args)).rejects.toThrow(/No payment option a tab can use/);
    expect(t.store.receipts()[0]).toMatchObject({ refusedBy: "payment terms" });
  });

  it("picks the usable option when a seller offers both, as real Arc sellers do", async () => {
    const t = setup([challenge([offer({ amount: "10", extra: { name: "GatewayWalletBatched", version: "1" } }), offer({ amount: "1000" })]), paid(TX)], { used: true });
    await t.pay(t.tab, args);
    expect(t.signed[0].accepts).toHaveLength(1);
    expect(t.signed[0].accepts[0].extra).toMatchObject({ name: "USDC" });
  });

  it("records the facilitator's reason and the chain's own revert reason when the payment is refused", async () => {
    const refusal = new Response(JSON.stringify({ error: "invalid_exact_evm_payload_signature" }), { status: 402 });
    const t = setup([challenge([offer()]), refusal], { used: false, revert: "FiatTokenV2: invalid signature" });
    await expect(t.pay(t.tab, args)).rejects.toThrow(/invalid_exact_evm_payload_signature; asked directly, the chain says: FiatTokenV2: invalid signature/);
    expect(t.store.receipts()[0]).toMatchObject({ kind: "refused", refusedBy: "on chain" });
    expect(t.calls.simulateTransfer).toBe(1);
  });

  it("does not believe a seller that claims a refusal after the chain shows the payment", async () => {
    const lie = new Response(JSON.stringify({ error: "invalid_exact_evm_payload_signature" }), { status: 402 });
    const t = setup([challenge([offer()]), lie, paid(TX, "delivered on the second ask")], { used: true });
    const result = await t.pay(t.tab, args);
    expect(result.paid).toBe(true);
    expect(t.signed).toHaveLength(1);
  });

  describe("when the outcome is unknown (timeout, 5xx, settlement_pending)", () => {
    const pending = () => new Response(JSON.stringify({ errorReason: "settlement_pending" }), { status: 402 });

    it("watches the chain, finds the payment, and collects the resource with the SAME signature", async () => {
      let polls = 0;
      const t = setup([challenge([offer()]), pending(), paid(TX, "delivered after pending")], { used: () => ++polls > 2 });
      const result = await t.pay(t.tab, args);

      expect(result).toMatchObject({ paid: true, body: "delivered after pending" });
      expect(result.note).toMatch(/settlement_pending.*the chain shows the payment was made/);
      expect(t.signed).toHaveLength(1);
      const sent = t.requests.slice(1).map((r) => (r!.headers as Record<string, string>)["PAYMENT-SIGNATURE"]);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toBe(sent[1]);
      expect(t.store.receipts().at(-1)).toMatchObject({ kind: "payment" });
    });

    it("stays unconfirmed, and refuses to pay again, while the authorization can still be used", async () => {
      const t = setup([challenge([offer()]), new Error("socket hang up")], { used: false });
      await expect(t.pay(t.tab, args)).rejects.toThrow(/It will not be paid again/);
      expect(t.store.receipts().at(-1)).toMatchObject({ kind: "unconfirmed" });

      await expect(t.pay(t.tab, args)).rejects.toThrow(/Not paying again/);
      expect(t.signed).toHaveLength(1);
      expect(t.requests).toHaveLength(2);
    });

    it("recovers on a later identical call once the chain shows the payment", async () => {
      const state = { used: false };
      const t = setup([challenge([offer()]), new Response("upstream error", { status: 502 }), paid(TX, "delivered later")], { used: () => state.used });
      await expect(t.pay(t.tab, args)).rejects.toThrow(/No settlement seen/);

      state.used = true;
      const result = await t.pay(t.tab, args);
      expect(result).toMatchObject({ paid: true, body: "delivered later" });
      expect(t.signed).toHaveLength(1);
    });

    it("calls it refused, and lets a new attempt through, once the authorization has expired unused", async () => {
      const t = setup([challenge([offer()]), new Error("timeout")], { used: false, now: NOW + 61 });
      await expect(t.pay(t.tab, args)).rejects.toThrow(/expired unused. Nothing was paid/);
      expect(t.store.receipts().at(-1)).toMatchObject({ kind: "refused" });
    });
  });

  it("writes `pending` before it signs, and the nonce before the signature leaves", async () => {
    const store = new Store(tempDir());
    const { chain } = fakeChain({ used: true });
    const seen: string[] = [];
    const onDisk = () => Object.values(JSON.parse(readFileSync(join(store.dir, "payments.json"), "utf8")) as Record<string, { status: string; nonce?: string }>);
    const tab = openTabRecord(agent);
    const pay = createPayer({
      store, chain, verify: async () => onChainTab(agent),
      sign: async (_t, _c, _m, required) => {
        seen.push(`sign:${onDisk()[0]?.status}`);
        return { payload: { x402Version: 2, accepted: required.accepts[0], payload: {} } as never, auth: { from: TAB_ADDRESS, to: PAYEE, value: 1000n, validAfter: 0n, validBefore: BigInt(NOW + 60), nonce: toHex(9, { size: 32 }) }, signature: "0x00" };
      },
      fetch: (async (_u: string, init?: RequestInit) => {
        if (!init) return challenge([offer()]);
        seen.push(`send:${onDisk()[0]?.nonce}`);
        return paid(TX);
      }) as typeof fetch,
    });
    await pay(tab, args);
    expect(seen).toEqual(["sign:pending", `send:${toHex(9, { size: 32 })}`]);
  });

  it("keeps the signed header only while the outcome is open, and drops it once the payment has settled", async () => {
    const onDisk = (dir: string) => Object.values(JSON.parse(readFileSync(join(dir, "payments.json"), "utf8")) as Record<string, { status: string; paymentHeader?: string }>)[0];

    const direct = setup([challenge([offer()]), paid(TX)], { used: true });
    await direct.pay(direct.tab, args);
    expect(onDisk(direct.store.dir)).toMatchObject({ status: "settled" });
    expect(onDisk(direct.store.dir).paymentHeader).toBeUndefined();

    const state = { used: false };
    const lost = setup([challenge([offer()]), new Error("socket hang up"), paid(TX)], { used: () => state.used });
    await expect(lost.pay(lost.tab, args)).rejects.toThrow(/will not be paid again/);
    expect(onDisk(lost.store.dir).paymentHeader).toBeTypeOf("string"); // still needed: the answer was lost

    state.used = true;
    await lost.pay(lost.tab, args);
    expect(onDisk(lost.store.dir)).toMatchObject({ status: "settled" });
    expect(onDisk(lost.store.dir).paymentHeader).toBeUndefined();
  });

  it("will not pay from a tab that is not open", async () => {
    const t = setup([]);
    await expect(t.pay({ ...t.tab, status: "closed" }, args)).rejects.toThrow(/is closed/);
    await expect(t.pay({ ...t.tab, status: "requested", address: undefined }, args)).rejects.toThrow(/not been opened/);
  });

  it("never writes key material to the store", async () => {
    const t = setup([challenge([offer()]), paid(TX)], { used: true });
    await t.pay(t.tab, args);
    expect(storedText(t.store.dir)).not.toMatch(/privateKey|"0x[0-9a-f]{64}"\s*,?\s*"?address/i);
  });
});
