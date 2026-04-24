import mongoose, { type ClientSession } from "mongoose";

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

      if (isTransient && attempt < maxRetries) {
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
