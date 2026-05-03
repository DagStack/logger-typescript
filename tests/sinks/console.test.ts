import { describe, expect, it } from "vitest";

import type { LogRecord } from "../../src/records.js";
import { ConsoleSink } from "../../src/sinks/console.js";
import type { ConsoleStream } from "../../src/sinks/console.js";

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time_unix_nano: 1_700_000_000_000_000_000n,
    severity_number: 9,
    severity_text: "INFO",
    body: "hello",
    attributes: {},
    instrumentation_scope: { name: "dagstack.rag" },
    trace_flags: 0,
    ...overrides,
  };
}

class BufferedStream implements ConsoleStream {
  buffer = "";
  isTTY: boolean;
  constructor(isTTY = false) {
    this.isTTY = isTTY;
  }
  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
}

describe("ConsoleSink JSON mode", () => {
  it("writes one canonical JSON line per emit", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "json", stream });
    sink.emit(makeRecord({ body: "hello" }));
    expect(stream.buffer.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(stream.buffer.trim()) as { body: string; severity_text: string };
    expect(parsed.body).toBe("hello");
    expect(parsed.severity_text).toBe("INFO");
  });

  it("starts the output with the canonically-sorted key order", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "json", stream });
    sink.emit(makeRecord({ body: "msg" }));
    expect(stream.buffer.trim().startsWith('{"body":')).toBe(true);
  });

  it("separates multiple records with newlines", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "json", stream });
    sink.emit(makeRecord({ body: "one" }));
    sink.emit(makeRecord({ body: "two" }));
    expect(stream.buffer.trim().split("\n")).toHaveLength(2);
  });
});

describe("ConsoleSink auto mode", () => {
  it("uses JSON when the stream is not a TTY", () => {
    const stream = new BufferedStream(false);
    const sink = new ConsoleSink({ mode: "auto", stream });
    sink.emit(makeRecord());
    JSON.parse(stream.buffer.trim()); // does not throw
  });

  it("uses pretty when the stream is a TTY", () => {
    const stream = new BufferedStream(true);
    const sink = new ConsoleSink({ mode: "auto", stream });
    sink.emit(makeRecord({ body: "msg" }));
    expect(stream.buffer).toContain("["); // ANSI escape
  });
});

describe("ConsoleSink pretty mode", () => {
  it("includes the severity text", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord({ body: "x", severity_text: "WARN" }));
    expect(stream.buffer).toContain("WARN");
  });

  it("includes the logger name", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord({ instrumentation_scope: { name: "dagstack.test" } }));
    expect(stream.buffer).toContain("dagstack.test");
  });

  it("falls back to 'root' when no instrumentation_scope is present", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    const rec: LogRecord = {
      time_unix_nano: 1_700_000_000_000_000_000n,
      severity_number: 9,
      severity_text: "INFO",
      body: "x",
      attributes: {},
      trace_flags: 0,
    };
    sink.emit(rec);
    expect(stream.buffer).toContain("root");
  });

  it("renders attributes in 'k=v' style", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord({ attributes: { "user.id": 42, "request.id": "abc" } }));
    expect(stream.buffer).toContain("user.id=42");
    expect(stream.buffer).toContain("request.id=abc");
  });

  it("quotes string values containing spaces", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord({ attributes: { msg: "hello world" } }));
    expect(stream.buffer).toContain('"hello world"');
  });

  it("formats timestamp as ISO-8601 UTC with microseconds", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord());
    // Unix nano 1700000000 seconds → 2023-11-14T22:13:20Z
    expect(stream.buffer).toContain("2023-11-14T22:13:20");
    expect(stream.buffer).toContain("Z");
  });

  it("renders structured body as compact JSON", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(makeRecord({ body: { nested: [1, 2] } }));
    expect(stream.buffer).toContain('{"nested":[1,2]}');
  });

  it("renders boolean / null attribute values", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "pretty", stream });
    sink.emit(
      makeRecord({
        attributes: { is_production: true, debug_mode: false, optional_value: null },
      }),
    );
    expect(stream.buffer).toContain("is_production=true");
    expect(stream.buffer).toContain("debug_mode=false");
    expect(stream.buffer).toContain("optional_value=null");
  });
});

describe("ConsoleSink filter", () => {
  it("drops records below minSeverity", () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "json", stream, minSeverity: 9 });
    sink.emit(makeRecord({ severity_number: 5, body: "debug" }));
    sink.emit(makeRecord({ severity_number: 9, body: "info" }));
    expect(stream.buffer.split("\n").filter((l) => l !== "")).toHaveLength(1);
  });

  it("supportsSeverity reflects the configured threshold", () => {
    const sink = new ConsoleSink({ minSeverity: 13 });
    expect(sink.supportsSeverity(9)).toBe(false);
    expect(sink.supportsSeverity(13)).toBe(true);
  });
});

describe("ConsoleSink lifecycle", () => {
  it("close() prevents further writes", async () => {
    const stream = new BufferedStream();
    const sink = new ConsoleSink({ mode: "json", stream });
    sink.emit(makeRecord({ body: "before" }));
    await sink.close();
    sink.emit(makeRecord({ body: "after" }));
    const lines = stream.buffer.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
  });

  it("close() is idempotent", async () => {
    const sink = new ConsoleSink({ mode: "json", stream: new BufferedStream() });
    await sink.close();
    await sink.close();
  });

  it("flush() resolves without throwing", async () => {
    const sink = new ConsoleSink({ mode: "json", stream: new BufferedStream() });
    await expect(sink.flush()).resolves.toEqual({ ok: true });
  });

  it("id reflects the configured mode", () => {
    expect(new ConsoleSink({ mode: "json", stream: new BufferedStream() }).id).toBe("console:json");
    expect(new ConsoleSink({ mode: "pretty", stream: new BufferedStream() }).id).toBe(
      "console:pretty",
    );
    expect(new ConsoleSink({ mode: "auto", stream: new BufferedStream() }).id).toBe("console:auto");
  });
});
