# Wallet + Double-Entry Ledger + Transaction Events (Implementation Guide)

This guide describes a **fintech-grade** approach for this codebase:

- **Option B**: `TransactionEvent` collection (append-only) for lifecycle tracking
- **Global `AuditLog`**: for admin/user actions and privileged changes
- **Double-entry ledger**: `LedgerEntry` (journal lines) is the accounting source of truth
- **Wallet**: a projection/cache of balances for fast reads

It is written so you can implement **from models upward**: models → services → controllers/routes → workers/events → tests.

---

## Goals & invariants (non-negotiable rules)

### Money rules
- Store money in **minor units** (kobo) as **integers**.
- Never use floating point for money.
- Enforce integer + bounds at **validation boundary** (request schema + DB schema).

### Ledger rules
- `LedgerEntry` is **append-only**. No updates/deletes. Fix mistakes with **reversal** entries.
- Wallet balances are updated **only** by the ledger posting service.
- Every posting operation is **atomic**: create `TransactionEvent` + ledger entries + wallet balance update in **one Mongo transaction**.

### Idempotency rules
- Every external event must be idempotent:
  - Paystack webhook retries
  - verify endpoints called multiple times
  - admin retries
- Use **unique idempotency keys** on `Transaction` and/or on posting operations.

### Observability rules
- Every posting should carry:
  - `actor` (SYSTEM/ADMIN/USER)
  - `source` (e.g. `paystack:webhook`)
  - `traceId` (request correlation id)

---

## Domain model (what each collection means)

### `Transaction` (business intent/envelope)
You already have `src/models/Transaction.ts`.

**Role**: represents a payment/refund/payout intent and gateway reference, with a status lifecycle.

**Recommended evolution** (keep existing fields; add these over time):
- `type`: `"ORDER_PAYMENT" | "REFUND" | "PAYOUT" | "TRANSFER" | "ADJUSTMENT"`
- `amountGross` (kobo int)
- `gatewayFee` (kobo int, optional; from Paystack `fees`)
- `amountNet` (kobo int, derived or stored)
- `referenceType` + `referenceId` (e.g. `Order`)
- `postedAt` (when ledger posting occurred)
- Provider fields:
  - `providerRef` (already)
  - optional `providerEventId` (if you store Paystack event id)

**Key point**: A `Transaction` is not “accounted for” until its ledger entries are posted. Posting is recorded via events and/or `postedAt`.

### `TransactionEvent` (append-only lifecycle tracking)
**Role**: immutable history of state transitions and reasons (disputes/debugging).

Fields:
- `_id`
- `transactionId`
- `previousStatus`
- `newStatus`
- `reason` (e.g. `payment_confirmed`, `webhook_charge_success`, `admin_mark_failed`)
- `actor`: `{ type: "SYSTEM" | "ADMIN" | "USER", id?: ObjectId }`
- `source`: string (e.g. `paystack:webhook`, `admin:panel`)
- `traceId`: string
- `metadata`: optional (sanitized)
- `createdAt`

Indexes:
- `{ transactionId: 1, createdAt: 1 }`
- Optional: `{ traceId: 1 }`

Rules:
- Insert-only.
- Every status change in `Transaction` writes exactly one `TransactionEvent`.

### `Wallet` (projection/cache)
**Role**: fast balance reads and enforcing “can spend?” checks.

Fields (recommended):
- `ownerType`: `"USER" | "STORE" | "VENDOR"` (or simplify to just `user`)
- `ownerId`
- `currency` (default `NGN`, uppercase)
- `available` (kobo int)
- `pending` (kobo int; optional but recommended)
- `status`: `"ACTIVE" | "FROZEN"`
- timestamps

Indexes:
- Unique `{ ownerType: 1, ownerId: 1, currency: 1 }`

Rules:
- Updated only inside ledger posting service (no direct `$inc` elsewhere).

### `LedgerEntry` (double-entry journal lines)
**Role**: the source-of-truth accounting record.

Think of each posted `Transaction` producing **N ledger entries** (journal lines).

