/*
 * Opens one long-lived tab on Arc Testnet for the status page to show, and makes
 * a few real payments from it through the demo seller and Circle's facilitator.
 * Testnet only. Recorded in deployments/arc-testnet.json under `demoTab`, with
 * every hash read back from the chain.
 *
 *   npx tsx packages/mcp-server/scripts/open-demo-tab-testnet.ts
 *
 * The tab stays open: cap 1 USDC, at most 0.1 per payment, 30 days, one payee.
 * Its agent key stays in the server's state directory like any other tab's.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { createPublicClient, createWalletClient, http, type Hex } from "viem";

import { AgentKeys } from "../src/agentKeys.ts";
import { ArcChain } from "../src/chain.ts";
import { startSeller } from "../src/demo/seller.ts";
import { deploymentFile, explorerTx, factoryAddress, network } from "../src/network.ts";
import { openTab } from "../src/owner/actions.ts";
import { namedAccount, ownerAccount } from "../src/owner/keyfile.ts";
import { createPayer } from "../src/pay.ts";
import { Store } from "../src/state.ts";
import { requestOpen, syncTab, tabStatus } from "../src/tabs.ts";
import { createSigner } from "../src/x402Sign.ts";

const net = network("arc-testnet");
if (net.chainId !== 5042002) throw new Error("Testnet only");

const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
const chain = new ArcChain(net, client as never);
const owner = ownerAccount(net.name);
const wallet = createWalletClient({ account: owner, chain: net.chain, transport: http(net.rpcUrl) });
const sellerKey = namedAccount("demoSeller");
const store = new Store();
const keys = new AgentKeys(store.dir);

const readBack = async (hash: Hex) => {
  const receipt = await client.waitForTransactionReceipt({ hash });
  return { hash, explorer: explorerTx(net, hash), status: receipt.status, block: Number(receipt.blockNumber) };
};

const seller = await startSeller(net, sellerKey, { "/haiku": { amount: "50000" }, "/line": { amount: "10000" }, "/word": { amount: "1000" } });
try {
  const asked = await requestOpen(store, keys, chain, factoryAddress(net), { limit: "1", max_per_call: "0.1", window: "P30D", payees: [sellerKey.address] });
  const opened = await openTab(net, wallet, client as never, store, asked.tab_id);
  const { tab } = await syncTab(store, chain, store.getTab(asked.tab_id)!);

  const pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign: createSigner(net, keys) });
  const payments = [];
  for (const [path, max] of [["/haiku", "0.06"], ["/line", "0.02"], ["/word", "0.002"]] as const) {
    const result = await pay(tab, { url: `${seller.url}${path}`, max_amount: max });
    payments.push({ what: path, amount: result.amount, payTo: result.pay_to, ...(await readBack(result.tx as Hex)) });
  }
  const status = await tabStatus(store, keys, chain, store.getTab(asked.tab_id)!);

  const file = deploymentFile(net);
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const demoTab = {
    at: new Date().toISOString(),
    what: "A long-lived tab for the status page to show. Open: cap 1 USDC, at most 0.1 USDC per payment, 30 days, one payee (the demo seller).",
    tabId: asked.tab_id, address: opened.tab, owner: owner.address, agent: tab.agent, payees: tab.payees, cap: "1 USDC", maxPerCall: "0.1 USDC",
    expiry: new Date(tab.expiry * 1000).toISOString(), openTx: await readBack(opened.openTx), payments, balanceAfter: status.balance,
  };
  // Placed before doneTests so it does not collide with keys other branches append at the end of the file.
  const { doneTests, ...head } = record;
  writeFileSync(file, `${JSON.stringify({ ...head, demoTab, doneTests }, null, 2)}\n`);
  console.log(JSON.stringify(demoTab, null, 2));
} finally {
  seller.close();
}
