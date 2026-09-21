#!/usr/bin/env node
/*
 * barkeep-arc-owner: the only program that uses the owner's key.
 *
 *   barkeep-arc-owner whoami                 the owner address and its USDC
 *   barkeep-arc-owner list                   tabs waiting to be opened, and open ones
 *   barkeep-arc-owner open <tab_id> [--yes]  show the terms, ask, approve the cap, open the tab
 *   barkeep-arc-owner close <tab_id> [--yes] close the tab on chain and sweep what is left back
 *   barkeep-arc-owner deploy-factory [--yes] deploy a TabFactory and record it in deployments/<network>.json
 *
 * Run it yourself, in a terminal. It is not an MCP tool and the agent cannot call it.
 * Network: BARKEEP_ARC_NETWORK (arc-testnet by default). Keys: see src/owner/keyfile.ts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, http, type Hex } from "viem";

import { USDC_ABI } from "../abi.ts";
import { USDC, explorerTx, network } from "../network.ts";
import { Store } from "../state.ts";
import { describeExpiry, fromBaseUnits, withUnit } from "../units.ts";
import { closeTab, deployFactory, describeRequest, openTab } from "./actions.ts";
import { ownerAccount } from "./keyfile.ts";

const [verb, ...rest] = process.argv.slice(2);
const yes = rest.includes("--yes");
const arg = rest.find((a) => !a.startsWith("--"));

async function confirmed(question: string): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("refusing to sign without a terminal to confirm in; pass --yes to skip the question");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`${question} Type "yes" to sign: `);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

const net = network();
const store = new Store();
const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
const fee = (gasUsed: bigint, price: bigint) => `${Number(gasUsed * price) / 1e18} USDC in gas`;

switch (verb) {
  case "list": {
    for (const t of store.listTabs().filter((t) => t.network === net.name)) {
      console.log(`${t.tabId}  ${t.status.padEnd(9)}  cap ${withUnit(BigInt(t.cap))}  ${t.address ?? "(not opened)"}`);
    }
    break;
  }

  case "whoami": {
    const owner = ownerAccount(net.name).address;
    const balance = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [owner] });
    console.log(`${owner} on ${net.name}: ${withUnit(balance)}`);
    break;
  }

  case "open": {
    if (!arg) throw new Error("usage: barkeep-arc-owner open <tab_id>");
    const tab = store.getTab(arg);
    if (!tab) throw new Error(`no tab ${arg} in ${store.dir}`);
    const account = ownerAccount(net.name);
    const block = await client.getBlock();
    console.error(describeRequest(tab, account.address, Number(block.timestamp)));
    if (!(await confirmed(`\nThis sends ${withUnit(BigInt(tab.cap))} from ${account.address} into a new tab.`))) process.exit(1);

    const wallet = createWalletClient({ account, chain: net.chain, transport: http(net.rpcUrl) });
    const result = await openTab(net, wallet, client, store, arg);
    console.log(JSON.stringify({ tab_id: arg, tab: result.tab, funded: withUnit(result.balance), approve_tx: result.approveTx && explorerTx(net, result.approveTx), open_tx: explorerTx(net, result.openTx), cost: fee(result.gasUsed, result.effectiveGasPrice) }, null, 2));
    break;
  }

  case "close": {
    if (!arg) throw new Error("usage: barkeep-arc-owner close <tab_id>");
    const tab = store.getTab(arg);
    if (!tab?.address) throw new Error(`${arg} was never opened on chain`);
    const account = ownerAccount(net.name);
    const block = await client.getBlock();
    console.error(`Close ${arg} at ${tab.address} (${describeExpiry(tab.expiry, Number(block.timestamp))}). Permanent: the agent key stops working and the balance returns to ${account.address}.`);
    if (!(await confirmed(""))) process.exit(1);

    const wallet = createWalletClient({ account, chain: net.chain, transport: http(net.rpcUrl) });
    const result = await closeTab(net, wallet, client, store, arg);
    console.log(JSON.stringify({ tab_id: arg, close_tx: explorerTx(net, result.closeTx), swept: result.swept, returned: `${fromBaseUnits(result.swept ? result.amount : 0n)} USDC`, left_in_tab: withUnit(result.balanceAfter), note: result.swept ? undefined : "The tab is closed but USDC refused the transfer; run close again later to collect." }, null, 2));
    break;
  }

  case "deploy-factory": {
    const account = ownerAccount(net.name);
    const out = join(dirname(fileURLToPath(import.meta.url)), "../../../../contracts/out/TabFactory.sol/TabFactory.json");
    const built = JSON.parse(readFileSync(out, "utf8")) as { abi: unknown; bytecode: { object: Hex } };
    if (!(await confirmed(`Deploy a TabFactory to ${net.name} from ${account.address}, built from ${out}.`))) process.exit(1);

    const wallet = createWalletClient({ account, chain: net.chain, transport: http(net.rpcUrl) });
    const result = await deployFactory(net, wallet, client, { abi: built.abi, bytecode: built.bytecode.object });
    console.log(JSON.stringify({ factory: result.address, implementation: result.implementation, deploy_tx: explorerTx(net, result.deployTx), cost: fee(result.gasUsed, result.effectiveGasPrice) }, null, 2));
    break;
  }

  default:
    console.error("usage: barkeep-arc-owner whoami | list | open <tab_id> | close <tab_id> | deploy-factory   [--yes]");
    process.exit(2);
}
