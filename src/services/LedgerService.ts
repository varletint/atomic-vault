import mongoose from "mongoose";
import {
  LedgerEntry,
  Wallet,
  AuditLog,
  type ILedgerEntryAttrs,
  type LedgerAccount,
  type LedgerDirection,
  type LedgerEntryType,
  type ILedgerActorRef,
  Transaction,
} from "../models/index.js";
import { ValidationError } from "../utils/AppError.js";
import { WalletService } from "./WalletService.js";
import { OutboxService } from "./OutboxService.js";

export type JournalLine = {
  walletId: mongoose.Types.ObjectId;
  currency: string;
  account: LedgerAccount;
  direction: LedgerDirection;
  amount: number;
  entryType: LedgerEntryType;
  narration?: string;
  dedupeKey?: string;
};

type PostJournalParams = {
  session: mongoose.ClientSession;
  transactionId: mongoose.Types.ObjectId;
  lines: JournalLine[];
  actor: ILedgerActorRef;
  source: string;
  traceId: string;
};

function deltaFor(direction: LedgerDirection, amount: number): number {
  return direction === "CREDIT" ? amount : -amount;
}

async function emitOutboxEvents(params: {
  session: mongoose.ClientSession;
  transactionId: string;
  walletIds: Set<string>;
  outboxPayload: Record<string, unknown>;
}): Promise<void> {
  const { session, transactionId, walletIds, outboxPayload } = params;

  await OutboxService.enqueue(
    {
      type: "TRANSACTION_POSTED",
      dedupeKey: `tx:${transactionId}:posted`,
      payload: { transactionId, ...outboxPayload },
    },
    session
  );

  for (const wId of walletIds) {
    const freshWallet = await Wallet.findById(wId).session(session).lean();
    if (freshWallet) {
      await OutboxService.enqueue(
        {
          type: "WALLET_UPDATED",
          dedupeKey: `tx:${transactionId}:wallet:${wId}`,
          payload: {
            walletId: wId,
            currency: freshWallet.currency,
            available: freshWallet.available,
            pending: freshWallet.pending,
            triggerTransactionId: transactionId,
          },
        },
        session
      );
    }
  }
}

export class LedgerService {
  private static async postJournalLines(
    params: PostJournalParams
  ): Promise<Set<string>> {
    const { session, transactionId, lines, actor, source, traceId } = params;
    const affectedWalletIds = new Set<string>();

    let totalDebits = 0;
    let totalCredits = 0;

    for (const line of lines) {
      if (!Number.isInteger(line.amount) || line.amount <= 0) {
        throw ValidationError("Lines must have positive integer amounts.");
      }
      if (line.direction === "DEBIT") totalDebits += line.amount;
      else totalCredits += line.amount;
    }

    if (totalDebits !== totalCredits) {
      throw ValidationError(
        `Double-entry violated: debits (${totalDebits}) !== credits (${totalCredits}) for tx ${transactionId.toString()}`
      );
    }

    const postingId = new mongoose.Types.ObjectId();

    for (const line of lines) {
      const wallet = await Wallet.findById(line.walletId).session(session);
      if (!wallet) throw ValidationError("Wallet not found.");
      if (wallet.status === "FROZEN") {
        throw ValidationError("Wallet is frozen.");
      }
      if (wallet.currency !== line.currency) {
        throw ValidationError("Wallet currency mismatch.");
      }

      // Only impact Wallet document caching for these explicit accounts
      if (
        line.account === "WALLET_AVAILABLE" ||
        line.account === "WALLET_PENDING"
      ) {
        const delta = deltaFor(line.direction, line.amount);
        if (line.account === "WALLET_AVAILABLE") {
          const next = wallet.available + delta;
          if (next < 0)
            throw ValidationError("Insufficient available balance.");
          wallet.available = next;
        } else {
          const next = wallet.pending + delta;
          if (next < 0) throw ValidationError("Insufficient pending balance.");
          wallet.pending = next;
        }
        await wallet.save({ session });
      }

      const entry: ILedgerEntryAttrs & { _id: mongoose.Types.ObjectId } = {
        _id: new mongoose.Types.ObjectId(),
        postingId,
        transactionId,
        walletId: wallet._id,
        currency: line.currency,
        account: line.account,
        direction: line.direction,
        amount: line.amount,
        entryType: line.entryType,
        narration: line.narration,
        actor,
        source,
        traceId,
        dedupeKey: line.dedupeKey,
      };

      await LedgerEntry.create([entry], { session });
      affectedWalletIds.add(wallet._id.toString());
    }

    return affectedWalletIds;
  }

  /* ── High-level posting methods ── */

