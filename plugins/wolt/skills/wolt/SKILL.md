---
name: wolt
description: Operate Wolt marketplace and Drive integrations through the bundled MCP. Use for Wolt menus, item inventory, venue status and hours, order fulfillment and refunds, timeslot capacity, Drive deliveries and quotes, or Order Submitter payload validation.
---

# Wolt

Use the `wolt` MCP tools. Never ask the user to paste a JWT, Drive key, or webhook secret into a tool argument.

## Workflow

1. Identify the product family and read its reference below.
2. Require the user to choose `test` or `production`; never infer production.
3. Prefer a read operation before a related mutation when it can confirm identifiers or current state.
4. Explain the exact change and request explicit approval before setting `confirm_production: true`.
5. Treat HTTP 202 as accepted for processing, not proof that Wolt has applied the change.
6. Report Wolt validation errors without exposing credentials.

## Routing

- Menu and inventory: read [references/menu.md](references/menu.md).
- Venue status and operating hours: read [references/venue.md](references/venue.md).
- Orders, fulfillment, refunds, and documents: read [references/order.md](references/order.md).
- Timeslot capacities: read [references/timeslot.md](references/timeslot.md).
- Wolt Drive quotes and deliveries: read [references/drive.md](references/drive.md).
- Inbound Order Submitter payloads: read [references/order-submitter.md](references/order-submitter.md).

## Safety invariants

- Use `confirm_replace: true` only after showing that `menu_replace` replaces the complete menu.
- Do not combine numerical stock updates with `in_stock` updates unless the user understands Wolt's warning that these inventory modes interfere.
- Treat `menu_get_qty_on_stock.quantity: null` as unavailable, not zero.
- Treat refunds, item replacement, order rejection, and Drive delivery creation as consequential operations.
- Preserve money values in the denomination required by the selected endpoint; item patch prices are integer minor units.
- Do not retry mutations automatically after an ambiguous network failure.
