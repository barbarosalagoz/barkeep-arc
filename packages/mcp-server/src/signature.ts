/*
 * The 213 bytes Tab.isValidSignature expects, and the x402 signer that produces
 * them.
 *
 *   [0:65]     the agent's ECDSA signature (r, s, v) over USDC's EIP-712 digest
 *   [65:85]    to
 *   [85:117]   value
 *   [117:149]  validAfter
 *   [149:181]  validBefore
 *   [181:213]  nonce
 *
 * ERC-1271 hands the tab only a hash. The fields ride along so the tab can
 * rebuild that hash and know what it is approving. The layout is fixed by
 * contracts/src/Tab.sol; signature.test.ts pins it, and the integration test
 * proves it against the deployed contract and real USDC.
 */

import type { ClientEvmSigner } from "@x402/evm";
import { encodePacked, getAddress, size, type Address, type Hex, type LocalAccount } from "viem";

export const TAB_SIGNATURE_BYTES = 213;

export interface TransferAuthorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export function packTabSignature(ecdsa: Hex, auth: Omit<TransferAuthorization, "from">): Hex {
  if (size(ecdsa) !== 65) throw new Error(`expected a 65-byte ECDSA signature, got ${size(ecdsa)} bytes`);
  if (size(auth.nonce) !== 32) throw new Error(`expected a 32-byte nonce, got ${size(auth.nonce)} bytes`);

  return encodePacked(
    ["bytes", "address", "uint256", "uint256", "uint256", "bytes32"],
    [ecdsa, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce]
  );
}

/**
 * A signer for the stock x402 EVM client whose address is the TAB, so the tab is
 * `from` in the authorization, and whose signatures are the agent's, packed the
 * way the tab reads them. It signs exactly one kind of message and refuses any
 * other, whatever the client asks for.
 */
export function tabSigner(tab: Address, agent: LocalAccount, onSigned?: (auth: TransferAuthorization) => void): ClientEvmSigner {
  return {
    address: tab,
    async signTypedData(typed) {
      if (typed.primaryType !== "TransferWithAuthorization") {
        throw new Error(`the tab's agent key signs TransferWithAuthorization only, not ${typed.primaryType}`);
      }

      const m = typed.message as Record<string, unknown>;
      const auth: TransferAuthorization = {
        from: getAddress(String(m.from)),
        to: getAddress(String(m.to)),
        value: BigInt(m.value as string | bigint),
        validAfter: BigInt(m.validAfter as string | bigint),
        validBefore: BigInt(m.validBefore as string | bigint),
        nonce: m.nonce as Hex,
      };
      if (auth.from !== getAddress(tab)) throw new Error(`refusing to sign a transfer from ${auth.from}: this key signs for ${tab} only`);

      const ecdsa = await agent.signTypedData(typed as Parameters<LocalAccount["signTypedData"]>[0]);
      onSigned?.(auth);
      return packTabSignature(ecdsa, auth);
    },
  };
}
