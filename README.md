# @dagstack/logger

TypeScript / Node.js binding for [dagstack/logger-spec](https://github.com/dagstack/logger-spec) — OTel-compatible structured logging with mandatory W3C Trace Context propagation, scoped sink overrides, attribute redaction, and the dagstack JSON-lines wire format.

**Status: Phase 1 (`v0.2.0`).** Implements logger-spec ADR-0001 v1.2 §1 (Log Data Model wire format), §2 (severity model), §3 (Logger API + hierarchy + context propagation), §4 (resource / instrumentation scope), §6 (scoped overrides), §7.1–§7.2 (Sink contract + Phase 1 sinks), §9 (config bootstrap), §10 (redaction including the §10.4 `RedactionConfig` extension surface).

Phase 2+ — `OTLPSink`, `LokiSink`, `SentrySink`, processor chain, runtime reconfigure, self-metrics — tracked in `dagstack/logger-spec` ADR §7.2.

## Install

```bash
npm install @dagstack/logger @opentelemetry/api
```

`@opentelemetry/api` is a peer dependency — bring your own version (`>=1.9.0 <2.0`).

## Quick start

```typescript
import { Logger, ConsoleSink, configure } from "@dagstack/logger";

configure({
  rootLevel: "INFO",
  sinks: [new ConsoleSink({ mode: "auto" })],
  resourceAttributes: { "service.name": "my-app" },
});

const logger = Logger.get("my-app.api", "1.0.0");
logger.info("query received", { "user.id": 42 });

try {
  await doWork();
} catch (err) {
  logger.exception(err as Error, { "request.id": "req-abc" });
}
```

### Scoped sink overrides (tests / per-run audit)

```typescript
import { InMemorySink } from "@dagstack/logger";

const memory = new InMemorySink({ capacity: 100 });
await logger.scopeSinks([memory], async (scoped) => {
  scoped.info("captured only in scope");
});
// outside the callback — back to global sinks
```

### W3C Trace Context auto-injection

When called inside an active OTel span, `trace_id` / `span_id` / `trace_flags` are automatically attached to every emitted record:

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");
await tracer.startActiveSpan("query", async (span) => {
  logger.info("inside span"); // trace_id / span_id auto-injected
  span.end();
});
```

Baggage entries listed in the default allowed-keys list (`tenant.id`, `request.id`, `user.id`) are also auto-injected as attributes.

## API surface

- `Logger.get(name, version?)` — registry-cached named logger.
- `logger.{trace,debug,info,warn,error,fatal}(body, attrs?)` — primary severity methods.
- `logger.log(severityNumber, body, attrs?)` — emit at an arbitrary severity number (1-24).
- `logger.exception(err, options?)` — auto-populated `exception.type` / `exception.message` / `exception.stacktrace` per OTel semconv.
- `logger.child(attrs)` — child logger with bound attributes.
- `logger.withSinks(sinks)` / `appendSinks(sinks)` / `withoutSinks()` — detached child with replaced / extra / no sinks.
- `logger.scopeSinks(sinks, callback)` — Promise-friendly scope (the closest TypeScript idiom for the spec's `scopeSinks` context manager).
- `logger.flush(timeoutMs?)` / `logger.close()` — lifecycle.

Re-exported types: `LogRecord`, `InstrumentationScope`, `Resource`, `Severity`, `Sink`, `ConsoleSink`, `FileSink`, `InMemorySink`, `Subscription`.

## Local development

```bash
git clone git@github.com:dagstack/logger-typescript.git
cd logger-typescript
npm install

make test       # vitest run
make lint       # eslint .
make typecheck  # tsc --noEmit
make build      # tsc -p tsconfig.build.json
```

Requirements: Node.js ≥20, TypeScript ≥5.5.

## Cross-binding parity

The TypeScript binding follows the same Phase 1 surface as [`dagstack/logger-python`](https://github.com/dagstack/logger-python): the wire format (canonical JSON-lines) is byte-identical for the same `LogRecord` content, severity numbering / canonical text matches, and the Sink contract is preserved. Idiomatic differences are documented in the binding's ADR (forthcoming).

## Licensing

Apache-2.0 (see [LICENSE](./LICENSE)).

## Related

- [`dagstack/logger-spec`](https://github.com/dagstack/logger-spec) — language-agnostic specification.
- [`dagstack/logger-python`](https://github.com/dagstack/logger-python) — reference Python binding.
- [`dagstack/config-typescript`](https://github.com/dagstack/config-typescript) — sister TS binding (reused tooling pattern).
