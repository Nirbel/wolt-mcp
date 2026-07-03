import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ORDER_SUBMITTER_SCHEMA, validateOrderSubmitter } from "../src/order-submitter.js";

const order = {
  id: "order-1",
  venue: { id: "venue-1", name: "Cafe" },
  items: [],
  created_at: "2026-06-29T10:00:00Z",
  order_number: "42",
  order_status: "received",
  type: "instant"
};

describe("Order Submitter validation", () => {
  it("validates JSON and a matching WOLT-SIGNATURE", () => {
    const rawBody = JSON.stringify(order);
    const signature = createHmac("sha256", "webhook-secret").update(rawBody).digest("hex");
    expect(validateOrderSubmitter({
      environment: "test",
      rawBody,
      signature,
      env: { WOLT_WEBHOOK_SECRET_TEST: "webhook-secret" }
    })).toEqual({ valid: true, signature_valid: true, order, errors: [], warnings: [] });
  });

  it("returns signature_valid:false for a bad signature without exposing the secret or body", () => {
    const result = validateOrderSubmitter({
      environment: "production",
      rawBody: JSON.stringify(order),
      signature: "00".repeat(32),
      env: { WOLT_WEBHOOK_SECRET_PRODUCTION: "do-not-leak" }
    });
    expect(result).toEqual({
      valid: false,
      signature_valid: false,
      order: null,
      errors: ["WOLT-SIGNATURE verification failed; body not validated"],
      warnings: []
    });
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
  });

  it("throws when a signature is supplied but the webhook secret is missing", () => {
    expect(() => validateOrderSubmitter({
      environment: "production",
      rawBody: JSON.stringify(order),
      signature: "00".repeat(32),
      env: {}
    })).toThrow(/Missing Wolt webhook secret: set WOLT_WEBHOOK_SECRET_PRODUCTION/);
  });

  it("reports malformed JSON and missing required order fields", () => {
    expect(() => validateOrderSubmitter({ environment: "test", rawBody: "{" })).toThrow(/JSON/);
    const result = validateOrderSubmitter({ environment: "test", rawBody: JSON.stringify({ id: "only-id" }) });
    expect(result.valid).toBe(false);
    expect(result.signature_valid).toBe(null);
    expect(result.errors.join(" ")).toMatch(/venue|items|created_at/);
  });

  it("accepts unknown enum values as warnings but still fails genuine type violations", () => {
    const payload = {
      ...order,
      order_status: "invented-status",
      price: { amount: "1000", currency: "EUR" },
      delivery: { status: "teleported", type: "homedelivery", self_delivery: false }
    };
    const result = validateOrderSubmitter({ environment: "test", rawBody: JSON.stringify(payload) });

    // Unknown enum values no longer make the order invalid — only the real type error (price.amount) does.
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/price/);
    expect(result.errors.join(" ")).not.toMatch(/order_status/);
    expect(result.warnings.join(" ")).toMatch(/order_status "invented-status"/);
    expect(result.warnings.join(" ")).toMatch(/delivery\.status "teleported"/);
  });

  it("marks a structurally valid order with an unknown enum as valid plus a warning", () => {
    const payload = { ...order, order_status: "brand_new_status" };
    const result = validateOrderSubmitter({ environment: "test", rawBody: JSON.stringify(payload) });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'Unrecognized order_status "brand_new_status" (known: received, fetched, acknowledged, production, ready, delivered, rejected, other). Accepted for forward-compatibility.'
    ]);
  });

  it("warns on unknown item/preorder enums but fails a real nested type violation", () => {
    const payload = {
      ...order,
      items: [{
        id: "item-1",
        item_type: "invented-item-type",
        total_price: { amount: "1000", currency: "EUR" }
      }],
      pre_order: { preorder_time: "2026-06-30T10:00:00Z", pre_order_status: "later" }
    };
    const result = validateOrderSubmitter({ environment: "test", rawBody: JSON.stringify(payload) });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/items/);
    expect(result.warnings.join(" ")).toMatch(/items\[0\]\.item_type "invented-item-type"/);
    expect(result.warnings.join(" ")).toMatch(/pre_order\.pre_order_status "later"/);
  });

  it("exports a JSON schema suitable for the MCP resource", () => {
    expect(ORDER_SUBMITTER_SCHEMA).toMatchObject({ type: "object", additionalProperties: true });
    expect(ORDER_SUBMITTER_SCHEMA.required).toContain("id");
    // Enums are relaxed to strings for forward-compatibility (drift is surfaced via warnings, not errors).
    expect((ORDER_SUBMITTER_SCHEMA.properties.order_status as Record<string, unknown>).enum).toBeUndefined();
  });
});
