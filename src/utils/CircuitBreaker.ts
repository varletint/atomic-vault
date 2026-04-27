import { logger } from "./logger.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  windowMs?: number;
  timeoutMs?: number;
  name?: string;
  isFailure?: (err: unknown) => boolean;
}

export interface CircuitBreakerMetrics {
  totalRequests: number;
  totalFailures: number;
  totalOpens: number;
  consecutiveFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number[] = [];
  private lastOpenedAt = 0;
  private halfOpenInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly windowMs: number;
  private readonly timeoutMs: number;
  private readonly name: string;
  private readonly failureClassifier: (err: unknown) => boolean;

  private readonly _metrics: CircuitBreakerMetrics = {
    totalRequests: 0,
    totalFailures: 0,
    totalOpens: 0,
    consecutiveFailures: 0,
  };

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.windowMs = opts.windowMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.name = opts.name ?? "CircuitBreaker";
    this.failureClassifier = opts.isFailure ?? (() => true);
  }

  get currentState(): CircuitState {
    return this.state;
  }

  get metrics(): Readonly<CircuitBreakerMetrics> {
    return this._metrics;
  }

  async exec<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T> | T
  ): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastOpenedAt >= this.resetTimeoutMs) {
        this.transition("HALF_OPEN");
      } else {
        if (fallback) return fallback();
        throw new Error(
          `[${this.name}] Circuit is OPEN — failing fast. Retry after ${this.resetTimeoutMs}ms.`
        );
      }
    }

    if (this.state === "HALF_OPEN") {
      if (this.halfOpenInFlight) {
        if (fallback) return fallback();
        throw new Error(
          `[${this.name}] Circuit is HALF_OPEN — probe already in progress.`
        );
      }
      this.halfOpenInFlight = true;
    }

    this._metrics.totalRequests++;

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      if (this.failureClassifier(err)) {
        this.onFailure();
      }
      throw err;
    } finally {
      if (this.state === "HALF_OPEN" || this.halfOpenInFlight) {
        this.halfOpenInFlight = false;
      }
    }
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`[${this.name}] Timeout after ${this.timeoutMs}ms`)),
        this.timeoutMs
      );

      fn().then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private onSuccess(): void {
    this._metrics.consecutiveFailures = 0;
    if (this.state === "HALF_OPEN") {
      this.transition("CLOSED");
    }
  }

  private onFailure(): void {
    this._metrics.totalFailures++;
    this._metrics.consecutiveFailures++;

    if (this.state === "HALF_OPEN") {
      this.transition("OPEN");
      return;
    }

    const now = Date.now();
    this.failures.push(now);

    const cutoff = now - this.windowMs;
    this.failures = this.failures.filter((t) => t > cutoff);

    if (this.failures.length >= this.failureThreshold) {
      this.transition("OPEN");
    }
  }

  private transition(next: CircuitState): void {
    const prev = this.state;
    this.state = next;

    if (next === "OPEN") {
      this.lastOpenedAt = Date.now();
      this.failures = [];
      this._metrics.totalOpens++;
    }
    if (next === "CLOSED") {
      this.failures = [];
    }

    logger.warn(`[${this.name}] Circuit transitioned: ${prev} → ${next}`);
  }
}
