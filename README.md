<!-- Draft written by Claude for the author's review. Facts and structure first; the prose is his to rewrite. -->

# Barkeep on Arc

A tab for an AI agent, on Circle's Arc. You tell Claude Code "spend up to 5 USDC, on these two sellers, at most 25 cents a time, for the next hour", once. The agent then pays for what it fetches over x402 without asking again, and cannot go past any of those four limits, because they are not in the agent's prompt or in the server it talks to. They are in a contract that holds the money.

**Unaudited.** Nobody but the author and the tools listed in [docs/SECURITY.md](docs/SECURITY.md) has reviewed the contracts. It runs on Arc Testnet. Nothing here has been deployed to mainnet. Do not put in a tab more than you are prepared to lose.

**What this is not.** This is infrastructure software. It does not offer a payment service in Türkiye, and it is not proposed as a payment method for merchants there. Whether using it from Türkiye raises a question under Turkish rules on crypto assets in payments is set out, without an opinion, in [docs/PHASE5_PRECONDITIONS.md](docs/PHASE5_PRECONDITIONS.md#what-turkish-rules-add).

It started as [Barkeep](https://github.com/barbarosalagoz/barkeep) on Stellar, where a tab is a rule inside a smart account. This is the same idea rebuilt for Arc's EVM, and the rebuild changed the design: see [how it works](docs/HOW_IT_WORKS.md).

## What it looks like

Four tools in Claude Code, and one command you run yourself.

```
open_tab       limit "0.5", max_per_call "0.1", window "PT2H", payees ["0x645D…7065"]
               -> makes the agent's key, records the terms, opens nothing, and returns:
                  npx barkeep-arc-owner open tab_9a6f1fcd8775

$ npx barkeep-arc-owner open tab_9a6f1fcd8775      (you, in a terminal; it shows the terms and waits for "yes")

pay_and_fetch  url, max_amount "0.06"   -> paid 0.05 USDC, returns the resource
tab_status                              -> balance 0.45 USDC, spent 0.05 USDC, payees, expiry, the bill
close_tab                               -> destroys the agent's key, returns:
                                           npx barkeep-arc-owner close tab_9a6f1fcd8775
```

Those are the values from the Testnet run below. The bill lists refusals as well as payments, each with what stopped it.

## How the limits hold

One small contract per tab, funded with exactly the cap, so the balance is the limit. USDC on Arc asks a contract payer whether a transfer is signed (ERC-1271), and `Tab.isValidSignature` says yes only to a transfer out of this tab, signed by the agent, to a listed payee, within the per-call maximum, that cannot outlive the tab. Owner, agent, payees, maximum and expiry are in the tab's bytecode; nothing can change them. Closing is permanent and returns what is left.

The MCP server holds per-tab agent keys and nothing else. It has no code that can send a transaction. Opening, funding and closing take your key, in a separate program you run yourself. A build test fails if the server's code can ever reach that key.

The walkthrough, file by file: [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## What has been shown, and where

On Arc Testnet, 2026-09-21. TabFactory `0xd7c3e0106ba18e73fc195088e453a370ef9ba9ed`. Every hash was read back from the chain, and every refusal below was also submitted, so its revert is in a block. Full table and Circle's verbatim answers: [docs/TESTNET.md](docs/TESTNET.md) and [`deployments/arc-testnet.json`](deployments/arc-testnet.json).

| | |
|---|---|
| A tab paid a listed seller through Circle's Facilitator Service, 213-byte ERC-1271 signature and all | [`0x872ccb3f…246f1a`](https://explorer.testnet.arc.io/tx/0x872ccb3fbc9c61d5c40d256eca9c29803caa726eb3d1eed5508bd45011246f1a) |
| Above the per-call maximum: refused before signing, refused by Circle (`invalid_exact_evm_payload_signature`), refused by the tab, reverted on chain | [`0xf8868aa6…4bbb1e`](https://explorer.testnet.arc.io/tx/0xf8868aa6f0e1fa8c0119cfdcb8d7d9bbc4133a1d9113bd28306c40cbfa4bbb1e) |
| A seller not on the list: the same | [`0x70ad1332…1d7ab0`](https://explorer.testnet.arc.io/tx/0x70ad133285fc0165688417f36d2b3849d0896b349b9cd74f2902fef7471d7ab0) |
| After expiry: the same, and the owner still got the money back | [`0xfe5f00b2…03421c`](https://explorer.testnet.arc.io/tx/0xfe5f00b24b5da3edac9aef6063030fd8ecfb0b7baf23c67a053737fcfa03421c), [`0xea350793…1483b6`](https://explorer.testnet.arc.io/tx/0xea350793cc77cd84977eeb533a7101837fd4eb0fa273aad7e01afe9b631483b6) |
| After the owner closed: a payment signed beforehand reverted; balance zero | [`0x9abd1ce7…606164`](https://explorer.testnet.arc.io/tx/0x9abd1ce72afc33bb771687e172597e96aafdf7eb7119f47618dfc9b85d606164), [`0xc9100471…54d99f`](https://explorer.testnet.arc.io/tx/0xc9100471d2175a65fdce1e0b1af0ddb9af7a95590d064efb39b7fd916654d99f) |
| The seller's answer was lost: the agent asked the chain, paid once, collected with the same signature | [`0xab1179b5…99801e`](https://explorer.testnet.arc.io/tx/0xab1179b52b10494fb741f348d4d7707d39937afb2f0b023ee5d74b1d7a99801e) |

Off chain: 71 contract tests against Arc's real USDC (never a mock), a check that deletes each security rule in turn and requires a test to notice (25 of 25), Slither with no high or medium finding, 77 unit tests for the server, and 7 integration tests that run the server's own code against the real contracts on a local Arc chain. All of it runs in CI.

## What has not

- **No audit.**
- **Nothing on mainnet.** What Circle's facilitator requires there, and what its documentation does not say (fees, rate limits, a minimum amount), is in [docs/PHASE5_PRECONDITIONS.md](docs/PHASE5_PRECONDITIONS.md).
- **The demo seller's handling of a pending settlement has never met a real one.** When a payment's outcome is unknown, the buyer's recovery is proven on Testnet, above. The demo seller's own `settlement_pending` branch, which polls Circle's `/status`, has not once run against a real pending answer from Circle in this repository: Circle returned none in 179 Testnet settlements. It is covered by a unit test fed with the one real pending answer I have, recorded during the earlier spike (`packages/mcp-server/test/seller.test.ts`).
- **Anyone can send USDC to a tab**, and the agent can then spend that too, under the same rules. What you put in is still all you can lose.
- **A tab does not refill.** When the money is gone or the time is up, you open another.
- **The two programs run as the same user.** The split between the agent's keys and yours is by process and by code, not by the operating system.

## Findings

Things that were not what I expected, written up with how I measured them.

- [08: the x402 client dates its authorization by my clock, and the chain judges it by its own](docs/findings/08-x402-client-validbefore-local-clock.md). A machine one minute behind the chain cannot pay anyone, and the refusal does not say why.
- Circle's facilitator does accept a contract payer with a long signature, which the public facilitator on Stellar did not. The spike that checked this before any of the rest was built is in the [Stellar repository](https://github.com/barbarosalagoz/barkeep/tree/34bbf0bc10ae0be40977955d2082db1391118019/spikes/arc-1271).
- On its keyless trial, Circle serves only the `payTo` whose key signed the request. Ask it to settle to anyone else and the answer is `401`, not a verdict on the payment. My first Testnet run recorded that `401` as a refusal of the signature; it is kept in the record as `earlierRun`, with the mistake described ([docs/TESTNET.md](docs/TESTNET.md)).
- "The balance never exceeds the cap" was in my own spec and is false, because anyone can send a tab money. The invariant tests now state both halves separately ([docs/SECURITY.md](docs/SECURITY.md)).
- Circle Gateway's batched payments also call themselves `exact` on Arc, but verify with `ecrecover`, so a contract can never pay that way. A client has to tell the two apart by the domain name in the offer ([docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)).
- Arc is not quite the EVM the tools expect: the test fuzzer's random senders are blocklisted at transaction validation, and a transfer that would empty a fresh account reverts ([contracts/README.md](contracts/README.md)).

## Run it

```shell
git clone --recurse-submodules https://github.com/barbarosalagoz/barkeep-arc && cd barkeep-arc
npm ci && npm run typecheck && npm run test:unit
```

The contract tests and the integration tests need Arc Foundry, not upstream Foundry: [contracts/README.md](contracts/README.md). The server, the owner's command and how to register them with Claude Code: [packages/mcp-server/README.md](packages/mcp-server/README.md). All the docs: [docs/README.md](docs/README.md).

## Status

| Phase | What | State |
|---|---|---|
| 1 | Contracts, tests, Slither, graph review, independent code review | done |
| 2 | MCP server, the Arc adapter, the owner's command | done |
| 3 | Testnet done-tests A1 to A8 | done, except that the seller half of A6 could not be provoked |
| 4 | README, SECURITY.md, docs | this |
| 5 | Mainnet: factory, one demo tab, one real payment | not started |

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
