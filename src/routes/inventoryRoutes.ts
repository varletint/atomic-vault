import { Router } from "express";
import { InventoryController } from "../controllers/InventoryController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  adjustStockSchema,
  stockQuantitySchema,
} from "../schemas/inventorySchemas.js";

const router = Router();

router.get("/:productId", InventoryController.getByProductId);

router.patch(
  "/:productId/adjust",
  authMiddleware,
  validate(adjustStockSchema),
  InventoryController.adjustStock
);
router.patch(
  "/:productId/reserve",
  authMiddleware,
  validate(stockQuantitySchema),
  InventoryController.reserveStock
);
router.patch(
  "/:productId/release",
  authMiddleware,
  validate(stockQuantitySchema),
  InventoryController.releaseReservation
);
router.patch(
  "/:productId/commit",
  authMiddleware,
  validate(stockQuantitySchema),
  InventoryController.commitReservation
);

export default router;
