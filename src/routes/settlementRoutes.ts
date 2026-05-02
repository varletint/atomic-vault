import { Router } from "express";
import { SettlementController } from "../controllers/SettlementController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  requireRole("ADMIN"),
  SettlementController.list
);

router.get(
  "/:settlementId",
  authMiddleware,
  requireRole("ADMIN"),
  SettlementController.getById
);

export default router;