Fields:
- `transactionId` (the envelope)
- `walletId` (the affected wallet)
- `currency`
- `bucket`: `"AVAILABLE" | "PENDING"`
- `direction`: `"DEBIT" | "CREDIT"`
- `amount` (kobo int, positive)
- `entryType`: `"PAYMENT" | "FEE" | "REFUND" | "REVERSAL" | "TRANSFER"`
- `narration` (short description)
- `actor`: `{ type: "SYSTEM" | "ADMIN" | "USER", id?: ObjectId }`
- `source`: string
- `traceId`: string
- `dedupeKey`: optional (unique per wallet if you need)
- Optional audit helpers:
  - `balanceAfterAvailable`
  - `balanceAfterPending`
- `createdAt`

Indexes:
- `{ walletId: 1, createdAt: 1 }` (statements)
- `{ transactionId: 1 }` (fetch all lines)
- Optional unique `{ walletId: 1, dedupeKey: 1 }` (if used)

Rules:
- Insert-only.
- Corrections are new entries (REVERSAL), never edits.

---

## Step-by-step implementation plan

## Phase 0 — Decide scope (store wallet vs user wallets)
Choose the minimal viable scope:

- **Store-only wallet** (simplest): you track what the business receives from Paystack.
  - 1 wallet: `(ownerType=STORE, ownerId=storeId, currency=NGN)`
- **User wallets** (more complex): store credit, internal transfers, withdrawals.

This guide assumes you start with **store-only** and can extend later.

---

## Phase 1 — Models

### 1.1 Create `src/models/Wallet.ts`
Checklist:
- Schema with integer validators for balances.
- Unique index on `(ownerType, ownerId, currency)`.
- Defaults: `available=0`, `pending=0`, `status=ACTIVE`.

### 1.2 Create `src/models/LedgerEntry.ts`
Checklist:
- Amount integer validator (`Number.isInteger`), min 1.
- Enum fields: `bucket`, `direction`, `entryType`.
- Indexes: `(walletId, createdAt)`, `(transactionId)`.
- Ensure immutable semantics by convention (no update paths in services).

### 1.3 Create `src/models/TransactionEvent.ts`
Checklist:
- Append-only events with `(transactionId, createdAt)` index.
- `previousStatus`, `newStatus` stored explicitly.
- `actor/source/traceId` required.

### 1.4 Update `src/models/Transaction.ts` (minimal changes first)
Recommended minimal adds (optional to do now, but helpful):
- `type` (start with `"ORDER_PAYMENT"` only)
- `gatewayFee` (kobo int; store Paystack `fees`)
- `postedAt` (Date)

Avoid changing too much at once; you can evolve once posting works.

---

## Phase 2 — Services (the “posting engine”)

### 2.1 Create `src/services/LedgerService.ts`
This service should be the **only** place that:
- creates `LedgerEntry`
- updates `Wallet` balances

Expose one main method:

**`postTransactionJournal(params)`**
- Inputs:
  - `transactionId`
  - `journalLines[]` (computed lines)
  - `actor/source/traceId`
  - `idempotencyKey` (per posting)
- Behavior:
  - Starts a Mongo session/transaction.
  - Ensures idempotency:
    - either check `Transaction.postedAt`
    - or use a unique posting key in a `TransactionEvent`/`LedgerEntry` dedupe key
  - For each line:
    - `$inc` wallet balances with the delta (credit +, debit -) in the correct bucket
    - enforce non-negative balances if required
    - insert `LedgerEntry` capturing optional `balanceAfter*`
  - Mark transaction posted (`postedAt = now`) and write a `TransactionEvent`.
  - Commit.

### 2.2 Create `src/services/TransactionEventService.ts` (optional)
If you prefer separation:
- `recordTransition(transactionId, previous, next, reason, actor, source, traceId, metadata?)`

