// Canonical JSON serialiser — RFC 8785 subset (config-spec §9.1.1).
//
// Mirrors the implementation in dagstack-config canonical-json.ts to
// guarantee byte-identical output between the two libraries (until they are
// merged into a Phase 2 dagstack-common package — for now the implementations
// live side-by-side and a cross-binding conformance test guarantees identical
// output).

/**
 * Recursive JSON value used by canonicalize(). Note: this excludes
 * `undefined`; objects must omit keys instead.
 *
 * The interface form (`JsonObject` / `JsonArray`) keeps typescript-eslint's
 * type inference healthy for deeply nested values; using a `type` alias here
 * results in `Record<string, JsonValue>` being collapsed to `error type`
 * during recursive resolution.
 */
export type JsonScalar = string | number | bigint | boolean | null;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonScalar | JsonObject | JsonArray;

/**
 * Serialise obj into a canonical JSON string.
 *
 * Rules:
 * - Sorted object keys (lexicographic UTF-16 code-unit order — matches
 *   Array.prototype.sort which is what JS uses for unicode comparison).
 * - No whitespace except inside strings.
 * - Integers without a decimal point (`1`); floats use shortest round-trip
 *   (the V8 default JSON.stringify representation).
 * - `-0` is normalised to `0`.
 * - NaN / ±Infinity → throws Error (RFC 8785 §3.2.2.3).
 * - Non-string object keys are not representable in JS `Record<string, *>`,
 *   but symbol-keyed properties are skipped (consistent with JSON.stringify).
 * - Unicode characters pass through (no `\u` escaping for printable BMP).
 *
 * @throws Error on NaN / ±Infinity / unsupported value types.
 */
export function canonicalJsonStringify(obj: JsonValue): string {
  return encode(obj);
}

/** UTF-8 byte form of `canonicalJsonStringify(obj)`. */
export function canonicalJsonStringifyBytes(obj: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJsonStringify(obj));
}

function encode(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return encodeArray(value);
  if (typeof value === "object") {
    return encodeObject(value as JsonObject);
  }
  // Defensive — TS prevents this at compile time.
  /* istanbul ignore next */
  throw new TypeError(`canonical JSON: unsupported value type ${typeof value}`);
}

function encodeString(s: string): string {
  return JSON.stringify(s);
}

function encodeNumber(n: number): string {
  if (Number.isNaN(n)) {
    throw new Error("canonical JSON: NaN not allowed");
  }
  if (!Number.isFinite(n)) {
    throw new Error("canonical JSON: Infinity not allowed");
  }
  // Normalise -0 → 0 (RFC 8785 §3.2.2.3).
  if (Object.is(n, -0)) {
    n = 0;
  }
  return JSON.stringify(n);
}

function encodeArray(arr: readonly JsonValue[]): string {
  if (arr.length === 0) return "[]";
  const parts = arr.map((item) => encode(item));
  return `[${parts.join(",")}]`;
}

function encodeObject(obj: JsonObject): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return "{}";
  const parts: string[] = [];
  for (const key of keys) {
    const v: JsonValue | undefined = obj[key];
    // Skip undefined values to match JSON.stringify semantics; the recursive
    // JsonValue type already excludes `undefined`, but the runtime check
    // keeps us safe against type-erased callers.
    if (v === undefined) continue;
    parts.push(`${encodeString(key)}:${encode(v)}`);
  }
  return `{${parts.join(",")}}`;
}
