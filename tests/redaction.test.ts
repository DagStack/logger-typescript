import { describe, expect, it } from "vitest";

import type { Value } from "../src/records.js";
import {
  buildEffectiveSuffixes,
  DEFAULT_SECRET_SUFFIXES,
  isSecretField,
  MASKED_PLACEHOLDER,
  maskValue,
  redactAttributes,
  validateRedactionConfig,
} from "../src/redaction.js";

describe("isSecretField", () => {
  it("matches api_key (case-insensitive)", () => {
    expect(isSecretField("api_key")).toBe(true);
    expect(isSecretField("OPENAI_API_KEY")).toBe(true);
  });

  it("matches secret suffix", () => {
    expect(isSecretField("client_secret")).toBe(true);
    expect(isSecretField("CLIENT_SECRET")).toBe(true);
  });

  it("matches token suffix", () => {
    expect(isSecretField("access_token")).toBe(true);
  });

  it("matches password suffix", () => {
    expect(isSecretField("db_password")).toBe(true);
  });

  it("does not match safe keys", () => {
    expect(isSecretField("user.id")).toBe(false);
    expect(isSecretField("request.id")).toBe(false);
    expect(isSecretField("model")).toBe(false);
    expect(isSecretField("temperature")).toBe(false);
  });

  it("respects custom suffix lists", () => {
    expect(isSecretField("app_hash", ["_hash"])).toBe(true);
    expect(isSecretField("app_hash", ["_secret"])).toBe(false);
  });
});

describe("maskValue", () => {
  it("returns MASKED_PLACEHOLDER for secret keys", () => {
    expect(maskValue("api_key", "sk-1234")).toBe(MASKED_PLACEHOLDER);
  });

  it("passes non-secret values through", () => {
    expect(maskValue("user.id", 42)).toBe(42);
  });
});

describe("redactAttributes", () => {
  it("masks secret values", () => {
    const result = redactAttributes({ api_key: "sk-123", model: "gpt-4" });
    expect(result.api_key).toBe(MASKED_PLACEHOLDER);
    expect(result.model).toBe("gpt-4");
  });

  it("does not mutate the original", () => {
    const original: Record<string, Value> = { api_key: "sk-123" };
    const result = redactAttributes(original);
    expect(original).toEqual({ api_key: "sk-123" });
    expect(result).not.toEqual(original);
  });

  it("recurses into nested maps", () => {
    const attrs: Record<string, Value> = {
      outer: "fine",
      nested: { db_password: "hunter2", safe: "ok" },
    };
    const result = redactAttributes(attrs);
    expect(result.outer).toBe("fine");
    const nested = result.nested as Record<string, Value>;
    expect(nested.db_password).toBe(MASKED_PLACEHOLDER);
    expect(nested.safe).toBe("ok");
  });

  it("recurses through deep nesting", () => {
    const attrs: Record<string, Value> = {
      a: { b: { c: { my_token: "secret" } } },
    };
    const result = redactAttributes(attrs);
    const c = ((result.a as Record<string, Value>).b as Record<string, Value>).c as Record<
      string,
      Value
    >;
    expect(c.my_token).toBe(MASKED_PLACEHOLDER);
  });

  it("matches keys case-insensitively", () => {
    const result = redactAttributes({ API_KEY: "sk-123" });
    expect(result.API_KEY).toBe(MASKED_PLACEHOLDER);
  });

  it("DEFAULT_SECRET_SUFFIXES holds the expected six entries", () => {
    expect(new Set(DEFAULT_SECRET_SUFFIXES)).toEqual(
      new Set(["_key", "_secret", "_token", "_password", "_passphrase", "_credentials"]),
    );
  });

  it("masks the whole array value under a secret key", () => {
    const attrs: Record<string, Value> = { api_key: ["a", "b"] };
    const result = redactAttributes(attrs);
    // Secret-key wins — whole value (regardless of shape) is masked.
    expect(result.api_key).toBe(MASKED_PLACEHOLDER);
  });

  it("recurses into list-of-dicts under a non-secret key (S8 fix)", () => {
    const attrs: Record<string, Value> = {
      events: [
        { type: "login", user_password: "hunter2" },
        { type: "exchange", api_key: "sk-secret" },
      ],
    };
    const result = redactAttributes(attrs);
    const events = result.events as Record<string, Value>[];
    const first = events[0]!;
    const second = events[1]!;
    expect(first.user_password).toBe(MASKED_PLACEHOLDER);
    expect(first.type).toBe("login");
    expect(second.api_key).toBe(MASKED_PLACEHOLDER);
  });

  it("leaves lists of primitives untouched under a non-secret key", () => {
    const attrs: Record<string, Value> = {
      tags: ["alpha", "beta"],
      nums: [1, 2, 3],
    };
    const result = redactAttributes(attrs);
    expect(result.tags).toEqual(["alpha", "beta"]);
    expect(result.nums).toEqual([1, 2, 3]);
  });

  it("preserves null values unchanged", () => {
    const result = redactAttributes({ optional: null });
    expect(result.optional).toBeNull();
  });
});

describe("buildEffectiveSuffixes", () => {
  it("merges base ∪ extras additively by default", () => {
    const got = buildEffectiveSuffixes({
      extraSuffixes: ["_apikey", "_x_internal_token"],
    });
    expect(got).toEqual([
      "_key",
      "_secret",
      "_token",
      "_password",
      "_passphrase",
      "_credentials",
      "_apikey",
      "_x_internal_token",
    ]);
  });

  it("drops base set when replaceDefaults=true", () => {
    const got = buildEffectiveSuffixes({
      extraSuffixes: ["_password"],
      replaceDefaults: true,
    });
    expect(got).toEqual(["_password"]);
  });

  it("returns non-nil empty list under replace + empty (disable-all)", () => {
    const got = buildEffectiveSuffixes({ replaceDefaults: true });
    expect(got).toEqual([]);
    expect(got).not.toBe(undefined);
  });

  it("deduplicates and lowercases extras", () => {
    const got = buildEffectiveSuffixes({
      extraSuffixes: ["_apikey", "_apikey", "_KEY"],
    });
    expect(got).toEqual([
      "_key",
      "_secret",
      "_token",
      "_password",
      "_passphrase",
      "_credentials",
      "_apikey",
    ]);
  });
});

describe("validateRedactionConfig", () => {
  it("accepts a well-formed config", () => {
    expect(() => {
      validateRedactionConfig({ extraSuffixes: ["_apikey", "_x_internal_token"] });
    }).not.toThrow();
  });

  it("rejects empty string suffixes", () => {
    expect(() => {
      validateRedactionConfig({ extraSuffixes: [""] });
    }).toThrow(/empty string/);
  });

  it("rejects whitespace-bearing suffixes", () => {
    expect(() => {
      validateRedactionConfig({ extraSuffixes: ["_my secret"] });
    }).toThrow(/whitespace/);
  });

  it("rejects non-lowercase ASCII suffixes", () => {
    expect(() => {
      validateRedactionConfig({ extraSuffixes: ["_APIKEY"] });
    }).toThrow(/lowercase ASCII/);
    expect(() => {
      validateRedactionConfig({ extraSuffixes: ["_кей"] });
    }).toThrow(/lowercase ASCII/);
  });
});
