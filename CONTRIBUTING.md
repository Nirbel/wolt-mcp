# Contributing

Contributions should preserve the official Wolt contract, MCP compatibility, and the project's production-safety boundaries.

## Development setup

```sh
npm ci
npm run verify
```

Node.js 20 or newer is required. Keep `package-lock.json` synchronized with `package.json`.

## Change requirements

- Add or update tests for every behavioral change.
- Keep every network tool's explicit `environment` argument.
- Do not weaken `confirm_production` or `confirm_replace` enforcement.
- Keep credentials in environment variables and out of tool schemas, fixtures, logs, and errors.
- Preserve unknown Wolt response fields.
- Do not add automatic retries for mutations.
- Keep tool names stable unless the change is intentionally breaking and documented.
- Rebuild and commit `dist/server.js` after source changes.
- Run `npm run build` to regenerate `plugins/wolt`; do not edit generated plugin files directly.

## Wolt contract changes

Use Wolt's official developer documentation as the source of truth. When changing the operation catalog or schemas:

1. Record the official source URL and capture date.
2. Verify method, path, host, authentication family, parameters, request body, enums, nullable fields, and responses.
3. Update the generated snapshot and focused skill reference together.
4. Add data-driven route and schema tests.
5. Never infer undocumented endpoints from private traffic or credentials.

## Testing safety

Unit tests must use mocks or local in-memory transports. Optional live verification must remain read-only and target the test environment unless a maintainer explicitly approves otherwise. Never exercise a production mutation as part of CI, release validation, or a pull request.

## Pull requests

Keep changes focused and describe:

- what changed and why;
- which official contract supports an API change;
- safety implications;
- tests and validation performed;
- whether `dist/server.js` and documentation were updated.

Do not include secrets, live order data, customer information, or copied confidential Wolt material.
