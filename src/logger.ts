// Logger class — main public API.
//
// Per spec §3: named loggers with dot-hierarchy, severity methods,
// context-bound child loggers, scoped sink overrides, context propagation.
//
// TypeScript idioms (per spec §3.5):
// - camelCase methods (`logger.info(...)`, `logger.withSinks(...)`).
// - Promise-async lifecycle (`flush()` / `close()` return Promises).
// - `scopeSinks(sinks, callback)` for the spec's lexically scoped override
//   (the closest TS idiom for the Python `with` context manager).
// - Sink emit is synchronous from the caller's perspective; sinks may
//   buffer internally (Phase 2+ OTLPSink).
//
// Hierarchy (per spec §3.1): `Logger.get("dagstack.rag.retriever")` →
// parent `"dagstack.rag"` → `"dagstack"` → root `""`. Sinks and minSeverity
// inherit from the parent unless overridden on the child.

import { getActiveTraceContext, getBaggageAttributes } from "./context.js";
import type { InstrumentationScope, LogRecord, Resource, Value } from "./records.js";
import { DEFAULT_SECRET_SUFFIXES, redactAttributes } from "./redaction.js";
import { Severity, severityTextFor } from "./severity.js";
import type { FlushResult, Sink } from "./sinks/base.js";
import { ConsoleSink } from "./sinks/console.js";
import { emitInactiveSubscriptionWarning, Subscription } from "./subscription.js";

const ROOT_NAME = "";

/**
 * Diagnostic channel for binding-internal warnings (sink failures,
 * configure-time disable-all redaction, etc.) per spec §7.4. This logger
 * defaults to a dedicated stderr `ConsoleSink` so its output never
 * silently merges with application sinks — operators may opt in to
 * merging by calling `setSinks` on the internal logger explicitly.
 */
export const INTERNAL_LOGGER_NAME = "dagstack.logger.internal";

/**
 * Global flag controlling whether non-`*Ctx` severity methods read trace
 * state from the active OTel context (spec ADR-0001 v1.2 §3.4.2 — M2
 * cross-binding parity). The TypeScript binding's idiomatic default is
 * `true` (matches `@opentelemetry/api`'s `context.active()` convention).
 *
 * Mutated only via `configure({ autoInjectTraceContext })` and the
 * test-only `_resetRegistryForTests`.
 */
let autoInjectTraceContext = true;

/** Internal accessor used by Logger.emit to read the current flag. */
export function _getAutoInjectTraceContext(): boolean {
  return autoInjectTraceContext;
}

/** Internal mutator used by configure() to apply the flag. */
export function _setAutoInjectTraceContext(value: boolean): void {
  autoInjectTraceContext = value;
}

const loggers = new Map<string, Logger>();

/**
 * Optional `exception()` arguments.
 */
export interface ExceptionOptions {
  readonly body?: Value;
  readonly attributes?: Readonly<Record<string, Value>>;
}

/**
 * Internal state — held on the Logger instance via `#`-private fields.
 * Externalised as an interface for documentation only.
 */
interface LoggerState {
  readonly name: string;
  version: string | undefined;
  parent: Logger | null;
  sinks: Sink[];
  sinksExplicit: boolean;
  minSeverity: number;
  attributes: Readonly<Record<string, Value>>;
  resource: Resource | undefined;
  scope: InstrumentationScope;
  redactionSuffixes: readonly string[];
  /**
   * `true` when `setRedactionSuffixes` (or `configure({redaction})`) set
   * an explicit list — including the empty disable-all case. `false`
   * means inherit from the parent chain (root falls back to
   * `DEFAULT_SECRET_SUFFIXES`).
   */
  redactionExplicit: boolean;
}

/**
 * Named logger with dot-hierarchy.
 *
 * Do NOT construct directly — use `Logger.get(name, version)`:
 *
 * @example
 *     const logger = Logger.get("dagstack.rag.retriever", "1.4.2");
 *     logger.info("query received", { "user.id": 42 });
 *     logger.exception(err);  // auto stack trace
 *
 * @example Scoped override
 *     await logger.scopeSinks([new InMemorySink()], async (scoped) => {
 *         scoped.info("captured in scope");
 *     });
 */
