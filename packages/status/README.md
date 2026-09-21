<!-- Draft written by Claude for the author's review. -->

# @barkeep-arc/status

A read-only status page for a tab. Live, against Arc Testnet: **https://barkeep-arc-status.vercel.app**

It shows a tab's owner, agent, payees, per-call maximum, expiry, whether it is closed, its USDC balance, the payments that settled (from USDC's Transfer events, each linked to the explorer), and the refused attempts from `deployments/<network>.json`, each with the transaction that reverted. As it loads it asks the chain for every one of those transactions and says whether it really reverted.

## What it cannot do

It has no wallet connection, holds no key and contains no code that can send a transaction. Three things keep it that way:

- `src/chain.ts` builds its client from viem's individual read actions, not `createPublicClient`, so nothing that sends is in the bundle. `ccipRead` is off, so no contract can point the browser at a URL.
- `test/boundary.test.ts` fails if the source imports anything but its own files and viem, names a key file or the owner's CLI, uses a wallet or signing API, or writes chain data as HTML. This package imports nothing from `packages/mcp-server`; its ABIs are copies.
- `test/bundle.test.ts` runs against the built output: no `eth_sendTransaction`, `eth_sendRawTransaction`, signing or wallet method, no key material or key path, no host other than Arc's RPCs and explorers and this repository (plus the documentation links inside viem's error strings), and a Content-Security-Policy whose `connect-src` is Arc's two RPC endpoints. Planting `eth_sendTransaction` and a key path in the source makes it fail; I checked.

The same policy is sent as an HTTP header by `vercel.json`, with `frame-ancestors 'none'`.

## Configuration

`src/config.ts`: for each network a chain id, RPC, explorer, the TabFactory address, and the tabs to show, each with the block it was opened at. Testnet (5042002) is filled in. Mainnet (5042) is listed with no factory and no tabs, and the page says nothing is deployed there. `?network=arc-testnet&tab=1` selects what to show.

Arc's public RPC answers a log query for fewer than 10,000 blocks, about eighty minutes of chain. The page scans from a tab's `openBlock` in chunks of 9,000, at most 24 per load. For a tab whose life is longer than that it scans both ends and says which blocks it skipped.

## Run and deploy

```shell
npm ci
npm run dev --workspace @barkeep-arc/status
npm run build --workspace @barkeep-arc/status && npm run test:bundle --workspace @barkeep-arc/status
packages/status/scripts/deploy.sh --prod
```

The deploy script builds here and uploads that output (`vercel build`, then `vercel deploy --prebuilt`). A build on Vercel's side sees only this folder, not `deployments/`, and ships a page with no refused attempts on it. That happened on the first deploy; the script now refuses to upload a record with none. The Vercel CLI also writes a `VERCEL_OIDC_TOKEN` into `.env.local` and into `.vercel/.env.<environment>.local` when it links or pulls. The first version of the script removed only the first of those, and a `.vercel/.env.production.local` sat on disk for a day (ignored, never tracked, since deleted). The script now removes all of them in an exit trap, so a failed deploy cleans up too; `test/deploy-script.test.ts` runs it with the CLI stubbed to fail.

The tabs shown on Testnet: a demo tab left open for thirty days with 1 USDC (`packages/mcp-server/scripts/open-demo-tab-testnet.ts`, recorded as `demoTab`), the done-tests tab, and the expiry test tab.
