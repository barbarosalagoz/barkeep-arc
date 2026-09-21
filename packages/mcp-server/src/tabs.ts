/*
 * Asking for a tab, reading one, and shutting the agent's side of one.
 *
 * The server cannot open or close a tab on chain: both take the owner's key,
 * which it does not have. open_tab makes the agent key and writes down the terms;
 * the human opens it with bin/barkeep-arc-owner, which shows those terms and asks
 * before it signs. close_tab destroys the agent key, which ends the agent's
 * ability to spend from here at once, and tells the human the command that closes
 * the contract and brings the money back.
 *
 * tab_status trusts none of what is stored. It re-reads the chain and only
 * reports a tab whose address and terms the factory vouches for.
 */

import { randomBytes } from "node:crypto";

import { getAddress, isAddress, toHex, zeroAddress, type Address } from "viem";

import type { AgentKeys } from "./agentKeys.ts";
import type { ArcChain, OnChainTab } from "./chain.ts";
import { explorerAddress, explorerTx } from "./network.ts";
import { reportReceipt, type Store, type Tab } from "./state.ts";
import { describeExpiry, durationToSeconds, toBaseUnits, withUnit } from "./units.ts";

/** contracts/src/Tab.sol MAX_PAYEES. */
export const MAX_PAYEES = 20;

export interface OpenTabArgs {
  limit: string;
  max_per_call: string;
  window: string;
  payees: string[];
}

export const ownerCommand = (verb: "open" | "close", tabId: string): string => `npx barkeep-arc-owner ${verb} ${tabId}`;

const newTabId = (): string => `tab_${randomBytes(6).toString("hex")}`;

export function checkedPayees(payees: string[]): Address[] {
  if (!Array.isArray(payees) || payees.length === 0) {
    throw new Error("payees is required: list the addresses this tab may pay. A tab on Arc cannot pay anyone else, and there is no allow-any option.");
  }
  if (payees.length > MAX_PAYEES) throw new Error(`at most ${MAX_PAYEES} payees; got ${payees.length}`);

  const list = payees.map((p) => {
    if (!isAddress(p, { strict: false })) throw new Error(`not an EVM address: ${p}`);
    const address = getAddress(p);
    if (address === zeroAddress) throw new Error("the zero address cannot be a payee");
    return address;
  });
  if (new Set(list).size !== list.length) throw new Error("payees contains the same address twice");
  return list;
}

export async function requestOpen(store: Store, keys: AgentKeys, chain: ArcChain, factory: Address, args: OpenTabArgs) {
  // Everything is validated before a key is made, so a refused request leaves nothing behind.
  const payees = checkedPayees(args.payees);
  const cap = toBaseUnits(args.limit, "limit");
  const maxPerCall = toBaseUnits(args.max_per_call, "max_per_call");
  if (cap === 0n) throw new Error("limit must be more than zero");
  if (maxPerCall === 0n) throw new Error("max_per_call must be more than zero");
  if (maxPerCall > cap) throw new Error(`max_per_call (${withUnit(maxPerCall)}) cannot exceed limit (${withUnit(cap)})`);
  const seconds = durationToSeconds(args.window);

  if (!(await chain.hasCode(factory))) throw new Error(`no TabFactory at ${factory} on ${chain.net.name}`);
  const { timestamp } = await chain.now();

  const tabId = newTabId();
  const agent = keys.create(tabId);
  if (payees.includes(agent)) throw new Error("unreachable: a fresh agent key collided with a payee");

  const tab: Tab = {
    tabId,
    network: chain.net.name,
    status: "requested",
    factory,
    agent,
    payees,
    cap: cap.toString(),
    maxPerCall: maxPerCall.toString(),
    expiry: timestamp + seconds,
    window: args.window,
    salt: toHex(randomBytes(32)),
    requestedAt: new Date().toISOString(),
  };
  store.putTab(tab);
  store.appendReceipt({ tabId, at: tab.requestedAt, kind: "request", amount: args.limit, asset: "USDC", note: `requested: cap ${withUnit(cap)}, at most ${withUnit(maxPerCall)} per call, ${payees.length} payee(s)` });

  return {
    tab_id: tabId,
    status: "requested, not open yet",
    network: chain.net.name,
    terms: {
      cap: withUnit(cap),
      max_per_call: withUnit(maxPerCall),
      payees,
      expiry: describeExpiry(tab.expiry, timestamp),
      agent,
    },
    next_step:
      `This server holds no key that can open or fund a tab. The owner opens it by running, in a terminal: ` +
      `${ownerCommand("open", tabId)}  It shows these terms, asks for confirmation, approves ${withUnit(cap)} to the ` +
      `factory and opens the tab. The expiry is fixed from now, so a tab opened late is a shorter tab. Then call tab_status.`,
  };
}

