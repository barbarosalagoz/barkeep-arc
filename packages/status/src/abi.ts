/* The read-only parts of Tab, TabFactory and USDC. Copied, not imported: this package imports nothing from the server. */

import { parseAbi } from "viem";

export const TAB_ABI = parseAbi([
  "struct Terms { address owner; address agent; uint256 maxPerCall; uint64 expiry; address[] payees; }",
  "function terms() view returns (Terms)",
  "function closed() view returns (bool)",
]);

export const FACTORY_ABI = parseAbi([
  "function IMPLEMENTATION() view returns (address)",
  "event TabOpened(address indexed tab, address indexed owner, address indexed agent, uint256 cap, uint256 maxPerCall, uint64 expiry, address[] payees)",
]);

export const USDC_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
