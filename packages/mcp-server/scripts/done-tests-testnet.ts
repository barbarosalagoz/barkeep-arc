/*
 * The Testnet done-tests, A1 to A8. Runs the server's own modules (the same
 * functions the four MCP tools call) against Arc Testnet, a demo seller in this
 * process, and Circle's Facilitator Service. The owner's steps go through
 * src/owner/actions.ts with the owner key, as the owner CLI does.
 *
 *   npx tsx packages/mcp-server/scripts/done-tests-testnet.ts
 *
 * Every hash is read back from the chain before it is written to
 * deployments/arc-testnet.json. A refusal is not only simulated: the refused
 * transfer is SUBMITTED, so the revert is in a block and has a hash.
 * Testnet only. It refuses to run anywhere else.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, hashTypedData, http, type Address, type Hex } from "viem";

import { TAB_ABI, USDC_ABI } from "../src/abi.ts";
import { AgentKeys } from "../src/agentKeys.ts";
import { ArcChain } from "../src/chain.ts";
import { startSeller } from "../src/demo/seller.ts";
import { USDC, USDC_DOMAIN, deploymentFile, explorerTx, factoryAddress, network } from "../src/network.ts";
import { closeTab, openTab } from "../src/owner/actions.ts";
import { namedAccount, ownerAccount } from "../src/owner/keyfile.ts";
import { createPayer } from "../src/pay.ts";
import { tabSigner, type TransferAuthorization } from "../src/signature.ts";
import { Store } from "../src/state.ts";
import { requestClose, requestOpen, syncTab, tabStatus } from "../src/tabs.ts";
import { withUnit } from "../src/units.ts";
import { createSigner } from "../src/x402Sign.ts";

const net = network("arc-testnet");
if (net.chainId !== 5042002) throw new Error("Testnet only");

const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
const chain = new ArcChain(net, client as never);
const owner = ownerAccount(net.name);
const wallet = createWalletClient({ account: owner, chain: net.chain, transport: http(net.rpcUrl) });
const sellerKey = namedAccount("demoSeller");
const factory = factoryAddress(net);

const store = new Store(process.env.BARKEEP_ARC_STATE_DIR);
const keys = new AgentKeys(store.dir);
const sign = createSigner(net, keys);

const usdc = (who: Address) => client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [who] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (...parts: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...parts);

/* ---- the record ---------------------------------------------------------------- */

