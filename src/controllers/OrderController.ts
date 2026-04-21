import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { OrderService } from "../services/OrderService.js";
import { ValidationError } from "../utils/AppError.js";
import { parsePaystackWebhook } from "../payments/webhook.js";
import type { z } from "zod";
import type {
  createOrderSchema,
  createGuestOrderSchema,
  processPaymentSchema,
  reasonSchema,
  noteSchema,
  addTrackingEventSchema,
  adminOrderQuerySchema,
  guestOrderQuerySchema,
} from "../schemas/orderSchemas.js";

export class OrderController {
  static createGuestOrder = asyncHandler(
    async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof createGuestOrderSchema>;

      const guestParams: Parameters<typeof OrderService.createGuestOrder>[0] = {
        idempotencyKey: body.idempotencyKey,
        shippingAddress: body.shippingAddress,
        guestContact: body.guestContact,
        items: body.items,
      };
      if (body.deliveryFee !== undefined)
        guestParams.deliveryFee = body.deliveryFee;

      const order = await OrderService.createGuestOrder(guestParams);

      res.status(201).json({
        success: true,
        message:
          "Guest order created. Pay with an instant method (card, USSD, transfer, or wallet).",
        data: order,
      });
    }
  );

  static getGuestOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { email } = req.query as unknown as z.infer<
      typeof guestOrderQuerySchema
    >;

    const order = await OrderService.getGuestOrderById(orderId, email);
    res.status(200).json({ success: true, data: order });
  });

  static createOrder = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const { idempotencyKey, shippingAddress } = req.body as z.infer<
      typeof createOrderSchema
    >;

    const order = await OrderService.createOrder(
      userId,
      idempotencyKey,
      shippingAddress
    );
    res
      .status(201)
      .json({ success: true, message: "Order created.", data: order });
  });

  static getOrderById = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const order = await OrderService.getOrderById(orderId);
    res.status(200).json({ success: true, data: order });
  });

  static getUserOrders = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20)
    );

    const result = await OrderService.getUserOrders(userId, page, limit);
    res.status(200).json({ success: true, data: result });
  });

  static getAllOrders = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, status, search, userId } =
      req.query as unknown as z.infer<typeof adminOrderQuerySchema>;

    const result = await OrderService.getAllOrders(
      page,
      limit,
      status,
      search,
      userId
    );
    res.status(200).json({ success: true, data: result });
  });

  static updateOrderStatus = asyncHandler(
    async (req: Request, res: Response) => {
      const { orderId } = req.params as { orderId: string };
      const { status, note, reason } = req.body as {
        status: string;
        note?: string;
        reason?: string;
      };

      if (!status) {
        throw ValidationError("Status is required.");
      }

      let order;
      switch (status) {
        case "CONFIRMED":
          order = await OrderService.confirmOrder(orderId);
          break;
        case "SHIPPED":
          order = await OrderService.shipOrder(orderId, note);
          break;
        case "DELIVERED":
          order = await OrderService.deliverOrder(orderId);
          break;
        case "CANCELLED":
          order = await OrderService.cancelOrder(
            orderId,
            reason || note || "Cancelled by admin"
          );
          break;
        case "FAILED":
          order = await OrderService.failOrder(
            orderId,
            reason || note || "Marked failed by admin"
          );
          break;
        default:
          throw ValidationError(`Invalid target status: ${status}`);
      }

      res.status(200).json({
        success: true,
        message: `Order marked as ${status}.`,
        data: order,
      });
    }
  );

  static confirmOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const order = await OrderService.confirmOrder(orderId);
    res
      .status(200)
      .json({ success: true, message: "Order confirmed.", data: order });
  });

  static shipOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { note } = req.body as z.infer<typeof noteSchema>;

    const order = await OrderService.shipOrder(orderId, note);
    res
      .status(200)
      .json({ success: true, message: "Order shipped.", data: order });
  });

  static deliverOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const order = await OrderService.deliverOrder(orderId);
    res
      .status(200)
      .json({ success: true, message: "Order delivered.", data: order });
  });

  static cancelOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { reason } = req.body as z.infer<typeof reasonSchema>;

    const order = await OrderService.cancelOrder(orderId, reason);
    res
      .status(200)
      .json({ success: true, message: "Order cancelled.", data: order });
  });

  static failOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { reason } = req.body as z.infer<typeof reasonSchema>;

    const order = await OrderService.failOrder(orderId, reason);
    res
      .status(200)
      .json({ success: true, message: "Order failed.", data: order });
  });

  static processPayment = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const body = req.body as z.infer<typeof processPaymentSchema>;

    const result = await OrderService.processPayment(
      orderId,
      body.paymentMethod,
      body.provider,
      body.idempotencyKey,
      body.callbackUrl
    );

    res.status(200).json({
      success: true,
      message:
        "Payment initialized. Redirect the customer to complete payment.",
      data: {
        authorizationUrl: result.authorizationUrl,
        order: result.order,
        transaction: result.transaction,
      },
    });
  });

  static verifyPayment = asyncHandler(async (req: Request, res: Response) => {
    const { reference } = req.params as { reference: string };

    if (!reference) {
      throw ValidationError("Payment reference is required.");
    }

    const result = await OrderService.verifyPayment(reference);

    res.status(200).json({
      success: true,
      message:
        result.transaction.status === "SUCCESS"
          ? "Payment verified successfully."
          : "Payment verification complete.",
      data: result,
    });
  });

  static paystackWebhook = asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["x-paystack-signature"] as string | undefined;
    const rawBody =
      req.body instanceof Buffer
        ? req.body
        : Buffer.from(
            typeof req.body === "string" ? req.body : JSON.stringify(req.body),
            "utf8"
          );

    const parsed = parsePaystackWebhook(rawBody, signature);
    if (!parsed.ok) {
      const status = parsed.reason === "invalid_signature" ? 401 : 400;
      const message =
        parsed.reason === "missing_signature"
          ? "Missing signature."
          : parsed.reason === "invalid_signature"
          ? "Invalid signature."
          : "Invalid JSON body.";
      res.status(status).json({ success: false, message });
      return;
    }

    if (parsed.event === "charge.success" && parsed.reference) {
      await OrderService.verifyPayment(parsed.reference);
    }

    res.status(200).json({ success: true });
  });

  static getTrackingEvents = asyncHandler(
    async (req: Request, res: Response) => {
      const { orderId } = req.params as { orderId: string };
      const trackingEvents = await OrderService.getTrackingEvents(orderId);
      res.status(200).json({ success: true, data: trackingEvents });
    }
  );

  static addTrackingEvent = asyncHandler(
    async (req: Request, res: Response) => {
      const { orderId } = req.params as { orderId: string };
      const body = req.body as z.infer<typeof addTrackingEventSchema>;

      const event = await OrderService.addTrackingEvent(
        orderId,
        body.status,
        body.description,
        body.location
      );

      res.status(201).json({
        success: true,
        message: "Tracking event added successfully.",
        data: event,
      });
    }
  );
}
