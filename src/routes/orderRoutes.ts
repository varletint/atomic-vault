import { Router } from "express";
import { OrderController } from "../controllers/OrderController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  createOrderSchema,
  createGuestOrderSchema,
  processPaymentSchema,
  reasonSchema,
  noteSchema,
  addTrackingEventSchema,
} from "../schemas/orderSchemas.js";

const router = Router();

router.post(
  "/guest",
  validate(createGuestOrderSchema),
  OrderController.createGuestOrder
);
router.get("/guest/:orderId", OrderController.getGuestOrder);

/* ── Admin-only routes ── */
router.get(
  "/admin",
  authMiddleware,
  requireRole("ADMIN"),
  OrderController.getAllOrders
);

router.patch(
  "/:orderId/status",
  authMiddleware,
  requireRole("ADMIN"),
  OrderController.updateOrderStatus
);

router.use(authMiddleware);

router.post("/", validate(createOrderSchema), OrderController.createOrder);
router.get("/", OrderController.getUserOrders);
router.get("/:orderId", OrderController.getOrderById);

router.patch("/:orderId/confirm", OrderController.confirmOrder);
router.patch("/:orderId/ship", validate(noteSchema), OrderController.shipOrder);
router.patch("/:orderId/deliver", OrderController.deliverOrder);
router.patch(
  "/:orderId/cancel",
  validate(reasonSchema),
  OrderController.cancelOrder
);
router.patch(
  "/:orderId/fail",
  validate(reasonSchema),
  OrderController.failOrder
);
router.post(
  "/:orderId/payment",
  validate(processPaymentSchema),
  OrderController.processPayment
);
router.get(
  "/:orderId/payment/verify/:reference",
  OrderController.verifyPayment
);

router.get("/:orderId/tracking", OrderController.getTrackingEvents);
router.post(
  "/:orderId/tracking",
  requireRole("ADMIN"),
  validate(addTrackingEventSchema),
  OrderController.addTrackingEvent
);

export default router;
