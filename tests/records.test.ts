import { describe, expect, it } from "vitest";

import type { InstrumentationScope, LogRecord, Resource } from "../src/records.js";

describe("InstrumentationScope", () => {
  it("accepts name only", () => {
    const s: InstrumentationScope = { name: "dagstack.rag" };
    expect(s.name).toBe("dagstack.rag");
    expect(s.version).toBeUndefined();
    expect(s.attributes).toBeUndefined();
  });

  it("accepts version + attributes", () => {
    const s: InstrumentationScope = {
      name: "dagstack.rag.retriever",
      version: "1.4.2",
      attributes: { foo: "bar" },
    };
    expect(s.version).toBe("1.4.2");
    expect(s.attributes).toEqual({ foo: "bar" });
  });
});

describe("Resource", () => {
  it("requires attributes (may be empty)", () => {
    const r: Resource = { attributes: {} };
    expect(r.attributes).toEqual({});
  });

  it("carries process / service-level attrs", () => {
    const r: Resource = { attributes: { "service.name": "my-app" } };
    expect(r.attributes["service.name"]).toBe("my-app");
  });
});

describe("LogRecord", () => {
  it("supports minimal construction", () => {
    const rec: LogRecord = {
      time_unix_nano: 1_700_000_000_000_000_000n,
      severity_number: 9,
      severity_text: "INFO",
      body: "hello world",
      attributes: {},
      trace_flags: 0,
    };
    expect(rec.body).toBe("hello world");
    expect(rec.attributes).toEqual({});
    expect(rec.trace_flags).toBe(0);
    expect(rec.trace_id).toBeUndefined();
    expect(rec.span_id).toBeUndefined();
  });

  it("carries all OTel fields when populated", () => {
    const scope: InstrumentationScope = { name: "dagstack.rag", version: "1.0" };
    const resource: Resource = { attributes: { "service.name": "app" } };
    const rec: LogRecord = {
      time_unix_nano: 1_700_000_000_000_000_000n,
      severity_number: 17,
      severity_text: "ERROR",
      body: { msg: "failure", code: 500 },
      attributes: { "user.id": 42, "request.id": "req-abc" },
      instrumentation_scope: scope,
      resource,
      trace_id: new Uint8Array(16),
      span_id: new Uint8Array(8),
      trace_flags: 1,
      observed_time_unix_nano: 1_700_000_000_000_000_123n,
    };
    expect(rec.severity_text).toBe("ERROR");
    expect(rec.attributes["user.id"]).toBe(42);
    expect(rec.instrumentation_scope).toBe(scope);
    expect(rec.resource).toBe(resource);
    expect(rec.trace_id).toHaveLength(16);
    expect(rec.span_id).toHaveLength(8);
  });

  it("allows structured (non-string) body", () => {
    const rec: LogRecord = {
      time_unix_nano: 0n,
      severity_number: 9,
      severity_text: "INFO",
      body: { nested: [1, 2, { deep: true }] },
      attributes: {},
      trace_flags: 0,
    };
    expect(rec.body).toEqual({ nested: [1, 2, { deep: true }] });
  });
});
