import { describe, expect, it } from "vitest";

import type { LogRecord } from "../src/records.js";
import { toDagstackJsonl, toDagstackJsonlObject } from "../src/wire.js";

function baseRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time_unix_nano: 1_700_000_000_000_000_000n,
    severity_number: 9,
    severity_text: "INFO",
    body: "hello",
    attributes: {},
    trace_flags: 0,
    ...overrides,
  };
}

describe("Minimal LogRecord", () => {
  it("emits required fields only", () => {
    const d = toDagstackJsonlObject(baseRecord());
    expect(d).toEqual({
      time_unix_nano: 1_700_000_000_000_000_000n,
      severity_number: 9,
      severity_text: "INFO",
      body: "hello",
    });
  });

  it("omits empty / undefined optionals", () => {
    const d = toDagstackJsonlObject(baseRecord());
    expect(d).not.toHaveProperty("trace_id");
    expect(d).not.toHaveProperty("span_id");
    expect(d).not.toHaveProperty("instrumentation_scope");
    expect(d).not.toHaveProperty("resource");
    expect(d).not.toHaveProperty("attributes");
    expect(d).not.toHaveProperty("observed_time_unix_nano");
    expect(d).not.toHaveProperty("trace_flags");
  });
});

describe("Optionals", () => {
  it("encodes trace_id / span_id as lowercase hex", () => {
    const traceBytes = new Uint8Array(16);
    const spanBytes = new Uint8Array(8);
    for (let i = 0; i < traceBytes.length; i++) traceBytes[i] = i;
    for (let i = 0; i < spanBytes.length; i++) spanBytes[i] = i;
    const d = toDagstackJsonlObject(
      baseRecord({ trace_id: traceBytes, span_id: spanBytes, trace_flags: 1 }),
    );
    expect(d.trace_id).toBe("000102030405060708090a0b0c0d0e0f");
    expect(d.span_id).toBe("0001020304050607");
    expect(d.trace_flags).toBe(1);
  });

  it("omits trace_flags when zero", () => {
    const d = toDagstackJsonlObject(baseRecord());
    expect(d).not.toHaveProperty("trace_flags");
  });

  it("emits populated attributes", () => {
    const d = toDagstackJsonlObject(
      baseRecord({ attributes: { "user.id": 42, "request.id": "req-abc" } }),
    );
    expect(d.attributes).toEqual({ "user.id": 42, "request.id": "req-abc" });
  });

  it("omits empty attributes", () => {
    const d = toDagstackJsonlObject(baseRecord({ attributes: {} }));
    expect(d).not.toHaveProperty("attributes");
  });

  it("emits instrumentation_scope (with version)", () => {
    const d = toDagstackJsonlObject(
      baseRecord({ instrumentation_scope: { name: "dagstack.rag", version: "1.0.0" } }),
    );
    expect(d.instrumentation_scope).toEqual({ name: "dagstack.rag", version: "1.0.0" });
  });

  it("emits scope without version when undefined", () => {
    const d = toDagstackJsonlObject(baseRecord({ instrumentation_scope: { name: "root" } }));
    expect(d.instrumentation_scope).toEqual({ name: "root" });
  });

  it("emits scope.attributes when populated", () => {
    const d = toDagstackJsonlObject(
      baseRecord({
        instrumentation_scope: { name: "rag", attributes: { build: "prod" } },
      }),
    );
    expect((d.instrumentation_scope as { attributes: Record<string, unknown> }).attributes).toEqual(
      {
        build: "prod",
      },
    );
  });

  it("emits resource when attributes present", () => {
    const d = toDagstackJsonlObject(
      baseRecord({ resource: { attributes: { "service.name": "my-app" } } }),
    );
    expect(d.resource).toEqual({ attributes: { "service.name": "my-app" } });
  });

  it("omits resource with empty attributes", () => {
    const d = toDagstackJsonlObject(baseRecord({ resource: { attributes: {} } }));
    expect(d).not.toHaveProperty("resource");
  });

  it("emits observed_time_unix_nano when set", () => {
    const d = toDagstackJsonlObject(baseRecord({ observed_time_unix_nano: 200n }));
    expect(d.observed_time_unix_nano).toBe(200n);
  });
});

describe("Canonical JSON-lines output", () => {
  it("produces deterministic, sorted-key, no-whitespace output", () => {
    const s = toDagstackJsonl(
      baseRecord({ time_unix_nano: 100n, severity_number: 9, severity_text: "INFO", body: "hi" }),
    );
    expect(s).toBe('{"body":"hi","severity_number":9,"severity_text":"INFO","time_unix_nano":100}');
  });

  it("round-trips through JSON.parse for nested data", () => {
    const s = toDagstackJsonl(
      baseRecord({
        body: { nested: [1, 2, 3] },
        attributes: { k: "v" },
      }),
    );
    const parsed = JSON.parse(s) as { body: { nested: number[] }; attributes: { k: string } };
    expect(parsed.body.nested).toEqual([1, 2, 3]);
    expect(parsed.attributes.k).toBe("v");
  });

  it("produces no trailing newline", () => {
    const s = toDagstackJsonl(baseRecord());
    expect(s.endsWith("\n")).toBe(false);
  });

  it("is deterministic across calls", () => {
    const rec = baseRecord({
      time_unix_nano: 100n,
      severity_number: 17,
      severity_text: "ERROR",
      body: "x",
      attributes: { z: 1, a: 2 },
    });
    expect(toDagstackJsonl(rec)).toBe(toDagstackJsonl(rec));
  });
});
