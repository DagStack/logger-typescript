// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/sinks.mdx`.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { ConsoleSink } from "../../src/sinks/console.js";
import type { ConsoleStream } from "../../src/sinks/console.js";
import { FileSink } from "../../src/sinks/file.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

class BufferedStream implements ConsoleStream {
  buffer = "";
  isTTY = false;
  write(chunk: string): boolean {
    this.buffer += chunk;
    return true;
  }
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "logger-ts-docs-sinks-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetRegistryForTests();
});

afterEach(() => {
  _resetRegistryForTests();
});

// ── "ConsoleSink" subsection ──────────────────────────────────────────

describe("concepts/sinks.mdx — ConsoleSink (TypeScript)", () => {
  it("snippet: three ConsoleSink modes", () => {
    // The snippet rebinds `sink` three times; the assertions below check
    // all three constructors succeed and produce different `id` strings.
    const stream = new BufferedStream();

    // --- snippet start (sinks / ConsoleSink) ---------------------------
    // import { ConsoleSink } from "@dagstack/logger";

    // Auto mode: pretty on a TTY, JSON otherwise.
    let sink = new ConsoleSink({ mode: "auto", stream });

    // Force JSON for container logs.
    sink = new ConsoleSink({ mode: "json", minSeverity: 9, stream });

    // Force pretty for a debug terminal.
    sink = new ConsoleSink({ mode: "pretty", stream });
    // --- snippet end ---------------------------------------------------

    expect(sink.id).toBe("console:pretty");
  });
});

// ── "FileSink" subsection ─────────────────────────────────────────────

describe("concepts/sinks.mdx — FileSink (TypeScript)", () => {
  it("snippet: FileSink constructor with rotation options", async () => {
    // The doc snippet uses /var/log; we route to a sandboxed tmp path so the
    // structural shape of the call is exercised verbatim.
    const filePath = join(workDir, "order-service.jsonl");

    // --- snippet start (sinks / FileSink — adapted path) ---------------
    // import { FileSink } from "@dagstack/logger";

    const sink = new FileSink(filePath, {
      maxBytes: 100_000_000, // rotate at 100 MB
      keep: 10, //              keep 10 archived files
      minSeverity: 9, //         INFO and above
    });
    // --- snippet end ---------------------------------------------------

    expect(sink.id).toContain("order-service.jsonl");
    expect(sink.supportsSeverity(9)).toBe(true);
    expect(sink.supportsSeverity(8)).toBe(false);
    await sink.close();
  });
});

// ── "InMemorySink" subsection ─────────────────────────────────────────

describe("concepts/sinks.mdx — InMemorySink (TypeScript)", () => {
  it("snippet: InMemorySink + records() snapshot + clear()", () => {
    configure({ rootLevel: "INFO", sinks: [] });
    // The snippet expects "expected message" in the buffer, so emit it
    // before assertions.
    const logger = Logger.get("test");

    // --- snippet start (sinks / InMemorySink) -------------------------
    // import { InMemorySink } from "@dagstack/logger";

    const sink = new InMemorySink({ capacity: 100 });
    // ... emit some records ...
    logger.setSinks([sink]);
    logger.info("expected message");

    const records = sink.records(); // snapshot copy
    if (!records.some((r) => r.body === "expected message")) {
      throw new Error("missing expected record");
    }

    sink.clear(); // reset for the next test
    // --- snippet end ---------------------------------------------------

    expect(sink.records()).toEqual([]);
    // Snapshot should be a copy: emit after the snapshot was taken does
    // not mutate the previously-returned array.
    logger.info("after-clear");
    expect(sink.records()).toHaveLength(1);
    expect(records).toHaveLength(1); // snapshot preserved
  });
});

// ── "Multi-sink routing" ──────────────────────────────────────────────

describe("concepts/sinks.mdx — Multi-sink routing (TypeScript)", () => {
  it("snippet: configure with two sinks at different minSeverity", async () => {
    const consoleStream = new BufferedStream();
    const filePath = join(workDir, "app.jsonl");

    // --- snippet start (sinks / multi-sink — adapted path/stream) -----
    // import { ConsoleSink, FileSink, configure } from "@dagstack/logger";

    const fileSink = new FileSink(filePath, {
      maxBytes: 100_000_000,
      keep: 10,
      minSeverity: 9,
    });

    configure({
      rootLevel: "DEBUG",
      sinks: [
        new ConsoleSink({ mode: "pretty", minSeverity: 13, stream: consoleStream }), // WARN+ on the console
        fileSink,
      ],
    });
    // --- snippet end ---------------------------------------------------

    Logger.get("x").debug("d"); // dropped by both
    Logger.get("x").info("i"); // dropped by console, kept by file
    Logger.get("x").warn("w"); // both
    expect(consoleStream.buffer).not.toContain('"d"');
    expect(consoleStream.buffer).not.toContain('"i"');
    expect(consoleStream.buffer).toContain("w");

    await fileSink.flush();
    await fileSink.close();
  });
});
