# Order Management System

A robust, high-integrity backend service architected for transactional reliability and strict ACID compliance.

## Features

- **User Management**: Registration, authentication, password reset (OTP via email), FSM-based account lifecycle
- **Product Catalog**: Product CRUD with inventory tracking
- **Inventory Management**: FSM-based stock reservation system (AVAILABLE → RESERVED → COMMITTED)
- **Shopping Cart**: Real-time inventory validation
- **Order Processing**: FSM-based order lifecycle with automatic inventory management
- **Payment Integration**: Idempotent payment processing with transaction tracking

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (access + refresh tokens)
- **Deployment**: Vercel Serverless Functions

## Architecture Patterns

- **Finite State Machines (FSM)**: User status, Order status, Inventory states
- **ACID Transactions**: MongoDB sessions for data consistency
- **Optimistic Concurrency Control**: Prevents race conditions in inventory
- **Idempotency**: Prevents duplicate orders and payments
- **Repository Pattern**: Service layer abstracts data access

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Update .env with your MongoDB URI and JWT secrets
```

### Development

```bash
# Run in development mode with hot reload
npm run dev

# Type check
npm run type-check

# Build for production
npm run build

# Start production server
npm start
```

### Environment Variables

See `.env.example` for all available configuration options. Key variables:

```env
# Database
MONGODB_URI=mongodb+srv://...

# JWT
JWT_ACCESS_SECRET=your-secret
JWT_REFRESH_SECRET=your-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Password Reset (OTP via email)
PASSWORD_RESET_OTP_TTL_MINUTES=15
PASSWORD_RESET_MAX_OTP_ATTEMPTS=5
PASSWORD_RESET_EMAIL_MAX_PER_HOUR=3

# SMTP (optional in dev - OTP logged if unset)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_FROM="Order System" <noreply@example.com>

# Server
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## API Endpoints

### Users (`/api/users`)

- `POST /register` - Create account
- `POST /login` - Authenticate
- `POST /refresh` - Refresh access token
- `POST /forgot-password` - Request password reset OTP
- `POST /reset-password` - Reset password with OTP
- `GET /me` - Get current user profile (auth)
- `GET /:userId` - Get user by ID (auth)
- `PATCH /:userId/profile` - Update profile (auth)
- `PATCH /:userId/verify-email` - Verify email (admin)
- `PATCH /:userId/suspend` - Suspend account (admin)
- `PATCH /:userId/reactivate` - Reactivate account (admin)
- `PATCH /:userId/deactivate` - Deactivate account (admin)

### Products (`/api/products`)

- `GET /` - List products (with filters, pagination)
- `GET /categories` - Get categories
- `GET /:productId` - Get product by ID
- `GET /sku/:sku` - Get product by SKU
- `POST /` - Create product (auth)
- `PATCH /:productId` - Update product (auth)
- `PATCH /:productId/deactivate` - Deactivate (auth)
- `PATCH /:productId/reactivate` - Reactivate (auth)

### Inventory (`/api/inventory`)

- `GET /:productId` - Get inventory
- `PATCH /:productId/adjust` - Adjust stock (auth)
- `PATCH /:productId/reserve` - Reserve stock (auth)
- `PATCH /:productId/release` - Release reservation (auth)
- `PATCH /:productId/commit` - Commit reservation (auth)

### Cart (`/api/cart`)

- `GET /` - Get cart (auth)
- `POST /items` - Add item (auth)
- `PATCH /items/:productId` - Update quantity (auth)
- `DELETE /items/:productId` - Remove item (auth)
- `DELETE /` - Clear cart (auth)

### Orders (`/api/orders`)

- `POST /` - Create order (auth)
- `GET /` - Get user orders (auth)
- `GET /:orderId` - Get order details (auth)
- `PATCH /:orderId/confirm` - Confirm order (auth)
- `PATCH /:orderId/ship` - Ship order (auth)
- `PATCH /:orderId/deliver` - Deliver order (auth)
- `PATCH /:orderId/cancel` - Cancel order (auth)
- `PATCH /:orderId/fail` - Fail order (auth)
- `POST /:orderId/payment` - Process payment (auth)

## Deployment to Vercel

### One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/order-system)

### Manual Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Environment Variables on Vercel

Add these in Vercel Dashboard → Settings → Environment Variables:

Required:

- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `FRONTEND_URL`
- `NODE_ENV=production`

SMTP (required in production for password reset):

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Optional (with defaults):

- `PASSWORD_RESET_OTP_TTL_MINUTES` (default: 15)
- `PASSWORD_RESET_MAX_OTP_ATTEMPTS` (default: 5)
- `PASSWORD_RESET_EMAIL_MAX_PER_HOUR` (default: 3)

**Note**: In production, `SMTP_HOST` must be configured or password reset requests will fail. In development, OTPs are logged to console if SMTP is not configured.

## FSM State Diagrams

### User Status

```
UNVERIFIED → ACTIVE → SUSPENDED → DEACTIVATED
              ↓          ↓
         DEACTIVATED  DEACTIVATED
```

### Order Status

```
PENDING → CONFIRMED → SHIPPED → DELIVERED
   ↓         ↓
CANCELLED CANCELLED
   ↓         ↓
FAILED    FAILED
```

### Inventory State

```
AVAILABLE → RESERVED → COMMITTED
              ↓
          AVAILABLE (on cancel)
```

## Project Structure

```
src/
├── controllers/     # Request handlers
├── middleware/      # Auth, error handling, async wrapper
├── models/          # Mongoose schemas
├── routes/          # Express routes
├── services/        # Business logic with FSM
├── utils/           # JWT, errors, helpers
└── index.ts         # App entry point

api/
└── index.ts         # Vercel serverless handler

vercel.json          # Vercel configuration
```

## License

ISC
