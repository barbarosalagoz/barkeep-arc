/*
 * Phase 5 on Arc mainnet, one step at a time. Runs the server's own modules
 * against Arc mainnet, the demo seller in this process, and Circle's Facilitator
 * Service on the keyless trial. The owner's steps go through
 * src/owner/actions.ts with the owner key, as the owner CLI does.
 *
 *   BARKEEP_ARC_NETWORK=arc-mainnet npx tsx packages/mcp-server/scripts/phase5-mainnet.ts <step>
 *
 *   open       open the demo tab: 0.5 USDC, at most 0.05 per payment, 24 hours, one payee (mainnetSeller)
 *   first      the first payment: 0.001 USDC, doubling only on Circle's 403 below-minimum, stopping on anything else
 *   more       two more payments at the amount that settled
 *   refusals   above maxPerCall, and a non-payee (mainnetOutsider): Circle's answer, the tab's, and a submitted revert
 *   expiry     A4 on a second short tab: 0.01 USDC, 100 seconds; closed and swept afterwards
 *   close      close_tab (destroys the agent key), the owner closes on chain and sweeps
 *   sweep      sweep <key name> <to>: everything a key holds, as one USDC transfer less its gas; the dust is reported
 *
 * Every hash is read back from the chain before it is written to
 * deployments/arc-mainnet.json. Payer and seller are both the owner's; no third
 * party is paid. Mainnet only. It refuses to run anywhere else.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, createWalletClient, encodeFunctionData, hashTypedData, http, parseAbi, type Address, type Hex } from "viem";

import { TAB_ABI, USDC_ABI } from "../src/abi.ts";
import { AgentKeys } from "../src/agentKeys.ts";
import { ArcChain } from "../src/chain.ts";
import { CIRCLE_FACILITATOR } from "../src/demo/circle.ts";
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

const net = network("arc-mainnet");
if (net.chainId !== 5042) throw new Error("mainnet only");

const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
const chain = new ArcChain(net, client as never);
if ((await client.getChainId()) !== 5042) throw new Error(`${net.rpcUrl} is not chain 5042`);
const owner = ownerAccount(net.name);
const wallet = createWalletClient({ account: owner, chain: net.chain, transport: http(net.rpcUrl) });
const sellerKey = namedAccount("mainnetSeller");
const outsiderKey = namedAccount("mainnetOutsider");
const factory = factoryAddress(net);

const store = new Store(process.env.BARKEEP_ARC_STATE_DIR);
const keys = new AgentKeys(store.dir);
const sign = createSigner(net, keys);

const usdc = (who: Address) => client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [who] });
const say = (...parts: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...parts);

/* ---- the record ---------------------------------------------------------------- */

