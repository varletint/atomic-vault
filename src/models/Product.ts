import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * Product Model
 * Represents an item available for purchase in the catalog.
 * Price is stored in kobo (integer) to avoid floating point issues.
 */
export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  price: number; // stored in kobo (e.g., 1999 = $19.99)
  category: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    price: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
    category: { type: String, required: true, trim: true },
    imageUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Indexes for catalog browsing
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: "text", description: "text" });

export const Product = mongoose.model<IProduct>("Product", productSchema);
