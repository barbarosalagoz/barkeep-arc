import { describe, expect, it } from "vitest";

import { describeExpiry, durationToSeconds, fromBaseUnits, toBaseUnits, withUnit } from "../src/units.ts";

describe("USDC amounts (6 decimals, the ERC-20 view)", () => {
  it("round-trips", () => {
    for (const s of ["0", "1", "0.5", "0.000001", "12.34", "1000000"]) expect(fromBaseUnits(toBaseUnits(s))).toBe(s);
    expect(toBaseUnits("0.25")).toBe(250_000n);
    expect(withUnit(1_500_000n)).toBe("1.5 USDC");
  });

  it("refuses what it cannot represent exactly", () => {
    for (const bad of ["0.0000001", "-1", "1e3", "", "abc", "1.", ".5", "1,5"]) expect(() => toBaseUnits(bad)).toThrow();
  });
});

describe("windows", () => {
  it("reads ISO-8601 durations", () => {
    expect(durationToSeconds("PT1H")).toBe(3600);
    expect(durationToSeconds("P7D")).toBe(604_800);
    expect(durationToSeconds("P1DT2H30M")).toBe(86_400 + 9000);
    expect(durationToSeconds("PT45S")).toBe(45);
  });

  it("refuses months, years, zero and nonsense", () => {
    for (const bad of ["P1M", "P1Y", "PT0S", "P", "PT", "1h", "", "P-1D"]) expect(() => durationToSeconds(bad)).toThrow();
  });

  it("says when a tab has expired", () => {
    expect(describeExpiry(1000, 2000)).toMatch(/^expired at/);
    expect(describeExpiry(2000 + 3600 + 120, 2000)).toMatch(/in 1h 2m\)$/);
  });
});
