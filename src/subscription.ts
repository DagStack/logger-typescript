// Subscription handle for logger runtime-reconfigure callbacks.
//
// Per spec §7.2: `Subscription { unsubscribe, active, inactive_reason, path }`.
// In Phase 1 `active=false` — watch-based reload is not implemented.
// The top-level `configure()` replaces state wholesale; the subscription API
// is a placeholder for Phase 2 file-watcher / admin-API reload.
//
// Diagnostic channel — the named logger `dagstack.logger.internal` (§7.4).
// In Phase 1 we route the warning through `console.warn` to avoid the
// chicken-and-egg problem of the logger warning about itself through itself.

export interface SubscriptionInit {
  readonly path: string;
  readonly active: boolean;
  readonly inactiveReason?: string;
  readonly unsubscribe?: () => void;
}

/**
 * Handle returned by `Logger.onReconfigure(...)` (Phase 2+).
 *
 * In Phase 1 subscriptions are always `active=false` and emit a warning to
 * `dagstack.logger.internal`. Placeholder API for forward compatibility.
 */
export class Subscription {
  public readonly path: string;
  public readonly active: boolean;
  public readonly inactiveReason: string | undefined;
  private readonly unsubscribeImpl: () => void;
  private unsubscribed = false;

  constructor(init: SubscriptionInit) {
    this.path = init.path;
    this.active = init.active;
    this.inactiveReason = init.inactiveReason;
    this.unsubscribeImpl = init.unsubscribe ?? noop;
  }

  unsubscribe(): void {
    if (this.unsubscribed) return;
    this.unsubscribed = true;
    this.unsubscribeImpl();
  }

  toString(): string {
    return `Subscription(path=${JSON.stringify(this.path)}, active=${String(this.active)}, inactiveReason=${JSON.stringify(this.inactiveReason ?? null)})`;
  }
}

function noop(): void {
  // Default unsubscribe for inactive subscriptions.
}

/** Warn on `dagstack.logger.internal` about a subscription without watch support. */
export function emitInactiveSubscriptionWarning(path: string): void {
  console.warn(
    `[dagstack.logger.internal] subscription_without_watch: path=${JSON.stringify(path)} — callback will never fire (Phase 1 logger does not support watch-based reconfiguration)`,
  );
}
