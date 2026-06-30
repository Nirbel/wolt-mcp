# Security policy

## Supported versions

The project is pre-release. Security fixes are applied to the latest commit on `main` and the latest tagged `0.1.x` release, if one exists.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use [GitHub's private security advisory form](https://github.com/Nirbel/wolt-mcp/security/advisories/new) and include:

- affected version or commit;
- impact and realistic attack scenario;
- reproduction steps or a minimal proof of concept;
- suggested mitigation, if known.

Do not include real Wolt credentials, customer data, order payloads, or production identifiers. Revoke any credential that may have been exposed.

## Security boundaries

- The server is local stdio software and does not provide an HTTP listener.
- Wolt credentials are read from inherited environment variables.
- Production mutation confirmation reduces accidental use; it is not an authorization boundary.
- The MCP host and local user account remain responsible for tool approvals and filesystem/process security.
- Wolt remains responsible for authenticating credentials and authorizing venue, merchant, and order access.

Maintainers will acknowledge a complete report when practical, investigate privately, and coordinate disclosure after a fix is available.
