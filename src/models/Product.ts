import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IProduct extends Document {
  _id: Types.ObjectId;
  sku: string;
  slug: string;
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
}

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
    description: { type: String, required: true },
    price: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
    compareAtPrice: {
      type: Number,
      min: [0, "Compare-at price cannot be negative"],
    },
    costPrice: {
      type: Number,
      min: [0, "Cost price cannot be negative"],
    },
    category: { type: String, required: true, trim: true },
    imageUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: "text", description: "text" });
productSchema.index({ sku: 1 }, { unique: true });
productSchema.index({ slug: 1 }, { unique: true });

export const Product = mongoose.model<IProduct>("Product", productSchema);
