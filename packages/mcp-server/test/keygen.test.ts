import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateNamedKey, namedAccount } from "../src/owner/keyfile.ts";
import { tempDir } from "./helpers.ts";

afterEach(() => delete process.env.BARKEEP_ARC_KEYS_FILE);

describe("owner keygen", () => {
  it("writes the key to a 600 file, returns only the address, and the address is the key's", () => {
    const file = (process.env.BARKEEP_ARC_KEYS_FILE = join(tempDir(), "keys.json"));
    const made = generateNamedKey("mainnetOwner");

    expect(Object.keys(made).sort()).toEqual(["address", "file"]);
    expect(JSON.stringify(made)).not.toMatch(/[0-9a-f]{64}/i);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(namedAccount("mainnetOwner").address).toBe(made.address);
  });

  it("keeps the keys already in the file and never replaces one", () => {
    const file = (process.env.BARKEEP_ARC_KEYS_FILE = join(tempDir(), "keys.json"));
    const first = generateNamedKey("mainnetOwner");
    const second = generateNamedKey("mainnetSeller");

    expect(second.address).not.toBe(first.address);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual(["mainnetOwner", "mainnetSeller"]);
    expect(() => generateNamedKey("mainnetOwner")).toThrow(/will not be replaced/);
    expect(namedAccount("mainnetOwner").address).toBe(first.address);
  });

  it("refuses names that could be anything but a name", () => {
    process.env.BARKEEP_ARC_KEYS_FILE = join(tempDir(), "keys.json");
    for (const bad of ["", "a", "../x", "__proto__", "with space", "9lives"]) expect(() => generateNamedKey(bad)).toThrow(/key names are/);
  });
});
