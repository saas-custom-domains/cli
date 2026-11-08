import { type Command, Option } from "commander";

import type { Api } from "../api/client.js";
import { customDomainPath, findCustomDomain, findUpstream, normalizeHost, resolveAccount, seg, upstreamPath } from "../api/lookups.js";
import type { AccountCustomDomain, CustomDomain, DnsRecord, DnsVerificationResult, Message, Page, Upstream } from "../api/types.js";
import { CliError, ExitCode } from "../errors.js";
import { date, type Output } from "../output.js";
import type { Runtime } from "../runtime.js";
import { fetchPage, type PagingOptions, pagingNote, withPaging } from "./shared.js";

const STATUSES = ["pending_check", "dns_records_found", "dns_records_not_found", "dns_check_unnecessary"];

type DomainWithRecords = AccountCustomDomain & { dns_records?: DnsRecord[] };

export function registerDomains(program: Command, rt: Runtime) {
  const domains = program
    .command("domains")
    .alias("custom-domains")
    .description("Manage your customers' custom domains");

  withPaging(
    domains
      .command("list")
      .description("List custom domains across your accounts")
      .option("--upstream <host>", "Only domains on this upstream")
      .addOption(new Option("--status <status>", "Only domains with this DNS status").choices(STATUSES)),
  )
    .addHelpText("after", "\nExamples:\n  scd domains list\n  scd domains list --status dns_records_not_found --all")
    .action(async (opts: PagingOptions & { upstream?: string; status?: string }, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const account = rt.globals(cmd).account;

      const query: Record<string, string | undefined> = { status: opts.status };
      if (opts.upstream) query.upstream_uuid = (await findUpstream(api, opts.upstream, account)).uuid;
      else if (account) query.account_uuid = (await resolveAccount(api, account)).uuid;

      const page = await fetchPage<AccountCustomDomain>(api, "/custom_domains", query, opts);
      if (out.json) return out.printJson(page);
      out.table(
        ["HOST", "STATUS", "CERTIFICATE", "UPSTREAM", "CREATED"],
        page.data.map((d) => [d.host, d.status, d.tls_certificate_issued ? "issued" : "not yet", d.upstream_host, date(d.created_at)]),
        "No custom domains found.",
      );
      pagingNote(out, page, opts);
    });

  domains
    .command("get")
    .description("Show a custom domain's DNS and certificate status, and the DNS records it needs")
    .argument("<host>", "The custom domain, for example app.customer.com")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      const result: DomainWithRecords = { ...domain, dns_records: await dnsRecords(api, customDomainPath(domain), out) };

      if (out.json) return out.printJson(result);
      printDomain(out, result);
    });

  domains
    .command("add")
    .description("Add a customer's domain and show the DNS records they need to add")
    .argument("<host>", "The customer's domain, for example app.customer.com or *.customer.com")
    .option("--upstream <host>", "Upstream to forward to (needed if the account has more than one)")
    .option("--redirect-to-www", "Also serve www.<domain> and redirect the root domain to it (root domains only)")
    .addOption(new Option("--challenge-type <type>", "How the certificate is validated; wildcards need dns01").choices(["http01", "dns01"]))
    .option("--instructions-recipient <email>", "Email the DNS setup instructions to this address")
    .option("--prepend-path <path>", "Path prefix added to every forwarded request, for example sites/acme")
    .addHelpText(
      "after",
      "\nExamples:\n  scd domains add app.customer.com\n  scd domains add customer.com --redirect-to-www --upstream app.yourapp.com\n  scd domains add '*.customer.com' --challenge-type dns01",
    )
    .action(
      async (
        host: string,
        opts: { upstream?: string; redirectToWww?: boolean; challengeType?: string; instructionsRecipient?: string; prependPath?: string },
        cmd: Command,
      ) => {
        const out = rt.out(cmd);
        const api = rt.api(cmd);
        const account = rt.globals(cmd).account;
        const upstream = opts.upstream ? await findUpstream(api, opts.upstream, account) : await onlyUpstream(api, account);

        const body: Record<string, unknown> = { host: normalizeHost(host) };
        if (opts.redirectToWww) body.redirect_to_www = true;
        if (opts.challengeType) body.challenge_type = opts.challengeType;
        if (opts.instructionsRecipient) body.instructions_recipient = opts.instructionsRecipient;
        if (opts.prependPath) body.prepend_path = opts.prependPath;

        const created = await api.post<CustomDomain>(`${upstreamPath(upstream)}/custom_domains`, body);
        const domain: AccountCustomDomain = { ...created, account_uuid: upstream.account_uuid, upstream_host: upstream.host };
        const result: DomainWithRecords = { ...domain, dns_records: await dnsRecords(api, customDomainPath(domain), out) };

        if (out.json) return out.printJson(result);
        out.print(`Added ${result.host} to upstream ${upstream.host}.`);
        if (result.dns_records?.length) {
          out.print("\nAsk your customer to add these DNS records:\n");
          printRecords(out, result.dns_records);
        }
        out.print(`\nCheck progress with \`scd domains get ${result.host}\`.`);
      },
    );

  domains
    .command("delete")
    .description("Delete a custom domain")
    .argument("<host>", "The custom domain")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      await rt.confirm(cmd, `Delete custom domain ${domain.host}?`);

      const result = await api.delete<Message>(customDomainPath(domain));
      if (out.json) out.printJson(result);
      else out.print(`Deleted ${domain.host}.`);
    });

  domains
    .command("verify")
    .description("Check a custom domain's DNS records now (limited to 5 checks a minute)")
    .argument("<host>", "The custom domain")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      const result = await api.post<DnsVerificationResult>(`${customDomainPath(domain)}/verify_dns_records`);

      if (out.json) out.printJson(result);
      else out.print(`${result.host}: ${result.dns_status}. ${result.message}`);
    });

  domains
    .command("dns-records")
    .description("Show the DNS records a custom domain needs")
    .argument("<host>", "The custom domain")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      const result = await api.get<{ data: DnsRecord[] }>(`${customDomainPath(domain)}/dns_records`);

      if (out.json) out.printJson(result);
      else printRecords(out, result.data);
    });

  domains
    .command("purge-cache")
    .description("Purge a custom domain's HTTP cache")
    .argument("<host>", "The custom domain")
    .action(async (host: string, _opts, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      const result = await api.post<Message>(`${customDomainPath(domain)}/purge_http_cache`);

      if (out.json) out.printJson(result);
      else out.print(result?.message ?? `Purging the cache of ${domain.host}.`);
    });
}

