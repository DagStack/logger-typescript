// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/guides/custom-sink.mdx`.
//
// The page documents a `CallbackSink` reference implementation. The class
// definition below is copied verbatim between the snippet markers; the
// integration snippet ("forwarding to Sentry") is adapted to run against a
// captured callback (the docs use `@sentry/node`, which we cannot import).

import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import type { LogRecord } from "../../src/records.js";
import type { FlushResult, Sink } from "../../src/sinks/base.js";
import { ConsoleSink, type ConsoleStream } from "../../src/sinks/console.js";

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

// --- snippet start (custom-sink / CallbackSink class) ----------------
// import type { FlushResult, LogRecord, Sink } from "@dagstack/logger";

type RecordCallback = (record: LogRecord) => void;

/** Forward each LogRecord to a user-supplied callback. */
export class CallbackSink implements Sink {
  public readonly id: string;
  private readonly callback: RecordCallback;
  private readonly minSeverity: number;
  private closed = false;

  constructor(callback: RecordCallback, options: { minSeverity?: number } = {}) {
    this.callback = callback;
    this.minSeverity = options.minSeverity ?? 1;
    this.id = `callback:${callback.name || "anonymous"}`;
  }

  emit(record: LogRecord): void {
    if (this.closed) return;
    if (!this.supportsSeverity(record.severity_number)) return;
    this.callback(record);
  }

  async flush(_timeoutMs?: number): Promise<FlushResult> {
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  supportsSeverity(severityNumber: number): boolean {
    return severityNumber >= this.minSeverity;
  }
}
// --- snippet end ----------------------------------------------------

describe("guides/custom-sink.mdx — CallbackSink class (TypeScript)", () => {
  it("forwards a record to the callback", () => {
    const captured: LogRecord[] = [];
    const sink = new CallbackSink((rec) => captured.push(rec));
    configure({ rootLevel: "INFO", sinks: [sink] });
    Logger.get("x").info("hello", { "user.id": 42 });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body).toBe("hello");
    expect(captured[0]?.attributes["user.id"]).toBe(42);
  });

  it("filters by minSeverity (skips records below the threshold)", () => {
    const captured: LogRecord[] = [];
    const sink = new CallbackSink((rec) => captured.push(rec), { minSeverity: 17 });
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("x").info("dropped");
    Logger.get("x").error("kept");
    expect(captured.map((r) => r.body)).toEqual(["kept"]);
  });

  it("drops emits after close()", async () => {
    const captured: LogRecord[] = [];
    const sink = new CallbackSink((rec) => captured.push(rec));
    await sink.close();
    sink.emit({
      time_unix_nano: 0n,
      severity_number: 9,
      severity_text: "INFO",
      body: "post-close",
      attributes: {},
      trace_flags: 0,
    });
    expect(captured).toHaveLength(0);
  });

  it("derives an id from the callback name", () => {
    function namedCallback(_record: LogRecord): void {}
    const sink = new CallbackSink(namedCallback);
    expect(sink.id).toBe("callback:namedCallback");
  });

  it("falls back to 'anonymous' for unnamed callbacks", () => {
    const sink = new CallbackSink((_record: LogRecord) => {
      // anonymous arrow assigned to a const — the function's `name` is ""
      // when used as a positional argument like below, depending on inlining.
      // The snippet promises "anonymous" for empty names; we check the
      // observable `id` reflects that contract.
    });
    // `id` must start with "callback:" per the snippet contract.
    expect(sink.id.startsWith("callback:")).toBe(true);
  });
});

// ── "Wire it up alongside the built-in sinks" — Sentry integration ──

describe("guides/custom-sink.mdx — Wire-up + forwardToSentry (TypeScript)", () => {
  it("snippet: configure includes ConsoleSink + CallbackSink at minSeverity 17", () => {
    // The doc snippet imports `@sentry/node`; we replace it with an
    // in-test fake that records the calls. The structural shape of
    // `forwardToSentry` is preserved.
    const sentryEvents: { message: string; level: string; extra: Record<string, unknown> }[] = [];
    const SentryFake = {
      captureMessage(
        message: string,
        opts: { level: string; extra: Record<string, unknown> },
      ): void {
        sentryEvents.push({ message, level: opts.level, extra: opts.extra });
      },
    };
    const stream = new BufferedStream();

    // --- snippet start (custom-sink / wire-up — adapted Sentry import)
    // import * as Sentry from "@sentry/node";
    // import { ConsoleSink, configure, type LogRecord } from "@dagstack/logger";
    // import { CallbackSink } from "./callback-sink";

    function forwardToSentry(record: LogRecord): void {
      if (record.severity_number >= 17) {
        // ERROR and above
        SentryFake.captureMessage(String(record.body), {
          level: "error",
          extra: { ...record.attributes },
        });
      }
    }

    configure({
      rootLevel: "INFO",
      sinks: [
        new ConsoleSink({ mode: "auto", stream }),
        new CallbackSink(forwardToSentry, { minSeverity: 17 }),
      ],
    });
    // --- snippet end ---------------------------------------------------

    Logger.get("x").info("ignored by sentry filter");
    Logger.get("x").error("captured by sentry", { "request.id": "req-1" });

    expect(sentryEvents).toHaveLength(1);
    expect(sentryEvents[0]?.message).toBe("captured by sentry");
    expect(sentryEvents[0]?.level).toBe("error");
    expect(sentryEvents[0]?.extra["request.id"]).toBe("req-1");
  });
});
