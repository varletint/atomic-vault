# Order Management System

A robust, high-integrity backend service architected for transactional reliability and strict ACID compliance.

## Features

- **User Management**: Registration, authentication, FSM-based account lifecycle
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

```env
MONGODB_URI=mongodb+srv://...
JWT_ACCESS_SECRET=your-secret
JWT_REFRESH_SECRET=your-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## API Endpoints

### Users (`/api/users`)

- `POST /register` - Create account
- `POST /login` - Authenticate
- `POST /refresh` - Refresh access token
- `GET /profile` - Get user profile
- `PATCH /profile` - Update profile
- `PATCH /verify` - Verify email
- `PATCH /suspend` - Suspend account
- `PATCH /reactivate` - Reactivate account
- `PATCH /deactivate` - Deactivate account

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

- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_EXPIRES_IN`
- `FRONTEND_URL`
- `NODE_ENV=production`

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
