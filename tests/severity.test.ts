import { describe, expect, it } from "vitest";

import {
  CANONICAL_SEVERITY_TEXTS,
  isCanonicalSeverityText,
  isValidSeverityNumber,
  Severity,
  severityTextFor,
} from "../src/severity.js";

describe("Severity baseline values", () => {
  it("matches the spec §2 baseline per bucket", () => {
    expect(Severity.TRACE).toBe(1);
    expect(Severity.DEBUG).toBe(5);
    expect(Severity.INFO).toBe(9);
    expect(Severity.WARN).toBe(13);
    expect(Severity.ERROR).toBe(17);
    expect(Severity.FATAL).toBe(21);
  });
});

describe("CANONICAL_SEVERITY_TEXTS", () => {
  it("contains exactly six values", () => {
    expect(CANONICAL_SEVERITY_TEXTS).toHaveLength(6);
    expect(new Set<string>(CANONICAL_SEVERITY_TEXTS)).toEqual(
      new Set(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]),
    );
  });

  it("recognises each canonical value via isCanonicalSeverityText", () => {
    for (const text of CANONICAL_SEVERITY_TEXTS) {
      expect(isCanonicalSeverityText(text)).toBe(true);
    }
  });

  it.each(["trace", "info2", "Warning", "FATAL2", "CRITICAL", ""])(
    "rejects non-canonical text %p",
    (badText) => {
      expect(isCanonicalSeverityText(badText)).toBe(false);
    },
  );
});

describe("severityTextFor", () => {
  it.each([
    [1, "TRACE"],
    [4, "TRACE"],
    [5, "DEBUG"],
    [8, "DEBUG"],
    [9, "INFO"],
    [12, "INFO"],
    [13, "WARN"],
    [16, "WARN"],
    [17, "ERROR"],
    [20, "ERROR"],
    [21, "FATAL"],
    [24, "FATAL"],
  ])("maps %d → %s", (n, expected) => {
    expect(severityTextFor(n)).toBe(expected);
  });

  it.each([0, 25, -1])("throws for out-of-range %d", (n) => {
    expect(() => severityTextFor(n)).toThrow(/\[1, 24\]/);
  });
});

describe("isValidSeverityNumber", () => {
  it.each([1, 9, 24])("returns true for %d", (n) => {
    expect(isValidSeverityNumber(n)).toBe(true);
  });

  it.each([0, 25, -1, 1.5])("returns false for %p", (n) => {
    expect(isValidSeverityNumber(n)).toBe(false);
  });
});
