/*
 * What the server remembers: the tabs it asked for, the bill, and one record per
 * pay_and_fetch request. Same shapes and the same files as Barkeep on Stellar
 * (tabs.json, receipts.jsonl, payments.json), adapted to a tab that is a
 * contract address rather than a context rule.
 *
 * None of it is authoritative. tab_status re-reads the chain, and a tab's terms
 * are only trusted after chain.ts has checked them against the factory.
 * No key material is ever written here; state.test.ts scans for it.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Address, Hex } from "viem";

import type { NetworkName } from "./network.ts";

export interface Tab {
  tabId: string;
  network: NetworkName;
  /**
   * requested  open_tab made an agent key and wrote the request; the owner has not opened it yet
   * open       the owner's CLI opened and funded it, and the chain agrees
   * closed     close_tab destroyed the agent key here; the owner may still have to sweep
   */
  status: "requested" | "open" | "closed";
  factory: Address;
  /** Address of the agent key made for this tab. Never the key. */
  agent: Address;
  payees: Address[];
  /** Base units (6 decimals), decimal strings. */
  cap: string;
  maxPerCall: string;
  /** Unix seconds. */
  expiry: number;
  /** The window as asked for, ISO-8601. */
  window: string;
  salt: Hex;
  requestedAt: string;
  /** Set once the owner has opened it. */
  owner?: Address;
  address?: Address;
  openTx?: string;
  openedAt?: string;
  closedAt?: string;
  closeTx?: string;
}

export interface Receipt {
  tabId: string;
  at: string;
  /**
   * payment      settled; `tx` is the transfer
   * refused      a payment was attempted and did not happen; `reason` and `refusedBy` say why and who stopped it
   * unconfirmed  a payment signature went out and no settlement has been seen yet
   */
  kind: "request" | "open" | "close" | "payment" | "refused" | "unconfirmed";
  /** Decimal USDC. On refused/unconfirmed, the price that was asked. */
  amount?: string;
  asset?: string;
  to?: string;
  tx?: string;
  endpoint?: string;
  reason?: string;
  /**
   * tab terms             this server checked the tab's on-chain terms before signing and they forbid it
   * on chain              the tab contract or USDC refused; `reason` carries the revert reason
   * seller's facilitator  the facilitator's verify refused; `reason` is its invalidReason
   */
  refusedBy?: "tab terms" | "on chain" | "per-call cap" | "seller's facilitator" | "payment terms" | "signing";
  note?: string;
}

/**
 * One pay_and_fetch request, keyed for idempotency.
 *
 *   pending     the payment signature is about to be, or has been, sent
 *   settled     the transfer is on chain
 *   refused     refused before any money could move, or the authorization expired unused; safe to try again
 *   unconfirmed a signature went out and the chain does not show the transfer yet; NOT paid again while the
 *               authorization can still be used
 */
export interface PaymentRecord {
  key: string;
  tabId: string;
  url: string;
  maxAmount: string;
  requestId: string | null;
  status: "pending" | "settled" | "refused" | "unconfirmed";
  startedAt: string;
  updatedAt: string;
  amount?: string;
  payTo?: string;
  /** The EIP-3009 authorization that was signed: what the chain is asked about afterwards. */
  nonce?: Hex;
  validBefore?: number;
  /** The exact PAYMENT-SIGNATURE header sent, so a recovery re-sends it and never signs again. */
  paymentHeader?: string;
  tx?: string;
  httpStatus?: number;
  body?: string;
  bodyTruncated?: boolean;
  error?: string;
}

export function stateDir(): string {
  const explicit = process.env.BARKEEP_ARC_STATE_DIR;
  if (explicit) return explicit;

  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) return join(pluginData, "barkeep-arc");

  const xdg = process.env.XDG_STATE_HOME;
  return join(xdg ?? join(homedir(), ".local", "state"), "barkeep-arc", "mcp");
}

export class Store {
  readonly dir: string;
  private readonly tabsFile: string;
  private readonly receiptsFile: string;
  private readonly paymentsFile: string;

  constructor(dir: string = stateDir()) {
    this.dir = dir;
    this.tabsFile = join(dir, "tabs.json");
    this.receiptsFile = join(dir, "receipts.jsonl");
    this.paymentsFile = join(dir, "payments.json");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  listTabs(): Tab[] {
    try {
      return JSON.parse(readFileSync(this.tabsFile, "utf8")) as Tab[];
    } catch {
      return [];
    }
  }

  getTab(tabId: string): Tab | undefined {
    return this.listTabs().find((t) => t.tabId === tabId);
  }

  /** The tab a tool means when the caller does not name one: the newest that is not closed. */
  currentTab(): Tab | undefined {
    const live = this.listTabs().filter((t) => t.status !== "closed");
    return live[live.length - 1];
  }

  putTab(tab: Tab): void {
    const tabs = this.listTabs().filter((t) => t.tabId !== tab.tabId);
    tabs.push(tab);
    writeFileSync(this.tabsFile, `${JSON.stringify(tabs, null, 2)}\n`, { mode: 0o600 });
  }

  /** Append-only: the receipt log is the record, never rewritten in place. */
  appendReceipt(receipt: Receipt): void {
    appendFileSync(this.receiptsFile, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  }

  receipts(tabId?: string): Receipt[] {
    let lines: string[];
    try {
      lines = readFileSync(this.receiptsFile, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
    const all = lines.map((l) => JSON.parse(l) as Receipt);
    return tabId ? all.filter((r) => r.tabId === tabId) : all;
  }

  private payments(): Record<string, PaymentRecord> {
    try {
      return JSON.parse(readFileSync(this.paymentsFile, "utf8")) as Record<string, PaymentRecord>;
    } catch {
      return {};
    }
  }

  getPayment(key: string): PaymentRecord | undefined {
    return this.payments()[key];
  }

  putPayment(record: PaymentRecord): void {
    const all = this.payments();
    all[record.key] = record;
    writeFileSync(this.paymentsFile, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  }
}

/** Everything the store has written, as text. The no-secrets test scans this. */
export function storedText(dir: string): string {
  const read = (f: string) => {
    try {
      return readFileSync(join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  return `${read("tabs.json")}\n${read("receipts.jsonl")}\n${read("payments.json")}`;
}

export function reportReceipt(r: Receipt): Record<string, unknown> {
  const out: Record<string, unknown> = { at: r.at, kind: r.kind };
  if (r.amount !== undefined) out.amount = `${r.amount} ${r.asset ?? "USDC"}`;
  if (r.endpoint !== undefined) out.endpoint = r.endpoint;
  if (r.to !== undefined) out.to = r.to;
  if (r.tx !== undefined) out.tx = r.tx;
  if (r.refusedBy !== undefined) out.refused_by = r.refusedBy;
  if (r.reason !== undefined) out.reason = r.reason;
  if (r.note !== undefined) out.note = r.note;
  return out;
}
