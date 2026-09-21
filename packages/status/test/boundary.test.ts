/*
 * The page is read-only and holds nothing secret. These tests fail the build if
 * its SOURCE stops being self-contained: it may import its own files, viem and
 * nothing else. In particular nothing from packages/mcp-server, where the agent
 * keys and the owner's CLI live. test/bundle.test.ts checks the built output.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const sources = readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => join(SRC, f));
const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("the page's source", () => {
  it("imports only its own files and viem", () => {
    for (const file of sources) {
      for (const spec of imports(file)) {
        if (spec.startsWith(".")) {
          const target = relative(SRC, resolve(dirname(file), spec));
          expect(target.startsWith(".."), `${relative(ROOT, file)} imports ${spec}, outside src/`).toBe(false);
        } else {
          expect(["viem", "viem/actions"], `${relative(ROOT, file)} imports ${spec}`).toContain(spec);
        }
      }
    }
  });

  it("never names a key file, the owner's CLI or the server's key store", () => {
    for (const file of [...sources, join(ROOT, "index.html"), join(ROOT, "scripts/extract-record.mjs")]) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, relative(ROOT, file)).not.toMatch(/keys\.json|keyfile|agentKeys|owner\/|mcp-server|privateKey|mnemonic|\.local\/state/i);
    }
  });

  it("uses no wallet, account or write API from viem", () => {
    for (const file of sources) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, relative(ROOT, file)).not.toMatch(/createWalletClient|createPublicClient|viem\/accounts|writeContract|sendTransaction|sendRawTransaction|signMessage|signTypedData|window\.ethereum|eth_requestAccounts/);
    }
  });

  it("puts chain data on the page as text, never as HTML", () => {
    for (const file of sources) expect(readFileSync(file, "utf8"), relative(ROOT, file)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
