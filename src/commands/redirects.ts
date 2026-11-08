import { type Command, Option } from "commander";

import { findRedirect, normalizeHost, resolveAccount, seg } from "../api/lookups.js";
import type { Message, Redirect } from "../api/types.js";
import { CliError, ExitCode } from "../errors.js";
import type { Output } from "../output.js";
import type { Runtime } from "../runtime.js";
import { fetchPage, type PagingOptions, pagingNote, withPaging } from "./shared.js";

interface RedirectOptions {
  sourceHost?: string;
  destination?: string;
  path?: string;
  type?: string;
  preservePath?: boolean;
  preserveQuery?: boolean;
  active?: boolean;
}

// Shared by create and update. Each pair of flags is three-state: on, off, or left to the API.
function withRedirectOptions(cmd: Command) {
  return cmd
    .option("--path <path>", "Path to match, for example /blog or /docs/* (default /)")
    .addOption(new Option("--type <type>", "permanent (301) or found (302)").choices(["permanent", "found"]))
    .option("--preserve-path", "Append the request path to the destination")
    .option("--no-preserve-path", "Don't append the request path")
    .option("--preserve-query", "Append the query string to the destination")
    .option("--no-preserve-query", "Don't append the query string")
    .option("--active", "Redirect traffic")
    .option("--no-active", "Save the redirect without redirecting traffic yet");
}

function redirectBody(opts: RedirectOptions) {
  const body: Record<string, unknown> = {};
  if (opts.sourceHost !== undefined) body.source_host = normalizeHost(opts.sourceHost);
  if (opts.destination !== undefined) body.destination_url = opts.destination;
  if (opts.path !== undefined) body.match_path = opts.path;
  if (opts.type !== undefined) body.redirect_type = opts.type;
  if (opts.preservePath !== undefined) body.preserve_path = opts.preservePath;
  if (opts.preserveQuery !== undefined) body.preserve_query_string = opts.preserveQuery;
  if (opts.active !== undefined) body.active = opts.active;
  return body;
}

export function registerRedirects(program: Command, rt: Runtime) {
  const redirects = program.command("redirects").description("Manage domain redirects, for example old-brand.com → newbrand.com");

  withPaging(redirects.command("list").description("List an account's redirects").option("--source-host <host>", "Only redirects from this host")).action(
    async (opts: PagingOptions & { sourceHost?: string }, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const account = await resolveAccount(api, rt.globals(cmd).account);
      const query = { source_host: opts.sourceHost && normalizeHost(opts.sourceHost) };
      const page = await fetchPage<Redirect>(api, `/accounts/${seg(account.uuid)}/redirects`, query, opts);

      if (out.json) return out.printJson(page);
      out.table(
        ["SOURCE", "PATH", "DESTINATION", "TYPE", "ACTIVE", "UUID"],
        page.data.map((r) => [r.source_host, r.match_path, r.destination_url, r.redirect_type, r.active, r.uuid]),
        "No redirects found.",
      );
      pagingNote(out, page, opts);
    },
  );

  redirects
    .command("get")
    .description("Show a redirect")
    .argument("<redirect>", "Redirect UUID, or its source host")
    .action(async (redirect: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const result = await findRedirect(rt.api(cmd), redirect, rt.globals(cmd).account);
      if (out.json) out.printJson(result);
      else printRedirect(out, result);
    });

  withRedirectOptions(
    redirects
      .command("create")
      .description("Create a redirect")
      .argument("<source-host>", "Host the requests arrive on, for example old-brand.com")
      .argument("<destination-url>", "URL to redirect to, for example https://newbrand.com"),
  )
    .addHelpText("after", "\nExamples:\n  scd redirects create old-brand.com https://newbrand.com --preserve-path")
    .action(async (sourceHost: string, destination: string, opts: RedirectOptions, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const account = await resolveAccount(api, rt.globals(cmd).account);
      const result = await api.post<Redirect>(`/accounts/${seg(account.uuid)}/redirects`, redirectBody({ ...opts, sourceHost, destination }));

      if (out.json) return out.printJson(result);
      out.print("Created the redirect.\n");
      printRedirect(out, result);
    });

  withRedirectOptions(
    redirects
      .command("update")
      .description("Change a redirect")
      .argument("<redirect>", "Redirect UUID, or its source host")
      .option("--source-host <host>", "New source host")
      .option("--destination <url>", "New destination URL"),
  ).action(async (redirect: string, opts: RedirectOptions, cmd: Command) => {
    const out = rt.out(cmd);
    const api = rt.api(cmd);
    const body = redirectBody(opts);
    if (Object.keys(body).length === 0) throw new CliError("Nothing to change. Pass at least one option, for example --destination.", ExitCode.Usage);

    const existing = await findRedirect(api, redirect, rt.globals(cmd).account);
    const result = await api.put<Redirect>(`/accounts/${seg(existing.account_uuid)}/redirects/${seg(existing.uuid)}`, body);

    if (out.json) return out.printJson(result);
    out.print("Updated the redirect.\n");
    printRedirect(out, result);
  });

  redirects
    .command("delete")
    .description("Delete a redirect")
    .argument("<redirect>", "Redirect UUID, or its source host")
    .action(async (redirect: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const existing = await findRedirect(api, redirect, rt.globals(cmd).account);
      await rt.confirm(cmd, `Delete the redirect from ${existing.source_host}${existing.match_path} to ${existing.destination_url}?`);

      const result = await api.delete<Message>(`/accounts/${seg(existing.account_uuid)}/redirects/${seg(existing.uuid)}`);
      if (out.json) out.printJson(result);
      else out.print("Deleted the redirect.");
    });
}

function printRedirect(out: Output, r: Redirect) {
  out.fields([
    ["Source", `${r.source_host}${r.match_path}`],
    ["Destination", r.destination_url],
    ["Type", r.redirect_type === "permanent" ? "permanent (301)" : "found (302)"],
    ["Preserve path", r.preserve_path],
    ["Preserve query string", r.preserve_query_string],
    ["Active", r.active],
    ["UUID", r.uuid],
  ]);
}
