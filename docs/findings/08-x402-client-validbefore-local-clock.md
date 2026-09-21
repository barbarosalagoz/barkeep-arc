<!-- Draft written by Claude for the author's review. Facts and structure first; the prose is his to rewrite. -->

# The x402 client dates its authorization by my clock, and the chain judges it by its own

**Status:** confirmed on a local Arc chain on 2026-09-21, and reproduced against Arc Testnet the same day with the local clock shifted in process (`deployments/arc-testnet.json`, `doneTests.A8`). Not reported upstream. I searched `x402-foundation/x402` for "clock skew", "validBefore clock", "authorization is expired" and "validAfter Date.now" and found no issue about it.

## What I expected

An EIP-3009 authorization carries its own validity window, `validAfter` and `validBefore`, and USDC checks that window against `block.timestamp`. I assumed the window was the seller's business: the seller says `maxTimeoutSeconds: 60`, so the payment is good for a minute from when it is made. I did not think about whose minute. There is one chain and one USDC, so there is one clock, and a payment that was fine on the first run of a test would be fine on the second.

## What I observed

The second run of my integration test failed at the first payment, with nothing changed. Every payment came back from the stock facilitator as

```
invalid_exact_evm_transaction_simulation_failed
```

and when my code asked the chain directly what it thought of the same transfer, the chain said

```
FiatTokenV2: authorization is expired
```

The authorization had been signed less than a second earlier, with a 120 second timeout.

The first run had ended with a test that moves the chain's clock forward 180 seconds to watch a tab expire. The local chain was long-lived, so the next run started on a chain that was 180 seconds ahead of my machine: block timestamp 1789971817, `date +%s` 1789971637. The stock client builds the window from the local clock. In `@x402/evm` 2.25.0, `dist/esm/chunk-TTRSMFXP.mjs`:

```js
28:  const now = Math.floor(Date.now() / 1e3);
34:    validBefore: (now + paymentRequirements.maxTimeoutSeconds).toString(),
```

and `validAfter` is `now - 600`. So `validBefore` was my clock plus 120, which on that chain was already a minute in the past. The signature was valid, the tab's terms allowed the payment, the money was there, and the payment was dead before it left the process.

The two ends of the window are not equally forgiving. `validAfter = now - 600` tolerates a local clock ten minutes fast. `validBefore = now + maxTimeoutSeconds` tolerates a local clock only `maxTimeoutSeconds` slow, and sellers commonly ask for 60. A machine one minute behind the chain cannot pay anyone, and nothing in the refusal says why.

The facilitator does not help with the diagnosis. It has its own clock check (`validBefore < now + 6` is refused), but it runs on the facilitator's clock. Mine was on the same machine as the client, so it passed that check and failed the on-chain simulation instead, which reports only that simulation failed.

A clock that is ahead does something quieter. The authorization is valid for longer than the seller asked for, by the size of the skew. For Barkeep it also breaks a rule: a tab refuses any authorization whose `validBefore` is later than the tab's expiry, and I clamp the timeout to fit, but I computed the room from the chain's clock and the client then added it to mine.

## How I measured it

The failure, on a local Arc chain (`arc-anvil --network arc`, port 8555) that my own test had left 180 seconds ahead with `evm_increaseTime`. I ran the integration test twice against the same node: 7 of 7 the first time, failing from the first payment the second time. The version of the test that does this was never committed. I fixed it in the working tree before the phase 2 commit, so there is no commit to check out and the raw failure cannot be replayed from history. With the current tree, the same state is reached by hand, and what comes back is the guard's message, not the original one:

```sh
arc-anvil --network arc --port 8555 &
(cd contracts && arc-forge build)
arc-cast rpc evm_increaseTime 180 --rpc-url http://127.0.0.1:8555 && arc-cast rpc evm_mine --rpc-url http://127.0.0.1:8555
ARC_ANVIL_RPC=http://127.0.0.1:8555 npm run test:int
# AssertionError: the local chain's clock is 179s ahead of this machine's; restart arc-anvil
```

The second run's first failure was `The payment was refused: invalid_exact_evm_transaction_simulation_failed; asked directly, the chain says: FiatTokenV2: authorization is expired.` I only saw the chain's reason because `pay.ts` simulates a refused transfer itself and records what comes back. The facilitator's reason alone would not have told me.

The fix, offline, in `packages/mcp-server/test/x402Sign.test.ts`: the signer is handed a chain clock 180 seconds either side of the wall clock and must refuse both, and must accept 20 seconds.

On Arc Testnet, in `scripts/done-tests-testnet.ts`, A8: `Date.now` is shifted by +180 s and then −180 s inside the process, a freshly verified real tab is read from the chain, and the real signer is asked to sign a real offer. It said:

```
+180s  this machine's clock is 181s ahead of arc-testnet's (block 63223226); fix the clock. An authorization signed now would outlive what the seller asked for
-180s  this machine's clock is 179s behind arc-testnet's (block 63223226); fix the clock. An authorization signed now would already be expired
```

Nothing was signed and the tab's balance did not move. There is no transaction hash for A8, because the point is that there is no transaction.

What I did not measure: how far a real machine with NTP drifts from Arc's block timestamps. During these runs the difference was within two seconds. I also did not test a facilitator on a different machine from the client, where its own clock check might catch a slow client first and return a clearer reason.

## What it means for other builders

If a payment is refused with `invalid_exact_evm_transaction_simulation_failed` and the signature, balance and nonce all look right, compare your clock with the latest block's timestamp before anything else. Containers resumed from a snapshot, laptops waking from sleep, CI runners and any test that uses `evm_increaseTime` or `vm.warp` against a node you keep running are the likely places.

In tests, a time-travel test should put the clock back. Mine now takes an `evm_snapshot` before it starts and reverts to it afterwards, and fails up front, by name, if the chain is more than 30 seconds ahead.

In a client, the chain's clock is available for one RPC call. `x402Sign.ts` reads the latest block when it verifies the tab, compares its timestamp with `Date.now()`, and signs nothing if they differ by more than 30 seconds in either direction, saying which way and by how much. Thirty seconds is a guess that sits well above what I saw (two) and well below the smallest timeout that matters (sixty).

A client library could avoid the problem instead of detecting it, by taking `now` from the chain it is about to pay on, or by accepting a clock from the caller. I have not proposed that upstream.

## Where it has been reported

Nowhere yet. It is a behaviour of the stock client, not a bug in the sense of a wrong result: the window is built as documented. If I report it, it will be as a suggestion to take the clock from the chain or to make the facilitator's refusal say "expired" when the simulation's revert reason does.

## Record

- The client lines: `node_modules/@x402/evm/dist/esm/chunk-TTRSMFXP.mjs:28` and `:34`, `@x402/evm` 2.25.0. I read the built file; I have not matched it to a line in the upstream source tree.
- The signer's check and its wording: `packages/mcp-server/src/x402Sign.ts`, `MAX_CLOCK_SKEW`.
- Unit tests: `packages/mcp-server/test/x402Sign.test.ts`, "signs nothing when the chain's clock is … from this machine's".
- The integration test's snapshot and guard: `packages/mcp-server/test/arc-anvil.int.test.ts`, `beforeAll` and `afterAll`. The version without them was never committed.
- Testnet: `deployments/arc-testnet.json`, `doneTests.A8`.
- The clocks when it first failed: chain 1789971817, local 1789971637.
