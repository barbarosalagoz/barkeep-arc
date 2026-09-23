/*
 * A read-only status page for one tab. It reads Arc over public RPC and shows
 * what is there. It has no wallet connection, holds no key, and contains no code
 * that can send a transaction. Everything from the chain or the record is put on
 * the page as text, never as HTML.
 */

import "./style.css";

import { readPayments, readTab, receiptStatus, type Payment, type TabView } from "./chain.ts";
import { NETWORKS, networkByKey, type NetworkConfig, type TabConfig } from "./config.ts";
import { expiryText, shortHex, usdc } from "./format.ts";

interface Refusal {
  id: string;
  tab: string;
  what: string;
  beforeSigning: string | null;
  facilitator: string | null;
  tabAnswer: string | null;
  revertReason: string | null;
  tx: string;
  block: number;
}

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) if (child) node.append(child);
  return node;
}

const link = (href: string, text: string, cls = "hex") => el("a", { href, class: cls, rel: "noopener noreferrer", target: "_blank" }, text);
const addressLink = (net: NetworkConfig, address: string) => link(`${net.explorer}/address/${address}`, address);
const txLink = (net: NetworkConfig, hash: string) => link(`${net.explorer}/tx/${hash}`, shortHex(hash));

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
let net = networkByKey(params.get("network"));
let tabIndex = Math.max(0, Math.min(Number(params.get("tab") ?? 0) || 0, Math.max(0, net.tabs.length - 1)));
let run = 0;

