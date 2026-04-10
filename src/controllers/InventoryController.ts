import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { InventoryService } from "../services/InventoryService.js";
import type { z } from "zod";
import type {
  adjustStockSchema,
  stockQuantitySchema,
} from "../schemas/inventorySchemas.js";

export class InventoryController {
  static getByProductId = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const inventory = await InventoryService.getByProductId(productId);
    res.status(200).json({ success: true, data: inventory });
  });

  static getMovements = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const result = await InventoryService.getMovements(productId, page, limit);
    res.status(200).json({ success: true, data: result });
  });

  static adjustStock = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const { quantity } = req.body as z.infer<typeof adjustStockSchema>;

    const inventory = await InventoryService.adjustStock(
      productId,
      quantity,
      undefined,
      req.user?.userId
    );
    res
      .status(200)
      .json({ success: true, message: "Stock adjusted.", data: inventory });
  });

  static reserveStock = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const { quantity } = req.body as z.infer<typeof stockQuantitySchema>;

    const inventory = await InventoryService.reserveStock(
      productId,
      quantity,
      null,
      req.user?.userId
    );
    res
      .status(200)
      .json({ success: true, message: "Stock reserved.", data: inventory });
  });

  static releaseReservation = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };
      const { quantity } = req.body as z.infer<typeof stockQuantitySchema>;

      const inventory = await InventoryService.releaseReservation(
        productId,
        quantity,
        null,
        req.user?.userId
      );
      res.status(200).json({
        success: true,
        message: "Reservation released.",
        data: inventory,
      });
    }
  );

  static commitReservation = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };
      const { quantity } = req.body as z.infer<typeof stockQuantitySchema>;

      const inventory = await InventoryService.commitReservation(
        productId,
        quantity,
        null,
        req.user?.userId
      );
      res.status(200).json({
        success: true,
        message: "Reservation committed.",
        data: inventory,
      });
    }
  );
}
