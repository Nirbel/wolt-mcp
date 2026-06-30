# Wolt MCP plugin

Portable, uninstalled Codex plugin covering the documented Wolt Menu, Venue, Order, Timeslot, Drive, and Order Submitter contracts captured on 2026-06-29.

## Credentials

Set credentials in the environment that launches Codex:

```text
WOLT_MARKETPLACE_TOKEN_TEST
WOLT_MARKETPLACE_TOKEN_PRODUCTION
WOLT_DRIVE_KEY_TEST
WOLT_DRIVE_KEY_PRODUCTION
WOLT_WEBHOOK_SECRET_TEST
WOLT_WEBHOOK_SECRET_PRODUCTION
```

Only variables needed by the chosen tool and environment are required. Tokens are sent as Bearer credentials and are never accepted as tool arguments.

As a less secure alternative, add an `env` object to the `wolt` entry in `.mcp.json`:

```json
"env": {
  "WOLT_MARKETPLACE_TOKEN_TEST": "replace-with-token"
}
```

This stores the credential as plaintext. Do not commit, share, or publish a modified file containing secrets.

## Development verification

```sh
npm install
npm run verify
```

The committed `dist/server.js` bundle is self-contained; running the plugin does not require `node_modules`.

The generated `specs/wolt-official.json` snapshot contains the source URLs, official servers, operation descriptions, parameter schemas, examples, and response metadata used to build the 38 network tools.
