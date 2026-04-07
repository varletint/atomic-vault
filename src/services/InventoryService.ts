import mongoose, { type ClientSession } from "mongoose";
import { Inventory, type IInventory, Product } from "../models/index.js";
import { NotFoundError, ValidationError, FsmError } from "../utils/AppError.js";

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

  static async getByProductId(productId: string): Promise<IInventory> {
    const inventory = await Inventory.findOne({
      product: productId,
    }).lean<IInventory>();
    if (!inventory) throw NotFoundError("Inventory");
    return inventory;
  }

  static async adjustStock(
    productId: string,
    quantity: number
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
    return inventory.toObject() as IInventory;
  }

  static async reserveStock(
    productId: string,
    quantity: number,
    session?: ClientSession | null
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
    session?: ClientSession | null
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
    session?: ClientSession | null
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
