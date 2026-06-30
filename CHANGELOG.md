# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases should follow semantic versioning once the public compatibility policy is established.

## [Unreleased]

### Added

- Release documentation, CI and dependency automation, contribution guidance, and security reporting policy.
- Installable Codex and Claude Code marketplace plugins generated from one self-contained bundle.
- An npm-compatible `wolt-mcp` executable for a future registry release.

### Changed

- Strengthened Order Submitter payload validation.
- Reject invalid menu-helper selectors before making a Wolt request.
- Block HTTP redirects and keep asynchronous menu polling within its configured deadline.

## [0.1.0] - 2026-06-29

### Added

- 38 documented Wolt API operations across Menu, Venue, Order, Timeslot, and Drive.
- Menu item lookup, live stock parsing, and Order Submitter validation helpers.
- Bundled Codex skill and standalone MCP stdio runtime.
