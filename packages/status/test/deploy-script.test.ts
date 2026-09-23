/*
 * The deploy script must not leave Vercel's token files behind. `vercel pull` writes a VERCEL_OIDC_TOKEN into
 * .vercel/.env.<environment>.local, and an earlier version of the script only removed .env.local. This runs the
 * script's own cleanup against a scratch copy of the layout, with the Vercel CLI stubbed out to fail partway.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/deploy.sh");

function scratch(npxBody: string) {
  const root = mkdtempSync(join(tmpdir(), "barkeep-deploy-"));
  mkdirSync(join(root, "pkg/scripts"), { recursive: true });
  mkdirSync(join(root, "pkg/.vercel"), { recursive: true });
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "pkg/scripts/deploy.sh"), readFileSync(SCRIPT));
  chmodSync(join(root, "pkg/scripts/deploy.sh"), 0o755);
  // A stand-in for `npx vercel pull`: it writes the token files the real CLI writes, then does what the test asks.
  writeFileSync(join(root, "bin/npx"), `#!/bin/sh\nif [ "$2" = "pull" ]; then echo T=1 > .env.local; echo T=1 > .vercel/.env.production.local; echo T=1 > .vercel/.env.preview.local; exit 0; fi\n${npxBody}\n`);
  chmodSync(join(root, "bin/npx"), 0o755);
  return root;
}

const run = (root: string) => {
  try {
    execFileSync(join(root, "pkg/scripts/deploy.sh"), ["--prod"], { env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` }, stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
};

describe("scripts/deploy.sh", () => {
  it("removes every token file Vercel wrote, even when the deploy fails partway", () => {
    const root = scratch('echo "vercel build failed" >&2; exit 3');
    expect(run(root)).not.toBe(0);
    for (const f of [".env.local", ".vercel/.env.production.local", ".vercel/.env.preview.local"]) {
      expect(existsSync(join(root, "pkg", f)), `${f} was left behind`).toBe(false);
    }
  });

  it("leaves the project link alone", () => {
    const root = scratch("exit 3");
    writeFileSync(join(root, "pkg/.vercel/project.json"), "{}");
    run(root);
    expect(existsSync(join(root, "pkg/.vercel/project.json"))).toBe(true);
  });
});
