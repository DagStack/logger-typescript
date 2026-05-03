// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/guides/testing.mdx`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Step 1. Capture records for one test" — scopeSinks pattern ──────

describe("guides/testing.mdx — Step 1: order placement (TypeScript)", () => {
  beforeEach(() => {
    // Bootstrap a no-op global config so emits outside scopeSinks don't
    // throw — the snippet relies on the harness running this before the
    // first emit.
    configure({ rootLevel: "INFO", sinks: [] });
  });

  // The snippet wraps a user-defined `placeOrder` — we provide a minimal
  // implementation that emits the audit record the assertions expect.
  async function placeOrder(orderId: number, userId: number): Promise<void> {
    Logger.get("order_service.checkout").info("order placed", {
      "order.id": orderId,
      "user.id": userId,
    });
  }

  // --- snippet start (testing / capture for one test) -----------------
  describe("order placement", () => {
    it("logs an audit event", async () => {
      const sink = new InMemorySink({ capacity: 100 });
      const logger = Logger.get("order_service.checkout");

      await logger.scopeSinks([sink], async () => {
        await placeOrder(1234, 42);
      });

      const records = sink.records();
      const audit = records.find((r) => r.body === "order placed");
      expect(audit?.severity_text).toBe("INFO");
      expect(audit?.attributes["order.id"]).toBe(1234);
      expect(audit?.attributes["user.id"]).toBe(42);
    });
  });
  // --- snippet end ---------------------------------------------------
});

// ── "Step 2. Reusable test fixture" — beforeEach / afterEach ─────────

describe("guides/testing.mdx — Step 2: vitest fixture (TypeScript)", () => {
  // The snippet's user-defined `placeOrder` is hoisted here.
  async function placeOrder(orderId: number, userId: number): Promise<void> {
    Logger.get("order_service").info("placed", {
      "order.id": orderId,
      "user.id": userId,
    });
  }

  // --- snippet start (testing / reusable fixture) --------------------
  /**
   * Vitest fixture: capture records emitted by the `order_service` logger
   * for the duration of each test in the suite.
   */
  describe("audit trail", () => {
    let sink: InMemorySink;

    beforeEach(() => {
      sink = new InMemorySink({ capacity: 1000 });
      const logger = Logger.get("order_service");
      logger.setSinks([sink]);
    });

    afterEach(() => {
      sink.clear();
      Logger.get("order_service").setSinks([]);
    });

    it("captures one record per order", async () => {
      await placeOrder(1234, 42);
      const records = sink.records();
      expect(records.length).toBe(1);
      expect(records[0]!.attributes["order.id"]).toBe(1234);
    });
  });
  // --- snippet end ---------------------------------------------------
});

// ── "Step 3. Asserting on attributes" — redaction + error count ──────

describe("guides/testing.mdx — Step 3: attribute assertions (TypeScript)", () => {
  let sink: InMemorySink;

  beforeEach(() => {
    sink = new InMemorySink({ capacity: 1000 });
    const logger = Logger.get("order_service");
    logger.setSinks([sink]);
  });

  afterEach(() => {
    sink.clear();
    Logger.get("order_service").setSinks([]);
  });

  // --- snippet start (testing / attribute assertions — masks key) ---
  it("masks api keys", () => {
    Logger.get("order_service").info("authenticated", {
      "user.id": 42,
      api_key: "sk-supersecret",
    });

    const record = sink.records()[0]!;
    expect(record.attributes["user.id"]).toBe(42);
    expect(record.attributes.api_key).toBe("***");
  });
  // --- snippet end ---------------------------------------------------

  // The "exactly one error" snippet relies on a user-defined
  // `runBusinessLogic` that throws an OrderValidationError — we provide
  // an inline equivalent so the assertions can run.
  async function runBusinessLogic(): Promise<void> {
    class OrderValidationError extends Error {
      override readonly name = "OrderValidationError";
    }
    try {
      throw new OrderValidationError("invalid order");
    } catch (err) {
      Logger.get("order_service").exception(err);
    }
  }

  // --- snippet start (testing / exactly-one error) -------------------
  it("emits exactly one error", async () => {
    await runBusinessLogic();
    const errors = sink.records().filter((r) => r.severity_text === "ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.attributes["exception.type"]).toBe("OrderValidationError");
  });
  // --- snippet end ---------------------------------------------------
});

// ── "Step 4. Resetting between assertions" — sink.clear() ────────────

describe("guides/testing.mdx — Step 4: phase separation (TypeScript)", () => {
  let sink: InMemorySink;

  beforeEach(() => {
    sink = new InMemorySink({ capacity: 1000 });
    const logger = Logger.get("order_service");
    logger.setSinks([sink]);
  });

  afterEach(() => {
    sink.clear();
    Logger.get("order_service").setSinks([]);
  });

  async function runPhaseOne(): Promise<void> {
    Logger.get("order_service").info("phase 1 complete");
  }
  async function runPhaseTwo(): Promise<void> {
    Logger.get("order_service").info("phase 2 progress", { phase: "two" });
    Logger.get("order_service").info("phase 2 done", { phase: "two" });
  }

  // --- snippet start (testing / phase separation) -------------------
  it("separates phases", async () => {
    await runPhaseOne();
    expect(sink.records().some((r) => r.body === "phase 1 complete")).toBe(true);

    sink.clear();

    await runPhaseTwo();
    expect(sink.records().every((r) => r.attributes.phase === "two")).toBe(true);
  });
  // --- snippet end ---------------------------------------------------
});

// ── "Step 5. Avoiding capacity overflow" — high-volume capture ───────

describe("guides/testing.mdx — Step 5: high-volume capture (TypeScript)", () => {
  beforeEach(() => {
    configure({ rootLevel: "INFO", sinks: [] });
  });

  async function indexRepository(): Promise<void> {
    const log = Logger.get("indexer");
    for (let i = 0; i < 50; i++) {
      log.info("tick", { "event.name": "tick", i });
    }
    log.info("completed", { "event.name": "completed" });
  }

  // --- snippet start (testing / high-volume) ------------------------
  it("captures high-volume indexing", async () => {
    const sink = new InMemorySink({ capacity: 10_000 });
    const logger = Logger.get("indexer");

    await logger.scopeSinks([sink], async () => {
      await indexRepository();
    });

    expect(sink.records().length).toBeLessThanOrEqual(sink.capacity);
    expect(sink.records().some((r) => r.attributes["event.name"] === "completed")).toBe(true);
  });
  // --- snippet end ---------------------------------------------------
});
