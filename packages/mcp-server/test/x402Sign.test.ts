import { describe, expect, it } from "vitest";
import { size } from "viem";

import { AgentKeys } from "../src/agentKeys.ts";
import { createSigner } from "../src/x402Sign.ts";
import { NET, PAYEE, TAB_ADDRESS, offer, onChainTab, openTabRecord, tempDir } from "./helpers.ts";

const required = (o = offer()) => ({ x402Version: 2, resource: { url: "https://seller.test/haiku", description: "", mimeType: "text/plain" }, accepts: [o] });

function setup() {
  const keys = new AgentKeys(tempDir());
  const agent = keys.create("tab_0123456789ab");
  return { keys, agent, tab: openTabRecord(agent), sign: createSigner(NET, keys) };
}

/** The stock client reads the wall clock, so the chain's clock in these tests is the wall clock too. */
const wallNow = () => Math.floor(Date.now() / 1000);

describe("signing with the stock x402 client", () => {
  it("makes the tab the payer, the agent the signer, and the signature 213 bytes", async () => {
    const t = setup();
    const now = wallNow();
    const signed = await t.sign(t.tab, onChainTab(t.agent, { now, expiry: now + 3600 }), 10_000n, required());

    expect(signed.auth.from).toBe(TAB_ADDRESS);
    expect(signed.auth.to).toBe(PAYEE);
    expect(signed.auth.value).toBe(1000n);
    expect(size(signed.signature)).toBe(213);
    expect((signed.payload.payload as { authorization: { from: string } }).authorization.from.toLowerCase()).toBe(TAB_ADDRESS.toLowerCase());
  });

  it("never lets an authorization outlive the tab, and tells the seller its own offer back unchanged", async () => {
    const t = setup();
    const now = wallNow();
    const theirs = offer({ maxTimeoutSeconds: 600 });
    const signed = await t.sign(t.tab, onChainTab(t.agent, { now, expiry: now + 120 }), 10_000n, required(theirs));

    expect(Number(signed.auth.validBefore)).toBeLessThanOrEqual(now + 120);
    expect(Number(signed.auth.validBefore)).toBeGreaterThan(now + 60);
    expect(signed.payload.accepted).toEqual(theirs);
  });

  it("leaves a normal timeout alone when the tab has time to spare", async () => {
    const t = setup();
    const now = wallNow();
    const signed = await t.sign(t.tab, onChainTab(t.agent, { now, expiry: now + 86_400 }), 10_000n, required());
    expect(Math.abs(Number(signed.auth.validBefore) - (now + 60))).toBeLessThanOrEqual(2);
  });

  it("x402's own spend control refuses a price above max_amount or the tab's maximum", async () => {
    const t = setup();
    const now = wallNow();
    await expect(t.sign(t.tab, onChainTab(t.agent, { now, expiry: now + 3600 }), 500n, required())).rejects.toThrow();
    await expect(t.sign(t.tab, onChainTab(t.agent, { now, expiry: now + 3600, maxPerCall: 999n }), 10_000n, required())).rejects.toThrow();
  });

  it("says so when this machine's clock trails the chain's, instead of signing something already expired", async () => {
    const t = setup();
    const ahead = wallNow() + 180;
    await expect(t.sign(t.tab, onChainTab(t.agent, { now: ahead, expiry: ahead + 3600 }), 10_000n, required())).rejects.toThrow(/clock is 1[78]\ds behind/);
  });

  it("refuses when the key it holds is not the tab's agent", async () => {
    const t = setup();
    await expect(t.sign(t.tab, onChainTab("0x9999999999999999999999999999999999999999", { now: wallNow(), expiry: wallNow() + 3600 }), 10_000n, required())).rejects.toThrow(/agent on chain is/);
  });
});
