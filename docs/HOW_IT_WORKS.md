<!-- Draft written by Claude for the author's review. Facts and structure first; the prose is his to rewrite. -->

# How Barkeep on Arc works

A walkthrough for a developer with no context. It follows one payment from the human agreeing to a tab to the line on the bill, and names the file that does each step. Shown on Arc Testnet and, as a demonstration, on mainnet ([MAINNET.md](MAINNET.md)). The contracts are not audited; [SECURITY.md](SECURITY.md) says what has and has not been checked.

## The problem in one paragraph

An AI agent in Claude Code wants to fetch a URL that costs money. The human running it wants to say "spend up to this much, on these sellers, for the next hour" once, and not be asked about every request. If the limit lives in the agent's prompt, or in the server the agent talks to, a bug or a jailbreak removes it. So the limit has to live where the money is, and the agent has to hold a key that can spend against that limit and nothing else. That is what a tab is.

## Why one contract per tab

On Stellar, Barkeep's tab is a rule inside one smart account, with a policy contract that counts what has been spent in a rolling window. On Arc the mechanism available is different, and it shaped the design.

USDC on Arc implements EIP-3009: anyone may submit a `transferWithAuthorization` that the payer signed off chain, which is what x402's `exact` scheme uses. When the payer is a contract, USDC asks that contract whether the signature is good, through ERC-1271's `isValidSignature(hash, signature)`. That one view function is the whole hook. A view function cannot write, so it cannot keep a running total.

So the total is not kept. Each tab is its own small contract, funded with exactly the cap. The balance is the limit. When the money is gone the agent can sign whatever it likes and USDC will refuse for lack of funds. There is no counter to drift out of step with the balance, and nothing to reset. The cost is that a tab does not refill: a new window is a new tab.

`contracts/src/Tab.sol` is that contract, 199 lines. `contracts/src/TabFactory.sol` opens one and funds it in a single transaction.

## What the human decides, and where it is kept

Five things: the owner, the agent's address, the payees (1 to 20), the most one payment may be, and when the tab expires. They are written into the tab's own bytecode when it is created. Tabs are EIP-1167 minimal proxies with immutable arguments (OpenZeppelin `Clones.cloneDeterministicWithImmutableArgs`), so the terms are appended to the proxy's code, and `Tab.terms()` reads them back from there. There is no initializer to front-run, no setter and no upgrade path. The tab's address depends on its terms, so a tab with different terms cannot be deployed at an address someone predicted.

The only storage a tab has is one bit, `closed`.

## The 213 bytes

ERC-1271 hands the tab a hash and a signature, and nothing else. A hash says nothing about who is being paid or how much. So the signature carries the answer with it (`packages/mcp-server/src/signature.ts`, fixed by `Tab.sol`):

```
[0:65]     the agent's ECDSA signature over the hash
[65:85]    to
[85:117]   value
[117:149]  validAfter
[149:181]  validBefore
[181:213]  nonce
```

`Tab.isValidSignature` rebuilds USDC's own EIP-712 digest for a `TransferWithAuthorization` out of this tab from those fields, with USDC's domain hardcoded (name "USDC", version "2", the chain id, `0x3600…`). If the rebuilt digest is not the hash it was handed, the fields are lies and it refuses. Then it checks that the agent signed, the payee is listed, the value is within the maximum, the tab has not expired or been closed, and the authorization cannot outlive the tab (`validBefore <= expiry`). Every refusal is the same `0xffffffff`, with no reason and never a revert.

Because the hash must be exactly that transfer, nothing else USDC or anyone else might ask the tab to sign for can pass: not a `permit`, not a `receiveWithAuthorization`, not another tab's transfer, not this transfer on another chain. Each has a test against the real USDC in `contracts/test/Tab.refuse.t.sol`.

## Two programs, two kinds of key

`packages/mcp-server` is two programs on purpose.

`bin/barkeep-arc-mcp` is the MCP server Claude Code talks to. The only keys it ever holds are agent keys it makes itself, one per tab (`src/agentKeys.ts`). It has no wallet client and no code that can send a transaction.

`bin/barkeep-arc-owner` is the owner's command. It is the only program that reads the owner's key. A human runs it in a terminal; it prints what it is about to sign and waits for "yes".

