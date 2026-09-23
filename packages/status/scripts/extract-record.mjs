/*
 * Before each build: copy out of deployments/<network>.json only what the page
 * shows, the refused attempts and where each one's revert is. The full record
 * (Circle's answers, the bill) stays in the repository.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

export function refusalsFrom(record) {
  const tests = record.doneTests ?? {};
  const pick = (id, tab, extra = {}) => {
    const t = tests[id];
    if (!t?.tx?.hash) return [];
    return [{
      id,
      tab,
      what: t.what,
      beforeSigning: t.beforeSigning ?? t.afterDestroy ?? null,
      facilitator: t.circleVerify?.body?.invalidReason ?? null,
      tabAnswer: t.tabAnswerAfterExpiry ?? t.tabAnswer ?? null,
      revertReason: t.revertReason ?? null,
      tx: t.tx.hash,
      block: t.tx.block,
      ...extra,
    }];
  };
  const main = tests.A1?.tab;
  return [...pick("A2", main), ...pick("A3", main), ...pick("A5", main), ...pick("A4", tests.A4?.tab)];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  mkdirSync(join(here, "../public"), { recursive: true });
  for (const network of ["arc-testnet", "arc-mainnet"]) {
    const file = join(repo, "deployments", `${network}.json`);
    const out = { network, source: `deployments/${network}.json`, refusals: existsSync(file) ? refusalsFrom(JSON.parse(readFileSync(file, "utf8"))) : [] };
    writeFileSync(join(here, `../public/record.${network}.json`), `${JSON.stringify(out, null, 2)}\n`);
    console.log(`record.${network}.json: ${out.refusals.length} refusal(s)`);
  }
}
