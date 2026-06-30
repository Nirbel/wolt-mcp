import snapshot from "../specs/wolt-official.json" with { type: "json" };

export type WoltEnvironment = "test" | "production";
export type AuthKind = "marketplace" | "drive";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";

type ParameterGroup = {
  type: "path" | "query" | "body" | "header";
  label: string;
  schema: Record<string, unknown>;
  description?: string;
};

type SnapshotOperation = {
  summary: string;
  description?: string;
  method: string;
  path: string;
  parameters?: ParameterGroup[];
  responses?: Record<string, unknown>;
};

type OperationDefinition = {
  name: string;
  domain: "menu" | "venue" | "order" | "timeslot" | "drive";
  specId: string;
  method: HttpMethod;
  path: string;
  auth: AuthKind;
};

const definitions: OperationDefinition[] = [
  { name: "menu_replace", domain: "menu", specId: "create-menu", method: "POST", path: "/v1/restaurants/{venueId}/menu", auth: "marketplace" },
  { name: "menu_get", domain: "menu", specId: "get-menu", method: "GET", path: "/v2/venues/{venueId}/menu", auth: "marketplace" },
  { name: "menu_update_items", domain: "menu", specId: "update-items", method: "PATCH", path: "/venues/{venueId}/items", auth: "marketplace" },
  { name: "menu_update_item_stock", domain: "menu", specId: "update-item-inventory", method: "PATCH", path: "/venues/{venueId}/items/inventory", auth: "marketplace" },
  { name: "menu_update_option_values", domain: "menu", specId: "update-options", method: "PATCH", path: "/venues/{venueId}/options/values", auth: "marketplace" },
  { name: "venue_get_status", domain: "venue", specId: "get-venue-status", method: "GET", path: "/venues/{venueId}/status", auth: "marketplace" },
  { name: "venue_get_settings", domain: "venue", specId: "get-venue-settings", method: "GET", path: "/venues/{venueId}/settings", auth: "marketplace" },
  { name: "venue_get_delivery_provider", domain: "venue", specId: "get-venue-delivery-provider", method: "GET", path: "/venues/{venueId}/delivery-provider", auth: "marketplace" },
  { name: "venue_update_delivery_provider", domain: "venue", specId: "update-venue-delivery-provider", method: "PATCH", path: "/venues/{venueId}/delivery-provider", auth: "marketplace" },
  { name: "venue_set_online_status", domain: "venue", specId: "update-venue-online-status", method: "PATCH", path: "/venues/{venueId}/online", auth: "marketplace" },
  { name: "venue_update_opening_times", domain: "venue", specId: "update-venue-opening-times", method: "PATCH", path: "/venues/{venueId}/opening-times", auth: "marketplace" },
  { name: "venue_set_special_opening_times", domain: "venue", specId: "update-venue-special-opening-times", method: "PUT", path: "/venues/{venueId}/special-opening-times", auth: "marketplace" },
  { name: "order_get", domain: "order", specId: "get-order", method: "GET", path: "/orders/{orderId}", auth: "marketplace" },
  { name: "order_get_v2", domain: "order", specId: "get-order-v2", method: "GET", path: "/v2/orders/{orderId}", auth: "marketplace" },
  { name: "order_accept", domain: "order", specId: "accept-order", method: "PUT", path: "/orders/{orderId}/accept", auth: "marketplace" },
  { name: "order_reject", domain: "order", specId: "reject-order", method: "PUT", path: "/orders/{orderId}/reject", auth: "marketplace" },
  { name: "order_mark_ready", domain: "order", specId: "mark-order-ready", method: "PUT", path: "/orders/{orderId}/ready", auth: "marketplace" },
  { name: "order_mark_delivered", domain: "order", specId: "mark-order-delivered", method: "PUT", path: "/orders/{orderId}/delivered", auth: "marketplace" },
  { name: "order_mark_pickup_completed", domain: "order", specId: "mark-pickup-completed", method: "PUT", path: "/orders/{orderId}/pickup-completed", auth: "marketplace" },
  { name: "order_mark_courier_at_customer", domain: "order", specId: "mark-courier-at-customer", method: "PUT", path: "/orders/{orderId}/courier-at-customer", auth: "marketplace" },
  { name: "order_update_courier_location", domain: "order", specId: "courier-tracking-location-update", method: "PUT", path: "/orders/{orderId}/delivery/tracking/location", auth: "marketplace" },
  { name: "order_update_delivery_eta", domain: "order", specId: "delivery-eta-update", method: "PUT", path: "/orders/{orderId}/delivery/eta", auth: "marketplace" },
  { name: "order_accept_self_delivery", domain: "order", specId: "accept-self-delivery-order", method: "PUT", path: "/orders/{orderId}/self-delivery/accept", auth: "marketplace" },
  { name: "order_confirm_preorder", domain: "order", specId: "confirm-preorder", method: "PUT", path: "/orders/{orderId}/confirm-preorder", auth: "marketplace" },
  { name: "order_replace_items", domain: "order", specId: "replace-order-items", method: "PUT", path: "/orders/{orderId}/replace-items", auth: "marketplace" },
  { name: "order_mark_sent_to_pos", domain: "order", specId: "mark-order-sent-to-pos", method: "PUT", path: "/orders/{orderId}/sent-to-pos", auth: "marketplace" },
  { name: "order_mark_deposits_returned", domain: "order", specId: "mark-deposits-returned", method: "PUT", path: "/orders/{orderId}/deposits-returned", auth: "marketplace" },
  { name: "order_refund_items", domain: "order", specId: "refund-items", method: "POST", path: "/orders/{orderId}/refund-items", auth: "marketplace" },
  { name: "order_refund_basket", domain: "order", specId: "refund-basket", method: "POST", path: "/orders/{orderId}/refund-basket", auth: "marketplace" },
  { name: "order_create_document_upload_link", domain: "order", specId: "create-upload-link", method: "POST", path: "/orders/{orderId}/documents/{documentType}/upload-links", auth: "marketplace" },
  { name: "timeslot_get", domain: "timeslot", specId: "v1-get-time-slot", method: "GET", path: "/v1/venues/{venueId}/time-slots", auth: "marketplace" },
  { name: "timeslot_upsert", domain: "timeslot", specId: "v1-put-time-slots", method: "PUT", path: "/v1/venues/{venueId}/time-slots", auth: "marketplace" },
  { name: "timeslot_update_capacity", domain: "timeslot", specId: "v1-patch-configured-time-slot", method: "PATCH", path: "/v1/venues/{venueId}/time-slots", auth: "marketplace" },
  { name: "drive_create_shipment_promise", domain: "drive", specId: "create-shipment-promise", method: "POST", path: "/v1/venues/{venueId}/shipment-promises", auth: "drive" },
  { name: "drive_create_delivery", domain: "drive", specId: "create-delivery", method: "POST", path: "/v1/venues/{venueId}/deliveries", auth: "drive" },
  { name: "drive_get_available_venues", domain: "drive", specId: "available-venues", method: "POST", path: "/merchants/{merchantId}/available-venues", auth: "drive" },
  { name: "drive_get_delivery_fee", domain: "drive", specId: "create-delivery-fee", method: "POST", path: "/merchants/{merchantId}/delivery-fee", auth: "drive" },
  { name: "drive_create_delivery_order", domain: "drive", specId: "create-delivery-order", method: "POST", path: "/merchants/{merchantId}/delivery-order", auth: "drive" }
];

function getSnapshotOperation(definition: OperationDefinition): SnapshotOperation {
  const source = snapshot.sources[definition.domain as keyof typeof snapshot.sources];
  const operation = source.operations[definition.specId as keyof typeof source.operations] as SnapshotOperation | undefined;
  if (!operation) throw new Error(`Missing Wolt specification operation ${definition.domain}:${definition.specId}`);
  if (operation.method.toUpperCase() !== definition.method || operation.path !== definition.path) {
    throw new Error(`Wolt specification mismatch for ${definition.name}`);
  }
  return operation;
}

export const operationCatalog = definitions.map((definition) => {
  const spec = getSnapshotOperation(definition);
  return Object.freeze({
    ...definition,
    mutation: definition.method !== "GET",
    summary: spec.summary,
    description: spec.description ?? spec.summary,
    parameters: spec.parameters ?? [],
    responses: spec.responses ?? {}
  });
});

export type WoltOperation = (typeof operationCatalog)[number];

export function getOperation(name: string): WoltOperation {
  const operation = operationCatalog.find((candidate) => candidate.name === name);
  if (!operation) throw new Error(`Unknown Wolt operation: ${name}`);
  return operation;
}
