import { Router } from "express";
import { OrderController } from "../controllers/OrderController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  createOrderSchema,
  createGuestOrderSchema,
  processPaymentSchema,
  reasonSchema,
  noteSchema,
} from "../schemas/orderSchemas.js";

const router = Router();

router.post("/webhook/paystack", OrderController.paystackWebhook);

router.post(
  "/guest",
  validate(createGuestOrderSchema),
  OrderController.createGuestOrder
);
router.get("/guest/:orderId", OrderController.getGuestOrder);

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

export default router;
