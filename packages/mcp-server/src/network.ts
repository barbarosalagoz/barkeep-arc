/*
 * Arc, as this package needs it: two networks, one USDC address, and where a
 * TabFactory lives on each. Nothing here holds or reads a key.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineChain, getAddress, type Address, type Chain } from "viem";

/** The ERC-20 view of native USDC. Same address on both networks; 6 decimals. */
export const USDC: Address = "0x3600000000000000000000000000000000000000";
/** USDC's EIP-712 domain, which Tab.sol hardcodes and x402 requirements carry in `extra`. */
export const USDC_DOMAIN = { name: "USDC", version: "2" } as const;

export type NetworkName = "arc-testnet" | "arc-mainnet";

export interface Network {
  name: NetworkName;
  chainId: number;
  /** x402's CAIP-2 identifier. */
  caip2: `eip155:${number}`;
  rpcUrl: string;
  explorer: string;
  chain: Chain;
}

const make = (name: NetworkName, chainId: number, rpcUrl: string, explorer: string): Network => ({
  name,
  chainId,
  caip2: `eip155:${chainId}`,
  rpcUrl,
  explorer,
  chain: defineChain({
    id: chainId,
    name: name === "arc-mainnet" ? "Arc" : "Arc Testnet",
    // As gas, USDC has 18 decimals. Amounts in this package are always the 6-decimal ERC-20 view.
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arc explorer", url: explorer } },
  }),
});

export function network(name: string = process.env.BARKEEP_ARC_NETWORK ?? "arc-testnet"): Network {
  switch (name) {
    case "arc-testnet":
      return make(name, 5042002, process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io", "https://explorer.testnet.arc.io");
    case "arc-mainnet":
      return make(name, 5042, process.env.ARC_MAINNET_RPC ?? "https://rpc.mainnet.arc.io", "https://explorer.arc.io");
    default:
      throw new Error(`unknown network "${name}"; use arc-testnet or arc-mainnet`);
  }
}

export const explorerTx = (net: Network, hash: string): string => `${net.explorer}/tx/${hash}`;
export const explorerAddress = (net: Network, address: string): string => `${net.explorer}/address/${address}`;

/* ---- deployments/<network>.json ----------------------------------------------- */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export const deploymentFile = (net: Network): string => join(REPO_ROOT, "deployments", `${net.name}.json`);

/** The TabFactory this server trusts on a network: BARKEEP_ARC_FACTORY, else the recorded deployment. */
export function factoryAddress(net: Network): Address {
  const explicit = process.env.BARKEEP_ARC_FACTORY;
  if (explicit) return getAddress(explicit);

  const file = deploymentFile(net);
  if (!existsSync(file)) throw new Error(`no TabFactory known on ${net.name}: ${file} does not exist and BARKEEP_ARC_FACTORY is not set`);

  const recorded = (JSON.parse(readFileSync(file, "utf8")) as { contracts?: { tabFactory?: { address?: string } } }).contracts?.tabFactory?.address;
  if (!recorded) throw new Error(`${file} records no contracts.tabFactory.address`);
  return getAddress(recorded);
}
