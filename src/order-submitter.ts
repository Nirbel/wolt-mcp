import { createHmac, timingSafeEqual } from "node:crypto";

import { Ajv, type ErrorObject } from "ajv";

import type { WoltEnvironment } from "./catalog.js";

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
          enum: ["estimated", "assigned", "courier_at_venue", "picked_up", "courier_at_delivery_location", "delivered"]
        },
        type: { type: "string", enum: ["takeaway", "homedelivery", "eatin"] },
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
          item_type: { type: "string", enum: ["order-item", "order-retail-item"] }
        }
      }
    },
    created_at: { type: "string" },
    modified_at: { type: "string" },
    pickup_eta: { type: "string" },
    order_number: { type: "string" },
    order_status: {
      type: "string",
      enum: ["received", "fetched", "acknowledged", "production", "ready", "delivered", "rejected", "other"]
    },
    type: { type: "string", enum: ["preorder", "instant"] },
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
        pre_order_status: { type: "string", enum: ["confirmed", "waiting"] }
      }
    }
  }
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

export function validateOrderSubmitter(options: {
  environment: WoltEnvironment;
  rawBody: string;
  signature?: string;
  env?: Record<string, string | undefined>;
}): { valid: boolean; signature_valid: boolean | null; order: unknown; errors: string[] } {
  let order: unknown;
  try {
    order = JSON.parse(options.rawBody);
  } catch {
    throw new Error("Order Submitter body is not valid JSON");
  }

  const valid = validate(order);
  let signatureValid: boolean | null = null;
  if (options.signature !== undefined) {
    const name = options.environment === "test" ? "WOLT_WEBHOOK_SECRET_TEST" : "WOLT_WEBHOOK_SECRET_PRODUCTION";
    const secret = (options.env ?? process.env)[name]?.trim();
    if (!secret) throw new Error(`Missing Wolt webhook secret: set ${name}`);
    signatureValid = verifySignature(options.rawBody, options.signature, secret);
    if (!signatureValid) throw new Error("Wolt webhook signature verification failed");
  }

  return { valid, signature_valid: signatureValid, order, errors: valid ? [] : formatErrors(validate.errors) };
}
