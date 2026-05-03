// Sink implementations for @dagstack/logger.
//
// Public re-exports:
//     import { Sink, ConsoleSink, FileSink, InMemorySink } from "@dagstack/logger";
//
// See spec ADR-0001 §7 (sink contract + adapter roadmap). Phase 1 ships
// three sinks: console (JSON / pretty dev-mode), file (size-based rotation),
// in-memory (ring buffer, tests).

export type { FlushResult, Sink } from "./base.js";
export { ConsoleSink, asConsoleStream } from "./console.js";
export type { ConsoleMode, ConsoleSinkOptions, ConsoleStream } from "./console.js";
export { FileSink } from "./file.js";
export type { FileSinkOptions } from "./file.js";
export { InMemorySink } from "./in-memory.js";
export type { InMemorySinkOptions } from "./in-memory.js";
