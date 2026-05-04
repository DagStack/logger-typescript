// ConsoleSink — stdout/stderr writer with JSON or pretty dev-mode.
//
// Per spec §7.2: ConsoleSink — Phase 1 MVP, auto-detects TTY for the default
// mode. Non-TTY (piped into jq / fluent / container stdout capture) → JSON
// wire format. TTY (interactive terminal) → pretty coloured output for
// developer UX.

import type { Writable } from "node:stream";

import { canonicalJsonStringify } from "../canonical-json.js";
import type { LogRecord, Value } from "../records.js";
import {
  SEVERITY_TEXT_DEBUG,
  SEVERITY_TEXT_ERROR,
  SEVERITY_TEXT_FATAL,
  SEVERITY_TEXT_INFO,
  SEVERITY_TEXT_TRACE,
  SEVERITY_TEXT_WARN,
} from "../severity.js";
import { toDagstackJsonl } from "../wire.js";
import type { FlushResult, Sink } from "./base.js";

export type ConsoleMode = "auto" | "json" | "pretty";

/** Streams supported as ConsoleSink targets. The Node `process.stdout` /
 *  `process.stderr` instances satisfy this signature. */
export interface ConsoleStream {
  write(chunk: string): boolean;
  isTTY?: boolean;
}

export interface ConsoleSinkOptions {
  /** Mode: "auto" (TTY → pretty, non-TTY → json), "json" forces JSON, "pretty" forces pretty. */
  readonly mode?: ConsoleMode;
  /** Destination stream; defaults to `process.stderr`. */
  readonly stream?: ConsoleStream;
  /** Early-drop threshold (records with severity_number < minSeverity are skipped). */
  readonly minSeverity?: number;
}

// ANSI escape codes. Used only in pretty mode when the stream is a TTY.
const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_SEVERITY_COLOUR: Readonly<Record<string, string>> = {
  [SEVERITY_TEXT_TRACE]: "\x1b[2;37m", // dim grey
  [SEVERITY_TEXT_DEBUG]: "\x1b[36m", // cyan
  [SEVERITY_TEXT_INFO]: "\x1b[32m", // green
  [SEVERITY_TEXT_WARN]: "\x1b[33m", // yellow
  [SEVERITY_TEXT_ERROR]: "\x1b[31m", // red
  [SEVERITY_TEXT_FATAL]: "\x1b[1;31m", // bold red
};

/**
 * Write LogRecords to stdout / stderr as JSON-lines or pretty coloured text.
 */
export class ConsoleSink implements Sink {
  public readonly id: string;
  private readonly mode: ConsoleMode;
  private readonly stream: ConsoleStream;
  private readonly minSeverity: number;
  private closed = false;

  constructor(options: ConsoleSinkOptions = {}) {
    this.mode = options.mode ?? "auto";
    // Default to stderr — matches the Python binding and the standard
    // observability convention (logs to stderr, business output to stdout).
    this.stream = options.stream ?? process.stderr;
    this.minSeverity = options.minSeverity ?? 1;
    this.id = `console:${this.mode}`;
  }

  emit(record: LogRecord): void {
    if (this.closed) return;
    if (!this.supportsSeverity(record.severity_number)) return;
    const line = this.format(record);
    this.stream.write(line + "\n");
  }

  async flush(_timeoutMs?: number): Promise<FlushResult> {
    return Promise.resolve({ ok: true });
  }

  async close(): Promise<void> {
    // Do NOT actually close stdout / stderr — they are shared with the
    // process. Only mark the sink as closed so subsequent emits are
    // discarded.
    this.closed = true;
    return Promise.resolve();
  }

  supportsSeverity(severityNumber: number): boolean {
    return severityNumber >= this.minSeverity;
  }

  // ─── Formatting ───────────────────────────────────────────────────────────

  private format(record: LogRecord): string {
    if (this.effectiveMode() === "json") {
      return toDagstackJsonl(record);
    }
    return this.formatPretty(record);
  }

  private effectiveMode(): ConsoleMode {
    if (this.mode !== "auto") return this.mode;
    return this.stream.isTTY === true ? "pretty" : "json";
  }

  private formatPretty(record: LogRecord): string {
    const colour = ANSI_SEVERITY_COLOUR[record.severity_text] ?? "";
    const reset = colour !== "" ? ANSI_RESET : "";
    const timestamp = formatTimestamp(record.time_unix_nano);
    const name = record.instrumentation_scope?.name ?? "root";
    const parts = [
      `${ANSI_DIM}${timestamp}${ANSI_RESET}`,
      `[${colour}${record.severity_text}${reset}]`,
      `${ANSI_DIM}${name}${ANSI_RESET}:`,
      formatBody(record.body),
    ];
    if (Object.keys(record.attributes).length > 0) {
      const sortedAttrs = Object.entries(record.attributes).sort(([a], [b]) => a.localeCompare(b));
      const attrStr = sortedAttrs.map(([k, v]) => `${k}=${formatScalar(v)}`).join(" ");
      parts.push(`${ANSI_DIM}|${ANSI_RESET} ${attrStr}`);
    }
    return parts.join(" ");
  }
}

/**
 * Convenience adapter — wrap a Node.js `Writable` (e.g. fs.createWriteStream)
 * so it satisfies `ConsoleStream`. Used in tests against in-memory buffers.
 */
export function asConsoleStream(stream: Writable & { isTTY?: boolean }): ConsoleStream {
  return {
    write: (chunk: string): boolean => stream.write(chunk),
    isTTY: stream.isTTY ?? false,
  };
}

function formatTimestamp(nano: bigint): string {
  // unix_nano → ISO-8601 UTC with microsecond precision.
  const NS_PER_SEC = 1_000_000_000n;
  const seconds = Number(nano / NS_PER_SEC);
  const remainderNs = Number(nano % NS_PER_SEC);
  const date = new Date(seconds * 1000);
  const isoSeconds = date.toISOString().replace(/\.\d+Z$/, "");
  const micros = Math.floor(remainderNs / 1000);
  return `${isoSeconds}.${micros.toString().padStart(6, "0")}Z`;
}

function formatBody(body: Value): string {
  if (typeof body === "string") return body;
  return canonicalJsonStringify(body);
}

function formatScalar(v: Value): string {
  if (typeof v === "string") {
    if (v.includes(" ") || v.includes("=")) return JSON.stringify(v);
    return v;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "null";
  if (typeof v === "number") return v.toString();
  // Object / array — compact JSON.
  return canonicalJsonStringify(v);
}
