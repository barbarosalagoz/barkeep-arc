<!-- Draft written by Claude for the author's review. Facts and structure first; the prose is his to rewrite. -->

# Barkeep on Arc

A tab for an AI agent on Arc: one small contract per tab, funded with exactly the cap, so the balance is the limit. The agent holds a key that can spend only from that tab, only to the payees the human listed, only up to a per-call maximum, and only until the tab expires. Payments are x402, settled in USDC.

It started as [Barkeep](https://github.com/barbarosalagoz/barkeep) on Stellar, where the tab is a smart-account context rule with a spending-limit policy. This is the same idea rebuilt for Arc's EVM.

Unaudited. Testnet work in progress. Nothing here has been deployed to mainnet.

## Status

Phases 1 to 3 of 5: the contracts, the MCP server with the owner's command line, and the done-tests on Arc Testnet. Nothing is on mainnet.

| Phase | What | State |
|---|---|---|
| 1 | Contracts, Foundry tests, Slither, graph review | done, see [docs/SECURITY.md](docs/SECURITY.md) |
| 2 | MCP server (`open_tab`, `pay_and_fetch`, `tab_status`, `close_tab`), the Arc adapter, the owner CLI | done, see [packages/mcp-server](packages/mcp-server/README.md) |
| 3 | Testnet done-tests A1 to A8, hashes in `deployments/arc-testnet.json` | done except the seller half of A6, see [docs/TESTNET.md](docs/TESTNET.md) |
| 4 | README, SECURITY.md, docs | not started |
| 5 | Mainnet factory, one demo tab, one real payment | not started |

## How the tab works

USDC on Arc implements EIP-3009 and, when the payer is a contract, asks that contract through ERC-1271 whether the authorization is signed. `Tab.isValidSignature` is the whole product. It receives the agent's signature followed by the fields of the transfer (213 bytes), rebuilds USDC's own EIP-712 digest from those fields, and answers yes only if the digest matches the hash it was handed, the agent signed it, the payee is listed, the value is within the maximum, and neither the clock nor the authorization outlives the expiry. Every other case gets the same `0xffffffff`, with no reason.

Everything the human decided is written into the clone's bytecode when the tab is opened (EIP-1167 with immutable arguments, CREATE2). There is no setter, no initializer and no upgrade path. The only storage is one bit, `closed`.

Whether Circle's x402 facilitator settles a payment from a contract payer with a long signature was tested before any of this was written. On Arc Testnet, its keyless trial verified and settled a payment from a throwaway ERC-1271 contract with a 97-byte signature: [`0x701e4824…740b83`](https://explorer.testnet.arc.io/tx/0x701e48243bc458028fa3bf702da00dbb94692597f3698ff9f72c8f3188740b83). The stock `@x402/evm` facilitator, self-hosted, did the same: [`0x7686f79e…0c2f2c`](https://explorer.testnet.arc.io/tx/0x7686f79ebbfcd80a44d5bf1708c38b520113a2380da1b4a62d878064320c2f2c). The spike's code is in the Stellar repo on branch `arc-1271-spike`, which is not pushed yet. A real tab's 213-byte signature has since been verified and settled by Circle's facilitator on Testnet: see [docs/TESTNET.md](docs/TESTNET.md), A7.

## Run the tests

See [contracts/README.md](contracts/README.md). They run against Arc's real USDC, never a mock, and need Arc Foundry rather than upstream Foundry.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