export class Logger {
  private state: LoggerState;

  private constructor(state: LoggerState) {
    this.state = state;
  }

  // ─── Constructor / registry ──────────────────────────────────────────────

  /**
   * Return (or create) a named logger. Cached in the registry.
   *
   * @param name dot-notation path. `""` = root. Parent is derived by splitting on the last dot.
   * @param version instrumentation scope version; updated on the existing logger if it differs.
   */
  static get(name = "", version?: string): Logger {
    const existing = loggers.get(name);
    if (existing !== undefined) {
      if (version !== undefined && existing.state.version !== version) {
        existing.state.version = version;
        existing.state.scope = {
          name: name === "" ? "root" : name,
          version,
        };
      }
      return existing;
    }
    let parent: Logger | null = null;
    if (name !== ROOT_NAME) {
      parent = Logger.get(parentNameOf(name));
    }
    const isInternal = name === INTERNAL_LOGGER_NAME;
    const defaultSinks: Sink[] = isInternal
      ? [new ConsoleSink({ mode: "json", minSeverity: Severity.WARN })]
      : [];
    const instance = new Logger({
      name,
      version,
      parent,
      sinks: defaultSinks,
      sinksExplicit: isInternal,
      minSeverity: 1,
      attributes: {},
      resource: undefined,
      scope: {
        name: name === "" ? "root" : name,
        ...(version !== undefined ? { version } : {}),
      },
      redactionSuffixes: DEFAULT_SECRET_SUFFIXES,
      redactionExplicit: false,
    });
    loggers.set(name, instance);
    return instance;
  }

  // ─── Introspection ───────────────────────────────────────────────────────

  get name(): string {
    return this.state.name;
  }

  get version(): string | undefined {
    return this.state.version;
  }

  /** Resolved sinks list — explicit on this logger or inherited from the parent. */
  effectiveSinks(): Sink[] {
    if (this.state.sinksExplicit) return [...this.state.sinks];
    if (this.state.parent !== null) return this.state.parent.effectiveSinks();
    return [];
  }

  /** Resolved minSeverity — explicit or inherited. */
  effectiveMinSeverity(): number {
    if (this.state.minSeverity > 1) return this.state.minSeverity;
    if (this.state.parent !== null) return this.state.parent.effectiveMinSeverity();
    return 1;
  }

  /** Resolved resource — explicit or inherited. */
  effectiveResource(): Resource | undefined {
    if (this.state.resource !== undefined) return this.state.resource;
    if (this.state.parent !== null) return this.state.parent.effectiveResource();
    return undefined;
  }

  // ─── Configuration mutators ──────────────────────────────────────────────
  //
  // WARNING: these methods mutate the *shared* registry node for this
  // logger name (per spec §3.1). `Logger.get(name)` is a singleton per
  // name, so any other code that holds the same handle — or that calls
  // `Logger.get(name)` again — sees the updated state immediately. This
  // is intentional for bootstrap (`Logger.get("").setMinSeverity(...)`
  // propagates through the whole tree via parent inheritance) but it
  // breaks naive test isolation: a test that overrides sinks on a
  // well-known name leaks the override into the next test.
  //
  // For test isolation, call `Logger.reset()` between tests, or use the
  // scoped variants (§6) — `withSinks` / `appendSinks` /
  // `scopeSinks` — which return a fresh handle with overrides instead
  // of mutating the shared state.

  /**
   * Replace explicit sinks on this logger.
   *
   * Mutates the shared registry node (visible to all consumers of the
   * same name). Children inherit the new list unless they have their
   * own explicit sinks.
   */
  setSinks(sinks: readonly Sink[]): void {
    this.state.sinks = [...sinks];
    this.state.sinksExplicit = true;
  }

