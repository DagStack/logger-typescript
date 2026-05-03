import { describe, expect, it } from "vitest";

import {
  hexToSpanId,
  hexToTraceId,
  otelSpanIdToBytes,
  otelTraceIdToBytes,
  spanIdToHex,
  traceIdToHex,
} from "../src/trace-ids.js";

const KNOWN_TRACE_HEX = "0af7651916cd43dd8448eb211c80319c";
const KNOWN_SPAN_HEX = "b7ad6b7169203331";

function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe("traceIdToHex", () => {
  it("encodes 16 bytes to 32 lowercase hex chars", () => {
    const bytes = bytesFromHex(KNOWN_TRACE_HEX);
    expect(traceIdToHex(bytes)).toBe(KNOWN_TRACE_HEX);
  });

  it("encodes all-zero bytes", () => {
    expect(traceIdToHex(new Uint8Array(16))).toBe("00000000000000000000000000000000");
  });

  it("returns undefined when traceId is undefined", () => {
    expect(traceIdToHex(undefined)).toBeUndefined();
  });

  it("rejects wrong length", () => {
    expect(() => traceIdToHex(new Uint8Array(8))).toThrow(/16 bytes/);
  });

  it("round-trips through hexToTraceId", () => {
    const original = new Uint8Array(16);
    for (let i = 0; i < 16; i++) original[i] = i;
    const hex = traceIdToHex(original);
    expect(hex).toBeDefined();
    const back = hexToTraceId(hex);
    expect(back).toEqual(original);
  });
});

describe("spanIdToHex", () => {
  it("encodes 8 bytes to 16 lowercase hex chars", () => {
    const bytes = bytesFromHex(KNOWN_SPAN_HEX);
    expect(spanIdToHex(bytes)).toBe(KNOWN_SPAN_HEX);
  });

  it("returns undefined when spanId is undefined", () => {
    expect(spanIdToHex(undefined)).toBeUndefined();
  });

  it("rejects wrong length", () => {
    expect(() => spanIdToHex(new Uint8Array(16))).toThrow(/8 bytes/);
  });

  it("round-trips through hexToSpanId", () => {
    const original = new Uint8Array(8);
    for (let i = 0; i < 8; i++) original[i] = i;
    const hex = spanIdToHex(original);
    expect(hex).toBeDefined();
    expect(hexToSpanId(hex)).toEqual(original);
  });
});

describe("hexToTraceId", () => {
  it("decodes a valid 32-char hex string", () => {
    const result = hexToTraceId(KNOWN_TRACE_HEX);
    expect(result).toEqual(bytesFromHex(KNOWN_TRACE_HEX));
  });

  it("passes undefined through", () => {
    expect(hexToTraceId(undefined)).toBeUndefined();
  });

  it("rejects wrong length", () => {
    expect(() => hexToTraceId("deadbeef")).toThrow(/32 chars/);
  });

  it("rejects non-hex characters", () => {
    expect(() => hexToTraceId("g".repeat(32))).toThrow(/invalid chars/);
  });
});

describe("hexToSpanId", () => {
  it("decodes a valid 16-char hex string", () => {
    expect(hexToSpanId("0123456789abcdef")).toEqual(bytesFromHex("0123456789abcdef"));
  });

  it("passes undefined through", () => {
    expect(hexToSpanId(undefined)).toBeUndefined();
  });

  it("rejects wrong length", () => {
    expect(() => hexToSpanId("dead")).toThrow(/16 chars/);
  });

  it("rejects non-hex characters", () => {
    expect(() => hexToSpanId("z".repeat(16))).toThrow(/invalid chars/);
  });
});

describe("otelTraceIdToBytes / otelSpanIdToBytes", () => {
  it("returns undefined for empty / all-zero strings", () => {
    expect(otelTraceIdToBytes("")).toBeUndefined();
    expect(otelTraceIdToBytes("0".repeat(32))).toBeUndefined();
    expect(otelSpanIdToBytes("")).toBeUndefined();
    expect(otelSpanIdToBytes("0".repeat(16))).toBeUndefined();
  });

  it("decodes a real OTel id", () => {
    expect(otelTraceIdToBytes(KNOWN_TRACE_HEX)).toEqual(bytesFromHex(KNOWN_TRACE_HEX));
    expect(otelSpanIdToBytes(KNOWN_SPAN_HEX)).toEqual(bytesFromHex(KNOWN_SPAN_HEX));
  });
});
