/*
 * pay_and_fetch: fetch a URL, and if it answers 402, pay it from the tab.
 *
 * WHO THIS CAN PAY. An x402 v2 seller that takes `exact` USDC on Arc by EIP-3009
 * through a facilitator that accepts a contract payer with a long ERC-1271
 * signature. Circle's Facilitator Service and the stock @x402/evm facilitator
 * both do. Circle Gateway's batched option (extra.name "GatewayWalletBatched")
 * verifies with ecrecover and cannot work for a tab; it is never chosen.
 *
 * WHAT IS ENFORCED WHERE. The tab contract enforces payee, per-call maximum,
 * expiry and closure; USDC enforces the balance. This module checks the same
 * terms BEFORE signing, read fresh from the chain, so a payment the contract
 * would refuse is never signed or sent and the bill says which term stopped it.
 * Unlike Barkeep on Stellar, the local check cannot drift from the chain: a
 * tab's terms are immutable. max_amount and idempotency are this server's.
 *
 * IDEMPOTENCY. A request is (tab, url, max_amount, request_id). `pending` is
 * recorded before anything is signed, and the authorization's nonce before it is
 * sent, so an identical second call never signs a second payment.
 *
 * WHEN THE OUTCOME IS UNKNOWN. A timeout, a 5xx, a seller reporting
 * settlement_pending: the payment is never retried. The facilitator's /status is
 * the seller's to call (it needs the seller's proof). The buyer has something
 * better: USDC records every used authorization. This module asks the chain
 * whether the nonce was consumed. Used means paid; unused past validBefore means
 * it never can be; anything else stays `unconfirmed` and blocks a second payment.
 */

import { createHash } from "node:crypto";

import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { getAddress, isAddressEqual, type Hex } from "viem";

import type { ArcChain, OnChainTab } from "./chain.ts";
import { USDC, USDC_DOMAIN, explorerTx } from "./network.ts";
import type { TransferAuthorization } from "./signature.ts";
import type { PaymentRecord, Receipt, Store, Tab } from "./state.ts";
import { fromBaseUnits, toBaseUnits, withUnit } from "./units.ts";

const MAX_BODY_CHARS = 32_000;
/** An authorization must outlive the round trip; below this much life left, the tab is treated as expired. */
const MIN_SECONDS_LEFT = 15;

export interface PayArgs {
  url: string;
  max_amount: string;
  tab_id?: string;
  request_id?: string;
}

export interface SignedPayment {
  payload: PaymentPayload;
  auth: TransferAuthorization;
  signature: Hex;
}

export interface PayDeps {
  store: Store;
  chain: ArcChain;
  fetch: typeof globalThis.fetch;
  /** Reads the tab from the chain and refuses unless the factory vouches for it. */
  verify: (tab: Tab) => Promise<OnChainTab>;
  /** Signs the one requirement chosen, with the tab's agent key. In the server: the stock x402 client. */
  sign: (tab: Tab, onChain: OnChainTab, maxAmount: bigint, paymentRequired: PaymentRequired) => Promise<SignedPayment>;
  /** How long to watch the chain when the seller's answer leaves the outcome open. */
  settleWaitMs?: number;
  settlePollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PayResult {
  tab_id: string;
  url: string;
  http_status: number;
  paid: boolean;
  /** True when this answer is the stored result of an earlier identical call. */
  replayed: boolean;
  amount?: string;
  pay_to?: string;
  tx?: string;
  explorer?: string;
  note?: string;
  body: string;
  body_truncated: boolean;
}

const requestKey = (tab: Tab, url: string, maxAmount: bigint, requestId: string | null) =>
  createHash("sha256").update(JSON.stringify([tab.tabId, url, maxAmount.toString(), requestId])).digest("hex");

const clip = (text: string) => ({ body: text.slice(0, MAX_BODY_CHARS), bodyTruncated: text.length > MAX_BODY_CHARS });

/** The seller's refusal reason for a paid retry, if it gave one. */
function refusalReason(res: Response, text: string): string | undefined {
  try {
    const header = res.headers.get("PAYMENT-REQUIRED");
    const error = header ? decodePaymentRequiredHeader(header).error : undefined;
    if (error) return error;
  } catch {
    // no decodable header
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; errorReason?: unknown; invalidReason?: unknown };
    for (const candidate of [parsed.error, parsed.errorReason, parsed.invalidReason]) if (typeof candidate === "string") return candidate;
  } catch {
    // not JSON
  }
  return undefined;
}

/** Can a tab pay this option at all? Plain EIP-3009 against USDC's own domain, on this network. */
export function usableOption(r: PaymentRequirements, caip2: string): boolean {
  const extra = (r.extra ?? {}) as { name?: string; version?: string; assetTransferMethod?: string };
  return (
    r.scheme === "exact" &&
    r.network === caip2 &&
    r.asset.toLowerCase() === USDC.toLowerCase() &&
    extra.name === USDC_DOMAIN.name &&
    extra.version === USDC_DOMAIN.version &&
    (extra.assetTransferMethod === undefined || extra.assetTransferMethod === "eip3009")
  );
}

