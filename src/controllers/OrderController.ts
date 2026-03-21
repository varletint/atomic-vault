import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { OrderService } from "../services/OrderService.js";
import { ValidationError } from "../utils/AppError.js";
import type { PaymentMethod } from "../models/index.js";
import { PaystackService } from "../services/PaystackService.js";

export class OrderController {
  static createGuestOrder = asyncHandler(
    async (req: Request, res: Response) => {
      const {
        idempotencyKey,
        shippingAddress,
        guestContact,
        items,
        deliveryFee,
      } = req.body as {
        idempotencyKey: string;
        shippingAddress: {
          street: string;
          city: string;
          state: string;
          zip: string;
          country: string;
        };
        guestContact: { email: string; phone: string };
        items: { productId: string; quantity: number }[];
        deliveryFee?: number;
      };

      if (!idempotencyKey || !shippingAddress || !guestContact || !items) {
        throw ValidationError(
          "idempotencyKey, shippingAddress, guestContact, and items are required."
        );
      }

      const guestParams: Parameters<typeof OrderService.createGuestOrder>[0] = {
        idempotencyKey,
        shippingAddress,
        guestContact,
        items,
      };
      if (deliveryFee !== undefined) guestParams.deliveryFee = deliveryFee;

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

    const { idempotencyKey, shippingAddress } = req.body as {
      idempotencyKey: string;
      shippingAddress: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
      };
    };

    if (!idempotencyKey || !shippingAddress) {
      throw ValidationError(
        "Idempotency key and shipping address are required."
      );
    }

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
    const { note } = req.body as { note?: string };

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
    const { reason } = req.body as { reason: string };

    if (!reason) throw ValidationError("Cancellation reason is required.");

    const order = await OrderService.cancelOrder(orderId, reason);
    res
      .status(200)
      .json({ success: true, message: "Order cancelled.", data: order });
  });

  static failOrder = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { reason } = req.body as { reason: string };

    if (!reason) throw ValidationError("Failure reason is required.");

    const order = await OrderService.failOrder(orderId, reason);
    res
      .status(200)
      .json({ success: true, message: "Order failed.", data: order });
  });

  static processPayment = asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.params as { orderId: string };
    const { paymentMethod, provider, idempotencyKey, callbackUrl } =
      req.body as {
        paymentMethod: PaymentMethod;
        provider: string;
        idempotencyKey: string;
        callbackUrl?: string;
      };

    if (!paymentMethod || !provider || !idempotencyKey) {
      throw ValidationError(
        "Payment method, provider, and idempotency key are required."
      );
    }

    const result = await OrderService.processPayment(
      orderId,
      paymentMethod,
      provider,
      idempotencyKey,
      callbackUrl
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

    const rawBody = JSON.stringify(req.body);
    const isValid = PaystackService.validateWebhookSignature(
      rawBody,
      signature
    );

    if (!isValid) {
      res.status(401).json({ success: false, message: "Invalid signature." });
      return;
    }

    const event = req.body as { event: string; data: { reference: string } };

    if (event.event === "charge.success") {
      await OrderService.verifyPayment(event.data.reference);
    }

    res.status(200).json({ success: true });
  });
}
