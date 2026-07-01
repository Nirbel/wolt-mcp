import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { WoltEnvironment } from "./catalog.js";
import type { Fetcher } from "./client.js";

const STATIC_TOKEN_NAMES = {
  test: "WOLT_MARKETPLACE_TOKEN_TEST",
  production: "WOLT_MARKETPLACE_TOKEN_PRODUCTION"
} as const;

const OAUTH_NAMES = {
  test: {
    clientId: "WOLT_MARKETPLACE_CLIENT_ID_TEST",
    clientSecret: "WOLT_MARKETPLACE_CLIENT_SECRET_TEST",
    refreshToken: "WOLT_MARKETPLACE_REFRESH_TOKEN_TEST"
  },
  production: {
    clientId: "WOLT_MARKETPLACE_CLIENT_ID_PRODUCTION",
    clientSecret: "WOLT_MARKETPLACE_CLIENT_SECRET_PRODUCTION",
    refreshToken: "WOLT_MARKETPLACE_REFRESH_TOKEN_PRODUCTION"
  }
} as const;

const OAUTH_ENDPOINTS = {
  test: "https://integrations-authentication-service.development.dev.woltapi.com/oauth2/token",
  production: "https://integrations-authentication-service.wolt.com/oauth2/token"
} as const;

const STORE_VERSION = 1;
const DEFAULT_REFRESH_SKEW_MS = 60_000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_TIMEOUT_MS = 20_000;
const DEFAULT_STALE_LOCK_MS = 30_000;

type TokenProfile = {
  client_id_fingerprint: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

type TokenStore = {
  version: 1;
  profiles: Partial<Record<WoltEnvironment, TokenProfile>>;
};

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  bootstrapRefreshToken?: string;
};

export type MarketplaceTokenManagerOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  statePath?: string;
  now?: () => number;
  refreshSkewMs?: number;
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clientIdFingerprint(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex");
}

function asErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function resolveOAuthTokenEndpoint(environment: WoltEnvironment): string {
  return OAUTH_ENDPOINTS[environment];
}

export function resolveDefaultTokenStore(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string {
  const override = env.WOLT_MARKETPLACE_TOKEN_STORE?.trim();
  if (override) return override;
  if (platform === "darwin") return join(home, "Library", "Application Support", "wolt-mcp", "oauth-tokens.json");
  if (platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return join(base, "wolt-mcp", "oauth-tokens.json");
  }
  const stateHome = env.XDG_STATE_HOME?.trim() || join(home, ".local", "state");
  return join(stateHome, "wolt-mcp", "oauth-tokens.json");
}

function isTokenProfile(value: unknown): value is TokenProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return nonEmpty(profile.client_id_fingerprint)
    && nonEmpty(profile.access_token)
    && nonEmpty(profile.refresh_token)
    && typeof profile.expires_at === "number"
    && Number.isFinite(profile.expires_at);
}

