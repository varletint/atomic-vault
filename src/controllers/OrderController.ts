import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { OrderService } from "../services/OrderService.js";
import { ValidationError } from "../utils/AppError.js";
import { PaystackService } from "../services/PaystackService.js";
import type { z } from "zod";
import type {
  createOrderSchema,
  createGuestOrderSchema,
  processPaymentSchema,
  reasonSchema,
  noteSchema,
  addTrackingEventSchema,
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
    const email = req.query.email as string | undefined;
    if (!email?.trim()) {
      throw ValidationError("Query parameter `email` is required.");
    }

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
    const signature = req.headers["x-paystack-signature"] as string;

    if (!signature) {
      res.status(400).json({ success: false, message: "Missing signature." });
      return;
    }

    const rawBody =
      req.body instanceof Buffer
        ? req.body
        : Buffer.from(
            typeof req.body === "string" ? req.body : JSON.stringify(req.body),
            "utf8"
          );
    const isValid = PaystackService.validateWebhookSignature(
      rawBody,
      signature
    );

    if (!isValid) {
      res.status(401).json({ success: false, message: "Invalid signature." });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      res.status(400).json({ success: false, message: "Invalid JSON body." });
      return;
    }

    const event = payload as { event?: string; data?: { reference?: string } };

    const reference = event.data?.reference;
    if (event.event === "charge.success" && reference) {
      await OrderService.verifyPayment(reference);
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
