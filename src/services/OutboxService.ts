import mongoose from "mongoose";
import {
  OutboxEvent,
  type OutboxEventType,
  type OutboxPayloadMap,
} from "../models/index.js";

export class OutboxService {
  static async enqueue<T extends OutboxEventType>(
    params: {
      type: T;
      dedupeKey: string;
      payload: OutboxPayloadMap[T];
      nextRunAt?: Date;
    },
    session?: mongoose.ClientSession
  ): Promise<void> {
    const doc = {
      type: params.type,
      dedupeKey: params.dedupeKey,
      payload: params.payload,
      status: "PENDING" as const,
      attempts: 0,
      nextRunAt: params.nextRunAt ?? new Date(),
    };

    try {
      await OutboxEvent.create([doc], session ? { session } : undefined);
    } catch (err) {
      const e = err as { code?: number };
      if (e?.code === 11000) return;
      throw err;
    }
  }
}
