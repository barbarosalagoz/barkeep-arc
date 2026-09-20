<!-- Draft written by Claude for the author's review. Phase 1 only: contracts. The MCP server, keys in use and deployment get their sections in later phases. -->

# Security

Unaudited. Nobody other than the author and the tools below has reviewed these contracts. Do not put in a tab more than you are prepared to lose.

## What the contract promises

A tab opened through `TabFactory.openTab` holds `cap` USDC. Until the owner closes it:

1. Only the agent key can make the tab approve a transfer, and only a USDC `TransferWithAuthorization` out of that tab on this chain.
2. The transfer goes to a listed payee, moves at most `maxPerCall`, and cannot be submitted after `expiry` (the tab refuses any authorization whose `validBefore` is later than `expiry`, and refuses everything once `block.timestamp > expiry`).
3. The owner, and nobody else, can close the tab. Closing is permanent and returns the whole balance to the owner.
4. Nothing about a tab can change after it is opened. Owner, agent, payees, `maxPerCall` and `expiry` are in the clone's bytecode. `closed` is the only storage.
5. The factory has no owner, no admin function and no storage, and never holds funds.

Each line has tests in `contracts/test/`, and `contracts/script/mutation-check.py` deletes each check from `Tab.sol` in turn and each validation from `TabFactory.sol`, in turn, to prove a test notices: 24 of 24 mutants die.

## What it does not promise

**The balance can exceed the cap.** Anyone can send USDC to a tab and nothing on chain can refuse it. The agent can then spend that money too, under the same payee, per-call and expiry rules. The owner's exposure is still the cap: the agent can never move more than was put in. The spec for this project said "balance never exceeds the cap"; that holds only while nobody donates, and the invariant suite states both versions separately (`TabInvariantTest` without donations, `TabInvariantWithDonationsTest` with).

**No rolling window.** Barkeep on Stellar refills a spending limit every window. A tab here does not refill. When the money is gone the owner opens another tab.

**No cumulative counter, on purpose.** USDC's EIP-3009 burns each authorization nonce on first use, and the digest names the tab as `from`, so an authorization works once, for this tab only. Replaying everything the agent ever signed moves nothing (`test_an_authorization_cannot_be_replayed`), and new signatures can never move more than the balance (`test_the_agent_can_spend_the_whole_cap_and_not_a_unit_more`). A counter would be a second source of truth that could disagree with the balance.

**`isValidSignature` is a view.** It cannot record anything, so it cannot rate-limit. `maxPerCall` bounds one payment, not the speed of many. An agent key that leaks can drain the tab to the listed payees as fast as blocks come. The payees are the owner's choice; list only addresses you would pay.

**A payee the owner lists can be the agent itself**, or an address the agent controls. The contract does not second-guess the list.

**Tabs not opened by the factory carry no guarantees.** Anyone can clone the implementation with any arguments, including zero payees or a past expiry. The factory validates; the tab only reads. The MCP server (phase 2) must check that a tab's address equals `factory.predictTab(...)` for its terms before trusting it.

**USDC's own controls sit above all of this.** Circle can blocklist an address or pause USDC. If the owner is blocklisted, `close()` reverts and the money stays in the tab. Arc also enforces the blocklist at transaction validation.

**Dust.** USDC on Arc is the native balance seen through a 6-decimal ERC-20 view. `close()` sweeps the ERC-20 balance. Anything below 0.000001 USDC that was force-sent as native value stays behind. The tab has no `receive` or payable function.

**Timestamps.** Expiry compares against `block.timestamp`. Arc blocks are about half a second apart and final on commit; a validator skewing a timestamp by seconds moves the expiry by seconds.

**The keys are not the contract's problem, and are the biggest one.** Phase 2 has to keep the owner key away from the process that holds the agent key. On Stellar, `bin/barkeep-mcp` read both; that must not be repeated here.

## Design decisions worth a reviewer's time

- **Immutable arguments instead of `initialize`.** A minimal proxy cannot have Solidity `immutable`s of its own, so the usual pattern is storage plus an initializer, which is a front-running and re-initialization surface. OpenZeppelin `Clones.cloneDeterministicWithImmutableArgs` appends the terms to the proxy's bytecode instead. The address then depends on the terms, so nobody can deploy different terms at a predicted address.
- **The owner is always `msg.sender`, and the owner is in the bytecode**, so the address depends on who opens the tab and a stranger cannot take it first (`test_the_address_depends_on_who_opens_it`). I first also hashed the caller into the CREATE2 salt. The mutation check showed that did nothing: with it removed, every test still passed, because the address already differed. The redundant code is gone.
- **The implementation refuses to be a tab.** Called directly, `isValidSignature` returns the refusal and `terms()`/`close()` revert `NotATab`, because reading "clone arguments" from the implementation's own code would decode garbage.
- **The hash check comes first among the semantic checks.** USDC also calls ERC-1271 for `permit`, `receiveWithAuthorization` and `cancelAuthorization`. Those digests use other typehashes, so they can never equal the transfer digest the tab rebuilds, whatever fields are appended. Each has a test against real USDC.
- **USDC's `v, r, s` overload cannot be used with a tab.** It hands the tab 65 bytes; the tab wants 213. The stock x402 facilitator picks that overload for 65-byte signatures only, which is why the spike tested a longer one.
- **`close()` sets `closed` before the single external call**, emits, then transfers, and transfers even when the balance is zero so there is no balance comparison to reason about.
- **Assembly.** None in `src/`. OpenZeppelin's `Clones` and `ECDSA` use it internally.

## Slither

Slither 0.11.6, `contracts/slither.config.json`, `fail_on: medium`. Current result: 0 high, 0 medium, 2 low, 2 informational.

