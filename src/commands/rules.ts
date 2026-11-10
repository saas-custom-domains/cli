import type { Command } from "commander";

import { resolveAccount, rulesPath, seg } from "../api/lookups.js";
import type { CustomCertificate, Message, Rule } from "../api/types.js";
import { parseData, readTextFile } from "../data.js";
import { CliError, ExitCode } from "../errors.js";
import { date, type Output } from "../output.js";
import type { Runtime } from "../runtime.js";
import { fetchPage, type PagingOptions, pagingNote, withPaging } from "./shared.js";

interface TargetOptions {
  domain?: string;
  upstream?: string;
}

function withTarget(cmd: Command) {
  return cmd.option("--domain <host>", "Rules of this custom domain").option("--upstream <host>", "Rules of this upstream, which apply to all of its domains");
}

function target(opts: TargetOptions) {
  if (Boolean(opts.domain) === Boolean(opts.upstream)) {
    throw new CliError("Pass either --domain <host> (rules for one custom domain) or --upstream <host> (rules for every domain on an upstream).", ExitCode.Usage);
  }
  return opts;
}

export function registerRules(program: Command, rt: Runtime) {
  const rules = program
    .command("rules")
    .description("Manage rules: redirects, rewrites, headers, rate limits and blocking on a domain or upstream");

  withPaging(withTarget(rules.command("list").description("List rules in the order they run")).option("--active", "Only active rules")).action(
    async (opts: TargetOptions & PagingOptions & { active?: boolean }, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const path = await rulesPath(api, target(opts), rt.globals(cmd).account);
      const page = await fetchPage<Rule>(api, path, { active: opts.active ? "true" : undefined }, opts);

      if (out.json) return out.printJson(page);
      out.table(
        ["POSITION", "NAME", "ACTIVE", "MATCHERS", "HANDLERS", "UUID"],
        page.data.map((r) => [r.position, r.name, r.active, r.matchers.map((m) => m.type), r.handlers.map((h) => h.type), r.uuid]),
        "No rules.",
      );
      pagingNote(out, page, opts);
    },
  );

  withTarget(rules.command("create").description("Create a rule from JSON"))
    .requiredOption("--data <json>", "The rule as JSON, @file.json, or @- for stdin")
    .addHelpText(
      "after",
      `
The JSON has name, matchers and handlers, as in the API docs: https://docs.saascustomdomains.com/rules

Example: allow 10 POST /login requests a minute per IP on every domain of an upstream
  scd rules create --upstream app.yourapp.com --data '{
    "name": "Rate limit login",
    "matchers": [
      {"type": "path", "operator": "is", "value": "/login"},
      {"type": "method", "operator": "is", "value": "POST"}
    ],
    "handlers": [
      {"type": "rate_limit", "limit_value": 10, "window_value": 1, "window_unit": "m", "key_parts": [{"type": "ip"}]}
    ]
  }'`,
    )
    .action(async (opts: TargetOptions & { data: string }, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const body = await parseData(opts.data, rt.deps.readStdin);
      const path = await rulesPath(api, target(opts), rt.globals(cmd).account);
      const rule = await api.post<Rule>(path, body);

      if (out.json) out.printJson(rule);
      else out.print(`Created rule "${rule.name}" (${rule.uuid}) at position ${rule.position}.`);
    });

  withTarget(rules.command("delete").description("Delete a rule").argument("<rule-uuid>", "UUID of the rule, from `scd rules list`")).action(
    async (uuid: string, opts: TargetOptions, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const path = await rulesPath(api, target(opts), rt.globals(cmd).account);
      await rt.confirm(cmd, `Delete rule ${uuid}?`);

      const result = await api.delete<Message>(`${path}/${seg(uuid)}`);
      if (out.json) out.printJson(result);
      else out.print(`Deleted rule ${uuid}.`);
    },
  );
}

export function registerCertificates(program: Command, rt: Runtime) {
  const certificates = program.command("certificates").description("Manage the custom TLS certificates you upload");

  withPaging(certificates.command("list").description("List an account's uploaded certificates")).action(async (opts: PagingOptions, cmd: Command) => {
    const out = rt.out(cmd);
    const api = rt.api(cmd);
    const account = await resolveAccount(api, rt.globals(cmd).account);
    const page = await fetchPage<CustomCertificate>(api, `/accounts/${seg(account.uuid)}/custom_certificates`, {}, opts);

    if (out.json) return out.printJson(page);
    out.table(
      ["SUBJECT", "NAMES", "EXPIRES", "UUID"],
      page.data.map((c) => [c.subject, c.sans, date(c.expires_at), c.uuid]),
      "No uploaded certificates.",
    );
    pagingNote(out, page, opts);
  });

  certificates
    .command("create")
    .description("Upload a certificate and its private key")
    .requiredOption("--cert <file>", "PEM certificate followed by its intermediate certificates, for example fullchain.pem")
    .requiredOption("--key <file>", "PEM private key (RSA or ECDSA), without a passphrase")
    .addHelpText(
      "after",
      `
The proxy serves the certificate for the names it covers. To renew, upload the new
certificate, then delete the old one with \`scd certificates delete <uuid>\`.

Example:
  scd certificates create --cert fullchain.pem --key privkey.pem`,
    )
    .action(async (opts: { cert: string; key: string }, cmd: Command) => {
      const out = rt.out(cmd);
      const body = { certificate: readTextFile(opts.cert), private_key: readTextFile(opts.key) };
      const api = rt.api(cmd);
      const account = await resolveAccount(api, rt.globals(cmd).account);
      const result = await api.post<CustomCertificate>(`/accounts/${seg(account.uuid)}/custom_certificates`, body);

      if (out.json) return out.printJson(result);
      out.print("Uploaded the certificate.\n");
      printCertificate(out, result);
    });

  certificates
    .command("delete")
    .description("Delete an uploaded certificate")
    .argument("<certificate-uuid>", "UUID of the certificate, from `scd certificates list`")
    .action(async (uuid: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const account = await resolveAccount(api, rt.globals(cmd).account);
      await rt.confirm(cmd, `Delete certificate ${uuid}?`);

      const result = await api.delete<Message>(`/accounts/${seg(account.uuid)}/custom_certificates/${seg(uuid)}`);
      if (out.json) out.printJson(result);
      else out.print(`Deleted certificate ${uuid}.`);
    });
}

function printCertificate(out: Output, c: CustomCertificate) {
  out.fields([
    ["Names", c.sans],
    ["Subject", c.subject],
    ["Issuer", c.issuer],
    ["Expires", date(c.expires_at)],
    ["UUID", c.uuid],
  ]);
}
