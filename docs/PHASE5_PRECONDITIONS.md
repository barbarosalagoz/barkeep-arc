<!-- Draft written by Claude for the author's review. -->

# Before mainnet: what Circle's facilitator requires, and how the USDC gets there

Read from Circle's documentation on 2026-09-21. Each claim carries the page it came from. Where the documentation is silent, this says so; nothing here is filled in from general knowledge of Circle.

The short version: the documentation says production settlement needs a Circle API key and says almost nothing else. It does not state fees, rate limit numbers, the trial's size, a minimum amount, or what an account must do to get a mainnet key. Those have to be asked of Circle, or found out with a small real payment, before phase 5 depends on them.

## The keyless trial is not Testnet-only

I had assumed it was. The documentation says otherwise, and a probe agrees.

> "Each `payTo` has its own trial allowance on each supported blockchain, with testnet and mainnet counted separately."
> https://developers.circle.com/facilitator-service/keyless-trial

Probe, no funds and no transaction involved: `npx tsx packages/mcp-server/scripts/probe-circle-mainnet.ts` sends `/verify` for `eip155:5042` with a keyless seller proof from a throwaway key and a payment that cannot be valid. Circle answered `200 {"isValid": false, "invalidReason": "invalid_exact_evm_payload_signature"}`. It authenticated the keyless proof on mainnet and went on to judge the payment. A `401` would have meant keyless is refused there.

What that does not show: that `/settle` works keyless on mainnet. `/verify` moves nothing. The first real mainnet settlement in phase 5 is the test.

## API key

> "Facilitator Service requires a Circle API key to settle payments in production. You can trial Facilitator Service without a Circle account through the keyless trial. A trial allowance applies until you settle with a Circle API key."
> https://developers.circle.com/facilitator-service/how-it-works

> "Bearer token authentication with a Circle API key. Use this for production settlement. Settling with an API key also binds the `payTo` to your Circle account, which ends the keyless trial allowance."
> https://developers.circle.com/api-reference/agent-stack/facilitator-service/settle-payment (security scheme `CircleApiKey`)

Keys are per environment, and mainnet keys are a different credential:

> "API keys are specific to one environment. Create one API key for testnet and another for mainnet, and switch the credential when you move from development to production."
> https://developers.circle.com/api-reference/keys

The same page shows the two forms, `Bearer TEST_API_KEY:…` and `Bearer LIVE_API_KEY:…`. The API reference lists two servers, `https://api.circle.com` ("Production") and `https://api-sandbox.circle.com` ("Sandbox"). All of this repository's Testnet calls went to `api.circle.com`; I have not called the sandbox host and do not know how it differs.

Binding is one-way and has a consequence for us: the first settlement made with an API key for a `payTo` attaches that `payTo`'s seller account to the Circle account, and "There is no separate registration step. The trial allowance stops applying. Payment history carries over." (keyless-trial page). Decide which `payTo` address is the real one before using a key with it.

## Trial allowance size

Not stated. The keyless-trial page says the allowance exists, that every `/settle` counts against it, and that it ends with `HTTP 403 registration_required`. It gives no number and does not say whether it is counted in settlements or in value.

What I measured on Testnet: 180 settlements on one `payTo` in the spike and 179 on another in phase 3, and `registration_required` never came back. That is a Testnet observation. The mainnet allowance is "counted separately" and may be smaller.

## Account approval, KYB

The Facilitator Service pages do not mention approval, business verification or KYB. The only sentence I found that bears on it is about a different product, and it implies that mainnet access elsewhere does involve onboarding:

> "Mainnet access for Swap doesn't require completing full onboarding or identity verification."
> https://developers.circle.com/api-reference/keys

