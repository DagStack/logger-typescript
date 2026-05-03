// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/scoped-overrides.mdx`.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { FileSink } from "../../src/sinks/file.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "logger-ts-docs-scoped-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Three operations" — withSinks / appendSinks / withoutSinks ───────

describe("concepts/scoped-overrides.mdx — Three operations (TypeScript)", () => {
  it("snippet: withSinks / appendSinks / withoutSinks", () => {
    // The doc snippet uses /var/log/audit.jsonl — replaced with a sandbox
    // path. The shape of the calls is preserved.
    const baseSink = new InMemorySink();
    const auditPath = join(workDir, "audit.jsonl");
    configure({ rootLevel: "INFO", sinks: [baseSink] });

    // --- snippet start (scoped-overrides / three operations) -----------
    // import { Logger, InMemorySink, FileSink } from "@dagstack/logger";

    const logger = Logger.get("order_service");

    // Replace sinks — only InMemorySink receives emits.
    const testLogger = logger.withSinks([new InMemorySink({ capacity: 100 })]);
    testLogger.info("captured here");

    // Append a sink — both the parent's and the extra receive emits.
    const auditLogger = logger.appendSinks([new FileSink(auditPath)]);
    auditLogger.info("audit event");

    // Discard — emits go to /dev/null.
    const silentLogger = logger.withoutSinks();
    silentLogger.info("never seen");
    // --- snippet end ---------------------------------------------------

    const baseBodies = baseSink.records().map((r) => r.body);
    // withSinks redirects entirely; appendSinks adds the audit file but
    // ALSO writes to the parent (baseSink). withoutSinks drops the emit.
    expect(baseBodies).toEqual(["audit event"]);
    expect(baseBodies).not.toContain("captured here");
    expect(baseBodies).not.toContain("never seen");
  });
});

// ── "Lexically bounded scope" — scopeSinks(callback) ──────────────────

describe("concepts/scoped-overrides.mdx — Lexically bounded scope (TypeScript)", () => {
  it("snippet: scopeSinks captures inside, restores outside", async () => {
    configure({ rootLevel: "INFO", sinks: [new InMemorySink()] });
    async function runBusinessLogic(): Promise<void> {
      Logger.get("order_service").info("business event");
    }

    // --- snippet start (scoped-overrides / scopeSinks) ----------------
    // import { Logger, InMemorySink } from "@dagstack/logger";

    const logger = Logger.get("order_service");
    const sink = new InMemorySink({ capacity: 100 });

    await logger.scopeSinks([sink], async (_scoped) => {
      await runBusinessLogic();
      // emits via Logger.get("order_service") in this callback land in sink;
      // other modules calling Logger.get("order_service") inside also emit
      // into sink for the duration of the callback.
    });

    // Outside the callback, emits go to the global sinks again.
    if (sink.records().length === 0) throw new Error("nothing captured");
    // --- snippet end ---------------------------------------------------

    expect(sink.records().length).toBeGreaterThan(0);
    expect(sink.records()[0]?.body).toBe("business event");

    // Confirm restore: a post-scope emit does not land in the captured sink.
    const captured = sink.records().length;
    Logger.get("order_service").info("after scope");
    expect(sink.records().length).toBe(captured);
  });
});
