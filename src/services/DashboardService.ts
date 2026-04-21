import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { Product, Inventory } from "../models/index.js";

interface DailyBucket {
  date: string;
  value: number;
}

interface CardStats {
  total: number;
  daily: number[];
  change: number;
  trend: "up" | "down";
}

export interface DashboardStats {
  revenue: {
    totalRevenue: CardStats;
    avgOrderValue: CardStats;
    totalProfit: CardStats;
  };
  orders: {
    totalOrders: CardStats;
    fulfilled: CardStats;
    cancelled: CardStats;
  };
  customers: {
    totalCustomers: CardStats;
    newCustomers: CardStats;
    activeCustomers: CardStats;
  };
  products: {
    totalProducts: CardStats;
    unitsSold: CardStats;
    inventoryValue: CardStats;
  };
}

function computeChange(
  current: number,
  previous: number
): { change: number; trend: "up" | "down" } {
  if (previous === 0) return { change: current > 0 ? 100 : 0, trend: "up" };
  const pct = ((current - previous) / previous) * 100;
  return {
    change: Math.abs(Math.round(pct * 10) / 10),
    trend: pct >= 0 ? "up" : "down",
  };
}

function fillDailyBuckets(buckets: DailyBucket[], days: string[]): number[] {
  const map = new Map(buckets.map((b) => [b.date, b.value]));
  return days.map((d) => map.get(d) ?? 0);
}

