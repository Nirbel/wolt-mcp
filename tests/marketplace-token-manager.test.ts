import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MarketplaceTokenManager,
  resolveOAuthTokenEndpoint
} from "../src/marketplace-token-manager.js";

const temporaryDirectories: string[] = [];

async function temporaryStore(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wolt-oauth-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "oauth-tokens.json");
}

function oauthEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    WOLT_MARKETPLACE_CLIENT_ID_TEST: "test-client-id",
    WOLT_MARKETPLACE_CLIENT_SECRET_TEST: "test-client-secret",
    WOLT_MARKETPLACE_REFRESH_TOKEN_TEST: "bootstrap-refresh-token",
    ...overrides
  };
}

function fingerprint(clientId = "test-client-id"): string {
  return createHash("sha256").update(clientId).digest("hex");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("MarketplaceTokenManager configuration", () => {
  it("keeps static Marketplace token mode working", async () => {
    const fetcher = vi.fn();
    const manager = new MarketplaceTokenManager({
      env: { WOLT_MARKETPLACE_TOKEN_TEST: "static-test-token" },
      fetcher
    });

    await expect(manager.getAccessToken("test")).resolves.toBe("static-test-token");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects partial OAuth configuration instead of silently using static mode", async () => {
    const manager = new MarketplaceTokenManager({
      env: {
        WOLT_MARKETPLACE_TOKEN_TEST: "static-test-token",
        WOLT_MARKETPLACE_CLIENT_ID_TEST: "client-id"
      }
    });

    await expect(manager.getAccessToken("test")).rejects.toThrow(
      /Incomplete Wolt Marketplace OAuth configuration.*WOLT_MARKETPLACE_CLIENT_SECRET_TEST/
    );
  });
});

describe("MarketplaceTokenManager refresh", () => {
  it("uses the official OAuth endpoint for each environment", () => {
    expect(resolveOAuthTokenEndpoint("test")).toBe(
      "https://integrations-authentication-service.development.dev.woltapi.com/oauth2/token"
    );
    expect(resolveOAuthTokenEndpoint("production")).toBe(
      "https://integrations-authentication-service.wolt.com/oauth2/token"
    );
  });

  it("uses the bootstrap refresh token and atomically persists the rotated pair", async () => {
    const statePath = await temporaryStore();
    const now = 1_800_000_000_000;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600,
      token_type: "Bearer"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const manager = new MarketplaceTokenManager({ env: oauthEnv(), fetcher, statePath, now: () => now });

    await expect(manager.getAccessToken("test")).resolves.toBe("new-access-token");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(resolveOAuthTokenEndpoint("test"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      }),
      body: "grant_type=refresh_token&refresh_token=bootstrap-refresh-token"
    }));

    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state).toEqual({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_at: now + 3_600_000
        }
      }
    });
  });

  it("reuses a stored access token until the 60-second refresh window", async () => {
    const statePath = await temporaryStore();
    const now = 1_800_000_000_000;
    await writeFile(statePath, JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "stored-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: now + 61_000
        }
      }
    }));
    const fetcher = vi.fn();
    const manager = new MarketplaceTokenManager({ env: oauthEnv(), fetcher, statePath, now: () => now });

    await expect(manager.getAccessToken("test")).resolves.toBe("stored-access-token");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refreshes an expiring stored token with its rotated refresh token", async () => {
    const statePath = await temporaryStore();
    const now = 1_800_000_000_000;
    await writeFile(statePath, JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "expiring-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: now + 60_000
        }
      }
    }));
    const fetcher = vi.fn(async (_url, init) => {
      expect(init?.body).toBe("grant_type=refresh_token&refresh_token=stored-refresh-token");
      return new Response(JSON.stringify({
        access_token: "rotated-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        token_type: "bearer"
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const manager = new MarketplaceTokenManager({ env: oauthEnv(), fetcher, statePath, now: () => now });

    await expect(manager.getAccessToken("test")).resolves.toBe("rotated-access-token");
  });

  it("shares one refresh across concurrent calls in the same process", async () => {
    const statePath = await temporaryStore();
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        access_token: "shared-access-token",
        refresh_token: "shared-refresh-token",
        expires_in: 3600,
        token_type: "Bearer"
      }), { status: 200 });
    });
    const manager = new MarketplaceTokenManager({ env: oauthEnv(), fetcher, statePath });

    await expect(Promise.all([
      manager.getAccessToken("test"),
      manager.getAccessToken("test"),
      manager.getAccessToken("test")
    ])).resolves.toEqual(["shared-access-token", "shared-access-token", "shared-access-token"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rereads state under the file lock so separate managers rotate only once", async () => {
    const statePath = await temporaryStore();
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(JSON.stringify({
        access_token: "cross-process-access-token",
        refresh_token: "cross-process-refresh-token",
        expires_in: 3600,
        token_type: "Bearer"
      }), { status: 200 });
    });
    const options = { env: oauthEnv(), fetcher, statePath, lockRetryMs: 1 };
    const firstProcess = new MarketplaceTokenManager(options);
    const secondProcess = new MarketplaceTokenManager(options);

    await expect(Promise.all([
      firstProcess.getAccessToken("test"),
      secondProcess.getAccessToken("test")
    ])).resolves.toEqual(["cross-process-access-token", "cross-process-access-token"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("requires a new bootstrap token when the stored client ID fingerprint changes", async () => {
    const statePath = await temporaryStore();
    await writeFile(statePath, JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint("previous-client-id"),
          access_token: "previous-access-token",
          refresh_token: "previous-refresh-token",
          expires_at: Date.now() + 3_600_000
        }
      }
    }));
    const manager = new MarketplaceTokenManager({
      env: {
        WOLT_MARKETPLACE_CLIENT_ID_TEST: "test-client-id",
        WOLT_MARKETPLACE_CLIENT_SECRET_TEST: "test-client-secret"
      },
      statePath
    });

    await expect(manager.getAccessToken("test")).rejects.toThrow(/WOLT_MARKETPLACE_REFRESH_TOKEN_TEST/);
  });

  it("preserves prior state when the token response is malformed", async () => {
    const statePath = await temporaryStore();
    const original = JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "expired-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: 1
        }
      }
    });
    await writeFile(statePath, original);
    const manager = new MarketplaceTokenManager({
      env: oauthEnv(),
      statePath,
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        access_token: "uncommitted-access-token",
        expires_in: 3600,
        token_type: "Bearer"
      }), { status: 200 }))
    });

    await expect(manager.getAccessToken("test")).rejects.toThrow(/missing refresh_token/);
    expect(await readFile(statePath, "utf8")).toBe(original);
  });

  it("does not create state and redacts all credentials from token-endpoint errors", async () => {
    const statePath = await temporaryStore();
    const basic = Buffer.from("test-client-id:test-client-secret").toString("base64");
    const encodedRefreshToken = "bootstrap%2B%2F+refresh";
    const manager = new MarketplaceTokenManager({
      env: oauthEnv({ WOLT_MARKETPLACE_REFRESH_TOKEN_TEST: "bootstrap+/ refresh" }),
      statePath,
      fetcher: vi.fn(async () => new Response(
        `invalid test-client-secret ${encodedRefreshToken} Basic ${basic}`,
        { status: 401 }
      ))
    });

    let message = "";
    try {
      await manager.getAccessToken("test");
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain("test-client-secret");
    expect(message).not.toContain("bootstrap+/ refresh");
    expect(message).not.toContain(encodedRefreshToken);
    expect(message).not.toContain(basic);
    await expect(access(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("force-refreshes after an unexpected unauthorized response", async () => {
    const statePath = await temporaryStore();
    const now = Date.now();
    await writeFile(statePath, JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "rejected-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: now + 3_600_000
        }
      }
    }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      access_token: "recovered-access-token",
      refresh_token: "recovered-refresh-token",
      expires_in: 3600,
      token_type: "Bearer"
    }), { status: 200 }));
    const manager = new MarketplaceTokenManager({ env: oauthEnv(), fetcher, statePath, now: () => now });

    await expect(manager.refreshAfterUnauthorized("test", "rejected-access-token")).resolves.toBe("recovered-access-token");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not rotate twice when separate processes recover from the same rejected token", async () => {
    const statePath = await temporaryStore();
    const now = Date.now();
    await writeFile(statePath, JSON.stringify({
      version: 1,
      profiles: {
        test: {
          client_id_fingerprint: fingerprint(),
          access_token: "rejected-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: now + 3_600_000
        }
      }
    }));
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        access_token: "shared-recovered-token",
        refresh_token: "shared-rotated-token",
        expires_in: 3600,
        token_type: "Bearer"
      }), { status: 200 });
    });
    const options = { env: oauthEnv(), fetcher, statePath, now: () => now, lockRetryMs: 1 };
    const firstProcess = new MarketplaceTokenManager(options);
    const secondProcess = new MarketplaceTokenManager(options);

    await expect(Promise.all([
      firstProcess.refreshAfterUnauthorized("test", "rejected-access-token"),
      secondProcess.refreshAfterUnauthorized("test", "rejected-access-token")
    ])).resolves.toEqual(["shared-recovered-token", "shared-recovered-token"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
