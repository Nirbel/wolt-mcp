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
    })).toEqual({ valid: true, signature_valid: true, order, errors: [] });
  });

  it("rejects invalid signatures without exposing the secret", () => {
    expect(() => validateOrderSubmitter({
      environment: "production",
      rawBody: JSON.stringify(order),
      signature: "00".repeat(32),
      env: { WOLT_WEBHOOK_SECRET_PRODUCTION: "do-not-leak" }
    })).toThrowError(/signature/i);
    try {
      validateOrderSubmitter({
        environment: "production",
        rawBody: JSON.stringify(order),
        signature: "00".repeat(32),
        env: { WOLT_WEBHOOK_SECRET_PRODUCTION: "do-not-leak" }
      });
    } catch (error) {
      expect(String(error)).not.toContain("do-not-leak");
    }
  });

  it("reports malformed JSON and missing required order fields", () => {
    expect(() => validateOrderSubmitter({ environment: "test", rawBody: "{" })).toThrow(/JSON/);
    const result = validateOrderSubmitter({ environment: "test", rawBody: JSON.stringify({ id: "only-id" }) });
    expect(result.valid).toBe(false);
    expect(result.signature_valid).toBe(null);
    expect(result.errors.join(" ")).toMatch(/venue|items|created_at/);
  });

  it("exports a JSON schema suitable for the MCP resource", () => {
    expect(ORDER_SUBMITTER_SCHEMA).toMatchObject({ type: "object", additionalProperties: true });
    expect(ORDER_SUBMITTER_SCHEMA.required).toContain("id");
  });
});