  /**
   * Posts an order payment journal to the STORE wallet:
   * - CREDIT PAYMENT for amountPaid
   * - DEBIT FEE for gatewayFee (if any)
   */
  static async postStoreOrderPayment(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    currency: string;
    amountPaid: number;
    gatewayFee?: number;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<void> {
    const {
      session,
      transactionId,
      currency,
      amountPaid,
      gatewayFee = 0,
      actor,
      source,
      traceId,
    } = params;

    if (!Number.isInteger(amountPaid) || amountPaid < 1) {
      throw ValidationError("amountPaid must be a positive integer (kobo).");
    }
    if (!Number.isInteger(gatewayFee) || gatewayFee < 0) {
      throw ValidationError(
        "gatewayFee must be a non-negative integer (kobo)."
      );
    }
    if (gatewayFee > amountPaid) {
      throw ValidationError("gatewayFee cannot exceed amountPaid.");
    }

    const tx = await Transaction.findById(transactionId).session(session);
    if (!tx) throw ValidationError("Transaction not found for ledger posting.");
    if (tx.postedAt) return;

    const storeWallet = await WalletService.getStoreWallet(currency, session);

    const lines: JournalLine[] = [
      {
        walletId: storeWallet._id,
        currency,
        account: "EXTERNAL_SETTLEMENT",
        direction: "DEBIT",
        amount: amountPaid,
        entryType: "PAYMENT",
        narration: "External gateway settlement leg",
        dedupeKey: `tx:${transactionId}:ext`,
      },
      {
        walletId: storeWallet._id,
        currency,
        account: "WALLET_AVAILABLE",
        direction: "CREDIT",
        amount: amountPaid,
        entryType: "PAYMENT",
        narration: "Order payment received",
        dedupeKey: `tx:${transactionId}:payment`,
      },
    ];
    if (gatewayFee > 0) {
      lines.push({
        walletId: storeWallet._id,
        currency,
        account: "WALLET_AVAILABLE",
        direction: "DEBIT",
        amount: gatewayFee,
        entryType: "FEE",
        narration: "Payment gateway fee deduction",
        dedupeKey: `tx:${transactionId}:fee`,
      });
      lines.push({
        walletId: storeWallet._id,
        currency,
        account: "FEES",
        direction: "CREDIT",
        amount: gatewayFee,
        entryType: "FEE",
        narration: "Payment gateway fee received",
        dedupeKey: `tx:${transactionId}:fee:credit`,
      });
    }

    const txObjectId = new mongoose.Types.ObjectId(transactionId);
    const affectedWallets = await this.postJournalLines({
      session,
      transactionId: txObjectId,
      lines,
      actor,
      source,
      traceId,
    });

    tx.postedAt = new Date();
    tx.gatewayFee = gatewayFee;
    await tx.save({ session });

    await emitOutboxEvents({
      session,
      transactionId,
      walletIds: affectedWallets,
      outboxPayload: {
        currency,
        amountPaid,
        gatewayFee,
        netAmount: amountPaid - gatewayFee,
        postedAt: tx.postedAt.toISOString(),
      },
    });
  }

  static async postReversalJournal(params: {
    session: mongoose.ClientSession;
    originalTransactionId: string;
    reason: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<{ reversalTransactionId: string }> {
    const { session, originalTransactionId, reason, actor, source, traceId } =
      params;

    const originalTx = await Transaction.findById(
      originalTransactionId
    ).session(session);
    if (!originalTx) {
      throw ValidationError("Original transaction not found.");
    }
    if (!originalTx.postedAt) {
      throw ValidationError(
        "Cannot reverse a transaction that has not been posted."
      );
    }
    if (originalTx.status === "REVERSED") {
      throw ValidationError("Transaction has already been refunded/reversed.");
    }

    const originalEntries = await LedgerEntry.find({
      transactionId: originalTx._id,
    })
      .session(session)
      .lean();
    if (originalEntries.length === 0) {
      throw ValidationError(
        "No ledger entries found for the original transaction."
      );
    }

    /* Create the REVERSAL transaction */
    const [reversalTx] = await Transaction.create(
      [
        {
          type: "REVERSAL" as const,
          order: originalTx.order,
          user: originalTx.user,
          amount: originalTx.amount,
          currency: originalTx.currency,
          status: "CONFIRMED" as const,
          paymentMethod: originalTx.paymentMethod,
          provider: originalTx.provider,
          providerRef: originalTx.providerRef,
          idempotencyKey: `reversal:${originalTransactionId}`,
          postedAt: new Date(),
          paidAt: new Date(),
          metadata: { originalTransactionId, reason },
        },
      ],
      { session }
    );
    if (!reversalTx) {
      throw ValidationError("Failed to create reversal transaction.");
    }

    /* Build opposite-direction journal lines */
    const reversalLines: JournalLine[] = originalEntries.map((entry) => ({
      walletId: entry.walletId,
      currency: entry.currency,
      account: entry.account as LedgerAccount,
      direction: (entry.direction === "CREDIT"
        ? "DEBIT"
        : "CREDIT") as LedgerDirection,
      amount: entry.amount,
      entryType: "REVERSAL" as LedgerEntryType,
      narration: `Reversal: ${entry.narration ?? entry.entryType}`,
      dedupeKey: `reversal:${originalTransactionId}:${entry._id.toString()}`,
    }));

    const affectedWallets = await this.postJournalLines({
      session,
      transactionId: reversalTx._id,
      lines: reversalLines,
      actor,
      source,
      traceId,
    });

    await AuditLog.create(
      [
        {
          action: "REVERSE_TRANSACTION",
          actor: {
            userId: new mongoose.Types.ObjectId(
              actor.type === "USER" ? actor.id : undefined
            ),
            isSystem: actor.type === "SYSTEM",
            role: actor.type,
          },
          entity: {
            type: "Transaction",
            id: reversalTx._id,
          },
          metadata: { originalTransactionId, reason },
          severity: "warning",
        },
      ],
      { session }
    );

    /* Mark original transaction as reversed */
    originalTx.status = "REVERSED";
    originalTx.reversedAt = new Date();
    await originalTx.save({ session });

    await emitOutboxEvents({
      session,
      transactionId: reversalTx._id.toString(),
      walletIds: affectedWallets,
      outboxPayload: {
        type: "REVERSAL",
        originalTransactionId,
        currency: reversalTx.currency,
        amount: reversalTx.amount,
        postedAt: reversalTx.postedAt!.toISOString(),
      },
    });

    return { reversalTransactionId: reversalTx._id.toString() };
  }

  /**
   * Posts a manual wallet adjustment (credit or debit).
   * Creates an ADJUSTMENT transaction and a single ledger entry.
   */
  static async postAdjustmentJournal(params: {
    session: mongoose.ClientSession;
    walletId: string;
    direction: "CREDIT" | "DEBIT";
    amount: number;
    currency: string;
    reason: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<{ adjustmentTransactionId: string }> {
    const {
      session,
      walletId,
      direction,
      amount,
      currency,
      reason,
      actor,
      source,
      traceId,
    } = params;

    if (!Number.isInteger(amount) || amount < 1) {
      throw ValidationError("Amount must be a positive integer (kobo).");
    }

    const wallet = await Wallet.findById(walletId).session(session);
    if (!wallet) throw ValidationError("Wallet not found.");
    if (wallet.status === "FROZEN") {
      throw ValidationError("Wallet is frozen.");
    }
    if (wallet.currency !== currency.toUpperCase()) {
      throw ValidationError("Currency mismatch.");
    }

    const idempotencyKey = `adjust:${walletId}:${Date.now()}:${traceId}`;
    const [adjustTx] = await Transaction.create(
      [
        {
          type: "ADJUSTMENT" as const,
          order: wallet._id,
          amount,
          currency: wallet.currency,
          status: "CONFIRMED" as const,
          paymentMethod: "WALLET" as const,
          provider: "internal",
          idempotencyKey,
          postedAt: new Date(),
          paidAt: new Date(),
          metadata: { reason, direction, walletId },
        },
      ],
      { session }
    );
    if (!adjustTx)
      throw ValidationError("Failed to create adjustment transaction.");

    const lines: JournalLine[] = [
      {
        walletId: wallet._id,
        currency: wallet.currency,
        account: "REVENUE",
        direction: direction === "CREDIT" ? "DEBIT" : "CREDIT",
        amount,
        entryType: "ADJUSTMENT",
        narration: `Counterparty admin adjustment: ${reason}`,
        dedupeKey: `adjust:${adjustTx._id.toString()}:counter`,
      },
      {
        walletId: wallet._id,
        currency: wallet.currency,
        account: "WALLET_AVAILABLE",
        direction,
        amount,
        entryType: "ADJUSTMENT",
        narration: `Admin adjustment: ${reason}`,
        dedupeKey: `adjust:${adjustTx._id.toString()}:wallet`,
      },
    ];

    const affectedWallets = await this.postJournalLines({
      session,
      transactionId: adjustTx._id,
      lines,
      actor,
      source,
      traceId,
    });

    await AuditLog.create(
      [
        {
          action: "ADJUST_WALLET",
          actor: {
            userId: new mongoose.Types.ObjectId(
              actor.type === "USER" ? actor.id : undefined
            ),
            isSystem: actor.type === "SYSTEM",
            role: actor.type,
          },
          entity: {
            type: "Wallet",
            id: wallet._id,
          },
          metadata: {
            amount,
            direction,
            reason,
            adjustTxId: adjustTx._id.toString(),
          },
          severity: "warning",
        },
      ],
      { session }
    );

    await emitOutboxEvents({
      session,
      transactionId: adjustTx._id.toString(),
      walletIds: affectedWallets,
      outboxPayload: {
        type: "ADJUSTMENT",
        direction,
        amount,
        currency: wallet.currency,
        postedAt: adjustTx.postedAt!.toISOString(),
      },
    });

    return { adjustmentTransactionId: adjustTx._id.toString() };
  }

  /* ── Withdrawal posting methods ── */

  /**
   * Reserve funds for withdrawal: DR WALLET_AVAILABLE / CR WALLET_PENDING.
   * Called synchronously during initiation (inside Mongo session).
   */
  static async postWithdrawalReserve(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    walletId: string;
    amount: number;
    currency: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<void> {
    const {
      session,
      transactionId,
      walletId,
      amount,
      currency,
      actor,
      source,
      traceId,
    } = params;

    if (!Number.isInteger(amount) || amount < 1) {
      throw ValidationError(
        "Withdrawal amount must be a positive integer (kobo)."
      );
    }

    const walletOid = new mongoose.Types.ObjectId(walletId);
    const txOid = new mongoose.Types.ObjectId(transactionId);

    const lines: JournalLine[] = [
      {
        walletId: walletOid,
        currency,
        account: "WALLET_AVAILABLE",
        direction: "DEBIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal reserve — funds locked",
        dedupeKey: `withdraw:${transactionId}:reserve:debit`,
      },
      {
        walletId: walletOid,
        currency,
        account: "WALLET_PENDING",
        direction: "CREDIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal reserve — funds pending",
        dedupeKey: `withdraw:${transactionId}:reserve:credit`,
      },
    ];

    await this.postJournalLines({
      session,
      transactionId: txOid,
      lines,
      actor,
      source,
      traceId,
    });
  }

  /**
   * Confirm withdrawal: DR WALLET_PENDING / CR EXTERNAL_SETTLEMENT.
   * Called when Paystack webhook confirms success.
   */
  static async postWithdrawalConfirm(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    walletId: string;
    amount: number;
    currency: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<void> {
    const {
      session,
      transactionId,
      walletId,
      amount,
      currency,
      actor,
      source,
      traceId,
    } = params;

    const walletOid = new mongoose.Types.ObjectId(walletId);
    const txOid = new mongoose.Types.ObjectId(transactionId);

    const lines: JournalLine[] = [
      {
        walletId: walletOid,
        currency,
        account: "WALLET_PENDING",
        direction: "DEBIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal confirmed — pending released",
        dedupeKey: `withdraw:${transactionId}:confirm:debit`,
      },
      {
        walletId: walletOid,
        currency,
        account: "EXTERNAL_SETTLEMENT",
        direction: "CREDIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal confirmed — settled externally",
        dedupeKey: `withdraw:${transactionId}:confirm:credit`,
      },
    ];

    await this.postJournalLines({
      session,
      transactionId: txOid,
      lines,
      actor,
      source,
      traceId,
    });
  }

  /**
   * Fail a withdrawal: DR WALLET_PENDING / CR WALLET_AVAILABLE.
   * Returns reserved funds back to available balance.
   */
  static async postWithdrawalFailure(params: {
    session: mongoose.ClientSession;
    transactionId: string;
    walletId: string;
    amount: number;
    currency: string;
    actor: ILedgerActorRef;
    source: string;
    traceId: string;
  }): Promise<void> {
    const {
      session,
      transactionId,
      walletId,
      amount,
      currency,
      actor,
      source,
      traceId,
    } = params;

    const walletOid = new mongoose.Types.ObjectId(walletId);
    const txOid = new mongoose.Types.ObjectId(transactionId);

    const lines: JournalLine[] = [
      {
        walletId: walletOid,
        currency,
        account: "WALLET_PENDING",
        direction: "DEBIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal failed — pending released",
        dedupeKey: `withdraw:${transactionId}:fail:debit`,
      },
      {
        walletId: walletOid,
        currency,
        account: "WALLET_AVAILABLE",
        direction: "CREDIT",
        amount,
        entryType: "TRANSFER",
        narration: "Withdrawal failed — funds returned",
        dedupeKey: `withdraw:${transactionId}:fail:credit`,
      },
    ];

    await this.postJournalLines({
      session,
      transactionId: txOid,
      lines,
      actor,
      source,
      traceId,
    });
  }
}
