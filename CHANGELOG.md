# Changelog

All notable changes are recorded in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-05-03

Cross-binding parity wave per `dagstack/logger-spec` architect review epic
(`logger-spec#2`). Closes M1, M2, M3, M4, M5, S3, S9 findings. All public
API additions are non-breaking; `0.2.0` is a safe drop-in upgrade from
`0.1.1` for the documented `Logger` / sink / `configure` surface.

### Added

- **Phase 1 redaction-config public API** (`RedactionConfig` + `configure({redaction})`)
  per logger-spec ADR-0001 v1.1 §10.4 (M3). Applications can now register
  extra secret suffixes at bootstrap without waiting for the Phase 2
  processor pipeline:

  ```typescript
  configure({
    redaction: {
      extraSuffixes: ["_apikey", "_x_internal_token"],
      // replaceDefaults: true,  // optional — narrows the safety net
    },
  });
  ```

  Validation runs synchronously inside `configure()` (RangeError on empty /
  whitespace / non-lowercase-ASCII suffix). When `replaceDefaults=true` and
  `extraSuffixes=[]`, all suffix-based masking is OFF and a WARN is emitted
  on `dagstack.logger.internal` per spec §10.4.

- **`Logger.setRedactionSuffixes` + `Logger.effectiveSecretSuffixes`** —
  programmatic accessors mirroring the configure-time surface.
  `buildEffectiveSuffixes` and `validateRedactionConfig` are also exported
  so applications can compose policies before passing them into configure.

- **`INTERNAL_LOGGER_NAME`** — exported constant (`"dagstack.logger.internal"`)
  for the diagnostic channel per spec §7.4.

- **`autoInjectTraceContext` cross-binding parity flag (M2)** per logger-spec
  ADR-0001 v1.2 §3.4.2:

  ```typescript
  configure({
    autoInjectTraceContext: false, // skip ambient OTel context lookup
  });
  ```

  TypeScript default is `true` (idiomatic — matches `@opentelemetry/api`'s
  `context.active()` convention). Set to `false` for cross-binding parity
  with `go.dagstack.dev/logger`'s default explicit-ctx mode.

- **`Logger.reset()`** static method (M1) — clears the global registry to
  inherited defaults. For test isolation and hot-reload bootstrap loops.
  SAFETY: invalidates every logger handle held elsewhere; production code
  MUST NOT call it.

### Changed

- The default redaction-suffix set is now an opinionated 6-element subset
  of `config-spec/_meta/secret_patterns.yaml` (per spec §10.4). The list
  is frozen at v1.1 to preserve API stability.
- **`dagstack.logger.internal` defaults to its own `ConsoleSink({mode: "json", minSeverity: WARN})`**
  on first `Logger.get` (per spec §7.4) — diagnostic warnings (sink failures,
  configure-time disable-all, etc.) no longer silently merge with
  application sinks. Operators may opt in to merging with explicit
  `Logger.get(INTERNAL_LOGGER_NAME).setSinks(...)`.

### Documentation

- **`Logger.setMinSeverity` / `setSinks` / `setResource` JSDoc** (M1) now
  warns explicitly that the method mutates the _shared_ per-logger registry
  node — every concurrent caller observes the change. Cross-references
  `withSinks` / `scopeSinks` / `child` for non-shared scoping.
- **`Sink.flush(timeoutMs)` JSDoc** (M4) clarifies that the parameter is a
  Phase 1 hint accepted for forward compatibility but **not enforced**;
  Phase 2 `OTLPSink` MUST honour the deadline. Cross-references spec §7.1.
- **`FileSink` JSDoc** (M5) adds an explicit symlink-follow caveat —
  `filePath` is opened verbatim; hosts MUST treat the value as trusted and
  never accept it from end-user input or a plugin manifest.

### Fixed

- **`InMemorySink.id` collision** (S9) — multiple `InMemorySink` instances
  created in the same process now get distinct ids (per-instance counter
  suffix) instead of all sharing `"in-memory"`. This unblocks
  `setSinks([a, b])` configurations where the registry deduplicates by id.
- **Canonical JSON conformance — UTF-16 code-unit sort already correct
  (S3)**. TypeScript's native `Object.keys().sort()` is UTF-16 code-unit
  ordered per ECMA-262, which matches RFC 8785 §3.2.3. Added regression
  tests to lock the conformance contract for cross-binding wire-byte
  parity (Python and Go bindings ship custom sort helpers in 0.2.0).