/** Which of the tab's terms forbids this payment, read from the chain; null if none does. */
export function termsRefusal(onChain: OnChainTab, payTo: string, price: bigint): string | null {
  if (onChain.closed) return "the tab is closed on chain";
  if (onChain.now > onChain.expiry) return `the tab expired at ${new Date(onChain.expiry * 1000).toISOString()}`;
  if (onChain.expiry - onChain.now < MIN_SECONDS_LEFT) return `the tab expires in ${onChain.expiry - onChain.now}s, too soon for a payment to settle`;
  if (!onChain.payees.some((p) => isAddressEqual(p, getAddress(payTo)))) return `${payTo} is not one of this tab's payees (${onChain.payees.join(", ")})`;
  if (price > onChain.maxPerCall) return `the price, ${withUnit(price)}, is above this tab's per-call maximum of ${withUnit(onChain.maxPerCall)}`;
  if (price > onChain.balance) return `the price, ${withUnit(price)}, is more than the ${withUnit(onChain.balance)} left in this tab`;
  return null;
}

export function createPayer(deps: PayDeps) {
  const inFlight = new Map<string, Promise<PayResult>>();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const settleWaitMs = deps.settleWaitMs ?? 60_000;
  const settlePollMs = deps.settlePollMs ?? 2_000;

  /** Every attempt that does not settle is on the bill too: a bill of successes hides the refusals that show the limits working. */
  const trace = (tab: Tab, url: string, fields: Omit<Receipt, "tabId" | "at" | "endpoint" | "asset">) =>
    deps.store.appendReceipt({ tabId: tab.tabId, at: new Date().toISOString(), endpoint: url, asset: "USDC", ...fields });

  const fromRecord = (r: PaymentRecord, replayed: boolean, note?: string): PayResult => ({
    tab_id: r.tabId,
    url: r.url,
    http_status: r.httpStatus ?? 0,
    paid: r.status === "settled",
    replayed,
    amount: r.amount ? withUnit(BigInt(r.amount)) : undefined,
    pay_to: r.payTo,
    tx: r.tx,
    explorer: r.tx ? explorerTx(deps.chain.net, r.tx) : undefined,
    note,
    body: r.body ?? "",
    body_truncated: r.bodyTruncated ?? false,
  });

  /**
   * What the chain says about an authorization that was sent.
   *   used      USDC consumed the nonce: the transfer happened
   *   dead      unused and past validBefore: it never can happen
   *   open      unused and still valid: it may yet settle
   */
  async function fate(tab: Tab, record: PaymentRecord): Promise<"used" | "dead" | "open"> {
    if (!record.nonce || !tab.address) return "dead"; // nothing was ever signed for this record
    if (await deps.chain.authorizationUsed(tab.address, record.nonce)) return "used";
    const { timestamp } = await deps.chain.now();
    return record.validBefore !== undefined && timestamp >= record.validBefore ? "dead" : "open";
  }

  async function pay(tab: Tab, args: PayArgs, maxAmount: bigint, key: string): Promise<PayResult> {
    const now = () => new Date().toISOString();
    const existing = deps.store.getPayment(key);

    if (existing?.status === "settled") return fromRecord(existing, true);

    if (existing && existing.status !== "refused") {
      // A signature may be out there. Ask the chain; never sign again while it could still be used.
      const outcome = await fate(tab, existing);
      if (outcome === "used") return settleFromChain(tab, existing, 0n, "recovered: the chain shows this payment was made by an earlier identical call");
      if (outcome === "open") {
        throw new Error(
          `An identical request (${existing.status}, started ${existing.startedAt}) sent a payment authorization that the chain has not used ` +
            `yet and that stays valid until ${new Date((existing.validBefore ?? 0) * 1000).toISOString()}. Not paying again. ` +
            `Call again later, or pass a new request_id to pay again deliberately.`
        );
      }
      deps.store.putPayment({ ...existing, status: "refused", updatedAt: now(), error: "the authorization expired unused; nothing was paid" });
    }

    const onChain = await deps.verify(tab);
    const startBlock = onChain.blockNumber;

    const first = await deps.fetch(args.url);
    const firstText = await first.text();
    if (first.status !== 402) {
      const { body, bodyTruncated } = clip(firstText);
      return { tab_id: tab.tabId, url: args.url, http_status: first.status, paid: false, replayed: false, body, body_truncated: bodyTruncated };
    }

    let paymentRequired: PaymentRequired;
    try {
      const header = first.headers.get("PAYMENT-REQUIRED");
      if (!header) throw new Error("no PAYMENT-REQUIRED header");
      paymentRequired = decodePaymentRequiredHeader(header);
    } catch (error) {
      throw new Error(`${args.url} answered 402 without a readable x402 v2 challenge: ${(error as Error).message}`, { cause: error });
    }

    const usable = paymentRequired.accepts
      .filter((r) => usableOption(r, deps.chain.net.caip2))
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1));

    if (usable.length === 0) {
      const offered = paymentRequired.accepts.map((r) => `${r.scheme}/${r.network}/${(r.extra as { name?: string } | undefined)?.name ?? "?"}`).join(", ");
      const reason = `no payment option a tab can use (exact, ${deps.chain.net.caip2}, USDC by EIP-3009); offered: ${offered}`;
      trace(tab, args.url, { kind: "refused", refusedBy: "payment terms", reason });
      throw new Error(`No payment option a tab can use (exact, ${deps.chain.net.caip2}, USDC by EIP-3009). Offered: ${offered}. Nothing was paid.`);
    }

    const chosen = usable[0];
    const price = BigInt(chosen.amount);
    const amount = fromBaseUnits(price);

    if (price > maxAmount) {
      const reason = `price ${withUnit(price)} exceeds max_amount ${withUnit(maxAmount)}`;
      trace(tab, args.url, { kind: "refused", refusedBy: "per-call cap", amount, to: chosen.payTo, reason });
      throw new Error(`Price ${withUnit(price)} exceeds max_amount ${withUnit(maxAmount)}. Nothing was signed or paid.`);
    }

    const forbidden = termsRefusal(onChain, chosen.payTo, price);
    if (forbidden) {
      trace(tab, args.url, { kind: "refused", refusedBy: "tab terms", amount, to: chosen.payTo, reason: forbidden });
      throw new Error(`This tab cannot make this payment: ${forbidden}. The tab contract enforces the same rule on chain. Nothing was signed or paid.`);
    }

    const record: PaymentRecord = {
      key, tabId: tab.tabId, url: args.url, maxAmount: maxAmount.toString(), requestId: args.request_id ?? null,
      status: "pending", startedAt: now(), updatedAt: now(), amount: chosen.amount, payTo: chosen.payTo,
    };
    const save = (patch: Partial<PaymentRecord>) => {
      Object.assign(record, patch, { updatedAt: now() });
      deps.store.putPayment(record);
    };
    // Written before signing, so a crash from here on leaves a record that blocks a second payment.
    save({});

    let signed: SignedPayment;
    try {
      signed = await deps.sign(tab, onChain, maxAmount, { ...paymentRequired, accepts: [chosen] });
    } catch (error) {
      const message = `The payment could not be signed: ${(error as Error).message}. Nothing was sent or paid.`;
      save({ status: "refused", error: message });
      trace(tab, args.url, { kind: "refused", refusedBy: "signing", amount, to: chosen.payTo, reason: message });
      throw new Error(message, { cause: error });
    }

    const paymentHeader = encodePaymentSignatureHeader(signed.payload);
    // The nonce is on disk before the signature leaves: whatever happens next, the chain can be asked about it.
    save({ nonce: signed.auth.nonce, validBefore: Number(signed.auth.validBefore), paymentHeader });

    let second: Response | undefined;
    let secondText = "";
    try {
      second = await deps.fetch(args.url, { headers: { "PAYMENT-SIGNATURE": paymentHeader } });
      secondText = await second.text();
    } catch (error) {
      save({ error: `request failed after the payment signature was sent: ${(error as Error).message}` });
    }

    const { body, bodyTruncated } = clip(secondText);
    let settle;
    try {
      const header = second?.headers.get("PAYMENT-RESPONSE");
      settle = header ? decodePaymentResponseHeader(header) : undefined;
    } catch {
      settle = undefined;
    }

    if (second?.ok && settle?.success && settle.transaction) {
      // The seller says it settled. Read it back: the chain must show the nonce used.
      if (await deps.chain.authorizationUsed(tab.address!, signed.auth.nonce)) {
        save({ status: "settled", tx: settle.transaction, httpStatus: second.status, body, bodyTruncated });
        deps.store.appendReceipt({ tabId: tab.tabId, at: record.updatedAt, kind: "payment", amount, asset: "USDC", to: chosen.payTo, tx: settle.transaction, endpoint: args.url });
        return fromRecord(record, false);
      }
      save({ error: `the seller reported settlement ${settle.transaction} but the chain does not show the authorization used yet` });
    }

    const reason = second ? (refusalReason(second, secondText) ?? settle?.errorReason) : undefined;

    // Every verify refusal is an invalid_* reason and verify runs before anything is submitted. Believe it only if the chain agrees.
    if (second?.status === 402 && reason?.startsWith("invalid_") && !(await deps.chain.authorizationUsed(tab.address!, signed.auth.nonce))) {
      const revert = await deps.chain.simulateTransfer(signed.auth, signed.signature).catch(() => undefined);
      const full = revert ? `${reason}; asked directly, the chain says: ${revert}` : reason;
      save({ status: "refused", httpStatus: second.status, error: full });
      trace(tab, args.url, { kind: "refused", refusedBy: revert ? "on chain" : "seller's facilitator", amount, to: chosen.payTo, reason: full });
      throw new Error(`The payment was refused: ${full}. Nothing was paid.`);
    }

    // Outcome open: a network failure, a 5xx, a 200 without a settlement, settlement_pending. Watch the chain; do not pay again.
    save({ status: "unconfirmed", httpStatus: second?.status, body, bodyTruncated, error: reason ?? record.error });
    const deadline = Date.now() + settleWaitMs;
    for (;;) {
      const outcome = await fate(tab, record);
      if (outcome === "used") return settleFromChain(tab, record, startBlock, `the seller answered ${second ? `HTTP ${second.status}` : "nothing"}${reason ? ` (${reason})` : ""}; the chain shows the payment was made`);
      if (outcome === "dead") {
        save({ status: "refused", error: "the authorization expired unused; nothing was paid" });
        trace(tab, args.url, { kind: "refused", refusedBy: "seller's facilitator", amount, to: chosen.payTo, reason: `no settlement (${reason ?? "no reason given"}) and the authorization has expired unused` });
        throw new Error(`No settlement came back (${reason ?? "no reason given"}) and the authorization has now expired unused. Nothing was paid.`);
      }
      if (Date.now() >= deadline) break;
      await sleep(settlePollMs);
    }

    trace(tab, args.url, { kind: "unconfirmed", amount, to: chosen.payTo, reason: `no settlement seen on chain within ${Math.round(settleWaitMs / 1000)}s (HTTP ${second?.status ?? "none"}${reason ? `, ${reason}` : ""})` });
    throw new Error(
      `No settlement seen on chain within ${Math.round(settleWaitMs / 1000)}s (HTTP ${second?.status ?? "none"}${reason ? `, ${reason}` : ""}). ` +
        `The authorization stays valid until ${new Date(Number(signed.auth.validBefore) * 1000).toISOString()}, so it may still settle. ` +
        `It will not be paid again; call again with the same arguments to check.`
    );
  }

  /** The chain shows the nonce used. Find the transfer, record it, and collect the resource with the SAME signature, never a new one. */
  async function settleFromChain(tab: Tab, record: PaymentRecord, fromBlock: bigint, note: string): Promise<PayResult> {
    const price = BigInt(record.amount ?? "0");
    const tx = await deps.chain.findTransfer(tab.address!, getAddress(record.payTo!), price, fromBlock).catch(() => undefined);

    let httpStatus = record.httpStatus;
    let body = record.body;
    let bodyTruncated = record.bodyTruncated;
    if (record.paymentHeader && !(httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300 && body)) {
      try {
        const again = await deps.fetch(record.url, { headers: { "PAYMENT-SIGNATURE": record.paymentHeader } });
        const text = await again.text();
        if (again.ok) ({ body, bodyTruncated } = clip(text)), (httpStatus = again.status);
      } catch {
        // paid, but the resource could not be collected; said below
      }
    }

    const delivered = httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
    const settled: PaymentRecord = { ...record, status: "settled", tx, httpStatus, body, bodyTruncated, updatedAt: new Date().toISOString() };
    deps.store.putPayment(settled);
    deps.store.appendReceipt({
      tabId: tab.tabId, at: settled.updatedAt, kind: "payment", amount: fromBaseUnits(price), asset: "USDC", to: record.payTo, tx, endpoint: record.url,
      note: `${note}${delivered ? "" : "; the seller did not deliver the resource"}`,
    });
    return fromRecord(settled, false, `${note}${delivered ? "" : ". The seller did not deliver the resource when asked again with the same payment."}`);
  }

  return async function payAndFetch(tab: Tab, args: PayArgs): Promise<PayResult> {
    if (tab.status === "closed") throw new Error(`${tab.tabId} is closed; open a tab to pay`);
    if (tab.status === "requested" || !tab.address) throw new Error(`${tab.tabId} has not been opened by its owner yet; call tab_status`);

    const maxAmount = toBaseUnits(args.max_amount, "max_amount");
    const key = requestKey(tab, args.url, maxAmount, args.request_id ?? null);

    // Concurrent identical calls in this process share one attempt.
    const running = inFlight.get(key);
    if (running) return running.then((r) => ({ ...r, replayed: true }));

    const attempt = pay(tab, args, maxAmount, key).finally(() => inFlight.delete(key));
    inFlight.set(key, attempt);
    return attempt;
  };
}
