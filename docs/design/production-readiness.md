# Production-Readiness Plan (v0.2.0)

Status: **proposed — awaiting approval**. No code changed yet.
Author: code review consolidation (self-review + independent reviewer pass).
Goal: make the Wolt MCP safe to trust for **production order webhooks and long-running unattended agents**, then cut a `0.2.0` release.

Baseline verified before this plan: `tsc --noEmit` clean, 70/70 tests pass, committed `dist/server.js` is byte-in-sync with a fresh esbuild 0.28.1 build, catalog↔spec integrity holds, no secret is leaked in tested error paths, CI enforces bundle-sync on Node 20 + 22.

---

## Decisions I need from you (blockers for starting)

1. **#1 enums** — When Wolt sends an unknown enum value, do you want a new non-blocking `warnings: string[]` field in the result (recommended, keeps diagnostics), or just relax the enums silently? *Recommended: add `warnings`.*
2. **#2 signature** — On a bad signature, return `{ signature_valid: false, ... }` (recommended — correct validator semantics) **or** keep throwing but fix the declared type/docs? *Recommended: return `false`.*
3. **#3 persistence seam** — OK to add a small internal, injectable store seam (default = current file writer) so the "refresh succeeded / disk write failed" path is testable and a future remote broker can plug in? *Recommended: yes.*
4. **SSRF allowlist** — Do you know Wolt's actual menu-export bucket host? If yes, we narrow `amazonaws.com`. If not, we keep it broad + documented. *Default: keep + document.*
5. **Release** — Confirm target version `0.2.0` and snapshot date to stamp in the README table.

---

## Implementation order (dependencies)

