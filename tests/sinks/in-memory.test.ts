import { describe, expect, it } from "vitest";

import type { LogRecord } from "../../src/records.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

function makeRecord(body: string, severity = 9): LogRecord {
  return {
    time_unix_nano: 0n,
    severity_number: severity,
    severity_text: "INFO",
    body,
    attributes: {},
    trace_flags: 0,
  };
}

describe("InMemorySink", () => {
  it("captures a record via emit()", () => {
    const sink = new InMemorySink({ capacity: 10 });
    sink.emit(makeRecord("hello"));
    const records = sink.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe("hello");
  });

  it("drops oldest records when capacity is exceeded", () => {
    const sink = new InMemorySink({ capacity: 3 });
    for (let i = 0; i < 5; i++) sink.emit(makeRecord(`msg-${i.toString()}`));
    const records = sink.records();
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.body)).toEqual(["msg-2", "msg-3", "msg-4"]);
  });

  it("returns a copy from records()", () => {
    const sink = new InMemorySink();
    sink.emit(makeRecord("x"));
    const snapshot = sink.records();
    snapshot.length = 0;
    expect(sink.records()).toHaveLength(1);
  });

  it("clear() empties internal storage", () => {
    const sink = new InMemorySink();
    sink.emit(makeRecord("a"));
    sink.emit(makeRecord("b"));
    sink.clear();
    expect(sink.records()).toEqual([]);
  });

  it("close() prevents further emits", async () => {
    const sink = new InMemorySink();
    sink.emit(makeRecord("before"));
    await sink.close();
    sink.emit(makeRecord("after"));
    const records = sink.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe("before");
  });

  it("flush() resolves to ok=true (in-memory has nothing to drain)", async () => {
    const sink = new InMemorySink();
    await expect(sink.flush()).resolves.toEqual({ ok: true });
  });

  it("id encodes the capacity with a per-instance suffix", () => {
    expect(new InMemorySink({ capacity: 42 }).id).toMatch(/^in-memory:cap=42#\d+$/);
  });

  it("two InMemorySinks with the same capacity get distinct ids", () => {
    const a = new InMemorySink({ capacity: 10 });
    const b = new InMemorySink({ capacity: 10 });
    expect(a.id).not.toBe(b.id);
  });

  it("supports a minSeverity filter", () => {
    const sink = new InMemorySink({ minSeverity: 9 });
    sink.emit(makeRecord("debug", 5));
    sink.emit(makeRecord("info", 9));
    sink.emit(makeRecord("error", 17));
    expect(sink.records().map((r) => r.body)).toEqual(["info", "error"]);
  });

  it("supportsSeverity reflects the threshold", () => {
    const sink = new InMemorySink({ minSeverity: 9 });
    expect(sink.supportsSeverity(5)).toBe(false);
    expect(sink.supportsSeverity(9)).toBe(true);
    expect(sink.supportsSeverity(17)).toBe(true);
  });
});
