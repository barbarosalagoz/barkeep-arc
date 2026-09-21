/*
 * The BUILT page, as it is deployed. Run after `npm run build`:
 *
 *   npm run build --workspace @barkeep-arc/status && npm run test:bundle --workspace @barkeep-arc/status
 *
 * It must contain no way to send a transaction or ask for a wallet, no key
 * material or key path, nothing from the owner's CLI, and may name no host but
 * Arc's RPCs and explorers and this repository.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])) : []);
const all = files(DIST);
const text = all.filter((f) => /\.(js|html|css|json)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");

describe("the built page", () => {
  it("exists", () => {
    expect(all.some((f) => f.endsWith("index.html")), "run `npm run build` first").toBe(true);
    expect(all.some((f) => f.endsWith(".js"))).toBe(true);
  });

  it("cannot send a transaction or ask for a wallet", () => {
    for (const forbidden of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_signTypedData", "eth_requestAccounts", "wallet_", "window.ethereum"]) {
      expect(text.includes(forbidden), `the bundle contains ${forbidden}`).toBe(false);
    }
  });

  it("contains no key material, key path or anything from the owner's CLI", () => {
    expect(text).not.toMatch(/keys\.json|\.local\/state|BARKEEP_ARC_KEYS_FILE|BARKEEP_ARC_OWNER|barkeep-arc-owner|agentKeys|privateKeyToAccount|generatePrivateKey|mnemonicToAccount/);
    expect(text).not.toMatch(/(private[_-]?key|secret|mnemonic)["' ]*[:=]["' ]*(0x)?[0-9a-f]{64}/i);
  });

  it("names no host but Arc's RPCs and explorers, and this repository", () => {
    const allowed = new Set(["rpc.testnet.arc.io", "rpc.mainnet.arc.io", "explorer.testnet.arc.io", "explorer.arc.io", "github.com"]);
    // viem's own error messages link to its docs, to EIPs and to a signature lookup; they are text inside strings,
    // never fetched, and the CSP would block them anyway.
    const harmless = /^(viem\.sh|eips\.ethereum\.org|github\.com|www\.w3\.org|abitype\.dev|oxlib\.sh|docs\.soliditylang\.org|chainlist\.org|4byte\.sourcify\.dev)$/;
    const hosts = new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()));
    const unexpected = [...hosts].filter((h) => !allowed.has(h) && !harmless.test(h));
    expect(unexpected).toEqual([]);
  });

  it("ships a Content-Security-Policy that allows connections to Arc's RPCs only", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self' https://rpc.testnet.arc.io https://rpc.mainnet.arc.io;");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it("ships only the refusals from the record, not the record", () => {
    const record = readFileSync(join(DIST, "record.arc-testnet.json"), "utf8");
    expect(record).not.toMatch(/requestId|receipts|paymentId/);
    expect(JSON.parse(record).refusals).toHaveLength(4);
  });
});
