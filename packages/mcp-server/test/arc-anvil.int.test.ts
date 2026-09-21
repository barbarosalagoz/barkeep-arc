/*
 * The server's own code against the real contracts and Arc's real USDC, on a
 * local Arc chain. Nothing is mocked but the seller, which is a real HTTP server
 * in this process, settling through the STOCK @x402/evm facilitator.
 *
 *   arc-anvil --network arc --port 8555 &
 *   (cd contracts && arc-forge build)
 *   ARC_ANVIL_RPC=http://127.0.0.1:8555 npm run test:int
 *
 * It is the local rehearsal of the Testnet done-tests A1 to A6. It proves the
 * 213-byte signature this package builds is the one Tab.sol accepts, which no
 * unit test can. Skipped when ARC_ANVIL_RPC is not set.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { x402Facilitator } from "@x402/core/facilitator";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as FacilitatorScheme } from "@x402/evm/exact/facilitator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, publicActions, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { USDC_ABI } from "../src/abi.ts";
import { AgentKeys } from "../src/agentKeys.ts";
import { ArcChain } from "../src/chain.ts";
import { USDC, USDC_DOMAIN, type Network } from "../src/network.ts";
import { closeTab, deployFactory, openTab } from "../src/owner/actions.ts";
import { createPayer } from "../src/pay.ts";
import { Store } from "../src/state.ts";
import { requestClose, requestOpen, syncTab, tabStatus } from "../src/tabs.ts";
import { createSigner } from "../src/x402Sign.ts";
import { tempDir } from "./helpers.ts";

const RPC = process.env.ARC_ANVIL_RPC;

describe.skipIf(!RPC)("on a local Arc chain, against the real USDC", () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey());
  const payee = privateKeyToAccount(generatePrivateKey()).address;
  const outsider = privateKeyToAccount(generatePrivateKey()).address;

  let net: Network;
  let client: ReturnType<typeof createPublicClient>;
  let chain: ArcChain;
  let store: Store;
  let keys: AgentKeys;
  let factory: Address;
  let seller: Server;
  let sellerUrl: string;
  let tabId: string;
  let tabAddress: Address;
  let pay: ReturnType<typeof createPayer>;
  /** "settle" answers honestly; "pending" settles and then claims settlement_pending, once. */
  let snapshot: Hex | undefined;
  let sellerMode: "settle" | "pending" = "settle";
  const settledNonces = new Set<string>();

  const usdc = (who: Address) => client.readContract({ address: USDC, abi: USDC_ABI, functionName: "balanceOf", args: [who] });
  const ownerWallet = () => createWalletClient({ account: owner, chain: net.chain, transport: http(RPC) });

  beforeAll(async () => {
    const probe = createPublicClient({ transport: http(RPC) });
    const chainId = await probe.getChainId();
    expect((await probe.getCode({ address: USDC }))?.length ?? 0, "no USDC at 0x3600: this is not arc-anvil --network arc").toBeGreaterThan(2);

    const viemChain = defineChain({ id: chainId, name: "arc-anvil", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC!] } } });
    net = { name: "arc-testnet", chainId, caip2: `eip155:${chainId}`, rpcUrl: RPC!, explorer: "http://localhost", chain: viemChain };
    client = createPublicClient({ chain: viemChain, transport: http(RPC) });
    chain = new ArcChain(net, client as never);

    const test = createTestClient({ mode: "anvil", chain: viemChain, transport: http(RPC) });
    // A4 moves the chain's clock forward. Restore it afterwards, or the next run starts on a chain that is ahead of
    // this machine and every authorization arrives expired.
    // Only a chain that is AHEAD matters. An idle anvil mines nothing, so its last block is simply old.
    await test.mine({ blocks: 1 });
    const ahead = Number((await client.getBlock()).timestamp) - Math.floor(Date.now() / 1000);
    expect(ahead, `the local chain's clock is ${ahead}s ahead of this machine's; restart arc-anvil`).toBeLessThan(30);
    snapshot = await test.snapshot();
    for (const who of [owner.address, relayer.address]) await test.setBalance({ address: who, value: parseEther("100") });
    // A payee that has never held anything would be a fresh account; give both a little so transfers to them are ordinary.
    for (const who of [payee, outsider]) await test.setBalance({ address: who, value: parseEther("1") });

    const artifact = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../contracts/out/TabFactory.sol/TabFactory.json"), "utf8")) as { abi: unknown; bytecode: { object: Hex } };
    factory = (await deployFactory(net, ownerWallet(), client as never, { abi: artifact.abi, bytecode: artifact.bytecode.object }, false)).address;

    /* ---- the stock facilitator, and a seller in front of it ---- */
    const relay = createWalletClient({ account: relayer, chain: viemChain, transport: http(RPC) }).extend(publicActions);
    const facilitator = new x402Facilitator().register(
      net.caip2,
      new FacilitatorScheme(
        toFacilitatorEvmSigner({
          address: relayer.address,
          readContract: (a) => relay.readContract(a as never),
          verifyTypedData: (a) => relay.verifyTypedData(a as never),
          writeContract: (a) => relay.writeContract(a as never),
          sendTransaction: (a) => relay.sendTransaction(a as never),
          waitForTransactionReceipt: (a) => relay.waitForTransactionReceipt(a),
          getCode: (a) => relay.getCode(a),
        })
      )
    );

    const routes: Record<string, { payTo: Address; amount: string }> = {
      "/haiku": { payTo: payee, amount: "250000" },
      "/pricey": { payTo: payee, amount: "1000001" },
      "/outsider": { payTo: outsider, amount: "1000" },
    };

    seller = createServer(async (req, res) => {
      const route = routes[(req.url ?? "/").split("?")[0]];
      if (!route) return void res.writeHead(404).end();
      const requirements: PaymentRequirements = { scheme: "exact", network: net.caip2, asset: USDC, amount: route.amount, payTo: route.payTo, maxTimeoutSeconds: 120, extra: { ...USDC_DOMAIN } };

      const header = req.headers["payment-signature"];
      if (typeof header !== "string") {
        const required = { x402Version: 2, resource: { url: `${sellerUrl}${req.url}`, description: "a haiku", mimeType: "text/plain" }, accepts: [requirements] };
        return void res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) }).end("{}");
      }

      const payload = decodePaymentSignatureHeader(header);
      const nonce = (payload.payload as { authorization: { nonce: string } }).authorization.nonce;
      // A seller that has already been paid for this exact authorization serves it again rather than charging again.
      if (settledNonces.has(nonce)) return void res.writeHead(200, { "content-type": "text/plain" }).end("served again for the same payment");

      const verify = await facilitator.verify(payload, requirements);
      if (!verify.isValid) return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ error: verify.invalidReason }));

      const settle = await facilitator.settle(payload, requirements);
      if (!settle.success) return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ error: settle.errorReason }));
      settledNonces.add(nonce);

      if (sellerMode === "pending") {
        sellerMode = "settle";
        return void res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ errorReason: "settlement_pending" }));
      }
      res.writeHead(200, { "content-type": "text/plain", "PAYMENT-RESPONSE": encodePaymentResponseHeader(settle) }).end("Half a second, then /\nnothing left to reorganise");
    });
    await new Promise<void>((r) => seller.listen(0, "127.0.0.1", r));
    sellerUrl = `http://127.0.0.1:${(seller.address() as { port: number }).port}`;

    store = new Store(tempDir());
    keys = new AgentKeys(store.dir);
    pay = createPayer({ store, chain, fetch: globalThis.fetch, verify: (t) => chain.verifiedTab(t), sign: createSigner(net, keys), settleWaitMs: 20_000, settlePollMs: 250 });
  }, 120_000);

  afterAll(async () => {
    seller?.close();
    if (snapshot) await createTestClient({ mode: "anvil", chain: net.chain, transport: http(RPC) }).revert({ id: snapshot });
  });

  const current = () => store.getTab(tabId)!;

  it("A1a: open_tab asks, the owner opens and funds, tab_status reads it back from the chain", async () => {
    const asked = await requestOpen(store, keys, chain, factory, { limit: "5", max_per_call: "1", window: "PT1H", payees: [payee] });
    tabId = asked.tab_id;
    expect((await tabStatus(store, keys, chain, current())).status).toBe("requested, not open yet");

    const before = await usdc(owner.address);
    const opened = await openTab(net, ownerWallet(), client as never, store, tabId);
    tabAddress = opened.tab;

    expect(await usdc(tabAddress)).toBe(5_000_000n);
    expect(await client.readContract({ address: USDC, abi: USDC_ABI, functionName: "allowance", args: [owner.address, factory] })).toBe(0n);
    expect(before - (await usdc(owner.address))).toBeGreaterThanOrEqual(5_000_000n);

    const status = await tabStatus(store, keys, chain, current());
    expect(status).toMatchObject({ status: "open", can_spend: true, balance: "5 USDC", spent: "0 USDC", max_per_call: "1 USDC", payees: [payee], owner: owner.address });
  }, 60_000);

  it("A1b: the agent pays an allowlisted payee through the stock facilitator, and the balance drops", async () => {
    const { tab } = await syncTab(store, chain, current());
    const result = await pay(tab, { url: `${sellerUrl}/haiku`, max_amount: "0.5" });

    expect(result).toMatchObject({ paid: true, amount: "0.25 USDC", pay_to: payee });
    expect(result.body).toMatch(/Half a second/);

    const receipt = await client.getTransactionReceipt({ hash: result.tx as Hex });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(relayer.address.toLowerCase()); // the agent key never sends a transaction
    expect(await usdc(tabAddress)).toBe(4_750_000n);
    expect(await tabStatus(store, keys, chain, current())).toMatchObject({ balance: "4.75 USDC", spent: "0.25 USDC" });
  }, 60_000);

  it("A2: above the per-call maximum is refused before signing; forced, the tab and USDC refuse it on chain", async () => {
    await expect(pay(current(), { url: `${sellerUrl}/pricey`, max_amount: "2" })).rejects.toThrow(/per-call maximum/);
    expect(await usdc(tabAddress)).toBe(4_750_000n);

    // Forced: sign it anyway, as a buggy or hostile server would, and ask the chain.
    const forced = await forceSign("1000001", payee);
    expect(await chain.simulateTransfer(forced.auth, forced.signature)).toMatch(/FiatTokenV2: invalid signature/);
  }, 60_000);

  it("A3: a payee not on the list is refused before signing; forced, refused on chain and by the facilitator", async () => {
    await expect(pay(current(), { url: `${sellerUrl}/outsider`, max_amount: "0.5" })).rejects.toThrow(/not one of this tab's payees/);

    const forced = await forceSign("1000", outsider);
    expect(await chain.simulateTransfer(forced.auth, forced.signature)).toMatch(/FiatTokenV2: invalid signature/);

    const answer = await fetch(`${sellerUrl}/outsider`, { headers: { "PAYMENT-SIGNATURE": forced.header } });
    expect(answer.status).toBe(402);
    expect(((await answer.json()) as { error: string }).error).toMatch(/^invalid_/);
    expect(await usdc(outsider)).toBe(1_000_000n);
  }, 60_000);

  it("A6: the seller claims settlement_pending; the chain is asked, nothing is signed twice, the resource is collected", async () => {
    sellerMode = "pending";
    const before = await usdc(tabAddress);
    const result = await pay(current(), { url: `${sellerUrl}/haiku`, max_amount: "0.5", request_id: "pending-case" });

    expect(result.paid).toBe(true);
    expect(result.note).toMatch(/settlement_pending.*the chain shows the payment was made/);
    expect(result.body).toBe("served again for the same payment");
    expect(before - (await usdc(tabAddress))).toBe(250_000n); // paid once, not twice
    expect((await client.getTransactionReceipt({ hash: result.tx as Hex })).status).toBe("success");
  }, 60_000);

  it("A5: close_tab destroys the agent key; the owner closes; the tab is empty and refuses even a well-formed payment", async () => {
    const stillSigned = await forceSign("1000", payee); // made while the key exists, presented after the close
    const closing = await requestClose(store, keys, chain, current());
    expect(closing.agent_key).toMatch(/^destroyed/);
    await expect(pay(current(), { url: `${sellerUrl}/haiku`, max_amount: "0.5", request_id: "after-close" })).rejects.toThrow(/is closed/);

    const ownerBefore = await usdc(owner.address);
    const closed = await closeTab(net, ownerWallet(), client as never, store, tabId);
    expect(closed).toMatchObject({ swept: true, balanceAfter: 0n });
    expect((await usdc(owner.address)) - ownerBefore).toBeGreaterThan(4_000_000n);

    expect(await chain.simulateTransfer(stillSigned.auth, stillSigned.signature)).toMatch(/FiatTokenV2: invalid signature/);
    expect(await tabStatus(store, keys, chain, current())).toMatchObject({ status: "closed on chain", can_spend: false, balance: "0 USDC", agent_key_here: false });
  }, 60_000);

  it("A4: after expiry the tab refuses, before signing and on chain", async () => {
    const asked = await requestOpen(store, keys, chain, factory, { limit: "1", max_per_call: "0.5", window: "PT2M", payees: [payee] });
    tabId = asked.tab_id;
    tabAddress = (await openTab(net, ownerWallet(), client as never, store, tabId)).tab;
    const { tab } = await syncTab(store, chain, current());

    const whileOpen = await forceSign("1000", payee);
    expect(await chain.simulateTransfer(whileOpen.auth, whileOpen.signature)).toBeNull();

    const test = createTestClient({ mode: "anvil", chain: net.chain, transport: http(RPC) });
    await test.increaseTime({ seconds: 180 });
    await test.mine({ blocks: 1 });

    await expect(pay(tab, { url: `${sellerUrl}/haiku`, max_amount: "0.5", request_id: "after-expiry" })).rejects.toThrow(/expired at/);
    expect(await chain.simulateTransfer(whileOpen.auth, whileOpen.signature)).toMatch(/expired|invalid signature/);
    expect(await usdc(tabAddress)).toBe(1_000_000n);

    // The owner gets the money back after expiry too.
    expect(await closeTab(net, ownerWallet(), client as never, store, tabId)).toMatchObject({ swept: true, balanceAfter: 0n });
  }, 60_000);

  /** Signs with the tab's real agent key, skipping this package's pre-checks: what a buggy or hostile server would send. */
  async function forceSign(amount: string, payTo: Address) {
    const { encodePaymentSignatureHeader } = await import("@x402/core/http");
    const { x402Client } = await import("@x402/core/client");
    const { ExactEvmScheme } = await import("@x402/evm/exact/client");
    const { tabSigner } = await import("../src/signature.ts");

    let auth!: Parameters<ArcChain["simulateTransfer"]>[0];
    const requirements: PaymentRequirements = { scheme: "exact", network: net.caip2, asset: USDC, amount, payTo, maxTimeoutSeconds: 60, extra: { ...USDC_DOMAIN } };
    const client402 = x402Client.fromConfig({
      schemes: [{ network: net.caip2, client: new ExactEvmScheme(tabSigner(tabAddress, keys.account(tabId), (a) => (auth = a))) }],
      spendControls: { allowedAssets: [{ network: net.caip2, asset: USDC, maxAmountPerPayment: "100000000" }] },
    });
    const payload = await client402.createPaymentPayload({ x402Version: 2, resource: { url: sellerUrl, description: "", mimeType: "text/plain" }, accepts: [requirements] });
    return { auth, signature: (payload.payload as { signature: Hex }).signature, header: encodePaymentSignatureHeader(payload) };
  }
});
