// LogRecord + Resource + InstrumentationScope interfaces.
//
// Per spec ADR-0001 §1: LogRecord is structurally identical to the OTel Log
// Data Model v1.24. Field names in the internal model match the OTel
// normative spec (proto field names): `time_unix_nano`, `trace_id` as bytes
// (Uint8Array in TS), etc. Wire serialisation (OTLP / OTel JSON / dagstack
// JSON-lines) lives in separate modules — see `wire.ts`.
//
// The `Value` type alias describes the shapes allowed inside body /
// attributes:
//   Scalars: string, number, boolean, null.
//   Map: Record<string, Value>.
//   Sequence: Value[].
// A recursive structure matching config-spec §1 `Value`.

/**
 * Recursive value type — the same shape backs `body`, `attributes`, and
 * config-spec's `ConfigTree`. Note that the `Value` type intentionally
 * excludes `undefined`: producers should pass `null` (or omit the key)
 * instead.
 *
 * The interface form (`ValueMap` / `ValueArray`) keeps typescript-eslint's
 * type inference healthy across deeply nested values.
 */
export type ValueScalar = string | number | boolean | null;
export interface ValueMap {
  readonly [key: string]: Value;
}
export type ValueArray = readonly Value[];
export type Value = ValueScalar | ValueMap | ValueArray;

/**
 * Per spec §4.1: the logger's self-descriptor — name + optional version +
 * optional attributes. `name` matches the logger name
 * (`dagstack.rag.retriever`); `version` is the semantic version of the
 * package / plugin.
 */
export interface InstrumentationScope {
  readonly name: string;
  readonly version?: string;
  readonly attributes?: Readonly<Record<string, Value>>;
}

/**
 * Per spec §4.2: process- / service- / host-level attributes (OTel Resource).
 * Shared across all logger instances of a single process. Typical keys:
 * `service.name`, `service.version`, `service.instance.id`,
 * `deployment.environment`, `host.name`, `process.pid`,
 * `telemetry.sdk.{name,version,language}`.
 */
export interface Resource {
  readonly attributes: Readonly<Record<string, Value>>;
}

/**
 * OTel Log Data Model v1.24-compatible LogRecord.
 *
 * Per spec §1: internal field names = OTel normative (`time_unix_nano`,
 * `observed_time_unix_nano`, `severity_number`, `severity_text`, `body`,
 * `attributes`, `resource`, `instrumentation_scope`, `trace_id` as
 * `Uint8Array` of length 16, `span_id` as `Uint8Array` of length 8,
 * `trace_flags`).
 *
 * Wire serialisation lives in separate functions (see `wire.ts`):
 * - dagstack JSON-lines: snake_case keys, hex ids, raw integer timestamps.
 * - OTel JSON / OTLP protobuf: Phase 2+.
 *
 * `observed_time_unix_nano` — the sink sets it on ingestion when undefined
 * (per spec §1 ownership).
 */
export interface LogRecord {
  /** Emit time, nanoseconds since Unix epoch (bigint to preserve precision). */
  readonly time_unix_nano: bigint;
  /** OTel severity 1-24. */
  readonly severity_number: number;
  /** One of 6 canonical strings (see `CANONICAL_SEVERITY_TEXTS`). */
  readonly severity_text: string;
  /** Primary message — string or structured (map/array/scalar). */
  readonly body: Value;
  /** Per-record key-value context. */
  readonly attributes: Readonly<Record<string, Value>>;
  /** Logger self-descriptor (§4.1). */
  readonly instrumentation_scope?: InstrumentationScope;
  /** Process / service / host attributes (§4.2). */
  readonly resource?: Resource;
  /** W3C Trace Context — 16 random bytes, if an active span is present. */
  readonly trace_id?: Uint8Array;
  /** W3C Trace Context — 8 random bytes, if an active span is present. */
  readonly span_id?: Uint8Array;
  /** W3C flags (sampled bit, etc.). Default 0 = not-sampled. */
  readonly trace_flags: number;
  /** Ingest time at sink. Producer leaves undefined; sink fills it in. */
  readonly observed_time_unix_nano?: bigint;
}
