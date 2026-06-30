# Order Submitter

Official schema: https://developer.wolt.com/docs/api/order-submitter

Order Submitter is an inbound Wolt-to-partner payload contract, not a callable Wolt endpoint. Use `order_submitter_validate` with the exact unmodified raw body. When a `signature` is supplied, the tool verifies the hexadecimal `WOLT-SIGNATURE` using HMAC-SHA256 and the environment-specific webhook secret.

The MCP does not expose Wolt's hidden placeholder `GET /`. After receiving a webhook notification, use `order_get_v2` with the supplied order ID to retrieve the current authoritative order.
