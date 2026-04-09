import mongoose from "mongoose";
import {
  Product,
  type IProduct,
  type IProductImage,
  type IProductVariant,
  type IProductSeo,
  type IDimensions,
  Inventory,
  type IInventory,
} from "../models/index.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/AppError.js";
import { generateSku } from "../utils/sku.js";
import { generateSlug } from "../utils/slug.js";

export interface ProductWithStock {
  _id: IProduct["_id"];
  sku: string;
  slug: string;
  name: string;
  shortDescription?: string | undefined;
  description: string;
  price: number;
  compareAtPrice?: number | undefined;
  costPrice?: number | undefined;
  category: string;
  brand?: string | undefined;
  tags: string[];
  productType: "physical" | "digital" | "service";
  images: IProductImage[];
  hasVariants: boolean;
  variants: IProductVariant[];
  variantOptionNames: string[];
  weight?: number | undefined;
  weightUnit: "g" | "kg" | "lb" | "oz";
  dimensions?: IDimensions | undefined;
  material?: string | undefined;
  careInstructions?: string | undefined;
  isFeatured: boolean;
  avgRating: number;
  reviewCount: number;
  minOrderQty: number;
  seo?: IProductSeo | undefined;
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
  category?: string | undefined;
  brand?: string | undefined;
  tag?: string | undefined;
  isActive?: boolean | undefined;
  isFeatured?: boolean | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  sortBy?: "price" | "name" | "createdAt" | "avgRating" | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

interface CreateVariantInput {
  variantOptions: { name: string; value: string }[];
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  weight?: number;
  images?: IProductImage[];
  isActive?: boolean;
}

export interface CreateProductInput {
  name: string;
  description: string;
  price: number;
  category: string;
  shortDescription?: string;
  compareAtPrice?: number;
  costPrice?: number;
  brand?: string;
  tags?: string[];
  productType?: "physical" | "digital" | "service";
  images?: IProductImage[];
  hasVariants?: boolean;
  variants?: CreateVariantInput[];
  variantOptionNames?: string[];
  weight?: number;
  weightUnit?: "g" | "kg" | "lb" | "oz";
  dimensions?: IDimensions;
  material?: string;
  careInstructions?: string;
  isFeatured?: boolean;
  minOrderQty?: number;
  seo?: IProductSeo;
  initialStock?: number;
}

export interface UpdateProductInput {
  name?: string | undefined;
  shortDescription?: string | undefined;
  description?: string | undefined;
  price?: number | undefined;
  compareAtPrice?: number | undefined;
  costPrice?: number | undefined;
  category?: string | undefined;
  brand?: string | undefined;
  tags?: string[] | undefined;
  productType?: "physical" | "digital" | "service" | undefined;
  images?: IProductImage[] | undefined;
  hasVariants?: boolean | undefined;
  variants?: CreateVariantInput[] | undefined;
  variantOptionNames?: string[] | undefined;
  weight?: number | undefined;
  weightUnit?: "g" | "kg" | "lb" | "oz" | undefined;
  dimensions?: IDimensions | undefined;
  material?: string | undefined;
  careInstructions?: string | undefined;
  isFeatured?: boolean | undefined;
  minOrderQty?: number | undefined;
  seo?: IProductSeo | undefined;
}

/*   Service */

export class ProductService {
  static async createProduct(
    data: CreateProductInput
  ): Promise<ProductWithStock> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const sku = await generateSku(data.category);
      const slug = generateSlug(data.name);

      const createPayload: Record<string, unknown> = {
        sku,
        slug,
        name: data.name,
        description: data.description,
        price: data.price,
        category: data.category,
        tags: data.tags ?? [],
        productType: data.productType ?? "physical",
        images: data.images ?? [],
        hasVariants: data.hasVariants ?? false,
        variants: data.variants ?? [],
        variantOptionNames: data.variantOptionNames ?? [],
        weightUnit: data.weightUnit ?? "g",
        isFeatured: data.isFeatured ?? false,
        minOrderQty: data.minOrderQty ?? 1,
        isActive: true,
      };

      if (data.shortDescription !== undefined)
        createPayload.shortDescription = data.shortDescription;
      if (data.compareAtPrice !== undefined)
        createPayload.compareAtPrice = data.compareAtPrice;
      if (data.costPrice !== undefined)
        createPayload.costPrice = data.costPrice;
      if (data.brand !== undefined) createPayload.brand = data.brand;
      if (data.weight !== undefined) createPayload.weight = data.weight;
      if (data.dimensions !== undefined)
        createPayload.dimensions = data.dimensions;
      if (data.material !== undefined) createPayload.material = data.material;
      if (data.careInstructions !== undefined)
        createPayload.careInstructions = data.careInstructions;
      if (data.seo !== undefined) createPayload.seo = data.seo;

      const results = await Product.create([createPayload] as any, { session });
      const created = results[0]! as unknown as IProduct;

      const initialStock = data.initialStock ?? 0;

      if (created.hasVariants && created.variants.length > 0) {
        const inventoryDocs = created.variants.map((v: IProductVariant) => ({
          product: created._id,
          variant: v._id,
          stock: initialStock,
          reserved: 0,
        }));

        await Inventory.create(inventoryDocs as any, { session });
      } else {
        await Inventory.create(
          [{ product: created._id, stock: initialStock, reserved: 0 }] as any,
          { session }
        );
      }

      await session.commitTransaction();

