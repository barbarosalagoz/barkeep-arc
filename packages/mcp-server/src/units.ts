/*
 * USDC amounts and durations, as people type them and as the chain counts them.
 * Everything here is the ERC-20 view of USDC on Arc: 6 decimals. The native
 * balance has 18, and this package never touches it.
 */

export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";

export function toBaseUnits(amount: string, label = "amount"): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`${label} must be a plain decimal number of USDC, e.g. "0.5"; got "${amount}"`);

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > USDC_DECIMALS) throw new Error(`${label} has more than ${USDC_DECIMALS} decimal places: "${amount}"`);

  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
}

export function fromBaseUnits(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10n ** BigInt(USDC_DECIMALS);
  const fraction = (abs % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export const withUnit = (value: bigint): string => `${fromBaseUnits(value)} ${USDC_SYMBOL}`;

/** An ISO-8601 duration without months or years (their length is not fixed), in seconds. */
export function durationToSeconds(duration: string): number {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration.trim());
  if (!match || duration.trim() === "P" || duration.trim().endsWith("T")) {
    throw new Error(`window must be an ISO-8601 duration such as "PT1H" or "P7D"; got "${duration}"`);
  }

  const [, w, d, h, m, s] = match.map((part) => (part === undefined ? 0 : Number(part)));
  const seconds = w * 604_800 + d * 86_400 + h * 3_600 + m * 60 + s;
  if (seconds <= 0) throw new Error(`window must be longer than zero; got "${duration}"`);
  return seconds;
}

export function describeExpiry(expiry: number, now: number): string {
  const at = new Date(expiry * 1000).toISOString();
  if (now > expiry) return `expired at ${at}`;

  const left = expiry - now;
  const parts = [
    [Math.floor(left / 86_400), "d"],
    [Math.floor((left % 86_400) / 3_600), "h"],
    [Math.floor((left % 3_600) / 60), "m"],
  ] as const;
  const human = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join(" ") || `${left}s`;
  return `expires at ${at} (in ${human})`;
}
