import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogRecord } from "../../src/records.js";
import { FileSink } from "../../src/sinks/file.js";

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

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-ts-file-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileSink basic", () => {
  it("writes JSON-lines to a file", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target);
    sink.emit(makeRecord("hello"));
    await sink.close();
    const content = fs.readFileSync(target, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { body: string };
    expect(parsed.body).toBe("hello");
  });

  it("emits multiple records as multiple lines", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target);
    for (let i = 0; i < 3; i++) sink.emit(makeRecord(`msg-${i.toString()}`));
    await sink.close();
    const lines = fs.readFileSync(target, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect((JSON.parse(lines[0]!) as { body: string }).body).toBe("msg-0");
    expect((JSON.parse(lines[2]!) as { body: string }).body).toBe("msg-2");
  });

  it("id includes the resolved path", () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target);
    expect(sink.id).toBe(`file:${path.resolve(target)}`);
    void sink.close();
  });
});

describe("FileSink rotation", () => {
  it("rotates when the file exceeds maxBytes", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target, { maxBytes: 200, keep: 2 });
    for (let i = 0; i < 20; i++) sink.emit(makeRecord(`record-${i.toString().padStart(3, "0")}`));
    await sink.close();
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith("log.jsonl."));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups.length).toBeLessThanOrEqual(2);
  });

  it("removes the file when maxBytes is exceeded but keep=0", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target, { maxBytes: 50, keep: 0 });
    for (let i = 0; i < 20; i++) sink.emit(makeRecord(`record-${i.toString().padStart(3, "0")}`));
    await sink.close();
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith("log.jsonl."));
    // No backups kept because keep=0.
    expect(backups).toHaveLength(0);
  });
});

describe("FileSink filter", () => {
  it("drops records below minSeverity", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target, { minSeverity: 13 });
    sink.emit(makeRecord("debug", 5));
    sink.emit(makeRecord("info", 9));
    sink.emit(makeRecord("warn", 13));
    await sink.close();
    const lines = fs
      .readFileSync(target, "utf8")
      .trim()
      .split("\n")
      .filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0]!) as { body: string }).body).toBe("warn");
  });
});

describe("FileSink lifecycle", () => {
  it("close() prevents further writes", async () => {
    const target = path.join(tmpDir, "log.jsonl");
    const sink = new FileSink(target);
    sink.emit(makeRecord("before"));
    await sink.close();
    sink.emit(makeRecord("after"));
    const content = fs.readFileSync(target, "utf8").trim();
    expect(content).toContain("before");
    expect(content).not.toContain("after");
  });

  it("close() is idempotent", async () => {
    const sink = new FileSink(path.join(tmpDir, "log.jsonl"));
    await sink.close();
    await sink.close();
  });

  it("flush() does not throw and resolves to ok=true", async () => {
    const sink = new FileSink(path.join(tmpDir, "log.jsonl"));
    sink.emit(makeRecord("x"));
    await expect(sink.flush()).resolves.toEqual({ ok: true });
    await sink.close();
  });
});
