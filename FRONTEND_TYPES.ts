// TypeScript types for frontend integration
// Copy this file to your frontend project

// ============================================
// User Types
// ============================================

export type UserStatus = "UNVERIFIED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
export type UserRole = "CUSTOMER" | "SUPPORT" | "ADMIN";

export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface User {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isEmailVerified: boolean;
  address: Address;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Product Types
// ============================================

export interface Product {
  _id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  price: number; // in kobo (₦1 = 100 kobo)
  compareAtPrice?: number;
  costPrice?: number;
  category: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Inventory {
  _id: string;
  product: string;
  stock: number;
  reserved: number;
  available: number; // virtual: stock - reserved
}

// ============================================
// Cart Types
// ============================================

export interface CartItem {
  product: Product;
  quantity: number;
  priceAtAdd: number; // in kobo
}

export interface Cart {
  _id: string;
  user: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Order Types
// ============================================

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export type CheckoutType = "REGISTERED" | "GUEST";

export interface GuestContact {
  email: string;
  phone: string;
}

export interface OrderItem {
  product: string;
  productName: string;
  quantity: number;
  pricePerUnit: number; // in kobo
  subtotal: number; // in kobo
}

export interface StatusHistoryEntry {
  status: OrderStatus;
  timestamp: string;
  note?: string;
}

export interface Order {
  _id: string;
  checkoutType: CheckoutType;
  user?: string;
  guestContact?: GuestContact;
  items: OrderItem[];
  totalAmount: number; // in kobo
  deliveryFee?: number; // in kobo
  status: OrderStatus;
  idempotencyKey: string;
  shippingAddress: Address;
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// API Request Types
// ============================================

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  address: Address;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  otp: string;
  newPassword: string;
}

export interface UpdateProfileRequest {
  name?: string;
  address?: Partial<Address>;
}

export interface CreateProductRequest {
  name: string;
  description: string;
  price: number; // in kobo
  compareAtPrice?: number;
  costPrice?: number;
  category: string;
  imageUrl?: string;
}

export interface AddToCartRequest {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

export interface CreateOrderRequest {
  shippingAddress: Address;
  idempotencyKey: string;
}

export interface CreateGuestOrderRequest {
  guestContact: GuestContact;
  items: {
    productId: string;
    quantity: number;
  }[];
  shippingAddress: Address;
  idempotencyKey: string;
}

export interface ProcessPaymentRequest {
  amount: number; // in kobo
  paymentMethod: "CARD" | "BANK_TRANSFER" | "WALLET" | "USSD";
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface ApiError {
  success: false;
  message: string;
  code: string;
  statusCode: number;
}

export interface LoginResponse {
  success: true;
  message: string;
  user: User;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
}

export interface PaymentResponse {
  success: true;
  message: string;
  authorizationUrl: string;
  reference: string;
}

// ============================================
// Query Parameters
// ============================================

export interface ProductQueryParams {
  category?: string;
  isActive?: boolean;
  minPrice?: number; // in kobo
  maxPrice?: number; // in kobo
  search?: string;
  page?: number;
  limit?: number;
}

export interface OrderQueryParams {
  status?: OrderStatus;
  page?: number;
  limit?: number;
}

// ============================================
// Utility Types
// ============================================

export interface IdempotencyKeyGenerator {
  (): string;
}

export interface CurrencyFormatter {
  (kobo: number): string; // e.g., "₦1,234.56"
}

export interface CurrencyParser {
  (naira: number): number; // converts ₦ to kobo
}

// ============================================
// Constants
// ============================================

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Payment Pending",
  CONFIRMED: "Order Confirmed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  FAILED: "Payment Failed",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  UNVERIFIED: "Unverified",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
};

export const GUEST_MAX_ITEMS_TOTAL_NGN = 5000;
export const GUEST_MAX_ITEMS_TOTAL_KOBO = GUEST_MAX_ITEMS_TOTAL_NGN * 100;

// ============================================
// Helper Functions (implement in utils)
// ============================================

/**
 * Convert kobo to formatted Naira string
 * @example formatCurrency(123456) => "₦1,234.56"
 */
export const formatCurrency: CurrencyFormatter = (kobo: number): string => {
  const naira = kobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(naira);
};

/**
 * Convert Naira to kobo
 * @example toKobo(12.34) => 1234
 */
export const toKobo: CurrencyParser = (naira: number): number => {
  return Math.round(naira * 100);
};

/**
 * Generate unique idempotency key
 * @example generateIdempotencyKey() => "550e8400-e29b-41d4-a716-446655440000"
 */
export const generateIdempotencyKey: IdempotencyKeyGenerator = (): string => {
  return crypto.randomUUID();
};

/**
 * Get user-friendly order status label
 */
export const getOrderStatusLabel = (status: OrderStatus): string => {
  return ORDER_STATUS_LABELS[status] || status;
};

/**
 * Check if order can be cancelled
 */
export const canCancelOrder = (status: OrderStatus): boolean => {
  return status === "PENDING" || status === "CONFIRMED";
};

/**
 * Calculate cart total in kobo
 */
export const calculateCartTotal = (items: CartItem[]): number => {
  return items.reduce((total, item) => {
    return total + item.priceAtAdd * item.quantity;
  }, 0);
};

/**
 * Check if guest order exceeds limit
 */
export const exceedsGuestLimit = (totalKobo: number): boolean => {
  return totalKobo > GUEST_MAX_ITEMS_TOTAL_KOBO;
};
