/*
 * Circle's Facilitator Service, from the seller's side, on its keyless trial.
 * Every call carries a Facilitator-Seller-Proof: an EIP-712 signature from the
 * key behind payTo over the purpose, the method and the hash of the exact body.
 * https://developers.circle.com/facilitator-service/sign-seller-proof
 *
 * Responses are returned verbatim (status and body) because the done-tests
 * record them.
 */

import { keccak256, toBytes, toHex, type LocalAccount } from "viem";

export const CIRCLE_FACILITATOR = "https://api.circle.com/v1/facilitator/x402";

const SELLER_REQUEST = {
  SellerRequest: [
    { name: "purpose", type: "string" }, { name: "method", type: "string" }, { name: "bodyHash", type: "bytes32" },
    { name: "network", type: "string" }, { name: "payTo", type: "address" }, { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface CircleAnswer {
  httpStatus: number;
  requestId?: string;
  body: Record<string, unknown>;
}

async function sellerProof(seller: LocalAccount, chainId: number, caip2: string, purpose: "verify" | "settle" | "status", method: string, body: string): Promise<string> {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 300;
  const signature = await seller.signTypedData({
    domain: { name: "Circle Facilitator Seller Request", version: "1", chainId },
    types: SELLER_REQUEST,
    primaryType: "SellerRequest",
    message: { purpose, method: method.toUpperCase(), bodyHash: keccak256(toBytes(body)), network: caip2, payTo: seller.address, nonce, issuedAt: BigInt(issuedAt), expiresAt: BigInt(expiresAt) },
  });
  return Buffer.from(JSON.stringify({ version: 1, signature, network: caip2, payTo: seller.address, nonce, issuedAt, expiresAt })).toString("base64url");
}

async function answer(response: Response): Promise<CircleAnswer> {
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = { raw };
  }
  return { httpStatus: response.status, requestId: response.headers.get("x-request-id") ?? undefined, body };
}

export function circleFacilitator(seller: LocalAccount, chainId: number, caip2: string) {
  const post = async (purpose: "verify" | "settle", paymentPayload: unknown, paymentRequirements: unknown): Promise<CircleAnswer> => {
    const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements });
    return answer(await fetch(`${CIRCLE_FACILITATOR}/${purpose}`, {
      method: "POST",
      headers: { "content-type": "application/json", "Facilitator-Seller-Proof": await sellerProof(seller, chainId, caip2, purpose, "POST", body) },
      body,
    }));
  };

  return {
    verify: (payload: unknown, requirements: unknown) => post("verify", payload, requirements),
    settle: (payload: unknown, requirements: unknown) => post("settle", payload, requirements),
    status: async (paymentId: string): Promise<CircleAnswer> =>
      answer(await fetch(`${CIRCLE_FACILITATOR}/status/${paymentId}`, { headers: { "Facilitator-Seller-Proof": await sellerProof(seller, chainId, caip2, "status", "GET", "") } })),
  };
}
