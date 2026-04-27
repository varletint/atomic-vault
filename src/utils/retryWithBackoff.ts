import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: number;
  name?: string;
  retryable?: (err: unknown) => boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}

function applyJitter(delayMs: number, jitter: number): number {
  const spread = delayMs * jitter;
  return delayMs + (Math.random() * 2 - 1) * spread;
}

export async function retryWithBackoff<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
  signal?: AbortSignal
): Promise<T> {
  const {
    maxRetries = 5,
    baseMs = 1000,
    maxMs = 30_000,
    jitter = 0.2,
    name = "retryWithBackoff",
    retryable,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("Aborted");

    try {
      return await fn(signal);
    } catch (err) {
      lastError = err;

      if (retryable && !retryable(err)) {
        logger.warn(
          `[${name}] Attempt ${attempt + 1}/${
            maxRetries + 1
          } failed with non-retryable error. Error: ${String(err)}`
        );
        throw err;
      }

      if (attempt >= maxRetries) break;

      const rawDelay = Math.min(baseMs * 2 ** attempt, maxMs);
      const delay = Math.max(0, applyJitter(rawDelay, jitter));

      logger.warn(
        `[${name}] Attempt ${attempt + 1}/${maxRetries + 1} failed. ` +
          `Retrying in ${Math.round(delay)}ms. Error: ${String(err)}`
      );

      await sleep(delay, signal);
    }
  }

  throw lastError;
}
