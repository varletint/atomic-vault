import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  ProductService,
  type CreateProductInput,
  type UpdateProductInput,
} from "../services/ProductService.js";
import { NotFoundError } from "../utils/AppError.js";
import type { z } from "zod";
import type {
  createProductSchema,
  updateProductSchema,
} from "../schemas/productSchemas.js";

export class ProductController {
  static createProduct = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createProductSchema>;

    const product = await ProductService.createProduct(
      body as unknown as CreateProductInput
    );

    res.status(201).json({
      success: true,
      message: "Product created.",
      data: product,
    });
  });

  static updateProduct = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const body = req.body as z.infer<typeof updateProductSchema>;

    const product = await ProductService.updateProduct(
      productId,
      body as unknown as UpdateProductInput
    );

    res.status(200).json({
      success: true,
      message: "Product updated.",
      data: product,
    });
  });

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

  static getProductById = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const product = await ProductService.getProductById(productId);
    if (!product) throw NotFoundError("Product");
    res.status(200).json({ success: true, data: product });
  });

  static getProductBySku = asyncHandler(async (req: Request, res: Response) => {
    const { sku } = req.params as { sku: string };
    const product = await ProductService.getProductBySku(sku);
    if (!product) throw NotFoundError("Product");
    res.status(200).json({ success: true, data: product });
  });

  static getProducts = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string | undefined>;

    const filters = {
      category: query.category,
      brand: query.brand,
      tag: query.tag,
      isFeatured:
        query.isFeatured !== undefined
          ? query.isFeatured === "true"
          : undefined,
      minPrice: query.minPrice ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      sortBy: query.sortBy as
        | "price"
        | "name"
        | "createdAt"
        | "avgRating"
        | undefined,
      sortOrder: query.sortOrder as "asc" | "desc" | undefined,
    };

    const result = await ProductService.getProducts(filters);
    res.status(200).json({ success: true, ...result });
  });

  static getCategories = asyncHandler(async (_req: Request, res: Response) => {
    const categories = await ProductService.getCategories();
    res.status(200).json({ success: true, data: categories });
  });

  static getBrands = asyncHandler(async (_req: Request, res: Response) => {
    const brands = await ProductService.getBrands();
    res.status(200).json({ success: true, data: brands });
  });
}
