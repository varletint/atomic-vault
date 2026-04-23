import mongoose, { type ClientSession } from "mongoose";
import {
  Inventory,
  type IInventory,
  type IStockMovement,
  Product,
  StockMovement,
  type StockMovementType,
} from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { OutboxService } from "./OutboxService.js";

export class InventoryService {
  private static async ensureActiveProduct(
    productId: string,
    session?: ClientSession | null
  ): Promise<void> {
    const product = session
      ? await Product.findById(productId)
          .select("_id isActive")
          .session(session)
          .lean<{ _id: unknown; isActive: boolean } | null>()
      : await Product.findById(productId)
          .select("_id isActive")
          .lean<{ _id: unknown; isActive: boolean } | null>();
    if (!product) throw NotFoundError("Product");
    if (!product.isActive) {
      throw ValidationError(
        "Cannot modify inventory for an inactive product. Reactivate it first."
      );
    }
  }

  private static async recordMovement(
    inventory: IInventory,
    type: StockMovementType,
    quantity: number,
    direction: 1 | -1,
    session?: ClientSession | null,
    reference?: { orderId?: string; reason?: string },
    performedBy?: string
  ): Promise<void> {
    const doc = {
      product: inventory.product,
      variant: inventory.variant ?? undefined,
      type,
      quantity,
      direction,
      balanceAfter: inventory.stock,
      reservedAfter: inventory.reserved,
      ...(performedBy && {
        performedBy: new mongoose.Types.ObjectId(performedBy),
      }),
      ...(reference && {
        reference: {
          ...(reference.orderId && {
            orderId: new mongoose.Types.ObjectId(reference.orderId),
          }),
          ...(reference.reason && { reason: reference.reason }),
        },
      }),
    };

    if (session) {
      await StockMovement.create([doc], { session });
    } else {
      await StockMovement.create(doc);
    }
  }

  private static async checkLowStock(
    inventory: IInventory,
    productId: string
  ): Promise<void> {
    const available = inventory.stock - inventory.reserved;
    if (available <= inventory.lowStockThreshold) {
      await OutboxService.enqueue({
        type: "INVENTORY_LOW_STOCK",
        dedupeKey: `inventory:${productId}:low:${inventory.stock}`,
        payload: {
          productId,
          stock: inventory.stock,
          reserved: inventory.reserved,
          available,
          threshold: inventory.lowStockThreshold,
        },
      });
    }
  }

  static async getByProductId(productId: string): Promise<IInventory> {
    const inventory = await Inventory.findOne({
      product: productId,
    }).lean<IInventory>();
    if (!inventory) throw NotFoundError("Inventory");
    return inventory;
  }

