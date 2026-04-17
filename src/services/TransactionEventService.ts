import type mongoose from "mongoose";
import {
  TransactionEvent,
  type TransactionStatus,
  type ITransactionActorRef,
} from "../models/index.js";

export class TransactionEventService {
  static async record(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    previousStatus: TransactionStatus;
    newStatus: TransactionStatus;
    reason: string;
    actor: ITransactionActorRef;
    source: string;
    traceId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const {
      session,
      transactionId,
      previousStatus,
      newStatus,
      reason,
      actor,
      source,
      traceId,
      metadata,
    } = params;

    await TransactionEvent.create(
      [
        {
          transactionId,
          previousStatus,
          newStatus,
          reason,
          actor,
          source,
          traceId,
          metadata,
        },
      ],
      { session }
    );
  }
}

