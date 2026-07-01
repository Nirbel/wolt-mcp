# Menu API

Official reference: https://developer.wolt.com/docs/api/menu

## Tools

- `menu_replace`: POST the complete legacy Menu document. Creates a menu when absent and replaces it when present. Requires `confirm_replace: true`.
- `menu_get`: start Wolt's asynchronous v2 menu export and poll its returned HTTPS resource until `READY`.
- `menu_update_items`: bulk-patch price, discounted price, VAT, visibility, temporary disablement, or retail `in_stock`.
- `menu_update_item_stock`: bulk-set numerical inventory using exactly one of `external_id`, `gtin`, or `sku` per item.
- `menu_update_option_values`: bulk-patch option value price, VAT, or visibility by `external_id`.
- `menu_get_item`: fetch and filter live menu items by exactly one identifier.
- `menu_get_qty_on_stock`: return only a live top-level `quantity` or `inventory` field. A null result means Wolt did not expose the count.

## Important differences

The create/replace Menu model uses legacy fields such as `external_data`, `merchant_sku`, `gtin_barcode`, and optional `quantity`. The GET MenuData v2 model uses `product.external_id`, `product.sku`, `product.gtin`, and `inventory_mode`; the documented GET model does not guarantee a remaining quantity.

Patch prices use integer minor units, for example `1000` for EUR 10.00. Each bulk update is accepted asynchronously with HTTP 202.
