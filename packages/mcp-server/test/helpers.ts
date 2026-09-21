import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { Address, Hex } from "viem";

import type { ArcChain, OnChainTab } from "../src/chain.ts";
import { USDC, network } from "../src/network.ts";
import type { Tab } from "../src/state.ts";

export const tempDir = () => mkdtempSync(join(tmpdir(), "barkeep-arc-"));

export const TAB_ADDRESS: Address = "0x1111111111111111111111111111111111111111";
export const OWNER: Address = "0x2222222222222222222222222222222222222222";
export const PAYEE: Address = "0x3333333333333333333333333333333333333333";
export const OUTSIDER: Address = "0x4444444444444444444444444444444444444444";
export const FACTORY: Address = "0x5555555555555555555555555555555555555555";
export const NET = network("arc-testnet");
export const NOW = 1_800_000_000;

export const openTabRecord = (agent: Address, patch: Partial<Tab> = {}): Tab => ({
  tabId: "tab_0123456789ab", network: "arc-testnet", status: "open", factory: FACTORY, agent, payees: [PAYEE],
  cap: "10000000", maxPerCall: "1000000", expiry: NOW + 3600, window: "PT1H", salt: `0x${"ab".repeat(32)}` as Hex,
  requestedAt: new Date().toISOString(), owner: OWNER, address: TAB_ADDRESS, openTx: `0x${"cd".repeat(32)}`, ...patch,
});

export const onChainTab = (agent: Address, patch: Partial<OnChainTab> = {}): OnChainTab => ({
  address: TAB_ADDRESS, owner: OWNER, agent, maxPerCall: 1_000_000n, expiry: NOW + 3600, payees: [PAYEE], closed: false,
  balance: 10_000_000n, now: NOW, blockNumber: 100n, ...patch,
});

/** A chain that answers from a small script: which nonces are used, what time it is. */
export function fakeChain(state: { used?: boolean | (() => boolean); now?: number; revert?: string | null } = {}) {
  const calls = { authorizationUsed: 0, findTransfer: 0, simulateTransfer: 0 };
  const chain = {
    net: NET,
    authorizationUsed: async () => (calls.authorizationUsed++, typeof state.used === "function" ? state.used() : (state.used ?? false)),
    now: async () => ({ timestamp: state.now ?? NOW, blockNumber: 101n }),
    findTransfer: async () => (calls.findTransfer++, `0x${"ee".repeat(32)}` as Hex),
    simulateTransfer: async () => (calls.simulateTransfer++, state.revert === undefined ? "FiatTokenV2: invalid signature" : state.revert),
  } as unknown as ArcChain;
  return { chain, calls, state };
}

export const offer = (patch: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact", network: NET.caip2, asset: USDC, amount: "1000", payTo: PAYEE, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" }, ...patch,
});

export const challenge = (accepts: PaymentRequirements[]) =>
  new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2, resource: { url: "https://seller.test/haiku", description: "a haiku", mimeType: "text/plain" }, accepts }) } });

export const paid = (tx: string, body = "the resource") =>
  new Response(body, { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: tx, network: NET.caip2, payer: TAB_ADDRESS }) } });
