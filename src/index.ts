// @dagstack/logger — TypeScript binding for dagstack/logger-spec.
//
// Phase 1 public API. See README.md for usage.

import packageJson from "../package.json" with { type: "json" };

/**
 * Package version, sourced from package.json at build time so the export
 * cannot drift from the published version.
 */
export const VERSION: string = packageJson.version;

// Logger API (ADR-0001 §3)
export { INTERNAL_LOGGER_NAME, Logger } from "./logger.js";
export type { ExceptionOptions } from "./logger.js";

// Records / wire model (ADR-0001 §1)
export type { InstrumentationScope, LogRecord, Resource, Value } from "./records.js";
export { toDagstackJsonl, toDagstackJsonlObject } from "./wire.js";

// Severity (ADR-0001 §2)
export {
  CANONICAL_SEVERITY_TEXTS,
  isCanonicalSeverityText,
  isValidSeverityNumber,
  SEVERITY_TEXT_DEBUG,
  SEVERITY_TEXT_ERROR,
  SEVERITY_TEXT_FATAL,
  SEVERITY_TEXT_INFO,
  SEVERITY_TEXT_TRACE,
  SEVERITY_TEXT_WARN,
  Severity,
  severityTextFor,
} from "./severity.js";
export type { SeverityText, SeverityValue } from "./severity.js";

// Trace ID helpers (ADR-0001 §1)
export {
  hexToSpanId,
  hexToTraceId,
  otelSpanIdToBytes,
  otelTraceIdToBytes,
  spanIdToHex,
  traceIdToHex,
} from "./trace-ids.js";

// Canonical JSON (ADR-0001 §9.1.1, references config-spec)
export { canonicalJsonStringify, canonicalJsonStringifyBytes } from "./canonical-json.js";
export type { JsonValue } from "./canonical-json.js";

// Redaction (ADR-0001 §10)
export {
  buildEffectiveSuffixes,
  DEFAULT_SECRET_SUFFIXES,
  isSecretField,
  MASKED_PLACEHOLDER,
  maskValue,
  redactAttributes,
  validateRedactionConfig,
} from "./redaction.js";
export type { RedactionConfig } from "./redaction.js";

// Context propagation (ADR-0001 §3.4)
export { DEFAULT_BAGGAGE_KEYS, getActiveTraceContext, getBaggageAttributes } from "./context.js";
export type { ActiveTraceContext } from "./context.js";

// Sinks (ADR-0001 §7)
export type {
  ConsoleMode,
  ConsoleSinkOptions,
  ConsoleStream,
  FileSinkOptions,
  FlushResult,
  InMemorySinkOptions,
  Sink,
} from "./sinks/index.js";
export { asConsoleStream, ConsoleSink, FileSink, InMemorySink } from "./sinks/index.js";

// Subscription (ADR-0001 §7.2, §9.3)
export { Subscription } from "./subscription.js";
export type { SubscriptionInit } from "./subscription.js";

// Configuration bootstrap (ADR-0001 §9.2)
export { configure } from "./configuration.js";
export type { ConfigureOptions } from "./configuration.js";