What it found on the first run, and what happened:

| Finding | Impact | Where | Outcome |
|---|---|---|---|
| `reentrancy-balance` | High | `Tab.close()` | The balance read before `USDC.transfer` was used in the same `if` as the call. Not exploitable (the use was evaluated before the call, and the callee is USDC), but the code was restructured rather than argued with: read, emit, transfer, check. Gone. |
| `incorrect-equality` | Medium | `Tab.close()` | Appeared after that restructure, from an `if (amount == 0) return;`. Removed the early return; a zero transfer succeeds on Arc's USDC (`test_closing_an_empty_tab_is_fine`, also run against Testnet and Mainnet forks). Gone. |
| `unused-return` | Medium | `Tab.isValidSignature` | `ECDSA.tryRecoverCalldata` returns `(address, RecoverError, bytes32)`. The third value only carries detail for an error message, and this function gives no reasons by design. Suppressed inline with `// slither-disable-next-line unused-return` and this justification. The first two values are both checked. |
| `timestamp` | Low | `Tab.isValidSignature`, `TabFactory.openTab` | Expiry is a timestamp by design. See "Timestamps" above. Left. |
| `naming-convention` | Informational | `SELF`, `IMPLEMENTATION` | Immutables in capitals, which `forge lint` asks for. Left. |

## Tests

68 tests, all against Arc's real USDC at `0x3600…` (never a mock), run three ways: a local `arc-anvil --network arc`, a fork of Arc Testnet, a fork of Arc Mainnet. Forking sends nothing.

- Accept paths: `test/Tab.accept.t.sol` (8, one fuzz).
- Refuse paths: `test/Tab.refuse.t.sol` (23, three fuzz). Each refusal is asserted twice: the tab returns `0xffffffff`, and USDC reverts `FiatTokenV2: invalid signature` and moves nothing.
- Close: `test/Tab.close.t.sol` (7). Factory: `test/TabFactory.t.sol` (11). Sanity that the suite is really on Arc: `test/Sanity.t.sol` (3).
- Invariants: `test/invariant/` (16), 128 runs of 64 calls each. A handler tries everything (agent paying well and badly, wrong keys, time passing, owner closing, others trying to close, donations) and judges each attempt against a model written without reference to the contract. Any disagreement in either direction fails `invariant_no_attempt_ever_contradicts_the_model`.

Three mistakes of mine the process caught. The redundant salt, above. The donation action in the first invariant run reverted every time (Arc refuses a transfer that empties a fresh account), so the donations suite was passing while testing nothing; it now has a guard that fails if no donation lands. And the first mutation run looked as if the invariants missed several mutants; that was the script's parser not reading invariant failures, and a by-hand run confirmed they were caught.

Not done: no formal verification, no differential test against a second implementation, no gas-griefing analysis of `isValidSignature` (it costs 8k to 17k gas with up to 20 payees).

## Graph review

graphify has no Solidity parser. It found 4 files in this repository on its own. The 11 `.sol` files went through its semantic pass instead, read by a model and asked for one node per function, check, event and error, `calls` edges only where a line could be cited, and `references` edges from each test to what it exercises. So the contract part of this graph is a careful reading, not an AST, and should be trusted accordingly. The report is [GRAPH_REPORT.md](GRAPH_REPORT.md): 292 nodes, 865 edges (721 extracted, 138 inferred), 10 communities. It was generated before the two fixes it led to, below.

What it flagged and what was done:

- God nodes. `Tab.isValidSignature()` is the most connected node (46 edges), then this file, the invariant `Handler`, `Tab`, and the test helpers `Base._auth()` and `Base._sign()`. That is the shape the design intends: one function carries the product. It also means `_auth` and `_sign` are a single point of failure for the tests. If `_sign` built the wrong digest, the accept tests would fail, and they do not; the refuse tests are protected by the mutation check, which shows each one fails for the reason it names.
- Source nodes no test touches. I queried the graph for nodes under `contracts/src/` with no edge from any test. Two were real: `Tab.TransferFailed` and `TabFactory.FundingFailed`. Arc's USDC reverts instead of returning `false`, so those branches were never reached. Added `test_a_false_return_from_usdc_reverts_the_close_and_leaves_the_tab_open` and `test_a_false_return_from_usdc_reverts_the_opening` (both mock the return), plus mutants for each. The rest of that list was file nodes, the `Terms` struct, two constants and OpenZeppelin functions.
- Tests per check. Every `isValidSignature` check has between 4 and 7 tests pointing at it, except the implementation guard (`address(this) == SELF`), `close`'s owner check and `terms`' guard, with 1 each. One direct test each is enough for a two-line guard; the owner check is also exercised by the invariant handler's `someoneElseTriesToClose`.
- External calls out of `src/`. Nine, all cited to a line: three to USDC from `Tab` (`balanceOf` twice, `transfer` once in `close`), one to USDC from the factory (`transferFrom`), and five into OpenZeppelin (`fetchCloneArgs` twice, `tryRecoverCalldata`, `cloneDeterministicWithImmutableArgs`, `predictDeterministicAddressWithImmutableArgs`). No call to an address supplied by a user. This matches the spec's "no reentrancy surface beyond the one USDC call" for `close`.
- Dangling edges. 4, all from `contracts/script/mutation-check.py` to Python standard library modules (`re`, `subprocess`, `sys`, `pathlib`) that are not in the corpus. No missing endpoints, no self-loops, no collapsed edges. Nothing to do.
- Cohesion. The lowest-scoring community (0.06) is tooling and docs, which is a grab bag by nature. The contract communities score 0.09 to 0.14; with 317 lines of source there is nothing to split.

## Reporting

Open a GitHub security advisory on the repository, or email the author. There is no bounty.
