<!-- Draft written by Claude for the author's review. -->

# Contracts

`src/Tab.sol` (the tab), `src/TabFactory.sol` (opens and funds tabs), `src/IUSDC.sol` (the three USDC calls they make). 317 lines together. Dependencies: OpenZeppelin Contracts v5.7.0 (`Clones`, `ECDSA`, `IERC1271`) and forge-std v1.16.2, both git submodules pinned to a tag.

## Arc Foundry, not Foundry

Upstream `forge` runs a standard EVM. It has no USDC at `0x3600…`, no native-balance ERC-20 view and no blocklist at transaction validation, so a suite run with it proves nothing about Arc. `test/Sanity.t.sol` and the `require` at the top of `test/utils/Base.sol` fail loudly if that happens.

Install [Arc Foundry](https://github.com/circlefin/arc-foundry) v0.8.0-1 as `arc-forge`, `arc-cast` and `arc-anvil` (verify the `.sha256`; on macOS it needs `brew install libusb`). CI does the same through `.github/install-arc-foundry.sh`.

`arc-forge test` on its own does not deploy Arc's system contracts. `arc-anvil --network arc` does, so the tests fork from one:

```shell
arc-anvil --network arc --port 8555 &
cd contracts
arc-forge test --fork-url http://127.0.0.1:8555      # 68 tests: unit, fuzz, invariant
python3 script/mutation-check.py                     # removes each security check in turn; every mutant must die
```

The same suite runs unchanged against a fork of a live network. Forking sends nothing:

```shell
arc-forge test --fork-url https://rpc.testnet.arc.io
arc-forge test --fork-url https://rpc.mainnet.arc.io
```

## Slither

```shell
mkdir -p ~/as-forge && ln -sf "$(command -v arc-forge)" ~/as-forge/forge   # crytic-compile shells out to `forge`
PATH="$HOME/as-forge:$PATH" slither .
```

`slither.config.json` fails on medium and above. The one inline suppression is explained in [docs/SECURITY.md](../docs/SECURITY.md).

## Things Arc does that the tests ran into

- The invariant fuzzer's random senders are rejected before execution with `transaction validation error: Blocked address`. The suites pin one sender (`targetSender`).
- A transfer that would empty a fresh account (no code, nonce 0) reverts with `Cannot clear balance of empty account`. A tab has code, so spending it to zero and closing it both work; `test_the_agent_can_spend_the_whole_cap_and_not_a_unit_more` and `test_closing_an_empty_tab_is_fine` cover that.
- `vm.deal` funds USDC: the native balance (18 decimals) and the ERC-20 view (6 decimals) are one balance.