`test/boundary.test.ts` fails the build if the server's import graph ever reaches the owner's side. The limit of this: both programs run as the same user, so it is a separation by process and code, not by the operating system.

## Opening a tab

1. The agent calls `open_tab` with a cap, a per-call maximum, a window and the payees. `src/tabs.ts` `requestOpen` validates them, makes the agent key, and writes the request down. It opens nothing. It returns the command for the human.
2. The human runs `npx barkeep-arc-owner open <tab_id>`. `src/owner/actions.ts` `openTab` shows the terms, approves exactly the cap to the factory, and calls `TabFactory.openTab`, which deploys the clone and pulls the cap into it. The factory is left with no allowance and never holds funds.
3. The owner's command writes the tab's address back. The server does not take its word for it: `src/chain.ts` `verifiedTab` checks that the address is what the factory predicts for these terms and this owner, and that the terms on chain are the terms it asked for.

On Testnet, approve plus open cost about 0.005 USDC in gas.

## One payment

`src/pay.ts`, in order:

1. Look up an earlier identical request (same tab, URL, `max_amount` and `request_id`). If it settled, return the stored result and sign nothing.
2. Read the tab from the chain, through `verifiedTab`.
3. Fetch the URL. If it is not a 402, return it.
4. Decode the x402 v2 challenge and keep only the options a tab can pay: `exact`, this network, USDC by plain EIP-3009. Circle Gateway's batched option also says `exact`, but it verifies with `ecrecover` and can never accept a contract payer, so it is never picked.
5. Refuse a price above `max_amount`.
6. Check the tab's terms, read a moment ago from the chain: payee listed, price within the maximum, money left, not closed, not about to expire. A refusal here is written to the bill with the term that stopped it. The contract enforces the same rules; this check exists so that a payment the contract would refuse is never signed or sent.
7. Write `pending` to disk. Then sign, with the stock x402 client. The only parts that are ours are the signer, whose address is the tab and whose signature is the 213 bytes, and the clock check in `src/x402Sign.ts` ([finding 08](findings/08-x402-client-validbefore-local-clock.md)). Write the authorization's nonce to disk before the signature leaves.
8. Send it. The seller passes it to its facilitator, which calls USDC, which calls the tab.
9. If the seller says it settled, read that back from the chain before believing it, then drop the signed header and write the payment on the bill.

The agent's key never sends a transaction and never needs gas. The facilitator's relayer does.

## When the answer never comes

A timeout, a 5xx, a seller saying `settlement_pending`. The payment may or may not have happened, and paying again might pay twice. Circle's `/status` cannot help a buyer: it needs a proof signed by the seller's key. The buyer has something better. USDC records every authorization it has used, so `pay.ts` asks the chain whether its nonce was consumed. Used means paid: it finds the transfer and asks the seller again with the same signature to collect what it paid for. Unused past `validBefore` means it can never be used. Anything else stays `unconfirmed` and blocks a second payment for that request.

## Closing

`close_tab` destroys the agent key on the spot, so nothing here can sign for that tab again, and returns the owner's command. `npx barkeep-arc-owner close <tab_id>` calls `Tab.close()`, which sets `closed` first and then sends whatever is left to the owner. If USDC refuses that transfer, the tab is closed anyway and the owner can call `close()` again to collect. Revoking the agent never depends on the money moving.

## What is enforced where

| Rule | Enforced by | If the server is buggy or hostile |
|---|---|---|
| Who can be paid, how much per payment, until when | `Tab.isValidSignature`, on chain | still holds |
| How much in total | the tab's USDC balance | still holds |
| Closed means closed | `Tab.closed`, on chain | still holds |
| Only the owner opens, funds and closes | the owner's key, which the server does not have | still holds |
| `max_amount` for one request | `pay.ts`, and x402's own spend control | does not hold |
| Never pay the same request twice | `pay.ts` and its records on disk | does not hold; the loss is bounded by the tab |

What the contract cannot do is in [SECURITY.md](SECURITY.md): anyone can send USDC to a tab, a view cannot rate-limit, and a listed payee can be anyone the owner chose to list.
