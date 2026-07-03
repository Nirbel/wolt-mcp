import { describe, expect, it } from "vitest";

import { assertSupportedParameters, operationCatalog } from "../src/catalog.js";

const expected = [
  ["menu_replace", "POST", "/v1/restaurants/{venueId}/menu", "marketplace"],
  ["menu_get", "GET", "/v2/venues/{venueId}/menu", "marketplace"],
  ["menu_update_items", "PATCH", "/venues/{venueId}/items", "marketplace"],
  ["menu_update_item_stock", "PATCH", "/venues/{venueId}/items/inventory", "marketplace"],
  ["menu_update_option_values", "PATCH", "/venues/{venueId}/options/values", "marketplace"],
  ["venue_get_status", "GET", "/venues/{venueId}/status", "marketplace"],
  ["venue_get_settings", "GET", "/venues/{venueId}/settings", "marketplace"],
  ["venue_get_delivery_provider", "GET", "/venues/{venueId}/delivery-provider", "marketplace"],
  ["venue_update_delivery_provider", "PATCH", "/venues/{venueId}/delivery-provider", "marketplace"],
  ["venue_set_online_status", "PATCH", "/venues/{venueId}/online", "marketplace"],
  ["venue_update_opening_times", "PATCH", "/venues/{venueId}/opening-times", "marketplace"],
  ["venue_set_special_opening_times", "PUT", "/venues/{venueId}/special-opening-times", "marketplace"],
  ["order_get", "GET", "/orders/{orderId}", "marketplace"],
  ["order_get_v2", "GET", "/v2/orders/{orderId}", "marketplace"],
  ["order_accept", "PUT", "/orders/{orderId}/accept", "marketplace"],
  ["order_reject", "PUT", "/orders/{orderId}/reject", "marketplace"],
  ["order_mark_ready", "PUT", "/orders/{orderId}/ready", "marketplace"],
  ["order_mark_delivered", "PUT", "/orders/{orderId}/delivered", "marketplace"],
  ["order_mark_pickup_completed", "PUT", "/orders/{orderId}/pickup-completed", "marketplace"],
  ["order_mark_courier_at_customer", "PUT", "/orders/{orderId}/courier-at-customer", "marketplace"],
  ["order_update_courier_location", "PUT", "/orders/{orderId}/delivery/tracking/location", "marketplace"],
  ["order_update_delivery_eta", "PUT", "/orders/{orderId}/delivery/eta", "marketplace"],
  ["order_accept_self_delivery", "PUT", "/orders/{orderId}/self-delivery/accept", "marketplace"],
  ["order_confirm_preorder", "PUT", "/orders/{orderId}/confirm-preorder", "marketplace"],
  ["order_replace_items", "PUT", "/orders/{orderId}/replace-items", "marketplace"],
  ["order_mark_sent_to_pos", "PUT", "/orders/{orderId}/sent-to-pos", "marketplace"],
  ["order_mark_deposits_returned", "PUT", "/orders/{orderId}/deposits-returned", "marketplace"],
  ["order_refund_items", "POST", "/orders/{orderId}/refund-items", "marketplace"],
  ["order_refund_basket", "POST", "/orders/{orderId}/refund-basket", "marketplace"],
  ["order_create_document_upload_link", "POST", "/orders/{orderId}/documents/{documentType}/upload-links", "marketplace"],
  ["timeslot_get", "GET", "/v1/venues/{venueId}/time-slots", "marketplace"],
  ["timeslot_upsert", "PUT", "/v1/venues/{venueId}/time-slots", "marketplace"],
  ["timeslot_update_capacity", "PATCH", "/v1/venues/{venueId}/time-slots", "marketplace"],
  ["drive_create_shipment_promise", "POST", "/v1/venues/{venueId}/shipment-promises", "drive"],
  ["drive_create_delivery", "POST", "/v1/venues/{venueId}/deliveries", "drive"],
  ["drive_get_available_venues", "POST", "/merchants/{merchantId}/available-venues", "drive"],
  ["drive_get_delivery_fee", "POST", "/merchants/{merchantId}/delivery-fee", "drive"],
  ["drive_create_delivery_order", "POST", "/merchants/{merchantId}/delivery-order", "drive"]
] as const;

describe("operation catalog", () => {
  it("contains every documented callable Wolt operation exactly once", () => {
    expect(operationCatalog).toHaveLength(38);
    expect(new Set(operationCatalog.map((operation) => operation.name)).size).toBe(38);
    expect(operationCatalog.map(({ name, method, path, auth }) => [name, method, path, auth])).toEqual(expected);
  });

  it("marks every non-GET operation as a mutation", () => {
    for (const operation of operationCatalog) {
      expect(operation.mutation).toBe(operation.method !== "GET");
    }
  });

  it("fails loudly if a spec operation declares unsupported query/header parameters", () => {
    expect(() => assertSupportedParameters("demo", [{ type: "query", label: "q", schema: {} }])).toThrow(/unsupported query/);
    expect(() => assertSupportedParameters("demo", [{ type: "header", label: "h", schema: {} }])).toThrow(/unsupported header/);
    expect(() => assertSupportedParameters("demo", [
      { type: "path", label: "p", schema: {} },
      { type: "body", label: "b", schema: {} }
    ])).not.toThrow();
  });
});
