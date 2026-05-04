import { describe, expect, it, vi } from "vitest";

import { emitInactiveSubscriptionWarning, Subscription } from "../src/subscription.js";

describe("Subscription", () => {
  it("active=false carries the inactive reason", () => {
    const sub = new Subscription({ path: "x", active: false, inactiveReason: "noop" });
    expect(sub.active).toBe(false);
    expect(sub.inactiveReason).toBe("noop");
  });

  it("unsubscribe calls the impl exactly once (idempotent)", () => {
    const calls: string[] = [];
    const sub = new Subscription({
      path: "x",
      active: true,
      unsubscribe: () => calls.push("x"),
    });
    sub.unsubscribe();
    sub.unsubscribe();
    expect(calls).toEqual(["x"]);
  });

  it("toString is human-readable", () => {
    const sub = new Subscription({
      path: "logger:root",
      active: false,
      inactiveReason: "foo",
    });
    const s = sub.toString();
    expect(s).toContain("logger:root");
    expect(s).toContain("false");
  });
});

describe("emitInactiveSubscriptionWarning", () => {
  it("logs to console.warn on the dagstack.logger.internal channel", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress
    });
    try {
      emitInactiveSubscriptionWarning("logger:dagstack.rag");
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.join(" ")).toContain("subscription_without_watch");
      expect(messages.join(" ")).toContain("logger:dagstack.rag");
      expect(messages.join(" ")).toContain("dagstack.logger.internal");
    } finally {
      spy.mockRestore();
    }
  });
});
