# Backend Analysis for Frontend Implementation

## System Overview

This is an e-commerce order management system built with:

- **Stack**: Node.js + TypeScript + Express + MongoDB (Mongoose)
- **Deployment**: Vercel Serverless Functions
- **Architecture**: FSM-based (Finite State Machines), ACID-compliant transactions
- **Auth**: JWT (access + refresh tokens via HTTP-only cookies)

## Core Business Logic

### 1. User Management (FSM-based)

**User Lifecycle States**:

```
UNVERIFIED → ACTIVE → SUSPENDED → DEACTIVATED
              ↓          ↓
         DEACTIVATED  DEACTIVATED
```

**User Roles**: `CUSTOMER`, `SUPPORT`, `ADMIN`

**Key Features**:

- Email verification required before full access
- Password reset via OTP (email-based, 15min TTL)
- Account suspension/deactivation (admin only)
- Failed login tracking with account lockout
- MFA support (TOTP, SMS, EMAIL)

### 2. Product & Inventory (Separated Models)

**Why Separated?**

- `Product` = catalog data (read-heavy, rarely changes)
- `Inventory` = stock tracking (write-heavy, changes on every order)
- Prevents write contention and enables better performance

**Inventory States**:

```
AVAILABLE → RESERVED → COMMITTED
              ↓
          AVAILABLE (on cancel)
```

**Stock Calculation**: `available = stock - reserved`

**Concurrency Control**: Optimistic locking via `__v` (version field)

### 3. Shopping Cart

- One cart per authenticated user
- Items store `priceAtAdd` (snapshot when added)
- Real-time inventory validation on checkout

### 4. Order Processing (FSM-based)

**Order Lifecycle**:

```
PENDING → CONFIRMED → SHIPPED → DELIVERED
   ↓         ↓
CANCELLED CANCELLED
   ↓         ↓
FAILED    FAILED
```

**Order Types**:

- **Registered**: Linked to user account
- **Guest**: Email + phone only, max ₦5,000 items total (configurable)

**Critical Features**:

- Idempotency keys prevent duplicate orders
- ACID transactions for order creation + inventory reservation
- Automatic inventory release on cancel/fail
- Payment integration with Paystack
- Status history tracking with timestamps

### 5. Payment Flow

1. Order created → status `PENDING`, inventory `RESERVED`
2. Payment initiated → Paystack integration
3. Payment success → order `CONFIRMED`, inventory `COMMITTED`
4. Payment failure → order `FAILED`, inventory released

**Webhook**: `/api/orders/webhook/paystack` for async payment notifications

---

## API Endpoints Reference

### Authentication & Users (`/api/users`)

| Method | Endpoint                | Auth  | Description                                        |
| ------ | ----------------------- | ----- | -------------------------------------------------- |
| POST   | `/register`             | No    | Create new account (status: UNVERIFIED)            |
| POST   | `/login`                | No    | Login (returns access + refresh tokens in cookies) |
| POST   | `/refresh`              | No    | Refresh access token using refresh token           |
| POST   | `/logout`               | No    | Clear auth cookies                                 |
| POST   | `/forgot-password`      | No    | Request password reset OTP via email               |
| POST   | `/reset-password`       | No    | Reset password with OTP + new password             |
| GET    | `/me`                   | Yes   | Get current user profile                           |
| GET    | `/:userId`              | Yes   | Get user by ID (self or admin)                     |
| GET    | `/email/:email`         | Yes   | Get user by email (self or admin)                  |
| PATCH  | `/:userId/profile`      | Yes   | Update profile (name, address)                     |
| PATCH  | `/:userId/verify-email` | Admin | Manually verify user email                         |
| PATCH  | `/:userId/suspend`      | Admin | Suspend user account                               |
| PATCH  | `/:userId/reactivate`   | Admin | Reactivate suspended account                       |
| PATCH  | `/:userId/deactivate`   | Admin | Permanently deactivate account                     |

### Products (`/api/products`)

| Method | Endpoint                 | Auth | Description                                  |
| ------ | ------------------------ | ---- | -------------------------------------------- |
| GET    | `/`                      | No   | List products (supports filters, pagination) |
| GET    | `/categories`            | No   | Get all product categories                   |
| GET    | `/:productId`            | No   | Get product by ID                            |
| GET    | `/sku/:sku`              | No   | Get product by SKU                           |
| POST   | `/`                      | Yes  | Create new product                           |
| PATCH  | `/:productId`            | Yes  | Update product details                       |
| PATCH  | `/:productId/deactivate` | Yes  | Deactivate product (soft delete)             |
| PATCH  | `/:productId/reactivate` | Yes  | Reactivate product                           |

