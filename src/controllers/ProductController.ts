import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ProductService } from "../services/ProductService.js";
import { ValidationError, NotFoundError } from "../utils/AppError.js";

export class ProductController {
  static createProduct = asyncHandler(async (req: Request, res: Response) => {
    const {
      name,
      description,
      price,
      category,
      compareAtPrice,
      costPrice,
      imageUrl,
      initialStock,
    } = req.body as {
      name: string;
      description: string;
      price: number;
      category: string;
      compareAtPrice?: number;
      costPrice?: number;
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

    const createData: Parameters<typeof ProductService.createProduct>[0] = {
      name,
      description,
      price,
      category,
    };
    if (compareAtPrice !== undefined)
      createData.compareAtPrice = compareAtPrice;
    if (costPrice !== undefined) createData.costPrice = costPrice;
    if (imageUrl !== undefined) createData.imageUrl = imageUrl;
    if (initialStock !== undefined) createData.initialStock = initialStock;

    const product = await ProductService.createProduct(createData);

    res.status(201).json({
      success: true,
      message: "Product created.",
      data: product,
    });
  });

  static updateProduct = asyncHandler(async (req: Request, res: Response) => {
    const { productId } = req.params as { productId: string };
    const {
      name,
      description,
      price,
      compareAtPrice,
      costPrice,
      category,
      imageUrl,
    } = req.body as {
      name?: string;
      description?: string;
      price?: number;
      compareAtPrice?: number;
      costPrice?: number;
      category?: string;
      imageUrl?: string;
    };

    if (
      !name &&
      !description &&
      price === undefined &&
      compareAtPrice === undefined &&
      costPrice === undefined &&
      !category &&
      !imageUrl
    ) {
      throw ValidationError("Provide at least one field to update.");
    }

    const updateData: Parameters<typeof ProductService.updateProduct>[1] = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (compareAtPrice !== undefined)
      updateData.compareAtPrice = compareAtPrice;
    if (costPrice !== undefined) updateData.costPrice = costPrice;
    if (category !== undefined) updateData.category = category;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

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
      res
        .status(200)
        .json({
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
      res
        .status(200)
        .json({
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
