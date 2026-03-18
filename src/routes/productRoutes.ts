import { Router } from "express";
import { ProductController } from "../controllers/ProductController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/categories", ProductController.getCategories);
router.get("/sku/:sku", ProductController.getProductBySku);
router.get("/", ProductController.getProducts);
router.get("/:productId", ProductController.getProductById);

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
