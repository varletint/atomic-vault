import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IProductImage {
  url: string;
  altText?: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface IVariantOption {
  name: string; // e.g. "Size", "Color", "Material"
  value: string; // e.g. "M", "Red", "Cotton"
}

export interface IProductVariant {
  _id: Types.ObjectId;
  sku: string;
  variantOptions: IVariantOption[];
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  weight?: number;
  images?: IProductImage[];
  isActive: boolean;
}

export interface IProductSeo {
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string[];
}

export interface IDimensions {
  length?: number;
  width?: number;
  height?: number;
  unit: "cm" | "in";
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  sku: string;
  slug: string;
  name: string;
  shortDescription?: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  costPrice?: number;
  category: string;
  brand?: string;
  tags: string[];
  productType: "physical" | "digital" | "service";

  images: IProductImage[];

  hasVariants: boolean;
  variants: IProductVariant[];
  variantOptionNames: string[]; // e.g. ["Size", "Color"]

  weight?: number;
  weightUnit: "g" | "kg" | "lb" | "oz";
  dimensions?: IDimensions;
  material?: string;
  careInstructions?: string;

  isFeatured: boolean;
  avgRating: number;
  reviewCount: number;
  minOrderQty: number;

  seo?: IProductSeo;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productImageSchema = new Schema<IProductImage>(
  {
    url: { type: String, required: true },
    altText: { type: String },
    sortOrder: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const variantOptionSchema = new Schema<IVariantOption>(
  {
    name: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const productVariantSchema = new Schema<IProductVariant>({
  sku: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },
  variantOptions: {
    type: [variantOptionSchema],
    required: true,
    validate: [
      (val: IVariantOption[]) => val.length > 0,
      "Variant must have at least one option",
    ],
  },
  price: {
    type: Number,
    required: true,
    min: [0, "Variant price cannot be negative"],
    validate: {
      validator: Number.isInteger,
      message: "Variant price must be an integer (kobo)",
    },
  },
  compareAtPrice: {
    type: Number,
    min: [0, "Compare-at price cannot be negative"],
    validate: {
      validator: (v: number | undefined) =>
        v === undefined || Number.isInteger(v),
      message: "Compare-at price must be an integer (kobo)",
    },
  },
  costPrice: {
    type: Number,
    min: [0, "Cost price cannot be negative"],
    validate: {
      validator: (v: number | undefined) =>
        v === undefined || Number.isInteger(v),
      message: "Cost price must be an integer (kobo)",
    },
  },
  weight: {
    type: Number,
    min: [0, "Weight cannot be negative"],
  },
  images: { type: [productImageSchema], default: [] },
  isActive: { type: Boolean, default: true },
});

const productSeoSchema = new Schema<IProductSeo>(
  {
    metaTitle: { type: String, maxlength: 70 },
    metaDescription: { type: String, maxlength: 160 },
    metaKeywords: { type: [String], default: [] },
  },
  { _id: false }
);

const dimensionsSchema = new Schema<IDimensions>(
  {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ["cm", "in"], default: "cm" },
  },
  { _id: false }
);

const productSchema = new Schema<IProduct>(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true },
    description: { type: String, required: true },
    price: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Price must be an integer (kobo)",
      },
    },
    compareAtPrice: {
      type: Number,
      min: [0, "Compare-at price cannot be negative"],
      validate: {
        validator: (v: number | undefined) =>
          v === undefined || Number.isInteger(v),
        message: "Compare-at price must be an integer (kobo)",
      },
    },
    costPrice: {
      type: Number,
      min: [0, "Cost price cannot be negative"],
      validate: {
        validator: (v: number | undefined) =>
          v === undefined || Number.isInteger(v),
        message: "Cost price must be an integer (kobo)",
      },
    },
    category: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    tags: { type: [String], default: [] },
    productType: {
      type: String,
      enum: ["physical", "digital", "service"],
      default: "physical",
      required: true,
    },

    images: { type: [productImageSchema], default: [] },

    hasVariants: { type: Boolean, default: false },
    variants: { type: [productVariantSchema], default: [] },
    variantOptionNames: { type: [String], default: [] },

    weight: { type: Number, min: [0, "Weight cannot be negative"] },
    weightUnit: {
      type: String,
      enum: ["g", "kg", "lb", "oz"],
      default: "g",
    },
    dimensions: { type: dimensionsSchema },
    material: { type: String, trim: true },
    careInstructions: { type: String },

    isFeatured: { type: Boolean, default: false },
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    minOrderQty: { type: Number, default: 1, min: 1 },

    seo: { type: productSeoSchema },

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ sku: 1 }, { unique: true });
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ brand: 1, isActive: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ "variants.sku": 1 });

export const Product = mongoose.model<IProduct>("Product", productSchema);
