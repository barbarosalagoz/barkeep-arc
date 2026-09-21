import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentKeys } from "../src/agentKeys.ts";
import { tempDir } from "./helpers.ts";

describe("per-tab agent keys", () => {
  it("keeps each key in a 600 file inside a 700 directory and hands out only the address", () => {
    const dir = tempDir();
    const keys = new AgentKeys(dir);
    const address = keys.create("tab_000000000001");

    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(statSync(join(dir, "agents")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "agents", "tab_000000000001.json")).mode & 0o777).toBe(0o600);
    expect(keys.account("tab_000000000001").address).toBe(address);
  });

  it("gives every tab its own key and never overwrites one", () => {
    const keys = new AgentKeys(tempDir());
    expect(keys.create("tab_000000000001")).not.toBe(keys.create("tab_000000000002"));
    expect(() => keys.create("tab_000000000001")).toThrow(/already has/);
  });

  it("destroys a key for good", () => {
    const dir = tempDir();
    const keys = new AgentKeys(dir);
    keys.create("tab_000000000001");
    expect(keys.destroy("tab_000000000001")).toBe(true);
    expect(keys.has("tab_000000000001")).toBe(false);
    expect(readdirSync(join(dir, "agents"))).toEqual([]);
    expect(() => keys.account("tab_000000000001")).toThrow(/no agent key/);
    expect(keys.destroy("tab_000000000001")).toBe(false);
  });

  it("will not be talked into another path", () => {
    const keys = new AgentKeys(tempDir());
    for (const bad of ["../keys", "tab_../../x", "keys.json", "", "tab_XYZ"]) {
      expect(() => keys.create(bad)).toThrow(/not a tab id/);
      expect(() => keys.account(bad)).toThrow(/not a tab id/);
    }
  });

  it("stores nothing but the key record", () => {
    const dir = tempDir();
    new AgentKeys(dir).create("tab_000000000001");
    expect(Object.keys(JSON.parse(readFileSync(join(dir, "agents", "tab_000000000001.json"), "utf8"))).sort()).toEqual(["address", "createdAt", "privateKey", "tabId"]);
  });
});
