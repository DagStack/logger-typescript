import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../src/configuration.js";
import { _resetRegistryForTests, INTERNAL_LOGGER_NAME, Logger } from "../src/logger.js";
import { ConsoleSink } from "../src/sinks/console.js";
import { InMemorySink } from "../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

describe("configure", () => {
  it("attaches a Resource when resourceAttributes are present", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      resourceAttributes: { "service.name": "my-app" },
    });
    Logger.get("x").info("msg");
    const rec = sink.records()[0];
    expect(rec?.resource?.attributes["service.name"]).toBe("my-app");
  });

  it("clears the Resource when resourceAttributes is omitted", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });
    Logger.get("x").info("msg");
    expect(sink.records()[0]?.resource).toBeUndefined();
  });

  it("resolves a string severity name (case-insensitive)", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "warn", sinks: [sink] });
    Logger.get("x").info("below");
    Logger.get("x").error("above");
    expect(sink.records()).toHaveLength(1);
  });

  it("accepts a numeric severity", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: 17, sinks: [sink] });
    Logger.get("x").warn("below");
    Logger.get("x").error("above");
    expect(sink.records()).toHaveLength(1);
  });

  it("rejects an unknown severity name", () => {
    expect(() => {
      configure({ rootLevel: "BOGUS" });
    }).toThrow(/unknown severity/);
  });

  it("rejects an out-of-range numeric severity", () => {
    expect(() => {
      configure({ rootLevel: 100 });
    }).toThrow(/\[1, 24\]/);
  });

  it("applies per-logger level overrides", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      perLoggerLevels: { noisy: "WARN" },
    });
    Logger.get("noisy").info("should be dropped");
    Logger.get("quiet").info("should pass");
    const bodies = sink.records().map((r) => r.body);
    expect(bodies).not.toContain("should be dropped");
    expect(bodies).toContain("should pass");
  });

  it("redaction.extraSuffixes — additive masking through emit path", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      redaction: { extraSuffixes: ["_apikey"] },
    });
    Logger.get("x").info("event", {
      openai_api_key: "sk-base", // base — masked
      stripe_apikey: "sk-extra", // extra — masked
      "user.id": 17, // safe
    });
    const rec = sink.records()[0];
    expect(rec?.attributes.openai_api_key).toBe("***");
    expect(rec?.attributes.stripe_apikey).toBe("***");
    expect(rec?.attributes["user.id"]).toBe(17);
  });

  it("redaction.replaceDefaults — base set dropped", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      redaction: { extraSuffixes: ["_password"], replaceDefaults: true },
    });
    Logger.get("x").info("event", {
      openai_api_key: "sk-base", // base — NOT masked under replace
      db_password: "real-password", // extra — masked
    });
    const rec = sink.records()[0];
    expect(rec?.attributes.openai_api_key).not.toBe("***");
    expect(rec?.attributes.db_password).toBe("***");
  });

  it("redaction disable-all does not leak WARN to application sinks", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      redaction: { replaceDefaults: true },
    });
    Logger.get("x").info("event", {
      openai_api_key: "sk-base",
      db_password: "real-password",
    });
    const rec = sink.records()[0];
    expect(rec?.attributes.openai_api_key).not.toBe("***");
    expect(rec?.attributes.db_password).not.toBe("***");
    for (const r of sink.records()) {
      const body = typeof r.body === "string" ? r.body : "";
      expect(body).not.toContain("disable-all");
    }
  });

  it("redaction throws synchronously on invalid suffix (no partial reconfigure)", () => {
    const sink = new InMemorySink();
    expect(() => {
      configure({
        rootLevel: "INFO",
        sinks: [sink],
        redaction: { extraSuffixes: ["_APIKEY"] }, // uppercase rejected
      });
    }).toThrow(/lowercase ASCII/);
    // Sinks list never installed — root has no records of any kind to leak.
    Logger.get("x").info("post-throw", {});
    expect(sink.records()).toHaveLength(0);
  });

  it("dagstack.logger.internal defaults to its own ConsoleSink", () => {
    const internal = Logger.get(INTERNAL_LOGGER_NAME);
    const sinks = internal.effectiveSinks();
    expect(sinks).toHaveLength(1);
    expect(sinks[0]).toBeInstanceOf(ConsoleSink);
  });

  it("operator can override the dagstack.logger.internal default sink", () => {
    const customSink = new InMemorySink();
    Logger.get(INTERNAL_LOGGER_NAME).setSinks([customSink]);
    const sinks = Logger.get(INTERNAL_LOGGER_NAME).effectiveSinks();
    expect(sinks).toHaveLength(1);
    expect(sinks[0]?.id).toBe(customSink.id);
  });

  it("disable-all child observes empty effective list (M-1 regression)", () => {
    const root = Logger.get("");
    root.setRedactionSuffixes([]); // explicit empty
    const child = Logger.get("dagstack.rag");
    expect(child.effectiveSecretSuffixes()).toEqual([]);
  });

  it("autoInjectTraceContext=false skips ambient trace lookup (M2 §3.4.2)", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [sink],
      autoInjectTraceContext: false,
    });
    Logger.get("x").info("event");
    const rec = sink.records()[0];
    expect(rec).toBeDefined();
    // With auto-inject disabled, trace_id / span_id MUST be absent and
    // trace_flags is normalised to 0.
    expect(rec?.trace_id).toBeUndefined();
    expect(rec?.span_id).toBeUndefined();
    expect(rec?.trace_flags).toBe(0);
  });

  it("autoInjectTraceContext default is true (idiomatic per §3.4.2)", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });
    Logger.get("x").info("event");
    const rec = sink.records()[0];
    expect(rec).toBeDefined();
    // No active span in unit-test env → trace_id absent. The test
    // verifies the configure path doesn't break; the with-active-span
    // path is covered by the conformance fixture.
    expect(rec?.trace_flags).toBe(0);
  });
});
