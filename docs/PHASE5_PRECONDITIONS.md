<!-- Draft written by Claude for the author's review. -->

# Before mainnet: what Circle's Facilitator Service requires

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

## So, before phase 5

1. Decide whether the demo payment goes keyless or with an API key. Keyless works on mainnet for `/verify`; `/settle` is untested and the allowance is unknown.
2. If with a key: create the Console account, find out what it requires for a `LIVE_API_KEY`, and only then bind a `payTo`.
3. Make the first mainnet payment the smallest amount we intend to support, to find the minimum.
4. Keep the fallback in mind: the stock `@x402/evm` facilitator, self-hosted, settled the same signatures on Testnet and needs nothing from Circle but a relayer holding a little USDC for gas.
