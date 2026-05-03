// Bootstrap configuration for Logger — produced by the application from a
// config-spec section.
//
// Per spec §9.1-§9.2: the logger reads its configuration via
// `dagstack/config-spec` bindings. The TS binding does not depend on
// `@dagstack/config` directly — the application extracts the `logging:`
// section from its Config and passes it as a plain object to
// `configure({...})`.
//
// This avoids a circular cross-package dependency and preserves the
// independence of the two libraries.

import { _setAutoInjectTraceContext, INTERNAL_LOGGER_NAME, Logger } from "./logger.js";
import type { Resource, Value } from "./records.js";
import {
  buildEffectiveSuffixes,
  type RedactionConfig,
  validateRedactionConfig,
} from "./redaction.js";
import { isValidSeverityNumber, Severity } from "./severity.js";
import type { Sink } from "./sinks/base.js";

const SEVERITY_NAME_TO_NUMBER: Readonly<Record<string, number>> = {
  TRACE: Severity.TRACE,
  DEBUG: Severity.DEBUG,
  INFO: Severity.INFO,
  WARN: Severity.WARN,
  WARNING: Severity.WARN,
  ERROR: Severity.ERROR,
  FATAL: Severity.FATAL,
  CRITICAL: Severity.FATAL,
};

export interface ConfigureOptions {
  /** Default severity threshold for the root logger. Accepts a name like "INFO" or a numeric value (1-24). */
  readonly rootLevel?: string | number;
  /** Sinks attached to root; inherited by children without their own sinks. */
  readonly sinks?: readonly Sink[];
  /** Per-logger level overrides (`{ "my-app.api": "WARN" }`). */
  readonly perLoggerLevels?: Readonly<Record<string, string | number>>;
  /** Process / service-level attrs for Resource; injected into every LogRecord. */
  readonly resourceAttributes?: Readonly<Record<string, Value>>;
  /**
   * Phase 1 redaction policy per spec §10.4. Validated at configure
   * time — invalid suffixes (empty, whitespace, non-lowercase-ASCII)
   * throw `RangeError` synchronously.
   *
   * Default behaviour (omitted) keeps the 6-element
   * `DEFAULT_SECRET_SUFFIXES` baseline.
   */
  readonly redaction?: RedactionConfig;
  /**
   * Cross-binding parity flag per spec ADR-0001 v1.2 §3.4.2 (M2). When
   * `true` (the TypeScript default — idiomatic, matches OTel's
   * `context.active()` convention), non-`*Ctx` severity methods read
   * `trace_id` / `span_id` / `trace_flags` from the active OTel context.
   * When `false`, the ambient lookup is skipped — useful when running
   * cross-binding parity tests against `go.dagstack.dev/logger`'s
   * default explicit-ctx mode.
   */
  readonly autoInjectTraceContext?: boolean;
}

/**
 * Bootstrap global logger state.
 *
 * @example
 *     configure({
 *         rootLevel: "INFO",
 *         sinks: [new ConsoleSink({ mode: "auto" })],
 *         resourceAttributes: { "service.name": "my-app" },
 *     });
 */
export function configure(options: ConfigureOptions = {}): void {
  // Atomicity invariant: validation runs before any registry mutation, so
  // a malformed `configure({...})` call leaves the registry untouched.
  // Downstream `set*` methods MUST NOT throw post-validation, otherwise
  // the apply phase below becomes non-atomic on partial failure.
  if (options.redaction !== undefined) {
    validateRedactionConfig(options.redaction);
  }

  const root = Logger.get(""); // root logger (name = "")
  root.setMinSeverity(resolveLevel(options.rootLevel ?? "INFO"));
  root.setSinks([...(options.sinks ?? [])]);

  if (
    options.resourceAttributes !== undefined &&
    Object.keys(options.resourceAttributes).length > 0
  ) {
    const resource: Resource = { attributes: { ...options.resourceAttributes } };
    root.setResource(resource);
  } else {
    root.setResource(undefined);
  }

  if (options.perLoggerLevels !== undefined) {
    for (const [name, level] of Object.entries(options.perLoggerLevels)) {
      const logger = Logger.get(name);
      logger.setMinSeverity(resolveLevel(level));
    }
  }

  if (options.redaction !== undefined) {
    const effective = buildEffectiveSuffixes(options.redaction);
    root.setRedactionSuffixes(effective);
    const disabledAll =
      options.redaction.replaceDefaults === true &&
      (options.redaction.extraSuffixes === undefined ||
        options.redaction.extraSuffixes.length === 0);
    if (disabledAll) {
      Logger.get(INTERNAL_LOGGER_NAME).warn(
        "redaction disabled by configure: replaceDefaults=true with empty extraSuffixes; " +
          "all suffix-based masking is OFF (spec §10.4 disable-all warning)",
      );
    }
  }

  if (options.autoInjectTraceContext !== undefined) {
    _setAutoInjectTraceContext(options.autoInjectTraceContext);
  }
}

/** Convert a level name ("INFO") or numeric (9) into a severity_number (1-24). */
function resolveLevel(level: string | number): number {
  if (typeof level === "number") {
    if (!isValidSeverityNumber(level)) {
      throw new RangeError(`severity_number ${level.toString()} not in [1, 24]`);
    }
    return level;
  }
  const upper = level.toUpperCase();
  if (upper in SEVERITY_NAME_TO_NUMBER) {
    return SEVERITY_NAME_TO_NUMBER[upper] ?? Severity.INFO;
  }
  throw new RangeError(
    `unknown severity name ${JSON.stringify(level)}; expected one of ${Object.keys(SEVERITY_NAME_TO_NUMBER).sort().join(", ")}`,
  );
}
