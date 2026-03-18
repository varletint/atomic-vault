import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ProductService } from "../services/ProductService.js";
import { ValidationError, NotFoundError } from "../utils/AppError.js";

/**
 * ProductController
 *
 * Thin HTTP layer for product operations.
 * All error handling is delegated to asyncHandler + the global errorHandler.
 */
export class ProductController {
  // ─────────────────────────────────────────────────
  // Create
  // ─────────────────────────────────────────────────

  /**
   * POST /api/products
   * Body: { name, description, price, category, imageUrl?, initialStock? }
   */
  static createProduct = asyncHandler(async (req: Request, res: Response) => {
    const { name, description, price, category, imageUrl, initialStock } =
      req.body as {
        name: string;
        description: string;
        price: number;
        category: string;
        imageUrl?: string;
        initialStock?: number;
      };

    if (!name || !description || price === undefined || !category) {
      throw ValidationError(
        "Name, description, price, and category are required."
      );
    }

    if (price < 0) {
      throw ValidationError("Price cannot be negative.");
    }

    const product = await ProductService.createProduct({
      name,
      description,
      price,
      category,
      imageUrl,
      initialStock,
    });

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      data: product,
    });
  });

  // ─────────────────────────────────────────────────
  // Update
  // ─────────────────────────────────────────────────

  /**
   * PATCH /api/products/:productId
   * Body: { name?, description?, price?, category?, imageUrl? }
   */
  static updateProduct = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const { name, description, price, category, imageUrl } = req.body as {
      name?: string;
      description?: string;
      price?: number;
      category?: string;
      imageUrl?: string;
    };

    if (
      !name &&
      !description &&
      price === undefined &&
      !category &&
      !imageUrl
    ) {
      throw ValidationError("Provide at least one field to update.");
    }

    const updateData: Parameters<typeof ProductService.updateProduct>[1] = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (category !== undefined) updateData.category = category;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

    const product = await ProductService.updateProduct(productId, updateData);

    res.status(200).json({
      success: true,
      message: "Product updated.",
      data: product,
    });
  });

  // ─────────────────────────────────────────────────
  // Activate / Deactivate
  // ─────────────────────────────────────────────────

  /**
   * PATCH /api/products/:productId/deactivate
   */
  static deactivateProduct = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };

      const product = await ProductService.deactivateProduct(productId);

      res.status(200).json({
        success: true,
        message: "Product deactivated.",
        data: product,
      });
    }
  );

  /**
   * PATCH /api/products/:productId/reactivate
   */
  static reactivateProduct = asyncHandler(
    async (req: Request, res: Response) => {
      const { productId } = req.params as { productId: string };

      const product = await ProductService.reactivateProduct(productId);

      res.status(200).json({
        success: true,
        message: "Product reactivated.",
        data: product,
      });
    }
  );

  // ─────────────────────────────────────────────────
  // Read: Single Product
  // ─────────────────────────────────────────────────

  /**
   * GET /api/products/:productId
   */
  static getProductById = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };

    const product = await ProductService.getProductById(productId);

    if (!product) {
      throw NotFoundError("Product");
    }

    res.status(200).json({ success: true, data: product });
  });

  // ─────────────────────────────────────────────────
  // Read: Catalog (Paginated)
  // ─────────────────────────────────────────────────

  /**
   * GET /api/products
   * Query: category, minPrice, maxPrice, search, page, limit, sortBy, sortOrder
   */
  static getProducts = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string | undefined>;

    const filters = {
      category: query.category,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      sortBy: query.sortBy as "price" | "name" | "createdAt" | undefined,
      sortOrder: query.sortOrder as "asc" | "desc" | undefined,
    };

    const result = await ProductService.getProducts(filters);

    res.status(200).json({ success: true, ...result });
  });

  // ─────────────────────────────────────────────────
  // Read: Categories
  // ─────────────────────────────────────────────────

  /**
   * GET /api/products/categories
   */
  static getCategories = asyncHandler(async (_req: Request, res: Response) => {
    const categories = await ProductService.getCategories();

    res.status(200).json({ success: true, data: categories });
  });
}
