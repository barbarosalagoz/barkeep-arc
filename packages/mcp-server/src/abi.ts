/* The parts of Tab, TabFactory and USDC this package calls. See contracts/src. */

import { parseAbi } from "viem";

export const TAB_ABI = parseAbi([
  "struct Terms { address owner; address agent; uint256 maxPerCall; uint64 expiry; address[] payees; }",
  "function terms() view returns (Terms)",
  "function closed() view returns (bool)",
  "function balance() view returns (uint256)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "function close()",
  "event Closed(address indexed owner, uint256 amount, bool swept)",
  "error NotATab()",
  "error NotOwner()",
]);

export const FACTORY_ABI = parseAbi([
  "function IMPLEMENTATION() view returns (address)",
  "function openTab(address agent, address[] payees, uint256 maxPerCall, uint64 expiry, uint256 cap, bytes32 salt) returns (address tab)",
  "function predictTab(address owner, address agent, address[] payees, uint256 maxPerCall, uint64 expiry, bytes32 salt) view returns (address)",
  "event TabOpened(address indexed tab, address indexed owner, address indexed agent, uint256 cap, uint256 maxPerCall, uint64 expiry, address[] payees)",
  "error ZeroAgent()",
  "error ZeroPayee()",
  "error BadPayeeCount()",
  "error ZeroCap()",
  "error ZeroMaxPerCall()",
  "error MaxPerCallAboveCap()",
  "error ExpiryNotInFuture()",
  "error FundingFailed()",
]);

export const USDC_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
