/*
 * What the page shows. Addresses only: there is no key here and nothing on this
 * page can write to a chain.
 *
 * A tab's openBlock tells the page where to start looking for its payments.
 * Arc's public RPC answers a log query for fewer than 10,000 blocks at a time,
 * about eighty minutes of chain, so the page scans in chunks from there.
 */

export type Hex = `0x${string}`;

export interface TabConfig {
  label: string;
  address: Hex;
  openBlock: number;
  /** Set once the owner has closed the tab: nothing moves after it, so the scan stops there. */
  closeBlock?: number;
}

export interface NetworkConfig {
  key: "arc-testnet" | "arc-mainnet";
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  /** null until a TabFactory is deployed there. */
  factory: Hex | null;
  tabs: TabConfig[];
}

/** The ERC-20 view of native USDC. Same address on both networks; 6 decimals. */
export const USDC: Hex = "0x3600000000000000000000000000000000000000";

export const NETWORKS: NetworkConfig[] = [
  {
    key: "arc-testnet",
    name: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    factory: "0xd7c3e0106ba18e73fc195088e453a370ef9ba9ed",
    tabs: [
      { label: "Demo tab (open)", address: "0xc96f926A148F77da3828c051aE0ddE0fC667aD27", openBlock: 63250660 },
      { label: "Done-tests tab (closed by its owner)", address: "0x95C704A54729170edc28fd7E2927627CDe1fd020", openBlock: 63223816, closeBlock: 63225029 },
      { label: "Expiry test tab (expired, then closed)", address: "0xD6e319557C583f350182766FF5862817D9f636C1", openBlock: 63225052, closeBlock: 63225270 },
    ],
  },
  {
    key: "arc-mainnet",
    name: "Arc",
    chainId: 5042,
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    // Nothing is deployed on mainnet yet.
    factory: null,
    tabs: [],
  },
];

export const networkByKey = (key: string | null): NetworkConfig => NETWORKS.find((n) => n.key === key) ?? NETWORKS[0];
