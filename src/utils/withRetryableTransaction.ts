import mongoose, { type ClientSession, Error as MongooseError } from "mongoose";

/**
 * Executes a transaction with exponential backoff retry on transient errors
 * and version conflicts.
 */
export async function withRetryableTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error: unknown) {
      await session.abortTransaction();

      const isTransient =
        error instanceof Error &&
        "errorLabels" in error &&
        Array.isArray((error as { errorLabels?: string[] }).errorLabels) &&
        (error as { errorLabels: string[] }).errorLabels.includes(
          "TransientTransactionError"
        );

      // VersionError = optimistic concurrency conflict (another writer
      // committed a different __v between our read and our save).
      // Safe to retry — the next attempt reads the fresh document.
      const isVersionConflict = error instanceof MongooseError.VersionError;

      if ((isTransient || isVersionConflict) && attempt < maxRetries) {
        const backoff = 100 * 2 ** attempt; // 100ms, 200ms, 400ms …
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  throw new Error("withRetryableTransaction: exhausted retries");
}
