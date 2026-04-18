import mongoose from "mongoose";
import { Wallet, LedgerEntry, type IWallet } from "../models/index.js";

const STORE_OWNER_ID = new mongoose.Types.ObjectId("000000000000000000000001");

export class WalletService {
  static async getStoreWallet(
    currency = "NGN",
    session?: mongoose.ClientSession
  ): Promise<IWallet> {
    const filter = {
      ownerType: "STORE" as const,
      ownerId: STORE_OWNER_ID,
      currency: currency.toUpperCase(),
    };

    const existing = session
      ? await Wallet.findOne(filter).session(session)
      : await Wallet.findOne(filter);
    if (existing) return existing;

    const createOpts: mongoose.CreateOptions = session ? { session } : {};
    const [created] = await Wallet.create(
      [
        {
          ...filter,
          available: 0,
          pending: 0,
          status: "ACTIVE" as const,
        },
      ],
      createOpts
    );
    if (!created) throw new Error("Failed to create store wallet.");
    return created;
  }

  /** Lightweight summary: wallet balances + last posting date for this wallet. */
  static async getWalletSummary(walletId: string): Promise<{
    wallet: IWallet;
    lastPostedAt: Date | null;
  }> {
    const wallet = await Wallet.findById(walletId).lean<IWallet>();
    if (!wallet) throw new Error("Wallet not found.");

    const lastEntry = await LedgerEntry.findOne({ walletId: wallet._id })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    return {
      wallet,
      lastPostedAt: lastEntry?.createdAt ?? null,
    };
  }
}
