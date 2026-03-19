import mongoose from "mongoose";
import {
  Product,
  type IProduct,
  Inventory,
  type IInventory,
} from "../models/index.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/AppError.js";
import { generateSku } from "../utils/sku.js";

export interface ProductWithStock {
  _id: IProduct["_id"];
  sku: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  category: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  stock: number;
  reserved: number;
  available: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductFilters {
  category?: string;
  isActive?: boolean;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: "price" | "name" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export class ProductService {
  static async createProduct(data: {
    name: string;
    description: string;
    price: number;
    category: string;
    compareAtPrice?: number;
    costPrice?: number;
    imageUrl?: string;
    initialStock?: number;
  }): Promise<ProductWithStock> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const sku = await generateSku(data.category);

      const [product] = await Product.create(
        [
          {
            sku,
            name: data.name,
            description: data.description,
            price: data.price,
            compareAtPrice: data.compareAtPrice,
            costPrice: data.costPrice,
            category: data.category,
            imageUrl: data.imageUrl,
            isActive: true,
          },
        ],
        { session },
      );

      const initialStock = data.initialStock ?? 0;

      const [inventory] = await Inventory.create(
        [
          {
            product: product!._id,
            stock: initialStock,
            reserved: 0,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return ProductService.mergeProductWithStock(
        product!.toObject() as IProduct,
        inventory!.toObject() as IInventory,
      );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  static async updateProduct(
    productId: string,
    data: {
      name?: string;
      description?: string;
      price?: number;
      compareAtPrice?: number;
      costPrice?: number;
      category?: string;
      imageUrl?: string;
    },
  ): Promise<IProduct> {
    const product = await Product.findById(productId);

    if (!product) {
      throw NotFoundError("Product");
    }

    if (!product.isActive) {
      throw ForbiddenError(
        "Cannot update an inactive product. Reactivate it first.",
      );
    }

    if (data.name !== undefined) product.name = data.name;
    if (data.description !== undefined) product.description = data.description;
    if (data.price !== undefined) product.price = data.price;
    if (data.compareAtPrice !== undefined)
      product.compareAtPrice = data.compareAtPrice;
    if (data.costPrice !== undefined) product.costPrice = data.costPrice;
    if (data.category !== undefined) product.category = data.category;
    if (data.imageUrl !== undefined) product.imageUrl = data.imageUrl;

    await product.save();
    return product;
  }

  static async deactivateProduct(productId: string): Promise<IProduct> {
    const product = await Product.findById(productId);

    if (!product) {
      throw NotFoundError("Product");
    }

    if (!product.isActive) {
      throw ValidationError("Product is already inactive.");
    }

    product.isActive = false;
    await product.save();
    return product;
  }

  static async reactivateProduct(productId: string): Promise<IProduct> {
    const product = await Product.findById(productId);

    if (!product) {
      throw NotFoundError("Product");
    }

    if (product.isActive) {
      throw ValidationError("Product is already active.");
    }

    product.isActive = true;
    await product.save();
    return product;
  }

  static async getProductById(
    productId: string,
  ): Promise<ProductWithStock | null> {
    const product = await Product.findById(productId).lean<IProduct>();
    if (!product) return null;

    const inventory = await Inventory.findOne({
      product: product._id,
    }).lean<IInventory>();

    return ProductService.mergeProductWithStock(product, inventory);
  }

  static async getProductBySku(sku: string): Promise<ProductWithStock | null> {
    const product = await Product.findOne({
      sku: sku.toUpperCase(),
    }).lean<IProduct>();
    if (!product) return null;

    const inventory = await Inventory.findOne({
      product: product._id,
    }).lean<IInventory>();

    return ProductService.mergeProductWithStock(product, inventory);
  }

  static async getProducts(
    filters: ProductFilters = {},
  ): Promise<PaginatedResult<ProductWithStock>> {
    const {
      category,
      isActive = true,
      minPrice,
      maxPrice,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = filters;

    // Build the query
    const query: Record<string, unknown> = { isActive };

    if (category) {
      query.category = category;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) priceFilter.$gte = minPrice;
      if (maxPrice !== undefined) priceFilter.$lte = maxPrice;
      query.price = priceFilter;
    }

    if (search) {
      query.$text = { $search: search };
    }

    // Execute count + find in parallel
    const skip = (page - 1) * limit;
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === "asc" ? 1 : -1,
    };

    const [products, total] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(limit).lean<IProduct[]>(),
      Product.countDocuments(query),
    ]);

    // Fetch inventory for all returned products in one query
    const productIds = products.map((p) => p._id);
    const inventories = await Inventory.find({
      product: { $in: productIds },
    }).lean<IInventory[]>();

    // Map inventory by product ID for O(1) lookup
    const inventoryMap = new Map<string, IInventory>();
    for (const inv of inventories) {
      inventoryMap.set(inv.product.toString(), inv);
    }

    // Merge product + stock data
    const merged = products.map((p) => {
      const inv = inventoryMap.get(p._id.toString()) ?? null;
      return ProductService.mergeProductWithStock(p, inv);
    });

    return {
      data: merged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getCategories(): Promise<string[]> {
    return Product.distinct("category", { isActive: true });
  }

  private static mergeProductWithStock(
    product: IProduct,
    inventory: IInventory | null,
  ): ProductWithStock {
    return {
      _id: product._id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      costPrice: product.costPrice,
      category: product.category,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      stock: inventory?.stock ?? 0,
      reserved: inventory?.reserved ?? 0,
      available: (inventory?.stock ?? 0) - (inventory?.reserved ?? 0),
    };
  }
}
