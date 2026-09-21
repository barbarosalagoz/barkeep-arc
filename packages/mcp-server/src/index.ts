#!/usr/bin/env node
/*
 * Barkeep on Arc -- an MCP server for Claude Code.
 *
 * A local stdio server exposing the tab: ask for one with a cap, a per-call
 * maximum, a list of payees and a time window; spend against it; read what is
 * left; shut it. The limits are enforced by the tab contract on Arc, not here.
 *
 * What this server CANNOT do is the point. The only keys it holds are per-tab
 * agent keys, each able to do one thing: make its own tab approve a USDC
 * transfer within that tab's terms. It has no key that can open, fund or close a
 * tab; those take the owner's key, used only by bin/barkeep-arc-owner, in a
 * terminal, after showing the human what they are signing. A compromised or
 * buggy build of this server can spend at most what the open tabs hold, to the
 * payees their owner listed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AgentKeys } from "./agentKeys.ts";
import { ArcChain } from "./chain.ts";
import { factoryAddress, network } from "./network.ts";
import { createPayer, type PayResult } from "./pay.ts";
import { Store, type Tab } from "./state.ts";
import { MAX_PAYEES, requestClose, requestOpen, syncTab, tabStatus } from "./tabs.ts";
import { createSigner } from "./x402Sign.ts";

/* Money tools force a decision on every call: allow-rules do not skip it and it still prompts under bypass-permissions. */
const REQUIRES_INTERACTION = { "anthropic/requiresUserInteraction": true } as const;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const failure = (error: unknown) => ({ isError: true, content: [{ type: "text" as const, text: String((error as Error)?.message ?? error) }] });

/** pay_and_fetch's result as the user reads it: what matters every time, plus what only matters when unusual. */
export function presentPayResult(result: PayResult): { summary: Record<string, unknown>; body: string } {
  const { body, replayed, http_status, body_truncated, ...rest } = result;
  const summary: Record<string, unknown> = { tab_id: rest.tab_id, url: rest.url, paid: rest.paid };
  if (replayed) {
    summary.replayed = true;
    summary.replay_note = "No new payment was made: this is the stored result of an earlier identical call (same tab, url, max_amount and request_id).";
  }
  if (http_status < 200 || http_status > 299) summary.http_status = http_status;
  if (body_truncated) summary.body_truncated = true;
  for (const key of ["amount", "pay_to", "tx", "explorer", "note"] as const) if (rest[key] !== undefined) summary[key] = rest[key];
  return { summary, body };
}

export function createServer(): McpServer {
  const store = new Store();
  const keys = new AgentKeys(store.dir);
  const net = network();
  const chain = new ArcChain(net);

  const payer = createPayer({ store, chain, fetch: globalThis.fetch, verify: (tab) => chain.verifiedTab(tab), sign: createSigner(net, keys) });

  const named = (tabId?: string): Tab => {
    const tab = tabId ? store.getTab(tabId) : store.currentTab();
    if (!tab) throw new Error(tabId ? `no tab ${tabId}` : "no tab yet; ask for one with open_tab");
    if (tab.network !== net.name) throw new Error(`${tab.tabId} is on ${tab.network}; this server is on ${net.name}`);
    return tab;
  };

  const server = new McpServer({ name: "barkeep-arc", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.registerTool(
    "open_tab",
    {
      title: "Ask for a tab",
      description:
        "Ask for a spending tab on Arc: a contract funded with exactly the cap, that lets this agent pay only the listed " +
        "payees, only up to max_per_call each time, only until the window ends. This makes the agent's key and records the " +
        "terms. It does NOT open the tab: this server has no key that can move the owner's money. The owner opens it by " +
        "running the command this returns, which shows them the terms and asks first. The terms can never change afterwards.",
      inputSchema: {
        limit: z.string().describe('The cap: how much USDC the tab is funded with, e.g. "5". The balance is the limit.'),
        max_per_call: z.string().describe('The most one payment may be, in USDC, e.g. "0.25". Enforced by the tab contract.'),
        window: z.string().describe('How long the tab lasts from now, as an ISO-8601 duration, e.g. "PT1H" or "P7D". It does not refill.'),
        payees: z.array(z.string()).describe(`EVM addresses (1 to ${MAX_PAYEES}) this tab may pay. Enforced by the tab contract; there is no allow-any option and the list is fixed for the tab's life.`),
      },
      _meta: REQUIRES_INTERACTION,
    },
    async (args) => {
      try {
        return text(await requestOpen(store, keys, chain, factoryAddress(net), args));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "pay_and_fetch",
    {
      title: "Pay for a URL from the tab",
      description:
        "Fetch a URL; if it answers 402 with an x402 v2 challenge payable in USDC on Arc, pay it from the tab and return the " +
        "response. Refuses, before signing anything, a price above max_amount or a payment the tab's on-chain terms forbid " +
        "(payee not listed, above the per-call maximum, expired, closed, not enough left); the tab contract enforces the same " +
        "rules. An identical call never pays twice. If the seller's answer leaves the outcome unknown, it asks the chain " +
        "whether the payment happened rather than paying again.",
      inputSchema: {
        url: z.string().url(),
        max_amount: z.string().describe('The most to pay for this one request, in USDC, e.g. "0.01"'),
        tab_id: z.string().optional().describe("Defaults to the newest tab that is not closed"),
        request_id: z.string().optional().describe("Pass a new value to deliberately pay the same URL again"),
      },
      _meta: REQUIRES_INTERACTION,
    },
    async (args) => {
      try {
        const { tab } = await syncTab(store, chain, named(args.tab_id));
        const { summary, body } = presentPayResult(await payer(tab, args));
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }, { type: "text" as const, text: body }] };
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "tab_status",
    {
      title: "Read the tab from the chain",
      description:
        "Read the tab from Arc: balance (which is what is left to spend), payees, per-call maximum, expiry, whether it is " +
        "closed, plus the bill so far including refusals. Reports a tab only if the factory vouches for its address and terms.",
      inputSchema: { tab_id: z.string().optional().describe("Defaults to the newest tab that is not closed") },
    },
    async (args) => {
      try {
        return text(await tabStatus(store, keys, chain, named(args.tab_id)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    "close_tab",
    {
      title: "Shut the agent's side of the tab",
      description:
        "Destroy the agent key for the tab, so this server can never sign another payment from it. Immediate and permanent. " +
        "It does NOT close the contract or return the money: that takes the owner's key. Returns the command the owner runs " +
        "to close the tab on chain and sweep what is left back to themselves.",
      inputSchema: { tab_id: z.string().optional().describe("Defaults to the newest tab that is not closed") },
      _meta: REQUIRES_INTERACTION,
    },
    async (args) => {
      try {
        return text(await requestClose(store, keys, chain, named(args.tab_id)));
      } catch (error) {
        return failure(error);
      }
    }
  );

  return server;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  await createServer().connect(new StdioServerTransport());
}
