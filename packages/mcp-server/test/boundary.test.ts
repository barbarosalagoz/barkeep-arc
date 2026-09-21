/*
 * The server holds per-tab agent keys only. These tests fail the build if that
 * stops being true of the code: if anything the server imports reaches
 * src/owner/, names the owner's key file, or turns a private key into an account
 * anywhere but the agent key store.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every local module reachable from an entry point, by following relative imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) visit(resolve(dirname(file), spec));
  };
  visit(join(SRC, entry));
  return [...seen].map((f) => relative(SRC, f)).sort();
}

describe("what the MCP server can reach", () => {
  const server = reachable("index.ts");

  it("is exactly these modules", () => {
    expect(server).toEqual(["abi.ts", "agentKeys.ts", "chain.ts", "index.ts", "network.ts", "pay.ts", "signature.ts", "state.ts", "tabs.ts", "units.ts", "x402Sign.ts"]);
  });

  it("includes nothing from src/owner/", () => {
    expect(server.filter((f) => f.startsWith("owner"))).toEqual([]);
  });

  it("never names the owner's key file or its environment variables", () => {
    for (const file of server) {
      const text = readFileSync(join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/keys\.json|BARKEEP_ARC_KEYS_FILE|BARKEEP_ARC_OWNER_KEY_NAME/);
    }
  });

  it("turns a private key into an account in one place only: the agent key store", () => {
    const users = server.filter((f) => /privateKeyToAccount|generatePrivateKey|mnemonicToAccount/.test(readFileSync(join(SRC, f), "utf8")));
    expect(users).toEqual(["agentKeys.ts"]);
  });

  it("has no way to send a transaction", () => {
    for (const file of server) {
      expect(readFileSync(join(SRC, file), "utf8"), file).not.toMatch(/createWalletClient|writeContract|sendTransaction|deployContract|sendRawTransaction/);
    }
  });
});

describe("the owner's side", () => {
  it("is the only place that reads the key file, and lives entirely under src/owner/", () => {
    const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
    const readers = all(SRC).filter((f) => /keys\.json/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))).map((f) => relative(SRC, f));
    expect(readers).toEqual(["owner/keyfile.ts"]);
  });
});
