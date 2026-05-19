# System Requirements

## Core Functional Requirements

1. Manage items, categories, units of measure, and part numbers.
2. Track quantities by location.
3. Record suppliers, lead times, prices, and minimum order quantities.
4. Support stock adjustments with reason codes.
5. Represent bills of materials for Lambenti products and assemblies.
6. Compare build demand against available stock.
7. Produce low-stock and shortage alerts.
8. Draft purchase orders from reorder recommendations.
9. Maintain a complete audit trail of inventory and purchasing actions.
10. Expose an API suitable for future software agents.
11. Persist all operational records, including inventory, purchasing, recommendations, approvals, and audit events, across application restarts.

## Agent-Oriented Requirements

1. Agent actions must be structured and machine-readable.
2. High-impact actions must be approval-gated.
3. Every recommendation should include rationale:
   - why the item is needed
   - current stock
   - forecast demand
   - supplier choice
   - estimated cost
4. Agents should never overwrite historical records.
5. System should support idempotent operations where practical.

## Non-Functional Requirements

- Clear auditability
- Role-based permissions
- Reliable data validation
- Durable persistent storage for all system-of-record data
- Backup and restore capability
- Fast search across parts and suppliers
- Exportable reports
- Simple enough to operate during early-stage production
