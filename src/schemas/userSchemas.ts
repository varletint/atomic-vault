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

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Code must be a 6-digit number"),
  password: z.string().min(8, "Password must be at least 8 characters"),
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

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  role: z.enum(["CUSTOMER", "SUPPORT", "ADMIN"]).optional(),
  status: z
    .enum(["UNVERIFIED", "ACTIVE", "SUSPENDED", "DEACTIVATED"])
    .optional(),
});
