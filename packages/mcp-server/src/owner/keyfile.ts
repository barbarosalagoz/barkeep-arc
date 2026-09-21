/*
 * The owner's key. Read here and nowhere else.
 *
 * It lives in ~/.local/state/barkeep-arc/keys.json (mode 600), outside the
 * repository and outside the MCP server's state directory. Nothing under src/
 * except src/owner/ may import this module or name that file; boundary.test.ts
 * fails the build if something does. The separation is by process and by code,
 * not by the operating system: the MCP server runs as the same user and nothing
 * stops a rewritten server from opening the file. What is guaranteed is that the
 * server as written never does, and that the agent, which only talks to the
 * server, has no tool that reaches it.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Hex, LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { NetworkName } from "../network.ts";

const DEFAULT_KEY_NAME: Record<NetworkName, string> = {
  "arc-testnet": "testnetDeployer",
  // Deliberately absent from a fresh keys.json: a mainnet owner key is made when it is needed and holds only what it must.
  "arc-mainnet": "mainnetOwner",
};

export function ownerAccount(net: NetworkName): LocalAccount {
  const file = process.env.BARKEEP_ARC_KEYS_FILE ?? join(homedir(), ".local", "state", "barkeep-arc", "keys.json");
  const name = process.env.BARKEEP_ARC_OWNER_KEY_NAME ?? DEFAULT_KEY_NAME[net];

  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) throw new Error(`${file} is readable by others (mode ${mode.toString(8)}); run: chmod 600 ${file}`);

  const entry = (JSON.parse(readFileSync(file, "utf8")) as Record<string, { privateKey?: Hex }>)[name];
  if (!entry?.privateKey) throw new Error(`${file} has no key named "${name}" for ${net}`);
  return privateKeyToAccount(entry.privateKey);
}