/** Picks up what the owner's CLI wrote back, and believes it only if the chain agrees. */
export async function syncTab(store: Store, chain: ArcChain, tab: Tab): Promise<{ tab: Tab; chain?: OnChainTab }> {
  const stored = store.getTab(tab.tabId) ?? tab;
  if (!stored.address || !stored.owner) return { tab: stored };

  const onChain = await chain.verifiedTab(stored);
  if (stored.status === "requested") {
    const opened: Tab = { ...stored, status: "open", openedAt: stored.openedAt ?? new Date().toISOString() };
    store.putTab(opened);
    store.appendReceipt({ tabId: opened.tabId, at: opened.openedAt!, kind: "open", amount: withUnit(BigInt(opened.cap)).split(" ")[0], asset: "USDC", tx: opened.openTx, to: opened.address });
    return { tab: opened, chain: onChain };
  }
  return { tab: stored, chain: onChain };
}

export async function tabStatus(store: Store, keys: AgentKeys, chain: ArcChain, tab: Tab) {
  const { tab: current, chain: onChain } = await syncTab(store, chain, tab);
  const receipts = store.receipts(current.tabId).map(reportReceipt);

  if (!onChain) {
    return {
      tab_id: current.tabId,
      status: "requested, not open yet",
      network: current.network,
      next_step: `The owner has not opened this tab. They run: ${ownerCommand("open", current.tabId)}`,
      requested_terms: { cap: withUnit(BigInt(current.cap)), max_per_call: withUnit(BigInt(current.maxPerCall)), payees: current.payees, agent: current.agent },
      receipts,
    };
  }

  const cap = BigInt(current.cap);
  const expired = onChain.now > onChain.expiry;
  const hasKey = keys.has(current.tabId);
  const spendable = !onChain.closed && !expired && hasKey && onChain.balance > 0n;

  return {
    tab_id: current.tabId,
    status: onChain.closed ? "closed on chain" : expired ? "expired" : current.status === "closed" ? "closed from this side; not yet closed on chain" : "open",
    can_spend: spendable,
    network: current.network,
    tab_address: onChain.address,
    explorer: explorerAddress(chain.net, onChain.address),
    read_at: { block: onChain.blockNumber.toString(), time: new Date(onChain.now * 1000).toISOString() },
    // The balance is the limit. There is no spent-so-far counter on chain to read.
    balance: withUnit(onChain.balance),
    cap: withUnit(cap),
    spent: onChain.balance <= cap ? withUnit(cap - onChain.balance) : undefined,
    note_on_balance:
      onChain.balance > cap
        ? `The balance is above the cap: someone sent USDC to the tab after it was opened. The agent can spend that too, under the same terms. The owner's exposure is still ${withUnit(cap)}.`
        : onChain.closed && onChain.balance > 0n
          ? `The tab is closed and still holds ${withUnit(onChain.balance)}: the sweep did not go through, or money arrived later. The owner collects it with: ${ownerCommand("close", current.tabId)}`
          : undefined,
    max_per_call: withUnit(onChain.maxPerCall),
    payees: onChain.payees,
    payees_note: "Enforced by the tab contract and fixed for its life: a transfer to any other address is refused.",
    expiry: describeExpiry(onChain.expiry, onChain.now),
    owner: onChain.owner,
    agent: onChain.agent,
    agent_key_here: hasKey,
    open_tx: current.openTx ? explorerTx(chain.net, current.openTx) : undefined,
    receipts,
  };
}

export async function requestClose(store: Store, keys: AgentKeys, chain: ArcChain, tab: Tab) {
  const destroyed = keys.destroy(tab.tabId);
  const closedAt = new Date().toISOString();
  const current = store.getTab(tab.tabId) ?? tab;
  store.putTab({ ...current, status: "closed", closedAt });
  store.appendReceipt({ tabId: tab.tabId, at: closedAt, kind: "close", note: destroyed ? "agent key destroyed; this server can no longer sign for the tab" : "no agent key was held here" });

  let onChain: OnChainTab | undefined;
  try {
    onChain = current.address ? await chain.verifiedTab(current) : undefined;
  } catch {
    onChain = undefined;
  }

  return {
    tab_id: tab.tabId,
    agent_key: destroyed ? "destroyed: this server can no longer sign a payment from this tab" : "none was held here",
    on_chain:
      !onChain
        ? "never opened on chain; nothing to sweep"
        : onChain.closed
          ? `already closed on chain; balance ${withUnit(onChain.balance)}`
          : `still open on chain with ${withUnit(onChain.balance)} in it`,
    next_step:
      onChain && (!onChain.closed || onChain.balance > 0n)
        ? `Closing the contract and returning the money takes the owner's key, which this server does not have. The owner runs: ${ownerCommand("close", tab.tabId)}`
        : undefined,
  };
}
