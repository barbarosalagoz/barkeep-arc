/*
 * The only keys the MCP server ever holds: one agent key per tab.
 *
 * An agent key can do one thing, make its own tab approve a USDC transfer within
 * the tab's terms. It cannot open, fund or close anything. The owner key, which
 * can, lives elsewhere (keys.json, read only by bin/barkeep-arc-owner) and no
 * module the server imports may read it; boundary.test.ts enforces that.
 *
 * Files are <stateDir>/agents/<tabId>.json, mode 600, in a mode-700 directory.
 * Destroying a key is how the agent side of a tab is shut: once it is gone
 * nothing here can sign for that tab again, whatever the chain still allows.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Address, Hex, LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

interface StoredAgentKey {
  tabId: string;
  address: Address;
  privateKey: Hex;
  createdAt: string;
}

const TAB_ID = /^tab_[0-9a-f]{12}$/;

export class AgentKeys {
  private readonly dir: string;

  constructor(stateDir: string) {
    this.dir = join(stateDir, "agents");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
  }

  private file(tabId: string): string {
    if (!TAB_ID.test(tabId)) throw new Error(`not a tab id: ${tabId}`);
    return join(this.dir, `${tabId}.json`);
  }

  /** A fresh key for a new tab. Returns the address only; the key stays on disk. */
  create(tabId: string): Address {
    const file = this.file(tabId);
    if (existsSync(file)) throw new Error(`${tabId} already has an agent key`);

    const privateKey = generatePrivateKey();
    const record: StoredAgentKey = { tabId, address: privateKeyToAccount(privateKey).address, privateKey, createdAt: new Date().toISOString() };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return record.address;
  }

  has(tabId: string): boolean {
    return existsSync(this.file(tabId));
  }

  account(tabId: string): LocalAccount {
    const file = this.file(tabId);
    if (!existsSync(file)) throw new Error(`${tabId} has no agent key here: it was closed from this side, or opened on another machine`);
    return privateKeyToAccount((JSON.parse(readFileSync(file, "utf8")) as StoredAgentKey).privateKey);
  }

  /** Overwrites, then removes. After this the server cannot sign for the tab. */
  destroy(tabId: string): boolean {
    const file = this.file(tabId);
    if (!existsSync(file)) return false;
    writeFileSync(file, "0".repeat(512), { mode: 0o600 });
    rmSync(file);
    return true;
  }
}
