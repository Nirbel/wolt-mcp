import { createHmac, timingSafeEqual } from "node:crypto";

import { Ajv, type ErrorObject } from "ajv";

import type { WoltEnvironment } from "./catalog.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ORDER_SUBMITTER_SCHEMA = {
  $id: "wolt-order-submitter",
  type: "object",
  additionalProperties: true,
  required: ["id", "venue", "items", "created_at", "order_number", "order_status", "type"],
  properties: {
    id: { type: "string", minLength: 1 },
    venue: {
      type: "object",
      additionalProperties: true,
      required: ["id"],
      properties: { id: { type: "string" }, name: { type: "string" } }
    },
    price: {
      type: "object",
      additionalProperties: true,
      properties: {
        amount: { type: "integer" },
        currency: { type: "string" }
      }
    },
    delivery: {
      type: "object",
      additionalProperties: true,
      properties: {
        status: {
          type: "string",
          description: "Known values: estimated, assigned, courier_at_venue, picked_up, courier_at_delivery_location, delivered. Unknown values are accepted for forward-compatibility and reported in warnings."
        },
        type: { type: "string", description: "Known values: takeaway, homedelivery, eatin. Unknown values are accepted and reported in warnings." },
        time: { type: ["string", "null"] },
        self_delivery: { type: "boolean" }
      }
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          count: { type: "integer" },
          pos_id: { type: ["string", "null"] },
          row_number: { type: "integer" },
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                value: { type: "string" },
                count: { type: "integer" },
                pos_id: { type: ["string", "null"] },
                value_pos_id: { type: ["string", "null"] },
                price: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    amount: { type: "integer" },
                    currency: { type: "string" }
                  }
                }
              }
            }
          },
          category: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string" },
              name: { type: "string" }
            }
          },
          substitution_settings: {
            type: "object",
            additionalProperties: true,
            properties: { is_allowed: { type: "boolean" } }
          },
          total_price: {
            type: "object",
            additionalProperties: true,
            properties: { amount: { type: "integer" }, currency: { type: "string" } }
          },
          unit_price: {
            type: "object",
            additionalProperties: true,
            properties: { amount: { type: "integer" }, currency: { type: "string" } }
          },
          base_price: {
            type: "object",
            additionalProperties: true,
            properties: { amount: { type: "integer" }, currency: { type: "string" } }
          },
          weight_details: {
            type: ["object", "null"],
            additionalProperties: true,
            properties: {
              weight_in_grams: { type: "integer" },
              requested_amount: { type: "integer" },
              extra_weight_percentage: { type: "integer" }
            }
          },
          sku: { type: ["string", "null"] },
          gtin: { type: ["string", "null"] },
          item_type: { type: "string", description: "Known values: order-item, order-retail-item. Unknown values are accepted and reported in warnings." }
        }
      }
    },
    created_at: { type: "string" },
    modified_at: { type: "string" },
    pickup_eta: { type: "string" },
    order_number: { type: "string" },
    order_status: {
      type: "string",
      description: "Known values: received, fetched, acknowledged, production, ready, delivered, rejected, other. Unknown values are accepted and reported in warnings."
    },
    type: { type: "string", description: "Known values: preorder, instant. Unknown values are accepted and reported in warnings." },
    consumer_comment: { type: ["string", "null"] },
    consumer_name: { type: "string" },
    consumer_phone_number: { type: ["string", "null"] },
    attribution_id: { type: "string" },
    company_tax_id: { type: ["string", "null"] },
    pre_order: {
      type: ["object", "null"],
      additionalProperties: true,
      properties: {
        preorder_time: { type: "string" },
        pre_order_status: { type: "string", description: "Known values: confirmed, waiting. Unknown values are accepted and reported in warnings." }
      }
    }
  }
} as const;

const KNOWN_ENUM_VALUES = {
  order_status: ["received", "fetched", "acknowledged", "production", "ready", "delivered", "rejected", "other"],
  type: ["preorder", "instant"],
  "delivery.status": ["estimated", "assigned", "courier_at_venue", "picked_up", "courier_at_delivery_location", "delivered"],
  "delivery.type": ["takeaway", "homedelivery", "eatin"],
  item_type: ["order-item", "order-retail-item"],
  "pre_order.pre_order_status": ["confirmed", "waiting"]
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(ORDER_SUBMITTER_SCHEMA);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function unrecognizedValue(field: string, value: unknown, known: readonly string[]): string | null {
  if (typeof value !== "string" || known.includes(value)) return null;
  return `Unrecognized ${field} "${value}" (known: ${known.join(", ")}). Accepted for forward-compatibility.`;
}

function collectEnumWarnings(order: unknown): string[] {
  if (!isObject(order)) return [];
  const warnings: string[] = [];
  const check = (field: string, value: unknown, known: readonly string[]): void => {
    const warning = unrecognizedValue(field, value, known);
    if (warning) warnings.push(warning);
  };
  check("order_status", order.order_status, KNOWN_ENUM_VALUES.order_status);
  check("type", order.type, KNOWN_ENUM_VALUES.type);
  if (isObject(order.delivery)) {
    check("delivery.status", order.delivery.status, KNOWN_ENUM_VALUES["delivery.status"]);
    check("delivery.type", order.delivery.type, KNOWN_ENUM_VALUES["delivery.type"]);
  }
  if (Array.isArray(order.items)) {
    order.items.forEach((item, index) => {
      if (isObject(item)) check(`items[${index}].item_type`, item.item_type, KNOWN_ENUM_VALUES.item_type);
    });
  }
  if (isObject(order.pre_order)) {
    check("pre_order.pre_order_status", order.pre_order.pre_order_status, KNOWN_ENUM_VALUES["pre_order.pre_order_status"]);
  }
  return warnings;
}

export function validateOrderSubmitter(options: {
  environment: WoltEnvironment;
  rawBody: string;
  signature?: string;
  env?: Record<string, string | undefined>;
}): { valid: boolean; signature_valid: boolean | null; order: unknown; errors: string[]; warnings: string[] } {
  let signatureValid: boolean | null = null;
  if (options.signature !== undefined) {
    const name = options.environment === "test" ? "WOLT_WEBHOOK_SECRET_TEST" : "WOLT_WEBHOOK_SECRET_PRODUCTION";
    const secret = (options.env ?? process.env)[name]?.trim();
    if (!secret) throw new Error(`Missing Wolt webhook secret: set ${name}`);
    signatureValid = verifySignature(options.rawBody, options.signature, secret);
    if (!signatureValid) {
      return {
        valid: false,
        signature_valid: false,
        order: null,
        errors: ["WOLT-SIGNATURE verification failed; body not validated"],
        warnings: []
      };
    }
  }

  let order: unknown;
  try {
    order = JSON.parse(options.rawBody);
  } catch {
    throw new Error("Order Submitter body is not valid JSON");
  }

  const valid = validate(order);
  return {
    valid,
    signature_valid: signatureValid,
    order,
    errors: valid ? [] : formatErrors(validate.errors),
    warnings: collectEnumWarnings(order)
  };
}
