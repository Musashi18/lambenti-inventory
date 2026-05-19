# Proposed Architecture

## High-Level Components

1. **Web Application**
   - inventory dashboard
   - item management
   - supplier management
   - purchase order review
2. **Application API**
   - inventory queries
   - demand planning
   - purchase order drafting
   - approval workflows
3. **Database**
   - persistent system of record
   - items
   - stock ledger
   - suppliers
   - purchase orders
   - bills of materials
   - audit log
4. **Agent Layer**
   - read inventory
   - forecast shortages
   - recommend purchases
   - draft purchase orders
5. **Integration Layer**
   - supplier portals
   - accounting tools
   - email or messaging notifications

## Recommended Principles

- Use a stock ledger, not just a mutable quantity field.
- Use the database as the source of truth for all operational data.
- Do not keep inventory state only in memory or transient files.
- Keep purchase recommendation separate from purchase execution.
- Represent BOMs explicitly so demand can be computed from build plans.
- Store agent reasoning and human decisions together for traceability.

## Suggested MVP Boundaries

Include:

- single organization
- multiple stock locations
- raw materials and assemblies
- manual supplier entry
- manual approval before purchase submission
- persistent relational storage with migrations and backups

Defer:

- automatic supplier integrations
- multi-currency complexity
- advanced forecasting
- barcode support
- accounting sync