function parseStore(raw: string, statePath: string): TokenStore {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid Wolt OAuth token store JSON at ${statePath}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Wolt OAuth token store at ${statePath}`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== STORE_VERSION || typeof record.profiles !== "object" || record.profiles === null) {
    throw new Error(`Unsupported Wolt OAuth token store at ${statePath}`);
  }
  const profiles = record.profiles as Record<string, unknown>;
  for (const environment of ["test", "production"] as const) {
    if (profiles[environment] !== undefined && !isTokenProfile(profiles[environment])) {
      throw new Error(`Invalid ${environment} profile in Wolt OAuth token store at ${statePath}`);
    }
  }
  return value as TokenStore;
}

function validateTokenResponse(value: unknown): { accessToken: string; refreshToken: string; expiresIn: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Wolt OAuth token endpoint returned an invalid response");
  }
  const record = value as Record<string, unknown>;
  if (!nonEmpty(record.access_token)) throw new Error("Wolt OAuth token response is missing access_token");
  if (!nonEmpty(record.refresh_token)) throw new Error("Wolt OAuth token response is missing refresh_token");
  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in) || record.expires_in <= 0) {
    throw new Error("Wolt OAuth token response has invalid expires_in");
  }
  if (!nonEmpty(record.token_type) || record.token_type.toLowerCase() !== "bearer") {
    throw new Error("Wolt OAuth token response has unsupported token_type");
  }
  return {
    accessToken: record.access_token,
    refreshToken: record.refresh_token,
    expiresIn: record.expires_in
  };
}

export class MarketplaceTokenManager {
  readonly #env: Record<string, string | undefined>;
  readonly #fetcher: Fetcher;
  readonly #statePath: string;
  readonly #now: () => number;
  readonly #refreshSkewMs: number;
  readonly #lockRetryMs: number;
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;
  readonly #refreshes = new Map<WoltEnvironment, Promise<string>>();

  constructor(options: MarketplaceTokenManagerOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#fetcher = options.fetcher ?? fetch;
    this.#statePath = options.statePath ?? resolveDefaultTokenStore(this.#env);
    this.#now = options.now ?? Date.now;
    this.#refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    this.#lockRetryMs = options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    this.#staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  }

  async getAccessToken(environment: WoltEnvironment): Promise<string> {
    const config = this.#oauthConfig(environment);
    if (!config) return this.#staticToken(environment);

    const profile = await this.#readProfile(environment, config.clientId);
    if (profile && profile.expires_at > this.#now() + this.#refreshSkewMs) return profile.access_token;
    return this.#singleFlightRefresh(environment, config);
  }

  async refreshAfterUnauthorized(environment: WoltEnvironment, rejectedAccessToken: string): Promise<string | null> {
    const config = this.#oauthConfig(environment);
    if (!config) return null;
    return this.#singleFlightRefresh(environment, config, rejectedAccessToken);
  }

  #oauthConfig(environment: WoltEnvironment): OAuthConfig | null {
    const names = OAUTH_NAMES[environment];
    const clientId = this.#env[names.clientId]?.trim();
    const clientSecret = this.#env[names.clientSecret]?.trim();
    const bootstrapRefreshToken = this.#env[names.refreshToken]?.trim();
    const oauthConfigured = Boolean(clientId || clientSecret || bootstrapRefreshToken);
    if (!oauthConfigured) return null;
    if (!clientId || !clientSecret) {
      const missing = [
        ...(!clientId ? [names.clientId] : []),
        ...(!clientSecret ? [names.clientSecret] : [])
      ];
      throw new Error(`Incomplete Wolt Marketplace OAuth configuration for ${environment}: set ${missing.join(" and ")}`);
    }
    return {
      clientId,
      clientSecret,
      ...(bootstrapRefreshToken ? { bootstrapRefreshToken } : {})
    };
  }

  #staticToken(environment: WoltEnvironment): string {
    const name = STATIC_TOKEN_NAMES[environment];
    const token = this.#env[name]?.trim();
    if (!token) throw new Error(`Missing Wolt credential: set ${name}`);
    return token;
  }

  async #singleFlightRefresh(
    environment: WoltEnvironment,
    config: OAuthConfig,
    rejectedAccessToken?: string
  ): Promise<string> {
    const running = this.#refreshes.get(environment);
    if (running) return running;
    const refresh = this.#refreshWithLock(environment, config, rejectedAccessToken).finally(() => {
      if (this.#refreshes.get(environment) === refresh) this.#refreshes.delete(environment);
    });
    this.#refreshes.set(environment, refresh);
    return refresh;
  }

  async #refreshWithLock(
    environment: WoltEnvironment,
    config: OAuthConfig,
    rejectedAccessToken?: string
  ): Promise<string> {
    return this.#withFileLock(async () => {
      const profile = await this.#readProfile(environment, config.clientId);
      if (profile) {
        if (rejectedAccessToken !== undefined && profile.access_token !== rejectedAccessToken) return profile.access_token;
        if (rejectedAccessToken === undefined && profile.expires_at > this.#now() + this.#refreshSkewMs) {
          return profile.access_token;
        }
      }
      const refreshToken = profile?.refresh_token ?? config.bootstrapRefreshToken;
      if (!refreshToken) {
        throw new Error(
          `Wolt Marketplace OAuth for ${environment} needs ${OAUTH_NAMES[environment].refreshToken} because no matching stored refresh token exists`
        );
      }
      const token = await this.#requestRefresh(environment, config, refreshToken, profile?.access_token);
      const nextProfile: TokenProfile = {
        client_id_fingerprint: clientIdFingerprint(config.clientId),
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: this.#now() + token.expiresIn * 1000
      };
      await this.#writeProfile(environment, nextProfile);
      return nextProfile.access_token;
    });
  }

  async #requestRefresh(
    environment: WoltEnvironment,
    config: OAuthConfig,
    refreshToken: string,
    previousAccessToken?: string
  ) {
    const encodedAuthorization = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const authorization = `Basic ${encodedAuthorization}`;
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString();
    const encodedRefreshToken = new URLSearchParams({ refresh_token: refreshToken })
      .toString()
      .slice("refresh_token=".length);
    const secrets = [
      config.clientSecret,
      refreshToken,
      encodedRefreshToken,
      previousAccessToken,
      config.bootstrapRefreshToken,
      authorization,
      encodedAuthorization,
      body
    ].filter(nonEmpty);
    let response: Response;
    try {
      response = await this.#fetcher(resolveOAuthTokenEndpoint(environment), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/x-www-form-urlencoded"
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new Error(`Wolt OAuth refresh failed for ${environment}: ${this.#sanitize(error, secrets)}`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new Error(`Wolt OAuth refresh response failed for ${environment}: ${this.#sanitize(error, secrets)}`);
    }
    if (!response.ok) {
      throw new Error(`Wolt OAuth refresh failed for ${environment} with HTTP ${response.status}: ${this.#sanitize(text, secrets)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Wolt OAuth token endpoint returned invalid JSON for ${environment}`);
    }
    try {
      return validateTokenResponse(data);
    } catch (error) {
      throw new Error(`${this.#sanitize(error, secrets)} for ${environment}`);
    }
  }

  #sanitize(value: unknown, secrets: Array<string | undefined>): string {
    let message = value instanceof Error ? value.message : String(value);
    for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[REDACTED]");
    return message.slice(0, 2_000);
  }

  async #readStore(): Promise<TokenStore> {
    try {
      return parseStore(await readFile(this.#statePath, "utf8"), this.#statePath);
    } catch (error) {
      if (asErrorCode(error) === "ENOENT") return { version: STORE_VERSION, profiles: {} };
      throw error;
    }
  }

  async #readProfile(environment: WoltEnvironment, clientId: string): Promise<TokenProfile | undefined> {
    const profile = (await this.#readStore()).profiles[environment];
    if (!profile || profile.client_id_fingerprint !== clientIdFingerprint(clientId)) return undefined;
    return profile;
  }

  async #writeProfile(environment: WoltEnvironment, profile: TokenProfile): Promise<void> {
    const store = await this.#readStore();
    store.profiles[environment] = profile;
    const directory = dirname(this.#statePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      try {
        await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    try {
      await rename(temporaryPath, this.#statePath);
      await chmod(this.#statePath, 0o600).catch(() => undefined);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async #withFileLock<T>(action: () => Promise<T>): Promise<T> {
    const directory = dirname(this.#statePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);
    const lockPath = `${this.#statePath}.lock`;
    const deadline = Date.now() + this.#lockTimeoutMs;
    let handle;
    while (!handle) {
      try {
        handle = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (asErrorCode(error) !== "EEXIST") throw error;
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > this.#staleLockMs) {
            await unlink(lockPath);
            continue;
          }
        } catch (statError) {
          if (asErrorCode(statError) === "ENOENT") continue;
          throw statError;
        }
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for Wolt OAuth token-store lock at ${lockPath}`);
        await delay(this.#lockRetryMs);
      }
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: Date.now() }), "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
      throw error;
    }
    try {
      return await action();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
