# Order Submitter

Official schema: https://developer.wolt.com/docs/api/order-submitter

Order Submitter is an inbound Wolt-to-partner payload contract, not a callable Wolt endpoint. Use `order_submitter_validate` with the exact unmodified raw body. When a `signature` is supplied, the tool verifies the hexadecimal `WOLT-SIGNATURE` using HMAC-SHA256 and the environment-specific webhook secret.

The tool returns `{ valid, signature_valid, order, errors, warnings }`:

- **Treat `signature_valid: false` as a rejected, untrusted webhook.** The signature is verified before the body is parsed, so on failure `order` is `null` and nothing is validated. `signature_valid: null` means no signature was supplied; `true` means it matched. A missing webhook secret raises an error.
- `valid` reflects structural validity. `warnings` lists documented enum fields (for example `order_status`, `delivery.status`, `item_type`) whose values fall outside the currently known set; Wolt can add values without a version change, so these are accepted for forward-compatibility. Surface warnings but do not block on them.

The MCP does not expose Wolt's hidden placeholder `GET /`. After receiving a webhook notification, use `order_get_v2` with the supplied order ID to retrieve the current authoritative order.
