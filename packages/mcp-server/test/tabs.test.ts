import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import { AgentKeys } from "../src/agentKeys.ts";
import type { ArcChain } from "../src/chain.ts";
import { Store, storedText } from "../src/state.ts";
import { checkedPayees, requestClose, requestOpen, tabStatus } from "../src/tabs.ts";
import { FACTORY, NET, NOW, OUTSIDER, OWNER, PAYEE, TAB_ADDRESS, onChainTab, tempDir } from "./helpers.ts";

const good = { limit: "5", max_per_call: "0.25", window: "PT1H", payees: [PAYEE] };

function world(verified?: () => ReturnType<typeof onChainTab>) {
  const store = new Store(tempDir());
  const keys = new AgentKeys(store.dir);
  const chain = {
    net: NET,
    hasCode: async () => true,
    now: async () => ({ timestamp: NOW, blockNumber: 1n }),
    verifiedTab: async () => {
      if (!verified) throw new Error("not opened");
      return verified();
    },
  } as unknown as ArcChain;
  return { store, keys, chain };
}

describe("payees", () => {
  it("must be given, valid, distinct, non-zero and at most twenty", () => {
    expect(checkedPayees([PAYEE.toLowerCase()])).toEqual([PAYEE]);
    expect(() => checkedPayees([])).toThrow(/payees is required/);
    expect(() => checkedPayees(["GABC"])).toThrow(/not an EVM address/);
    expect(() => checkedPayees(["0x0000000000000000000000000000000000000000"])).toThrow(/zero address/);
    expect(() => checkedPayees([PAYEE, PAYEE])).toThrow(/twice/);
    expect(() => checkedPayees(Array.from({ length: 21 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`))).toThrow(/at most 20/);
  });
});

describe("open_tab", () => {
  it("makes an agent key, records the terms, opens nothing, and says who must", async () => {
    const w = world();
    const result = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);

    expect(result.status).toBe("requested, not open yet");
    expect(result.next_step).toMatch(new RegExp(`npx barkeep-arc-owner open ${result.tab_id}`));
    const tab = w.store.getTab(result.tab_id)!;
    expect(tab).toMatchObject({ status: "requested", cap: "5000000", maxPerCall: "250000", expiry: NOW + 3600, payees: [PAYEE], factory: FACTORY });
    expect(tab.address).toBeUndefined();
    expect(w.keys.account(result.tab_id).address).toBe(tab.agent);
  });

  it.each([
    [{ ...good, limit: "0" }, /limit must be more than zero/],
    [{ ...good, max_per_call: "0" }, /max_per_call must be more than zero/],
    [{ ...good, max_per_call: "6" }, /cannot exceed limit/],
    [{ ...good, window: "P1M" }, /ISO-8601/],
    [{ ...good, payees: [] }, /payees is required/],
    [{ ...good, limit: "1.0000001" }, /decimal places/],
  ])("refuses bad terms %#, leaving no key and no record behind", async (args, message) => {
    const w = world();
    await expect(requestOpen(w.store, w.keys, w.chain, FACTORY, args)).rejects.toThrow(message);
    expect(w.store.listTabs()).toEqual([]);
  });

  it("never writes the agent key into the store", async () => {
    const w = world();
    await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    expect(storedText(w.store.dir)).not.toMatch(/privateKey/);
  });
});

describe("tab_status", () => {
  it("says a requested tab is waiting for its owner", async () => {
    const w = world();
    const { tab_id } = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    expect(await tabStatus(w.store, w.keys, w.chain, w.store.getTab(tab_id)!)).toMatchObject({ status: "requested, not open yet" });
  });

  it("believes the owner's write-back only through the chain, then reports balance as what is left", async () => {
    let agent: Address = OUTSIDER;
    const w = world(() => onChainTab(agent, { balance: 4_000_000n, maxPerCall: 250_000n }));
    const { tab_id } = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    agent = w.store.getTab(tab_id)!.agent;
    w.store.putTab({ ...w.store.getTab(tab_id)!, owner: OWNER, address: TAB_ADDRESS, openTx: `0x${"cd".repeat(32)}` });

    const status = await tabStatus(w.store, w.keys, w.chain, w.store.getTab(tab_id)!);
    expect(status).toMatchObject({ status: "open", can_spend: true, balance: "4 USDC", cap: "5 USDC", spent: "1 USDC", agent_key_here: true });
    expect(w.store.getTab(tab_id)!.status).toBe("open");
    expect(w.store.receipts(tab_id).map((r) => r.kind)).toEqual(["request", "open"]);
  });

  it("refuses to report a tab the chain does not vouch for", async () => {
    const w = world(() => {
      throw new Error("is not what factory predicts");
    });
    const { tab_id } = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    w.store.putTab({ ...w.store.getTab(tab_id)!, owner: OWNER, address: OUTSIDER });
    await expect(tabStatus(w.store, w.keys, w.chain, w.store.getTab(tab_id)!)).rejects.toThrow(/not what factory predicts/);
    expect(w.store.getTab(tab_id)!.status).toBe("requested");
  });

  it("explains a balance above the cap instead of reporting negative spend", async () => {
    const w = world(() => onChainTab(OUTSIDER, { balance: 9_000_000n }));
    const { tab_id } = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    w.store.putTab({ ...w.store.getTab(tab_id)!, owner: OWNER, address: TAB_ADDRESS });
    const status = await tabStatus(w.store, w.keys, w.chain, w.store.getTab(tab_id)!);
    expect(status.spent).toBeUndefined();
    expect(status.note_on_balance).toMatch(/above the cap/);
  });
});

describe("close_tab", () => {
  it("destroys the agent key at once and hands the on-chain close to the owner", async () => {
    const w = world(() => onChainTab(OUTSIDER, { balance: 3_000_000n }));
    const { tab_id } = await requestOpen(w.store, w.keys, w.chain, FACTORY, good);
    w.store.putTab({ ...w.store.getTab(tab_id)!, status: "open", owner: OWNER, address: TAB_ADDRESS });

    const result = await requestClose(w.store, w.keys, w.chain, w.store.getTab(tab_id)!);
    expect(result.agent_key).toMatch(/^destroyed/);
    expect(result.on_chain).toMatch(/still open on chain with 3 USDC/);
    expect(result.next_step).toMatch(new RegExp(`npx barkeep-arc-owner close ${tab_id}`));
    expect(w.keys.has(tab_id)).toBe(false);
    expect(w.store.getTab(tab_id)!.status).toBe("closed");
  });
});
