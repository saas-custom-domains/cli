import type { Command } from "commander";

import { findUpstream, normalizeHost, resolveAccount, seg, upstreamPath } from "../api/lookups.js";
import type { Account, Message, Upstream } from "../api/types.js";
import { date } from "../output.js";
import type { Runtime } from "../runtime.js";
import { fetchPage, type PagingOptions, pagingNote, positiveInt, withPaging } from "./shared.js";

export function registerAccounts(program: Command, rt: Runtime) {
  const accounts = program.command("accounts").description("List the accounts you can use");

  accounts
    .command("list")
    .description("List your accounts")
    .action(async (_opts, cmd: Command) => {
      const out = rt.out(cmd);
      const data = await rt.api(cmd).get<Account[]>("/accounts");

      if (out.json) out.printJson(data);
      else out.table(["NAME", "UUID", "PERSONAL"], data.map((a) => [a.name, a.uuid, a.personal]));
    });
}

export function registerUpstreams(program: Command, rt: Runtime) {
  const upstreams = program
    .command("upstreams")
    .description("Manage upstreams: the apps your custom domains forward requests to");

  withPaging(upstreams.command("list").description("List an account's upstreams")).action(async (opts: PagingOptions, cmd: Command) => {
    const out = rt.out(cmd);
    const api = rt.api(cmd);
    const account = await resolveAccount(api, rt.globals(cmd).account);
    const page = await fetchPage<Upstream>(api, `/accounts/${seg(account.uuid)}/upstreams`, {}, opts);

    if (out.json) return out.printJson(page);
    out.table(
      ["HOST", "PORT", "TLS", "UUID", "CREATED"],
      page.data.map((u) => [u.host, u.port, u.tls, u.uuid, date(u.created_at)]),
      "No upstreams yet. Create one with `scd upstreams create <your app's host>`.",
    );
    pagingNote(out, page, opts);
  });

  upstreams
    .command("get")
    .description("Show an upstream, including the auth token your app should check")
    .argument("<host>", "Upstream host or UUID, for example app.yourapp.com")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const upstream = await findUpstream(rt.api(cmd), host, rt.globals(cmd).account);

      if (out.json) return out.printJson(upstream);
      printUpstream(rt, cmd, upstream);
    });

  upstreams
    .command("create")
    .description("Create an upstream")
    .argument("<host>", "Host of your app, for example app.yourapp.com")
    .option("--port <port>", "Port your app listens on (default 443)", positiveInt)
    .option("--no-tls", "Connect to your app over plain HTTP (use with --port 80)")
    .option("--bubble", "The upstream is a Bubble.io app")
    .option("--geocoding", "Add X-SaaS-GeoIp-* headers with the visitor's location")
    .option("--no-compression", "Don't compress responses")
    .option("--auth-token <token>", "Secret sent in X-SaaS-Domains-Auth-Token (generated if left out)")
    .addHelpText("after", "\nExamples:\n  scd upstreams create app.yourapp.com\n  scd upstreams create app.yourapp.com --no-tls --port 80")
    .action(async (host: string, opts: Record<string, unknown>, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const account = await resolveAccount(api, rt.globals(cmd).account);

      // Send only what was asked for, so the API's defaults apply to the rest
      const fromCli = (name: string) => cmd.getOptionValueSource(name) === "cli";
      const body: Record<string, unknown> = { host: normalizeHost(host) };
      if (opts.port !== undefined) body.port = opts.port;
      if (fromCli("tls")) body.tls = opts.tls;
      if (opts.bubble) body.bubble_io = true;
      if (opts.geocoding) body.geocoding_enabled = true;
      if (fromCli("compression")) body.compression_enabled = opts.compression;
      if (opts.authToken) body.auth_token = opts.authToken;

      const upstream = await api.post<Upstream>(`/accounts/${seg(account.uuid)}/upstreams`, body);
      if (out.json) return out.printJson(upstream);
      out.print(`Created upstream ${upstream.host}.\n`);
      printUpstream(rt, cmd, upstream);
      out.print(`\nNext: add a customer's domain with \`scd domains add <their domain> --upstream ${upstream.host}\`.`);
    });

  upstreams
    .command("delete")
    .description("Delete an upstream. It must have no custom domains left.")
    .argument("<host>", "Upstream host or UUID")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const upstream = await findUpstream(api, host, rt.globals(cmd).account);
      await rt.confirm(cmd, `Delete upstream ${upstream.host}?`);

      const result = await api.delete<Message>(upstreamPath(upstream));
      if (out.json) out.printJson(result);
      else out.print(`Deleted upstream ${upstream.host}.`);
    });
}

function printUpstream(rt: Runtime, cmd: Command, u: Upstream) {
  rt.out(cmd).fields([
    ["Host", u.host],
    ["UUID", u.uuid],
    ["Account", u.account_uuid],
    ["Port", u.port],
    ["TLS", u.tls],
    ["Bubble.io", u.bubble_io],
    ["Compression", u.compression_enabled],
    ["Geolocation headers", u.geocoding_enabled],
    ["Auth token", u.auth_token],
    ["Created", date(u.created_at)],
  ]);
}
