import { describe, expect, it, vi } from "vitest";

import { WoltClient, resolveBaseUrl, resolveCredential } from "../src/client.js";

describe("Wolt client configuration", () => {
  it("selects fixed official hosts for each product and environment", () => {
    expect(resolveBaseUrl("marketplace", "test")).toBe("https://pos-integration-service.development.dev.woltapi.com");
    expect(resolveBaseUrl("marketplace", "production")).toBe("https://pos-integration-service.wolt.com");
    expect(resolveBaseUrl("drive", "test")).toBe("https://daas-public-api.development.dev.woltapi.com");
    expect(resolveBaseUrl("drive", "production")).toBe("https://daas-public-api.wolt.com");
  });

  it("reads the credential for the selected product and environment", () => {
    expect(resolveCredential("marketplace", "test", { WOLT_MARKETPLACE_TOKEN_TEST: "jwt-test" })).toBe("jwt-test");
    expect(resolveCredential("drive", "production", { WOLT_DRIVE_KEY_PRODUCTION: "drive-prod" })).toBe("drive-prod");
    expect(() => resolveCredential("marketplace", "production", {})).toThrow(/WOLT_MARKETPLACE_TOKEN_PRODUCTION/);
  });
});

describe("WoltClient.request", () => {
  it("interpolates path parameters and sends bearer JSON requests", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = new WoltClient({ fetcher, env: { WOLT_MARKETPLACE_TOKEN_TEST: "secret" } });

    const result = await client.request({
      auth: "marketplace",
      environment: "test",
      method: "PATCH",
      path: "/venues/{venueId}/items",
      pathParams: { venueId: "venue / 1" },
      payload: { data: [{ sku: "A", price: 100 }] },
      confirmProduction: false
    });

    expect(result).toEqual({ status: 200, accepted: false, data: { ok: true } });
    expect(fetcher).toHaveBeenCalledWith(
      "https://pos-integration-service.development.dev.woltapi.com/venues/venue%20%2F%201/items",
      expect.objectContaining({
        method: "PATCH",
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer secret", "content-type": "application/json" }),
        body: JSON.stringify({ data: [{ sku: "A", price: 100 }] })
      })
    );
  });

  it.each([201, 202, 204])("handles successful HTTP %s responses", async (status) => {
    const client = new WoltClient({
      fetcher: vi.fn(async () => new Response(status === 204 ? null : JSON.stringify({ status }), {
        status,
        headers: { "content-type": "application/json" }
      })),
      env: { WOLT_MARKETPLACE_TOKEN_TEST: "secret" }
    });
    await expect(client.request({
      auth: "marketplace",
      environment: "test",
      method: "POST",
      path: "/test",
      pathParams: {},
      confirmProduction: false
    })).resolves.toMatchObject({ status });
  });

  it.each([400, 401, 403, 404, 409, 429, 500, 503])("surfaces HTTP %s without leaking credentials", async (status) => {
    const client = new WoltClient({
      fetcher: vi.fn(async () => new Response(JSON.stringify({ error: `status-${status}` }), {
        status,
        headers: { "content-type": "application/json" }
      })),
      env: { WOLT_MARKETPLACE_TOKEN_TEST: "secret" }
    });
    await expect(client.request({
      auth: "marketplace",
      environment: "test",
      method: "GET",
      path: "/test",
      pathParams: {},
      confirmProduction: false
    })).rejects.toThrow(new RegExp(`HTTP ${status}.*status-${status}`));
  });

  it("rejects production mutations without explicit confirmation", async () => {
    const client = new WoltClient({ fetcher: vi.fn(), env: { WOLT_MARKETPLACE_TOKEN_PRODUCTION: "secret" } });
    await expect(client.request({
      auth: "marketplace",
      environment: "production",
      method: "POST",
      path: "/orders/{orderId}/refund-basket",
      pathParams: { orderId: "order-1" },
      payload: { amount: 100 },
      confirmProduction: false
    })).rejects.toThrow(/confirm_production/);
  });

  it("returns accepted metadata for empty 202 and 204 responses", async () => {
    const responses = [new Response(null, { status: 202 }), new Response(null, { status: 204 })];
    const client = new WoltClient({
      fetcher: vi.fn(async () => responses.shift()!),
      env: { WOLT_MARKETPLACE_TOKEN_TEST: "secret" }
    });
    const base = {
      auth: "marketplace" as const,
      environment: "test" as const,
      method: "PUT" as const,
      path: "/orders/{orderId}/ready",
      pathParams: { orderId: "o" },
      confirmProduction: false
    };
    await expect(client.request(base)).resolves.toEqual({ status: 202, accepted: true, data: null });
    await expect(client.request(base)).resolves.toEqual({ status: 204, accepted: true, data: null });
  });

  it("sanitizes API errors and never includes the bearer token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "bad request" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    }));
    const client = new WoltClient({ fetcher, env: { WOLT_MARKETPLACE_TOKEN_TEST: "top-secret-token" } });
    let message = "";
    try {
      await client.request({
        auth: "marketplace",
        environment: "test",
        method: "GET",
        path: "/orders/{orderId}",
        pathParams: { orderId: "bad" },
        confirmProduction: false
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("400");
    expect(message).toContain("bad request");
    expect(message).not.toContain("top-secret-token");
  });
});
