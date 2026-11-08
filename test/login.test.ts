import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { loginWithBrowser } from "../src/auth/login.js";
import { type FakeServer, startServer } from "./helpers.js";

let app: FakeServer | undefined;
afterEach(() => app?.close());

// A stand-in for the app's token endpoint that checks PKCE like the real one
async function startApp() {
  app = await startServer({
    "POST /cli/token": (req) => {
      const body = req.body as Record<string, string>;
      return body.code === "good-code" ? { body: { access_token: "new-api-token", token_type: "bearer" } } : { status: 400, body: { error: "invalid_grant" } };
    },
  });
  return app;
}

// Plays the browser: reads the authorize URL, then calls the loopback redirect like the app would
function browser(respond: (authorize: URL) => Record<string, string>) {
  const visited: URL[] = [];
  const open = (url: string) => {
    const authorize = new URL(url);
    visited.push(authorize);
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    for (const [key, value] of Object.entries(respond(authorize))) callback.searchParams.set(key, value);
    setTimeout(() => void fetch(callback).catch(() => {}), 5);
  };
  return { open, visited };
}

const base = { name: "test-machine", userAgent: "saascustomdomains-cli/test", log: () => {} };

describe("loginWithBrowser", () => {
  it("runs the PKCE flow and returns the API token", async () => {
    const server = await startApp();
    const { open, visited } = browser((authorize) => ({ code: "good-code", state: authorize.searchParams.get("state")! }));

    const token = await loginWithBrowser({ ...base, appUrl: server.url, open });

    expect(token).toBe("new-api-token");
    const authorize = visited[0]!;
    expect(authorize.pathname).toBe("/cli/authorize");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const exchange = server.requests.find((r) => r.path === "/cli/token")!;
    const body = exchange.body as Record<string, string>;
    expect(body.redirect_uri).toBe(authorize.searchParams.get("redirect_uri"));
    expect(body.name).toBe("test-machine");
    const challenge = createHash("sha256").update(body.code_verifier!).digest("base64url");
    expect(challenge).toBe(authorize.searchParams.get("code_challenge"));
  });

  it("rejects a callback with the wrong state and never exchanges the code", async () => {
    const server = await startApp();
    const { open } = browser(() => ({ code: "good-code", state: "forged" }));

    await expect(loginWithBrowser({ ...base, appUrl: server.url, open })).rejects.toThrow("state");
    expect(server.requests.some((r) => r.path === "/cli/token")).toBe(false);
  });

  it("reports a cancelled sign-in", async () => {
    const server = await startApp();
    const { open } = browser((authorize) => ({ error: "access_denied", state: authorize.searchParams.get("state")! }));

    await expect(loginWithBrowser({ ...base, appUrl: server.url, open })).rejects.toThrow("cancelled");
  });

  it("fails when the app rejects the code", async () => {
    const server = await startApp();
    const { open } = browser((authorize) => ({ code: "bad-code", state: authorize.searchParams.get("state")! }));

    await expect(loginWithBrowser({ ...base, appUrl: server.url, open })).rejects.toThrow("invalid_grant");
  });

  it("times out, and prints the URL when it doesn't open a browser", async () => {
    const server = await startApp();
    const logs: string[] = [];

    await expect(loginWithBrowser({ ...base, appUrl: server.url, log: (m) => logs.push(m), timeoutMs: 50 })).rejects.toThrow("Timed out");
    expect(logs.join("\n")).toContain(`${server.url}/cli/authorize?redirect_uri=`);
  });
});
