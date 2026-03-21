import { Router } from "express";
import { OrderController } from "../controllers/OrderController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/webhook/paystack", OrderController.paystackWebhook);

router.post("/guest", OrderController.createGuestOrder);
router.get("/guest/:orderId", OrderController.getGuestOrder);

router.use(authMiddleware);

router.post("/", OrderController.createOrder);
router.get("/", OrderController.getUserOrders);
router.get("/:orderId", OrderController.getOrderById);

router.patch("/:orderId/confirm", OrderController.confirmOrder);
router.patch("/:orderId/ship", OrderController.shipOrder);
router.patch("/:orderId/deliver", OrderController.deliverOrder);
router.patch("/:orderId/cancel", OrderController.cancelOrder);
router.patch("/:orderId/fail", OrderController.failOrder);
router.post("/:orderId/payment", OrderController.processPayment);
router.get(
  "/:orderId/payment/verify/:reference",
  OrderController.verifyPayment
);

export default router;
