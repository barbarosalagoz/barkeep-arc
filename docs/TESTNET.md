<!-- Draft written by Claude for the author's review. -->

# Testnet done-tests

Run on Arc Testnet on 2026-09-21 by `packages/mcp-server/scripts/done-tests-testnet.ts`, which drives the same functions the four MCP tools call, a demo seller in the same process, and Circle's Facilitator Service on its keyless trial. Every hash below was read back from the chain before it was written to [`deployments/arc-testnet.json`](../deployments/arc-testnet.json), which holds the full record: Circle's verbatim answers, the revert reasons, the bill.

TabFactory: `0xd7c3e0106ba18e73fc195088e453a370ef9ba9ed`, deployed in [`0x7f6dda25…5bf420`](https://explorer.testnet.arc.io/tx/0x7f6dda25cdc97b649a7eb3eba2f51a19c954c8fb35778f534bf002d6a15bf420). Tab used for A1 to A3 and A5 to A8: `0x95C704A54729170edc28fd7E2927627CDe1fd020`.

| | What | Result |
|---|---|---|
| A1 | Open a tab, fund it, the agent pays an allowlisted payee, `tab_status` shows the balance drop | open [`0x11f9232d…701c81`](https://explorer.testnet.arc.io/tx/0x11f9232d1dcd73fa0bd9eb80ec3efaabac2364a02146b572c2e04e4d53701c81), payment [`0x872ccb3f…246f1a`](https://explorer.testnet.arc.io/tx/0x872ccb3fbc9c61d5c40d256eca9c29803caa726eb3d1eed5508bd45011246f1a); balance 0.5 USDC to 0.45 USDC |
| A2 | Above `maxPerCall` | refused before signing; Circle's verify: `invalid_exact_evm_payload_signature`; the tab answers `0xffffffff`; submitted anyway, reverted with `FiatTokenV2: invalid signature`: [`0xf8868aa6…4bbb1e`](https://explorer.testnet.arc.io/tx/0xf8868aa6f0e1fa8c0119cfdcb8d7d9bbc4133a1d9113bd28306c40cbfa4bbb1e) |
| A3 | A payee not on the list | refused before signing; Circle's verify: `invalid_exact_evm_payload_signature`; the tab answers `0xffffffff`; submitted anyway, reverted with `FiatTokenV2: invalid signature`: [`0x70ad1332…1d7ab0`](https://explorer.testnet.arc.io/tx/0x70ad133285fc0165688417f36d2b3849d0896b349b9cd74f2902fef7471d7ab0) |
| A4 | After expiry | refused before signing; a signature the tab accepted while open (`0x1626ba7e`) gets `0xffffffff` afterwards; submitted anyway, reverted with `FiatTokenV2: authorization is expired`: [`0xfe5f00b2…03421c`](https://explorer.testnet.arc.io/tx/0xfe5f00b24b5da3edac9aef6063030fd8ecfb0b7baf23c67a053737fcfa03421c); the owner still got the money back: [`0xea350793…1483b6`](https://explorer.testnet.arc.io/tx/0xea350793cc77cd84977eeb533a7101837fd4eb0fa273aad7e01afe9b631483b6) |
| A5 | Owner closes; agent tries again | `close_tab` destroyed the agent key; owner's close [`0x9abd1ce7…606164`](https://explorer.testnet.arc.io/tx/0x9abd1ce72afc33bb771687e172597e96aafdf7eb7119f47618dfc9b85d606164) swept 0.248016 USDC; a payment signed while the key still existed reverted with `FiatTokenV2: invalid signature`: [`0xc9100471…54d99f`](https://explorer.testnet.arc.io/tx/0xc9100471d2175a65fdce1e0b1af0ddb9af7a95590d064efb39b7fd916654d99f); balance 0 USDC |
| A6 | Outcome unknown | buyer side proven, seller side not: see below |
| A7 | The 213-byte signature through Circle's Facilitator Service | verify `isValid: true`, settle `success: true`, [`0x872ccb3f…246f1a`](https://explorer.testnet.arc.io/tx/0x872ccb3fbc9c61d5c40d256eca9c29803caa726eb3d1eed5508bd45011246f1a); the call data on chain carries 213 signature bytes; sent by Circle's relayer `0x06159ffeeecb472c0b085824dc7fcc343cbc7bfe` |
| A8 | Local clock skewed by 180 s either way | the signer names the skew and its direction and signs nothing; no transaction, by design |

A refusal is not only simulated. The refused transfer is submitted with a fixed gas limit, so the revert is in a block and has a hash.

## A6: what was proven and what was not

The buyer's side is proven on Testnet. The seller settled a payment through Circle for real, then told the buyer `settlement_pending`, as if the answer had been lost. `pay_and_fetch` asked USDC whether the authorization's nonce had been used, found that it had, located the transfer ([`0xab1179b5…99801e`](https://explorer.testnet.arc.io/tx/0xab1179b52b10494fb741f348d4d7707d39937afb2f0b023ee5d74b1d7a99801e)), collected the resource by sending the same signature again, and charged the tab once (0.05 USDC). An identical call afterwards replayed the stored result and signed nothing.

The seller's side is not, and has never been: the demo seller's `/status` pending branch has not once run against a real `settlement_pending` from Circle in this repository (0 of 179 settlements). The done-test as written asks for a `settlement_pending` recovered through the facilitator's `/status`. A real pending answer cannot be summoned. The run made 152 settlements through Circle looking for one, after 27 in an earlier run, and Circle answered every one of them with a final result. The demo seller's `/status` polling (`src/demo/seller.ts`) therefore never ran against Circle in this repository. The only time I have seen a real pending answer is the spike, once in 180 settlements: payment `72ef4b26-4f82-405a-a01b-bcc5f3964fc7`, which `/status` later reported completed as `0x503e92a74c7c056704c9f8e4cb1b530f2496c5c0a772739599cbf188cf3f62b5`.

`/status` is also the seller's to call, not the buyer's: it needs a proof signed by the `payTo` key. That is why the buyer asks the chain.

That branch does have a unit test, `packages/mcp-server/test/seller.test.ts`. Its fixture is real: Circle's `settlement_pending` answer and the `/status` answer that later reported the same payment completed, both recorded on Testnet during the spike. `test/fixtures/circle-settlement-pending.recorded.json` holds them with their provenance. The source is [the spike's record in the Stellar repository, at commit `34bbf0b`](https://github.com/barbarosalagoz/barkeep/blob/34bbf0bc10ae0be40977955d2082db1391118019/deployments/arc-testnet.json#L1247), lines 1247 and 1265. One limit on that: the recording kept the HTTP status and the JSON body but not the response headers. Tests named "recorded" use those bodies unchanged. Tests named "simulated" cover answers Circle never gave me (`/status` still pending, `/status` failed, a pending answer with no `paymentId`) and are labelled as mine.

## What the first run got wrong

The first full run is kept in the record as `earlierRun`. Its A3 asked Circle to settle to an address that was not the seller's own. On the keyless trial Circle serves only the `payTo` whose key signed the seller proof, so it answered `401 authentication required` and never looked at the tab's signature. The script recorded that as Circle refusing a non-payee. It was not. The non-payee case now uses a second seller with its own key, and A2 also puts its over-maximum signature in front of Circle. Both get `invalid_exact_evm_payload_signature`.

## What is in the record, and what is not

`deployments/arc-testnet.json` holds addresses, transaction hashes, Circle's answer bodies with their `x-request-id`, revert reasons, and the bill. It holds no private key, no seller proof, no `PAYMENT-SIGNATURE` header, no signature of any length and no signed authorization. All 80 distinct 32-byte values in it and in this file were checked against Arc Testnet one at a time, and each is a transaction with a receipt. The signed payment headers exist only in the server's local state, outside the repository, and every one of them belongs to a settled payment whose nonce USDC has already consumed.

## Cost

Deploying the factory cost 0.0346 USDC. Opening a tab costs about 0.005 USDC (approve plus open), closing about 0.002. Circle's relayer paid for every settlement. The whole of phase 3, two full runs and 179 settlements, took the owner from 20 to 19.5506 USDC: 0.375 went to the demo seller as payments and about 0.075 was gas, the factory included.

## 2026-09-22: the Testnet keys are lost

On 2026-09-21 the Mac that held `~/.local/state/barkeep-arc` was wiped before its local state was copied. There is no backup. Gone with it: the Testnet deployer key (`0x1a80c286cAB35b8CA58af33DDfCc7FEAE409aC57`), the relayer key (its address was never recorded here), the demo seller key (`0x645DD12775906233c9A43c123372118eae0B7065`), the live demo tab's agent key (`0x37948629603d12E2ac060eAbF1CD01AA0939e58f`), and the MCP server's local tab and payment records.

What follows from that:

- `Tab.close()` is owner-only, so no tab owned by `0x1a80…aC57` can be closed again. Only the demo tab still holds money.
- The demo tab `0xc96f926A148F77da3828c051aE0ddE0fC667aD27` can make no further payment and cannot be swept. Its 0.939 USDC stays in it for good. It expires on 2026-10-21.
- The 18.54538 USDC at the deployer address and the 0.436 USDC at the demo seller address cannot be moved.
- All of it is faucet USDC on Testnet. Nothing on mainnet was ever funded.
- The TabFactory has no owner and no admin function. It is unaffected, and a new owner key can open tabs through it.
- Everything recorded above and in `deployments/arc-testnet.json` stays valid. It is on chain and anyone can read it back.

### The gap between this document and the chain

The cost paragraph above ends with the owner at 19.5506 USDC. At block 63320093 the chain says 18.545380375 USDC, nonce 23: 1.00522285 USDC less. That is the demo tab, opened after that paragraph was written. The deployer held 19.550603225 USDC at block 63250000 (nonce 21), 19.549217275 after the approve (fee 0.00138595), and 18.545380375 after the open in block 63250660 (1 USDC into the tab, fee 0.0038369). It has sent nothing since. Of that 1 USDC, 0.939 is still in the demo tab and 0.061 went to the demo seller in the three payments recorded under `demoTab`. So the difference sits in the demo tab, apart from 0.00522285 USDC of gas.

Every tab the factory has opened, from its deploy block to block 63320093 (five `TabOpened` events, all with this owner), and what each held at that block:

| Tab | Opened at block | Cap | Balance |
|---|---|---|---|
| `0x3eb744131c1c1f7e2e04c683e5ae9b8df3246005` | 63223174 | 0.5 USDC | 0 |
| `0xc9c05f7237a51953cab0d505c33942a9e41cc9b5` | 63223451 | 0.05 USDC | 0 |
| `0x95C704A54729170edc28fd7E2927627CDe1fd020` | 63223816 | 0.5 USDC | 0 |
| `0xd6e319557c583f350182766ff5862817d9f636c1` | 63225052 | 0.05 USDC | 0 |
| `0xc96f926A148F77da3828c051aE0ddE0fC667aD27` (the demo tab) | 63250660 | 1 USDC | 0.939 USDC |

These were read with `eth_getLogs`, `eth_call`, `eth_getBalance` and `eth_getTransactionCount` against the public Testnet RPC. No transaction was sent. The record is `keysLost` in `deployments/arc-testnet.json`.

## Run it

```sh
(cd contracts && arc-forge build)
npx barkeep-arc-owner whoami            # the Testnet owner needs about 1 USDC from faucet.circle.com
npx tsx packages/mcp-server/scripts/done-tests-testnet.ts
```
