// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/context.mdx`.
//
// W3C Baggage propagation requires an active OTel ContextManager. We install
// the same minimal `StackContextManager` used by `tests/context.test.ts` so
// the docs snippet runs against real OTel context APIs.

import type { Context, ContextManager } from "@opentelemetry/api";
import { context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

class StackContextManager implements ContextManager {
  private stack: Context[] = [ROOT_CONTEXT];
  active(): Context {
    return this.stack[this.stack.length - 1]!;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    this.stack.push(ctx);
    try {
      return fn.call(thisArg!, ...args);
    } finally {
      this.stack.pop();
    }
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    this.stack = [ROOT_CONTEXT];
    return this;
  }
}

const ctxManager = new StackContextManager();

beforeAll(() => {
  ctxManager.enable();
  context.setGlobalContextManager(ctxManager);
});

afterAll(() => {
  context.disable();
});

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Setting baggage entries" ─────────────────────────────────────────

describe("concepts/context.mdx — Setting baggage entries (TypeScript)", () => {
  it("snippet: tenant.id baggage flows into emitted attributes", async () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });
    const logger = Logger.get("order_service");

    // --- snippet start (context / baggage) -----------------------------
    // import { context, propagation } from "@opentelemetry/api";

    const baggage = propagation.createBaggage().setEntry("tenant.id", { value: "acme-corp" });
    const ctx = propagation.setBaggage(context.active(), baggage);

    await context.with(ctx, async () => {
      logger.info("processing request");
      // The emitted record carries attributes={"tenant.id": "acme-corp", ...}
      // plus trace_id / span_id from the active span (if any).
    });
    // --- snippet end ---------------------------------------------------

    const rec = sink.records()[0];
    expect(rec?.body).toBe("processing request");
    expect(rec?.attributes["tenant.id"]).toBe("acme-corp");
    // Outside the context.with(...) block, baggage is no longer active.
    logger.info("outside");
    const outside = sink.records()[1];
    expect(outside?.attributes["tenant.id"]).toBeUndefined();
  });
});
