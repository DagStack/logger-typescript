// FileSink — write JSON-lines into a local file with size-based rotation.
//
// Per spec §7.2: FileSink Phase 1 MVP. Synchronous writes via `fs.openSync` /
// `fs.writeSync` (the non-blocking caller-side property is delivered by the
// OS buffer / page cache; the spec's Phase 2 background-worker batching
// arrives with OTLPSink). The format is the canonical JSON-lines wire format
// (see `wire.toDagstackJsonl`).
//
// Rotation options:
//     maxBytes: rotate when the file size exceeds the limit (0 = disabled).
//     keep: number of archived files retained (path.1, path.2, ...).

import * as fs from "node:fs";
import * as path from "node:path";

import type { LogRecord } from "../records.js";
import { toDagstackJsonl } from "../wire.js";
import type { FlushResult, Sink } from "./base.js";

export interface FileSinkOptions {
  /** Rotate when the file size exceeds this many bytes. 0 disables rotation. */
  readonly maxBytes?: number;
  /** Number of archived rotation files retained (path.1, path.2, ...). */
  readonly keep?: number;
  /** Early-drop threshold; records with severity_number below it are skipped. */
  readonly minSeverity?: number;
}

/**
 * Append LogRecords to a local file as canonical JSON-lines, with optional
 * size-based rotation (path.1 / path.2 / ... up to `keep`).
 *
 * @remarks
 * The `filePath` argument is opened verbatim (no path-traversal validation),
 * and the open follows symlinks. The host MUST treat `filePath` as a
 * **trusted** configuration value — never accept it directly from end-user
 * input or a plugin manifest. If the application supports plugin-supplied
 * logging configuration, enforce an allow-list of writable directories at
 * the host layer, and consider symlink-resistant resolution (e.g.,
 * `realpath` + prefix check, or `fs.openSync(path, fs.constants.O_NOFOLLOW)`
 * where the platform supports it) upstream of the FileSink.
 */
export class FileSink implements Sink {
  public readonly id: string;
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly minSeverity: number;
  private fd: number | undefined;
  private currentBytes: number;
  private closed = false;

  constructor(filePath: string, options: FileSinkOptions = {}) {
    this.filePath = path.resolve(filePath);
    this.maxBytes = options.maxBytes ?? 0;
    this.keep = options.keep ?? 0;
    this.minSeverity = options.minSeverity ?? 1;
    this.id = `file:${this.filePath}`;
    // Eagerly open in append mode; create if missing.
    this.fd = fs.openSync(this.filePath, "a");
    try {
      const stat = fs.fstatSync(this.fd);
      this.currentBytes = stat.size;
    } catch {
      this.currentBytes = 0;
    }
  }

  emit(record: LogRecord): void {
    if (this.closed) return;
    if (this.fd === undefined) return;
    if (!this.supportsSeverity(record.severity_number)) return;
    const line = toDagstackJsonl(record) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");
    if (this.maxBytes > 0 && this.currentBytes + bytes > this.maxBytes) {
      this.rotate();
    }
    // After rotate() the fd may have been replaced; defensive re-check in
    // case openSync threw silently (rotate's `try/catch` swallows errors).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.fd === undefined) return;
    fs.writeSync(this.fd, line);
    this.currentBytes += bytes;
  }

  async flush(_timeoutMs?: number): Promise<FlushResult> {
    if (this.fd !== undefined && !this.closed) {
      try {
        fs.fsyncSync(this.fd);
      } catch {
        // fsync can fail on certain filesystems / pipes; the spec allows
        // best-effort here.
      }
    }
    return Promise.resolve({ ok: true });
  }

  async close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    if (this.fd !== undefined) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // already closed externally — ignore.
      }
      this.fd = undefined;
    }
    return Promise.resolve();
  }

  supportsSeverity(severityNumber: number): boolean {
    return severityNumber >= this.minSeverity;
  }

  // ─── Rotation ─────────────────────────────────────────────────────────────

  private rotate(): void {
    if (this.fd === undefined) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // ignore
    }
    this.fd = undefined;

    // Cascade old archives: path.(keep-1) → path.keep, ..., path.1 → path.2,
    // path → path.1.
    if (this.keep > 0) {
      // Drop the very oldest if it exists.
      const oldestArchivePath = `${this.filePath}.${this.keep.toString()}`;
      if (fs.existsSync(oldestArchivePath)) {
        try {
          fs.unlinkSync(oldestArchivePath);
        } catch {
          // ignore
        }
      }
      for (let i = this.keep - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i.toString()}`;
        const dst = `${this.filePath}.${(i + 1).toString()}`;
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst);
          } catch {
            // ignore
          }
        }
      }
      // Move the live file to path.1.
      if (fs.existsSync(this.filePath)) {
        try {
          fs.renameSync(this.filePath, `${this.filePath}.1`);
        } catch {
          // ignore
        }
      }
    } else {
      // No archives kept — truncate by removing the file.
      if (fs.existsSync(this.filePath)) {
        try {
          fs.unlinkSync(this.filePath);
        } catch {
          // ignore
        }
      }
    }
    // Reopen.
    this.fd = fs.openSync(this.filePath, "a");
    this.currentBytes = 0;
  }
}
