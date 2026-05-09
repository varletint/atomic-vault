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
- **Finite State Machines (FSM)**: Strict, modeled state transitions for Users, Orders, Refunds, and Inventory to eliminate invalid data states.

### 💰 Financial & Ledger Engine

- **Double-Entry Accounting**: Every fund movement produces a balanced ledger entry — a debit on one account and a credit on another — so the books always reconcile.
- **Paystack Reconciliation**: Automated synchronization of internal ledgers with external gateway payouts.
- **Automated Refund & Withdrawal Pipelines**: Deeply integrated into the FSM, ensuring funds are settled properly and tracked before mutating parent orders.

### 🛡️ Resilience & Fault Tolerance

- **Transactional Outbox Pattern**: Guarantees _at-least-once_ message delivery for background events, completely bypassing dual-write failures.
- **ACID Transactions**: MongoDB Client Sessions are threaded through service methods. If an order fails mid-flight, inventory reservations roll back instantly.
- **Idempotency & Circuit Breakers**: Built-in idempotency keys prevent duplicate payments/orders, alongside retry-with-backoff for external API calls.

---

## 🏗️ Architecture & Patterns

- **Modular Monolith**: Organized strictly by domain (`Inventory`, `Product`, `Ledger`, `Settlement`).
- **Embedded Daemons**: Contains in-process workers (`ReservationReaper`, `OutboxProcessor`, `SettlementSync`) to handle background processing seamlessly.
- **Repository Pattern**: Business logic (`services/`) abstracts data access from HTTP transport (`controllers/`).

---

## 🧠 Key Design Decisions

### Why the Outbox Pattern?

Writing to MongoDB and dispatching a background event (e.g., send confirmation email, release inventory) are two separate operations. A process crash between them causes **silent event loss** — the order is saved but the side effect never fires. The outbox pattern solves this by writing the event _inside the same ACID transaction_ as the order mutation. A polling worker then reads and processes pending outbox entries independently, guaranteeing delivery without coupling the write path to background jobs.

### Why Two Separate FSMs (Order + Refund)?

Refund logic is complex enough to deserve its own state machine. Merging it into the order FSM would create a combinatorial explosion of invalid state combinations. A dedicated Refund FSM means refund lifecycle — approval routing, gateway retries, settlement — is fully isolated from order fulfillment. Each machine has a single responsibility and can fail independently without corrupting the other.

### Why Threshold-Based Refund Routing?

Not all refunds carry the same risk. Small refunds can be auto-approved instantly (low fraud exposure, high customer satisfaction). Large refunds above a configurable threshold are routed to `AWAITING_REVIEW` for manual admin approval before any gateway call is made. This prevents automated fraud exploitation while keeping the happy path fast.

### Why Reapers?

Network timeouts and partial failures leave FSM states stuck with no path forward. A `ReservationReaper` periodically scans for orders that entered `PAYMENT_PROCESSING` but never received a webhook confirmation — then either retries reconciliation or cancels and releases inventory. Without reapers, a single dropped webhook permanently locks stock.

### Why Double-Entry Accounting?

Single-column "balance update" approaches make auditing and reconciliation fragile — a bug silently adds or removes money with no paper trail. Double-entry ensures every transaction has two sides that must balance, making discrepancies immediately detectable. Example:

| Event                       | Debit                | Credit               |
| --------------------------- | -------------------- | -------------------- |
| Customer pays for order     | `buyer_wallet`       | `platform_escrow`    |
| Order confirmed, funds held | `platform_escrow`    | `settlement_pending` |
| Seller payout issued        | `settlement_pending` | `seller_wallet`      |
| Refund approved             | `seller_wallet`      | `buyer_wallet`       |

If any entry doesn't balance, reconciliation catches it immediately.

---

## 🔄 Finite State Machines

### Order Lifecycle

