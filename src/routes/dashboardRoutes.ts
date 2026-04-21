import { Router } from "express";
import { DashboardController } from "../controllers/DashboardController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";

const router = Router();

router.get(
  "/stats",
  authMiddleware,
  requireRole("ADMIN"),
  DashboardController.getStats
);

export default router;
