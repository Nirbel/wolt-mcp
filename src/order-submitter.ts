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
    items: { type: "array", items: { type: "object", additionalProperties: true } },
    created_at: { type: "string" },
    modified_at: { type: ["string", "null"] },
    order_number: { type: "string" },
    order_status: { type: "string" },
    type: { type: "string", enum: ["preorder", "instant"] },
    consumer_comment: { type: ["string", "null"] },
    consumer_name: { type: ["string", "null"] },
    consumer_phone_number: { type: ["string", "null"] },
    attribution_id: { type: ["string", "null"] },
    company_tax_id: { type: ["string", "null"] },
    price: { type: "object", additionalProperties: true },
    delivery: { type: "object", additionalProperties: true },
    pre_order: { type: ["object", "null"], additionalProperties: true }
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
