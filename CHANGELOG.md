# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases should follow semantic versioning once the public compatibility policy is established.

## [Unreleased]

## [0.2.0] - 2026-07-03

### Added

- Release documentation, CI and dependency automation, contribution guidance, and security reporting policy.
- Installable Codex and Claude Code marketplace plugins generated from one self-contained bundle.
- An npm-compatible `wolt-mcp` executable for a future registry release.
- Automatic Wolt Marketplace OAuth refresh with atomic local token rotation, same-process single-flight, and cross-process file locking.
- Static-token and OAuth-refresh MCP configuration examples.
- Non-blocking `warnings` in Order Submitter validation reporting Wolt enum values outside the documented set.

### Changed

- Strengthened Order Submitter payload validation.
- Reject invalid menu-helper selectors before making a Wolt request.
- Block HTTP redirects and keep asynchronous menu polling within its configured deadline.
- Retry one Marketplace `GET` after a successful 401-triggered refresh while never replaying mutations.
- Relaxed Order Submitter enum fields to strings so new Wolt values are accepted (and surfaced as warnings) instead of failing validation.
- Order Submitter returns `signature_valid: false` for a bad WOLT-SIGNATURE instead of throwing, and verifies the signature before parsing the body.
- Marketplace OAuth rotation keeps a refreshed token in memory and stays usable when the local store cannot be written; the store write now fsyncs its directory for durability.
- Hardened the OAuth token-store file lock with per-holder nonce ownership to prevent stale-lock reclaim races.
- Packaged plugin launcher resolves the bundle via `CLAUDE_PLUGIN_ROOT`/`PLUGIN_ROOT`/cwd and fails with a clear error if it cannot; packaged config sets `tool_timeout_sec` for long menu polls.
- Single-sourced the release version from `package.json` across every manifest and the running server.

### Security

- Menu resource polling no longer includes the presigned resource URL (which carries an `X-Amz-Signature`) in error messages.

## [0.1.0] - 2026-06-29

### Added

- 38 documented Wolt API operations across Menu, Venue, Order, Timeslot, and Drive.
- Menu item lookup, live stock parsing, and Order Submitter validation helpers.
- Bundled Codex skill and standalone MCP stdio runtime.
