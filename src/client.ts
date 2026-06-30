import type { AuthKind, HttpMethod, WoltEnvironment } from "./catalog.js";

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BASE_URLS = {
  marketplace: {
    test: "https://pos-integration-service.development.dev.woltapi.com",
    production: "https://pos-integration-service.wolt.com"
  },
  drive: {
    test: "https://daas-public-api.development.dev.woltapi.com",
    production: "https://daas-public-api.wolt.com"
  }
} as const;

const CREDENTIAL_NAMES = {
  marketplace: {
    test: "WOLT_MARKETPLACE_TOKEN_TEST",
    production: "WOLT_MARKETPLACE_TOKEN_PRODUCTION"
  },
  drive: {
    test: "WOLT_DRIVE_KEY_TEST",
    production: "WOLT_DRIVE_KEY_PRODUCTION"
  }
} as const;

export function resolveBaseUrl(auth: AuthKind, environment: WoltEnvironment): string {
  return BASE_URLS[auth][environment];
}

export function resolveCredential(
  auth: AuthKind,
  environment: WoltEnvironment,
  env: Record<string, string | undefined> = process.env
): string {
  const name = CREDENTIAL_NAMES[auth][environment];
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing Wolt credential: set ${name}`);
  return value;
}

function interpolatePath(path: string, pathParams: Record<string, string>): string {
  const interpolated = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = pathParams[name];
    if (value === undefined || value === "") throw new Error(`Missing Wolt path parameter: ${name}`);
    return encodeURIComponent(value);
  });
  if (interpolated.includes("{")) throw new Error("Unresolved Wolt path parameter");
  return interpolated;
}

export type WoltRequest = {
  auth: AuthKind;
  environment: WoltEnvironment;
  method: HttpMethod;
  path: string;
  pathParams: Record<string, string>;
  payload?: unknown;
  confirmProduction: boolean;
  timeoutMs?: number;
};

export type WoltResponse = {
  status: number;
  accepted: boolean;
  data: unknown;
};

export class WoltClient {
  readonly #fetcher: Fetcher;
  readonly #env: Record<string, string | undefined>;

  constructor(options: { fetcher?: Fetcher; env?: Record<string, string | undefined> } = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#env = options.env ?? process.env;
  }

  async request(request: WoltRequest): Promise<WoltResponse> {
    if (request.environment === "production" && request.method !== "GET" && !request.confirmProduction) {
      throw new Error("Production mutations require confirm_production: true");
    }

    const token = resolveCredential(request.auth, request.environment, this.#env);
    const url = resolveBaseUrl(request.auth, request.environment) + interpolatePath(request.path, request.pathParams);
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`
    };
    const init: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000)
    };
    if (request.payload !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(request.payload);
    }

    let response: Response;
    try {
      response = await this.#fetcher(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Wolt request failed before receiving a response: ${message.replaceAll(token, "[REDACTED]")}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = response.status === 204 ? "" : await response.text();
    let data: unknown = null;
    if (text) {
      if (contentType.includes("json")) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } else {
        data = text;
      }
    }

    if (!response.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data);
      throw new Error(`Wolt API returned HTTP ${response.status}: ${detail.replaceAll(token, "[REDACTED]")}`);
    }
    return { status: response.status, accepted: response.status === 202 || response.status === 204, data };
  }
}
