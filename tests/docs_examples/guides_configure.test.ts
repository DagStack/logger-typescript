// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/guides/configure.mdx`.
//
// The page documents an application-side `buildSinks()` factory plus the full
// `configure({...})` call shape. The tests below run the factory verbatim and
// assert the resulting sinks behave per the surrounding prose.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { ConsoleSink, type ConsoleStream } from "../../src/sinks/console.js";
import { FileSink } from "../../src/sinks/file.js";
import type { Sink } from "../../src/sinks/index.js";
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
  workDir = await mkdtemp(join(tmpdir(), "logger-ts-docs-configure-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Step 2. Build sinks from the config" — buildSinks factory ────────

// The snippet declares `buildSinks` as a top-level `export function`. We
// hoist it here so the test can import it from the same module without
// duplicating the body.

interface SinkSpec {
  type: string;
  mode?: "auto" | "json" | "pretty";
  path?: string;
  max_bytes?: number;
  keep?: number;
  min_severity?: number | string;
}

const SEVERITY: Record<string, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
};

function resolveSeverity(value: number | string | undefined): number {
  if (value === undefined) return 9;
  if (typeof value === "number") return value;
  return SEVERITY[value.toUpperCase()] ?? 9;
}

// --- snippet start (configure / buildSinks) ---------------------------
// (Imports `ConsoleSink`, `FileSink`, `Sink`, the local `SinkSpec` /
// `SEVERITY` / `resolveSeverity` are declared above per the page's
// surrounding prose.)
export function buildSinks(specs: SinkSpec[]): Sink[] {
  return specs.map((spec) => {
    if (spec.type === "console") {
      return new ConsoleSink({
        mode: spec.mode ?? "auto",
        minSeverity: resolveSeverity(spec.min_severity),
      });
    }
    if (spec.type === "file") {
      if (!spec.path) throw new Error("file sink requires path");
      return new FileSink(spec.path, {
        maxBytes: spec.max_bytes ?? 0,
        keep: spec.keep ?? 0,
        minSeverity: resolveSeverity(spec.min_severity),
      });
    }
    throw new Error(`unsupported sink type: ${spec.type}`);
  });
}
// --- snippet end ------------------------------------------------------

describe("guides/configure.mdx — buildSinks factory (TypeScript)", () => {
  it("builds a ConsoleSink from {type:console, mode, min_severity}", () => {
    const [sink] = buildSinks([{ type: "console", mode: "json", min_severity: "WARN" }]);
    expect(sink?.id).toBe("console:json");
    expect(sink?.supportsSeverity(13)).toBe(true);
    expect(sink?.supportsSeverity(9)).toBe(false);
  });

  it("builds a FileSink from {type:file, path, max_bytes, keep, min_severity}", async () => {
    const filePath = join(workDir, "app.jsonl");
    const [sink] = buildSinks([
      {
        type: "file",
        path: filePath,
        max_bytes: 1_000_000,
        keep: 3,
        min_severity: 9,
      },
    ]);
    expect(sink?.id).toContain("app.jsonl");
    expect(sink?.supportsSeverity(9)).toBe(true);
    expect(sink?.supportsSeverity(8)).toBe(false);
    await sink?.close();
  });

  it("rejects an unknown sink type", () => {
    expect(() => buildSinks([{ type: "bogus" }])).toThrow(/unsupported sink type/);
  });

  it("rejects a file sink without a path", () => {
    expect(() => buildSinks([{ type: "file" }])).toThrow(/path/);
  });
});

// ── "Step 4. Per-logger overrides" — configure with perLoggerLevels ───

describe("guides/configure.mdx — perLoggerLevels (TypeScript)", () => {
  it("snippet: per-logger level map filters noisy children", () => {
    const captureSink = new InMemorySink();
    const stream = new BufferedStream();

    // --- snippet start (configure / per-logger overrides) -------------
    configure({
      rootLevel: "INFO",
      sinks: [new ConsoleSink({ mode: "auto", stream }), captureSink],
      perLoggerLevels: {
        axios: "WARN",
        undici: "WARN",
        "order_service.checkout": "DEBUG",
      },
      resourceAttributes: { "service.name": "order-service" },
    });
    // --- snippet end ---------------------------------------------------

    Logger.get("axios").info("noisy info — should be dropped");
    Logger.get("axios").warn("noisy warn — should pass");
    Logger.get("order_service.checkout").debug("debug pass");
    Logger.get("order_service.api").debug("inherits root INFO — dropped");

    const bodies = captureSink.records().map((r) => r.body);
    expect(bodies).toContain("noisy warn — should pass");
    expect(bodies).toContain("debug pass");
    expect(bodies).not.toContain("noisy info — should be dropped");
    expect(bodies).not.toContain("inherits root INFO — dropped");
  });
});

// ── "Step 5. Graceful shutdown" — flush + close on the root logger ───

describe("guides/configure.mdx — Graceful shutdown (TypeScript)", () => {
  it("snippet: shutdownLogger flushes the root and closes sinks", async () => {
    configure({ rootLevel: "INFO", sinks: [new InMemorySink()] });

    // --- snippet start (configure / graceful shutdown) ----------------
    // import { Logger } from "@dagstack/logger";

    async function shutdownLogger(): Promise<void> {
      const root = Logger.get("");
      await root.flush(5000);
      await root.close();
    }
    // --- snippet end ---------------------------------------------------
    // The snippet also wires `process.on("SIGTERM" / "SIGINT", ...)` —
    // those would terminate the test runner if installed, so we only
    // exercise the flush / close half here.

    await expect(shutdownLogger()).resolves.toBeUndefined();
  });
});
