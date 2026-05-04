// Auto-tests for the TypeScript snippets in
// `dagstack-logger-docs/site/docs/concepts/redaction.mdx`.

import { beforeEach, describe, expect, it } from "vitest";

import { configure } from "../../src/configuration.js";
import { _resetRegistryForTests, Logger } from "../../src/logger.js";
import { InMemorySink } from "../../src/sinks/in-memory.js";

beforeEach(() => {
  _resetRegistryForTests();
});

// ── "Behaviour" — flat attributes with secret-suffix keys ─────────────

describe("concepts/redaction.mdx — Behaviour (TypeScript)", () => {
  it("snippet: api_key + session_token are masked, plain keys pass through", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });

    // --- snippet start (redaction / behaviour) -------------------------
    // import { Logger } from "@dagstack/logger";

    const logger = Logger.get("auth");

    logger.info("user authenticated", {
      "user.id": 42,
      api_key: "sk-very-secret-value", //   → "***"
      session_token: "ey...", //              → "***"
      "request.id": "req-abc",
    });
    // Emitted record:
    // attributes = {
    //   "user.id": 42,
    //   "api_key": "***",
    //   "session_token": "***",
    //   "request.id": "req-abc",
    // }
    // --- snippet end ---------------------------------------------------

    const rec = sink.records()[0];
    expect(rec?.attributes["user.id"]).toBe(42);
    expect(rec?.attributes.api_key).toBe("***");
    expect(rec?.attributes.session_token).toBe("***");
    expect(rec?.attributes["request.id"]).toBe("req-abc");
  });
});

// ── "Nested attributes" — recursion through nested maps ───────────────

describe("concepts/redaction.mdx — Nested attributes (TypeScript)", () => {
  it("snippet: nested client_secret deep inside config is masked", () => {
    const sink = new InMemorySink();
    configure({ rootLevel: "INFO", sinks: [sink] });
    const logger = Logger.get("auth");

    // --- snippet start (redaction / nested) ---------------------------
    logger.info("config snapshot", {
      config: {
        "service.name": "order-service",
        auth: {
          client_secret: "shh", //          → "***"
          redirect_url: "https://...",
        },
      },
    });
    // Result:
    // attributes = {
    //   config: {
    //     "service.name": "order-service",
    //     auth: {
    //       "client_secret": "***",
    //       "redirect_url": "https://...",
    //     },
    //   },
    // }
    // --- snippet end ---------------------------------------------------

    const rec = sink.records()[0];
    const config = rec?.attributes.config as Record<string, unknown> | undefined;
    expect(config).toBeDefined();
    expect(config!["service.name"]).toBe("order-service");
    const auth = config!.auth as Record<string, unknown>;
    expect(auth.client_secret).toBe("***");
    expect(auth.redirect_url).toBe("https://...");
  });
});
