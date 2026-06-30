import { describe, expect, it, vi } from "vitest";

import type { WoltClient } from "../src/client.js";
import type { MenuService } from "../src/menu.js";
import { buildToolDefinitions, createToolRuntime } from "../src/tools.js";

describe("MCP tool definitions", () => {
  it("publishes 38 official operations and three helpers", () => {
    const tools = buildToolDefinitions();
    expect(tools).toHaveLength(41);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(41);
    expect(tools.slice(-3).map((tool) => tool.name)).toEqual([
      "menu_get_item",
      "menu_get_qty_on_stock",
      "order_submitter_validate"
    ]);
  });

  it("requires environment and nests official request bodies under payload", () => {
    const tool = buildToolDefinitions().find((candidate) => candidate.name === "menu_update_items")!;
    expect(tool.inputSchema.required).toContain("environment");
    expect(tool.inputSchema.required).toContain("venueId");
    expect(tool.inputSchema.required).toContain("payload");
    expect(tool.inputSchema.properties).toMatchObject({
      environment: { enum: ["test", "production"] },
      confirm_production: { type: "boolean" },
      payload: { type: "object" }
    });
    expect((tool.inputSchema.properties.payload as { properties: object }).properties).toHaveProperty("data");
  });

  it("marks read and mutation annotations accurately", () => {
    const tools = buildToolDefinitions();
    expect(tools.find((tool) => tool.name === "order_get_v2")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools.find((tool) => tool.name === "order_refund_basket")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("tool runtime", () => {
  it("dispatches an official operation with path parameters and payload", async () => {
    const client = {
      request: vi.fn(async () => ({ status: 202, accepted: true, data: null }))
    } as unknown as WoltClient;
    const menuService = {} as MenuService;
    const runtime = createToolRuntime({ client, menuService });

    await expect(runtime.execute("menu_update_items", {
      environment: "test",
      venueId: "venue-1",
      payload: { data: [{ sku: "A", price: 100 }] }
    })).resolves.toEqual({ status: 202, accepted: true, data: null });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      environment: "test",
      method: "PATCH",
      path: "/venues/{venueId}/items",
      pathParams: { venueId: "venue-1" },
      payload: { data: [{ sku: "A", price: 100 }] },
      confirmProduction: false
    }));
  });

  it("requires explicit confirmation for whole-menu replacement", async () => {
    const client = { request: vi.fn() } as unknown as WoltClient;
    const runtime = createToolRuntime({ client, menuService: {} as MenuService });
    await expect(runtime.execute("menu_replace", {
      environment: "test",
      venueId: "venue-1",
      payload: { currency: "EUR", primary_language: "en", categories: [] }
    })).rejects.toThrow(/confirm_replace/);
  });

  it("uses the menu service for item and quantity helpers", async () => {
    const menuService = {
      getMenu: vi.fn(async () => ({ items: [{ id: "1", product: { sku: "A" }, quantity: 4 }] }))
    } as unknown as MenuService;
    const runtime = createToolRuntime({ client: {} as WoltClient, menuService });
    await expect(runtime.execute("menu_get_item", { environment: "test", venueId: "v", sku: "A" }))
      .resolves.toMatchObject({ count: 1 });
    await expect(runtime.execute("menu_get_qty_on_stock", { environment: "test", venueId: "v", sku: "A" }))
      .resolves.toMatchObject({ matches: 1, items: [{ quantity: 4 }] });
  });
});
