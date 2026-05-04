// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/intro.mdx`.
//
// Each `it(...)` mirrors one TabItem value="typescript" code block from the
// page and asserts the behaviour described by the surrounding prose.
//
// The snippets between `// --- snippet start ---` / `// --- snippet end ---`
// are copied verbatim from the MDX. Adjustments outside the markers are kept
// minimal — the in-memory `BufferedStream` replaces the live `process.stderr`
// so we can assert against the captured output, and `import` lines are hoisted
// to the top of the file (the docs show them per-snippet, but TS modules
// require top-level imports).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { ConsoleSink } from "../../src/sinks/console.js";
import type { ConsoleStream } from "../../src/sinks/console.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

class BufferedStream implements ConsoleStream {
  buffer = "";
  isTTY = false;
  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
}

beforeEach(() => {
  _resetRegistryForTests();
});

afterEach(() => {
  _resetRegistryForTests();
});

// ── "Your first log line" — bootstrap + named logger ──────────────────

describe("intro.mdx — Your first log line (TypeScript)", () => {
  it("snippet: configure + Logger.get + info(...) emits a record", () => {
    const stream = new BufferedStream();
    const captureSink = new InMemorySink();

    // --- snippet start (intro / your first log line) -------------------
    // import { Logger, ConsoleSink, configure } from "@dagstack/logger";
    configure({
      rootLevel: "INFO",
      sinks: [new ConsoleSink({ mode: "auto", stream }), captureSink],
      resourceAttributes: { "service.name": "order-service" },
    });

    const logger = Logger.get("order_service.api", "1.0.0");
    logger.info("request received", { "request.id": "req-abc", "user.id": 42 });
    // --- snippet end ---------------------------------------------------

    // The InMemorySink shadow lets us assert on the structured record.
    const records = captureSink.records();
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.body).toBe("request received");
    expect(rec.severity_text).toBe("INFO");
    expect(rec.attributes["request.id"]).toBe("req-abc");
    expect(rec.attributes["user.id"]).toBe(42);
    expect(rec.resource?.attributes["service.name"]).toBe("order-service");
    expect(rec.instrumentation_scope?.name).toBe("order_service.api");
    expect(rec.instrumentation_scope?.version).toBe("1.0.0");

    // ConsoleSink in "auto" mode with a non-TTY stream falls back to JSON.
    expect(stream.buffer).toContain("request received");
  });
});

// ── "Adding sinks" — multi-sink configure ─────────────────────────────

describe("intro.mdx — Adding sinks (TypeScript)", () => {
  it("snippet: configure with ConsoleSink + custom-stream + resourceAttributes", () => {
    // The doc snippet uses FileSink("/var/log/...") which the test sandbox
    // cannot write to. We replace it with an InMemorySink so the structural
    // shape of the configure({ sinks: [...] }) call is exercised verbatim.
    // Marked NB so docs/binding drift can be caught.
    const stream = new BufferedStream();
    const captureSink = new InMemorySink();

    // --- snippet start (intro / adding sinks — adapted) ---------------
    // import { ConsoleSink, FileSink, InMemorySink, configure } from "@dagstack/logger";
    configure({
      rootLevel: "INFO",
      sinks: [
        new ConsoleSink({ mode: "json", stream }),
        // NB: docs use `new FileSink("/var/log/order-service.jsonl", { maxBytes: 100_000_000, keep: 10 })`.
        // Substituted with InMemorySink for sandbox-safe execution.
        captureSink,
      ],
      resourceAttributes: {
        "service.name": "order-service",
        "service.version": "1.0.0",
        "deployment.environment": "production",
      },
    });
    // --- snippet end ---------------------------------------------------

    Logger.get("test").info("hello", { k: "v" });
    const rec = captureSink.records()[0];
    expect(rec?.resource?.attributes["service.version"]).toBe("1.0.0");
    expect(rec?.resource?.attributes["deployment.environment"]).toBe("production");
    expect(stream.buffer).toContain("hello");
  });
});

// ── "Logging exceptions" ──────────────────────────────────────────────

describe("intro.mdx — Logging exceptions (TypeScript)", () => {
  it("snippet: try/catch + logger.exception(err, { attributes })", async () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });
    const logger = Logger.get("order_service");
    const orderId = 1234;

    async function processOrder(_id: number): Promise<void> {
      throw new TypeError("invalid order");
    }

    // --- snippet start (intro / logging exceptions) -------------------
    try {
      await processOrder(orderId);
    } catch (err) {
      logger.exception(err, { attributes: { "order.id": orderId } });
    }
    // --- snippet end ---------------------------------------------------

    const rec = sink.records()[0];
    expect(rec?.severity_text).toBe("ERROR");
    expect(rec?.attributes["exception.type"]).toBe("TypeError");
    expect(rec?.attributes["exception.message"]).toBe("invalid order");
    expect(rec?.attributes["order.id"]).toBe(1234);
    expect(typeof rec?.attributes["exception.stacktrace"]).toBe("string");
  });
});

// ── "Capturing logs in tests" — InMemorySink + scopeSinks ─────────────

describe("intro.mdx — Capturing logs in tests (TypeScript)", () => {
  it("snippet: scopeSinks captures inside the callback", async () => {
    configure({ rootLevel: "INFO", sinks: [new InMemorySink()] });
    async function runBusinessLogic(): Promise<void> {
      Logger.get("test_module").info("operation completed");
    }

    // --- snippet start (intro / capturing logs in tests) --------------
    // import { InMemorySink, Logger } from "@dagstack/logger";

    const sink = new InMemorySink({ capacity: 100 });
    const logger = Logger.get("test_module");

    await logger.scopeSinks([sink], async (_scoped) => {
      await runBusinessLogic();
    });

    const records = sink.records();
    if (!records.some((r) => r.body === "operation completed")) {
      throw new Error("expected record not captured");
    }
    // --- snippet end ---------------------------------------------------

    expect(records.some((r) => r.body === "operation completed")).toBe(true);
  });
});