function getDayRange(daysBack: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export class DashboardService {
  static async getStats(): Promise<DashboardStats> {
    const currentDays = getDayRange(10);
    const prevDays = getDayRange(20).slice(0, 10);

    const currentStart = new Date(currentDays[0]);
    const prevStart = new Date(prevDays[0]);
    const now = new Date();

    const completedStatuses = ["CONFIRMED", "SHIPPED", "DELIVERED"];

    // ── Revenue & Orders aggregation ──
    const orderAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: prevStart, $lte: now } } },
      {
        $project: {
          day: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalAmount: 1,
          status: 1,
          items: 1,
        },
      },
      {
        $group: {
          _id: "$day",
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
          fulfilled: {
            $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const orderBuckets = orderAgg.map(
      (b: {
        _id: string;
        revenue: number;
        count: number;
        fulfilled: number;
        cancelled: number;
      }) => ({
        date: b._id,
        revenue: b.revenue,
        count: b.count,
        fulfilled: b.fulfilled,
        cancelled: b.cancelled,
      })
    );

    const bucketMap = new Map(orderBuckets.map((b) => [b.date, b]));

    const revCurrent = currentDays.map((d) => bucketMap.get(d)?.revenue ?? 0);
    const revPrev = prevDays.map((d) => bucketMap.get(d)?.revenue ?? 0);
    const ordCurrent = currentDays.map((d) => bucketMap.get(d)?.count ?? 0);
    const ordPrev = prevDays.map((d) => bucketMap.get(d)?.count ?? 0);
    const fulCurrent = currentDays.map((d) => bucketMap.get(d)?.fulfilled ?? 0);
    const fulPrev = prevDays.map((d) => bucketMap.get(d)?.fulfilled ?? 0);
    const canCurrent = currentDays.map((d) => bucketMap.get(d)?.cancelled ?? 0);
    const canPrev = prevDays.map((d) => bucketMap.get(d)?.cancelled ?? 0);

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    const totalRevCurrent = sum(revCurrent);
    const totalRevPrev = sum(revPrev);
    const totalOrdCurrent = sum(ordCurrent);
    const totalOrdPrev = sum(ordPrev);
    const avgOrdCurrent =
      totalOrdCurrent > 0 ? Math.round(totalRevCurrent / totalOrdCurrent) : 0;
    const avgOrdPrev =
      totalOrdPrev > 0 ? Math.round(totalRevPrev / totalOrdPrev) : 0;

    // ── Product sales (units sold + profit) ──
    const salesAgg = await Order.aggregate([
      {
        $match: {
          status: { $in: completedStatuses },
          createdAt: { $gte: prevStart, $lte: now },
        },
      },
      { $unwind: "$items" },
      {
        $project: {
          day: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          quantity: "$items.quantity",
          subtotal: "$items.subtotal",
        },
      },
      {
        $group: {
          _id: "$day",
          unitsSold: { $sum: "$quantity" },
          revenue: { $sum: "$subtotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const salesMap = new Map(
      salesAgg.map((b: { _id: string; unitsSold: number; revenue: number }) => [
        b._id,
        b,
      ])
    );
    const unitsCurrent = currentDays.map(
      (d) => salesMap.get(d)?.unitsSold ?? 0
    );
    const unitsPrev = prevDays.map((d) => salesMap.get(d)?.unitsSold ?? 0);
    const profitCurrent = currentDays.map((d) => salesMap.get(d)?.revenue ?? 0);
    const profitPrev = prevDays.map((d) => salesMap.get(d)?.revenue ?? 0);

    // ── Customers ──
    const customerAgg = await User.aggregate([
      { $match: { createdAt: { $gte: prevStart, $lte: now } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const custBuckets: DailyBucket[] = customerAgg.map(
      (b: { _id: string; count: number }) => ({
        date: b._id,
        value: b.count,
      })
    );
    const newCustCurrent = fillDailyBuckets(custBuckets, currentDays);
    const newCustPrev = fillDailyBuckets(custBuckets, prevDays);

    const totalCustomers = await User.countDocuments({ role: "CUSTOMER" });
    const activeCustomers = await Order.distinct("user", {
      status: { $in: completedStatuses },
    }).then((ids) => ids.length);

    const prevActiveCustomers = await Order.distinct("user", {
      status: { $in: completedStatuses },
      createdAt: { $gte: prevStart, $lt: currentStart },
    }).then((ids) => ids.length);

    // ── Products ──
    const totalProducts = await Product.countDocuments({ isActive: true });

    // Inventory value
    const invAgg = await Inventory.aggregate([
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: { $multiply: ["$stock", 1] },
          },
          totalStock: { $sum: "$stock" },
        },
      },
    ]);

    // Get product prices for inventory value calculation
    const allInventory = await Inventory.find({})
      .populate("product", "price")
      .lean();
    let inventoryValue = 0;
    for (const inv of allInventory) {
      const product = inv.product as unknown as { price?: number };
      if (product?.price) {
        const available = (inv.stock ?? 0) - (inv.reserved ?? 0);
        inventoryValue += available * product.price;
      }
    }

    // Build response
    const revChange = computeChange(totalRevCurrent, totalRevPrev);
    const aovChange = computeChange(avgOrdCurrent, avgOrdPrev);
    const profitChange = computeChange(sum(profitCurrent), sum(profitPrev));
    const ordChange = computeChange(totalOrdCurrent, totalOrdPrev);
    const fulChange = computeChange(sum(fulCurrent), sum(fulPrev));
    const canChange = computeChange(sum(canCurrent), sum(canPrev));
    const newCustChange = computeChange(sum(newCustCurrent), sum(newCustPrev));

    return {
      revenue: {
        totalRevenue: {
          total: totalRevCurrent,
          daily: revCurrent,
          ...revChange,
        },
        avgOrderValue: {
          total: avgOrdCurrent,
          daily: ordCurrent.map((c, i) =>
            c > 0 ? Math.round(revCurrent[i] / c) : 0
          ),
          ...aovChange,
        },
        totalProfit: {
          total: sum(profitCurrent),
          daily: profitCurrent,
          ...profitChange,
        },
      },
      orders: {
        totalOrders: {
          total: totalOrdCurrent,
          daily: ordCurrent,
          ...ordChange,
        },
        fulfilled: {
          total: sum(fulCurrent),
          daily: fulCurrent,
          ...fulChange,
        },
        cancelled: {
          total: sum(canCurrent),
          daily: canCurrent,
          ...canChange,
        },
      },
      customers: {
        totalCustomers: {
          total: totalCustomers,
          daily: newCustCurrent.map(
            (_, i) => totalCustomers - sum(newCustCurrent.slice(i + 1))
          ),
          change: 0,
          trend: "up",
        },
        newCustomers: {
          total: sum(newCustCurrent),
          daily: newCustCurrent,
          ...newCustChange,
        },
        activeCustomers: {
          total: activeCustomers,
          daily: newCustCurrent, // approximation
          ...computeChange(activeCustomers, prevActiveCustomers),
        },
      },
      products: {
        totalProducts: {
          total: totalProducts,
          daily: Array(10).fill(totalProducts),
          change: 0,
          trend: "up",
        },
        unitsSold: {
          total: sum(unitsCurrent),
          daily: unitsCurrent,
          ...computeChange(sum(unitsCurrent), sum(unitsPrev)),
        },
        inventoryValue: {
          total: inventoryValue,
          daily: Array(10).fill(inventoryValue),
          change: 0,
          trend: "up",
        },
      },
    };
  }
}
