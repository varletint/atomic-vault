import { Router } from "express";
import { CartController } from "../controllers/CartController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { addItemSchema, updateQuantitySchema } from "../schemas/cartSchemas.js";

const router = Router();

router.use(authMiddleware);

router.get("/", CartController.getCart);
router.post("/items", validate(addItemSchema), CartController.addItem);
router.patch(
  "/items/:productId",
  validate(updateQuantitySchema),
  CartController.updateItemQuantity
);
router.delete("/items/:productId", CartController.removeItem);
router.delete("/", CartController.clearCart);

export default router;