### Cross-binding parity

This release brings `@dagstack/logger` to parity with `go.dagstack.dev/logger`
0.2.0 and `dagstack-logger` 0.2.0 across all M-/S-level architect review
findings. Conformance fixtures `redaction_extra_suffixes.json` and
`trace_context_propagation.json` from logger-spec v1.2 are exercised by the
test suite.

## [0.1.1] — 2026-05-03

Architect-review patch — security findings on `0.1.0`:

### Fixed

- **`redactAttributes` now recurses into `list[dict]`** (`src/redaction.ts`). Previously a secret key buried inside a list-of-objects (`{ events: [{ api_key: "..." }] }`) escaped masking — privacy hole for structured payloads typical of webhook bodies and audit trails. Lists of primitives stay untouched. The whole-array-under-secret-key case (`{ api_key: ["a", "b"] }`) keeps the existing behaviour: the entire value is masked.
- **`FileSink` JSDoc warning** — `filePath` is opened verbatim (no path-traversal validation). Host MUST treat as trusted and never accept from end-user input or plugin manifest.

### Linguist (also applied)

- `whitelist` / `whitelisted` → `default allowed-keys` in JSDoc and README — modern publish-grade terminology.

Both findings tracked in [`logger-spec` epic](https://git.goldix.org/dagstack/logger-spec/issues/2) (S8 + M5).

## [0.1.0] — 2026-04-26

First Phase 1 MVP release. Covers logger-spec ADR-0001 v1.0:

- §1 OTel Log Data Model wire format (dagstack JSON-lines).
- §2 Severity model (1-24 numbers, 6 canonical text values).
- §3 Logger API + hierarchy + W3C Trace Context propagation.
- §4 Resource and InstrumentationScope.
- §6 Scoped sink overrides (`withSinks` / `appendSinks` / `withoutSinks` / `scopeSinks`).
- §7.1–§7.2 Sink contract + Phase 1 sinks (`ConsoleSink`, `FileSink`, `InMemorySink`).
- §9 Config bootstrap via `configure(...)`.
- §10 Default attribute redaction (suffix-based, recursive on nested maps).

### Added

- **Skeleton** — `package.json` (ESM-only, `@dagstack/logger`), `tsconfig`, vitest, eslint flat, Makefile, Gitea CI/mirror/publish workflows.
- **Core primitives** — `LogRecord` / `InstrumentationScope` / `Resource` interfaces; `Severity` enum + the six canonical `severity_text` strings; `trace_id` / `span_id` hex helpers; canonical JSON serializer (RFC 8785 subset); dagstack JSON-lines emitter.
- **Sinks** — `Sink` interface plus `ConsoleSink` (auto / json / pretty modes with TTY auto-detect and ANSI colours), `FileSink` (size-based rotation with keep-count), `InMemorySink` (ring-buffer for tests).
- **Logger API** — `Logger.get(name, version)` with dot-hierarchy and sink / level / resource inheritance; severity methods; `child(attrs)` for bound attributes; `withSinks` / `appendSinks` / `withoutSinks` / `scopeSinks` for scoped overrides; mandatory OTel context propagation (trace / span / baggage auto-injection); sink failure isolation.
- **Redaction** — suffix-based masking (`*_key`, `*_secret`, `*_token`, `*_password`, `*_passphrase`, `*_credentials`) applied recursively to nested maps.
- **Configuration bootstrap** — `configure({rootLevel, sinks, perLoggerLevels, resourceAttributes})` — no hard dependency on `@dagstack/config`; the application passes the dumped config section as a plain object.
- **Subscription** — a `Subscription` handle that is inactive in Phase 1 and emits a warning to `dagstack.logger.internal` (via `console.warn`).

### Metadata

- **Peer dependency**: `@opentelemetry/api ^1.9.0` (mandatory per spec §3.4 for context propagation).
- Node 20 / 22, TypeScript strict + `exactOptionalPropertyTypes`.

[Unreleased]: https://github.com/dagstack/logger-typescript/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dagstack/logger-typescript/releases/tag/v0.2.0
[0.1.1]: https://github.com/dagstack/logger-typescript/releases/tag/v0.1.1
[0.1.0]: https://github.com/dagstack/logger-typescript/releases/tag/v0.1.0
