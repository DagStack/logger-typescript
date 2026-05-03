// W3C Trace Context encoding helpers.
//
// Per spec ADR-0001 §1: trace_id = 16 bytes, span_id = 8 bytes (OTel
// internal model / OTLP protobuf wire). For JSON-lines / OTel JSON wire —
// lowercase hex strings (32 / 16 hex chars respectively, zero-padded).
//
// Helpers for encoding / decoding between byte arrays and hex strings.

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const TRACE_ID_HEX_CHARS = TRACE_ID_BYTES * 2;
const SPAN_ID_HEX_CHARS = SPAN_ID_BYTES * 2;

/**
 * Encode a 16-byte trace_id → 32-char lowercase hex string, or undefined.
 *
 * @throws RangeError when traceId is not undefined and not exactly 16 bytes.
 */
export function traceIdToHex(traceId: Uint8Array | undefined): string | undefined {
  if (traceId === undefined) return undefined;
  if (traceId.length !== TRACE_ID_BYTES) {
    throw new RangeError(
      `trace_id must be ${TRACE_ID_BYTES.toString()} bytes, got ${traceId.length.toString()}`,
    );
  }
  return bytesToHex(traceId);
}

/**
 * Encode an 8-byte span_id → 16-char lowercase hex string, or undefined.
 *
 * @throws RangeError when spanId is not undefined and not exactly 8 bytes.
 */
export function spanIdToHex(spanId: Uint8Array | undefined): string | undefined {
  if (spanId === undefined) return undefined;
  if (spanId.length !== SPAN_ID_BYTES) {
    throw new RangeError(
      `span_id must be ${SPAN_ID_BYTES.toString()} bytes, got ${spanId.length.toString()}`,
    );
  }
  return bytesToHex(spanId);
}

/**
 * Decode a 32-char hex string → 16-byte trace_id, or undefined.
 *
 * @throws RangeError when hexStr is not undefined and not 32 chars or contains non-hex.
 */
export function hexToTraceId(hexStr: string | undefined): Uint8Array | undefined {
  if (hexStr === undefined) return undefined;
  if (hexStr.length !== TRACE_ID_HEX_CHARS) {
    throw new RangeError(
      `trace_id hex must be ${TRACE_ID_HEX_CHARS.toString()} chars, got ${hexStr.length.toString()}`,
    );
  }
  return hexToBytes(hexStr, "trace_id");
}

/**
 * Decode a 16-char hex string → 8-byte span_id, or undefined.
 *
 * @throws RangeError when hexStr is not undefined and not 16 chars or contains non-hex.
 */
export function hexToSpanId(hexStr: string | undefined): Uint8Array | undefined {
  if (hexStr === undefined) return undefined;
  if (hexStr.length !== SPAN_ID_HEX_CHARS) {
    throw new RangeError(
      `span_id hex must be ${SPAN_ID_HEX_CHARS.toString()} chars, got ${hexStr.length.toString()}`,
    );
  }
  return hexToBytes(hexStr, "span_id");
}

const HEX_PATTERN = /^[0-9a-f]+$/;

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const v of bytes) {
    out += v.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string, kind: string): Uint8Array {
  const normalised = hex.toLowerCase();
  if (!HEX_PATTERN.test(normalised)) {
    throw new RangeError(`${kind} hex ${JSON.stringify(hex)} contains invalid chars`);
  }
  const result = new Uint8Array(normalised.length / 2);
  for (const i of result.keys()) {
    result[i] = parseInt(normalised.substring(i * 2, i * 2 + 2), 16);
  }
  return result;
}

/**
 * Convert an OTel `trace_id` (hex string per @opentelemetry/api) into the
 * 16-byte representation used by LogRecord. The OTel API exposes ids as
 * lowercase hex strings; we keep them as bytes internally to match the spec.
 */
export function otelTraceIdToBytes(otelTraceId: string): Uint8Array | undefined {
  if (otelTraceId === "" || /^0+$/.test(otelTraceId)) return undefined;
  return hexToTraceId(otelTraceId);
}

/** Convert an OTel `span_id` (hex string) into 8 bytes. */
export function otelSpanIdToBytes(otelSpanId: string): Uint8Array | undefined {
  if (otelSpanId === "" || /^0+$/.test(otelSpanId)) return undefined;
  return hexToSpanId(otelSpanId);
}
