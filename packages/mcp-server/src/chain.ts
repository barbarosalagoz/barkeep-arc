/*
 * The Arc adapter: everything the server reads from the chain, and nothing that
 * writes to it. The server has no key that could send a transaction; opening and
 * closing are the owner's (owner.ts).
 */

import { createPublicClient, getAddress, http, isAddressEqual, type Address, type Hex, type PublicClient } from "viem";

import { FACTORY_ABI, TAB_ABI, USDC_ABI } from "./abi.ts";
import { USDC, type Network } from "./network.ts";
import type { Tab } from "./state.ts";

export interface OnChainTab {
  address: Address;
  owner: Address;
  agent: Address;
  maxPerCall: bigint;
  expiry: number;
  payees: Address[];
  closed: boolean;
  /** USDC, 6 decimals. Can exceed the cap: anyone may send USDC to a tab. */
  balance: bigint;
  /** Timestamp of the block these were read at: the chain's clock, not this machine's. */
  now: number;
  blockNumber: bigint;
}

export class ArcChain {
  readonly net: Network;
  readonly client: PublicClient;

  constructor(net: Network, client?: PublicClient) {
    this.net = net;
    this.client = client ?? createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
  }

  async hasCode(address: Address): Promise<boolean> {
    const code = await this.client.getCode({ address });
    return code !== undefined && code !== "0x";
  }

  predictTab(factory: Address, owner: Address, tab: Pick<Tab, "agent" | "payees" | "maxPerCall" | "expiry" | "salt">): Promise<Address> {
    return this.client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "predictTab",
      args: [owner, tab.agent, tab.payees, BigInt(tab.maxPerCall), BigInt(tab.expiry), tab.salt],
    });
  }

  /** One consistent read of a tab: its terms, whether it is closed, its balance, and the block's time. */
  async readTab(address: Address): Promise<OnChainTab> {
    const block = await this.client.getBlock();
    const at = { blockNumber: block.number };
    const [terms, closed, balance] = await Promise.all([
      this.client.readContract({ address, abi: TAB_ABI, functionName: "terms", ...at }),
      this.client.readContract({ address, abi: TAB_ABI, functionName: "closed", ...at }),
      this.client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [address], ...at }),
    ]);

    return {
      address,
      owner: terms.owner,
      agent: terms.agent,
      maxPerCall: terms.maxPerCall,
      expiry: Number(terms.expiry),
      payees: [...terms.payees],
      closed,
      balance,
      now: Number(block.timestamp),
      blockNumber: block.number,
    };
  }

  /**
   * Reads a tab and refuses to return it unless it is the tab this server asked
   * for: deployed by the trusted factory (its address is what the factory
   * predicts for these terms and this owner) and carrying exactly the agent,
   * payees, maximum and expiry that were requested. The request file the owner's
   * CLI writes back into is not trusted; this is.
   */
  async verifiedTab(tab: Tab): Promise<OnChainTab> {
    if (!tab.address || !tab.owner) throw new Error(`${tab.tabId} has not been opened yet`);
    if (!(await this.hasCode(tab.address))) throw new Error(`${tab.tabId}: nothing is deployed at ${tab.address} on ${this.net.name}`);

    const predicted = await this.predictTab(tab.factory, tab.owner, tab);
    if (!isAddressEqual(predicted, tab.address)) {
      throw new Error(`${tab.tabId}: ${tab.address} is not what factory ${tab.factory} predicts for these terms (${predicted}). Not trusting it.`);
    }

    const chain = await this.readTab(tab.address);
    const sameList = chain.payees.length === tab.payees.length && chain.payees.every((p, i) => isAddressEqual(p, tab.payees[i]));
    if (
      !isAddressEqual(chain.owner, tab.owner) ||
      !isAddressEqual(chain.agent, tab.agent) ||
      chain.maxPerCall !== BigInt(tab.maxPerCall) ||
      chain.expiry !== tab.expiry ||
      !sameList
    ) {
      throw new Error(`${tab.tabId}: the terms at ${tab.address} are not the terms this server asked for. Not trusting it.`);
    }
    return chain;
  }

  /** Has USDC consumed this EIP-3009 authorization? True means the transfer happened (USDC has no other way to mark it for a tab). */
  authorizationUsed(tab: Address, nonce: Hex): Promise<boolean> {
    return this.client.readContract({ address: USDC, abi: USDC_ABI, functionName: "authorizationState", args: [tab, nonce] });
  }

  /** The transaction that moved `value` from the tab to `to`, searched from `fromBlock`. */
  async findTransfer(tab: Address, to: Address, value: bigint, fromBlock: bigint): Promise<Hex | undefined> {
    const logs = await this.client.getContractEvents({
      address: USDC,
      abi: USDC_ABI,
      eventName: "Transfer",
      args: { from: tab, to: getAddress(to) },
      fromBlock,
      toBlock: "latest",
    });
    return logs.find((l) => l.args.value === value)?.transactionHash ?? undefined;
  }

  /**
   * Asks the chain what it would say to this exact transfer, without sending it. Returns the revert reason
   * ("FiatTokenV2: invalid signature" when the tab said no), or null if it would go through.
   */
  async simulateTransfer(auth: { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }, signature: Hex): Promise<string | null> {
    try {
      await this.client.simulateContract({
        address: USDC,
        abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, signature],
      });
      return null;
    } catch (error) {
      const e = error as { cause?: { reason?: string; shortMessage?: string }; shortMessage?: string; message: string };
      return e.cause?.reason ?? e.cause?.shortMessage ?? e.shortMessage ?? e.message;
    }
  }

  async now(): Promise<{ timestamp: number; blockNumber: bigint }> {
    const block = await this.client.getBlock();
    return { timestamp: Number(block.timestamp), blockNumber: block.number };
  }
}
