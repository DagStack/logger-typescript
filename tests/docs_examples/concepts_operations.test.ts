// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/operations.mdx`.
//
// The page itself flags `logger.operation(...)` as Phase 2 — Phase 1 callers
// use the documented manual workaround via `child({...})`. The snippet under
// test is exactly that manual workaround.

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "The manual workaround" — child({operation.* attrs}) ──────────────

describe("concepts/operations.mdx — Manual workaround (TypeScript)", () => {
  it("snippet: child({operation.name, operation.id, operation.kind}) + started/completed", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });

    // --- snippet start (operations / manual workaround) ---------------
    // import { randomUUID } from "node:crypto";
    // import { Logger } from "@dagstack/logger";

    const logger = Logger.get("order_service");

    const opLogger = logger.child({
      "operation.name": "process_order",
      "operation.id": randomUUID(),
      "operation.kind": "lifecycle",
    });
    opLogger.info("started", { "order.id": 1234 });
    opLogger.info("completed", {
      "operation.status": "ok",
      "operation.duration_ms": 142,
    });
    // --- snippet end ---------------------------------------------------

    const records = sink.records();
    expect(records).toHaveLength(2);

    const started = records[0]!;
    expect(started.body).toBe("started");
    expect(started.attributes["operation.name"]).toBe("process_order");
    expect(started.attributes["operation.kind"]).toBe("lifecycle");
    expect(started.attributes["order.id"]).toBe(1234);
    expect(typeof started.attributes["operation.id"]).toBe("string");

    const completed = records[1]!;
    expect(completed.body).toBe("completed");
    expect(completed.attributes["operation.status"]).toBe("ok");
    expect(completed.attributes["operation.duration_ms"]).toBe(142);
    // The child-bound operation.* attributes survive into the second emit.
    expect(completed.attributes["operation.name"]).toBe("process_order");
    // operation.id is the same UUID across both records.
    expect(completed.attributes["operation.id"]).toBe(started.attributes["operation.id"]);
  });
});
