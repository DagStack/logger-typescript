import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../src/configuration.js";
import { Logger, _resetRegistryForTests } from "../src/logger.js";
import type { LogRecord } from "../src/records.js";
import { Severity } from "../src/severity.js";
import type { FlushResult, Sink } from "../src/sinks/base.js";
import { ConsoleSink } from "../src/sinks/console.js";
import type { ConsoleStream } from "../src/sinks/console.js";
import { InMemorySink } from "../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

describe("Logger.get registry", () => {
  it("caches the root logger", () => {
    const a = Logger.get("");
    const b = Logger.get("");
    expect(a).toBe(b);
  });

  it("caches a named logger", () => {
    const a = Logger.get("dagstack.rag");
    const b = Logger.get("dagstack.rag");
    expect(a).toBe(b);
  });

  it("updates the version on an existing logger", () => {
    const a = Logger.get("x");
    const b = Logger.get("x", "1.0");
    expect(a).toBe(b);
    expect(b.version).toBe("1.0");
  });

  it("creates the parent chain on first access", () => {
    Logger.get("dagstack.rag.retriever");
    // The intermediate parents must be cached too — re-fetching is identity-stable.
    const ragParent = Logger.get("dagstack.rag");
    expect(ragParent.name).toBe("dagstack.rag");
  });
});

describe("Logger.reset", () => {
  it("clears the registry — set_* state on a singleton does not leak", () => {
    const a = Logger.get("dagstack.reset_test");
    a.setMinSeverity(99);
    Logger.reset();
    const b = Logger.get("dagstack.reset_test");
    expect(b).not.toBe(a);
    expect(b.effectiveMinSeverity()).toBe(1);
  });

  it("is idempotent", () => {
    Logger.reset();
    Logger.reset();
    expect(Logger.get("dagstack.reset_idempotent").name).toBe("dagstack.reset_idempotent");
  });
});

describe("Severity methods", () => {
  it("info() emits with INFO severity_number and severity_text", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("test").info("msg");
    const rec = sink.records()[0];
    expect(rec?.severity_number).toBe(Severity.INFO);
    expect(rec?.severity_text).toBe("INFO");
    expect(rec?.body).toBe("msg");
  });

  it("emits all 6 severities", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    const log = Logger.get("x");
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.fatal("f");
    const severities = sink.records().map((r) => r.severity_text);
    expect(severities).toEqual(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
  });

  it("log() with explicit severity_number puts the bucket text", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("x").log(10, "intermediate"); // INFO bucket
    const rec = sink.records()[0];
    expect(rec?.severity_number).toBe(10);
    expect(rec?.severity_text).toBe("INFO");
  });
});

describe("Exception logging", () => {
  it("populates exception.* OTel attributes", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    try {
      throw new TypeError("boom");
    } catch (err) {
      Logger.get("x").exception(err);
    }
    const rec = sink.records()[0];
    expect(rec?.severity_text).toBe("ERROR");
    expect(rec?.attributes["exception.type"]).toBe("TypeError");
    expect(rec?.attributes["exception.message"]).toBe("boom");
    const stacktrace = rec?.attributes["exception.stacktrace"];
    expect(typeof stacktrace).toBe("string");
    expect(stacktrace as string).toContain("boom");
  });

  it("accepts a custom body and merges extra attributes", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    try {
      throw new Error("oops");
    } catch (err) {
      Logger.get("x").exception(err, {
        body: "failed to process",
        attributes: { "request.id": "req-42" },
      });
    }
    const rec = sink.records()[0];
    expect(rec?.body).toBe("failed to process");
    expect(rec?.attributes["request.id"]).toBe("req-42");
    expect(rec?.attributes["exception.type"]).toBe("Error");
  });

  it("wraps a non-Error throwable into an Error", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("x").exception("something went wrong");
    const rec = sink.records()[0];
    expect(rec?.attributes["exception.type"]).toBe("Error");
    expect(rec?.attributes["exception.message"]).toBe("something went wrong");
  });
});

describe("Attributes and child loggers", () => {
  it("merges call-site attributes into the record", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("x").info("msg", { "user.id": 42 });
    expect(sink.records()[0]?.attributes["user.id"]).toBe(42);
  });

  it("child(attrs) binds attributes onto subsequent emits", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    const base = Logger.get("x");
    const scoped = base.child({ "session.id": "sess-1" });
    scoped.info("in scope");
    expect(sink.records()[0]?.attributes["session.id"]).toBe("sess-1");
  });

  it("call-site attributes override child-bound attributes", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    const log = Logger.get("x").child({ k: "parent" });
    log.info("msg", { k: "call-site" });
    expect(sink.records()[0]?.attributes.k).toBe("call-site");
  });

  it("redacts secret-suffix keys", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("x").info("msg", { api_key: "sk-secret", "user.id": 42 });
    const attrs = sink.records()[0]?.attributes;
    expect(attrs?.api_key).toBe("***");
    expect(attrs?.["user.id"]).toBe(42);
  });
});

describe("Hierarchy and inheritance", () => {
  it("a deep child inherits root sinks", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [sink] });
    Logger.get("dagstack.rag.retriever").info("from deep logger");
    expect(sink.records()).toHaveLength(1);
  });

  it("a deep child inherits intermediate min_severity", () => {
    const sink = new InMemorySink();
    configure({
      rootLevel: "TRACE",
      sinks: [sink],
      perLoggerLevels: { "dagstack.rag": "WARN" },
    });
    const child = Logger.get("dagstack.rag.retriever");
    child.debug("below");
    child.error("above");
    const records = sink.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toBe("above");
  });
});

