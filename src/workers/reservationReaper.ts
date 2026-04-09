import "dotenv/config";
import mongoose from "mongoose";
import { connectToDatabase } from "../index.js";
import { Order, type OrderStatus } from "../models/index.js";
import { InventoryService } from "../services/InventoryService.js";

const RESERVATION_TTL_MS =
  Number(process.env.RESERVATION_TTL_MS) || 15 * 60_000;

async function main() {
  await connectToDatabase();

  const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);

  const staleOrders = await Order.find({
    status: "PENDING",
    createdAt: { $lte: cutoff },
  }).lean();

  if (staleOrders.length === 0) {
    console.log("[reaper] no stale reservations found");
    return;
  }

  console.log(`[reaper] found ${staleOrders.length} stale PENDING order(s)`);

  let released = 0;
  let failed = 0;

  for (const order of staleOrders) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const liveOrder = await Order.findById(order._id).session(session);
      if (!liveOrder || liveOrder.status !== "PENDING") {
        await session.abortTransaction();
        continue;
      }

      for (const item of liveOrder.items) {
        await InventoryService.releaseReservation(
          item.product.toString(),
          item.quantity,
          session
        );
      }

      liveOrder.status = "FAILED" as OrderStatus;
      liveOrder.statusHistory.push({
        status: "FAILED" as OrderStatus,
        timestamp: new Date(),
        note: "Reservation expired — auto-released by reaper",
      });

      await liveOrder.save({ session });
      await session.commitTransaction();
      released++;
    } catch (err) {
      await session.abortTransaction();
      console.error(`[reaper] failed to release order ${order._id}:`, err);
      failed++;
    } finally {
      session.endSession();
    }
  }

  console.log(
    `[reaper] done: released=${released} failed=${failed} total=${staleOrders.length}`
  );
}

main().catch((err) => {
  console.error("[reaper] fatal", err);
  process.exitCode = 1;
});
