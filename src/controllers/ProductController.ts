import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ProductService } from "../services/ProductService.js";
import { NotFoundError } from "../utils/AppError.js";
import type { z } from "zod";
import type {
  createProductSchema,
  updateProductSchema,
} from "../schemas/productSchemas.js";

export class ProductController {
  static createProduct = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createProductSchema>;

    const createData: Parameters<typeof ProductService.createProduct>[0] = {
      name: body.name,
      description: body.description,
      price: body.price,
      category: body.category,
    };
    if (body.compareAtPrice !== undefined)
      createData.compareAtPrice = body.compareAtPrice;
    if (body.costPrice !== undefined) createData.costPrice = body.costPrice;
    if (body.imageUrl !== undefined) createData.imageUrl = body.imageUrl;
    if (body.initialStock !== undefined)
      createData.initialStock = body.initialStock;

    const product = await ProductService.createProduct(createData);

    res.status(201).json({
      success: true,
      message: "Product created.",
      data: product,
    });
  });

  static updateProduct = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const body = req.body as z.infer<typeof updateProductSchema>;

    const updateData: Parameters<typeof ProductService.updateProduct>[1] = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.compareAtPrice !== undefined)
      updateData.compareAtPrice = body.compareAtPrice;
    if (body.costPrice !== undefined) updateData.costPrice = body.costPrice;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;

    const product = await ProductService.updateProduct(productId, updateData);

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
    },
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
    },
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

  static getCategories = asyncHandler(async (_req: Request, res: Response) => {
    const categories = await ProductService.getCategories();
    res.status(200).json({ success: true, data: categories });
  });
}
