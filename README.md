# 🛡️ Atomic Vault (Order Management System)

A robust, high-integrity backend service architected for transactional reliability, financial reconciliation, and strict ACID compliance. Built as a **Modular Monolith**, Atomic Vault powers e-commerce operations while maintaining double-entry accounting precision.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

---

## ✨ Enterprise-Grade Features

### 🛒 E-Commerce Core
- **Product & Inventory Separation**: Read-heavy product catalog is decoupled from write-heavy inventory tracking to prevent write contention.
- **Optimistic Concurrency Control**: Prevents race conditions during high-traffic checkout events (e.g., flash sales) using MongoDB versioning keys (`__v`).
- **Finite State Machines (FSM)**: Strict, modeled state transitions for Users, Orders, and Inventory to eliminate invalid data states.

### 💰 Financial & Ledger Engine
- **Double-Entry Accounting**: Real-time, cryptographically sound ledger entries tracking all fund movements.
- **Paystack Reconciliation**: Automated synchronization of internal ledgers with external gateway payouts.
- **Automated Refund & Withdrawal Pipelines**: Deeply integrated into the FSM, ensuring funds are settled properly and tracked before mutating parent orders.

### 🛡️ Resilience & Fault Tolerance
- **Transactional Outbox Pattern**: Guarantees *at-least-once* message delivery for background events, completely bypassing dual-write failures.
- **ACID Transactions**: MongoDB Client Sessions are threaded through service methods. If an order fails mid-flight, inventory reservations roll back instantly.
- **Idempotency & Circuit Breakers**: Built-in idempotency keys prevent duplicate payments/orders, alongside retry-with-backoff for external API calls.

---

## 🏗️ Architecture & Patterns

- **Modular Monolith**: Organized strictly by domain (`Inventory`, `Product`, `Ledger`, `Settlement`).
- **Embedded Daemons**: Contains in-process workers (`ReservationReaper`, `OutboxProcessor`, `SettlementSync`) to handle background processing seamlessly.
- **Idempotency**: Prevents duplicate orders and payments on network retries.
- **Repository Pattern**: Business logic (`services/`) abstracts data access from HTTP transport (`controllers/`).

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (or local MongoDB with replica sets enabled for transactions)
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

# Type check via TypeScript
npm run type-check

# Build for production
npm run build

# Start production server
npm start
```

## ⚙️ Environment Variables

See `.env.example` for all available configuration options. Key variables:

```env
# Database
MONGODB_URI=mongodb+srv://...

# JWT & Auth
JWT_ACCESS_SECRET=your-secret
JWT_REFRESH_SECRET=your-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Password Reset
PASSWORD_RESET_OTP_TTL_MINUTES=15
PASSWORD_RESET_MAX_OTP_ATTEMPTS=5
PASSWORD_RESET_EMAIL_MAX_PER_HOUR=3

# SMTP Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-password
SMTP_FROM="Atomic Vault" <noreply@example.com>

# App Config
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

---

## 🔌 API Ecosystem

*Full documentation available in code via routing controllers.*

- **Users (`/api/users`)**: Registration, authentication (JWT/Cookies), FSM-based lifecycle (Unverified → Active → Suspended), MFA, OTP password resets.
- **Products (`/api/products`)**: Catalog CRUD, variants, filters, pagination, SEO management.
- **Inventory (`/api/inventory`)**: Atomic stock adjustments, reservation system, commitment.
- **Orders (`/api/orders`)**: Registered & Guest checkout workflows, Paystack webhook integration, shipping status.
- **Financials (`/api/wallets`, `/api/withdrawals`, `/api/settlements`, `/api/refunds`)**: Ledger tracking, wallet balances, admin payouts, and gateway reconciliation.
- **Storage (`/api/storage`)**: File/image upload handling via AWS S3 interfaces.

---

## ☁️ Deployment Strategy

Atomic Vault is fully compatible with **Vercel Serverless Functions**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/varletint/atomic-vault)

### Important Note for Vercel Deployments:
> **Warning**: Atomic Vault runs background daemons (`OutboxProcessor`, `ReservationReaper`) via `setInterval`. Because Vercel Serverless Functions suspend immediately after responding to HTTP requests, **these daemons will not fire reliably in production on Vercel**. You must configure external cron jobs (e.g., Vercel Cron, GitHub Actions, or cron-job.org) to ping the respective API endpoints to trigger background processing.

---

## 🔄 Finite State Machines

### User Lifecycle
`UNVERIFIED` → `ACTIVE` ↔ `SUSPENDED` → `DEACTIVATED`

### Inventory States
`AVAILABLE` → `RESERVED` → `COMMITTED` (or rolled back to `AVAILABLE`)

### Order Flow
`PENDING` → `CONFIRMED` → `SHIPPED` → `DELIVERED` 
(Cancel flows to `CANCELLED`, Payment drop flows to `FAILED`)

---

## 📂 Project Structure

```
src/
├── config/          # Environment & core setup
├── controllers/     # Express route handlers
├── middleware/      # Auth, Error boundary, CSRF, Rate-limiting
├── models/          # Mongoose Schemas (User, Ledger, Order, etc.)
├── payments/        # Gateway integrations (Paystack)
├── routes/          # Express route definitions
├── schemas/         # Zod validation schemas
├── services/        # Core business logic & domain handling
├── utils/           # Utilities, loggers, circuit breakers
└── workers/         # CLI execution scripts for daemons
```

## 📄 License
ISC
