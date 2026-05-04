// InMemorySink — ring-buffer LogRecord accumulator for tests and debugging.
//
// Per spec §7.2: Phase 1 MVP, a capacity-bounded ring. The oldest records are
// dropped automatically when capacity is exceeded.
//
// Usage in tests:
//     const sink = new InMemorySink({ capacity: 100 });
//     const logger = Logger.get("test").withSinks([sink]);
//     logger.info("x");
//     expect(sink.records()[0].body).toBe("x");

import type { LogRecord } from "../records.js";
import type { FlushResult, Sink } from "./base.js";

export interface InMemorySinkOptions {
  /** Maximum number of records retained; oldest are dropped on overflow. */
  readonly capacity?: number;
  /** Early-drop threshold; records with severity_number below it are skipped. */
  readonly minSeverity?: number;
}

const DEFAULT_CAPACITY = 1000;

let instanceCounter = 0;

/**
 * Ring-buffer sink for assertions in tests. Stores `LogRecord` objects
 * directly; assertions read `record.body` / `record.attributes`.
 *
 * Not thread-safe across worker threads, which matches Node.js semantics
 * (the event loop serialises emit calls within a worker).
 */
export class InMemorySink implements Sink {
  public readonly id: string;
  public readonly capacity: number;
  private readonly records_: LogRecord[] = [];
  private readonly minSeverity: number;
  private closed = false;

  constructor(options: InMemorySinkOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.minSeverity = options.minSeverity ?? 1;
    // Per-instance suffix avoids ID collisions when several InMemorySinks
    // share the same capacity (common in tests).
    instanceCounter += 1;
    this.id = `in-memory:cap=${this.capacity.toString()}#${instanceCounter.toString()}`;
  }

  emit(record: LogRecord): void {
    if (this.closed) return;
    if (!this.supportsSeverity(record.severity_number)) return;
    this.records_.push(record);
    while (this.records_.length > this.capacity) {
      this.records_.shift();
    }
  }

  async flush(_timeoutMs?: number): Promise<FlushResult> {
    return Promise.resolve({ ok: true });
  }

  async close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  supportsSeverity(severityNumber: number): boolean {
    return severityNumber >= this.minSeverity;
  }

  /** Snapshot of captured records (copy). Not part of the Sink contract. */
  records(): LogRecord[] {
    return [...this.records_];
  }

  /** Drop all captured records — useful for test cleanup. */
  clear(): void {
    this.records_.length = 0;
  }
}