1. Tier A code fixes (#1–#4) + their tests.
2. Tier D minor hardening (menu, catalog) + tests.
3. Tier B distribution (#5 verify Codex, #6 timeout) — requires `npm run package:plugins` regen.
4. Tier C release hygiene (#7 version single-source, then #8 changelog/bump, #9 name).
5. `npm run verify` (build + tests + smoke) → commit regenerated `dist/` and `plugins/wolt/`.

---

# Tier A — Functional / contract blockers

## #1 — Order Submitter enums reject legitimate future webhooks
**File:** `src/order-submitter.ts` (lines 32-40, 114, 122-126, 132-139)

**Problem:** `order_status`, `delivery.status`, `delivery.type`, `item_type`, `type`, `pre_order_status` are closed `enum`s that mirror today's spec. If Wolt adds a value, a *real* production webhook returns `valid: false`. This contradicts the project's stated forward-compatibility (`additionalProperties: true` everywhere).

**Fix:** Relax those six fields from `enum` to `type: "string"`, keeping the documented values in `description`. Add a `KNOWN_ENUM_VALUES` map and compute a **non-blocking `warnings[]`** listing any value outside the known set (Decision #1).

```ts
// before
order_status: { type: "string", enum: ["received","fetched","acknowledged","production","ready","delivered","rejected","other"] },
// after
order_status: { type: "string", description: "Known values: received, fetched, acknowledged, production, ready, delivered, rejected, other." },
```

Return shape becomes `{ valid, signature_valid, order, errors, warnings }`.

**Tests (`tests/order-submitter.test.ts`):**
- Rewrite "validates documented enums…" (line 55) → assert an unknown `order_status`/`delivery.status` now yields `valid: true` **and** a `warnings` entry naming the field; keep asserting a genuine **type** violation (`price.amount: "1000"`) still yields `valid: false`.
- Rewrite "validates documented item and preorder structures" (line 68) similarly (unknown `item_type`/`pre_order_status` → warning, not error; string `total_price.amount` → still error).
- Update the exact-match assertion at line 20-26 to include `warnings: []`.

**Risk:** Low. Loosening validation cannot reject previously-valid input. The exposed `wolt://schemas/order-submitter` resource changes (intended).

---

## #2 — `signature_valid: false` is unreachable (misleading contract on a security helper)
**File:** `src/order-submitter.ts` (lines 150-181)

**Problem:** The return type promises `signature_valid: boolean | null`, but a bad signature **throws** (line 177) before returning, so `false` never comes back. A caller that branches on `signature_valid === false` to reject a forgery never hits that branch.

**Fix (Decision #2 — recommended: return the verdict):**
1. Verify the signature **first**, before `JSON.parse`/AJV (do less work on unauthenticated input).
2. On bad signature, **return** `{ valid: false, signature_valid: false, order: null, errors: ["WOLT-SIGNATURE verification failed; body not validated"], warnings: [] }` instead of throwing.
3. Keep throwing only for genuine operational errors: missing webhook secret (config error) and malformed JSON (existing tested behavior).

```ts
let signatureValid: boolean | null = null;
if (options.signature !== undefined) {
  const name = options.environment === "test" ? "WOLT_WEBHOOK_SECRET_TEST" : "WOLT_WEBHOOK_SECRET_PRODUCTION";
  const secret = (options.env ?? process.env)[name]?.trim();
  if (!secret) throw new Error(`Missing Wolt webhook secret: set ${name}`);
  signatureValid = verifySignature(options.rawBody, options.signature, secret);
  if (!signatureValid) {
    return { valid: false, signature_valid: false, order: null, errors: ["WOLT-SIGNATURE verification failed; body not validated"], warnings: [] };
  }
}
// then parse + validate as today
```

**Docs:** Update `skills/wolt/references/order-submitter.md`, `skills/wolt/SKILL.md`, and `README.md` to state: **treat `signature_valid === false` as "reject the webhook."**

**Tests (`tests/order-submitter.test.ts`):**
- Rewrite "rejects invalid signatures…" (line 28) from `toThrowError` to asserting the **returned** `{ valid:false, signature_valid:false, order:null }` and that `errors`/message contain no secret.
- Add: missing webhook secret still **throws** `/Missing Wolt webhook secret/`.
- Keep the valid+matching-signature test (add `warnings: []`).

**Risk:** Medium (changes a security-helper contract). Mitigated by: fail-closed values (`valid:false`, `order:null`), an explicit error entry, and the docs/skill instruction to reject on `false`. The MCP tool result still makes forgery unmistakable to the agent.

---

## #3 — OAuth rotation write-failure can lock the user out
**File:** `src/marketplace-token-manager.ts` (lines 237-266 `#refreshWithLock`, 349-375 `#writeProfile`)

**Problem:** `#requestRefresh` succeeds (Wolt rotates → old refresh token dead server-side); only *then* does `#writeProfile` persist. If that write throws (disk full, read-only FS, EACCES, quota, path-is-a-dir), the new pair is lost and every later call retries with the dead token → `invalid_grant` lockout until manual re-bootstrap.

**Fix (three parts — the catchable failures are fixed; only power-loss-mid-write is documented):**

**(a) Never discard a successful rotation.** Add `#memoryProfiles = new Map<WoltEnvironment, TokenProfile>()`. In `#refreshWithLock`, wrap the persist; on failure keep the pair in memory, warn once, and still return the fresh access token:
```ts
try {
  await this.#writeProfile(environment, nextProfile);
} catch (error) {
  this.#warnOnce(environment, `Wolt OAuth token store write failed; using in-memory token for this process: ${this.#sanitize(error, [nextProfile.access_token, nextProfile.refresh_token, config.clientSecret])}`);
}
this.#memoryProfiles.set(environment, nextProfile);   // keep memory authoritative on success and failure
return nextProfile.access_token;
```

**(b) Consult memory on read** so subsequent in-process refreshes use the in-memory (rotated) refresh token when the file is stale/unwritable. Change `#readProfile` to merge file + memory and prefer the fingerprint-matching profile with the later `expires_at`. Result: a long-running agent survives a broken disk for its whole lifetime; only a *process restart* loses the rotation.

**(c) Durability.** After `rename` (line 369), fsync the parent directory so a completed write survives power loss:
```ts
const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
// wrapped in .catch(() => undefined) — dir fsync is unsupported on some platforms (Windows)
```

**(d) Persistence seam (Decision #3):** introduce internal options `readStore?()` / `writeStore?(store)` defaulting to the current file implementation, used by `#readStore`/`#writeProfile`. Enables testing (b)/(a) deterministically and a future remote broker. Add an injectable `warn?: (msg: string) => void` (default `console.error`) for `#warnOnce`.

**Docs — the one genuinely unfixable sliver:** In `docs/design/automatic-oauth-refresh.md` + `README.md` + `SECURITY.md`, document that a power-loss/`SIGKILL` in the ~few-ms window *after* Wolt's HTTP 200 but *before* any write is inherent to rotating single-use tokens with local storage, and give the recovery: re-set `WOLT_MARKETPLACE_REFRESH_TOKEN_*` and restart (re-integrate with Wolt if that bootstrap token is also expired). Note that a remote/transactional broker is the only true HA elimination.

**Tests (`tests/marketplace-token-manager.test.ts`):**
- New: `writeStore` throws after a successful refresh → `getAccessToken` **resolves** to the new access token; a warning fires; a **second** `getAccessToken` returns the same token with **no** second fetch (memory fallback).
- New: on write success, `#memoryProfiles` and the file agree (indirect: second call no-ops without fetch).
- Existing "preserves prior state when malformed" (line 226) unchanged (missing `refresh_token` still throws before any write).
- Existing atomic-write shape test (line 74) unchanged (dir fsync doesn't alter content).

**Risk:** Medium. Contained by the seam and by keeping file writing as the default path.

---

## #4 — Stale-lock reclaim can violate mutual exclusion
**File:** `src/marketplace-token-manager.ts` (lines 377-417 `#withFileLock`)

**Problem:** The stale branch does `stat → unlink → open("wx")` non-atomically. Two processes that both see the same >30s-old lock can each `unlink`, and one can delete the *other's* freshly created lock, leaving both inside the critical section. Impact is **bounded** (single-use tokens serialize writers → the loser gets a recoverable `invalid_grant`), but it defeats the lock.

**Fix — nonce ownership verification:**
1. `const nonce = randomUUID()`; write `{ pid, nonce, created_at }` into the lock file on creation.
2. **After** `open("wx")` + write + `sync`, re-read the lock file and confirm it contains `nonce`; if not (we were clobbered), close the handle and `continue` (retry) **without** unlinking.
3. On release, read the lock file and **only `unlink` if it still contains `nonce`** (never delete a lock we no longer own).

**Tests:**
- New stale-lock reclaim: pre-create the lock file, backdate its mtime via `utimes` to > `staleLockMs` ago, set `staleLockMs` small, then `getAccessToken` reclaims and refreshes exactly once.
- Existing cross-process "rotate only once" (line 180) still passes.
- Note in the plan: the full simultaneous-reclaim race is *mitigated* (window shrunk + ownership-checked release), not unit-proven deterministically — documented honestly.

**Risk:** Low. Pure hardening of an already-bounded issue.

---

# Tier B — Distribution blockers (do plugin installs actually work?)

## #5 — Verify the Codex plugin launcher; add a safe fallback
**File:** `plugins/wolt/.mcp.json` (generated), `scripts/package-plugins.mjs` (lines 31-46)

**Problem:** The launcher resolves the bundle via `process.env.CLAUDE_PLUGIN_ROOT || process.cwd()`. Claude sets that var; **Codex has no equivalent**, so Codex installs depend on Codex setting cwd to the plugin dir. The existing "codex" distribution test only proves the cwd fallback works *when smoke.mjs sets cwd to the plugin root* — it does not prove real Codex does so.

**Plan:**
1. **Verify** Codex's plugin launch cwd/env from `https://developers.openai.com/codex/plugins/build` (I'll fetch this first).
2. Make the launcher defensive regardless: `process.env.CLAUDE_PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || process.cwd()`, and **throw a clear error naming the resolved root** if `dist/server.js` is not found there (so a bad cwd fails loudly, not silently).
3. If step 1 shows Codex does not cd to the plugin dir, add whatever root variable Codex actually provides.

**Tests (`tests/distribution.test.ts`):** add a case that runs the packaged launcher with `cwd` set to an **unrelated** directory and `CLAUDE_PLUGIN_ROOT` unset → expect the clear not-found error (locks in the diagnostic).

**Risk:** Low code; the value is verification.

---

## #6 — Packaged plugin config drops `tool_timeout_sec`
**File:** `scripts/package-plugins.mjs` (lines 38-46)

**Problem:** Root `.mcp.json`, both examples, and the README TOML set `tool_timeout_sec = 150` because `menu_get` polls up to `timeout_ms` 120000 (+ ~15s initial). The generated `plugins/wolt/.mcp.json` omits it, so a long poll can be killed by a host default (~60s).

**Fix:** Add `tool_timeout_sec: 150` to `sharedMcp.mcpServers.wolt`. Re-run `npm run package:plugins` to regenerate `plugins/wolt/.mcp.json` (CI's `git diff --exit-code plugins/wolt` requires it committed).

**Tests (`tests/distribution.test.ts`):** extend the "packages one adaptive MCP launch configuration" case (line 102) to assert `sharedMcp.mcpServers.wolt.tool_timeout_sec === 150`.

**Risk:** None (Codex honors it; Claude ignores unknown keys harmlessly).

---

# Tier C — Release hygiene (before public / before calling it production)

## #7 — Single-source the version
**Files:** `src/server.ts:31`, `scripts/package-plugins.mjs:14-29`, `+ new tests/version.test.ts`

- `src/server.ts`: `import pkg from "../package.json" with { type: "json" }` → `version: pkg.version` (same JSON-import mechanism `catalog.ts` already uses; esbuild inlines it). `tests/server.test.ts` asserts no version, so this is safe.
- `scripts/package-plugins.mjs`: read `package.json`; set `codexManifest.version` and `claudeManifest.version` from `pkg.version`.
- New `tests/version.test.ts`: assert every version field equals `package.json` version — `package.json`, `.claude-plugin/marketplace.json` (marketplace + plugins[0]), `.codex-plugin/plugin.json`, `plugins/wolt/.codex-plugin/plugin.json`, `plugins/wolt/.claude-plugin/plugin.json`, and the live server version via `createWoltServer`. Drift now fails CI.

**Risk:** Low.

## #8 — Bump to 0.2.0 + reconcile CHANGELOG
- `package.json` version → `0.2.0`; update source manifests (`.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json` ×2) to `0.2.0`; regenerate `plugins/wolt/*`.
- `CHANGELOG.md`: move `[Unreleased]` items under `## [0.2.0] - <date>` and add entries for #1-#6.
- `README.md`: update the status table (`Project version`, snapshot date per Decision #5).

## #9 — Fix package name drift
- `package.json` `name: "wolt-mcp-plugin"` → `"wolt-mcp"` (matches repo, bin, marketplaces). Private/unpublished, so safe. No code imports the package name.

---

# Tier D — Minor hardening

- **Menu poll error leak** — `src/menu.ts:136-141`: wrap the resource-URL `fetch` in try/catch and throw a generic `"Wolt menu resource request failed"` **without echoing the URL** (presigned S3 URLs carry `X-Amz-Signature`). Test: fetcher rejects → error contains no signature/query string.
- **Initial menu request ignores `timeout_ms`** — `src/menu.ts:121-128`: pass a bounded `timeoutMs` into the first `client.request` so small budgets are honored.
- **Query/header params silently dropped** — `src/catalog.ts:73-81`: in `getSnapshotOperation`, throw if any parameter group `type` is `"query"` or `"header"` (fail loudly on a future spec regen). Test the guard with a synthetic operation.
- **SSRF allowlist** — `src/menu.ts:94`: keep `amazonaws.com` + document rationale, or narrow if you provide the bucket host (Decision #4).
- **`structuredContent` without `outputSchema`** — `src/server.ts:16-24`: optional; spec-compliant today. Leave as-is unless you want declared output schemas.

---

# Verification & rollback

- Per tier: run `npm test` (targeted files) as I go.
- Final gate: `npm run verify` (typecheck + fresh bundle + package plugins + full vitest + stdio smoke) must pass; then commit regenerated `dist/server.js` and `plugins/wolt/`.
- CI (Node 20 + 22) re-runs verify and asserts the bundle/plugins are committed and in sync.
- Rollback: each tier is an independent commit; revert any tier without affecting others.

# Out of scope (explicitly)
- Multi-machine HA token storage (remote broker) — documented as the future path only.
- Adding query/header request support (no such params exist in the current spec) — we only fail loudly if they appear.
- Declaring per-tool `outputSchema` for all 41 tools.
