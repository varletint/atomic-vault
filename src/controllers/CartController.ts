import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { CartService } from "../services/CartService.js";
import { ValidationError } from "../utils/AppError.js";
import type { z } from "zod";
import type { addItemSchema, updateQuantitySchema } from "../schemas/cartSchemas.js";

export class CartController {
  static getCart = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const cart = await CartService.getCart(userId);
    res.status(200).json({ success: true, data: cart });
  });

  static addItem = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const { productId, quantity } = req.body as z.infer<typeof addItemSchema>;

    const cart = await CartService.addItem(userId, productId, quantity);
    res
      .status(200)
      .json({ success: true, message: "Item added to cart.", data: cart });
  });

  static updateItemQuantity = asyncHandler(
    async (req: Request, res: Response) => {
      const userId = req.user?.userId;
      if (!userId) throw ValidationError("User not authenticated.");

      const { productId } = req.params as { productId: string };
      const { quantity } = req.body as z.infer<typeof updateQuantitySchema>;

      const cart = await CartService.updateItemQuantity(
        userId,
        productId,
        quantity,
      );
      res
        .status(200)
        .json({ success: true, message: "Cart updated.", data: cart });
    },
  );

  static removeItem = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const { productId } = req.params as { productId: string };

    const cart = await CartService.removeItem(userId, productId);
    res
      .status(200)
      .json({ success: true, message: "Item removed from cart.", data: cart });
  });

  static clearCart = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw ValidationError("User not authenticated.");

    const cart = await CartService.clearCart(userId);
    res
      .status(200)
      .json({ success: true, message: "Cart cleared.", data: cart });
  });
}
