/*
 * Everything the page reads from Arc. It is built from viem's individual read
 * actions on a bare client, not from createPublicClient, so that the bundle
 * contains no code that could send a transaction. test/bundle.test.ts checks.
 */

import { createClient, http, type Address } from "viem";
import { getBlock, getBytecode, getContractEvents, getTransactionReceipt, readContract } from "viem/actions";

import { FACTORY_ABI, TAB_ABI, USDC_ABI } from "./abi.ts";
import { USDC, type NetworkConfig, type TabConfig } from "./config.ts";
import { planScan, type ScanPlan } from "./format.ts";

export interface TabView {
  address: Address;
  owner: Address;
  agent: Address;
  payees: Address[];
  maxPerCall: bigint;
  expiry: number;
  closed: boolean;
  balance: bigint;
  now: number;
  block: number;
  /** From the factory's TabOpened event, if the factory opened this tab. */
  opened: { cap: bigint; tx: string; block: number } | null;
}

export interface Payment {
  to: Address;
  value: bigint;
  tx: string;
  block: number;
  /** True when `to` is one of the tab's payees; false for the owner's sweep on close. */
  toPayee: boolean;
}

// ccipRead is off: it would let a contract direct the browser to fetch a URL of its choosing. This page talks to the RPC only.
export const clientFor = (net: NetworkConfig) => createClient({ ccipRead: false, transport: http(net.rpcUrl, { batch: false, retryCount: 2 }) });

export async function readTab(net: NetworkConfig, tab: TabConfig): Promise<TabView> {
  const client = clientFor(net);
  const address = tab.address;

  const code = await getBytecode(client, { address });
  if (!code || code === "0x") throw new Error(`nothing is deployed at ${address} on ${net.name}`);

  const block = await getBlock(client);
  const at = { blockNumber: block.number };
  const [terms, closed, balance] = await Promise.all([
    readContract(client, { address, abi: TAB_ABI, functionName: "terms", ...at }),
    readContract(client, { address, abi: TAB_ABI, functionName: "closed", ...at }),
    readContract(client, { address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [address], ...at }),
  ]);

  // Did the configured factory open this tab? Its TabOpened event is indexed by the tab's address.
  let opened: TabView["opened"] = null;
  if (net.factory) {
    const events = await getContractEvents(client, {
      address: net.factory, abi: FACTORY_ABI, eventName: "TabOpened", args: { tab: address },
      fromBlock: BigInt(tab.openBlock), toBlock: BigInt(tab.openBlock),
    }).catch(() => []);
    const event = events[0];
    if (event?.args.cap !== undefined) opened = { cap: event.args.cap, tx: event.transactionHash, block: Number(event.blockNumber) };
  }

  return {
    address, owner: terms.owner, agent: terms.agent, payees: [...terms.payees], maxPerCall: terms.maxPerCall, expiry: Number(terms.expiry),
    closed, balance, now: Number(block.timestamp), block: Number(block.number), opened,
  };
}

/** USDC that left the tab: Transfer events with the tab as `from`, scanned in chunks the RPC will accept. */
export async function readPayments(net: NetworkConfig, tab: TabConfig, view: TabView): Promise<{ payments: Payment[]; plan: ScanPlan; failed: number }> {
  const client = clientFor(net);
  const plan = planScan(tab.openBlock, tab.closeBlock ?? view.block);
  const payees = new Set(view.payees.map((p) => p.toLowerCase()));

  let failed = 0;
  const payments: Payment[] = [];
  // A few at a time: the public RPC rate-limits bursts.
  for (let i = 0; i < plan.chunks.length; i += 4) {
    const results = await Promise.all(
      plan.chunks.slice(i, i + 4).map((c) =>
        getContractEvents(client, { address: USDC, abi: USDC_ABI, eventName: "Transfer", args: { from: tab.address }, fromBlock: BigInt(c.from), toBlock: BigInt(c.to) }).catch(() => (failed++, []))
      )
    );
    for (const log of results.flat()) {
      if (log.args.to === undefined || log.args.value === undefined) continue;
      payments.push({ to: log.args.to, value: log.args.value, tx: log.transactionHash, block: Number(log.blockNumber), toPayee: payees.has(log.args.to.toLowerCase()) });
    }
  }
  payments.sort((a, b) => b.block - a.block);
  return { payments, plan, failed };
}

/** Is this transaction in a block, and did it revert? Used to check the record's refusals against the chain. */
export async function receiptStatus(net: NetworkConfig, hash: string): Promise<"success" | "reverted" | "not found"> {
  try {
    return (await getTransactionReceipt(clientFor(net), { hash: hash as `0x${string}` })).status;
  } catch {
    return "not found";
  }
}