// Without --upstream, use the account's only upstream
async function onlyUpstream(api: Api, account?: string): Promise<Upstream> {
  const a = await resolveAccount(api, account);
  const { data } = await api.get<Page<Upstream>>(`/accounts/${seg(a.uuid)}/upstreams`, { per_page: 100 });
  if (data.length === 1) return data[0]!;
  if (data.length === 0) {
    throw new CliError("This account has no upstreams yet. Create one first: `scd upstreams create <your app's host>`.", ExitCode.Usage);
  }
  throw new CliError(`This account has ${data.length} upstreams, so pass --upstream: ${data.map((u) => u.host).join(", ")}.`, ExitCode.Usage);
}

// The records are a nice extra on `get` and `add`, so a failure here shouldn't fail the command
async function dnsRecords(api: Api, path: string, out: Output) {
  try {
    return (await api.get<{ data: DnsRecord[] }>(`${path}/dns_records`)).data;
  } catch (error) {
    out.info(`Couldn't load the DNS records: ${(error as Error).message}`);
    return undefined;
  }
}

export function domainState(d: CustomDomain) {
  if (d.status === "dns_records_found" || d.status === "dns_check_unnecessary") {
    if (d.tls_certificate_issued) return "Live";
    if (d.challenge_type === "http01") return "DNS records found. The certificate is issued on the first HTTPS request.";
    return `Waiting for the certificate. The _acme-challenge record is ${d.acme_challenge_dns_record_status.replace("_", " ")}.`;
  }
  if (d.status === "dns_records_not_found") return "Waiting for DNS. The records below aren't in place yet.";
  return `DNS not checked yet. Run \`scd domains verify ${d.host}\` to check now.`;
}

function printDomain(out: Output, d: DomainWithRecords) {
  out.fields([
    ["Host", d.host],
    ["State", domainState(d)],
    ["DNS status", d.status],
    ["Certificate issued", d.tls_certificate_issued],
    ["Challenge type", d.challenge_type],
    ["Redirect to www", d.redirect_to_www],
    ["Upstream", d.upstream_host],
    ["UUID", d.uuid],
    ["Account", d.account_uuid],
    ["Last DNS check", d.last_dns_check_at],
    ["Created", date(d.created_at)],
  ]);
  if (d.dns_records?.length) {
    out.print("\nDNS records:\n");
    printRecords(out, d.dns_records);
  }
}

function printRecords(out: Output, records: DnsRecord[]) {
  out.table(
    ["TYPE", "NAME", "VALUE", "PURPOSE"],
    records.map((r) => [r.type, r.name, r.value, r.purpose]),
    "No DNS records needed.",
  );
}