function select(options: Array<{ value: string; label: string }>, value: string, label: string, onChange: (v: string) => void) {
  const node = el("select", { "aria-label": label, name: label.toLowerCase() });
  for (const o of options) node.append(el("option", o.value === value ? { value: o.value, selected: "" } : { value: o.value }, o.label));
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function header(): HTMLElement {
  const controls = el("div", { class: "controls" });
  controls.append(
    select(NETWORKS.map((n) => ({ value: n.key, label: `${n.name} (${n.chainId})` })), net.key, "Network", (v) => {
      net = networkByKey(v);
      tabIndex = 0;
      render();
    })
  );
  if (net.tabs.length > 0) {
    controls.append(select(net.tabs.map((t, i) => ({ value: String(i), label: t.label })), String(tabIndex), "Tab", (v) => { tabIndex = Number(v); render(); }));
  }
  return el("header", {}, el("h1", {}, "Barkeep on Arc: tab status"), controls);
}

const intro = () =>
  el("p", { class: "intro" },
    "A tab is a budget an AI agent can spend and nothing more: one small contract, funded with exactly the cap, so the balance is the limit. " +
    "The agent holds a key that can pay only the payees listed below, only up to the per-call maximum, only until the expiry. Those rules are not in the agent's prompt or in any server. " +
    "They are enforced on chain, in the tab's ",
    el("code", {}, "isValidSignature"),
    ", which USDC calls before it will move a cent. This page only reads: it has no wallet connection and cannot send anything. ",
    el("strong", {}, "The contracts are unaudited.")
  );

function termsCard(tab: TabConfig, view: TabView): HTMLElement {
  const expired = view.now > view.expiry;
  const state = view.closed ? "closed" : expired ? "expired" : "open";
  const stateText = view.closed ? "closed by its owner" : expired ? "expired" : "open";

  const balance = el("div", { class: "balance" },
    el("span", { class: "figure" }, usdc(view.balance)),
    el("span", { class: `badge ${state}` }, stateText),
    view.opened && el("span", { class: "sub" }, `funded with ${usdc(view.opened.cap)}` + (view.balance <= view.opened.cap ? `, ${usdc(view.opened.cap - view.balance)} gone` : ", and someone has sent it more since"))
  );

  const payees = el("ul", { class: "plain" });
  for (const p of view.payees) payees.append(el("li", {}, addressLink(net, p)));

  const rows: Array<[string, Child[]]> = [
    ["Tab", [addressLink(net, view.address)]],
    ["Owner", [addressLink(net, view.owner), el("div", { class: "note" }, "The only address that can close the tab and take back what is left.")]],
    ["Agent", [addressLink(net, view.agent), el("div", { class: "note" }, "The only key whose signature the tab accepts. It never holds funds or sends a transaction.")]],
    ["May pay only", [payees]],
    ["Per payment, at most", [usdc(view.maxPerCall)]],
    ["Expiry", [expiryText(view.expiry, view.now)]],
    ["Closed", [view.closed ? "yes, permanently" : "no"]],
    ["Opened by", view.opened && net.factory
      ? [addressLink(net, net.factory), el("div", { class: "note" }, "This factory's TabOpened event names this tab, in ", txLink(net, view.opened.tx), ".")]
      : [el("span", { class: "muted" }, "No TabOpened event from the configured factory was found for this address.")]],
    ["Read at", [`block ${view.block}`, el("div", { class: "note" }, "Owner, agent, payees, maximum and expiry are read from the tab's own bytecode. Nothing can change them.")]],
  ];

  const list = el("dl");
  for (const [term, value] of rows) list.append(el("dt", {}, term), el("dd", {}, ...value));
  void tab;
  return el("section", { class: "card" }, balance, list);
}

function paymentsSection(view: TabView, result: Awaited<ReturnType<typeof readPayments>>): HTMLElement {
  const section = el("section", {}, el("h2", {}, "Settled payments"));
  const paid = result.payments.filter((p) => p.toPayee);
  const other = result.payments.filter((p) => !p.toPayee);

  if (paid.length === 0) section.append(el("p", { class: "muted" }, "No payment to a payee in the blocks scanned."));
  else section.append(el("p", { class: "small muted" }, `${paid.length} payment${paid.length === 1 ? "" : "s"}, newest first.`), table(paid, "to payee"));

  if (other.length > 0) {
    section.append(el("h2", {}, "Returned to the owner"), table(other, "to"));
  }

  const { plan, failed } = result;
  const first = plan.chunks[0]?.from, last = plan.chunks[plan.chunks.length - 1]?.to;
  section.append(
    el("p", { class: "muted small" },
      `USDC Transfer events out of the tab, blocks ${first} to ${last}. `,
      plan.skipped ? `Blocks ${plan.skipped.from} to ${plan.skipped.to} were not scanned: Arc's public RPC answers fewer than 10,000 blocks per query and this page makes at most ${plan.chunks.length}. The explorer has the rest. ` : "",
      failed > 0 ? `${failed} of ${plan.chunks.length} queries failed, so this list may be incomplete. ` : "",
      `Total to payees here: ${usdc(paid.reduce((sum, p) => sum + p.value, 0n))}.`
    )
  );
  void view;
  return section;
}

/** The latest few in view; the rest behind a native disclosure, so a busy tab does not bury what comes after it. */
const SHOWN = 10;

function table(rows: Payment[], toLabel: string): HTMLElement {
  if (rows.length > SHOWN) {
    const rest = el("details", {}, el("summary", {}, `Show the ${rows.length - SHOWN} earlier ones`), tableOf(rows.slice(SHOWN), toLabel));
    return el("div", {}, tableOf(rows.slice(0, SHOWN), toLabel), rest);
  }
  return tableOf(rows, toLabel);
}

function tableOf(rows: Payment[], toLabel: string): HTMLElement {
  const body = el("tbody");
  for (const p of rows) body.append(el("tr", {}, el("td", { class: "num" }, usdc(p.value)), el("td", {}, addressLink(net, p.to)), el("td", {}, txLink(net, p.tx)), el("td", { class: "num muted" }, String(p.block))));
  return el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Amount"), el("th", {}, toLabel), el("th", {}, "Transaction"), el("th", {}, "Block"))), body));
}

function refusalsSection(tab: TabConfig, refusals: Refusal[], source: string): HTMLElement {
  const section = el("section", {}, el("h2", {}, "Refused attempts"));
  if (refusals.length === 0) {
    section.append(el("p", { class: "muted" }, "None recorded on this network."));
    return section;
  }

  const isMine = (r: Refusal) => r.tab?.toLowerCase() === tab.address.toLowerCase();
  const mine = refusals.filter(isMine);
  section.append(
    el("p", { class: "muted small" },
      `From the repository's record (${source}). Each was signed with a tab's real agent key and submitted anyway, so the refusal is in a block. This page checks each transaction's status on chain as it loads. `,
      mine.length === 0 ? "None of them was made against the tab shown above; each says which tab it was." : ""
    )
  );

  const card = el("div", { class: "card" });
  // This tab's own refusals first, then the others.
  for (const r of [...mine, ...refusals.filter((x) => !isMine(x))]) {
    const status = el("span", { class: "badge muted" }, "checking…");
    receiptStatus(net, r.tx).then((s) => {
      status.textContent = s === "reverted" ? "reverted on chain" : s === "success" ? "NOT reverted: it succeeded" : "not found on chain";
      status.className = `badge ${s === "reverted" ? "reverted" : "muted"}`;
    });

    const layers = el("ul", { class: "layers" });
    const layer = (who: string, said: string | null) => said && layers.append(el("li", {}, el("span", { class: "who" }, who), el("span", {}, said)));
    layer("The server, before signing", r.beforeSigning);
    layer("Circle's facilitator", r.facilitator && `verify: ${r.facilitator}`);
    layer("The tab's isValidSignature", r.tabAnswer && `${r.tabAnswer}${r.tabAnswer === "0xffffffff" ? " (refused)" : ""}`);
    layer("USDC, on chain", r.revertReason);

    const where = net.tabs.find((t) => t.address.toLowerCase() === r.tab?.toLowerCase());
    card.append(
      el("div", { class: "refusal" },
        el("h3", {}, r.id, status, txLink(net, r.tx)),
        el("p", {}, r.what),
        el("p", { class: "small muted" }, isMine(r) ? "Against this tab." : "Against ", !isMine(r) && addressLink(net, r.tab), !isMine(r) && where ? ` (${where.label}).` : ""),
        layers
      )
    );
  }
  section.append(card);
  return section;
}

const footer = () =>
  el("footer", {},
    el("p", {}, "Read-only. No wallet connection, no keys, no writes. It talks to Arc's public RPC from your browser and to nothing else."),
    el("p", {}, "Unaudited software. ", link("https://github.com/barbarosalagoz/barkeep-arc", "Source, tests and the full record", ""), ". Apache-2.0.")
  );

async function render(): Promise<void> {
  const mine = ++run;
  const query = new URLSearchParams({ network: net.key, tab: String(tabIndex) });
  history.replaceState(null, "", `?${query}`);

  const body = el("div", {}, el("p", { class: "muted" }, "Reading from Arc…"));
  app.replaceChildren(header(), intro(), el("h2", {}, "The tab"), body, footer());

  const tab = net.tabs[tabIndex];
  if (!tab) {
    body.replaceChildren(el("p", { class: "card" }, net.factory ? "No tab is configured on this network." : `Nothing is deployed on ${net.name} yet. The contracts and the done-tests are on Arc Testnet.`));
    return;
  }

  try {
    const view = await readTab(net, tab);
    if (mine !== run) return;
    const payments = el("section", {}, el("h2", {}, "Settled payments"), el("p", { class: "muted" }, "Scanning the chain…"));
    const refusals = el("section", {});
    body.replaceChildren(termsCard(tab, view), payments, refusals);

    readPayments(net, tab, view).then((result) => mine === run && payments.replaceWith(paymentsSection(view, result)), (e: Error) => payments.append(el("p", { class: "error" }, e.message)));

    fetch(`./record.${net.key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ source: string; refusals: Refusal[] }>) : { source: "", refusals: [] }))
      .then((record) => mine === run && refusals.replaceWith(refusalsSection(tab, record.refusals, record.source)))
      .catch(() => undefined);
  } catch (error) {
    if (mine === run) body.replaceChildren(el("p", { class: "card error" }, `Could not read the tab: ${(error as Error).message}`));
  }
}

void render();
