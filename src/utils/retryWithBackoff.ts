import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: number;
  name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyJitter(delayMs: number, jitter: number): number {
  const spread = delayMs * jitter;
  return delayMs + (Math.random() * 2 - 1) * spread;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    baseMs = 1000,
    maxMs = 30_000,
    jitter = 0.2,
    name = "retryWithBackoff",
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries) break;

      const rawDelay = Math.min(baseMs * 2 ** attempt, maxMs);
      const delay = Math.max(0, applyJitter(rawDelay, jitter));

      logger.warn(
        `[${name}] Attempt ${attempt + 1}/${maxRetries + 1} failed. ` +
          `Retrying in ${Math.round(delay)}ms. Error: ${String(err)}`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}
