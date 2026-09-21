/*
 * What only the owner can do: deploy a factory, open and fund a tab, close one.
 * Each takes a wallet client, so the CLI passes the real key and the tests pass
 * a throwaway one. Every transaction is waited for and read back before anything
 * is reported or written down.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isAddressEqual, parseEventLogs, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";

import { FACTORY_ABI, TAB_ABI, USDC_ABI } from "../abi.ts";
import { ArcChain } from "../chain.ts";
import { USDC, deploymentFile, explorerTx, type Network } from "../network.ts";
import type { Store, Tab } from "../state.ts";
import { describeExpiry, withUnit } from "../units.ts";

export type OwnerWallet = WalletClient<Transport, Chain, Account>;

async function mined(client: PublicClient, hash: Hex, what: string) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  return receipt;
}

/* ---- factory ------------------------------------------------------------------ */

export async function deployFactory(net: Network, wallet: OwnerWallet, client: PublicClient, artifact: { abi: unknown; bytecode: Hex }, record = true) {
  const hash = await wallet.deployContract({ abi: artifact.abi as never, bytecode: artifact.bytecode, args: [] });
  const receipt = await mined(client, hash, "TabFactory deployment");
  const address = receipt.contractAddress!;
  const implementation = await client.readContract({ address, abi: FACTORY_ABI, functionName: "IMPLEMENTATION" });

  if (record) {
    const file = deploymentFile(net);
    const existing = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : { network: net.name, chainId: net.chainId, explorer: net.explorer, usdc: USDC, contracts: {}, doneTests: {} };
    (existing.contracts as Record<string, unknown>).tabFactory = { address, implementation, deployer: wallet.account.address, deployTx: hash, explorer: explorerTx(net, hash), block: Number(receipt.blockNumber), at: new Date().toISOString() };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  }
  return { address, implementation, deployTx: hash, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice };
}

/* ---- open --------------------------------------------------------------------- */

export function describeRequest(tab: Tab, owner: Address, now: number): string {
  return [
    `Tab ${tab.tabId} on ${tab.network}`,
    `  owner (you)     ${owner}`,
    `  cap             ${withUnit(BigInt(tab.cap))}   <- leaves your wallet now, comes back on close`,
    `  per call, max   ${withUnit(BigInt(tab.maxPerCall))}`,
    `  ${describeExpiry(tab.expiry, now)}`,
    `  agent           ${tab.agent}`,
    `  may pay only    ${tab.payees.join("\n                  ")}`,
    `  factory         ${tab.factory}`,
    `None of this can be changed after opening. You can close the tab at any time.`,
  ].join("\n");
}

export async function openTab(net: Network, wallet: OwnerWallet, client: PublicClient, store: Store, tabId: string) {
  const tab = store.getTab(tabId);
  if (!tab) throw new Error(`no tab ${tabId} in ${store.dir}`);
  if (tab.network !== net.name) throw new Error(`${tabId} was requested on ${tab.network}, not ${net.name}`);
  if (tab.status !== "requested") throw new Error(`${tabId} is ${tab.status}, not waiting to be opened`);

  const owner = wallet.account.address;
  const chain = new ArcChain(net, client);
  const { timestamp } = await chain.now();
  if (timestamp >= tab.expiry) throw new Error(`${tabId} would already be expired (${describeExpiry(tab.expiry, timestamp)}); ask for a new one`);

  const cap = BigInt(tab.cap);
  const have = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [owner] });
  if (have < cap) throw new Error(`${owner} holds ${withUnit(have)}, less than the cap of ${withUnit(cap)}`);

  const predicted = await chain.predictTab(tab.factory, owner, tab);

  let approveTx: Hex | undefined;
  const allowance = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "allowance", args: [owner, tab.factory] });
  if (allowance < cap) {
    // Exactly the cap, which openTab then uses up: the factory is left with no allowance.
    approveTx = await wallet.writeContract({ address: USDC, abi: USDC_ABI, functionName: "approve", args: [tab.factory, cap] });
    await mined(client, approveTx, "USDC approve");
  }

  const openTx = await wallet.writeContract({
    address: tab.factory,
    abi: FACTORY_ABI,
    functionName: "openTab",
    args: [tab.agent, tab.payees, BigInt(tab.maxPerCall), BigInt(tab.expiry), cap, tab.salt],
  });
  const receipt = await mined(client, openTx, "openTab");

  const [opened] = parseEventLogs({ abi: FACTORY_ABI, logs: receipt.logs, eventName: "TabOpened" });
  if (!opened || !isAddressEqual(opened.args.tab, predicted)) throw new Error(`openTab ${openTx} did not open the predicted tab ${predicted}`);

  const written: Tab = { ...tab, owner, address: opened.args.tab, openTx, openedAt: new Date().toISOString() };
  // Read back through the same check the server uses, before writing anything down.
  const onChain = await chain.verifiedTab(written);
  if (onChain.balance < cap) throw new Error(`the tab at ${onChain.address} holds ${withUnit(onChain.balance)}, not the cap`);
  store.putTab(written);

  return { tab: opened.args.tab, approveTx, openTx, balance: onChain.balance, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice };
}

/* ---- close -------------------------------------------------------------------- */

export async function closeTab(net: Network, wallet: OwnerWallet, client: PublicClient, store: Store, tabId: string) {
  const tab = store.getTab(tabId);
  if (!tab?.address) throw new Error(`${tabId} was never opened on chain; nothing to close`);
  if (tab.network !== net.name) throw new Error(`${tabId} is on ${tab.network}, not ${net.name}`);

  const before = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [tab.address] });
  const closeTx = await wallet.writeContract({ address: tab.address, abi: TAB_ABI, functionName: "close" });
  const receipt = await mined(client, closeTx, "close");

  const [closed] = parseEventLogs({ abi: TAB_ABI, logs: receipt.logs, eventName: "Closed" });
  const after = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [tab.address] });
  const isClosed = await client.readContract({ address: tab.address, abi: TAB_ABI, functionName: "closed" });
  if (!isClosed) throw new Error(`close ${closeTx} was mined but the tab does not report closed`);

  store.putTab({ ...(store.getTab(tabId) ?? tab), status: "closed", closeTx, closedAt: new Date().toISOString() });
  return { closeTx, balanceBefore: before, balanceAfter: after, swept: closed?.args.swept ?? false, amount: closed?.args.amount ?? 0n };
}