      const aggregated = await ProductService.getAggregatedStock(created._id);

      return ProductService.mergeProductWithStock(
        (created as any).toObject() as IProduct,
        aggregated
      );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /* ── Update ── */

  static async updateProduct(
    productId: string,
    data: UpdateProductInput
  ): Promise<IProduct> {
    const product = await Product.findById(productId);

    if (!product) {
      throw NotFoundError("Product");
    }

    if (!product.isActive) {
      throw ForbiddenError(
        "Cannot update an inactive product. Reactivate it first."
      );
    }

    const scalars = [
      "name",
      "shortDescription",
      "description",
      "price",
      "compareAtPrice",
      "costPrice",
      "category",
      "brand",
      "productType",
      "weight",
      "weightUnit",
      "material",
      "careInstructions",
      "isFeatured",
      "minOrderQty",
    ] as const;

    for (const key of scalars) {
      if (data[key] !== undefined) {
        (product as any)[key] = data[key];
      }
    }

    // Array / object fields
    if (data.tags !== undefined) product.tags = data.tags;
    if (data.images !== undefined) product.images = data.images as any;
    if (data.hasVariants !== undefined) product.hasVariants = data.hasVariants;
    if (data.variants !== undefined) product.variants = data.variants as any;
    if (data.variantOptionNames !== undefined)
      product.variantOptionNames = data.variantOptionNames;
    if (data.dimensions !== undefined)
      product.dimensions = data.dimensions as any;
    if (data.seo !== undefined) product.seo = data.seo as any;

    await product.save();
    return product;
  }

  /* ── Deactivate / Reactivate ────────────── */

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

  /* ── Read ───────────────────────────────── */

  static async getProductById(
    productId: string
  ): Promise<ProductWithStock | null> {
    const product = await Product.findById(productId).lean<IProduct>();
    if (!product) return null;

    const aggregated = await ProductService.getAggregatedStock(product._id);
    return ProductService.mergeProductWithStock(product, aggregated);
  }

  static async getProductBySku(sku: string): Promise<ProductWithStock | null> {
    const product = await Product.findOne({
      sku: sku.toUpperCase(),
    }).lean<IProduct>();
    if (!product) return null;

    const aggregated = await ProductService.getAggregatedStock(product._id);
    return ProductService.mergeProductWithStock(product, aggregated);
  }

  static async getProductBySlug(
    slug: string
  ): Promise<ProductWithStock | null> {
    const product = await Product.findOne({ slug }).lean<IProduct>();
    if (!product) return null;

    const aggregated = await ProductService.getAggregatedStock(product._id);
    return ProductService.mergeProductWithStock(product, aggregated);
  }

  static async getProducts(
    filters: ProductFilters = {}
  ): Promise<PaginatedResult<ProductWithStock>> {
    const {
      category,
      brand,
      tag,
      isActive = true,
      isFeatured,
      minPrice,
      maxPrice,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = filters;

    // Build query
    const query: Record<string, unknown> = { isActive };

    if (category) query.category = category;
    if (brand) query.brand = brand;
    if (tag) query.tags = tag;
    if (isFeatured !== undefined) query.isFeatured = isFeatured;

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

    // Aggregate stock per product (sum across variants)
    const stockMap = new Map<string, { stock: number; reserved: number }>();
    for (const inv of inventories) {
      const key = inv.product.toString();
      const existing = stockMap.get(key) ?? { stock: 0, reserved: 0 };
      existing.stock += inv.stock;
      existing.reserved += inv.reserved;
      stockMap.set(key, existing);
    }

    // Merge product + stock data
    const merged = products.map((p) => {
      const agg = stockMap.get(p._id.toString()) ?? {
        stock: 0,
        reserved: 0,
      };
      return ProductService.mergeProductWithStock(p, agg);
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

  static async getBrands(): Promise<string[]> {
    return Product.distinct("brand", { isActive: true, brand: { $ne: null } });
  }

  /* ── Helpers ────────────────────────────── */

  /**
   * Aggregate total stock across all variants for a single product.
   */
  private static async getAggregatedStock(
    productId: IProduct["_id"]
  ): Promise<{ stock: number; reserved: number }> {
    const inventories = await Inventory.find({
      product: productId,
    }).lean<IInventory[]>();

    let stock = 0;
    let reserved = 0;
    for (const inv of inventories) {
      stock += inv.stock;
      reserved += inv.reserved;
    }
    return { stock, reserved };
  }

  private static mergeProductWithStock(
    product: IProduct,
    aggregated: { stock: number; reserved: number }
  ): ProductWithStock {
    return {
      _id: product._id,
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      shortDescription: product.shortDescription,
      description: product.description,
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      costPrice: product.costPrice,
      category: product.category,
      brand: product.brand,
      tags: product.tags,
      productType: product.productType,
      images: product.images,
      hasVariants: product.hasVariants,
      variants: product.variants,
      variantOptionNames: product.variantOptionNames,
      weight: product.weight,
      weightUnit: product.weightUnit,
      dimensions: product.dimensions,
      material: product.material,
      careInstructions: product.careInstructions,
      isFeatured: product.isFeatured,
      avgRating: product.avgRating,
      reviewCount: product.reviewCount,
      minOrderQty: product.minOrderQty,
      seo: product.seo,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      stock: aggregated.stock,
      reserved: aggregated.reserved,
      available: aggregated.stock - aggregated.reserved,
    };
  }
}
