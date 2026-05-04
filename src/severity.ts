// Severity numbering + canonical text mapping.
//
// Per spec ADR-0001 §2: OTel severity numbering 1-24 via `severity_number`.
// `severity_text` MUST be exactly one of the 6 canonical OTel-recommended
// strings (`TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL`). Numeric granularity
// is carried in `severity_number`; backends filter by `severity_text` exact
// match.

/**
 * Primary severity levels matching the public API methods.
 *
 * Values = baseline per severity bucket (1=TRACE, 5=DEBUG, 9=INFO, ...).
 * Intermediate levels (TRACE2/TRACE3, etc.) are emitted via
 * `Logger.log(severityNumber, ...)` with a numeric value.
 */
export const Severity = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
} as const;

export type SeverityValue = (typeof Severity)[keyof typeof Severity];

// Canonical 6-value string set — OTel-recommended (spec §2). Backends filter
// by exact match — do not add "TRACE2" / "INFO3" / etc.
export const SEVERITY_TEXT_TRACE = "TRACE";
export const SEVERITY_TEXT_DEBUG = "DEBUG";
export const SEVERITY_TEXT_INFO = "INFO";
export const SEVERITY_TEXT_WARN = "WARN";
export const SEVERITY_TEXT_ERROR = "ERROR";
export const SEVERITY_TEXT_FATAL = "FATAL";

export type SeverityText =
  | typeof SEVERITY_TEXT_TRACE
  | typeof SEVERITY_TEXT_DEBUG
  | typeof SEVERITY_TEXT_INFO
  | typeof SEVERITY_TEXT_WARN
  | typeof SEVERITY_TEXT_ERROR
  | typeof SEVERITY_TEXT_FATAL;

export const CANONICAL_SEVERITY_TEXTS: readonly SeverityText[] = [
  SEVERITY_TEXT_TRACE,
  SEVERITY_TEXT_DEBUG,
  SEVERITY_TEXT_INFO,
  SEVERITY_TEXT_WARN,
  SEVERITY_TEXT_ERROR,
  SEVERITY_TEXT_FATAL,
];

const MIN_SEVERITY_NUMBER = 1;
const MAX_SEVERITY_NUMBER = 24;

// Bucket boundaries — inclusive ranges per OTel semconv:
//   1-4   → TRACE
//   5-8   → DEBUG
//   9-12  → INFO
//   13-16 → WARN
//   17-20 → ERROR
//   21-24 → FATAL
const BUCKETS: readonly {
  readonly low: number;
  readonly high: number;
  readonly text: SeverityText;
}[] = [
  { low: 1, high: 4, text: SEVERITY_TEXT_TRACE },
  { low: 5, high: 8, text: SEVERITY_TEXT_DEBUG },
  { low: 9, high: 12, text: SEVERITY_TEXT_INFO },
  { low: 13, high: 16, text: SEVERITY_TEXT_WARN },
  { low: 17, high: 20, text: SEVERITY_TEXT_ERROR },
  { low: 21, high: 24, text: SEVERITY_TEXT_FATAL },
];

/**
 * Map severity_number (1-24) → canonical severity_text (one of 6).
 *
 * @throws RangeError if severityNumber is outside [1, 24].
 */
export function severityTextFor(severityNumber: number): SeverityText {
  if (severityNumber < MIN_SEVERITY_NUMBER || severityNumber > MAX_SEVERITY_NUMBER) {
    throw new RangeError(
      `severity_number must be in [${MIN_SEVERITY_NUMBER.toString()}, ${MAX_SEVERITY_NUMBER.toString()}], got ${severityNumber.toString()}`,
    );
  }
  for (const bucket of BUCKETS) {
    if (severityNumber >= bucket.low && severityNumber <= bucket.high) {
      return bucket.text;
    }
  }
  // Unreachable — bucket coverage is exhaustive over [1, 24].
  /* istanbul ignore next */
  throw new Error(`unreachable: bucket not found for ${severityNumber.toString()}`);
}

/** Return true if severity_number is in [1, 24]. */
export function isValidSeverityNumber(severityNumber: number): boolean {
  return (
    Number.isInteger(severityNumber) &&
    severityNumber >= MIN_SEVERITY_NUMBER &&
    severityNumber <= MAX_SEVERITY_NUMBER
  );
}

/** Return true if text is one of the 6 canonical OTel-recommended strings. */
export function isCanonicalSeverityText(text: string): text is SeverityText {
  return (CANONICAL_SEVERITY_TEXTS as readonly string[]).includes(text);
}
