# Agent Operations

## Intended Agent Roles

### 1. Inventory Analyst Agent

Can:

- read item and stock data
- identify shortages
- compare supplier options
- create recommendations

Cannot:

- create live purchase orders
- submit external orders

### 2. Purchasing Agent

Can:

- draft purchase orders
- select preferred suppliers
- prepare approval packets

Cannot:

- submit orders without approval
- exceed spending limits

### 3. Operations Agent

Can:

- monitor build plans
- compare demand against available stock
- flag risks to production readiness

## Example Safe Agent Actions

- `GET /items`
- `GET /inventory/shortages`
- `POST /recommendations/reorder`
- `POST /purchase-orders/drafts`
- `GET /suppliers/{id}`

## Required Guardrails

1. Human approval before external purchasing.
2. Spending thresholds by role.
3. Immutable audit history.
4. Clear rationale for every recommendation.
5. No silent modification of master data.

## Example Reorder Recommendation Payload

```json
{
  "item_sku": "LED-STRIP-2700K",
  "current_stock": 18,
  "forecast_demand": 60,
  "shortage": 42,
  "recommended_order_quantity": 50,
  "supplier_id": "supplier_001",
  "reason": "Projected shortage for planned build batch."
}
```