  static async getMovements(
    productId: string,
    page = 1,
    limit = 50
  ): Promise<{
    movements: IStockMovement[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [movements, total] = await Promise.all([
      StockMovement.find({ product: productId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StockMovement.countDocuments({ product: productId }),
    ]);

    return {
      movements,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async adjustStock(
    productId: string,
    quantity: number,
    reason?: string,
    performedBy?: string
  ): Promise<IInventory> {
    await InventoryService.ensureActiveProduct(productId);

    const inventory = await Inventory.findOne({ product: productId });
    if (!inventory) throw NotFoundError("Inventory");

    const newStock = inventory.stock + quantity;
    if (newStock < 0) {
      throw ValidationError(
        `Insufficient stock. Available: ${
          inventory.stock
        }, requested reduction: ${Math.abs(quantity)}.`
      );
    }

    inventory.stock = newStock;
    await inventory.save();

    const movementType: StockMovementType =
      quantity > 0 ? "INBOUND" : "OUTBOUND";
    await InventoryService.recordMovement(
      inventory,
      movementType,
      Math.abs(quantity),
      quantity > 0 ? 1 : -1,
      null,
      {
        reason:
          reason ?? `Manual adjustment: ${quantity > 0 ? "+" : ""}${quantity}`,
      },
      performedBy
    );

    await InventoryService.checkLowStock(inventory, productId);

    return inventory.toObject() as IInventory;
  }

  static async reserveStock(
    productId: string,
    quantity: number,
    session?: ClientSession | null,
    performedBy?: string
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId, session);

    const ownSession = !session;
    const sess = session ?? (await mongoose.startSession());
    if (ownSession) {
      sess.startTransaction();
    }

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        sess
      );
      if (!inventory) throw NotFoundError("Inventory");

      const available = inventory.stock - inventory.reserved;

      if (quantity > available) {
        throw ValidationError(
          `Insufficient available stock. Available: ${available}, requested: ${quantity}.`
        );
      }

      inventory.reserved += quantity;
      await inventory.save({ session: sess });

      await InventoryService.recordMovement(
        inventory,
        "RESERVE",
        quantity,
        -1,
        sess,
        undefined,
        performedBy
      );

      if (ownSession) {
        await sess.commitTransaction();
      }
      return inventory.toObject() as IInventory;
    } catch (error) {
      if (ownSession) {
        await sess.abortTransaction();
      }
      throw error;
    } finally {
      if (ownSession) {
        sess.endSession();
      }
    }
  }

  static async releaseReservation(
    productId: string,
    quantity: number,
    session?: ClientSession | null,
    performedBy?: string
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId, session);

    const ownSession = !session;
    const sess = session ?? (await mongoose.startSession());
    if (ownSession) {
      sess.startTransaction();
    }

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        sess
      );
      if (!inventory) throw NotFoundError("Inventory");

      if (quantity > inventory.reserved) {
        throw ValidationError(
          `Cannot release more than reserved. Reserved: ${inventory.reserved}, requested: ${quantity}.`
        );
      }

      inventory.reserved -= quantity;
      await inventory.save({ session: sess });

      await InventoryService.recordMovement(
        inventory,
        "RELEASE",
        quantity,
        1,
        sess,
        undefined,
        performedBy
      );

      if (ownSession) {
        await sess.commitTransaction();
      }
      return inventory.toObject() as IInventory;
    } catch (error) {
      if (ownSession) {
        await sess.abortTransaction();
      }
      throw error;
    } finally {
      if (ownSession) {
        sess.endSession();
      }
    }
  }

  static async commitReservation(
    productId: string,
    quantity: number,
    session?: ClientSession | null,
    performedBy?: string
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId, session);

    const ownSession = !session;
    const sess = session ?? (await mongoose.startSession());
    if (ownSession) {
      sess.startTransaction();
    }

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        sess
      );
      if (!inventory) throw NotFoundError("Inventory");

      if (quantity > inventory.reserved) {
        throw ValidationError(
          `Cannot commit more than reserved. Reserved: ${inventory.reserved}, requested: ${quantity}.`
        );
      }

      if (quantity > inventory.stock) {
        throw ValidationError(
          `Cannot commit more than total stock. Stock: ${inventory.stock}, requested: ${quantity}.`
        );
      }

      inventory.reserved -= quantity;
      inventory.stock -= quantity;
      await inventory.save({ session: sess });

      await InventoryService.recordMovement(
        inventory,
        "COMMIT",
        quantity,
        -1,
        sess,
        undefined,
        performedBy
      );

      if (ownSession) {
        await sess.commitTransaction();
      }

      await InventoryService.checkLowStock(inventory, productId);

      return inventory.toObject() as IInventory;
    } catch (error) {
      if (ownSession) {
        await sess.abortTransaction();
      }
      throw error;
    } finally {
      if (ownSession) {
        sess.endSession();
      }
    }
  }

  static async restoreCommittedStock(
    productId: string,
    quantity: number,
    session?: ClientSession | null,
    performedBy?: string
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId, session);

    const ownSession = !session;
    const sess = session ?? (await mongoose.startSession());
    if (ownSession) {
      sess.startTransaction();
    }

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        sess
      );
      if (!inventory) throw NotFoundError("Inventory");

      inventory.stock += quantity;
      await inventory.save({ session: sess });

      await InventoryService.recordMovement(
        inventory,
        "CANCELLATION_REVERSAL",
        quantity,
        1,
        sess,
        { reason: "Order cancelled – committed stock restored" },
        performedBy
      );

      if (ownSession) {
        await sess.commitTransaction();
      }

      return inventory.toObject() as IInventory;
    } catch (error) {
      if (ownSession) {
        await sess.abortTransaction();
      }
      throw error;
    } finally {
      if (ownSession) {
        sess.endSession();
      }
    }
  }
}
