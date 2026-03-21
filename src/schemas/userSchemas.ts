import { z } from "zod";

const addressSchema = z.object({
  street: z.string().min(1, "Street is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(1, "Zip is required"),
  country: z.string().min(1, "Country is required"),
});

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  address: addressSchema,
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const reasonSchema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export const updateProfileSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: addressSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.address !== undefined, {
    message: "Provide at least one field to update (name or address).",
  });
