import { Router } from "express";
import { CartController } from "../controllers/CartController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.get("/", CartController.getCart);
router.post("/items", CartController.addItem);
router.patch("/items/:productId", CartController.updateItemQuantity);
router.delete("/items/:productId", CartController.removeItem);
router.delete("/", CartController.clearCart);

export default router;
