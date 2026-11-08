import type { Page } from "./types.js";

export type Query = Record<string, string | number | boolean | undefined>;

export type Fetch = typeof fetch;

// An HTTP error from the API. `status` is 0 when the API couldn't be reached.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly errorCode?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  baseUrl: string;
  token: string;
  userAgent: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

// A thin client for the SaaS Custom Domains REST API. It knows nothing about the CLI, and never logs the token.
export class Api {
  readonly baseUrl: string;
  private readonly basePath: string;
  private readonly fetch: Fetch;

  constructor(private readonly options: ApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.basePath = new URL(this.baseUrl).pathname;
    this.fetch = options.fetch ?? fetch;
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, { body });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body });
  }

  delete<T>(path: string) {
    return this.request<T>("DELETE", path);
  }

  // Fetches every page of a paginated list. The API returns the last page again for a page past the end,
  // so this stops at the total count rather than at an empty page.
  async all<T>(path: string, query: Query = {}): Promise<Page<T>> {
    const data: T[] = [];
    let count = 0;
    for (let page = 1; page <= 1000; page++) {
      const result = await this.get<Page<T>>(path, { ...query, page, per_page: 100 });
      count = result.pagination.count;
      data.push(...result.data);
      if (result.data.length === 0 || data.length >= count) break;
    }
    return { data, pagination: { page: 1, count } };
  }

  async request<T>(method: string, path: string, { query, body }: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    // Only call the path we were given. Refuse paths that URL parsing rewrites, such as `..` segments,
    // which could otherwise turn "delete a rule" into a request for a different resource.
    if (url.pathname !== this.basePath + path) throw new Error(`Refusing to call an unexpected API path: ${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: "application/json",
      "User-Agent": this.options.userAgent,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
      throw new ApiError(`Couldn't reach ${this.baseUrl}: ${reason}`, 0, path);
    }

    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) throw apiError(response, path, parsed);
    return parsed as T;
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiError(response: Response, path: string, body: unknown) {
  const { error, error_code } = (typeof body === "object" && body !== null ? body : {}) as { error?: string; error_code?: string };
  const message = error ?? (response.status === 404 ? `Not found: ${path}` : `The API returned HTTP ${response.status}.`);
  const retryAfter = response.status === 429 ? retryAfterSeconds(response) : undefined;
  return new ApiError(message, response.status, path, error_code, retryAfter);
}

// The API sends X-RateLimit-Reset (epoch seconds) rather than Retry-After, so accept either
export function retryAfterSeconds(response: Response, now = Date.now()) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (retryAfter > 0) return retryAfter;

  const reset = Number(response.headers.get("X-RateLimit-Reset"));
  return reset > 0 ? Math.max(1, reset - Math.floor(now / 1000)) : 60;
}