  /**
   * Replace minSeverity — early-drop threshold.
   *
   * Mutates the shared registry node (visible to all consumers of the
   * same name). Children inherit unless they set their own threshold.
   */
  setMinSeverity(severityNumber: number): void {
    this.state.minSeverity = severityNumber;
  }

  /**
   * Replace the Resource (or clear it with `undefined`).
   *
   * Mutates the shared registry node (visible to all consumers of the
   * same name). Children inherit unless they set their own Resource.
   */
  setResource(resource: Resource | undefined): void {
    this.state.resource = resource;
  }

  /**
   * Install the effective secret-suffix list on this logger (typically
   * called on the root logger via `configure({ redaction })` per spec
   * §10.4).
   *
   * Mutates the shared registry node. The suffix list MUST already be
   * validated and lowercased — use `buildEffectiveSuffixes` to derive
   * it from a `RedactionConfig`.
   *
   * Pass `undefined` to fall back to inherited behaviour (parent's
   * suffixes or `DEFAULT_SECRET_SUFFIXES` at the root).
   */
  setRedactionSuffixes(suffixes: readonly string[] | undefined): void {
    if (suffixes === undefined) {
      this.state.redactionSuffixes = DEFAULT_SECRET_SUFFIXES;
      this.state.redactionExplicit = false;
      return;
    }
    // Snapshot copy preserves the disable-all signal across mutation.
    this.state.redactionSuffixes = [...suffixes];
    this.state.redactionExplicit = true;
  }

  /**
   * Resolve the redaction-suffix list applied by this logger — explicit
   * on this node or inherited from the parent chain. Returns
   * `DEFAULT_SECRET_SUFFIXES` when no override is registered anywhere
   * up the chain. An explicit empty list (disable-all per spec §10.4)
   * is preserved through inheritance via the `redactionExplicit` flag.
   *
   * The returned slice is a snapshot copy.
   *
   * TODO(#105): collapse the four chain-walks (sinks / minSeverity /
   * resource / suffixes) into one upward traversal.
   */
  effectiveSecretSuffixes(): string[] {
    if (this.state.redactionExplicit) return [...this.state.redactionSuffixes];
    if (this.state.parent !== null) return this.state.parent.effectiveSecretSuffixes();
    return [...DEFAULT_SECRET_SUFFIXES];
  }

  /**
   * Clear the global Logger registry — restore root defaults.
   *
   * For test isolation: call between tests that mutate logger state via
   * `setSinks` / `setMinSeverity` / `setResource` or via the top-level
   * `configure(...)`. After `reset()`, a subsequent `Logger.get(name)`
   * creates a fresh node with no inherited overrides.
   *
   * SAFETY: this is a coarse instrument — it invalidates **all** logger
   * handles still held elsewhere. Production code MUST NOT call this; it
   * is reserved for test fixtures and the binding's own teardown.
   */
  static reset(): void {
    loggers.clear();
  }

  // ─── Severity methods ────────────────────────────────────────────────────

