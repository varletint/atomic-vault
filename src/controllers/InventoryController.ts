import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { InventoryService } from "../services/InventoryService.js";
import { ValidationError } from "../utils/AppError.js";

export class InventoryController {
  static getByProductId = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const inventory = await InventoryService.getByProductId(productId);
    res.status(200).json({ success: true, data: inventory });
  });

  static adjustStock = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const { quantity } = req.body as { quantity: number };

    if (quantity === undefined || quantity === 0) {
      throw ValidationError("Quantity is required and cannot be zero.");
    }

    const inventory = await InventoryService.adjustStock(productId, quantity);
    res
      .status(200)
      .json({ success: true, message: "Stock adjusted.", data: inventory });
  });

  static reserveStock = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const { quantity } = req.body as { quantity: number };

    if (!quantity) throw ValidationError("Quantity is required.");

    const inventory = await InventoryService.reserveStock(productId, quantity);
    res
      .status(200)
      .json({ success: true, message: "Stock reserved.", data: inventory });
  });

  static releaseReservation = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };
      const { quantity } = req.body as { quantity: number };

      if (!quantity) throw ValidationError("Quantity is required.");

      const inventory = await InventoryService.releaseReservation(
        productId,
        quantity,
      );
      res
        .status(200)
        .json({
          success: true,
          message: "Reservation released.",
          data: inventory,
        });
    },
  );

  static commitReservation = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };
      const { quantity } = req.body as { quantity: number };

      if (!quantity) throw ValidationError("Quantity is required.");

      const inventory = await InventoryService.commitReservation(
        productId,
        quantity,
      );
      res
        .status(200)
        .json({
          success: true,
          message: "Reservation committed.",
          data: inventory,
        });
    },
  );
}
