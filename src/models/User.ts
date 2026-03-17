import mongoose, { Schema, type Document, type Types } from "mongoose";

/**
 * User Model
 * Represents a customer who can place orders.
 */
export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true, default: "NIG" },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, minlength: 8 },
    address: { type: addressSchema, required: true },
  },
  {
    timestamps: true,
  }
);

// Index for fast email lookups
userSchema.index({ email: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
