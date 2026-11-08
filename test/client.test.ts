import { describe, expect, it, vi } from "vitest";

import { Api, ApiError, retryAfterSeconds } from "../src/api/client.js";

function api(fetch: typeof globalThis.fetch) {
  return new Api({ baseUrl: "https://api.example.com/api/v1/", token: "tok", userAgent: "saascustomdomains-cli/test", fetch });
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });

describe("Api", () => {
  it("sends the token, user agent, query and JSON body", async () => {
    const fetch = vi.fn(async () => json({ ok: true }));
    await api(fetch).post("/accounts/acc_1/upstreams", { host: "app.yourapp.com" });
    await api(fetch).get("/custom_domains", { host: "a.com", status: undefined, page: 2 });

    const [postUrl, post] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(postUrl.toString()).toBe("https://api.example.com/api/v1/accounts/acc_1/upstreams");
    expect(post.method).toBe("POST");
    expect(post.headers).toMatchObject({ Authorization: "Bearer tok", "User-Agent": "saascustomdomains-cli/test", "Content-Type": "application/json" });
    expect(JSON.parse(post.body as string)).toEqual({ host: "app.yourapp.com" });

    const [getUrl, get] = fetch.mock.calls[1] as unknown as [URL, RequestInit];
    expect(getUrl.toString()).toBe("https://api.example.com/api/v1/custom_domains?host=a.com&page=2");
    expect(get.body).toBeUndefined();
  });

  it("refuses paths that URL parsing would rewrite", async () => {
    const fetch = vi.fn(async () => json({}));
    await expect(api(fetch).delete("/accounts/acc_1/rules/../../me")).rejects.toThrow("Refusing to call an unexpected API path");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps error responses to ApiError with the status and error code", async () => {
    const fetch = vi.fn(async () => json({ error: "Host has already been taken", error_code: "host_taken" }, { status: 400 }));
    const error = await api(fetch).post("/x", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: "Host has already been taken", errorCode: "host_taken", path: "/x" });
  });

  it("handles empty error bodies", async () => {
    const error = await api(vi.fn(async () => new Response("", { status: 401 }))).get("/me").catch((e) => e);
    expect(error).toMatchObject({ status: 401, message: "The API returned HTTP 401." });

    const notFound = await api(vi.fn(async () => new Response("404 page not found", { status: 404 }))).get("/me").catch((e) => e);
    expect(notFound).toMatchObject({ status: 404, message: "Not found: /me" });
  });

  it("reports unreachable APIs with status 0", async () => {
    const error = await api(vi.fn(async () => Promise.reject(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") })))).get("/me").catch((e: ApiError) => e);
    expect(error).toMatchObject({ status: 0 });
    expect((error as ApiError).message).toContain("ECONNREFUSED");
  });

  it("fetches every page until the total count", async () => {
    const pages = [
      { data: [1, 2], pagination: { page: 1, count: 3 } },
      { data: [3], pagination: { page: 2, count: 3 } },
    ];
    const fetch = vi.fn(async (url: URL) => json(pages[Number(url.searchParams.get("page")) - 1]));
    const result = await api(fetch as unknown as typeof globalThis.fetch).all<number>("/custom_domains", { status: "pending_check" });

    expect(result).toEqual({ data: [1, 2, 3], pagination: { page: 1, count: 3 } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[0]![0] as URL).searchParams.get("per_page")).toBe("100");
  });
});

describe("retryAfterSeconds", () => {
  it("prefers Retry-After, then X-RateLimit-Reset, then 60", () => {
    expect(retryAfterSeconds(new Response(null, { headers: { "Retry-After": "12" } }))).toBe(12);
    expect(retryAfterSeconds(new Response(null, { headers: { "X-RateLimit-Reset": "1000030" } }), 1_000_000_000)).toBe(30);
    expect(retryAfterSeconds(new Response(null))).toBe(60);
  });

  it("is set on 429 errors", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "9" } }));
    await expect(api(fetch).get("/me")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 9 });
  });
});
