import { logger } from "./logger.js";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  windowMs?: number;
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number[] = [];
  private lastOpenedAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly windowMs: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.windowMs = opts.windowMs ?? 60_000;
    this.name = opts.name ?? "CircuitBreaker";
  }

  get currentState(): CircuitState {
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastOpenedAt >= this.resetTimeoutMs) {
        this.transition("HALF_OPEN");
      } else {
        throw new Error(
          `[${this.name}] Circuit is OPEN — failing fast. Retry after ${this.resetTimeoutMs}ms.`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.transition("CLOSED");
    }
  }

  private onFailure(): void {
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
    }
    if (next === "CLOSED") {
      this.failures = [];
    }

    logger.warn(`[${this.name}] Circuit transitioned: ${prev} → ${next}`);
  }
}
