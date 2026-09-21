/*
 * Signing an x402 payment from a tab, with the STOCK x402 client. Two things are
 * ours: the signer (signature.ts), and the clock.
 *
 * The stock client sets validBefore = now + maxTimeoutSeconds. A tab refuses any
 * authorization that could outlive it, so near the end of a tab's life the
 * timeout handed to the client is shortened to fit. What the seller is told it
 * `accepted` is put back exactly as the seller wrote it, because sellers match
 * that field against their own offer.
 */

import { x402Client } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Hex } from "viem";

import type { AgentKeys } from "./agentKeys.ts";
import type { OnChainTab } from "./chain.ts";
import { USDC, type Network } from "./network.ts";
import type { SignedPayment } from "./pay.ts";
import { tabSigner, type TransferAuthorization } from "./signature.ts";
import type { Tab } from "./state.ts";

/** Seconds kept between an authorization's validBefore and the tab's expiry. */
const EXPIRY_MARGIN = 5;
/** How far this machine's clock may trail the chain's before signing is pointless. */
const MAX_CLOCK_LAG = 30;

export function createSigner(net: Network, keys: AgentKeys) {
  return async function sign(tab: Tab, onChain: OnChainTab, maxAmount: bigint, paymentRequired: PaymentRequired): Promise<SignedPayment> {
    const agent = keys.account(tab.tabId);
    if (agent.address !== onChain.agent) throw new Error(`the key held for ${tab.tabId} is ${agent.address}, but the tab's agent on chain is ${onChain.agent}`);

    // The stock client stamps validBefore from this machine's clock; USDC judges it by the chain's. If this clock is
    // behind, the authorization arrives already expired, so say that here rather than let it look like a refusal.
    const behind = onChain.now - Math.floor(Date.now() / 1000);
    if (behind > MAX_CLOCK_LAG) throw new Error(`this machine's clock is ${behind}s behind ${net.name}'s; fix the clock, an authorization signed now would already be expired`);

    const [offer] = paymentRequired.accepts;
    const room = onChain.expiry - onChain.now - EXPIRY_MARGIN;
    const fitted = { ...offer, maxTimeoutSeconds: Math.max(1, Math.min(offer.maxTimeoutSeconds, room)) };

    let auth: TransferAuthorization | undefined;
    const ceiling = maxAmount < onChain.maxPerCall ? maxAmount : onChain.maxPerCall;
    const client = x402Client.fromConfig({
      schemes: [{ network: net.caip2, client: new ExactEvmScheme(tabSigner(onChain.address, agent, (a) => (auth = a))) }],
      // Arc's USDC is not in x402's default asset table, so it is allowed by name. The ceiling is x402's own,
      // independent check of the per-call cap.
      spendControls: { allowedAssets: [{ network: net.caip2, asset: USDC, maxAmountPerPayment: ceiling.toString() }] },
    });

    const payload = await client.createPaymentPayload({ ...paymentRequired, accepts: [fitted] });
    if (!auth) throw new Error("the x402 client produced a payload without asking the tab's key to sign");
    if (auth.validBefore > BigInt(onChain.expiry)) throw new Error("the authorization would outlive the tab");

    return { payload: { ...payload, accepted: offer }, auth, signature: (payload.payload as { signature: Hex }).signature };
  };
}
