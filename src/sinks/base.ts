// Sink interface + contract per spec §7.1.
//
// Phase 1 sinks use synchronous writes (console / file / in-memory are local
// I/O; the non-blocking caller-side property is guaranteed by OS buffering).
// Phase 2 OTLPSink will add true async with batching plus an internal queue —
// at that point the spec §7.1 non-blocking emit contract becomes materially
// relevant.

import type { LogRecord } from "../records.js";

/**
 * Outcome of a `flush(timeoutMs)` operation. Currently a placeholder — Phase
 * 1 sinks return `{ ok: true }` synchronously since there is nothing to drain.
 * Phase 2 OTLPSink will populate `failedSinks` when batches fail to deliver.
 */
export interface FlushResult {
  readonly ok: boolean;
  readonly partial?: boolean;
  readonly failedSinks?: readonly { readonly sinkId: string; readonly error: string }[];
}

/**
 * Sink contract per spec §7.1.
 *
 * Implementations MUST expose:
 * - `id`: URI-style identifier for diagnostics
 *   (e.g., `"console:dev"`, `"file:/var/log/app.jsonl"`).
 * - `emit(record)`: non-blocking (Phase 1 — synchronous local I/O; Phase 2
 *   — batch worker).
 * - `flush(timeoutMs)`: best-effort drain of the internal buffer. Returns
 *   a Promise resolving to a `FlushResult`. Phase 1 sinks are synchronous,
 *   so `timeoutMs` is accepted for forward compatibility but **not
 *   enforced** — Phase 2 (OTLPSink) MUST honour the deadline and reject
 *   with a TimeoutError when the drain cannot complete in time.
 * - `close()`: flush + release resources (file handles, sockets). Idempotent.
 * - `supportsSeverity(n)`: optional filter hint — the sink may reject
 *   before buffering (early drop).
 */
export interface Sink {
  readonly id: string;
  /** Deliver a record. Phase 1: synchronous local I/O; Phase 2: enqueue for a worker. */
  emit(record: LogRecord): void;
  /**
   * Block until buffered records are delivered, or the timeout fires.
   * Phase 1: synchronous, `timeoutMs` accepted but not enforced.
   * Phase 2: MUST reject with a TimeoutError when the deadline elapses.
   */
  flush(timeoutMs?: number): Promise<FlushResult>;
  /** Flush + release resources. Idempotent. */
  close(): Promise<void>;
  /** Early-drop hint: return false if the sink will not emit this level. */
  supportsSeverity(severityNumber: number): boolean;
}
