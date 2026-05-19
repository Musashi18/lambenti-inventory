# Data Model

## Persistence Rules

- All entities in this document are persisted in the primary database.
- The stock ledger and audit log are append-only records.
- Derived inventory totals may be cached for performance, but they are always rebuildable from persisted source data.
- Purchase orders, approvals, and agent recommendations must survive restarts and remain queryable historically.

## Core Entities

### Item

- `id`
- `sku`
- `name`
- `description`
- `category`
- `unit_of_measure`
- `is_active`
- `default_supplier_id`
- `reorder_point`
- `minimum_order_quantity`

### Supplier

- `id`
- `name`
- `contact_name`
- `email`
- `lead_time_days`
- `currency`
- `notes`

### Location

- `id`
- `name`
- `type`

### StockLedgerEntry

- `id`
- `item_id`
- `location_id`
- `quantity_delta`
- `reason`
- `reference_type`
- `reference_id`
- `created_at`

### BillOfMaterials

- `id`
- `parent_item_id`
- `version`
- `status`

### BillOfMaterialsLine

- `id`
- `bom_id`
- `component_item_id`
- `quantity_per_unit`

### BuildPlan

- `id`
- `name`
- `target_item_id`
- `target_quantity`
- `planned_start_date`
- `status`

### PurchaseOrder

- `id`
- `supplier_id`
- `status`
- `created_by`
- `approved_by`
- `submitted_at`

### PurchaseOrderLine

- `id`
- `purchase_order_id`
- `item_id`
- `quantity`
- `unit_price`

### AgentRecommendation

- `id`
- `recommendation_type`
- `payload`
- `rationale`
- `status`
- `created_at`

### AuditEvent

- `id`
- `actor_type`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `payload`
- `created_at`

## Derived Values

- stock on hand = sum of stock ledger entries
- available stock = on hand - allocated stock
- shortage = demand - available stock
- reorder quantity = max(shortage, minimum order quantity)
