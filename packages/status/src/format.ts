/* Pure helpers: amounts, times, the plan for scanning logs in chunks. No chain access, so they are unit-tested. */

export const USDC_DECIMALS = 6;

export function usdc(value: bigint): string {
  const whole = value / 10n ** BigInt(USDC_DECIMALS);
  const fraction = (value % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
}

export const shortHex = (hex: string, head = 10, tail = 6): string => (hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`);

export const isoTime = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

export function expiryText(expiry: number, now: number): string {
  if (now > expiry) return `expired ${isoTime(expiry)}`;
  const left = expiry - now;
  const parts: Array<[number, string]> = [[Math.floor(left / 86_400), "d"], [Math.floor((left % 86_400) / 3_600), "h"], [Math.floor((left % 3_600) / 60), "m"]];
  const human = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join(" ") || `${left}s`;
  return `${isoTime(expiry)} (in ${human})`;
}

/** Arc's public RPC refuses a log query of 10,000 blocks or more. */
export const MAX_LOG_SPAN = 9_000;
/** At most this many queries per page load; a long-lived tab is scanned at both ends and the page says so. */
export const MAX_CHUNKS = 24;

export interface ScanPlan {
  chunks: Array<{ from: number; to: number }>;
  /** Blocks inside [from, to] the plan leaves out, when the range is too long to scan in one page load. */
  skipped: { from: number; to: number } | null;
}

export function planScan(from: number, to: number, span = MAX_LOG_SPAN, maxChunks = MAX_CHUNKS): ScanPlan {
  if (to < from) return { chunks: [], skipped: null };

  const all: Array<{ from: number; to: number }> = [];
  for (let start = from; start <= to; start += span) all.push({ from: start, to: Math.min(start + span - 1, to) });
  if (all.length <= maxChunks) return { chunks: all, skipped: null };

  // Too long: the first half of the budget from the start, the rest from the end. Most of a tab's life is quiet,
  // and the two ends are where opening, first payments and the latest activity are.
  const head = all.slice(0, Math.ceil(maxChunks / 2));
  const tail = all.slice(all.length - Math.floor(maxChunks / 2));
  return { chunks: [...head, ...tail], skipped: { from: head[head.length - 1].to + 1, to: tail[0].from - 1 } };
}
