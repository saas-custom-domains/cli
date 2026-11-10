import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Deps } from "../src/runtime.js";

export const TOKEN = "test_token";

export interface Captured {
  stdout: string;
  stderr: string;
}

// Deps for run(), with output captured in memory
export function makeDeps(overrides: Partial<Deps> = {}): Deps & { captured: Captured } {
  const captured: Captured = { stdout: "", stderr: "" };
  return {
    env: {},
    stdout: { write: (text: string) => (captured.stdout += text) },
    stderr: { write: (text: string) => (captured.stderr += text) },
    stdinIsTTY: false,
    readStdin: async () => "",
    prompt: async () => "",
    fetch: globalThis.fetch,
    openBrowser: () => {},
    hostname: () => "test-machine",
    runCommand: async () => 0,
    ...overrides,
    captured,
  };
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingMessage["headers"];
  body: unknown;
}

type Handler = (req: RecordedRequest, params: string[]) => { status?: number; body?: unknown; headers?: Record<string, string> };

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

// A tiny HTTP server: routes are "METHOD /path/:param" patterns
export async function startServer(routes: Record<string, Handler>): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const compiled = Object.entries(routes).map(([pattern, handler]) => {
    const [method, path] = pattern.split(" ") as [string, string];
    const regex = new RegExp(`^${path.replace(/:[a-z_]+/g, "([^/]+)")}$`);
    return { method, regex, handler };
  });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    requests.push(recorded);

    for (const route of compiled) {
      const match = route.method === recorded.method && route.regex.exec(url.pathname);
      if (!match) continue;
      const { status = 200, body, headers = {} } = route.handler(recorded, match.slice(1));
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: `No route for ${recorded.method} ${url.pathname}` }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const page = <T>(data: T[]) => ({ data, pagination: { page: 1, count: data.length } });

// An in-memory slice of the API: one account, one upstream, custom domains and certificates
export async function startFakeApi() {
  const accounts = [{ uuid: "acc_1", name: "Acme", personal: false }];
  const upstreams = [{ uuid: "upstream_1", host: "app.yourapp.com", port: 443, tls: true, auth_token: "secret", account_uuid: "acc_1", created_at: "2026-11-01T00:00:00Z" }];
  const domains: Record<string, unknown>[] = [];
  const certificates: Record<string, unknown>[] = [];
  let nextId = 1;

  const authed = (handler: Handler): Handler => (req, params) =>
    req.headers.authorization === `Bearer ${TOKEN}` ? handler(req, params) : { status: 401 };

  const findDomain = (uuid: string) => domains.find((d) => d.uuid === uuid);

  const server = await startServer({
    "GET /api/v1/me": authed(() => ({ body: { id: 7, name: "Test User", avatar_url: "" } })),
    "GET /api/v1/accounts": authed(() => ({ body: accounts })),
    "GET /api/v1/custom_domains": authed((req) => ({
      body: page(domains.filter((d) => (!req.query.host || d.host === req.query.host) && (!req.query.status || d.status === req.query.status))),
    })),
    "GET /api/v1/accounts/:a/upstreams": authed((req) => ({ body: page(upstreams.filter((u) => !req.query.host || u.host === req.query.host)) })),
    "GET /api/v1/accounts/:a/upstreams/:u": authed((_req, [, u]) => {
      const upstream = upstreams.find((x) => x.uuid === u);
      return upstream ? { body: upstream } : { status: 404, body: { error: "Upstream not found." } };
    }),
    "DELETE /api/v1/accounts/:a/upstreams/:u": authed((_req, [, u]) => {
      const index = upstreams.findIndex((x) => x.uuid === u);
      if (index < 0) return { status: 404 };
      const [removed] = upstreams.splice(index, 1);
      return { body: { message: `Upstream ${removed!.host} deleted.` } };
    }),
    "GET /api/v1/accounts/:a/upstreams/:u/custom_domains": authed((req, [, u]) => {
      const all = domains.filter((d) => d.upstream_uuid === u);
      const perPage = Number(req.query.per_page ?? 25);
      return { body: { data: all.slice(0, perPage), pagination: { page: 1, count: all.length } } };
    }),
    "POST /api/v1/accounts/:a/upstreams/:u/custom_domains": authed((req, [a, u]) => {
      const { host } = req.body as { host: string };
      if (domains.some((d) => d.host === host)) return { status: 400, body: { error: "Host has already been taken", error_code: "host_taken" } };
      const domain = {
        uuid: `domain_${nextId++}`,
        host,
        status: "pending_check",
        challenge_type: "http01",
        acme_challenge_dns_record_status: "valid",
        tls_certificate_issued: false,
        redirect_to_www: false,
        last_dns_check_at: null,
        upstream_uuid: u,
        account_uuid: a,
        upstream_host: "app.yourapp.com",
        created_at: "2026-11-08T00:00:00Z",
      };
      domains.push(domain);
      const { account_uuid, upstream_host, ...created } = domain;
      return { status: 201, body: created };
    }),
    "GET /api/v1/accounts/:a/upstreams/:u/custom_domains/:d/dns_records": authed((_req, [, , d]) => {
      const domain = findDomain(d!);
      return domain ? { body: { data: [{ type: "CNAME", name: domain.host, value: "in.saascustomdomains.com", purpose: "proxy" }] } } : { status: 404 };
    }),
    "POST /api/v1/accounts/:a/upstreams/:u/custom_domains/:d/verify_dns_records": authed((_req, [, , d]) => ({
      body: { host: findDomain(d!)?.host, dns_status: "pending", message: "The DNS records weren't found yet." },
    })),
    "DELETE /api/v1/accounts/:a/upstreams/:u/custom_domains/:d": authed((_req, [, , d]) => {
      const index = domains.findIndex((x) => x.uuid === d);
      if (index < 0) return { status: 404 };
      const [removed] = domains.splice(index, 1);
      return { body: { message: `Custom domain ${removed!.host} deleted.` } };
    }),
    "POST /api/v1/accounts/:a/custom_certificates": authed((req) => {
      const { private_key } = req.body as { certificate: string; private_key: string };
      if (!private_key.includes("PRIVATE KEY")) return { status: 400, body: { error: "Private key is invalid: Could not parse PKey", error_code: "private_key_invalid" } };
      const certificate = {
        uuid: `cert_${nextId++}`,
        subject: "/CN=app.customer.com",
        sans: ["app.customer.com", "www.app.customer.com"],
        issuer: "/C=US/O=DigiCert Inc/CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1",
        expires_at: "2027-03-01T00:00:00Z",
      };
      certificates.push(certificate);
      return { status: 201, body: certificate };
    }),
    "DELETE /api/v1/accounts/:a/custom_certificates/:c": authed((_req, [, c]) => {
      const index = certificates.findIndex((x) => x.uuid === c);
      if (index < 0) return { status: 404, body: { error: `Custom Certificate ${c} not found.`, error_code: "not_found" } };
      certificates.splice(index, 1);
      return { body: { message: `Custom Certificate ${c} deleted.` } };
    }),
    "GET /api/v1/analytics/custom_domains/:d/proxy_summary": authed(() => ({ status: 403, body: { error: "Forbidden" } })),
    "GET /api/v1/rate_limited": authed(() => ({ status: 429, headers: { "Retry-After": "17" } })),
  });

  return { ...server, domains, upstreams, certificates, env: { SCD_API_URL: `${server.url}/api/v1`, SCD_API_TOKEN: TOKEN, XDG_CONFIG_HOME: "/nonexistent-scd-test" } };
}