const file = deploymentFile(net);
const record = JSON.parse(readFileSync(file, "utf8")) as { doneTests: Record<string, unknown> };
const done = (id: string, entry: Record<string, unknown>) => {
  record.doneTests[id] = { at: new Date().toISOString(), ...entry };
  writeFileSync(file, `${JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
  say(`recorded ${id}`);
};

/** A transaction as the chain reports it, not as anyone claimed it. */
async function readBack(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  const tx = await client.getTransaction({ hash });
  return {
    hash, explorer: explorerTx(net, hash), status: receipt.status, block: Number(receipt.blockNumber), from: receipt.from, to: receipt.to,
    selector: tx.input.slice(0, 10), gasUsed: receipt.gasUsed.toString(), feeUsdc: Number(receipt.gasUsed * receipt.effectiveGasPrice) / 1e18,
  };
}

/** Signs with the tab's real agent key, skipping this package's checks before signing: what a buggy or hostile server would send. */
async function forceSign(tabId: string, tab: Address, amount: string, payTo: Address, timeout = 60) {
  let auth!: TransferAuthorization;
  const requirements: PaymentRequirements = { scheme: "exact", network: net.caip2, asset: USDC, amount, payTo, maxTimeoutSeconds: timeout, extra: { ...USDC_DOMAIN } };
  const c = x402Client.fromConfig({
    schemes: [{ network: net.caip2, client: new ExactEvmScheme(tabSigner(tab, keys.account(tabId), (a) => (auth = a))) }],
    spendControls: { allowedAssets: [{ network: net.caip2, asset: USDC, maxAmountPerPayment: "100000000" }] },
  });
  const payload = await c.createPaymentPayload({ x402Version: 2, resource: { url: "forced", description: "", mimeType: "text/plain" }, accepts: [requirements] });
  return { auth, signature: (payload.payload as { signature: Hex }).signature, header: encodePaymentSignatureHeader(payload) };
}

/** Submits a transfer the chain is expected to refuse, with gas fixed so nothing estimates (and balks) first. */
async function submitExpectingRevert(forced: { auth: TransferAuthorization; signature: Hex }) {
  const reason = await chain.simulateTransfer(forced.auth, forced.signature);
  const data = encodeFunctionData({ abi: USDC_ABI, functionName: "transferWithAuthorization", args: [forced.auth.from, forced.auth.to, forced.auth.value, forced.auth.validAfter, forced.auth.validBefore, forced.auth.nonce, forced.signature] });
  const hash = await wallet.sendTransaction({ to: USDC, data, gas: 250_000n });
  const tx = await readBack(hash);
  if (tx.status !== "reverted") throw new Error(`expected ${hash} to revert; it is ${tx.status}`);
  return { revertReason: reason, tx };
}

const tabAnswer = (tab: Address, forced: { auth: TransferAuthorization; signature: Hex }) =>
  client.readContract({
    address: tab, abi: TAB_ABI, functionName: "isValidSignature",
    args: [hashTypedData({
      domain: { ...USDC_DOMAIN, chainId: net.chainId, verifyingContract: USDC },
      types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "TransferWithAuthorization",
      message: forced.auth,
    }), forced.signature],
  });

const refusal = async (p: Promise<unknown>): Promise<string> => p.then(() => { throw new Error("expected a refusal"); }, (e: Error) => e.message);

/* ---- run ------------------------------------------------------------------------ */

say(`owner ${owner.address} holds ${withUnit(await usdc(owner.address))}; factory ${factory}; seller ${sellerKey.address}`);

const seller = await startSeller(net, sellerKey, {
  "/haiku": { amount: "50000" }, // 0.05 USDC
  "/cheap": { amount: "1000" }, // 0.001 USDC
  "/pricey": { amount: "100001" }, // one base unit above the tab's per-call maximum
});
// A second seller, paid at an address the tab does not list. It has to be a real seller with its own key: on the
// keyless trial Circle only serves the payTo whose key signed the seller proof, and answers 401 otherwise.
const outsiderKey = namedAccount("relayer");
const outsiderSeller = await startSeller(net, outsiderKey, { "/haiku": { amount: "1000" } });
const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign, settleWaitMs: 90_000, settlePollMs: 1_500 });

try {
  /* A1 + A7 */
  const asked = await requestOpen(store, keys, chain, factory, { limit: "0.5", max_per_call: "0.1", window: "PT2H", payees: [sellerKey.address] });
  const tabId = asked.tab_id;
  const opened = await openTab(net, wallet, client as never, store, tabId);
  const tabAddress = opened.tab;
  say(`tab ${tabId} at ${tabAddress}`);
  let { tab } = await syncTab(store, chain, store.getTab(tabId)!);
  const statusBefore = await tabStatus(store, keys, chain, tab);

  const first = await pay(tab, { url: `${seller.url}/haiku`, max_amount: "0.06" });
  const statusAfter = await tabStatus(store, keys, chain, store.getTab(tabId)!);
  const firstTx = await readBack(first.tx as Hex);
  const firstCall = decodeFunctionData({ abi: USDC_ABI, data: (await client.getTransaction({ hash: first.tx as Hex })).input });
  const circleVerify = seller.log.find((l) => l.step === "verify")!;
  const circleSettle = seller.log.find((l) => l.step === "settle")!;

  done("A1", {
    what: "open a tab, fund it, the agent pays an allowlisted payee, tab_status shows the balance drop",
    tabId, tab: tabAddress, owner: owner.address, agent: tab.agent, payees: tab.payees, cap: "0.5 USDC", maxPerCall: "0.1 USDC",
    approveTx: opened.approveTx && (await readBack(opened.approveTx)), openTx: await readBack(opened.openTx),
    balanceBefore: statusBefore.balance, payment: { url: "/haiku", amount: first.amount, payTo: first.pay_to, tx: firstTx }, balanceAfter: statusAfter.balance, spent: statusAfter.spent,
  });
  done("A7", {
    what: "the tab's 213-byte ERC-1271 signature through Circle's Facilitator Service (keyless trial): verify, settle, hash read back",
    facilitator: "https://api.circle.com/v1/facilitator/x402", signatureBytes: circleVerify.signatureBytes, payer: tabAddress,
    verify: circleVerify.answer, settle: circleSettle.answer,
    tx: firstTx, signatureBytesOnChain: ((firstCall.args![6] as Hex).length - 2) / 2, relayer: firstTx.from,
  });

  /* A2 */
  const a2Local = await refusal(pay(tab, { url: `${seller.url}/pricey`, max_amount: "1" }));
  const a2Forced = await forceSign(tabId, tabAddress, "100001", sellerKey.address);
  const a2Circle = await fetch(`${seller.url}/pricey`, { headers: { "PAYMENT-SIGNATURE": a2Forced.header } });
  done("A2", {
    what: "above maxPerCall: refused before signing; forced, Circle's verify refuses it, isValidSignature says no, and the submitted transfer reverts",
    beforeSigning: a2Local, circleVerify: seller.log.filter((l) => l.step === "verify").at(-1)!.answer, sellerAnswer: { httpStatus: a2Circle.status, body: await a2Circle.json() }, tabAnswer: await tabAnswer(tabAddress, a2Forced), ...(await submitExpectingRevert(a2Forced)), balanceUnchanged: withUnit(await usdc(tabAddress)),
  });

  /* A3 */
  const a3Local = await refusal(pay(tab, { url: `${outsiderSeller.url}/haiku`, max_amount: "1" }));
  const a3Forced = await forceSign(tabId, tabAddress, "1000", outsiderKey.address);
  const a3Circle = await fetch(`${outsiderSeller.url}/haiku`, { headers: { "PAYMENT-SIGNATURE": a3Forced.header } });
  done("A3", {
    what: "a non-payee: refused before signing; forced, Circle's verify refuses it, isValidSignature says no, the submitted transfer reverts",
    beforeSigning: a3Local, circleVerify: outsiderSeller.log.filter((l) => l.step === "verify").at(-1)!.answer, sellerAnswer: { httpStatus: a3Circle.status, body: await a3Circle.json() },
    tabAnswer: await tabAnswer(tabAddress, a3Forced), ...(await submitExpectingRevert(a3Forced)), outsiderBalance: withUnit(await usdc(outsiderKey.address)),
  });

  /* A6 */
  const beforePending = await usdc(tabAddress);
  seller.loseNextAnswer();
  const recovered = await pay(tab, { url: `${seller.url}/haiku`, max_amount: "0.06", request_id: "lost-answer" });
  const again = await pay(tab, { url: `${seller.url}/haiku`, max_amount: "0.06", request_id: "lost-answer" });
  const a6: Record<string, unknown> = {
    what: "outcome unknown: the seller settles through Circle, then tells the buyer settlement_pending. The buyer asks USDC whether the nonce was used, never signs again, and collects with the same signature",
    buyer: { paid: recovered.paid, note: recovered.note, tx: await readBack(recovered.tx as Hex), chargedOnce: withUnit(beforePending - (await usdc(tabAddress))), identicalCallReplayed: again.replayed, body: recovered.body.slice(0, 40) },
  };

  /* A8 */
  const realNow = Date.now;
  const skewed: Record<string, string> = {};
  for (const seconds of [180, -180]) {
    Date.now = () => realNow() + seconds * 1000;
    try {
      const onChain = await chain.verifiedTab(tab);
      skewed[`${seconds > 0 ? "+" : ""}${seconds}s`] = await refusal(sign(tab, onChain, 1_000_000n, { x402Version: 2, resource: { url: "skew", description: "", mimeType: "text/plain" }, accepts: [{ scheme: "exact", network: net.caip2, asset: USDC, amount: "1000", payTo: sellerKey.address, maxTimeoutSeconds: 60, extra: { ...USDC_DOMAIN } }] }));
    } finally {
      Date.now = realNow;
    }
  }
  done("A8", { what: "local clock skewed by +180s and -180s against Arc Testnet's: the signer reports it and signs nothing", signerSaid: skewed, balanceUnchanged: withUnit(await usdc(tabAddress)) });

  /* A6, seller side: a real settlement_pending cannot be summoned. Make small payments and reconcile any that come back pending. */
  const tries = Number(process.env.DONE_TESTS_PENDING_TRIES ?? 25);
  for (let i = 0; i < tries && seller.pendingSeen === 0; i++) await pay(tab, { url: `${seller.url}/cheap`, max_amount: "0.002", request_id: `natural-${i}` });
  const statusCalls = seller.log.filter((l) => l.step === "status");
  a6.seller = seller.pendingSeen > 0
    ? { realPendingSeen: seller.pendingSeen, statusAnswers: statusCalls.map((l) => l.answer), settlesThisRun: seller.settles }
    : { realPendingSeen: 0, settlesThisRun: seller.settles, note: `Circle returned no settlement_pending in ${seller.settles} settles, so the seller's /status polling did not run on Testnet in this run. It ran once in the spike (barkeep, deployments/arc-testnet.json: payment 72ef4b26-4f82-405a-a01b-bcc5f3964fc7, completed as 0x503e92a74c7c056704c9f8e4cb1b530f2496c5c0a772739599cbf188cf3f62b5).` };
  done("A6", a6);

  /* A5 */
  const stillSigned = await forceSign(tabId, tabAddress, "1000", sellerKey.address, 300);
  const closing = await requestClose(store, keys, chain, store.getTab(tabId)!);
  const a5Local = await refusal(pay(store.getTab(tabId)!, { url: `${seller.url}/cheap`, max_amount: "0.002", request_id: "after-close" }));
  const ownerBefore = await usdc(owner.address);
  const closed = await closeTab(net, wallet, client as never, store, tabId);
  done("A5", {
    what: "close_tab destroys the agent key; the owner closes on chain; a payment signed while the key still existed is refused; balance zero",
    closeTab: closing, afterDestroy: a5Local, closeTx: await readBack(closed.closeTx), swept: closed.swept, returnedToOwner: withUnit((await usdc(owner.address)) - ownerBefore + 0n), 
    tabAnswer: await tabAnswer(tabAddress, stillSigned), ...(await submitExpectingRevert(stillSigned)), balance: withUnit(await usdc(tabAddress)),
    status: (await tabStatus(store, keys, chain, store.getTab(tabId)!)).status,
  });

  /* A4 */
  const short = await requestOpen(store, keys, chain, factory, { limit: "0.05", max_per_call: "0.01", window: "PT100S", payees: [sellerKey.address] });
  const shortOpened = await openTab(net, wallet, client as never, store, short.tab_id);
  ({ tab } = await syncTab(store, chain, store.getTab(short.tab_id)!));
  const early = await forceSign(short.tab_id, shortOpened.tab, "1000", sellerKey.address, 20);
  const whileOpen = { tabAnswer: await tabAnswer(shortOpened.tab, early), simulation: (await chain.simulateTransfer(early.auth, early.signature)) ?? "would succeed" };
  say(`waiting for ${short.tab_id} to expire at ${new Date(tab.expiry * 1000).toISOString()}`);
  while ((await chain.now()).timestamp <= tab.expiry + 2) await sleep(5_000);

  const a4Local = await refusal(pay(tab, { url: `${seller.url}/cheap`, max_amount: "0.002", request_id: "after-expiry" }));
  const a4TabAnswer = await tabAnswer(shortOpened.tab, early);
  const a4Revert = await submitExpectingRevert(early);
  // The agent's side first, as for any tab: without this the expired tab's agent key would be left on disk.
  await requestClose(store, keys, chain, store.getTab(short.tab_id)!);
  const shortClosed = await closeTab(net, wallet, client as never, store, short.tab_id);
  done("A4", {
    what: "after expiry: refused before signing; the tab answers no to a signature it accepted while open; the submitted transfer reverts; the owner still gets the money back",
    tabId: short.tab_id, tab: shortOpened.tab, openTx: await readBack(shortOpened.openTx), expiry: new Date(tab.expiry * 1000).toISOString(),
    whileOpen, beforeSigning: a4Local, tabAnswerAfterExpiry: a4TabAnswer, ...a4Revert,
    note: "USDC reports its own expiry check first, because the tab only accepts authorizations that die with it (validBefore <= expiry). The tab's answer is read directly above.",
    closeTx: await readBack(shortClosed.closeTx), returned: withUnit(shortClosed.amount), balance: withUnit(await usdc(shortOpened.tab)),
  });

  done("bill", { what: "the receipts the server wrote during this run, refusals included", receipts: store.receipts().slice(-60) });
  say(`done. owner now holds ${withUnit(await usdc(owner.address))}; seller ${withUnit(await usdc(sellerKey.address))}; Circle settles this run: ${seller.settles}`);
} finally {
  seller.close();
  outsiderSeller.close();
}
