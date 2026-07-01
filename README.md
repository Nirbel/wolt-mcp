# Wolt MCP + Codex skill

[![CI](https://github.com/Nirbel/wolt-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nirbel/wolt-mcp/actions/workflows/ci.yml)

A local, stdio-based Model Context Protocol server and Codex plugin for Wolt marketplace and Wolt Drive integrations. It exposes 38 operations from Wolt's Menu, Venue, Order, Timeslot, and Drive APIs, plus three focused helpers for menu-item lookup, stock inspection, and Order Submitter validation.

> [!IMPORTANT]
> This is an unofficial integration and is not affiliated with or endorsed by Wolt. You need credentials and API access issued by Wolt. The project is currently a private, unlicensed `0.1.0` pre-release; choose and add a license before making the repository public.

## Highlights

- 41 MCP tools: 38 documented Wolt operations and three local helpers.
- Explicit `test` or `production` selection on every network operation.
- Production mutations require `confirm_production: true`.
- Whole-menu replacement always requires `confirm_replace: true`.
- Marketplace tokens, Drive keys, and webhook secrets come from environment variables—not tool arguments.
- Fixed Wolt hosts, request timeouts, redirect blocking, path encoding, and credential-redacted errors.
- Complete asynchronous menu request/poll handling.
- Self-contained `dist/server.js`; users do not need `npm install` at runtime.
- A bundled Codex skill with focused references for each Wolt API family.

## Status and compatibility

| Component | Support |
| --- | --- |
| Project version | `0.1.0` pre-release |
| Node.js | 20 or newer |
| MCP transport | stdio |
| MCP protocol smoke test | `2025-06-18` |
| MCP TypeScript SDK | `1.29.0` |
| Wolt documentation snapshot | 2026-06-29 |
| Operating systems | macOS, Linux, and Windows with Node.js 20+ |

Wolt may add optional response fields without changing an API version. The server preserves unknown response fields for forward compatibility.

## Tool catalog

### Menu — 7 tools

| Tool | Purpose |
| --- | --- |
| `menu_replace` | Create or replace a venue's complete legacy menu. |
| `menu_get` | Request and poll the asynchronous v2 menu export. |
| `menu_update_items` | Bulk-update item price, VAT, visibility, availability, or retail stock state. |
| `menu_update_item_stock` | Bulk-update numerical inventory by `external_id`, `gtin`, or `sku`. |
| `menu_update_option_values` | Bulk-update option-value price, VAT, or visibility. |
| `menu_get_item` | Fetch the live menu and match one item identifier. |
| `menu_get_qty_on_stock` | Return item-level live quantity when Wolt exposes it. |

### Venue — 7 tools

`venue_get_status`, `venue_get_settings`, `venue_get_delivery_provider`, `venue_update_delivery_provider`, `venue_set_online_status`, `venue_update_opening_times`, and `venue_set_special_opening_times`.

### Order — 18 tools

| Group | Tools |
| --- | --- |
| Read | `order_get`, `order_get_v2` |
| Lifecycle | `order_accept`, `order_reject`, `order_mark_ready`, `order_mark_delivered`, `order_confirm_preorder` |
| Self-delivery | `order_accept_self_delivery`, `order_mark_pickup_completed`, `order_mark_courier_at_customer`, `order_update_courier_location`, `order_update_delivery_eta` |
| Fulfillment | `order_replace_items`, `order_mark_sent_to_pos`, `order_mark_deposits_returned` |
| Financial | `order_refund_items`, `order_refund_basket` |
| Documents | `order_create_document_upload_link` |

### Timeslot — 3 tools

`timeslot_get`, `timeslot_upsert`, and `timeslot_update_capacity`.

### Wolt Drive — 5 tools

`drive_create_shipment_promise`, `drive_create_delivery`, `drive_get_available_venues`, `drive_get_delivery_fee`, and `drive_create_delivery_order`.

### Order Submitter — 1 helper and 1 resource

- `order_submitter_validate` validates the documented inbound payload and can verify its HMAC-SHA256 `WOLT-SIGNATURE`.
- `wolt://schemas/order-submitter` exposes the validator's JSON Schema.

Wolt's hidden placeholder `GET /` for Order Submitter is intentionally not exposed because it is not a callable partner endpoint.

## Requirements

1. Node.js 20 or newer.
2. Wolt integration onboarding and the credentials for the APIs you use.
3. An MCP host such as Codex.

Only configure the credentials you actually need:

| Environment variable | Used for |
| --- | --- |
| `WOLT_MARKETPLACE_TOKEN_TEST` | Menu, Venue, Order, and Timeslot test calls |
| `WOLT_MARKETPLACE_TOKEN_PRODUCTION` | Menu, Venue, Order, and Timeslot production calls |
| `WOLT_DRIVE_KEY_TEST` | Wolt Drive test calls |
| `WOLT_DRIVE_KEY_PRODUCTION` | Wolt Drive production calls |
| `WOLT_WEBHOOK_SECRET_TEST` | Test Order Submitter signature verification |
| `WOLT_WEBHOOK_SECRET_PRODUCTION` | Production Order Submitter signature verification |

Marketplace access tokens and Drive merchant keys are sent as Bearer credentials to their respective fixed Wolt hosts. They are never accepted as MCP tool parameters.

## Installation

Set the required Wolt variables in the environment that launches your MCP host before using any installation method.

### Option A: Install as a Codex plugin

Add the GitHub marketplace, then install the plugin:

```sh
codex plugin marketplace add Nirbel/wolt-mcp
codex plugin add wolt@wolt-mcp
```

Start a new Codex thread after installation. The plugin contributes both the Wolt skill and all 41 MCP tools. For a private repository, the installing user must have GitHub access through their normal Git credentials.

### Option B: Install as a Claude Code plugin

Add the same repository as a Claude Code marketplace and install Wolt:

```sh
claude plugin marketplace add Nirbel/wolt-mcp
claude plugin install wolt@wolt-mcp
```

To enable it for everyone working in a trusted project instead of only the current user:

```sh
claude plugin install wolt@wolt-mcp --scope project
```

Start a new Claude Code session or run `/reload-plugins`. The Wolt skill is namespaced as `/wolt:wolt`; the MCP server starts automatically while the plugin is enabled.

### Option C: Clone and configure the standalone MCP

```sh
git clone https://github.com/Nirbel/wolt-mcp.git
cd wolt-mcp
```

The committed bundle is ready to run:

```sh
node dist/server.js
```

It is a stdio server, so an interactive terminal will appear idle while it waits for JSON-RPC messages. Use `npm run smoke` to perform a visible handshake test.

Configure Codex by adding the following to `~/.codex/config.toml`, replacing the two absolute paths:

```toml
[mcp_servers.wolt]
command = "node"
args = ["/ABSOLUTE/PATH/TO/wolt-mcp/dist/server.js"]
cwd = "/ABSOLUTE/PATH/TO/wolt-mcp"
env_vars = [
  "WOLT_MARKETPLACE_TOKEN_TEST",
  "WOLT_MARKETPLACE_TOKEN_PRODUCTION",
  "WOLT_DRIVE_KEY_TEST",
  "WOLT_DRIVE_KEY_PRODUCTION",
  "WOLT_WEBHOOK_SECRET_TEST",
  "WOLT_WEBHOOK_SECRET_PRODUCTION"
]
startup_timeout_sec = 20
tool_timeout_sec = 150
enabled = true
```

Set the required variables in the environment that launches Codex, restart Codex, and inspect the connection with `/mcp` in the CLI.

### Option D: Run through npm/`npx`

The package now exposes a `wolt-mcp` executable and passes `npm pack` inspection. After a public npm scope and license are selected and the package is published, users will be able to run:

```sh
npx -y @YOUR_NPM_SCOPE/wolt-mcp
```

The npm registry package is not published yet. The GitHub marketplace installation methods above work independently of npm.

### Plaintext `.mcp.json` configuration

As a less secure alternative, add an `env` object to the `wolt` server entry in `.mcp.json`:

```json
{
  "mcpServers": {
    "wolt": {
      "command": "node",
      "args": ["./dist/server.js"],
      "cwd": ".",
      "tool_timeout_sec": 150,
      "env": {
        "WOLT_MARKETPLACE_TOKEN_TEST": "replace-with-token"
      }
    }
  }
}
```

This stores credentials as plaintext. Never commit or distribute a modified configuration containing real secrets.

## Calling tools

All official request bodies are nested under `payload` and preserve Wolt's field names. Path parameters stay at the top level.

### Inspect a menu item

```json
{
  "environment": "test",
  "venueId": "your-venue-id",
  "sku": "SKU-123"
}
```

Use exactly one of `id`, `external_id`, `gtin`, or `sku` with `menu_get_item` and `menu_get_qty_on_stock`.

### Update numerical stock in test

Call `menu_update_item_stock` with:

```json
{
  "environment": "test",
  "venueId": "your-venue-id",
  "payload": {
    "data": [
      { "sku": "SKU-123", "inventory": 12 }
    ]
  }
}
```

Each inventory entry must identify the item with exactly one of `external_id`, `gtin`, or `sku`.

### Confirm a production mutation

Production write tools reject calls unless confirmation is explicit:

```json
{
  "environment": "production",
  "confirm_production": true,
  "venueId": "your-venue-id",
  "payload": {
    "data": [
      { "sku": "SKU-123", "inventory": 12 }
    ]
  }
}
```

`menu_replace` additionally requires `confirm_replace: true` in both test and production because it replaces the complete menu.

### Validate an Order Submitter webhook

Pass the exact, unmodified HTTP body and optional hexadecimal signature:

```json
{
  "environment": "test",
  "raw_body": "{\"id\":\"order-id\",...}",
  "signature": "64-character-hexadecimal-signature"
}
```

When `signature` is provided, the helper reads the matching webhook secret from the environment and uses a timing-safe comparison.

## Stock quantity semantics

Wolt's documented v2 menu response includes `inventory_mode` but does not guarantee that remaining inventory is returned. `menu_get_qty_on_stock` therefore:

- reads only a numeric top-level item `quantity` or `inventory` field;
- never interprets nested product/package quantity as remaining stock;
- returns `quantity: null`, `inventory_mode`, and an explanation when no live count exists;
- returns every match if an identifier is duplicated.

`quantity: null` means “not exposed by Wolt,” not zero.

## Safety model

- Network tools require `environment: "test" | "production"`.
- Production mutations require `confirm_production: true`.
- Whole-menu replacement always requires `confirm_replace: true`.
- Redirects are blocked so Bearer credentials and polling requests remain on their validated destinations.
- Menu polling accepts only HTTPS resource URLs on Wolt, Wolt API, or Amazon AWS domains.
- Requests have bounded timeouts and errors redact the selected credential.
- Mutations are never retried automatically after ambiguous network failures.
- HTTP `202` means accepted for processing, not proof that Wolt completed the change.
- Refunds, replacement, rejection, status transitions, and Drive delivery creation should be treated as consequential operations.

Start in `test`. Never use production credentials in examples, tests, issues, or logs.

## Error behavior

Successful calls return the HTTP status, acceptance metadata, and Wolt's response without stripping unknown fields. Empty responses return `data: null`.

Tool errors include a sanitized message for:

- missing credentials;
- invalid arguments or payloads;
- missing production confirmation;
- Wolt HTTP errors including rate limiting and conflicts;
- unsafe asynchronous menu URLs;
- malformed, failed, unknown, or timed-out menu generation states;
- malformed Order Submitter JSON or invalid HMAC signatures.

The server does not log credentials. As with any integration, avoid copying customer/order payloads into public bug reports.

## Development

Install the locked dependencies:

```sh
npm ci
```

Run the complete local verification:

```sh
npm run verify
```

This runs:

1. Strict TypeScript checking and a fresh standalone esbuild bundle.
2. Deterministic Codex and Claude Code plugin packaging.
3. Vitest unit and integration tests, including distribution integrity.
4. A raw stdio MCP handshake, tool-count check, and schema-resource read.

Useful individual commands:

```sh
npm test
npm run typecheck
npm run build
npm run smoke
```

The generated `specs/wolt-official.json` snapshot preserves source URLs, official servers, operation descriptions, parameters, request schemas, examples, and response metadata. Update it deliberately when Wolt changes its documentation; never hand-edit generated contract data without recording the source and date.

## Project structure

```text
.
├── .agents/plugins/marketplace.json   # Codex marketplace
├── .claude-plugin/marketplace.json    # Claude Code marketplace
├── .codex-plugin/plugin.json          # Source Codex plugin manifest
├── .mcp.json                          # Standalone MCP launch configuration
├── dist/server.js                     # Self-contained runtime bundle
├── plugins/wolt/                      # Generated dual-host plugin package
├── skills/wolt/                       # Skill and API-family references
├── specs/wolt-official.json           # Captured official Wolt contracts
├── src/                               # TypeScript MCP implementation
├── tests/                             # API, safety, MCP, and distribution tests
└── scripts/package-plugins.mjs        # Deterministic plugin packager
```

## Release checklist

- Run `npm ci` and `npm run verify` on a clean checkout.
- Confirm `npm audit` reports no unresolved production vulnerability.
- Validate `plugins/wolt` with the Codex plugin validator.
- Run `claude plugin validate .` for the Claude Code marketplace and plugin.
- Run `npm pack --dry-run` and inspect the included files.
- Review changes to `specs/wolt-official.json` against Wolt's official documentation.
- Confirm `dist/server.js` was rebuilt and committed.
- Verify no `.env`, token, key, webhook secret, order payload, or customer data is committed.
- Never use a production mutation as a release smoke test.
- Update `CHANGELOG.md` and version fields together.
- Select and add a license before making this repository public.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Do not open public issues containing credentials, Wolt payloads, customer details, or exploitable security findings.

## Official references

- [Menu API](https://developer.wolt.com/docs/api/menu)
- [Venue API](https://developer.wolt.com/docs/api/venue)
- [Order API](https://developer.wolt.com/docs/api/order)
- [Timeslot Orders API](https://developer.wolt.com/docs/api/timeslot-orders)
- [Wolt Drive API](https://developer.wolt.com/docs/api/wolt-drive)
- [Order Submitter](https://developer.wolt.com/docs/api/order-submitter)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Codex MCP documentation](https://developers.openai.com/codex/mcp)
- [Codex plugin documentation](https://developers.openai.com/codex/plugins/build)
- [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins)
- [Claude Code marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces)

## License

No open-source license has been selected yet. The package is marked `UNLICENSED` and private. Add an explicit license before public distribution.
