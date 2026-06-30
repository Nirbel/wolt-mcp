import { Ajv, type ValidateFunction } from "ajv";

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { operationCatalog, type WoltEnvironment, type WoltOperation } from "./catalog.js";
import type { WoltClient } from "./client.js";
import { findMenuItems, getQuantityOnStock, type ItemSelector, type MenuService } from "./menu.js";
import { validateOrderSubmitter } from "./order-submitter.js";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
};

function cloneSchema(schema: unknown): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema, (key, value) => {
    if (key === "$schema" || key === "examples" || key === "example" || key.startsWith("x-")) return undefined;
    return value;
  })) as Record<string, unknown>;
  return clone;
}

function operationInputSchema(operation: WoltOperation): JsonSchema {
  const properties: Record<string, unknown> = {
    environment: {
      type: "string",
      enum: ["test", "production"],
      description: "Wolt environment. Must be chosen explicitly for every network call."
    }
  };
  const required = ["environment"];

  for (const group of operation.parameters) {
    if (group.type === "path") {
      const schema = cloneSchema(group.schema);
      Object.assign(properties, schema.properties ?? {});
      for (const name of (schema.required as string[] | undefined) ?? []) if (!required.includes(name)) required.push(name);
    }
    if (group.type === "body") {
      properties.payload = cloneSchema(group.schema);
      required.push("payload");
    }
  }

  if (operation.mutation) {
    properties.confirm_production = {
      type: "boolean",
      default: false,
      description: "Must be true for mutations sent to production."
    };
  }
  if (operation.name === "menu_replace") {
    properties.confirm_replace = {
      type: "boolean",
      const: true,
      description: "Required because this operation creates or replaces the venue's entire menu."
    };
    required.push("confirm_replace");
  }
  if (operation.name === "menu_get") {
    properties.timeout_ms = {
      type: "integer",
      minimum: 100,
      maximum: 120000,
      default: 30000,
      description: "Maximum time to poll Wolt's asynchronous menu resource."
    };
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function annotations(operation: WoltOperation): ToolAnnotations {
  return {
    title: operation.summary,
    readOnlyHint: !operation.mutation,
    destructiveHint: operation.mutation,
    idempotentHint: operation.method === "PUT" || operation.method === "PATCH",
    openWorldHint: true
  };
}

const selectorProperties = {
  id: { type: "string", description: "Wolt item ID." },
  external_id: { type: "string", description: "Matches v2 external_id or legacy external_data." },
  gtin: { type: "string", description: "Matches v2 gtin or legacy gtin_barcode." },
  sku: { type: "string", description: "Matches v2 sku or legacy merchant_sku." }
};

function menuHelper(name: string, title: string, description: string): ToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties: {
        environment: { type: "string", enum: ["test", "production"] },
        venueId: { type: "string" },
        ...selectorProperties,
        timeout_ms: { type: "integer", minimum: 100, maximum: 120000, default: 30000 }
      },
      required: ["environment", "venueId"],
      additionalProperties: false
    },
    annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  };
}

export function buildToolDefinitions(): ToolDefinition[] {
  const official = operationCatalog.map<ToolDefinition>((operation) => ({
    name: operation.name,
    title: operation.summary,
    description: `${operation.description}\n\nOfficial endpoint: ${operation.method} ${operation.path}`,
    inputSchema: operationInputSchema(operation),
    annotations: annotations(operation)
  }));
  return [
    ...official,
    menuHelper("menu_get_item", "Get menu item", "Fetch the live menu and return items matching exactly one identifier."),
    menuHelper("menu_get_qty_on_stock", "Get item stock quantity", "Return an item-level quantity only when Wolt exposes it in the live menu response; otherwise return null with an explanation."),
    {
      name: "order_submitter_validate",
      title: "Validate Order Submitter payload",
      description: "Parse an official Wolt Order Submitter payload and optionally verify its WOLT-SIGNATURE HMAC-SHA256 header.",
      inputSchema: {
        type: "object",
        properties: {
          environment: { type: "string", enum: ["test", "production"] },
          raw_body: { type: "string", description: "Exact, unmodified HTTP request body." },
          signature: { type: "string", pattern: "^[0-9a-fA-F]{64}$", description: "Optional WOLT-SIGNATURE header." }
        },
        required: ["environment", "raw_body"],
        additionalProperties: false
      },
      annotations: { title: "Validate Order Submitter payload", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Tool arguments must be an object");
  return value as Record<string, unknown>;
}

function environment(args: Record<string, unknown>): WoltEnvironment {
  if (args.environment !== "test" && args.environment !== "production") throw new Error("environment must be test or production");
  return args.environment;
}

function selector(args: Record<string, unknown>): ItemSelector {
  return {
    ...(typeof args.id === "string" ? { id: args.id } : {}),
    ...(typeof args.external_id === "string" ? { external_id: args.external_id } : {}),
    ...(typeof args.gtin === "string" ? { gtin: args.gtin } : {}),
    ...(typeof args.sku === "string" ? { sku: args.sku } : {})
  };
}

function pathParameters(operation: WoltOperation, args: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const match of operation.path.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1]!;
    const value = args[name];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Missing Wolt path parameter: ${name}`);
    output[name] = value;
  }
  return output;
}

export function createToolRuntime(options: { client: WoltClient; menuService: MenuService }) {
  const tools = buildToolDefinitions();
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validators = new Map<string, ValidateFunction>(tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));

  return {
    tools,
    async execute(name: string, rawArguments: unknown): Promise<unknown> {
      const args = asRecord(rawArguments ?? {});
      const validator = validators.get(name);
      if (!validator) throw new Error(`Unknown Wolt tool: ${name}`);
      if (!validator(args)) {
        const details = (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
        throw new Error(`Invalid arguments for ${name}: ${details}`);
      }

      if (name === "order_submitter_validate") {
        return validateOrderSubmitter({
          environment: environment(args),
          rawBody: String(args.raw_body),
          ...(typeof args.signature === "string" ? { signature: args.signature } : {})
        });
      }
      if (name === "menu_get_item" || name === "menu_get_qty_on_stock") {
        const menu = await options.menuService.getMenu({
          environment: environment(args),
          venueId: String(args.venueId),
          ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {})
        });
        if (name === "menu_get_item") {
          const items = findMenuItems(menu, selector(args));
          return { count: items.length, items };
        }
        return getQuantityOnStock(menu, selector(args));
      }

      const operation = operationCatalog.find((candidate) => candidate.name === name);
      if (!operation) throw new Error(`Unknown Wolt operation: ${name}`);
      if (operation.name === "menu_replace" && args.confirm_replace !== true) {
        throw new Error("Whole-menu replacement requires confirm_replace: true");
      }
      if (operation.name === "menu_get") {
        return options.menuService.getMenu({
          environment: environment(args),
          venueId: String(args.venueId),
          ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {})
        });
      }
      return options.client.request({
        auth: operation.auth,
        environment: environment(args),
        method: operation.method,
        path: operation.path,
        pathParams: pathParameters(operation, args),
        ...(args.payload !== undefined ? { payload: args.payload } : {}),
        confirmProduction: args.confirm_production === true
      });
    }
  };
}
