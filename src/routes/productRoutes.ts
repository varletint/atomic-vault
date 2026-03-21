import { Router } from "express";
import { ProductController } from "../controllers/ProductController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import {
  createProductSchema,
  updateProductSchema,
} from "../schemas/productSchemas.js";

const router = Router();

router.get("/categories", ProductController.getCategories);
router.get("/sku/:sku", ProductController.getProductBySku);
router.get("/", ProductController.getProducts);
router.get("/:productId", ProductController.getProductById);

router.post(
  "/",
  authMiddleware,
  validate(createProductSchema),
  ProductController.createProduct
);
router.patch(
  "/:productId",
  authMiddleware,
  validate(updateProductSchema),
  ProductController.updateProduct
);
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