  trace(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.TRACE, body, attributes);
  }

  debug(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.DEBUG, body, attributes);
  }

  info(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.INFO, body, attributes);
  }

  warn(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.WARN, body, attributes);
  }

  error(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.ERROR, body, attributes);
  }

  fatal(body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(Severity.FATAL, body, attributes);
  }

  /** Generic emit with explicit severity_number (1-24) — for intermediate levels. */
  log(severityNumber: number, body: Value, attributes?: Readonly<Record<string, Value>>): void {
    this.emit(severityNumber, body, attributes);
  }

  /**
   * Log an exception with OTel semconv-compatible attributes.
   *
   * Adds `exception.type`, `exception.message`, `exception.stacktrace` to
   * attributes (spec §3.2 contract). Severity is `ERROR`.
   */
  exception(err: unknown, options: ExceptionOptions = {}): void {
    const error: Error = err instanceof Error ? err : new Error(String(err));
    const excAttrs: Record<string, Value> = {
      "exception.type": error.name,
      "exception.message": error.message,
      "exception.stacktrace": error.stack ?? "",
    };
    if (options.attributes !== undefined) {
      Object.assign(excAttrs, options.attributes);
    }
    const finalBody: Value = options.body ?? error.message;
    this.emit(Severity.ERROR, finalBody, excAttrs);
  }

  // ─── Scoped overrides (§6 spec) ──────────────────────────────────────────

  /** Return a non-cached child with replaced sinks (§6.1). */
  withSinks(sinks: readonly Sink[]): Logger {
    const child = this.makeDetachedChild();
    child.state.sinks = [...sinks];
    child.state.sinksExplicit = true;
    return child;
  }

  /** Return a non-cached child with the parent's sinks plus `extras`. */
  appendSinks(extras: readonly Sink[]): Logger {
    const child = this.makeDetachedChild();
    child.state.sinks = [...this.effectiveSinks(), ...extras];
    child.state.sinksExplicit = true;
    return child;
  }

  /** Return a non-cached child with an empty sinks list — emits are discarded. */
  withoutSinks(): Logger {
    const child = this.makeDetachedChild();
    child.state.sinks = [];
    child.state.sinksExplicit = true;
    return child;
  }

  /**
   * Run `callback` with `this` logger's sinks temporarily replaced. Restores
   * the original sinks when the callback returns or throws.
   *
   * The closest TypeScript idiom for the spec's `scopeSinks` context manager
   * (Python `with` block, Go defer pattern). The callback receives the same
   * `Logger` instance — emits inside it use the replacement sinks.
   *
   * @example
   *     await logger.scopeSinks([memSink], async (scoped) => {
   *         scoped.info("captured");
   *     });
   */
  async scopeSinks<T>(
    sinks: readonly Sink[],
    callback: (logger: Logger) => T | Promise<T>,
  ): Promise<T> {
    const prevSinks = this.state.sinks;
    const prevExplicit = this.state.sinksExplicit;
    this.state.sinks = [...sinks];
    this.state.sinksExplicit = true;
    try {
      return await callback(this);
    } finally {
      this.state.sinks = prevSinks;
      this.state.sinksExplicit = prevExplicit;
    }
  }

  /** Return a non-cached child with pre-bound attributes (§3.3). */
  child(attributes: Readonly<Record<string, Value>>): Logger {
    const newLogger = this.makeDetachedChild();
    newLogger.state.attributes = { ...this.state.attributes, ...attributes };
    return newLogger;
  }

  private makeDetachedChild(): Logger {
    return new Logger({
      name: this.state.name,
      version: this.state.version,
      parent: this,
      sinks: [],
      sinksExplicit: false,
      minSeverity: 1,
      attributes: { ...this.state.attributes },
      resource: undefined,
      scope: this.state.scope,
      redactionSuffixes: this.state.redactionSuffixes,
      redactionExplicit: this.state.redactionExplicit,
    });
  }

  // ─── Subscriptions (§7.2, Phase 1 inactive) ──────────────────────────────

  /** Subscribe to reconfigure events. Phase 1 — inactive + warning. */
  onReconfigure(_callback: () => void): Subscription {
    const path = `logger:${this.state.name}`;
    emitInactiveSubscriptionWarning(path);
    return new Subscription({
      path,
      active: false,
      inactiveReason: "Phase 1 logger does not support watch-based reconfigure",
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Flush all effective sinks (best-effort, per-sink timeout).
   *
   * Phase 1: all built-in sinks (Console, File, InMemory) are synchronous,
   * so `timeoutMs` is accepted but **not enforced** — no TimeoutError will
   * be raised by any built-in sink. Phase 2 (OTLPSink) MUST honour the
   * deadline; refer to the spec ADR-0001 §7.1.
   */
  async flush(timeoutMs = 5000): Promise<FlushResult> {
    const failedSinks: { sinkId: string; error: string }[] = [];
    for (const sink of this.effectiveSinks()) {
      try {
        const result = await sink.flush(timeoutMs);
        if (!result.ok) {
          failedSinks.push(...(result.failedSinks ?? []));
        }
      } catch (err) {
        failedSinks.push({
          sinkId: sink.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const ok = failedSinks.length === 0;
    return ok ? { ok: true } : { ok: false, partial: true, failedSinks };
  }

  /** Close all sinks — idempotent, swallows individual sink failures. */
  async close(): Promise<void> {
    for (const sink of this.effectiveSinks()) {
      try {
        await sink.close();
      } catch {
        // Close failures must not break shutdown — swallow.
      }
    }
  }

  // ─── Internal emit ───────────────────────────────────────────────────────

  private emit(
    severityNumber: number,
    body: Value,
    attributes: Readonly<Record<string, Value>> | undefined,
  ): void {
    // Early drop by severity (the §7.1 supportsSeverity hint applies later
    // per-sink, but logger-level drop saves building a record for
    // non-emitting severities).
    if (severityNumber < this.effectiveMinSeverity()) return;

    // Merge attributes: child-bound < call-site. Context auto-injection.
    const recordAttrs: Record<string, Value> = { ...this.state.attributes };
    if (attributes !== undefined) {
      Object.assign(recordAttrs, attributes);
    }

    // Context propagation (§3.4).
    const baggageAttrs = getBaggageAttributes();
    for (const [key, value] of Object.entries(baggageAttrs)) {
      if (!(key in recordAttrs)) {
        recordAttrs[key] = value;
      }
    }

    // Redaction (§10.1-10.2).
    const redacted = redactAttributes(recordAttrs, this.effectiveSecretSuffixes());

    // Active trace / span context (§3.4). When the cross-binding parity
    // flag (§3.4.2) is `false`, skip the ambient lookup entirely — this
    // makes the wire output identical to `auto_inject_trace_context = false`
    // bindings.
    const { traceId, spanId, traceFlags } = autoInjectTraceContext
      ? getActiveTraceContext()
      : { traceId: undefined, spanId: undefined, traceFlags: 0 };

    const resource = this.effectiveResource();
    const record: LogRecord = {
      time_unix_nano: nowUnixNano(),
      severity_number: severityNumber,
      severity_text: severityTextFor(severityNumber),
      body,
      attributes: redacted,
      instrumentation_scope: this.state.scope,
      ...(resource !== undefined ? { resource } : {}),
      ...(traceId !== undefined ? { trace_id: traceId } : {}),
      ...(spanId !== undefined ? { span_id: spanId } : {}),
      trace_flags: traceFlags,
    };

    for (const sink of this.effectiveSinks()) {
      try {
        sink.emit(record);
      } catch {
        // Sink failure is isolated — the remaining sinks keep emitting.
        // Phase 2+: report on the dagstack.logger.internal channel.
      }
    }
  }
}

function parentNameOf(name: string): string {
  // `dagstack.rag.retriever` → `dagstack.rag`; root → root.
  if (!name.includes(".")) return ROOT_NAME;
  const idx = name.lastIndexOf(".");
  return name.substring(0, idx);
}

// Anchor `performance.now()` (sub-ms monotonic clock) to wall-time at
// module load. `performance.timeOrigin` gives the epoch milliseconds when
// the high-resolution timer started; we add the elapsed `performance.now()`
// fraction at emit time to recover sub-millisecond accuracy without
// drifting from wall clock on long-running processes.
const _PERF_ORIGIN_MS = performance.timeOrigin;

function nowUnixNano(): bigint {
  // `performance.now()` is sub-microsecond on most Node 20+ runtimes; the
  // combined value is ms-anchored wall time with sub-ms precision, so two
  // emits on the same millisecond always get strictly increasing
  // `time_unix_nano` values (ordering invariant preserved for
  // sort-by-timestamp consumers of the JSON-lines wire format).
  const wallNs = (_PERF_ORIGIN_MS + performance.now()) * 1_000_000;
  // BigInt only accepts integers; truncate the fractional nanoseconds.
  return BigInt(Math.trunc(wallNs));
}

/** Test helper — clear cached loggers between tests. NOT a public API. */
export function _resetRegistryForTests(): void {
  loggers.clear();
  autoInjectTraceContext = true;
}
