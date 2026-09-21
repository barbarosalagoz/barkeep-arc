import { execFileSync } from "node:child_process";
import { readFileSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { tempDir } from "./helpers.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const WRAPPER = join(REPO_ROOT, "packages/mcp-server/bin/barkeep-arc-owner");

/** keygen is the one verb that needs no chain. Keys and state go to a temporary directory, never the real one. */
function keygen(command: string, args: string[], cwd: string) {
  const dir = tempDir();
  const env = { ...process.env, BARKEEP_ARC_KEYS_FILE: join(dir, "keys.json"), BARKEEP_ARC_STATE_DIR: join(dir, "mcp") };
  const out = execFileSync(command, [...args, "keygen", "viaSymlink"], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { out, file: env.BARKEEP_ARC_KEYS_FILE };
}

describe("the barkeep-arc-owner wrapper", () => {
  // npx runs node_modules/.bin/barkeep-arc-owner, a symlink. The wrapper once looked for tsx relative to the link and failed.
  it("runs through npx", () => {
    const { out, file } = keygen("npx", ["--no-install", "barkeep-arc-owner"], REPO_ROOT);

    const printed = JSON.parse(out) as { name: string; address: string };
    expect(printed.name).toBe("viaSymlink");
    expect(printed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(out).not.toMatch(/[0-9a-f]{64}/i);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual(["viaSymlink"]);
  });

  it("runs through a relative symlink to a symlink, from somewhere else", () => {
    const dir = tempDir();
    symlinkSync(WRAPPER, join(dir, "first"));
    symlinkSync("first", join(dir, "second"));

    expect(JSON.parse(keygen(join(dir, "second"), [], dir).out).name).toBe("viaSymlink");
  });
});
