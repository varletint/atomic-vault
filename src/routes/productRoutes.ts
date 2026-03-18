import { Router } from "express";
import { ProductController } from "../controllers/ProductController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

/**
 * Product Routes
 *
 * Public routes: browse catalog, view product, list categories.
 * Protected routes: create, update, deactivate, reactivate (admin actions).
 */
const router = Router();

// ───── Public: Catalog Browsing ─────
router.get("/categories", ProductController.getCategories);
router.get("/", ProductController.getProducts);
router.get("/:productId", ProductController.getProductById);

// ───── Protected: Admin/Seller Actions ─────
router.post("/", authMiddleware, ProductController.createProduct);
router.patch("/:productId", authMiddleware, ProductController.updateProduct);
router.patch(
  "/:productId/deactivate",
  authMiddleware,
  ProductController.deactivateProduct
);
router.patch(
  "/:productId/reactivate",
  authMiddleware,
  ProductController.reactivateProduct
);

export default router;
