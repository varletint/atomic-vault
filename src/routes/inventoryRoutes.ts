import { Router } from "express";
import { InventoryController } from "../controllers/InventoryController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/:productId", InventoryController.getByProductId);

router.patch(
  "/:productId/adjust",
  authMiddleware,
  InventoryController.adjustStock,
);
router.patch(
  "/:productId/reserve",
  authMiddleware,
  InventoryController.reserveStock,
);
router.patch(
  "/:productId/release",
  authMiddleware,
  InventoryController.releaseReservation,
);
router.patch(
  "/:productId/commit",
  authMiddleware,
  InventoryController.commitReservation,
);

export default router;
