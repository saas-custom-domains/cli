import { type Argument, type Command, type Option } from "commander";

import { findCustomDomain, seg } from "../api/lookups.js";
import type { ProxySummary, RankedEntry, WebSummary } from "../api/types.js";
import { parseData } from "../data.js";
import { CliError, ExitCode } from "../errors.js";
import { bytes, type Output } from "../output.js";
import type { Runtime } from "../runtime.js";

export const SKILLS_REPO = "https://github.com/saas-custom-domains/skills";

export function registerAnalytics(program: Command, rt: Runtime) {
  program
    .command("analytics")
    .description("Show a custom domain's traffic, or visitors with --web (needs the Domain Analytics add-on)")
    .argument("<host>", "The custom domain")
    .option("--web", "Show visitors, pageviews and top pages instead of requests and response codes")
    .option("--from <date>", "Start date, YYYY-MM-DD (default 30 days ago)")
    .option("--to <date>", "End date, YYYY-MM-DD, included (default today)")
    .addHelpText("after", "\nExamples:\n  scd analytics app.customer.com\n  scd analytics app.customer.com --web --from 2026-10-01 --to 2026-10-31")
    .action(async (host: string, opts: { web?: boolean; from?: string; to?: string }, cmd: Command) => {
      const out = rt.out(cmd);
      const api = rt.api(cmd);
      const domain = await findCustomDomain(api, host);
      const path = `/analytics/custom_domains/${seg(domain.uuid)}/${opts.web ? "web_summary" : "proxy_summary"}`;
      const summary = await api.get<ProxySummary | WebSummary>(path, { from: opts.from, to: opts.to });

      if (out.json) return out.printJson(summary);
      const period = opts.from || opts.to ? `${opts.from ?? "30 days ago"} to ${opts.to ?? "today"}` : "the last 30 days";
      out.print(`${domain.host}, ${period}\n`);
      if (opts.web) printWeb(out, summary as WebSummary);
      else printProxy(out, summary as ProxySummary);
    });
}

function printProxy(out: Output, s: ProxySummary) {
  out.fields([
    ["Requests", s.request_count.toLocaleString("en-US")],
    ["Data transfer", bytes(s.total_data_transfer_bytes)],
    ["Average response time", `${Math.round(s.average_response_time_seconds * 1000)} ms`],
  ]);
  if (s.response_codes.length) {
    out.print("\nResponse codes:\n");
    out.table(["CODE", "REQUESTS", "SHARE"], s.response_codes.slice(0, 10).map((c) => [c.name, c.count, `${c.percentage}%`]));
  }
}

function printWeb(out: Output, s: WebSummary) {
  out.fields([
    ["Visitors", s.unique_visitors_count.toLocaleString("en-US")],
    ["Pageviews", s.total_pageviews_count.toLocaleString("en-US")],
    ["Visits", s.total_visits_count.toLocaleString("en-US")],
  ]);
  const ranked = (title: string, header: string, entries: RankedEntry[]) => {
    if (!entries.length) return;
    out.print(`\n${title}:\n`);
    out.table([header, "COUNT", "SHARE"], entries.map((e) => [e.name, e.count, `${e.percentage}%`]));
  };
  ranked("Top pages", "PAGE", s.top_pages);
  ranked("Top sources", "SOURCE", s.top_sources);
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function registerApi(program: Command, rt: Runtime) {
  program
    .command("api")
    .description("Call any API endpoint and print the JSON response")
    .argument("<method>", `HTTP method: ${METHODS.join(", ")}`)
    .argument("<path>", "Path under /api/v1, for example /accounts or /custom_domains?status=dns_records_not_found")
    .option("--data <json>", "Request body as JSON, @file.json, or @- for stdin")
    .addHelpText(
      "after",
      "\nExamples:\n  scd api GET /me\n  scd api GET '/custom_domains?per_page=100'\n  scd api POST /accounts/acc_123/upstreams --data '{\"host\":\"app.yourapp.com\"}'\n\nAPI reference: https://docs.saascustomdomains.com",
    )
    .action(async (method: string, path: string, opts: { data?: string }, cmd: Command) => {
      const verb = method.toUpperCase();
      if (!METHODS.includes(verb)) throw new CliError(`Unknown method ${method}. Use one of ${METHODS.join(", ")}.`, ExitCode.Usage);
      if (!path.startsWith("/")) throw new CliError("The path must start with /, for example /accounts.", ExitCode.Usage);

      const [rawPath = "", rawQuery = ""] = path.replace(/^\/api\/v1(?=\/)/, "").split("?", 2);
      const query = Object.fromEntries(new URLSearchParams(rawQuery));
      const body = opts.data === undefined ? undefined : await parseData(opts.data, rt.deps.readStdin);

      const result = await rt.api(cmd).request<unknown>(verb, rawPath, { query, body });
      if (result !== null) rt.out(cmd).printJson(result);
    });
}

export function registerSkills(program: Command, rt: Runtime) {
  const skills = program.command("skills").description("Install the SaaS Custom Domains skill for your coding agent");

  skills
    .command("install")
    .description(`Install the skill with \`npx skills add\` from ${SKILLS_REPO}`)
    .argument("[args...]", "Extra arguments for `skills add`, for example --global or --agent claude-code")
    .allowUnknownOption()
    .helpOption(false)
    .action(async (args: string[]) => {
      const code = await rt.deps.runCommand("npx", ["--yes", "skills", "add", SKILLS_REPO, ...args]);
      if (code !== 0) throw new CliError(`\`npx skills add\` exited with code ${code}.`);
    });
}

interface CommandInfo {
  name: string;
  command: string;
  description: string;
  aliases?: string[];
  arguments?: { name: string; required: boolean; variadic: boolean; description: string }[];
  options?: { flags: string; description: string; required?: boolean; choices?: string[] }[];
  commands?: CommandInfo[];
}

function describe(cmd: Command, parents: string[] = []): CommandInfo {
  const path = [...parents, cmd.name()];
  const info: CommandInfo = { name: cmd.name(), command: path.join(" "), description: cmd.description() };
  if (cmd.aliases().length) info.aliases = cmd.aliases();

  const args = (cmd.registeredArguments as readonly Argument[]).map((a) => ({
    name: a.name(),
    required: a.required,
    variadic: a.variadic,
    description: a.description,
  }));
  if (args.length) info.arguments = args;

  const options = (cmd.options as readonly Option[])
    .filter((o) => !o.hidden)
    .map((o) => ({
      flags: o.flags,
      description: o.description,
      ...(o.mandatory ? { required: true } : {}),
      ...(o.argChoices ? { choices: o.argChoices } : {}),
    }));
  if (options.length) info.options = options;

  const subcommands = cmd.commands.filter((c) => c.name() !== "help").map((c) => describe(c, path));
  if (subcommands.length) info.commands = subcommands;
  return info;
}

function leaves(info: CommandInfo): CommandInfo[] {
  return info.commands ? info.commands.flatMap(leaves) : [info];
}

export function registerCommands(program: Command, rt: Runtime) {
  program
    .command("commands")
    .description("List every command; with --json, the full tree with arguments and options, for agents")
    .action((_opts, cmd: Command) => {
      const out = rt.out(cmd);
      const tree = describe(program);
      if (out.json) return out.printJson(tree);
      out.table(
        ["COMMAND", "DESCRIPTION"],
        leaves(tree).map((c) => [c.command + (c.arguments ?? []).map((a) => (a.required ? ` <${a.name}>` : ` [${a.name}]`)).join(""), c.description]),
      );
    });
}
