import { Router } from "express";
import { RefundController } from "../controllers/RefundController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  approveRefundSchema,
  rejectRefundSchema,
  customerCancelSchema,
  refundListQuerySchema,
} from "../schemas/refundSchemas.js";

const router = Router();

/* ── Admin endpoints ── */

router.get(
  "/",
  authMiddleware,
  requireRole("ADMIN"),
  validate(refundListQuerySchema, "query"),
  RefundController.listRefunds
);

router.get(
  "/:id",
  authMiddleware,
  requireRole("ADMIN"),
  RefundController.getRefund
);

router.post(
  "/:id/approve",
  authMiddleware,
  requireRole("ADMIN"),
  validate(approveRefundSchema, "body"),
  RefundController.approveRefund
);

router.post(
  "/:id/reject",
  authMiddleware,
  requireRole("ADMIN"),
  validate(rejectRefundSchema, "body"),
  RefundController.rejectRefund
);

router.post(
  "/:id/requeue",
  authMiddleware,
  requireRole("ADMIN"),
  RefundController.requeueRefund
);

/* ── Customer endpoints ── */

router.get(
  "/order/:orderId",
  authMiddleware,
  RefundController.getOrderRefundStatus
);

router.post(
  "/order/:orderId/cancel",
  authMiddleware,
  validate(customerCancelSchema, "body"),
  RefundController.requestCancellation
);

export default router;
