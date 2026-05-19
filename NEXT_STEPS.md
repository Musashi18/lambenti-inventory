# Next Steps

## Phase 1: Define the operating baseline

1. Confirm the initial part catalog for Lambenti:
   - magnets
   - LEDs
   - PCBs
   - enclosures
   - diffusers
   - cables
   - fasteners
   - packaging
2. Decide the first stock locations to track:
   - studio
   - workshop
   - contract manufacturer
3. Set reorder policies for each item:
   - minimum stock
   - reorder point
   - preferred supplier
   - lead time

## Phase 2: Build the MVP

1. Create a persistent PostgreSQL database from the entities in `docs/data-model.md`.
2. Build CRUD screens for:
   - items
   - suppliers
   - locations
   - stock adjustments
3. Add low-stock alerts and reorder recommendations.
4. Add a purchase order workflow with human approval.
5. Import the starter CSVs from `data/`.
6. Add database migrations plus a basic backup and restore process.

## Phase 3: Prepare for agents

1. Expose safe API actions for:
   - reading inventory
   - forecasting shortages
   - drafting purchase orders
   - checking supplier lead times
2. Add an approval gate before any order is sent externally.
3. Store every agent recommendation and action in the audit log.
4. Define permissions for:
   - read-only agent
   - planner agent
   - purchasing agent

## Phase 4: Add automation

1. Generate purchase recommendations from:
   - demand forecast
   - current stock
   - open purchase orders
   - supplier lead times
2. Support budget rules and vendor preferences.
3. Integrate with supplier systems or procurement tools.
4. Move from recommendation to supervised automatic purchasing.

## Immediate Decisions Needed

- Which software stack do you want for the MVP?
- Do you want one warehouse/location first, or multi-location from day one?
- Should the first version track only raw materials, or both raw materials and finished goods?
- Should purchasing automation begin as:
  - recommendation only
  - draft PO generation
  - auto-submit below a spending threshold
