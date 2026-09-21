/*
 * Does Circle's Facilitator Service accept a keyless seller proof on Arc MAINNET?
 *
 *   npx tsx packages/mcp-server/scripts/probe-circle-mainnet.ts
 *
 * /verify only, with a throwaway payTo key made on the spot and a payment that
 * cannot be valid (a zero signature from the dead address). Nothing is settled,
 * no transaction is sent, no funds exist to move. The only thing it learns is
 * how Circle answers the AUTHENTICATION: 401 means keyless is not accepted on
 * mainnet, anything that talks about the payment means it is.
 */

import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { circleFacilitator } from "../src/demo/circle.ts";
import { USDC, USDC_DOMAIN } from "../src/network.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const circle = circleFacilitator(seller, 5042, "eip155:5042");

const requirements = { scheme: "exact", network: "eip155:5042", asset: USDC, amount: "1000", payTo: seller.address, maxTimeoutSeconds: 60, extra: { ...USDC_DOMAIN } };
const payload = {
  x402Version: 2,
  accepted: requirements,
  resource: { url: "https://example.invalid/probe", description: "keyless probe", mimeType: "text/plain" },
  payload: {
    signature: toHex(new Uint8Array(65)),
    authorization: { from: "0x000000000000000000000000000000000000dEaD", to: seller.address, value: "1000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 60), nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) },
  },
};

console.log(JSON.stringify({ network: "eip155:5042", auth: "keyless seller proof, throwaway payTo", verify: await circle.verify(payload, requirements) }, null, 2));
