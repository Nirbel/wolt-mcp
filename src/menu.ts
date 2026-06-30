import type { Fetcher, WoltClient } from "./client.js";
import type { WoltEnvironment } from "./catalog.js";

type JsonObject = Record<string, unknown>;
export type ItemSelector = Partial<Record<"id" | "external_id" | "gtin" | "sku", string>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLegacyItems(categories: unknown, target: JsonObject[]): void {
  if (!Array.isArray(categories)) return;
  for (const category of categories) {
    if (!isObject(category)) continue;
    if (Array.isArray(category.items)) {
      for (const item of category.items) if (isObject(item)) target.push(item);
    }
    collectLegacyItems(category.subcategories, target);
  }
}

export function listMenuItems(menu: unknown): JsonObject[] {
  if (!isObject(menu)) return [];
  const items: JsonObject[] = [];
  if (Array.isArray(menu.items)) {
    for (const item of menu.items) if (isObject(item)) items.push(item);
  }
  collectLegacyItems(menu.categories, items);
  return [...new Set(items)];
}

function selectorEntry(selector: ItemSelector): [keyof ItemSelector, string] {
  const entries = Object.entries(selector).filter((entry): entry is [keyof ItemSelector, string] =>
    typeof entry[1] === "string" && entry[1].length > 0
  );
  if (entries.length !== 1) throw new Error("Provide exactly one item selector: id, external_id, gtin, or sku");
  return entries[0]!;
}

function itemIdentifier(item: JsonObject, key: keyof ItemSelector): unknown[] {
  const product = isObject(item.product) ? item.product : {};
  switch (key) {
    case "id": return [item.id];
    case "external_id": return [product.external_id, item.external_id, item.external_data];
    case "gtin": return [product.gtin, item.gtin, item.gtin_barcode];
    case "sku": return [product.sku, item.sku, item.merchant_sku];
  }
}

export function findMenuItems(menu: unknown, selector: ItemSelector): JsonObject[] {
  const [key, value] = selectorEntry(selector);
  return listMenuItems(menu).filter((item) => itemIdentifier(item, key).includes(value));
}

export function getQuantityOnStock(menu: unknown, selector: ItemSelector): {
  matches: number;
  items: Array<{
    id: string | null;
    quantity: number | null;
    source_field: "quantity" | "inventory" | null;
    inventory_mode: string | null;
    explanation: string | null;
  }>;
} {
  const matches = findMenuItems(menu, selector);
  return {
    matches: matches.length,
    items: matches.map((item) => {
      const source = typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? "quantity"
        : typeof item.inventory === "number" && Number.isFinite(item.inventory)
          ? "inventory"
          : null;
      return {
        id: typeof item.id === "string" ? item.id : null,
        quantity: source ? item[source] as number : null,
        source_field: source,
        inventory_mode: typeof item.inventory_mode === "string" ? item.inventory_mode : null,
        explanation: source ? null : "Wolt did not expose an item-level stock quantity in the live menu response."
      };
    })
  };
}

function assertAllowedResourceUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Wolt menu response did not include a resource_url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Wolt menu response included an unsafe resource URL");
  }
  const host = url.hostname.toLowerCase();
  const allowed = url.protocol === "https:" && ["wolt.com", "woltapi.com", "amazonaws.com"].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
  if (!allowed || url.username || url.password) throw new Error("Wolt menu response included an unsafe resource URL");
  return url;
}

export class MenuService {
  readonly #client: WoltClient;
  readonly #fetcher: Fetcher;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;

  constructor(options: {
    client: WoltClient;
    fetcher?: Fetcher;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  }) {
    this.#client = options.client;
    this.#fetcher = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#now = options.now ?? Date.now;
  }

  async getMenu(options: { environment: WoltEnvironment; venueId: string; timeoutMs?: number }): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const requested = await this.#client.request({
      auth: "marketplace",
      environment: options.environment,
      method: "GET",
      path: "/v2/venues/{venueId}/menu",
      pathParams: { venueId: options.venueId },
      confirmProduction: false
    });
    if (!isObject(requested.data)) throw new Error("Wolt returned a malformed asynchronous menu response");
    const resourceUrl = assertAllowedResourceUrl(requested.data.resource_url);
    const startedAt = this.#now();

    while (true) {
      const requestRemainingMs = timeoutMs - (this.#now() - startedAt);
      if (requestRemainingMs <= 0) break;
      const response = await this.#fetcher(resourceUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(requestRemainingMs, 15_000))
      });
      if (!response.ok) throw new Error(`Wolt menu resource returned HTTP ${response.status}`);
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new Error("Wolt menu resource returned malformed JSON");
      }
      if (!isObject(result) || typeof result.status !== "string") {
        throw new Error("Wolt menu resource returned a malformed status response");
      }
      if (result.status === "READY") {
        if (!("menu" in result) || result.menu === null) throw new Error("Wolt menu was READY without menu data");
        return result.menu;
      }
      if (result.status === "ERROR") {
        throw new Error(`Wolt menu generation failed: ${typeof result.error === "string" ? result.error : "unknown error"}`);
      }
      if (result.status !== "PENDING") throw new Error(`Unknown Wolt menu status: ${result.status}`);
      const remainingMs = timeoutMs - (this.#now() - startedAt);
      if (remainingMs <= 0) break;
      await this.#sleep(Math.min(500, remainingMs));
    }
    throw new Error(`Wolt menu polling timed out after ${timeoutMs}ms`);
  }
}