So: whether a `LIVE_API_KEY` that can call the Facilitator Service needs "full onboarding or identity verification" is not stated for this product. The overview page does say the service is "subject to Circle Console Service Terms and Developer Terms" (https://developers.circle.com/facilitator-service), and the Developer Terms say that use is "for business purposes only and not household or other personal purposes" (https://console.circle.com/legal/developer-terms, fetched 2026-09-21). I have not created a Console account, so what the Console asks of an individual in Türkiye before it issues a mainnet key is unknown to me.

## Fees

Not stated. There is no pricing or fees page for the Facilitator Service (`/facilitator-service/pricing`, `/fees` and `/rate-limits` all return 404), and no page I read mentions a charge to the seller. What is said is who pays gas:

> "Circle broadcasts every transfer, pays settlement gas, and screens both parties before any money state is created."
> https://developers.circle.com/facilitator-service

Whether that stays free with an API key, on mainnet, at volume, is not stated. The disclaimer on the same page: "Features may change at any time. Nothing herein constitutes a commitment, warranty, or guarantee."

## Rate limits

They exist; the numbers are not given. `/verify`, `/settle` and `/status` each document `'429': Rate limit exceeded.` and nothing more (the three pages under https://developers.circle.com/api-reference/agent-stack/facilitator-service/). On Testnet, 152 sequential settlements in about ten minutes never drew a 429.

## A minimum amount

There is one, and its value is not given:

> "Forbidden by policy. Returned when the keyless trial allowance is exhausted (`registration_required`) or the settlement amount is below the configured minimum."
> https://developers.circle.com/api-reference/agent-stack/facilitator-service/settle-payment (the description of the `403` response)

On Testnet 0.001 USDC settled every time. Mainnet may differ. A tab that pays in thousandths of a dollar needs this checked with one real payment before anything is promised.

## Screening

> "Facilitator Service screens both parties. If either fails, it refuses to settle."
> https://developers.circle.com/facilitator-service/how-it-works

The payer it screens is the tab's address, a fresh contract each time. The documentation does not say how a new contract address is treated. On Testnet none was refused.

## Finality and what "completed" means on Arc

> "Arc | Instant finality"
> https://developers.circle.com/facilitator-service/supported-networks

Arc mainnet is `eip155:5042`, USDC at `0x3600000000000000000000000000000000000000`, same page.

## Getting USDC onto Arc mainnet, from Türkiye

Researched on 2026-09-21 from live pages and public APIs. No account was created and no transaction sent, so every route below is unproven end to end. Each line says who checked it: "I checked" means fetched again by me on the day; "research pass" means fetched once by the research agent and not repeated. The quotations from Turkish regulations are left in Turkish, as published; the English next to them is my paraphrase, not a translation to rely on.

USDC is gas on Arc, which matters twice. USDC that arrives by exchange withdrawal can pay for a deployment at once. USDC that arrives by a bridge needs someone else to pay for the mint on Arc, because a fresh address has nothing to pay with.

### Direct withdrawal from an exchange, on the Arc network

| Exchange | Arc withdrawal of USDC | Fee / minimum | Source, and who checked |
|---|---|---|---|
| Binance TR | enabled in its public configuration | 0.02 / 0.1 USDC | `{"asset":"USDC","network":"ARC","withdrawEnable":1,"withdrawFee":"0.02","withdrawMin":"0.1","txPrefix":"https://explorer.arc.io/tx/"}` from https://www.binance.tr/v1/capital/configs?legalMoney=0. I checked. The owner saw the logged-in withdrawal screen on 2026-09-21: it offers USDC on the Arc network (below). There is no Binance TR announcement. |
| Paribu | yes | fee shown only in the app: not stated. Minimum 2 (research pass) | "Arc üzerinden USDC yatırma ve çekme işlemleri, ağın herkese açık ana ağdaki ilk gününden itibaren Paribu'da yapılabiliyor." https://www.paribu.com/blog/haberler/paribu-arcin-lansman-partnerleri-arasinda/ (deposits and withdrawals of USDC on Arc since the network's first public day). I checked the sentence. |
| Binance (global) | yes | 0.02 / 0.1 | "Binance has completed the integration of USDC (USDC) on the Arc network." Research pass. |
| OKX | yes | minimum fee 0.0024, minimum 1.1 | "USDC (Arc) withdrawals will open at 4:00 am UTC on September 16, 2026." https://www.okx.com/en-us/help/okx-to-support-usdc-on-the-arc-chain Research pass. OKX TR: not verified. |
| Bybit | announced | 0 during a promotion, minimum 2 | "A minimum withdrawal amount of 2 USDC applies." Research pass. |
| KuCoin, Kraken | yes | 1 / 2 each | their public currency APIs. Research pass. |
| Bitget | yes | 0.02 / about 10 | public API. Research pass. |
| Coinbase | no | | Arc's own launch post: "Coinbase and others will be live on Arc soon." https://www.arc.io/blog/arc-economic-os-internet |
| BtcTurk, Bitexen, Icrypex | no | | BtcTurk has a channel named `ARC20USDC`, and it is AVAX C-Chain, not Arc. Research pass. |
| MEXC, Gate | not verified | | |

### What a withdrawal from Binance TR actually asked for, 2026-09-21

Observed first-hand by the repository's owner, in the logged-in Binance TR app, while attempting the first mainnet funding. I did not see the screens; this is his account of them.

- The withdrawal screen offers USDC on the Arc network. That settles the one thing the public configuration could not: the option really is there.
- The withdrawal did not go out. Binance TR put it on a 48-hour security hold, as the first withdrawal after a purchase. Nothing was sent. I confirmed on chain that the destination held nothing on Arc mainnet afterwards, balance 0 and nonce 0, and its key was destroyed unused.
- The flow asks three things before it will queue the transfer: whether the destination is a private wallet or another service provider (VASP), who owns the wallet, and a free-text purpose. The purpose field accepts only English or Turkish characters.

How this sits next to the rule quoted under "What Turkish rules add": the communiqué says at least 48 hours after the purchase, and at least 72 for an account's first crypto withdrawal. What was observed is a 48-hour hold. I do not know whether this account had withdrawn before, so I cannot say which of the two periods Binance TR applied, only that the hold is real and is measured in days. Phase 5 was stopped for it and resumes on 23 September 2026 with a fresh key.


### CCTP

Live to Arc mainnet as a destination, from most CCTP chains. I checked both of these:

> "| Arc | ✅ | N/A | ✅ | ✅ |" (columns: Standard Transfer, Fast Transfer as a source, upfront fees, Forwarding Service), and "| 26 | Arc |" in the domain table
> https://developers.circle.com/cctp/concepts/supported-chains-and-domains

Arc mainnet addresses, domain 26: TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` (https://docs.arc.io/arc/references/contract-addresses, research pass, which also found code at both addresses).

Fees. "CCTP charges fees on Fast Transfers only. Standard Transfers are free." (https://developers.circle.com/cctp/concepts/fees, research pass.) The live quote for Base to Arc, which I fetched: `https://iris-api.circle.com/v2/burn/USDC/fees/6/26?forward=true` returned a Fast fee of 0.325 bps, a Standard fee of 0, and a forwarding fee of about 0.0165 USDC.

The gas problem, and the answer to it:

> "This process requires you to have a wallet that can sign transactions on the source and destination chains, and native tokens for paying the transaction gas fee on both chains."
> "Circle validates the hook data, signs the attestation, and broadcasts the mint transaction on the destination chain for you"
> https://developers.circle.com/cctp/concepts/forwarding-service (research pass)

The documented Forwarding Service fee is "$0.05" for destinations like Arc; the live API quoted about a third of that. The documentation does not explain the difference. A minimum transfer amount for CCTP is not stated anywhere I or the research pass looked.

### Bridges with a user interface

| | Arc mainnet | Cost for about 20 USDC | Source |
|---|---|---|---|
| Circle's USDC Bridge, bridge.usdc.com | "it currently supports the following blockchains: Arbitrum, Arc, Avalanche, Base, …" No account needed. Solana is not in the list. | "Bridge Fee 0 - 5 bps", "Forwarder Fee $0.05", plus source gas. Minimum not stated. | Circle help articles KB0011003 and KB0011091. Research pass. |
| Across | chain 5042 in its API | a live quote of about 0.005 USDC, a few seconds | https://app.across.to/api/swap/chains Research pass, one point in time, dummy address. |
| Relay, LI.FI/Jumper | both list Arc mainnet | about 0.05 USDC | their public APIs. Research pass. |
| Arc Portal | swaps across networks through LI.FI | not stated. "Arc Portal is available only in select countries and regions." | https://help.arc.io Research pass. Whether Türkiye is one of them: not stated. |
| Stargate, Bungee, LayerZero and others | named in Arc's launch post only | | not verified one by one |

Circle Gateway is also live on Arc mainnet and needs no account ("Gateway is fully permissionless"), at 0.5 bps plus a $0.05 forwarding fee, but it is an API flow with no consumer interface, and saves nothing over the bridge for this purpose. Research pass.

### Buying with a card

Not a good route from Türkiye. Transak, which Arc Portal uses for cards, does not list Türkiye or TRY in its public country and currency APIs. MoonPay's API lists `usdc_arc` as live and Türkiye as allowed, with a TRY minimum of 700, but its published fee schedule has a minimum fee of "up to $3.99" plus a foreign-currency uplift, which is a fifth of a 20 USDC purchase, and no checkout was attempted. Circle Mint "is currently available only to institutions and is not available to individuals." All research pass.

### What Turkish rules add

From the research pass, quoting the Official Gazette. I have not read these instruments in full, and none of this is legal advice.

- A withdrawal to a self-custody wallet needs a declaration of who owns the wallet (Measures Regulation art. 24/A(6), in force 25 February 2025), and every transfer a description of at least 20 characters.
- There is a waiting period: "kripto varlık transferini, transfer edilecek kripto varlığın alım, takas veya yatırma işleminden en az 48 saat sonra gerçekleştirir. Bu süre, ilk kripto varlık çekim işlemleri bakımından en az 72 saat olarak uygulanır." (MASAK General Communiqué No. 29, Official Gazette 28 June 2025, https://www.resmigazete.gov.tr/eskiler/2025/06/20250628-4.htm). In my words: at least 48 hours after buying before the withdrawal goes out, and 72 for an account's first withdrawal. This is the real cost of the cheap route: time, not money.
- Stablecoin transfers are capped at "günlük 3.000 ABD Doları ve aylık 50.000 ABD Doları", far above anything phase 5 needs.
- Circle's terms restrict only sanctioned territories, and Türkiye is not named in the USDC, USDC Bridge or Arc terms.
- One rule concerns what this project does rather than how it is funded: "Kripto varlıklar, ödemelerde doğrudan veya dolaylı şekilde kullanılamaz." (Central Bank regulation, Official Gazette 16 April 2021, No. 31456, https://www.resmigazete.gov.tr/eskiler/2021/04/20210416-4.htm), that crypto assets may not be used, directly or indirectly, in payments. The text states no exception for a demonstration or a small amount. Whether an agent paying a seller for an API call in USDC, from Türkiye, falls under it is a question for a lawyer, not for this file. It should be answered before the mainnet payment in phase 5, not after.

### The route I would take for about 20 USDC

1. Buy USDC on Binance TR or Paribu by bank transfer, wait out the 48 or 72 hours, and withdraw on the Arc network to the owner address. Binance TR's public configuration says 0.02 USDC, minimum 0.1. It arrives as gas. A deployment of this factory cost 0.0346 USDC on Testnet at 20 gwei; mainnet's live gas price was 20.08 gwei.
2. If Arc is not offered on the withdrawal screen after all: withdraw on Avalanche C-Chain or Polygon (Binance TR 0.056 and 0.12 USDC) and bridge with Across or bridge.usdc.com, both of which deliver without needing gas on Arc. This route also needs a little native gas on the source chain, which is a second purchase and the real nuisance of it.

Total cost either way is well under one USDC. What none of this establishes: that a Binance TR withdrawal on Arc actually arrives (the screen offers it; the first attempt was held, not sent), Paribu's fee, how each exchange runs the 48 and 72 hour clocks beyond the one hold observed, and whether any bridge completes for a wallet and an IP address in Türkiye.

## Decisions already taken for phase 5

Taken by the repository's owner on 2026-09-21. They narrow what phase 5 is.

**The mainnet demo has no third party in it.** The payer and the seller are both controlled by the repository's owner, as they were on Testnet: the owner's key opens and funds the tab, the agent key is the server's, and the seller is the demo seller in this repository, paid at an address the owner holds the key to. No third-party seller is paid on mainnet until the question under "What Turkish rules add" has been answered by someone qualified. The demo shows that the contracts, the server and the facilitator work on mainnet. It is not the start of a service.

**A Circle Console account is a fallback, not the plan.** The first mainnet settlement is attempted on the keyless trial, which `/verify` has been shown to accept on mainnet (above). A Console account and a `LIVE_API_KEY` are opened only if keyless `/settle` fails there. Which entity would open it, an individual or a company, is undecided; the Developer Terms' "for business purposes only" is part of that decision, and so is the fact that settling with a key binds the `payTo` to the account for good.

## So, before phase 5

1. The demo payment goes keyless first. Keyless works on mainnet for `/verify`; `/settle` is untested and the allowance is unknown.
2. Only if keyless `/settle` fails: decide the entity, create the Console account, find out what it requires for a `LIVE_API_KEY`, and only then bind a `payTo`.
3. Make the first mainnet payment the smallest amount we intend to support, to find the minimum.
4. Get the payments question under "What Turkish rules add" answered by someone qualified. Until it is, the payer and the seller are both the owner's, and nobody else is paid.
5. Fund the mainnet owner address as above, and start the waiting period early: it is two or three days. The first attempt, on 2026-09-21, ran into exactly this. Generate the owner key only once the exchange is ready to send, so that no funded-looking address sits unused.
6. Keep the fallback in mind: the stock `@x402/evm` facilitator, self-hosted, settled the same signatures on Testnet and needs nothing from Circle but a relayer holding a little USDC for gas.
