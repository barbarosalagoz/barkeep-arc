import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256, recoverAddress, size, slice, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { USDC, USDC_DOMAIN } from "../src/network.ts";
import { TAB_SIGNATURE_BYTES, packTabSignature, tabSigner } from "../src/signature.ts";
import { NET, OUTSIDER, PAYEE, TAB_ADDRESS } from "./helpers.ts";

const agent = privateKeyToAccount(generatePrivateKey());

const typed = (from = TAB_ADDRESS, primaryType = "TransferWithAuthorization") => ({
  domain: { ...USDC_DOMAIN, chainId: NET.chainId, verifyingContract: USDC },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType,
  message: { from, to: PAYEE, value: "1000", validAfter: "0", validBefore: "1800003600", nonce: toHex(7, { size: 32 }) },
});

describe("the 213 bytes Tab.isValidSignature reads", () => {
  it("is laid out exactly as contracts/src/Tab.sol slices it", async () => {
    const signature = await tabSigner(TAB_ADDRESS, agent).signTypedData(typed());
    expect(size(signature)).toBe(TAB_SIGNATURE_BYTES);

    expect(slice(signature, 65, 85).toLowerCase()).toBe(PAYEE.toLowerCase()); // to
    expect(BigInt(slice(signature, 85, 117))).toBe(1000n); // value
    expect(BigInt(slice(signature, 117, 149))).toBe(0n); // validAfter
    expect(BigInt(slice(signature, 149, 181))).toBe(1_800_003_600n); // validBefore
    expect(slice(signature, 181, 213)).toBe(toHex(7, { size: 32 })); // nonce
  });

  it("carries the agent's signature over the digest the tab rebuilds", async () => {
    const signature = await tabSigner(TAB_ADDRESS, agent).signTypedData(typed());

    // The digest as Tab._transferDigest builds it, by hand rather than through viem's typed-data code.
    const domainSeparator = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toHex("USDC")), keccak256(toHex("2")), BigInt(NET.chainId), USDC]
    ));
    const structHash = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [keccak256(toHex("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")), TAB_ADDRESS, PAYEE, 1000n, 0n, 1_800_003_600n, toHex(7, { size: 32 })]
    ));
    const digest = keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex);

    expect(digest).toBe(hashTypedData(typed() as never));
    expect(await recoverAddress({ hash: digest, signature: slice(signature, 0, 65) })).toBe(agent.address);
  });

  it("signs nothing but a TransferWithAuthorization from its own tab", async () => {
    const signer = tabSigner(TAB_ADDRESS, agent);
    await expect(signer.signTypedData(typed(TAB_ADDRESS, "Permit"))).rejects.toThrow(/TransferWithAuthorization only/);
    await expect(signer.signTypedData(typed(OUTSIDER))).rejects.toThrow(/signs for .* only/);
  });

  it("refuses to pack a malformed signature or nonce", () => {
    const auth = { to: PAYEE, value: 1n, validAfter: 0n, validBefore: 1n, nonce: toHex(1, { size: 32 }) };
    expect(() => packTabSignature("0x1234", auth)).toThrow(/65-byte/);
    expect(() => packTabSignature(toHex(1, { size: 65 }), { ...auth, nonce: "0x01" })).toThrow(/32-byte/);
  });
});
