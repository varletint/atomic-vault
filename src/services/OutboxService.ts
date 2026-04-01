import mongoose from "mongoose";
import { OutboxEvent, type OutboxEventType } from "../models/index.js";

export class OutboxService {
  static async enqueue(
    params: {
      type: OutboxEventType;
      dedupeKey: string;
      payload: Record<string, unknown>;
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
      // Dedupe: if we already queued this event, we treat it as success.
      // Mongo duplicate key error codes: 11000
      const e = err as { code?: number };
      if (e?.code === 11000) return;
      throw err;
    }
  }
}

