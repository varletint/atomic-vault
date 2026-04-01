/**
 * Barrel export for all models.
 * Import from here: import { User, Order, Product } from "./models/index.js";
 */

export {
  User,
  type IUser,
  type UserStatus,
  type IUserStatusHistoryEntry,
} from "./User.js";
export {
  PasswordResetOtp,
  type IPasswordResetOtp,
} from "./PasswordResetOtp.js";
export {
  Product,
  type IProduct,
  type IProductImage,
  type IProductVariant,
  type IVariantOption,
  type IProductSeo,
  type IDimensions,
} from "./Product.js";
export { Inventory, type IInventory } from "./Inventory.js";
export { Cart, type ICart, type ICartItem } from "./Cart.js";
export {
  Order,
  type IOrder,
  type IOrderItem,
  type IGuestContact,
  type OrderStatus,
  type CheckoutType,
} from "./Order.js";
export {
  Transaction,
  type ITransaction,
  type TransactionStatus,
  type PaymentMethod,
} from "./Transaction.js";
export { TrackingEvent, type ITrackingEvent } from "./TrackingEvent.js";
export {
  OutboxEvent,
  type IOutboxEvent,
  type OutboxEventType,
  type OutboxStatus,
} from "./OutboxEvent.js";
export {
  NotificationLog,
  type INotificationLog,
  type NotificationChannel,
  type NotificationStatus,
  type NotificationType,
} from "./NotificationLog.js";
export { OrderDocument, type IOrderDocument, type OrderDocumentType } from "./OrderDocument.js";
