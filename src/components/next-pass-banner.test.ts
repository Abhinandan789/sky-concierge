import { describe, expect, it } from "vitest";
import { formatCountdown } from "./next-pass-banner";

describe("formatCountdown", () => {
  it("formats minutes and seconds", () => {
    expect(formatCountdown(12 * 60_000 + 41_000)).toBe("12:41");
  });

  it("zero-pads under a minute", () => {
    expect(formatCountdown(45_000)).toBe("00:45");
  });

  it("adds hours when needed", () => {
    expect(formatCountdown(3600_000 + 5_000)).toBe("1:00:05");
  });

  it("clamps negatives to zero", () => {
    expect(formatCountdown(-500)).toBe("00:00");
  });
});