### 2.3 Integrate with existing `OrderService.verifyPayment`
In `src/services/OrderService.ts` (verify payment flow):
- After Paystack confirms success:
  - Update `Transaction.status` → `SUCCESS`
  - Write `TransactionEvent` (VERIFYING → SUCCESS)
  - Post ledger journal (store wallet):
    - CREDIT store wallet: `amountPaid` (PAYMENT)
    - DEBIT store wallet: `gatewayFee` (FEE) if fee exists
  - Update `Order.payment.*` and `Order.status` → `CONFIRMED`
- Do all the above in **one** Mongo session/transaction.

**Concurrency hardening**:
- Make status transitions atomic:
  - e.g. update transaction where `status != SUCCESS` and set to `VERIFYING` first
  - if no document modified → someone already processed; exit idempotently

---

## Phase 3 — Controllers & routes

### 3.1 Paystack webhook controller path
You already have:
- Raw body route in `src/index.ts` for `/api/orders/webhook/paystack`
- Signature verification in `src/payments/paystack-client.ts`
- Controller: `src/controllers/OrderController.ts` (`paystackWebhook`)

Enhance the webhook handler behavior:
- Parse + verify signature (already).
- Derive a stable idempotency key, e.g.:
  - `paystack:charge.success:{reference}`
- Call `OrderService.verifyPayment(reference, context)` once:
  - context includes `actor=SYSTEM`, `source=paystack:webhook`, `traceId`

### 3.2 Admin endpoints (optional, but plan for them)
If you support manual actions:
- `POST /admin/transactions/:id/reverse`
- `POST /admin/wallets/:id/adjust`

Rules:
- Admin actions must:
  - require elevated auth
  - write to global `AuditLog`
  - create a new `Transaction` of type `ADJUSTMENT/REVERSAL`
  - post ledger entries (never edit old ones)
  - add `TransactionEvent` transitions

---

## Phase 4 — Audit logs (global)

Use your existing `AuditLog` model for cross-cutting actions:
- admin adjustments
- reversals
- role changes
- security-sensitive events

Do **not** try to log every ledger line into `AuditLog` (too noisy). `LedgerEntry` is already an audit trail.

---

## Phase 5 — Reporting, statements, reconciliation

### 5.1 Wallet statement API (read-only)
Implement:
- `GET /wallets/:id/ledger?from&to&limit`
  - reads from `LedgerEntry` indexed by `(walletId, createdAt)`

### 5.2 Reconciliation job (periodic)
Implement a job that:
- recomputes wallet balance from ledger entries
- compares to `Wallet.available/pending`
- alerts on mismatch

### 5.3 Optional snapshots
If statements/reporting become heavy:
- store `WalletSnapshot` with `(walletId, asOf, available, pending, ledgerHead)`
- use it as a checkpoint for faster “balance as-of” queries

---

## Event-driven additions (fits your existing Outbox)

After successful posting (after commit), enqueue outbox events:
- `transaction.posted`
- `wallet.updated`
- `order.confirmed`

These should be used for:
- notifications
- analytics
- downstream projections

Do **not** use events as the source of truth for balances (ledger remains truth).

---

## Testing checklist (minimum)

### Unit tests
- Posting produces correct journal lines for:
  - order payment with fee
  - order payment without fee
  - reversal
- Idempotency: same posting called twice → ledger lines not duplicated.

### Integration tests
- Concurrent webhook deliveries (2 requests same reference) → single SUCCESS posting.
- Wallet balance equals sum of ledger deltas.

### Security tests
- Webhook signature invalid → no state changes.
- Admin reversal requires admin auth and writes `AuditLog`.

---

## Suggested file map (consistent with your repo structure)
- `src/models/Wallet.ts`
- `src/models/LedgerEntry.ts`
- `src/models/TransactionEvent.ts`
- `src/services/LedgerService.ts`
- `src/services/TransactionEventService.ts` (optional)
- `src/controllers/WalletController.ts` (read-only statements)
- `src/routes/walletRoutes.ts`

---

## Paystack-specific notes
- Use Paystack `verify`/webhook payload to set:
  - `Transaction.providerRef = reference`
  - `Transaction.amount` (kobo)
  - `Transaction.gatewayFee` from `fees` (kobo)
- Never compute gateway fees locally; always trust provider’s confirmed values.