describe("Scoped sink overrides", () => {
  it("withSinks creates a detached child without leaking to the base sink", () => {
    const baseSink = new InMemorySink();
    const scopedSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [baseSink] });
    const base = Logger.get("x");
    const scoped = base.withSinks([scopedSink]);
    scoped.info("only scoped");
    expect(scopedSink.records()).toHaveLength(1);
    expect(baseSink.records()).toHaveLength(0);
  });

  it("appendSinks emits to both base and extra sinks", () => {
    const baseSink = new InMemorySink();
    const extraSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [baseSink] });
    const scoped = Logger.get("x").appendSinks([extraSink]);
    scoped.info("both");
    expect(baseSink.records()).toHaveLength(1);
    expect(extraSink.records()).toHaveLength(1);
  });

  it("withoutSinks discards emits", () => {
    const baseSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [baseSink] });
    const scoped = Logger.get("x").withoutSinks();
    scoped.info("discarded");
    expect(baseSink.records()).toHaveLength(0);
  });

  it("scopeSinks(callback) swaps sinks for the callback's lifetime", async () => {
    const baseSink = new InMemorySink();
    const scopedSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [baseSink] });
    const log = Logger.get("x");
    log.info("before");
    await log.scopeSinks([scopedSink], (scoped) => {
      scoped.info("during");
    });
    log.info("after");
    expect(baseSink.records().map((r) => r.body)).toEqual(["before", "after"]);
    expect(scopedSink.records().map((r) => r.body)).toEqual(["during"]);
  });

  it("scopeSinks restores sinks even when the callback throws", async () => {
    const baseSink = new InMemorySink();
    const scopedSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [baseSink] });
    const log = Logger.get("x");
    await expect(
      log.scopeSinks([scopedSink], () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    log.info("after-throw");
    expect(baseSink.records().map((r) => r.body)).toEqual(["after-throw"]);
  });

  it("scopeSinks works with an async callback", async () => {
    const scopedSink = new InMemorySink();
    configure({ rootLevel: "TRACE", sinks: [new InMemorySink()] });
    const log = Logger.get("x");
    const result = await log.scopeSinks([scopedSink], async (scoped) => {
      await Promise.resolve();
      scoped.info("inside async");
      return 42;
    });
    expect(result).toBe(42);
    expect(scopedSink.records().map((r) => r.body)).toEqual(["inside async"]);
  });
});

describe("Subscription (Phase 1 inactive)", () => {
  it("onReconfigure returns an inactive subscription", () => {
    configure({ rootLevel: "INFO", sinks: [new InMemorySink()] });
    const sub = Logger.get("x").onReconfigure(() => {
      // never called in Phase 1
    });
    expect(sub.active).toBe(false);
    sub.unsubscribe(); // no-op, no throw
    sub.unsubscribe(); // idempotent
  });
});

describe("Lifecycle", () => {
  it("flush returns ok=true with no failing sinks", async () => {
    configure({ rootLevel: "INFO", sinks: [new InMemorySink()] });
    const result = await Logger.get("x").flush();
    expect(result.ok).toBe(true);
  });

  it("close swallows individual sink failures", async () => {
    class FailingSink implements Sink {
      readonly id = "fail";
      emit(_record: LogRecord): void {}
      async flush(): Promise<FlushResult> {
        throw new Error("boom");
      }
      async close(): Promise<void> {
        throw new Error("close boom");
      }
      supportsSeverity(_n: number): boolean {
        return true;
      }
    }
    const goodSink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [new FailingSink(), goodSink] });
    await Logger.get("x").close(); // does not throw
  });

  it("flush reports failed sinks as partial", async () => {
    class FailingSink implements Sink {
      readonly id = "fail";
      emit(_record: LogRecord): void {}
      async flush(): Promise<FlushResult> {
        throw new Error("boom");
      }
      async close(): Promise<void> {}
      supportsSeverity(_n: number): boolean {
        return true;
      }
    }
    const goodSink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [new FailingSink(), goodSink] });
    const result = await Logger.get("x").flush();
    expect(result.ok).toBe(false);
    expect(result.failedSinks?.[0]?.sinkId).toBe("fail");
  });

  it("isolates sink emit failures", () => {
    class FailingSink implements Sink {
      readonly id = "fail-emit";
      emit(_record: LogRecord): void {
        throw new Error("emit boom");
      }
      async flush(): Promise<FlushResult> {
        return { ok: true };
      }
      async close(): Promise<void> {}
      supportsSeverity(_n: number): boolean {
        return true;
      }
    }
    const goodSink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [new FailingSink(), goodSink] });
    Logger.get("x").info("msg");
    expect(goodSink.records()).toHaveLength(1);
  });
});

describe("Integration with ConsoleSink", () => {
  it("records traverse both console and memory sinks", () => {
    class BufferedStream implements ConsoleStream {
      buffer = "";
      isTTY = false;
      write(chunk: string): boolean {
        this.buffer += chunk;
        return true;
      }
    }
    const stream = new BufferedStream();
    const memSink = new InMemorySink();
    configure({
      rootLevel: "INFO",
      sinks: [new ConsoleSink({ mode: "json", stream }), memSink],
    });
    Logger.get("x").info("hello");
    expect(stream.buffer).toContain("hello");
    expect(memSink.records()[0]?.body).toBe("hello");
  });
});