const file = deploymentFile(net);
type Record_ = { demoTab?: Record<string, unknown>; payments?: Record<string, unknown>[]; doneTests: Record<string, unknown> } & Record<string, unknown>;
const record = JSON.parse(readFileSync(file, "utf8")) as Record_;
const save = () => writeFileSync(file, `${JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
const done = (id: string, entry: Record<string, unknown>) => {
  record.doneTests[id] = { at: new Date().toISOString(), ...entry };
  save();
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
  if (!reason) throw new Error("the simulation says this transfer would succeed; not submitting it");
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

function demoTab() {
  const tabId = record.demoTab?.tabId as string | undefined;
  const tab = tabId && store.getTab(tabId);
  if (!tab) throw new Error("no demo tab yet; run the open step first");
  return { tabId: tabId!, tab, address: record.demoTab!.address as Address };
}

/* ---- steps ---------------------------------------------------------------------- */

const TRANSFER_ABI = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);
const MAX_PER_CALL = 50_000n; // 0.05 USDC
const SMALLEST = 1_000n; // 0.001 USDC, the smallest amount the demo seller prices at, as on Testnet

const steps: Record<string, () => Promise<void>> = {
  async open() {
    if (record.demoTab) throw new Error(`the demo tab is already ${record.demoTab.tabId}`);
    const asked = await requestOpen(store, keys, chain, factory, { limit: "0.5", max_per_call: "0.05", window: "PT24H", payees: [sellerKey.address] });
    const opened = await openTab(net, wallet, client as never, store, asked.tab_id);
    const { tab } = await syncTab(store, chain, store.getTab(asked.tab_id)!);
    record.demoTab = {
      at: new Date().toISOString(),
      what: "The mainnet demo tab. Cap 0.5 USDC, at most 0.05 USDC per payment, 24 hours, one payee: the demo seller, an address the owner holds the key to.",
      tabId: asked.tab_id, address: opened.tab, factory, owner: owner.address, agent: tab.agent, payees: tab.payees, cap: "0.5 USDC", maxPerCall: "0.05 USDC",
      expiry: new Date(tab.expiry * 1000).toISOString(),
      approveTx: opened.approveTx && (await readBack(opened.approveTx)), openTx: await readBack(opened.openTx), balance: withUnit(await usdc(opened.tab)),
    };
    save();
    console.log(JSON.stringify(record.demoTab, null, 2));
  },

  async first() {
    const { tab } = demoTab();
    const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign, settleWaitMs: 90_000, settlePollMs: 1_500 });
    const attempts: Record<string, unknown>[] = [];
    for (let amount = SMALLEST; amount <= MAX_PER_CALL; amount *= 2n) {
      const seller = await startSeller(net, sellerKey, { "/price": { amount: amount.toString() } });
      try {
        say(`paying ${withUnit(amount)}`);
        const outcome = await pay(tab, { url: `${seller.url}/price`, max_amount: withUnit(amount).split(" ")[0], request_id: `first-${amount}` }).then(
          (r) => ({ ok: true as const, r }),
          (e: Error) => ({ ok: false as const, error: e.message }),
        );
        const circle = seller.log.filter((l) => l.step === "verify" || l.step === "settle").map((l) => ({ step: l.step, answer: l.answer }));
        const attempt: Record<string, unknown> = { amount: withUnit(amount), facilitator: CIRCLE_FACILITATOR, auth: "keyless trial (Facilitator-Seller-Proof)", circle };
        attempts.push(attempt);
        if (outcome.ok) {
          attempt.tx = await readBack(outcome.r.tx as Hex);
          attempt.payTo = outcome.r.pay_to;
          record.payments = [{ at: new Date().toISOString(), what: "first payment, the smallest amount that settled", ...attempt }];
          record.firstPaymentAttempts = attempts;
          save();
          console.log(JSON.stringify({ attempts }, null, 2));
          return;
        }
        attempt.buyerSaw = outcome.error;
        const settle = seller.log.filter((l) => l.step === "settle").at(-1)?.answer as { httpStatus?: number; body?: unknown } | undefined;
        const text = JSON.stringify(settle?.body ?? "").toLowerCase();
        record.firstPaymentAttempts = attempts;
        save();
        if (settle?.httpStatus === 403 && text.includes("minimum") && !text.includes("registration_required")) {
          say(`Circle: 403 below minimum at ${withUnit(amount)}; doubling`);
          continue;
        }
        console.log(JSON.stringify({ attempts }, null, 2));
        throw new Error(`STOP: keyless /settle failed at ${withUnit(amount)} for a reason other than below-minimum; see the attempts above`);
      } finally {
        seller.close();
      }
    }
    console.log(JSON.stringify({ attempts }, null, 2));
    throw new Error(`STOP: no amount up to maxPerCall (${withUnit(MAX_PER_CALL)}) cleared Circle's minimum`);
  },

  async more() {
    const { tab } = demoTab();
    const first = record.payments?.[0];
    if (!first) throw new Error("no first payment yet");
    const amount = (first.amount as string).split(" ")[0];
    const base = BigInt(Math.round(Number(amount) * 1e6));
    const seller = await startSeller(net, sellerKey, { "/price": { amount: base.toString() } });
    const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign, settleWaitMs: 90_000, settlePollMs: 1_500 });
    try {
      for (const n of [2, 3]) {
        const r = await pay(tab, { url: `${seller.url}/price`, max_amount: amount, request_id: `payment-${n}` });
        const settle = seller.log.filter((l) => l.step === "settle").at(-1)!.answer;
        record.payments!.push({ at: new Date().toISOString(), what: `payment ${n}`, amount: r.amount, payTo: r.pay_to, circleSettle: settle, tx: await readBack(r.tx as Hex) });
        save();
      }
    } finally {
      seller.close();
    }
    const status = await tabStatus(store, keys, chain, store.getTab(demoTab().tabId)!);
    console.log(JSON.stringify({ payments: record.payments, tabStatus: status }, null, 2));
  },

  async refusals() {
    const { tabId, tab, address } = demoTab();
    const seller = await startSeller(net, sellerKey, { "/pricey": { amount: (MAX_PER_CALL + 1n).toString() } });
    const outsiderSeller = await startSeller(net, outsiderKey, { "/price": { amount: "1000" } });
    const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign });
    try {
      const before = await usdc(address);
      const aboveLocal = await refusal(pay(tab, { url: `${seller.url}/pricey`, max_amount: "1" }));
      const aboveForced = await forceSign(tabId, address, (MAX_PER_CALL + 1n).toString(), sellerKey.address);
      const aboveSeller = await fetch(`${seller.url}/pricey`, { headers: { "PAYMENT-SIGNATURE": aboveForced.header } });
      done("A2", {
        what: "above maxPerCall (0.050001 USDC on a 0.05 tab): refused before signing; forced, Circle's verify refuses it, isValidSignature says no, and the submitted transfer reverts",
        beforeSigning: aboveLocal, circleVerify: seller.log.filter((l) => l.step === "verify").at(-1)?.answer, sellerAnswer: { httpStatus: aboveSeller.status, body: await aboveSeller.json() },
        tabAnswer: await tabAnswer(address, aboveForced), ...(await submitExpectingRevert(aboveForced)), balanceBefore: withUnit(before), balanceAfter: withUnit(await usdc(address)),
      });

      const outsiderBefore = await usdc(outsiderKey.address);
      const outLocal = await refusal(pay(tab, { url: `${outsiderSeller.url}/price`, max_amount: "1" }));
      const outForced = await forceSign(tabId, address, "1000", outsiderKey.address);
      const outSeller = await fetch(`${outsiderSeller.url}/price`, { headers: { "PAYMENT-SIGNATURE": outForced.header } });
      done("A3", {
        what: "a non-payee (mainnetOutsider, the owner's second seller key): refused before signing; forced, Circle's verify refuses it, isValidSignature says no, the submitted transfer reverts",
        beforeSigning: outLocal, circleVerify: outsiderSeller.log.filter((l) => l.step === "verify").at(-1)?.answer, sellerAnswer: { httpStatus: outSeller.status, body: await outSeller.json() },
        tabAnswer: await tabAnswer(address, outForced), ...(await submitExpectingRevert(outForced)),
        outsiderBalanceBefore: withUnit(outsiderBefore), outsiderBalanceAfter: withUnit(await usdc(outsiderKey.address)), tabBalance: withUnit(await usdc(address)),
      });
      record.doneTests.A4 = { status: "pending", what: "after expiry", note: `Not run. The demo tab expires at ${record.demoTab!.expiry}; this is recorded only once it has, never simulated in its place.` };
      save();
    } finally {
      seller.close();
      outsiderSeller.close();
    }
    console.log(JSON.stringify({ A2: record.doneTests.A2, A3: record.doneTests.A3, A4: record.doneTests.A4 }, null, 2));
  },

  /** A4 on a second, short tab, so the demo tab can be closed today without its expiry standing in for a close. */
  async expiry() {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const short = await requestOpen(store, keys, chain, factory, { limit: "0.01", max_per_call: "0.005", window: "PT100S", payees: [sellerKey.address] });
    const opened = await openTab(net, wallet, client as never, store, short.tab_id);
    const { tab } = await syncTab(store, chain, store.getTab(short.tab_id)!);
    const seller = await startSeller(net, sellerKey, { "/price": { amount: "1000" } });
    const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign });
    try {
      const early = await forceSign(short.tab_id, opened.tab, "1000", sellerKey.address, 20);
      const whileOpen = { tabAnswer: await tabAnswer(opened.tab, early), simulation: (await chain.simulateTransfer(early.auth, early.signature)) ?? "would succeed" };
      say(`waiting for ${short.tab_id} to expire at ${new Date(tab.expiry * 1000).toISOString()}`);
      while ((await chain.now()).timestamp <= tab.expiry + 2) await sleep(5_000);

      const beforeSigning = await refusal(pay(tab, { url: `${seller.url}/price`, max_amount: "0.001", request_id: "after-expiry" }));
      const tabAnswerAfterExpiry = await tabAnswer(opened.tab, early);
      const reverted = await submitExpectingRevert(early);
      // The agent's side first, as for any tab: without this the expired tab's agent key would be left on disk.
      await requestClose(store, keys, chain, store.getTab(short.tab_id)!);
      const closed = await closeTab(net, wallet, client as never, store, short.tab_id);
      done("A4", {
        what: "after expiry, on a second short tab (cap 0.01 USDC, 100 seconds): refused before signing; the tab answers no to a signature it accepted while open; the submitted transfer reverts; the owner still gets the money back",
        tabId: short.tab_id, tab: opened.tab, approveTx: opened.approveTx && (await readBack(opened.approveTx)), openTx: await readBack(opened.openTx), expiry: new Date(tab.expiry * 1000).toISOString(),
        whileOpen, beforeSigning, tabAnswerAfterExpiry, ...reverted,
        note: "USDC reports its own expiry check first, because the tab only accepts authorizations that die with it (validBefore <= expiry). The tab's answer is read directly above.",
        closeTx: await readBack(closed.closeTx), returned: withUnit(closed.amount), balance: withUnit(await usdc(opened.tab)),
      });
    } finally {
      seller.close();
    }
    console.log(JSON.stringify(record.doneTests.A4, null, 2));
  },

  /**
   * Sends everything a named key holds to `to` as one ordinary USDC transfer, less the gas it costs. USDC is gas here
   * with 18 decimals and moves as a token with 6, so what cannot be expressed in 6 stays behind as dust; it is reported.
   */
  async sweep() {
    const [name, to] = process.argv.slice(3) as [string, Address];
    if (!name || !/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("usage: sweep <key name> <0x destination>");
    const from = namedAccount(name);
    const sender = createWalletClient({ account: from, chain: net.chain, transport: http(net.rpcUrl) });
    const before = await client.getBalance({ address: from.address });
    const gasPrice = await client.getGasPrice();
    const probe = encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: [to, 1n] });
    const gas = await client.estimateGas({ account: from.address, to: USDC, data: probe });
    const amount = (before - gas * gasPrice) / 10n ** 12n;
    if (amount <= 0n) throw new Error(`${name} holds too little to pay for its own transfer`);
    say(`${name} ${from.address}: ${before} (18 dp); sending ${withUnit(amount)} to ${to}, gas ${gas} at ${gasPrice}`);
    const hash = await sender.sendTransaction({ to: USDC, data: encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: [to, amount] }), gas, gasPrice, type: "legacy" });
    const tx = await readBack(hash);
    if (tx.status !== "success") throw new Error(`${hash} is ${tx.status}`);
    const entry = { at: new Date().toISOString(), from: name, fromAddress: from.address, to, amount: withUnit(amount), tx, dust18: (await client.getBalance({ address: from.address })).toString(), toBalance: withUnit(await usdc(to)) };
    record.sweeps = [...((record.sweeps as unknown[]) ?? []), entry];
    save();
    console.log(JSON.stringify(entry, null, 2));
  },

  async close() {
    const { tabId, address } = demoTab();
    const closing = await requestClose(store, keys, chain, store.getTab(tabId)!);
    const ownerBefore = await usdc(owner.address);
    const closed = await closeTab(net, wallet, client as never, store, tabId);
    done("A5", {
      what: "close_tab destroys the agent key; the owner closes on chain and sweeps what is left back",
      closeTab: closing, closeTx: await readBack(closed.closeTx), swept: closed.swept, returnedToOwner: withUnit((await usdc(owner.address)) - ownerBefore),
      tabBalance: withUnit(await usdc(address)), status: (await tabStatus(store, keys, chain, store.getTab(tabId)!)).status,
    });
    console.log(JSON.stringify(record.doneTests.A5, null, 2));
  },
};

const step = process.argv[2];
if (!step || !steps[step]) throw new Error(`usage: phase5-mainnet.ts <${Object.keys(steps).join("|")}>`);
say(`step ${step}: owner ${owner.address} holds ${withUnit(await usdc(owner.address))}; factory ${factory}; seller ${sellerKey.address}`);
await steps[step]();
