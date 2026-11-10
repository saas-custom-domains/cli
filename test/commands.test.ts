import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/program.js";
import type { Deps } from "../src/runtime.js";
import { makeDeps, startFakeApi, TOKEN } from "./helpers.js";

let api: Awaited<ReturnType<typeof startFakeApi>>;
beforeEach(async () => {
  api = await startFakeApi();
});
afterEach(() => api.close());

async function scd(argv: string[], overrides: Partial<Deps> = {}) {
  const deps = makeDeps({ env: api.env, ...overrides });
  const code = await run(argv, deps);
  return { code, ...deps.captured };
}

describe("domains", () => {
  it("adds a domain to the account's only upstream and shows its DNS records", async () => {
    const { code, stdout } = await scd(["domains", "add", "App.Customer.com"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Added app.customer.com to upstream app.yourapp.com.");
    expect(stdout).toMatch(/CNAME\s+app\.customer\.com\s+in\.saascustomdomains\.com\s+proxy/);
    const create = api.requests.find((r) => r.method === "POST")!;
    expect(create.path).toBe("/api/v1/accounts/acc_1/upstreams/upstream_1/custom_domains");
    expect(create.body).toEqual({ host: "app.customer.com" });
    expect(create.headers["user-agent"]).toMatch(/^saascustomdomains-cli\/\d+\.\d+\.\d+$/);
  });

  it("prints JSON with the DNS records for agents", async () => {
    const { code, stdout, stderr } = await scd(["domains", "add", "app.customer.com", "--json"]);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    const domain = JSON.parse(stdout);
    expect(domain).toMatchObject({ host: "app.customer.com", status: "pending_check", account_uuid: "acc_1", upstream_host: "app.yourapp.com" });
    expect(domain.dns_records).toEqual([{ type: "CNAME", name: "app.customer.com", value: "in.saascustomdomains.com", purpose: "proxy" }]);
  });

  it("finds domains by host for get, verify, dns-records and list", async () => {
    await scd(["domains", "add", "app.customer.com"]);

    const get = await scd(["domains", "get", "app.customer.com"]);
    expect(get.stdout).toContain("DNS not checked yet");

    const verify = await scd(["domains", "verify", "app.customer.com", "--json"]);
    expect(JSON.parse(verify.stdout)).toMatchObject({ host: "app.customer.com", dns_status: "pending" });

    const records = await scd(["domains", "dns-records", "app.customer.com", "--json"]);
    expect(JSON.parse(records.stdout).data).toHaveLength(1);

    const list = await scd(["domains", "list", "--status", "pending_check"]);
    expect(list.stdout).toMatch(/app\.customer\.com\s+pending_check\s+not yet\s+app\.yourapp\.com/);
  });

  it("requires --yes to delete without a terminal, and deletes with it", async () => {
    await scd(["domains", "add", "app.customer.com"]);

    const refused = await scd(["domains", "delete", "app.customer.com"]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("Pass --yes");
    expect(api.domains).toHaveLength(1);

    const deleted = await scd(["domains", "delete", "app.customer.com", "--yes"]);
    expect(deleted.code).toBe(0);
    expect(api.domains).toHaveLength(0);
  });

  it("asks in a terminal and stops unless the answer is yes", async () => {
    await scd(["domains", "add", "app.customer.com"]);
    const questions: string[] = [];
    const prompt = async (q: string) => {
      questions.push(q);
      return "n";
    };

    const result = await scd(["domains", "delete", "app.customer.com"], { stdinIsTTY: true, prompt });
    expect(questions[0]).toContain("Delete custom domain app.customer.com?");
    expect(result.code).toBe(1);
    expect(api.domains).toHaveLength(1);

    const noInput = await scd(["domains", "delete", "app.customer.com", "--no-input"], { stdinIsTTY: true, prompt });
    expect(noInput.code).toBe(2);
    expect(questions).toHaveLength(1);
  });

  it("won't delete an upstream that still has custom domains", async () => {
    await scd(["domains", "add", "app.customer.com"]);

    const refused = await scd(["upstreams", "delete", "app.yourapp.com", "--yes"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("app.yourapp.com still has 1 custom domain(s)");
    expect(api.upstreams).toHaveLength(1);
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    await scd(["domains", "delete", "app.customer.com", "--yes"]);
    const deleted = await scd(["upstreams", "delete", "app.yourapp.com", "--yes"]);
    expect(deleted.code).toBe(0);
    expect(api.upstreams).toHaveLength(0);
  });

  it("exits 5 with a hint when the domain doesn't exist", async () => {
    const human = await scd(["domains", "get", "nope.com"]);
    expect(human.code).toBe(5);
    expect(human.stderr).toBe("Error: No custom domain nope.com in your accounts. Run `scd domains list` to see them.\n");

    const json = await scd(["domains", "get", "nope.com", "--json"]);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({ error: { status: null, message: expect.stringContaining("nope.com") } });
  });

  it("reports API validation errors with their code", async () => {
    await scd(["domains", "add", "app.customer.com"]);
    const again = await scd(["domains", "add", "app.customer.com", "--json"]);

    expect(again.code).toBe(1);
    expect(JSON.parse(again.stderr)).toEqual({ error: { status: 400, message: "Host has already been taken (host_taken)" } });
  });
});

describe("certificates", () => {
  const CERT = "-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nintermediate\n-----END CERTIFICATE-----\n";
  const KEY = "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n";

  function pemFiles(key = KEY) {
    const dir = mkdtempSync(join(tmpdir(), "scd-"));
    writeFileSync(join(dir, "fullchain.pem"), CERT);
    writeFileSync(join(dir, "privkey.pem"), key);
    return { cert: join(dir, "fullchain.pem"), key: join(dir, "privkey.pem") };
  }

  it("uploads a certificate and its private key from files", async () => {
    const files = pemFiles();
    const { code, stdout, stderr } = await scd(["certificates", "create", "--cert", files.cert, "--key", files.key]);

    expect(code).toBe(0);
    expect(stdout).toContain("Uploaded the certificate.");
    expect(stdout).toMatch(/Names:\s+app\.customer\.com, www\.app\.customer\.com/);
    expect(stdout).toMatch(/UUID:\s+cert_1/);
    expect(stdout + stderr).not.toContain("secret");
    const create = api.requests.find((r) => r.method === "POST")!;
    expect(create.path).toBe("/api/v1/accounts/acc_1/custom_certificates");
    expect(create.body).toEqual({ certificate: CERT, private_key: KEY });
  });

  it("exits 2 without calling the API when a file can't be read", async () => {
    const files = pemFiles();
    const result = await scd(["certificates", "create", "--cert", files.cert, "--key", "/nonexistent/privkey.pem"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Couldn't read /nonexistent/privkey.pem");
    expect(api.requests).toHaveLength(0);
  });

  it("reports why the API rejected the certificate", async () => {
    const files = pemFiles("not a key");
    const result = await scd(["certificates", "create", "--cert", files.cert, "--key", files.key, "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ error: { status: 400, message: "Private key is invalid: Could not parse PKey (private_key_invalid)" } });
  });

  it("deletes a certificate with --yes", async () => {
    const files = pemFiles();
    await scd(["certificates", "create", "--cert", files.cert, "--key", files.key]);

    const deleted = await scd(["certificates", "delete", "cert_1", "--yes"]);
    expect(deleted.code).toBe(0);
    expect(deleted.stdout).toContain("Deleted certificate cert_1.");
    expect(api.certificates).toHaveLength(0);
  });
});

describe("auth", () => {
  it("exits 4 when the token is wrong or missing", async () => {
    const wrong = await scd(["domains", "list"], { env: { ...api.env, SCD_API_TOKEN: "wrong" } });
    expect(wrong.code).toBe(4);
    expect(wrong.stderr).toContain("scd auth login");

    const { SCD_API_TOKEN: _, ...withoutToken } = api.env;
    const missing = await scd(["domains", "list"], { env: withoutToken });
    expect(missing.code).toBe(4);
    expect(missing.stderr).toContain("not signed in");
  });

  it("saves a token from stdin after checking it, and shows where it comes from", async () => {
    const { SCD_API_TOKEN: _, ...env } = api.env;
    const configHome = mkdtempSync(join(tmpdir(), "scd-"));
    const withConfig = { ...env, XDG_CONFIG_HOME: configHome };

    const login = await scd(["auth", "login", "--with-token"], { env: withConfig, readStdin: async () => `${TOKEN}\n` });
    expect(login.code).toBe(0);
    expect(login.stdout).toContain("Signed in as Test User (user 7)");
    expect(JSON.parse(readFileSync(join(configHome, "saascustomdomains", "config.json"), "utf8"))).toEqual({ token: TOKEN });

    const status = await scd(["auth", "status", "--json"], { env: withConfig });
    expect(JSON.parse(status.stdout)).toMatchObject({ user: { id: 7, name: "Test User" }, token_source: "config" });

    const logout = await scd(["auth", "logout"], { env: withConfig });
    expect(logout.stdout).toContain("Removed the saved token");
    const after = await scd(["auth", "status"], { env: withConfig });
    expect(after.code).toBe(4);
  });

  it("refuses an invalid token without saving it", async () => {
    const configHome = mkdtempSync(join(tmpdir(), "scd-"));
    const result = await scd(["auth", "login", "--with-token"], { env: { ...api.env, XDG_CONFIG_HOME: configHome }, readStdin: async () => "wrong" });

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("isn't valid");
  });
});

describe("other commands", () => {
  it("explains a missing analytics add-on", async () => {
    await scd(["domains", "add", "app.customer.com"]);
    const result = await scd(["analytics", "app.customer.com"]);

    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Domain Analytics add-on");
  });

  it("calls any endpoint with `scd api`", async () => {
    const result = await scd(["api", "get", "/api/v1/accounts/acc_1/upstreams?host=app.yourapp.com"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data[0].uuid).toBe("upstream_1");
    expect(api.requests.at(-1)!.query).toEqual({ host: "app.yourapp.com" });
  });

  it("exits 6 with the retry time when rate limited", async () => {
    const result = await scd(["api", "GET", "/rate_limited"]);

    expect(result.code).toBe(6);
    expect(result.stderr).toContain("Retry in 17 seconds");
  });

  it("runs npx skills add for skills install", async () => {
    const calls: [string, string[]][] = [];
    const result = await scd(["skills", "install", "--global", "--agent", "claude-code"], {
      runCommand: async (command, args) => {
        calls.push([command, args]);
        return 0;
      },
    });

    expect(result.code).toBe(0);
    expect(calls).toEqual([["npx", ["--yes", "skills", "add", "https://github.com/saas-custom-domains/skills", "--global", "--agent", "claude-code"]]]);
  });

  it("describes every command as JSON", async () => {
    const result = await scd(["commands", "--json"]);
    const tree = JSON.parse(result.stdout);
    const domains = tree.commands.find((c: { name: string }) => c.name === "domains");

    expect(domains.commands.map((c: { name: string }) => c.name)).toEqual(["list", "get", "add", "delete", "verify", "dns-records", "purge-cache"]);
    expect(domains.commands.find((c: { name: string }) => c.name === "add").arguments[0]).toMatchObject({ name: "host", required: true });
  });

  it("exits 2 on usage errors and 0 on --help", async () => {
    expect((await scd(["domains", "lst"])).code).toBe(2);
    expect((await scd(["domains", "add"])).code).toBe(2);
    expect((await scd(["rules", "list"])).code).toBe(2);
    expect((await scd(["--help"])).code).toBe(0);
    expect((await scd([])).code).toBe(0);
  });
});
