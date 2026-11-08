import { describe, expect, it, vi } from "vitest";

import { Api } from "../src/api/client.js";
import { findCustomDomain, findRedirect, findUpstream, LookupError, normalizeHost, resolveAccount } from "../src/api/lookups.js";

// An Api whose GET responses come from a map of path (with query) to body
function fakeApi(responses: Record<string, unknown>) {
  const fetch = vi.fn(async (url: URL) => {
    const key = url.pathname.replace("/api/v1", "") + url.search;
    return key in responses ? new Response(JSON.stringify(responses[key])) : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
  return { api: new Api({ baseUrl: "https://x.test/api/v1", token: "t", userAgent: "test", fetch: fetch as unknown as typeof globalThis.fetch }), fetch };
}

const acme = { uuid: "acc_1", name: "Acme", personal: false };
const beta = { uuid: "acc_2", name: "Beta", personal: false };
const page = <T>(data: T[]) => ({ data, pagination: { page: 1, count: data.length } });

describe("resolveAccount", () => {
  it("uses the only account", async () => {
    expect(await resolveAccount(fakeApi({ "/accounts": [acme] }).api)).toEqual(acme);
  });

  it("matches a name case-insensitively", async () => {
    expect(await resolveAccount(fakeApi({ "/accounts": [acme, beta] }).api, "beta")).toEqual(beta);
  });

  it("asks for --account when there are several", async () => {
    await expect(resolveAccount(fakeApi({ "/accounts": [acme, beta] }).api)).rejects.toMatchObject({ kind: "ambiguous", message: expect.stringContaining("--account") });
  });

  it("reports unknown accounts with the ones that exist", async () => {
    const error = await resolveAccount(fakeApi({ "/accounts": [acme] }).api, "Nope").catch((e) => e);
    expect(error).toBeInstanceOf(LookupError);
    expect(error).toMatchObject({ kind: "not_found", message: expect.stringContaining("Acme (acc_1)") });
  });

  it("takes a UUID without a lookup", async () => {
    const { api, fetch } = fakeApi({});
    expect((await resolveAccount(api, "acc_9")).uuid).toBe("acc_9");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("findCustomDomain", () => {
  it("normalizes the host and uses the cross-account list", async () => {
    const domain = { uuid: "domain_1", host: "app.customer.com", account_uuid: "acc_1", upstream_uuid: "upstream_1" };
    const { api } = fakeApi({ "/custom_domains?host=app.customer.com": page([domain]) });
    expect(await findCustomDomain(api, " App.Customer.com. ")).toEqual(domain);
  });

  it("throws not_found", async () => {
    const { api } = fakeApi({ "/custom_domains?host=x.com": page([]) });
    await expect(findCustomDomain(api, "x.com")).rejects.toMatchObject({ kind: "not_found", resource: "custom_domain" });
  });
});

describe("findUpstream", () => {
  it("searches every account by host", async () => {
    const upstream = { uuid: "upstream_2", host: "app.beta.com", account_uuid: "acc_2" };
    const { api } = fakeApi({
      "/accounts": [acme, beta],
      "/accounts/acc_1/upstreams?host=app.beta.com": page([]),
      "/accounts/acc_2/upstreams?host=app.beta.com": page([upstream]),
    });
    expect(await findUpstream(api, "app.beta.com")).toEqual(upstream);
  });

  it("accepts a UUID", async () => {
    const upstream = { uuid: "upstream_1", host: "app.acme.com", account_uuid: "acc_1" };
    const { api } = fakeApi({ "/accounts": [acme], "/accounts/acc_1/upstreams/upstream_1": upstream });
    expect(await findUpstream(api, "upstream_1")).toEqual(upstream);
  });
});

describe("findRedirect", () => {
  it("asks for the UUID when a host has several redirects", async () => {
    const redirects = [
      { uuid: "redirect_1", source_host: "old.com", match_path: "/", destination_url: "https://new.com" },
      { uuid: "redirect_2", source_host: "old.com", match_path: "/blog", destination_url: "https://new.com/blog" },
    ];
    const { api } = fakeApi({ "/accounts": [acme], "/accounts/acc_1/redirects?source_host=old.com&page=1&per_page=100": page(redirects) });
    await expect(findRedirect(api, "old.com")).rejects.toMatchObject({ kind: "ambiguous", message: expect.stringContaining("redirect_2") });
  });
});

describe("normalizeHost", () => {
  it("trims, lowercases and drops a trailing dot", () => {
    expect(normalizeHost(" Shop.Example.COM. ")).toBe("shop.example.com");
  });
});
