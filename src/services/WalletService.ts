import mongoose from "mongoose";
import { Wallet, type IWallet } from "../models/index.js";

const STORE_OWNER_ID = new mongoose.Types.ObjectId("000000000000000000000001");

export class WalletService {
  /**
   * Returns the well-known store wallet for the given currency,
   * creating it on first access.
   *
   * When called with a session the lookup + create runs inside that
   * transaction (used by LedgerService). Without a session it runs
   * as a normal query (used by the bootstrap endpoint).
   */
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

  /** Lightweight summary: wallet balances + metadata. */
  static async getWalletSummary(walletId: string): Promise<{
    wallet: IWallet;
    lastPostedAt: Date | null;
  }> {
    const wallet = await Wallet.findById(walletId).lean<IWallet>();
    if (!wallet) throw new Error("Wallet not found.");

    const { Transaction } = await import("../models/index.js");
    const lastPosted = await Transaction.findOne({ postedAt: { $ne: null } })
      .sort({ postedAt: -1 })
      .select("postedAt")
      .lean();

    return {
      wallet,
      lastPostedAt: lastPosted?.postedAt ?? null,
    };
  }
}
