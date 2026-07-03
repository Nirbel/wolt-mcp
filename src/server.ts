import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";

import pkg from "../package.json" with { type: "json" };

import { WoltClient } from "./client.js";
import { MenuService } from "./menu.js";
import { ORDER_SUBMITTER_SCHEMA } from "./order-submitter.js";
import { createToolRuntime } from "./tools.js";

function resultContent(value: unknown): CallToolResult {
  const structuredContent = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

export function createWoltServer(options: { client?: WoltClient; menuService?: MenuService } = {}): Server {
  const client = options.client ?? new WoltClient();
  const menuService = options.menuService ?? new MenuService({ client });
  const runtime = createToolRuntime({ client, menuService });
  const server = new Server(
    { name: "wolt", version: pkg.version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: "Choose test or production explicitly. Read operations are safe. Production mutations require confirm_production=true. Never request credentials in tool arguments."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: runtime.tools as Tool[] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return resultContent(await runtime.execute(request.params.name, request.params.arguments));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: "wolt://schemas/order-submitter",
      name: "Wolt Order Submitter schema",
      description: "JSON Schema used by the order_submitter_validate tool.",
      mimeType: "application/schema+json"
    }]
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== "wolt://schemas/order-submitter") throw new Error(`Unknown Wolt resource: ${request.params.uri}`);
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/schema+json",
        text: JSON.stringify(ORDER_SUBMITTER_SCHEMA, null, 2)
      }]
    };
  });
  return server;
}