```
                        ┌─────────────────┐
                        │     PENDING      │
                        └────────┬────────┘
                                 │ OrderPlaced (auto)
                        ┌────────▼────────┐
              ┌─────────│PAYMENT_PROCESSING│─────────┐
              │         └────────┬────────┘         │
        PaymentFailed            │ PaymentSucceeded  │
              │            (auto/outbox)             │
    ┌─────────▼──────┐   ┌──────▼──────────┐        │
    │ PAYMENT_FAILED  │──▶│   CONFIRMED     │        │
    └────────────────┘   └──────┬──────────┘        │
                                │ FulfillmentAccepted│
                         ┌──────▼──────────┐        │
              ┌──────────│   PROCESSING    │──────── ┤
              │          └──────┬──────────┘  CancelOrder
          ON_HOLD               │ OrderShipped       │
              │          ┌──────▼──────────┐  ┌─────▼───────┐
              └─────────▶│    SHIPPED      │  │  CANCELLED  │
                         └──────┬──────────┘  └──────┬──────┘
                                │ DeliveryConfirmed   │ RefundIssued
                         ┌──────▼──────────┐  ┌──────▼──────┐
                         │   DELIVERED     │  │  REFUNDED   │
                         └──────┬──────────┘  └─────────────┘
                                │ ReturnRequested
                         ┌──────▼──────────┐
                         │ RETURN_REQUESTED │
                         └──────┬──────────┘
                       ┌────────┘ RefundIssued
               ┌───────▼──────┐
               │   RETURNING  │──── RefundIssued ────▶ REFUNDED
               └──────────────┘
```

> **Auto** transitions are outbox-driven. **Manual** transitions require an operator API call.

---

### Refund Lifecycle

```
                   ┌──────────────┐
                   │  REQUESTED   │──── ValidationFailed ────┐
                   └──────┬───────┘                          │
                           │ RefundRequested                  │
                   ┌───────▼──────┐                          │
                   │PENDING_APPROVAL│                         │
                   └──────┬───────┘                          │
           ┌──────────────┴──────────────────┐               │
  RefundValidated                   RefundValidated           │
  (auto-approve)                  (> threshold)               │
           │                             ┌───▼──────────────┐ │
    ┌──────▼──────┐         AdminApproves│ AWAITING_REVIEW  │◀┘
    │  PROCESSING │◀────────────────────┘└────────┬─────────┘
    └──────┬──────┘   GatewayFailure /             │ AdminRejects
           │           AdminRequeues               │
    GatewayTimeout                          ┌──────▼───────┐
           │                                │   REJECTED   │
    ┌──────▼──────┐                         └──────────────┘
    │   RETRYING  │──── RetryExhausted ────▶┌──────────────┐
    └──────┬──────┘                         │    FAILED    │
           │ AdminRequeues                  └──────────────┘
           └──────────────▶ PROCESSING
                   │
           RefundApproved
                   │
    ┌──────────────▼─────┐
    │   GATEWAY_PENDING  │
    └──────────┬─────────┘
               │ WebhookSettled
          ┌────▼──────┐
          │  SETTLED  │
          └────┬──────┘
               │ RefundSettled
          ┌────▼──────────┐
          │   COMPLETED   │
          └───────────────┘
```

> Reapers monitor `RETRYING` and `GATEWAY_PENDING` states for stalled transitions.

---

### User Lifecycle

`UNVERIFIED` → `ACTIVE` ↔ `SUSPENDED` → `DEACTIVATED`

### Inventory States

`AVAILABLE` → `RESERVED` → `COMMITTED` (or rolled back to `AVAILABLE` on cancel/timeout)

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

_Full documentation available in code via routing controllers._

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

### Important Note for Vercel Deployments

> **Warning**: Atomic Vault runs background daemons (`OutboxProcessor`, `ReservationReaper`) via `setInterval`. Because Vercel Serverless Functions suspend immediately after responding to HTTP requests, **these daemons will not fire reliably in production on Vercel**. You must configure external cron jobs (e.g., Vercel Cron, GitHub Actions, or cron-job.org) to ping the respective API endpoints to trigger background processing.

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
