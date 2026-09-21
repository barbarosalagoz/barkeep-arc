<!-- Draft written by Claude for the author's review. -->

# @barkeep-arc/mcp

The MCP server for Claude Code, and the owner's command line. Two programs, on purpose.

## Two programs, two kinds of key

`bin/barkeep-arc-mcp` is the MCP server. The only keys it ever holds are per-tab agent keys that it makes itself (`src/agentKeys.ts`, one 600-mode file per tab under the state directory). An agent key can do one thing: make its own tab approve a USDC transfer within that tab's terms. The server has no wallet client and no code path that sends a transaction. `test/boundary.test.ts` fails the build if that stops being true: it walks the server's import graph and checks it reaches nothing under `src/owner/`, never names the owner's key file, builds accounts from private keys in `agentKeys.ts` only, and contains no call that writes to the chain.

`bin/barkeep-arc-owner` uses the owner's key (`~/.local/state/barkeep-arc/keys.json`, read only by `src/owner/keyfile.ts`). It is not an MCP tool. A human runs it in a terminal; it prints the terms and asks before it signs.

On Stellar, `bin/barkeep-mcp` read both the admin and the agent key, so the contract stopped the agent's key but not a process holding both. That is what this split fixes. It is a separation by process and by code, not by the operating system: both run as the same user.

## The four tools

| Tool | What it does | What it cannot do |
|---|---|---|
| `open_tab` | Validates the terms, makes the agent key, records the request, returns `npx barkeep-arc-owner open <tab_id>` | Open or fund anything |
| `pay_and_fetch` | Fetches a URL; on an x402 v2 challenge payable in USDC on Arc, checks the tab's on-chain terms, signs with the stock x402 client (the tab is the payer, the agent key signs, 213-byte signature), returns the resource | Pay twice for one request; pay a Circle Gateway batched option (ecrecover only) |
| `tab_status` | Reads balance, payees, maximum, expiry and closure from the chain, after checking the factory vouches for the address and terms; shows the bill including refusals | Trust its own files |
| `close_tab` | Destroys the agent key, at once and for good; returns `npx barkeep-arc-owner close <tab_id>` | Close the contract or move the money |

The spec for this project had `open_tab` deploying and `close_tab` sweeping. With per-tab agent keys only, the server cannot, so both hand the on-chain step to the owner. `close_tab` still ends the agent's ability to spend immediately, because the key is gone.

## When a payment's outcome is unknown

The facilitator's `/status` belongs to the seller: Circle's needs a proof signed by the `payTo` key. The buyer has something better. USDC records every used EIP-3009 authorization, so after a timeout, a 5xx or a `settlement_pending`, `pay_and_fetch` asks the chain whether its nonce was consumed (`authorizationState`). Used means paid: it finds the transfer, then asks the seller again with the same signature to collect the resource. Unused past `validBefore` means it can never settle. Anything else stays `unconfirmed` and blocks a second payment. It never signs again for the same request.

## Run

```shell
npm ci
npm run typecheck
npm run test:unit                        # offline

arc-anvil --network arc --port 8555 &    # Arc Foundry; see contracts/README.md
(cd contracts && arc-forge build)
ARC_ANVIL_RPC=http://127.0.0.1:8555 npm run test:int   # A1 to A6 rehearsed against the real contracts and USDC
```

Register the server with Claude Code (it needs no secret in its configuration):

```shell
claude mcp add barkeep-arc --scope local -- "$PWD/packages/mcp-server/bin/barkeep-arc-mcp"
```

State lives in `~/.local/state/barkeep-arc/mcp/` (`BARKEEP_ARC_STATE_DIR` overrides). The network is `BARKEEP_ARC_NETWORK` (`arc-testnet` by default); the factory comes from `deployments/<network>.json` or `BARKEEP_ARC_FACTORY`.

Not yet done: nothing here has run against Arc Testnet or Circle's facilitator. That is phase 3.
