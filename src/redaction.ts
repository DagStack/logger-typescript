// Attribute redaction — mask secret-like values per spec §10.
//
// Default patterns — suffix matching (case-insensitive) on keys:
//     *_KEY, *_SECRET, *_TOKEN, *_PASSWORD, *_PASSPHRASE, *_CREDENTIALS
//
// Per spec §10.1: mask rendering — the literal `"***"`. The raw value
// **never** crosses the logger API boundary in an attribute value flagged as
// secret. For nested attributes redaction is recursive (§10.2).
//
// The body (LogRecord.body) is **not** redacted — developers must format
// the body without secrets (§10.1 rationale).

import type { Value } from "./records.js";

/**
 * Default secret-key suffixes per spec ADR-0001 §10.1 / §10.4 v1.1.
 *
 * Opinionated 6-element subset of `config-spec/_meta/secret_patterns.yaml`.
 * The list is fixed at v1.1 to preserve API stability; richer matchers
 * ship via the Phase 2 processor pipeline (§10.3).
 */
export const DEFAULT_SECRET_SUFFIXES: readonly string[] = [
  "_key",
  "_secret",
  "_token",
  "_password",
  "_passphrase",
  "_credentials",
];

/**
 * Phase 1 redaction policy per spec §10.4. Applications register extra
 * suffixes through `configure({ redaction: ... })`.
 *
 * Default behaviour (omitted or empty) keeps the 6-element
 * `DEFAULT_SECRET_SUFFIXES` baseline.
 */
export interface RedactionConfig {
  /**
   * Additional secret suffixes registered by the application. Each entry
   * MUST be lowercase ASCII, contain no whitespace, and be non-empty
   * (validated at configure time).
   */
  readonly extraSuffixes?: readonly string[];
  /**
   * When true, swaps the base set for `extraSuffixes` instead of unioning.
   * Combined with an empty `extraSuffixes`, all suffix-based redaction is
   * disabled — the binding emits a WARN diagnostic on
   * `dagstack.logger.internal` in that case (spec §10.4 disable-all).
   */
  readonly replaceDefaults?: boolean;
}

/**
 * Validate `cfg.extraSuffixes` per spec §10.4: each entry MUST be
 * lowercase ASCII, non-empty, and contain no whitespace. Throws
 * `RangeError` on the first violation.
 */
export function validateRedactionConfig(cfg: RedactionConfig): void {
  const extras = cfg.extraSuffixes ?? [];
  let i = 0;
  for (const s of extras) {
    if (s === "") {
      throw new RangeError(`redaction.extra_suffixes[${i.toString()}] contains an empty string`);
    }
    if (/\s/.test(s)) {
      throw new RangeError(
        `redaction.extra_suffixes[${i.toString()}] contains whitespace: ${JSON.stringify(s)}`,
      );
    }
    if (s.toLowerCase() !== s) {
      throw new RangeError(
        `redaction.extra_suffixes[${i.toString()}] must be lowercase ASCII: ${JSON.stringify(s)}`,
      );
    }
    // eslint-disable-next-line no-control-regex
    if (!/^[\x00-\x7f]*$/.test(s)) {
      throw new RangeError(
        `redaction.extra_suffixes[${i.toString()}] must be lowercase ASCII: ${JSON.stringify(s)}`,
      );
    }
    i++;
  }
}

/**
 * Build the post-configure suffix list applied during emit. In the
 * disable-all mode (`replaceDefaults=true`, `extraSuffixes=[]`) the result
 * is an empty array (not `undefined`); callers MUST treat that as "no
 * suffix-based masking" — never fall back to `DEFAULT_SECRET_SUFFIXES`
 * silently.
 *
 * Does NOT validate `cfg.extraSuffixes` — callers passing untrusted input
 * MUST run `validateRedactionConfig` first, or use the `configure()`
 * surface, which validates at configure time.
 */
export function buildEffectiveSuffixes(cfg: RedactionConfig): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string): void => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (!cfg.replaceDefaults) {
    for (const s of DEFAULT_SECRET_SUFFIXES) add(s);
  }
  for (const s of cfg.extraSuffixes ?? []) add(s.toLowerCase());
  return out;
}

/** The masked value rendered in place of a secret. */
export const MASKED_PLACEHOLDER = "***";

/**
 * Returns true if `key` matches any of the suffix patterns
 * (case-insensitive).
 */
export function isSecretField(
  key: string,
  suffixes: readonly string[] = DEFAULT_SECRET_SUFFIXES,
): boolean {
  const lowered = key.toLowerCase();
  return suffixes.some((suffix) => lowered.endsWith(suffix));
}

/**
 * Returns `MASKED_PLACEHOLDER` if `key` is a secret field. Otherwise returns
 * the original value (pass-through). Handy for non-recursive call sites.
 */
export function maskValue(
  key: string,
  value: Value,
  suffixes: readonly string[] = DEFAULT_SECRET_SUFFIXES,
): Value {
  return isSecretField(key, suffixes) ? MASKED_PLACEHOLDER : value;
}

function redactValue(value: Value, suffixes: readonly string[]): Value {
  if (Array.isArray(value)) {
    return value.map((item: Value) => redactValue(item, suffixes));
  }
  if (value !== null && typeof value === "object") {
    return redactAttributes(value as Record<string, Value>, suffixes);
  }
  return value;
}

/**
 * Return a new object with masked secret values (recursive for nested
 * maps AND nested lists-of-maps).
 *
 * @param attrs original attributes object.
 * @param suffixes suffix patterns used for secret-key detection.
 * @returns a deep-cloned object with `"***"` on keys matching the patterns;
 *          non-secret values are passed through, with nested objects and
 *          lists of objects (e.g. `events: [{ api_key: "..." }]`)
 *          recursed so that a buried secret still gets masked.
 */
export function redactAttributes(
  attrs: Readonly<Record<string, Value>>,
  suffixes: readonly string[] = DEFAULT_SECRET_SUFFIXES,
): Record<string, Value> {
  const result: Record<string, Value> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isSecretField(key, suffixes)) {
      result[key] = MASKED_PLACEHOLDER;
    } else {
      result[key] = redactValue(value, suffixes);
    }
  }
  return result;
}
