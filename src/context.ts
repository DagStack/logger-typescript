// Context propagation helpers — OTel Context API integration.
//
// Per spec §3.4: loggers MUST auto-inject into LogRecord:
// - trace_id, span_id, trace_flags — from the active OTel span (W3C Trace
//   Context).
// - W3C Baggage entries → attributes (e.g., `tenant.id`, `request.id`).
//
// Uses `@opentelemetry/api` as a peer dependency. The OTel no-op
// implementation is active by default (when no SDK is registered) — the
// functions return empty values but the API stays compatible.

import { propagation, trace } from "@opentelemetry/api";

import type { Value } from "./records.js";
import { otelSpanIdToBytes, otelTraceIdToBytes } from "./trace-ids.js";

/** Default baggage keys auto-injected as attributes (per spec §3.4). */
export const DEFAULT_BAGGAGE_KEYS: readonly string[] = ["tenant.id", "request.id", "user.id"];

export interface ActiveTraceContext {
  readonly traceId: Uint8Array | undefined;
  readonly spanId: Uint8Array | undefined;
  readonly traceFlags: number;
}

/**
 * Return the active OTel span's W3C Trace Context as bytes.
 *
 * No active span → `traceId` / `spanId` undefined and `traceFlags` 0. This
 * is a legitimate state: not every record is emitted inside a span (background
 * tasks, startup).
 */
export function getActiveTraceContext(): ActiveTraceContext {
  const span = trace.getActiveSpan();
  if (!span) {
    return { traceId: undefined, spanId: undefined, traceFlags: 0 };
  }
  const ctx = span.spanContext();
  if (!trace.isSpanContextValid(ctx)) {
    return { traceId: undefined, spanId: undefined, traceFlags: 0 };
  }
  return {
    traceId: otelTraceIdToBytes(ctx.traceId),
    spanId: otelSpanIdToBytes(ctx.spanId),
    traceFlags: ctx.traceFlags,
  };
}

/**
 * Return W3C Baggage entries matching `allowedKeys` as a plain attributes
 * map.
 *
 * Baggage is cross-service context propagation; the logger extracts the
 * default allowed keys and injects them into attributes.
 */
export function getBaggageAttributes(
  allowedKeys: readonly string[] = DEFAULT_BAGGAGE_KEYS,
): Record<string, Value> {
  const result: Record<string, Value> = {};
  const baggage = propagation.getActiveBaggage();
  if (!baggage) return result;
  const allowed = new Set(allowedKeys);
  for (const key of allowed) {
    const entry = baggage.getEntry(key);
    if (entry !== undefined) {
      result[key] = entry.value;
    }
  }
  return result;
}
