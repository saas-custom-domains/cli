import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { Fetch } from "../api/client.js";

// Browser sign-in: OAuth 2.0 authorization code with PKCE and a loopback redirect (RFC 8252).
// The app sends the browser back to http://127.0.0.1:<port>/callback with a one-time code, which we
// exchange, with the PKCE verifier, for an API token named after this machine.

export interface BrowserLoginOptions {
  appUrl: string;
  name: string;
  userAgent: string;
  open?: (url: string) => void;
  log: (message: string) => void;
  fetch?: Fetch;
  timeoutMs?: number;
}

export function base64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

export function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export async function loginWithBrowser(options: BrowserLoginOptions): Promise<string> {
  const { verifier, challenge } = pkcePair();
  const state = base64url(randomBytes(16));
  const fetchFn = options.fetch ?? fetch;

  let settle!: { resolve: (token: string) => void; reject: (error: Error) => void };
  const result = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  let redirectUri = "";
  let handled = false;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    // Only the first callback counts, so a second request can't restart the exchange
    if (handled) {
      page(res, 400, "This sign-in has already been used. Return to your terminal.");
      return;
    }
    handled = true;

    const params = url.searchParams;
    if (params.get("state") !== state) {
      page(res, 400, "Sign-in failed: the request didn't match. Run scd auth login again.");
      settle.reject(new Error("Sign-in failed: the state returned by the browser didn't match. Run `scd auth login` again."));
      return;
    }
    if (params.get("error")) {
      page(res, 400, "Sign-in was cancelled. You can close this tab.");
      settle.reject(new Error(params.get("error") === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${params.get("error")}.`));
      return;
    }

    try {
      const token = await exchangeCode(fetchFn, options, { code: params.get("code") ?? "", verifier, redirectUri });
      page(res, 200, "You're signed in to the SaaS Custom Domains CLI. You can close this tab and return to your terminal.");
      settle.resolve(token);
    } catch (error) {
      page(res, 400, "Sign-in failed. Return to your terminal for details.");
      settle.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorizeUrl = new URL("/cli/authorize", options.appUrl);
  authorizeUrl.search = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  if (options.open) {
    options.log(`Opening your browser to sign in. If it doesn't open, visit:\n\n  ${authorizeUrl}\n`);
    options.open(authorizeUrl.toString());
  } else {
    options.log(`Open this URL in a browser on this computer to sign in:\n\n  ${authorizeUrl}\n`);
  }
  options.log("Waiting for you to sign in...");

  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const timer = setTimeout(() => settle.reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for sign-in. Run \`scd auth login\` again.`)), timeoutMs);

  try {
    return await result;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}

async function exchangeCode(fetchFn: Fetch, options: BrowserLoginOptions, { code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }) {
  if (!code) throw new Error("Sign-in failed: the browser didn't return a code. Run `scd auth login` again.");

  let response: Response;
  try {
    response = await fetchFn(new URL("/cli/token", options.appUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": options.userAgent },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri, name: options.name }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Sign-in failed: couldn't reach ${options.appUrl} (${error instanceof Error ? error.message : error}).`);
  }

  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Sign-in failed${body.error ? ` (${body.error})` : ""}. Run \`scd auth login\` again.`);
  }
  return body.access_token;
}

function page(res: ServerResponse, status: number, message: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SaaS Custom Domains CLI</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 6rem auto; padding: 0 1rem; color: #0f172a; text-align: center">
<h1 style="font-size: 1.25rem">SaaS Custom Domains CLI</h1><p>${message}</p></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html);
}
