// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/severity.mdx`.

import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { Severity } from "../../src/severity.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Calling the severity methods" ────────────────────────────────────

describe("concepts/severity.mdx — Calling the severity methods (TypeScript)", () => {
  it("snippet: all six severity methods emit canonical text", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });

    // --- snippet start (severity / methods) ----------------------------
    // import { Logger } from "@dagstack/logger";

    const logger = Logger.get("order_service.checkout");

    logger.trace("entering function", { "args.order_id": 1234 });
    logger.debug("cache miss", { "cache.key": "user:42" });
    logger.info("order placed", { "order.id": 1234 });
    logger.warn("retry triggered", { "retry.attempt": 2 });
    logger.error("payment declined", { "order.id": 1234 });
    logger.fatal("config invariant violated", { reason: "missing service.name" });
    // --- snippet end ---------------------------------------------------

    const records = sink.records();
    expect(records.map((r) => r.severity_text)).toEqual([
      "TRACE",
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
      "FATAL",
    ]);
    expect(records.map((r) => r.severity_number)).toEqual([1, 5, 9, 13, 17, 21]);
    expect(records[0]?.attributes["args.order_id"]).toBe(1234);
    expect(records[5]?.attributes.reason).toBe("missing service.name");
  });
});

// ── "Intermediate severity_number via log()" ──────────────────────────

describe("concepts/severity.mdx — Intermediate log() (TypeScript)", () => {
  it("snippet: log(11, ...) → INFO bucket text", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    const logger = Logger.get("order_service.checkout");

    // --- snippet start (severity / intermediate log()) ----------------
    logger.log(11, "intermediate level", { phase: "warmup" });
    // severity_number=11 → severity_text="INFO" (still in 9-12 bucket).
    // --- snippet end ---------------------------------------------------

    const rec = sink.records()[0];
    expect(rec?.severity_number).toBe(11);
    expect(rec?.severity_text).toBe("INFO");
    expect(rec?.attributes.phase).toBe("warmup");
  });
});

// ── "The constants" — Severity exports ────────────────────────────────

describe("concepts/severity.mdx — The constants (TypeScript)", () => {
  it("snippet: Severity baseline values", () => {
    // --- snippet start (severity / constants) -------------------------
    // import { Severity } from "@dagstack/logger";

    // Severity is exported as a const-object — typed numeric constants.
    Severity.TRACE; // 1
    Severity.DEBUG; // 5
    Severity.INFO; //  9
    Severity.WARN; //  13
    Severity.ERROR; // 17
    Severity.FATAL; // 21
    // --- snippet end ---------------------------------------------------

    expect(Severity.TRACE).toBe(1);
    expect(Severity.DEBUG).toBe(5);
    expect(Severity.INFO).toBe(9);
    expect(Severity.WARN).toBe(13);
    expect(Severity.ERROR).toBe(17);
    expect(Severity.FATAL).toBe(21);
  });
});
