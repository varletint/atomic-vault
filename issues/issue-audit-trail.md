# Issue: Implement Immutable Audit Trail for Inventory

## Description

Currently, stock adjustments and inventory updates may not leave a detailed historical ledger. We need a reliable audit trail to understand the chronology of stock changes, troubleshooting inventory drift, and verifying reservations or fulfillment behaviors over time.

## Expected Behavior

Every significant change to a product's stock (e.g., reservation, allocation, fulfillment, restock) must be recorded in an immutable ledger (e.g. `StockMovement` collection).

## Proposed Architecture / Tasks

1. Introduce a new `StockMovement` model schema that is append-only.
2. Update the `InventoryService` logic so that adjusting stock also reliably writes a movement record.
3. Utilize Outbox events to guarantee movement persistence alongside business actions in MongoDB transactions.
4. Expose endpoints (e.g. admin routes) to query the ledger (date range, product ID).

## Dependencies

- Mongoose transaction isolation
- `StockMovement` model integrating directly with Outbox processing