**Query Parameters for GET /**:

- `category` - Filter by category
- `isActive` - Filter by active status (true/false)
- `minPrice` / `maxPrice` - Price range filter
- `search` - Text search in name/description
- `page` / `limit` - Pagination

### Inventory (`/api/inventory`)

| Method | Endpoint              | Auth | Description                   |
| ------ | --------------------- | ---- | ----------------------------- |
| GET    | `/:productId`         | No   | Get inventory for product     |
| PATCH  | `/:productId/adjust`  | Yes  | Adjust stock (add/remove)     |
| PATCH  | `/:productId/reserve` | Yes  | Reserve stock for order       |
| PATCH  | `/:productId/release` | Yes  | Release reserved stock        |
| PATCH  | `/:productId/commit`  | Yes  | Commit reservation (finalize) |

### Cart (`/api/cart`)

| Method | Endpoint            | Auth | Description           |
| ------ | ------------------- | ---- | --------------------- |
| GET    | `/`                 | Yes  | Get user's cart       |
| POST   | `/items`            | Yes  | Add item to cart      |
| PATCH  | `/items/:productId` | Yes  | Update item quantity  |
| DELETE | `/items/:productId` | Yes  | Remove item from cart |
| DELETE | `/`                 | Yes  | Clear entire cart     |

### Orders (`/api/orders`)

| Method | Endpoint                              | Auth | Description                              |
| ------ | ------------------------------------- | ---- | ---------------------------------------- |
| POST   | `/`                                   | Yes  | Create order from cart (registered user) |
| POST   | `/guest`                              | No   | Create guest order (max ₦5,000)          |
| GET    | `/`                                   | Yes  | Get user's order history                 |
| GET    | `/:orderId`                           | Yes  | Get order details                        |
| GET    | `/guest/:orderId`                     | No   | Get guest order details                  |
| PATCH  | `/:orderId/confirm`                   | Yes  | Confirm order (admin/support)            |
| PATCH  | `/:orderId/ship`                      | Yes  | Mark order as shipped                    |
| PATCH  | `/:orderId/deliver`                   | Yes  | Mark order as delivered                  |
| PATCH  | `/:orderId/cancel`                    | Yes  | Cancel order (releases inventory)        |
| PATCH  | `/:orderId/fail`                      | Yes  | Mark order as failed                     |
| POST   | `/:orderId/payment`                   | Yes  | Process payment for order                |
| GET    | `/:orderId/payment/verify/:reference` | Yes  | Verify payment status                    |
| POST   | `/webhook/paystack`                   | No   | Paystack webhook (async payment updates) |

---

## Data Models

### User

```typescript
{
  _id: ObjectId,
  name: string,
  email: string (unique, lowercase),
  password: string (hashed, select: false),
  role: "CUSTOMER" | "SUPPORT" | "ADMIN",
  status: "UNVERIFIED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
  isEmailVerified: boolean,
  auth: {
    failedLoginAttempts: number,
    lockedUntil?: Date,
    lastLoginAt?: Date,
    tokenVersion: number,
    mfa: { enabled, method, secretRef, backupCodesHash }
  },
  address: { street, city, state, zip, country },
  statusHistory: [{ status, timestamp, reason, actorId }],
  createdAt: Date,
  updatedAt: Date
}
```

### Product

```typescript
{
  _id: ObjectId,
  sku: string (unique, uppercase),
  slug: string (unique, lowercase),
  name: string,
  description: string,
  price: number (in kobo, ₦1 = 100 kobo),
  compareAtPrice?: number,
  costPrice?: number,
  category: string,
  imageUrl?: string,
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Inventory

```typescript
{
  _id: ObjectId,
  product: ObjectId (ref: Product, unique),
  stock: number (total physical stock),
  reserved: number (locked for pending orders),
  __v: number (version for optimistic locking),
  // Virtual field
  available: stock - reserved
}
```

### Cart

```typescript
{
  _id: ObjectId,
  user: ObjectId (ref: User, unique),
  items: [{
    product: ObjectId (ref: Product),
    quantity: number,
    priceAtAdd: number (snapshot in kobo)
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Order

```typescript
{
  _id: ObjectId,
  checkoutType: "REGISTERED" | "GUEST",
  user?: ObjectId (ref: User, null for guest),
  guestContact?: { email, phone },
  items: [{
    product: ObjectId,
    productName: string (snapshot),
    quantity: number,
    pricePerUnit: number (kobo),
    subtotal: number
  }],
  totalAmount: number (sum of item subtotals, kobo),
  deliveryFee?: number (kobo, not counted in guest limit),
  status: "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED",
  idempotencyKey: string (unique),
  shippingAddress: { street, city, state, zip, country },
  statusHistory: [{ status, timestamp, note }],
  createdAt: Date,
  updatedAt: Date
}
```

---

## Authentication Flow

### Registration

1. POST `/api/users/register` with `{ name, email, password, address }`
2. User created with status `UNVERIFIED`
3. Email verification required (admin can manually verify via PATCH `/:userId/verify-email`)

### Login

1. POST `/api/users/login` with `{ email, password }`
2. Returns HTTP-only cookies:
   - `accessToken` (15min default)
   - `refreshToken` (7d default)
3. Response includes user object (without password)

### Token Refresh

1. POST `/api/users/refresh` (no body needed)
2. Uses `refreshToken` cookie
3. Returns new `accessToken` cookie

### Logout

1. POST `/api/users/logout`
2. Clears auth cookies

### Password Reset

1. POST `/api/users/forgot-password` with `{ email }`
2. OTP sent to email (15min TTL, max 5 attempts, max 3 emails/hour)
3. POST `/api/users/reset-password` with `{ email, otp, newPassword }`

---

## Shopping Flow

### For Registered Users

1. **Browse Products**: GET `/api/products` (with filters)
2. **Add to Cart**: POST `/api/cart/items` with `{ productId, quantity }`
3. **View Cart**: GET `/api/cart`
4. **Update Cart**: PATCH `/api/cart/items/:productId` or DELETE
5. **Checkout**: POST `/api/orders` with `{ shippingAddress, idempotencyKey }`
   - Creates order with status `PENDING`
   - Reserves inventory atomically
   - Clears cart
6. **Payment**: POST `/api/orders/:orderId/payment` with `{ amount, paymentMethod }`
   - Integrates with Paystack
   - Returns payment URL/reference
7. **Verify Payment**: GET `/api/orders/:orderId/payment/verify/:reference`
   - Or wait for webhook
8. **Track Order**: GET `/api/orders/:orderId`

### For Guest Users

1. **Browse Products**: Same as registered
2. **Direct Checkout**: POST `/api/orders/guest` with:

   ```json
   {
     "guestContact": { "email", "phone" },
     "items": [{ "productId", "quantity" }],
     "shippingAddress": { ... },
     "idempotencyKey": "unique-string"
   }
   ```

   - Max ₦5,000 items total (excludes delivery fee)
   - Instant payment methods only

3. **Track Order**: GET `/api/orders/guest/:orderId`

---

## Error Handling

All errors follow this format:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

**Common Error Codes**:

- `UNAUTHORIZED` (401) - Missing/invalid token
- `FORBIDDEN` (403) - Insufficient permissions
- `NOT_FOUND` (404) - Resource not found
- `VALIDATION_ERROR` (400) - Invalid input
- `CONFLICT` (409) - Duplicate resource (email, SKU, etc.)
- `INSUFFICIENT_STOCK` (400) - Not enough inventory
- `INVALID_STATE_TRANSITION` (400) - FSM violation

---

## CORS Configuration

**Development**: All origins allowed
**Production**: Restricted to `FRONTEND_URL` environment variable

**Allowed Methods**: GET, POST, PATCH, DELETE
**Credentials**: Enabled (for cookies)

---

## Environment Variables

### Required

```env
MONGODB_URI=mongodb+srv://...
JWT_ACCESS_SECRET=your-secret
JWT_REFRESH_SECRET=your-secret
FRONTEND_URL=http://localhost:5173
NODE_ENV=development|production
```

### Optional (with defaults)

```env
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PASSWORD_RESET_OTP_TTL_MINUTES=15
PASSWORD_RESET_MAX_OTP_ATTEMPTS=5
PASSWORD_RESET_EMAIL_MAX_PER_HOUR=3
ORDER_GUEST_MAX_ITEMS_TOTAL_NGN=5000
```

### SMTP (required in production)

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_FROM="Order System" <noreply@example.com>
```

---

## Key Implementation Notes for Frontend

### 1. Currency Handling

- All prices stored in **kobo** (₦1 = 100 kobo)
- Display: divide by 100 and format as ₦X,XXX.XX
- Send to API: multiply by 100

### 2. Authentication

- Tokens stored in HTTP-only cookies (automatic)
- Include `credentials: 'include'` in fetch/axios
- Handle 401 errors → redirect to login
- Implement token refresh on 401 (try refresh, then logout)

### 3. Idempotency Keys

- Generate unique key per checkout attempt (UUID recommended)
- Store in localStorage/sessionStorage during checkout
- Prevents duplicate orders on retry/refresh

### 4. Real-time Validation

- Check inventory before adding to cart
- Validate cart before checkout
- Handle `INSUFFICIENT_STOCK` errors gracefully

### 5. Guest Checkout Limits

- Max ₦5,000 items total (configurable via env)
- Delivery fee NOT counted toward limit
- Show warning when approaching limit
- Suggest registration for larger orders

### 6. Order Status Display

Map backend statuses to user-friendly labels:

- `PENDING` → "Payment Pending"
- `CONFIRMED` → "Order Confirmed"
- `SHIPPED` → "Shipped"
- `DELIVERED` → "Delivered"
- `CANCELLED` → "Cancelled"
- `FAILED` → "Payment Failed"

### 7. Payment Integration

- Backend returns Paystack authorization URL
- Redirect user to Paystack
- Handle callback/redirect back to your site
- Verify payment via API or wait for webhook
- Show loading state during verification

### 8. Error Handling Strategy

```javascript
try {
  const response = await fetch("/api/endpoint", {
    credentials: "include",
    // ...
  });

  if (!response.ok) {
    const error = await response.json();
    // Handle specific error codes
    if (error.code === "INSUFFICIENT_STOCK") {
      // Show stock error
    } else if (error.statusCode === 401) {
      // Try refresh token, then logout
    }
    throw new Error(error.message);
  }

  const data = await response.json();
  return data;
} catch (error) {
  // Show user-friendly error
}
```

### 9. Pagination

Products endpoint supports:

- `page` (default: 1)
- `limit` (default: 10)
- Response includes: `{ data, pagination: { page, limit, total, pages } }`

### 10. Search & Filters

Products support:

- Text search: `?search=keyword`
- Category filter: `?category=Electronics`
- Price range: `?minPrice=1000&maxPrice=5000` (in kobo)
- Active only: `?isActive=true`
- Combine multiple filters

---

## Recommended Frontend Structure

```
frontend/
├── src/
│   ├── api/
│   │   ├── auth.ts          # Login, register, logout, refresh
│   │   ├── products.ts      # Product listing, details
│   │   ├── cart.ts          # Cart operations
│   │   ├── orders.ts        # Order creation, tracking
│   │   └── client.ts        # Base fetch/axios config
│   ├── components/
│   │   ├── auth/
│   │   ├── products/
│   │   ├── cart/
│   │   └── orders/
│   ├── contexts/
│   │   ├── AuthContext.tsx  # User state, login/logout
│   │   └── CartContext.tsx  # Cart state management
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useCart.ts
│   │   └── useOrders.ts
│   ├── pages/
│   │   ├── Home.tsx
│   │   ├── Products.tsx
│   │   ├── ProductDetail.tsx
│   │   ├── Cart.tsx
│   │   ├── Checkout.tsx
│   │   ├── Orders.tsx
│   │   ├── Login.tsx
│   │   └── Register.tsx
│   ├── utils/
│   │   ├── currency.ts      # Kobo ↔ Naira conversion
│   │   ├── idempotency.ts   # UUID generation
│   │   └── validation.ts
│   └── types/
│       └── api.ts           # TypeScript interfaces
```

---

## Testing Checklist

### Authentication

- [ ] Register new user
- [ ] Login with valid credentials
- [ ] Login with invalid credentials
- [ ] Token refresh on expiry
- [ ] Logout clears cookies
- [ ] Password reset flow

### Products

- [ ] List all products
- [ ] Filter by category
- [ ] Search products
- [ ] View product details
- [ ] Check inventory availability

### Cart (Registered)

- [ ] Add item to cart
- [ ] Update quantity
- [ ] Remove item
- [ ] Clear cart
- [ ] Cart persists across sessions

### Checkout (Registered)

- [ ] Create order from cart
- [ ] Inventory reserved
- [ ] Cart cleared after order
- [ ] Duplicate prevention (idempotency)
- [ ] Payment flow
- [ ] Order status updates

### Guest Checkout

- [ ] Create guest order
- [ ] Enforce ₦5,000 limit
- [ ] Track order without login
- [ ] Payment flow

### Edge Cases

- [ ] Insufficient stock handling
- [ ] Concurrent order attempts
- [ ] Network errors during checkout
- [ ] Payment webhook delays
- [ ] Token expiry during checkout

---

## API Base URL

**Development**: `http://localhost:3000`
**Production**: Your Vercel deployment URL

Configure via environment variable in frontend:

```env
VITE_API_BASE_URL=http://localhost:3000
```

---

## Next Steps

1. Set up frontend project (React/Vue/Next.js)
2. Configure API client with credentials support
3. Implement authentication context/store
4. Build product listing with filters
5. Implement cart functionality
6. Build checkout flow with payment
7. Add order tracking
8. Test thoroughly with backend

---

## Support & Documentation

- Backend README: `README.md`
- Setup Guide: `SETUP.md`
- Deployment Guide: `DEPLOYMENT.md`
- CORS Configuration: `docs/CORS.md`

For questions about specific endpoints or business logic, refer to:

- Controllers: `src/controllers/`
- Services: `src/services/`
- Models: `src/models/`
