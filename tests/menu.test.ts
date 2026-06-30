import { describe, expect, it, vi } from "vitest";

import { findMenuItems, getQuantityOnStock, MenuService } from "../src/menu.js";
import type { WoltClient } from "../src/client.js";

const menu = {
  id: "menu-1",
  items: [
    {
      id: "v2-1",
      product: { external_id: "EXT-1", gtin: "GTIN-1", sku: "SKU-1", quantity: 999 },
      quantity: 7,
      inventory_mode: "LIMITED_QUANTITY"
    },
    {
      id: "v2-2",
      product: { external_id: "DUP", sku: "SKU-2" },
      inventory: 3
    }
  ],
  categories: [
    {
      items: [{ external_data: "LEGACY-1", merchant_sku: "OLD-SKU", gtin_barcode: "OLD-GTIN", quantity: 5 }],
      subcategories: [{ items: [{ external_data: "DUP", quantity: 2 }] }]
    }
  ]
};

describe("menu item helpers", () => {
  it("matches v2 and legacy item identifiers", () => {
    expect(findMenuItems(menu, { external_id: "EXT-1" })).toHaveLength(1);
    expect(findMenuItems(menu, { sku: "OLD-SKU" })).toHaveLength(1);
    expect(findMenuItems(menu, { gtin: "OLD-GTIN" })).toHaveLength(1);
    expect(findMenuItems(menu, { external_id: "DUP" })).toHaveLength(2);
  });

  it("requires exactly one selector", () => {
    expect(() => findMenuItems(menu, {})).toThrow(/exactly one/i);
    expect(() => findMenuItems(menu, { sku: "SKU-1", gtin: "GTIN-1" })).toThrow(/exactly one/i);
  });

  it("returns only top-level stock fields and never product quantity", () => {
    expect(getQuantityOnStock(menu, { sku: "SKU-1" })).toEqual({
      matches: 1,
      items: [{ id: "v2-1", quantity: 7, source_field: "quantity", inventory_mode: "LIMITED_QUANTITY", explanation: null }]
    });
    const noTopLevel = { items: [{ id: "x", product: { sku: "NESTED", quantity: 44 }, inventory_mode: "LIMITED_QUANTITY" }] };
    expect(getQuantityOnStock(noTopLevel, { sku: "NESTED" }).items[0]).toEqual({
      id: "x",
      quantity: null,
      source_field: null,
      inventory_mode: "LIMITED_QUANTITY",
      explanation: "Wolt did not expose an item-level stock quantity in the live menu response."
    });
  });
});

describe("MenuService.getMenu", () => {
  it("polls an allowed resource URL until the menu is ready", async () => {
    const client = {
      request: vi.fn(async () => ({
        status: 202,
        accepted: true,
        data: { request_id: "r1", resource_url: "https://bucket.s3.eu-west-1.amazonaws.com/result" }
      }))
    } as unknown as WoltClient;
    const responses = [
      new Response(JSON.stringify({ request_id: "r1", status: "PENDING" }), { status: 200 }),
      new Response(JSON.stringify({ request_id: "r1", status: "READY", menu: { id: "m1", items: [] } }), { status: 200 })
    ];
    const service = new MenuService({ client, fetcher: vi.fn(async () => responses.shift()!), sleep: vi.fn(async () => undefined) });

    await expect(service.getMenu({ environment: "test", venueId: "v1", timeoutMs: 1000 })).resolves.toEqual({ id: "m1", items: [] });
  });

  it("blocks redirects when polling the generated menu resource", async () => {
    const client = {
      request: vi.fn(async () => ({
        status: 202,
        accepted: true,
        data: { request_id: "r1", resource_url: "https://bucket.s3.eu-west-1.amazonaws.com/result" }
      }))
    } as unknown as WoltClient;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return new Response(JSON.stringify({ status: "READY", menu: { id: "m1" } }), { status: 200 });
    });
    const service = new MenuService({ client, fetcher });

    await expect(service.getMenu({ environment: "test", venueId: "v1" })).resolves.toEqual({ id: "m1" });
  });

  it("never sleeps past the menu polling deadline", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const client = {
      request: vi.fn(async () => ({
        status: 202,
        accepted: true,
        data: { request_id: "r1", resource_url: "https://x.amazonaws.com/result" }
      }))
    } as unknown as WoltClient;
    const service = new MenuService({
      client,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ status: "PENDING" }), { status: 200 })),
      sleep: vi.fn(async (milliseconds) => { sleeps.push(milliseconds); now += milliseconds; }),
      now: () => now
    });

    await expect(service.getMenu({ environment: "test", venueId: "v1", timeoutMs: 750 })).rejects.toThrow(/timed out/i);
    expect(sleeps).toEqual([500, 250]);
    expect(timeoutSpy.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([750, 250]);
    timeoutSpy.mockRestore();
  });

  it("rejects unsafe resource URLs", async () => {
    const client = {
      request: vi.fn(async () => ({ status: 202, accepted: true, data: { request_id: "r1", resource_url: "http://127.0.0.1/secret" } }))
    } as unknown as WoltClient;
    const service = new MenuService({ client, fetcher: vi.fn() });
    await expect(service.getMenu({ environment: "test", venueId: "v1" })).rejects.toThrow(/unsafe/i);
  });

  it("rejects malformed initial and polling responses", async () => {
    const malformedInitial = new MenuService({
      client: { request: vi.fn(async () => ({ status: 202, accepted: true, data: null })) } as unknown as WoltClient,
      fetcher: vi.fn()
    });
    await expect(malformedInitial.getMenu({ environment: "test", venueId: "v1" })).rejects.toThrow(/malformed asynchronous/i);

    const client = {
      request: vi.fn(async () => ({
        status: 202,
        accepted: true,
        data: { resource_url: "https://x.amazonaws.com/result" }
      }))
    } as unknown as WoltClient;
    const malformedJson = new MenuService({
      client,
      fetcher: vi.fn(async () => new Response("not-json", { status: 200 }))
    });
    await expect(malformedJson.getMenu({ environment: "test", venueId: "v1" })).rejects.toThrow(/malformed JSON/i);

    const unknownStatus = new MenuService({
      client,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ status: "MYSTERY" }), { status: 200 }))
    });
    await expect(unknownStatus.getMenu({ environment: "test", venueId: "v1" })).rejects.toThrow(/Unknown Wolt menu status/);
  });

  it("surfaces Wolt error and timeout states", async () => {
    const makeClient = () => ({
      request: vi.fn(async () => ({ status: 202, accepted: true, data: { request_id: "r1", resource_url: "https://x.amazonaws.com/result" } }))
    } as unknown as WoltClient);
    const errorService = new MenuService({
      client: makeClient(),
      fetcher: vi.fn(async () => new Response(JSON.stringify({ status: "ERROR", error: "generation failed" }), { status: 200 }))
    });
    await expect(errorService.getMenu({ environment: "test", venueId: "v1" })).rejects.toThrow(/generation failed/);

    const timeoutService = new MenuService({
      client: makeClient(),
      fetcher: vi.fn(async () => new Response(JSON.stringify({ status: "PENDING" }), { status: 200 })),
      sleep: vi.fn(async () => undefined),
      now: (() => { let n = 0; return () => (n += 100); })()
    });
    await expect(timeoutService.getMenu({ environment: "test", venueId: "v1", timeoutMs: 50 })).rejects.toThrow(/timed out/i);
  });
});
