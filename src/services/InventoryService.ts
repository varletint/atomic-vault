import mongoose from "mongoose";
import { Inventory, type IInventory, Product } from "../models/index.js";
import { NotFoundError, ValidationError, FsmError } from "../utils/AppError.js";

type InventoryState = "AVAILABLE" | "RESERVED" | "COMMITTED" | "INSUFFICIENT";

const ALLOWED_TRANSITIONS: Record<InventoryState, InventoryState[]> = {
  AVAILABLE: ["RESERVED", "INSUFFICIENT"],
  RESERVED: ["AVAILABLE", "COMMITTED", "INSUFFICIENT"],
  COMMITTED: [],
  INSUFFICIENT: ["AVAILABLE"],
};

function assertValidTransition(
  current: InventoryState,
  next: InventoryState,
): void {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw FsmError(current, next, allowed);
  }
}

function getInventoryState(inventory: IInventory): InventoryState {
  const available = inventory.stock - inventory.reserved;
  if (available <= 0) return "INSUFFICIENT";
  if (inventory.reserved > 0) return "RESERVED";
  return "AVAILABLE";
}

export class InventoryService {
  private static async ensureActiveProduct(productId: string): Promise<void> {
    const product = await Product.findById(productId)
      .select("_id isActive")
      .lean<{ _id: unknown; isActive: boolean } | null>();
    if (!product) throw NotFoundError("Product");
    if (!product.isActive) {
      throw ValidationError(
        "Cannot modify inventory for an inactive product. Reactivate it first.",
      );
    }
  }

  static async getByProductId(productId: string): Promise<IInventory> {
    const inventory = await Inventory.findOne({
      product: productId,
    }).lean<IInventory>();
    if (!inventory) throw NotFoundError("Inventory");
    return inventory;
  }

  static async adjustStock(
    productId: string,
    quantity: number,
  ): Promise<IInventory> {
    await InventoryService.ensureActiveProduct(productId);

    const inventory = await Inventory.findOne({ product: productId });
    if (!inventory) throw NotFoundError("Inventory");

    const newStock = inventory.stock + quantity;
    if (newStock < 0) {
      throw ValidationError(
        `Insufficient stock. Available: ${inventory.stock}, requested reduction: ${Math.abs(quantity)}.`,
      );
    }

    inventory.stock = newStock;
    await inventory.save();
    return inventory.toObject() as IInventory;
  }

  static async reserveStock(
    productId: string,
    quantity: number,
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        session,
      );
      if (!inventory) throw NotFoundError("Inventory");

      const currentState = getInventoryState(inventory);
      const available = inventory.stock - inventory.reserved;

      if (quantity > available) {
        assertValidTransition(currentState, "INSUFFICIENT");
        throw ValidationError(
          `Insufficient available stock. Available: ${available}, requested: ${quantity}.`,
        );
      }

      assertValidTransition(currentState, "RESERVED");

      inventory.reserved += quantity;
      await inventory.save({ session });

      await session.commitTransaction();
      return inventory.toObject() as IInventory;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async releaseReservation(
    productId: string,
    quantity: number,
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        session,
      );
      if (!inventory) throw NotFoundError("Inventory");

      const currentState = getInventoryState(inventory);

      if (quantity > inventory.reserved) {
        throw ValidationError(
          `Cannot release more than reserved. Reserved: ${inventory.reserved}, requested: ${quantity}.`,
        );
      }

      assertValidTransition(currentState, "AVAILABLE");

      inventory.reserved -= quantity;
      await inventory.save({ session });

      await session.commitTransaction();
      return inventory.toObject() as IInventory;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async commitReservation(
    productId: string,
    quantity: number,
  ): Promise<IInventory> {
    if (quantity <= 0)
      throw ValidationError("Quantity must be greater than zero.");

    await InventoryService.ensureActiveProduct(productId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const inventory = await Inventory.findOne({ product: productId }).session(
        session,
      );
      if (!inventory) throw NotFoundError("Inventory");

      const currentState = getInventoryState(inventory);

      if (quantity > inventory.reserved) {
        throw ValidationError(
          `Cannot commit more than reserved. Reserved: ${inventory.reserved}, requested: ${quantity}.`,
        );
      }

      if (quantity > inventory.stock) {
        assertValidTransition(currentState, "INSUFFICIENT");
        throw ValidationError(
          `Cannot commit more than total stock. Stock: ${inventory.stock}, requested: ${quantity}.`,
        );
      }

      assertValidTransition(currentState, "COMMITTED");

      inventory.reserved -= quantity;
      inventory.stock -= quantity;
      await inventory.save({ session });

      await session.commitTransaction();
      return inventory.toObject() as IInventory;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}
