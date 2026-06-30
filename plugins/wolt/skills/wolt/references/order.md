# Order API

Official reference: https://developer.wolt.com/docs/api/order

Prefer `order_get_v2` over the legacy `order_get` response.

## Tool groups

- Read: `order_get`, `order_get_v2`.
- Lifecycle: `order_accept`, `order_reject`, `order_mark_ready`, `order_mark_delivered`, `order_confirm_preorder`.
- Self delivery: `order_accept_self_delivery`, `order_mark_pickup_completed`, `order_mark_courier_at_customer`, `order_update_courier_location`, `order_update_delivery_eta`.
- Fulfillment: `order_replace_items`, `order_mark_sent_to_pos`, `order_mark_deposits_returned`.
- Financial: `order_refund_items`, `order_refund_basket`.
- Documents: `order_create_document_upload_link` returns a time-limited presigned PUT URL; it does not upload the document.

Some operations require Wolt enablement or a particular order state. Item replacement is accepted asynchronously and can be called only once per order. Never repeat a refund after an ambiguous response without checking the order externally.
