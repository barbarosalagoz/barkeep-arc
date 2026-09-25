<!-- Draft written by Claude for the author's review. -->

# Arc mainnet, 2026-09-24

Phase 5: the factory, one demo tab, real payments through Circle's Facilitator Service, and every refusal, on Arc mainnet (chain 5042). Every hash below was read back from the chain before it was written down, every refusal was also submitted so that its revert is in a block, and Circle's answers are quoted as they came back. The full record is [`deployments/arc-mainnet.json`](../deployments/arc-mainnet.json).

**Unaudited.** Nobody but the author and the tools in [SECURITY.md](SECURITY.md) has reviewed the contracts. This was a demonstration with less than three dollars, and every tab from it is closed.

**No third party.** The payer and the seller were both the owner's: the owner's key opened and funded the tabs, the agent keys were the server's, and the seller was this repository's demo seller, paid at an address the owner held the key to. Nobody else was paid. Why, and what is still open about it: [PHASE5_PRECONDITIONS.md](PHASE5_PRECONDITIONS.md#what-turkish-rules-add).

Script: [`packages/mcp-server/scripts/phase5-mainnet.ts`](../packages/mcp-server/scripts/phase5-mainnet.ts), one step at a time (`open`, `first`, `more`, `refusals`, `expiry`, `close`, `sweep`). It refuses to run on any chain but 5042.

## Funding

Two withdrawals from Binance TR on the Arc network to the owner address `0xBf48c3C741aFC9FA17C0c83c57123A944B3cDFB6`, which was generated for this and held nothing before (nonce 0, balance 0, read on chain first).

| | Arrived | Tx |
|---|---|---|
| 0.5 USDC less Binance TR's 0.02 fee | 0.48 USDC | [`0xc7ed57bc…9f7c9566`](https://explorer.arc.io/tx/0xc7ed57bc011696bccd05b956b6ac86f01c014ebdbeba469c6b584d2f9f7c9566) |
| the rest | 2.47565 USDC | [`0xb3dee414…242c4ff7`](https://explorer.arc.io/tx/0xb3dee41410e42a3e85db7d9ea944ec8cbc202593511bc4720558a04c242c4ff7) |

This time no hold stopped either withdrawal (compare 21 and 23 September in PHASE5_PRECONDITIONS.md). The first showed as pending in the app for a few minutes before it was broadcast.

## The factory

TabFactory **`0xccebc58dd1f5937b36d5f9f89f0754424f4d443c`**, Tab implementation `0x89B63f2E43dea9014750925C01996D34856B01D2`, deployed in [`0x9dec3501…69afde26`](https://explorer.arc.io/tx/0x9dec350174c08215d8b171719adf4aaeed9b2775e77f5fd6b9bfadae69afde26), block 22528992: 1,382,103 gas at 20 gwei, 0.02764206 USDC.

It is the audited build. The deploy transaction's input equals the creation bytecode `arc-forge` builds from `main` at `584e12f`, and the code now at both addresses equals the build's runtime bytecode byte for byte, apart from the immutables, each of which holds the implementation's address. The same build matches the Testnet factory from 2026-09-21. `arc-forge` itself came from the release archive whose sha256 CI pins.

The source is **not** verified on the explorer. `explorer.arc.io` answers every API request, `forge verify-contract --verifier blockscout` included, with a Cloudflare challenge page, so verification needs a browser. The Testnet factory is not verified either.

## The demo tab

Tab `0xC6640A6D78D7507A928DF7c5122c675C2A41C439`: cap 0.5 USDC, at most 0.05 USDC per payment, 24 hours, one payee (the demo seller, `0xD3fFdC8DD27F6c19A89ebdD2a9C9f983018bc5b8`). Opened in [`0x06de0571…4eaaa56f`](https://explorer.arc.io/tx/0x06de05715db9817a55c9556f533036feadbd6ea23ab85e12a75d78ce4eaaa56f) after the owner's approval [`0x0ab60bf8…d37af0bf`](https://explorer.arc.io/tx/0x0ab60bf87d7035b99d8ddd8987fba0fe6a7191ee9ba1593327daa93bd37af0bf).

## Payments through Circle, keyless

The seller called `https://api.circle.com/v1/facilitator/x402` on the keyless trial: a `Facilitator-Seller-Proof` signed by the seller's key, no Circle account and no API key. The first payment was the smallest amount the demo seller prices at, 0.001 USDC. The plan was to double it on a `403` below-minimum; there was none.

| | Circle `/settle` | Tx |
|---|---|---|
| 1, 0.001 USDC | `200 {"success": true, "payer": "0xc6640a6d…", "transaction": "0x2b26d71f…", "network": "eip155:5042", "amount": "1000"}`, request `17aae4477fe950b5ed4074349fcc077d` | [`0x2b26d71f…f344ba26`](https://explorer.arc.io/tx/0x2b26d71fda48dcd2eed10b26040858735de4a8a145d64185f44a5e9bf344ba26) |
| 2, 0.001 USDC | `200`, `"success": true`, request `5c1c5ed3a54284dbd518f66487b7a723` | [`0xfcc39bc0…fceb43fb`](https://explorer.arc.io/tx/0xfcc39bc01a99399c44645cccebe49dec6a8cd44970f6ade0635c0fa5fceb43fb) |
| 3, 0.001 USDC | `200`, `"success": true`, request `9595d365b05ed79d3e22a4c6a4bd7517` | [`0x210a8dfb…4091ae53`](https://explorer.arc.io/tx/0x210a8dfbaf66880d34fbaaabbf766ee619dd1d382cab7509e816ec534091ae53) |

Circle's `/verify` before the first: `200 {"isValid": true, "payer": "0xc6640a6d78d7507a928df7c5122c675c2a41c439"}`. Each transfer was sent by Circle's relayer, `0xa48381b79bba70ce4e98bcf71db43bad6ee1ad30`, which paid the gas. After three, `tab_status` read 0.497 USDC left, 0.003 spent.

What this settles from the preconditions: keyless `/settle` works on mainnet, and the minimum, whatever it is, is at or below 0.001 USDC. What it does not: the trial's size (three settlements used it, and it never answered `registration_required`), fees, and rate limits.

## Refusals, each submitted and reverted

| | Before signing | Circle `/verify` | `isValidSignature` | Reverted |
|---|---|---|---|---|
| A2, above the per-call maximum (0.050001 on a 0.05 tab) | refused, nothing signed | `200 {"isValid": false, "invalidReason": "invalid_exact_evm_payload_signature"}` | `0xffffffff` | [`0x332409fb…f3614e27`](https://explorer.arc.io/tx/0x332409fb88ca5a3bfab25917ed7c38872ad6b46e4ede71a6fb1feb4bf3614e27), "FiatTokenV2: invalid signature" |
| A3, a seller not on the list (the owner's second seller key, `0x78Dc…e614`) | refused, nothing signed | the same | `0xffffffff` | [`0xe2a02e84…05a14c50`](https://explorer.arc.io/tx/0xe2a02e84b920dc6ecd795697e48f143c3f4fe49bf0c564e515f5b48705a14c50), "FiatTokenV2: invalid signature" |
| A4, after expiry | refused, "the tab expired at 2026-09-24T14:12:24.000Z" | not asked | `0x1626ba7e` while open, `0xffffffff` after | [`0x3d966f20…9127242a`](https://explorer.arc.io/tx/0x3d966f2090a7ab11ff5209a7071145842217a568b606e9b6522d8d169127242a), "FiatTokenV2: authorization is expired" |

A2 and A3 used the demo tab; its balance stayed at 0.497 USDC and the outsider's at 0. For the refusals the tab was forced: the tab's real agent key signed without this package's checks, which is what a buggy or hostile server would send.

A4 used a second, short tab, as on Testnet, so that the demo tab could be closed the same day without its expiry being tested on a closed tab: `0x1e9202a558FBda7669601c8Ad313337D00f76C9B`, 0.01 USDC for 100 seconds, opened in [`0x710e2491…c2e5248d`](https://explorer.arc.io/tx/0x710e24914e3652e157209e786b44f371d3a609f85e845f0463a4ac13c2e5248d), closed after expiry in [`0xfb756055…69759c66`](https://explorer.arc.io/tx/0xfb7560550ee9b78629f3544041861c566c3a0e46072dbbf7c3348bd369759c66) with its 0.01 USDC returned. USDC reports its own expiry check first, because the tab only accepts authorizations that die with it; the tab's own answer is the column above.

## Closing, and where the money went

`close_tab` destroyed the demo tab's agent key; the owner closed the tab in [`0xa0be0731…6b2592bb`](https://explorer.arc.io/tx/0xa0be0731a74afeb513012204f0106caae8a85b059667c49e1e3f6e0c6b2592bb), which swept its 0.497 USDC back. Unlike Testnet's A5, no payment signed before the close was submitted afterwards.

The seller's 0.003 USDC went to the owner, less its gas ([`0xe81928c4…f2bcc9be`](https://explorer.arc.io/tx/0xe81928c499cc2b874a9b2c19beccf7425e67b78b059a6dc7f17506c4f2bcc9be)), and the owner's 2.910707 USDC went back to Binance TR as one ordinary USDC transfer ([`0x7b8d4b27…bc5caa5b`](https://explorer.arc.io/tx/0x7b8d4b27e640c7d72c66b287951d12273ff41dfd0c44fb12f462e234bc5caa5b)).

Read at block 22530627: both tabs, both agent addresses and the outsider hold 0. The owner holds 18,025,000,000,000 wei (0.000018025 USDC) and the seller 8,240,000,000,000 wei (0.00000824 USDC). USDC is gas on Arc with 18 decimals and moves as a token with 6, and each sweep kept back the gas the node estimated; the transfers used about 1% less. Neither remainder can pay for its own transfer, so both stay where they are.

**The keys after the run** (checked 2026-09-25 on the machine that ran this phase):

- **Agent keys.** Both tabs' agent keys are gone. The agent-key directory, `~/.local/state/barkeep-arc/mcp/agents`, is empty.
- **Owner and seller keys.** `~/.local/state/barkeep-arc/keys.json` no longer exists on that machine. That file held the owner key and the seller keys (`src/owner/keyfile.ts`). Its directory was last modified at 17:45 (UTC+3) on 2026-09-24, after the sweeps above.
- **Backups.** No other copy of any of these keys is recorded. The owner's and the seller's dust therefore stays where it is.

## Cost

The phase moved 2.95565 USDC in and 2.910707 out. The difference, 0.044943 USDC, is the gas the owner and the seller paid (the factory's 0.0276 most of it) and the 0.000026265 USDC of dust above. The three payments' gas was Circle's.

## What is still not shown on mainnet

- The seller's `settlement_pending` branch, as on Testnet: Circle returned no pending answer.
- A payment signed before a close, submitted after it (Testnet's A5).
- An audit.

## What the record holds, and what it does not

`deployments/arc-mainnet.json` holds addresses, transaction hashes, Circle's answer bodies with their request ids, revert reasons and balances. It holds no private key, no seller proof, no `PAYMENT-SIGNATURE` header, no signature of any length and no signed authorization. All 25 distinct 32-byte values in the files this phase added or changed were checked one at a time: 17 are mainnet transactions with receipts, and 8 are the Testnet transactions the README already cited. No hex value longer than 32 bytes appears in them. The server's local payment records hold no signed header: every payment settled, and the forced authorizations used for the refusals were never stored and are past their `validBefore`, signed by agent keys that no longer exist.
