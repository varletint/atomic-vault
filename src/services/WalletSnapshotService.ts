import mongoose from "mongoose";
import {
  Wallet,
  LedgerEntry,
  WalletSnapshot,
  type IWallet,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

export class WalletSnapshotService {
  static async takeSnapshot(walletId: string): Promise<void> {
    const wallet = await Wallet.findById(walletId).lean<IWallet>();
    if (!wallet) throw new Error(`Wallet ${walletId} not found.`);

    const lastEntry = await LedgerEntry.findOne({
      walletId: wallet._id,
    })
      .sort({ createdAt: -1 })
      .select("_id")
      .lean();

    const entryCount = await LedgerEntry.countDocuments({
      walletId: wallet._id,
    });

    const now = new Date();

    try {
      await WalletSnapshot.create({
        walletId: wallet._id,
        asOf: now,
        available: wallet.available,
        pending: wallet.pending,
        currency: wallet.currency,
        ledgerHead: lastEntry?._id ?? undefined,
        entryCount,
      });
    } catch (err) {
      const e = err as { code?: number };
      if (e?.code === 11000) {
        return;
      }
      throw err;
    }
  }

  static async takeAllSnapshots(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
  }> {
    const wallets = await Wallet.find({ status: "ACTIVE" })
      .select("_id")
      .lean();

    let succeeded = 0;
    let failed = 0;

    for (const wallet of wallets) {
      try {
        await this.takeSnapshot(wallet._id.toString());
        succeeded++;
      } catch (err) {
        failed++;
        logger.error("Snapshot failed for wallet", {
          walletId: wallet._id.toString(),
          error: String(err),
        });
      }
    }

    return { total: wallets.length, succeeded, failed };
  }

  static async getLatestSnapshot(walletId: string) {
    return WalletSnapshot.findOne({ walletId }).sort({ asOf: -1 }).lean();
  }

  static async getBalanceAsOf(
    walletId: string,
    asOf: Date
  ): Promise<{ available: number; pending: number }> {
    const walletOid = new mongoose.Types.ObjectId(walletId);

    const snapshot = await WalletSnapshot.findOne({
      walletId: walletOid,
      asOf: { $lte: asOf },
    })
      .sort({ asOf: -1 })
      .lean();

    let available = snapshot?.available ?? 0;
    let pending = snapshot?.pending ?? 0;

    const filter: Record<string, unknown> = {
      walletId: walletOid,
      createdAt: { $lte: asOf },
    };

    if (snapshot?.ledgerHead) {
      filter._id = { $gt: snapshot.ledgerHead };
    }

    const entries = await LedgerEntry.find(filter)
      .sort({ createdAt: 1 })
      .lean();

    for (const entry of entries) {
      const delta = entry.direction === "CREDIT" ? entry.amount : -entry.amount;
      if (entry.account === "WALLET_AVAILABLE") {
        available += delta;
      } else if (entry.account === "WALLET_PENDING") {
        pending += delta;
      }
    }

    return { available, pending };
  }

  static async pruneSnapshots(keepPerWallet = 30): Promise<number> {
    const wallets = await Wallet.find().select("_id").lean();
    let totalDeleted = 0;

    for (const wallet of wallets) {
      const snapshots = await WalletSnapshot.find({
        walletId: wallet._id,
      })
        .sort({ asOf: -1 })
        .skip(keepPerWallet)
        .select("_id")
        .lean();

      if (snapshots.length > 0) {
        const ids = snapshots.map((s) => s._id);
        const result = await WalletSnapshot.deleteMany({
          _id: { $in: ids },
        });
        totalDeleted += result.deletedCount;
      }
    }

    return totalDeleted;
  }
}
