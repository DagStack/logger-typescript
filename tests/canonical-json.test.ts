import { describe, expect, it } from "vitest";

import { canonicalJsonStringify, canonicalJsonStringifyBytes } from "../src/canonical-json.js";

describe("Primitives", () => {
  it("encodes null", () => {
    expect(canonicalJsonStringify(null)).toBe("null");
  });

  it("encodes booleans", () => {
    expect(canonicalJsonStringify(true)).toBe("true");
    expect(canonicalJsonStringify(false)).toBe("false");
  });

  it("encodes strings (ascii and unicode)", () => {
    expect(canonicalJsonStringify("")).toBe('""');
    expect(canonicalJsonStringify("hello")).toBe('"hello"');
    expect(canonicalJsonStringify("привет")).toBe('"привет"');
  });

  it("UTF-8 byte form via stringifyBytes", () => {
    expect(canonicalJsonStringifyBytes("hello")).toEqual(new TextEncoder().encode('"hello"'));
    expect(canonicalJsonStringifyBytes("привет")).toEqual(new TextEncoder().encode('"привет"'));
  });
});

describe("Numbers", () => {
  it("encodes integers without decimal point", () => {
    expect(canonicalJsonStringify(42)).toBe("42");
    expect(canonicalJsonStringify(-7)).toBe("-7");
    expect(canonicalJsonStringify(0)).toBe("0");
  });

  it("encodes floats with shortest round-trip", () => {
    expect(canonicalJsonStringify(1.5)).toBe("1.5");
    expect(canonicalJsonStringify(0.1)).toBe("0.1");
  });

  it("normalises -0 to 0", () => {
    expect(canonicalJsonStringify(-0)).toBe("0");
  });

  it("rejects NaN", () => {
    expect(() => canonicalJsonStringify(Number.NaN)).toThrow(/NaN/);
  });

  it("rejects Infinity / -Infinity", () => {
    expect(() => canonicalJsonStringify(Infinity)).toThrow(/Infinity/);
    expect(() => canonicalJsonStringify(-Infinity)).toThrow(/Infinity/);
  });

  it("encodes bigint as raw integer", () => {
    expect(canonicalJsonStringify(123n)).toBe("123");
    expect(canonicalJsonStringify(1_700_000_000_000_000_000n)).toBe("1700000000000000000");
  });
});

describe("Containers", () => {
  it("empty array / object", () => {
    expect(canonicalJsonStringify([])).toBe("[]");
    expect(canonicalJsonStringify({})).toBe("{}");
  });

  it("sorts object keys", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively", () => {
    expect(canonicalJsonStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("ASCII < Cyrillic in code-unit order", () => {
    const result = canonicalJsonStringify({ я: 1, a: 2 });
    expect(result).toBe('{"a":2,"я":1}');
  });
});

describe("Separators", () => {
  it("uses no whitespace outside strings", () => {
    const result = canonicalJsonStringify({ a: [1, 2, { b: "c" }] });
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
  });
});

describe("Determinism", () => {
  it("permuted input produces the same output", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, x: 1, y: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });
});

describe("Cross-binding parity (smoke)", () => {
  // Mirror python test_canonical_json output expectations.
  it("nested keys sort by code-unit", () => {
    expect(canonicalJsonStringify({ b: { c: 1, a: 2 }, a: 3 })).toBe('{"a":3,"b":{"a":2,"c":1}}');
  });

  it("body+attributes layout matches the wire test fixture", () => {
    // Same shape as test_canonical_json::test_keys_sorted_recursively.
    const out = canonicalJsonStringify({
      time_unix_nano: 100n,
      severity_number: 9,
      severity_text: "INFO",
      body: "hi",
    });
    expect(out).toBe(
      '{"body":"hi","severity_number":9,"severity_text":"INFO","time_unix_nano":100}',
    );
  });
});

describe("UTF-16 key order (S3 cross-binding regression)", () => {
  // Native JS Object.keys().sort() compares strings as UTF-16 code-unit
  // sequences (per ECMA-262), which matches RFC 8785 §3.2.3. This test
  // pins that behaviour as cross-binding contract — logger-go and
  // logger-python now produce the same wire bytes for non-BMP keys
  // (emoji, Han ideographs ≥ U+10000).
  it("sorts surrogate-pair keys identically to logger-go and logger-python", () => {
    // 💎 is U+1F48E (UTF-16 surrogates D83D DC8E).
    // 🍕 is U+1F355 (UTF-16 surrogates D83C DF55).
    // In UTF-16 code-unit order: 🍕 (D83C ...) < 💎 (D83D ...).
    const got = canonicalJsonStringify({
      aa: 1,
      "💎": 2,
      ab: 3,
      äz: 4,
      "🍕": 5,
    });
    expect(got).toBe('{"aa":1,"ab":3,"äz":4,"🍕":5,"💎":2}');
  });

  it("places non-BMP characters after BMP characters", () => {
    const got = canonicalJsonStringify({ z: 1, "🍕": 2 });
    expect(got).toBe('{"z":1,"🍕":2}');
  });
});
