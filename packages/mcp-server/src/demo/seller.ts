/*
 * A demo x402 seller on Arc, settling through Circle's Facilitator Service.
 * It exists for the done-tests and for takes; it is nobody's production seller.
 *
 * What a real seller has to get right, and this one does:
 *   - settlement_pending is not a failure and not a success. The resource is NOT
 *     served; the seller polls Circle's /status with the paymentId until it says
 *     completed or failed. It never asks the buyer to pay again.
 *   - the same authorization presented twice is served once paid, not charged
 *     twice: settled nonces are remembered.
 *
 * `loseNextAnswer` is a test hook: the next payment is settled for real and the
 * buyer is then told settlement_pending anyway, as if the answer had been lost on
 * the way. It is how a buyer's recovery can be exercised on a real network,
 * where a real pending answer cannot be summoned on demand.
 */

import { createServer, type Server } from "node:http";

import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import type { Address, LocalAccount } from "viem";

import { USDC, USDC_DOMAIN, type Network } from "../network.ts";
import { circleFacilitator, type CircleAnswer } from "./circle.ts";

export interface SellerLogEntry {
  at: string;
  path: string;
  step: "verify" | "settle" | "status" | "served" | "refused";
  payer?: string;
  signatureBytes?: number;
  answer?: CircleAnswer;
  note?: string;
}

export interface DemoSeller {
  url: string;
  payTo: Address;
  log: SellerLogEntry[];
  settles: number;
  pendingSeen: number;
  loseNextAnswer: () => void;
  close: () => void;
}

export async function startSeller(net: Network, seller: LocalAccount, routes: Record<string, { payTo?: Address; amount: string }>, statusWaitMs = 90_000): Promise<DemoSeller> {
  const circle = circleFacilitator(seller, net.chainId, net.caip2);
  const paid = new Map<string, string>(); // authorization nonce -> transaction
  const state = { log: [] as SellerLogEntry[], settles: 0, pendingSeen: 0, lose: false };
  let url = "";

  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const route = routes[path];
    if (!route) return void res.writeHead(404).end();
    const note = (entry: Omit<SellerLogEntry, "at" | "path">) => state.log.push({ at: new Date().toISOString(), path, ...entry });

    try {
      const requirements: PaymentRequirements = { scheme: "exact", network: net.caip2, asset: USDC, amount: route.amount, payTo: route.payTo ?? seller.address, maxTimeoutSeconds: 60, extra: { ...USDC_DOMAIN } };

      const header = req.headers["payment-signature"];
      if (typeof header !== "string") {
        const required = { x402Version: 2, resource: { url: `${url}${path}`, description: "A haiku about finality", mimeType: "text/plain" }, accepts: [requirements] };
        return void res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) }).end("{}");
      }

      const payload = decodePaymentSignatureHeader(header);
      const inner = payload.payload as { signature: string; authorization: { nonce: string; from: string } };
      const signatureBytes = (inner.signature.length - 2) / 2;

      const already = paid.get(inner.authorization.nonce);
      if (already) {
        note({ step: "served", payer: inner.authorization.from, note: `same authorization presented again; already settled in ${already}` });
        return void res.writeHead(200, { "content-type": "text/plain", "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: already, network: net.caip2, payer: inner.authorization.from }) }).end("Half a second, then /\nnothing left to reorganise -- /\nthe block is the word");
      }

      const verify = await circle.verify(payload, requirements);
      note({ step: "verify", payer: inner.authorization.from, signatureBytes, answer: verify });
      if (verify.httpStatus !== 200 || verify.body.isValid !== true) {
        note({ step: "refused" });
        return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ error: verify.body.invalidReason ?? verify.body.code ?? `facilitator HTTP ${verify.httpStatus}` }));
      }

      let settle = await circle.settle(payload, requirements);
      state.settles++;
      note({ step: "settle", payer: inner.authorization.from, signatureBytes, answer: settle });

      // Pending: do not serve, do not ask for another payment. Reconcile through /status.
      if (settle.httpStatus === 200 && settle.body.errorReason === "settlement_pending") {
        state.pendingSeen++;
        const paymentId = ((settle.body.extensions as Record<string, { paymentId?: string }> | undefined)?.["settlement-status"])?.paymentId;
        const deadline = Date.now() + statusWaitMs;
        while (paymentId && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2_000));
          const status = await circle.status(paymentId);
          note({ step: "status", answer: status });
          if (status.body.status === "completed") {
            settle = { ...settle, body: { success: true, transaction: status.body.transaction, network: net.caip2, payer: inner.authorization.from } };
            break;
          }
          if (status.body.status === "failed") break;
        }
      }

      if (settle.httpStatus !== 200 || settle.body.success !== true || typeof settle.body.transaction !== "string") {
        note({ step: "refused" });
        return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ errorReason: settle.body.errorReason ?? settle.body.code ?? `facilitator HTTP ${settle.httpStatus}` }));
      }

      paid.set(inner.authorization.nonce, settle.body.transaction);

      if (state.lose) {
        state.lose = false;
        note({ step: "refused", note: "test hook: settled for real, then told the buyer settlement_pending as if the answer had been lost" });
        return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ errorReason: "settlement_pending" }));
      }

      note({ step: "served", payer: inner.authorization.from });
      res.writeHead(200, { "content-type": "text/plain", "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: settle.body.transaction, network: net.caip2, payer: inner.authorization.from }) });
      res.end("Half a second, then /\nnothing left to reorganise -- /\nthe block is the word");
    } catch (error) {
      note({ step: "refused", note: `seller error: ${(error as Error).message}` });
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "seller_error" }));
    }
  });

  await new Promise<void>((r) => server.listen(Number(process.env.BARKEEP_ARC_SELLER_PORT ?? 0), "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return {
    url,
    payTo: seller.address,
    log: state.log,
    get settles() { return state.settles; },
    get pendingSeen() { return state.pendingSeen; },
    loseNextAnswer: () => void (state.lose = true),
    close: () => void server.close(),
  };
}
