// Wire-format serialisation for LogRecord.
//
// Per spec ADR-0001 §1: three wire formats for different sinks.
// - **dagstack JSON-lines** (default FileSink/ConsoleSink mode) — snake_case
//   field names, trace_id/span_id as lowercase hex strings, timestamps as
//   integer nanoseconds (raw JSON number; consumers must handle bigint when
//   reading the wire format). Implemented here.
// - **OTel JSON** (`OTLPSink` HTTP+JSON protocol) — camelCase keys,
//   timestamps stringified. Phase 2+.
// - **OTLP protobuf** — native OTel wire. Phase 2+.
//
// Empty / undefined fields are **omitted** from the output — cleaner
// diagnostics.

import type { JsonValue } from "./canonical-json.js";
import { canonicalJsonStringify } from "./canonical-json.js";
import type { InstrumentationScope, LogRecord, Resource, Value } from "./records.js";
import { spanIdToHex, traceIdToHex } from "./trace-ids.js";

/**
 * Convert a LogRecord into a plain object ready for canonical JSON
 * stringification (snake_case keys per spec).
 *
 * Empty / undefined values are omitted. trace_id / span_id are encoded as
 * lowercase hex. Timestamps are kept as bigint (JsonValue accepts bigint;
 * canonicalJsonStringify writes it as a raw JSON integer).
 */
export function toDagstackJsonlObject(record: LogRecord): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {
    time_unix_nano: record.time_unix_nano,
    severity_number: record.severity_number,
    severity_text: record.severity_text,
    body: valueToJson(record.body),
  };

  if (record.observed_time_unix_nano !== undefined) {
    result.observed_time_unix_nano = record.observed_time_unix_nano;
  }

  if (Object.keys(record.attributes).length > 0) {
    result.attributes = valueToJson(record.attributes);
  }

  if (record.instrumentation_scope !== undefined) {
    result.instrumentation_scope = serialiseScope(record.instrumentation_scope);
  }

  if (record.resource !== undefined && Object.keys(record.resource.attributes).length > 0) {
    result.resource = serialiseResource(record.resource);
  }

  const traceIdHex = traceIdToHex(record.trace_id);
  if (traceIdHex !== undefined) {
    result.trace_id = traceIdHex;
  }
  const spanIdHex = spanIdToHex(record.span_id);
  if (spanIdHex !== undefined) {
    result.span_id = spanIdHex;
  }
  if (record.trace_flags !== 0) {
    result.trace_flags = record.trace_flags;
  }

  return result;
}

/**
 * Serialise a LogRecord into a single canonical JSON line (no trailing
 * newline). Each sink prepends / appends the LF separator itself.
 */
export function toDagstackJsonl(record: LogRecord): string {
  return canonicalJsonStringify(toDagstackJsonlObject(record));
}

function serialiseScope(scope: InstrumentationScope): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = { name: scope.name };
  if (scope.version !== undefined) {
    out.version = scope.version;
  }
  if (scope.attributes !== undefined && Object.keys(scope.attributes).length > 0) {
    out.attributes = valueToJson(scope.attributes);
  }
  return out;
}

function serialiseResource(resource: Resource): Record<string, JsonValue> {
  return { attributes: valueToJson(resource.attributes) };
}

/**
 * `Value` is structurally a subset of `JsonValue` (both exclude `undefined`
 * and both allow string/number/boolean/null/array/object); `JsonValue`
 * additionally permits `bigint`. The cast widens safely. The recursive
 * shapes prevent TypeScript from inferring this automatically, which is why
 * the helper exists as a single localised assertion site.
 */
function valueToJson(v: Value): JsonValue {
  return v;
}
