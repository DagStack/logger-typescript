import type { Context, ContextManager } from "@opentelemetry/api";
import { context, propagation, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_BAGGAGE_KEYS,
  getActiveTraceContext,
  getBaggageAttributes,
} from "../src/context.js";

/**
 * Minimal synchronous stack-based ContextManager — sufficient for unit tests
 * within a single tick (no async/await suspension between with() and the
 * inner `getActiveTraceContext()` call). Production code should pull
 * `@opentelemetry/context-async-hooks` for cross-await context propagation.
 */
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

describe("getActiveTraceContext", () => {
  it("returns undefined ids when no active span", () => {
    const { traceId, spanId, traceFlags } = getActiveTraceContext();
    expect(traceId).toBeUndefined();
    expect(spanId).toBeUndefined();
    expect(traceFlags).toBe(0);
  });

  it("decodes the active span context into bytes", () => {
    const fakeContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
    const fakeSpan = trace.wrapSpanContext(fakeContext);
    const ctxWithSpan = trace.setSpan(context.active(), fakeSpan);

    context.with(ctxWithSpan, () => {
      const { traceId, spanId, traceFlags } = getActiveTraceContext();
      expect(traceId).toEqual(
        new Uint8Array([
          0x0a, 0xf7, 0x65, 0x19, 0x16, 0xcd, 0x43, 0xdd, 0x84, 0x48, 0xeb, 0x21, 0x1c, 0x80, 0x31,
          0x9c,
        ]),
      );
      expect(spanId).toEqual(new Uint8Array([0xb7, 0xad, 0x6b, 0x71, 0x69, 0x20, 0x33, 0x31]));
      expect(traceFlags).toBe(1);
    });
  });
});

describe("getBaggageAttributes", () => {
  it("returns an empty object when no baggage is active", () => {
    expect(getBaggageAttributes()).toEqual({});
  });

  it("injects whitelisted baggage entries as attributes", () => {
    const baggage = propagation.createBaggage({
      "tenant.id": { value: "tenant-42" },
      "request.id": { value: "req-abc" },
      "custom.key": { value: "ignored" },
    });
    const ctx = propagation.setBaggage(context.active(), baggage);

    context.with(ctx, () => {
      const attrs = getBaggageAttributes();
      expect(attrs["tenant.id"]).toBe("tenant-42");
      expect(attrs["request.id"]).toBe("req-abc");
      expect(attrs["custom.key"]).toBeUndefined();
    });
  });

  it("DEFAULT_BAGGAGE_KEYS lists the spec-mandated keys", () => {
    expect(DEFAULT_BAGGAGE_KEYS).toContain("tenant.id");
    expect(DEFAULT_BAGGAGE_KEYS).toContain("request.id");
    expect(DEFAULT_BAGGAGE_KEYS).toContain("user.id");
  });
});
