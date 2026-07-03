# Automatic OAuth Refresh

Status: approved for implementation on 2026-07-01.

## Goal

Keep Wolt Marketplace credentials usable for autonomous local agents after the one-hour access token expires, while preserving static-token compatibility and avoiding unsafe replay of mutations.

## Configuration

Static mode continues to use `WOLT_MARKETPLACE_TOKEN_TEST` and `WOLT_MARKETPLACE_TOKEN_PRODUCTION`.

Automatic refresh is configured independently for test and production with:

- `WOLT_MARKETPLACE_CLIENT_ID_<ENVIRONMENT>`
- `WOLT_MARKETPLACE_CLIENT_SECRET_<ENVIRONMENT>`
- `WOLT_MARKETPLACE_REFRESH_TOKEN_<ENVIRONMENT>` as the bootstrap token
- optional `WOLT_MARKETPLACE_TOKEN_STORE` to override the platform state-file path

An environment uses OAuth mode when the client ID and client secret are set and a matching stored or bootstrap refresh token exists. Partial OAuth configuration is rejected. Drive keys and webhook secrets are unaffected.

## Local token state

The versioned JSON state stores an environment profile, a SHA-256 client-ID fingerprint, the current access token, the rotated refresh token, and the access-token expiry timestamp. The client secret is never persisted.

Default locations:

- macOS: `~/Library/Application Support/wolt-mcp/oauth-tokens.json`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/wolt-mcp/oauth-tokens.json`
- Windows: `%LOCALAPPDATA%\wolt-mcp\oauth-tokens.json`

The parent directory and file use best-effort owner-only permissions. Writes use a flushed temporary file followed by atomic rename. A process-local single-flight promise and a filesystem lock serialize refreshes. A process rereads state after acquiring the lock so it can reuse a token already rotated by another process.

The environment bootstrap refresh token is used only when valid matching state does not exist. After the first successful rotation, the state file is authoritative. A changed client-ID fingerprint invalidates that profile and requires a new bootstrap refresh token.

## Refresh and HTTP behavior

The manager refreshes 60 seconds before expiry using Wolt's environment-specific OAuth endpoint, HTTP Basic authentication, and a form-encoded `grant_type=refresh_token` request. It validates the returned access token, rotated refresh token, positive `expires_in`, and Bearer token type before committing state.

Failed refreshes preserve existing state and produce sanitized errors without tokens or client secrets.

Marketplace requests obtain credentials from the manager. An unexpected 401 on a GET forces one refresh and retries once. A 401 on a mutation may refresh the credential for later calls but never replays the mutation. Existing production and full-menu replacement confirmations remain unchanged.

## Persistence resilience and recovery

Persistence goes through a small injectable store seam (default: the local file), and the successful-refresh path is decoupled from writing it. If the store write fails after Wolt has issued a rotated pair, the manager keeps the new access and refresh tokens in memory, serves them for the rest of the process lifetime (including in-process re-refreshes), and logs one credential-free warning. Successful writes fsync the parent directory so a completed rotation survives power loss. The file lock records a per-holder nonce and only removes a lock it still owns, so a stale-lock reclaim cannot let two processes enter the critical section simultaneously.

The one unavoidable window is a hard crash (power loss or `SIGKILL`) after Wolt returns a rotated pair but before any write begins: the new refresh token is lost while the old one is already invalidated server-side. Recovery is manual—re-set `WOLT_MARKETPLACE_REFRESH_TOKEN_<ENVIRONMENT>` (re-run Wolt integration if that bootstrap token has also expired) and restart. A remote or transactional credential broker is the only way to remove this window entirely.

## Deployment boundary

One computer may share this file safely across multiple Codex and Claude Code MCP processes. One refresh token must not be shared across machines because Wolt refresh tokens are single-use. Multi-machine deployments need an external credential broker or transactional shared secret store.
