import { z } from "zod";

/* ─────────────────────────────────────────────
 *  Reusable sub-schemas
 * ───────────────────────────────────────────── */

const productImageSchema = z.object({
  url: z.string().url("Invalid image URL"),
  altText: z.string().optional(),
  sortOrder: z.number().int().min(0).default(0),
  isPrimary: z.boolean().default(false),
});

const variantOptionSchema = z.object({
  name: z.string().min(1, "Option name is required"),
  value: z.string().min(1, "Option value is required"),
});

const variantSchema = z.object({
  variantOptions: z
    .array(variantOptionSchema)
    .min(1, "Variant must have at least one option"),
  price: z.number().min(0, "Price cannot be negative"),
  compareAtPrice: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  weight: z.number().min(0).optional(),
  images: z.array(productImageSchema).optional(),
  isActive: z.boolean().default(true),
});

const seoSchema = z.object({
  metaTitle: z.string().max(70).optional(),
  metaDescription: z.string().max(160).optional(),
  metaKeywords: z.array(z.string()).optional(),
});

const dimensionsSchema = z.object({
  length: z.number().min(0).optional(),
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  unit: z.enum(["cm", "in"]).default("cm"),
});

/* ─────────────────────────────────────────────
 *  Create Product
 * ───────────────────────────────────────────── */

export const createProductSchema = z
  .object({
    // Required core
    name: z.string().min(1, "Name is required"),
    description: z.string().min(1, "Description is required"),
    price: z.number().min(0, "Price cannot be negative"),
    category: z.string().min(1, "Category is required"),

    // Optional core
    shortDescription: z.string().optional(),
    compareAtPrice: z.number().min(0).optional(),
    costPrice: z.number().min(0).optional(),
    brand: z.string().optional(),
    tags: z.array(z.string()).default([]),
    productType: z.enum(["physical", "digital", "service"]).default("physical"),

    // Images
    images: z.array(productImageSchema).default([]),

    // Variants
    hasVariants: z.boolean().default(false),
    variants: z.array(variantSchema).default([]),
    variantOptionNames: z.array(z.string()).default([]),

    // Shipping / physical
    weight: z.number().min(0).optional(),
    weightUnit: z.enum(["g", "kg", "lb", "oz"]).default("g"),
    dimensions: dimensionsSchema.optional(),
    material: z.string().optional(),
    careInstructions: z.string().optional(),

    // Merchandising
    isFeatured: z.boolean().default(false),
    minOrderQty: z.number().int().min(1).default(1),

    // SEO
    seo: seoSchema.optional(),

    // Inventory (initial stock for the first variant or product-level)
    initialStock: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => {
      // If hasVariants is true, must have at least one variant
      if (data.hasVariants && data.variants.length === 0) return false;
      return true;
    },
    { message: "Products with variants must include at least one variant." }
  )
  .refine(
    (data) => {
      // If hasVariants, variantOptionNames should be provided
      if (data.hasVariants && data.variantOptionNames.length === 0)
        return false;
      return true;
    },
    {
      message:
        "Variant option names (e.g. 'Size', 'Color') are required when variants are enabled.",
    }
  );

/* ─────────────────────────────────────────────
 *  Update Product
 * ───────────────────────────────────────────── */

export const updateProductSchema = z
  .object({
    name: z.string().min(1).optional(),
    shortDescription: z.string().optional(),
    description: z.string().min(1).optional(),
    price: z.number().min(0).optional(),
    compareAtPrice: z.number().min(0).optional(),
    costPrice: z.number().min(0).optional(),
    category: z.string().min(1).optional(),
    brand: z.string().optional(),
    tags: z.array(z.string()).optional(),
    productType: z.enum(["physical", "digital", "service"]).optional(),

    images: z.array(productImageSchema).optional(),

    hasVariants: z.boolean().optional(),
    variants: z.array(variantSchema).optional(),
    variantOptionNames: z.array(z.string()).optional(),

    weight: z.number().min(0).optional(),
    weightUnit: z.enum(["g", "kg", "lb", "oz"]).optional(),
    dimensions: dimensionsSchema.optional(),
    material: z.string().optional(),
    careInstructions: z.string().optional(),

    isFeatured: z.boolean().optional(),
    minOrderQty: z.number().int().min(1).optional(),

    seo: seoSchema.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Provide at least one field to update.",
  });
