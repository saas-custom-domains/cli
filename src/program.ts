import { Command, CommanderError } from "commander";

import { registerAuth } from "./commands/auth.js";
import { registerDomains } from "./commands/domains.js";
import { registerAnalytics, registerApi, registerCommands, registerSkills } from "./commands/misc.js";
import { registerRedirects } from "./commands/redirects.js";
import { registerCertificates, registerRules } from "./commands/rules.js";
import { registerAccounts, registerUpstreams } from "./commands/upstreams.js";
import { exitCodeFor, messageFor, statusFor } from "./errors.js";
import { type Deps, Runtime } from "./runtime.js";
import { version } from "./version.js";

export function buildProgram(rt: Runtime) {
  const program = new Command("scd")
    .description("Manage SaaS Custom Domains from your terminal: custom domains, DNS, upstreams, redirects, rules and analytics.")
    .version(version, "-v, --version", "Print the version")
    .option("--json", "Print JSON instead of tables")
    .option("--account <name-or-uuid>", "Account to use, if you have more than one (or set SCD_ACCOUNT)")
    .option("--token <token>", "API token to use for this command (SCD_API_TOKEN is safer: flags end up in shell history)")
    .option("-y, --yes", "Don't ask for confirmation before deleting")
    .option("--no-input", "Fail instead of prompting")
    .helpOption("-h, --help", "Show help")
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => rt.deps.stdout.write(text),
      writeErr: (text) => rt.deps.stderr.write(text),
      // run() prints errors, in JSON when --json is set
      outputError: () => {},
    })
    .addHelpText(
      "after",
      `
Get started:
  scd auth login                          Sign in with your browser
  scd upstreams create app.yourapp.com    The app your custom domains forward to
  scd domains add app.customer.com        Add a customer's domain and get its DNS records
  scd domains get app.customer.com        Check whether it's live

Every command takes --json. Run \`scd commands --json\` for the full command tree.
Docs: https://docs.saascustomdomains.com`,
    );

  registerAuth(program, rt);
  registerAccounts(program, rt);
  registerUpstreams(program, rt);
  registerDomains(program, rt);
  registerRedirects(program, rt);
  registerRules(program, rt);
  registerCertificates(program, rt);
  registerAnalytics(program, rt);
  registerApi(program, rt);
  registerSkills(program, rt);
  registerCommands(program, rt);

  // `scd help <command>` would duplicate --help on every command group
  const disableHelpCommand = (cmd: Command) => {
    cmd.helpCommand(false);
    cmd.commands.forEach(disableHelpCommand);
  };
  disableHelpCommand(program);
  return program;
}

// Runs the CLI and returns the exit code
export async function run(argv: string[], deps: Deps): Promise<number> {
  const program = buildProgram(new Runtime(deps));
  const json = argv.includes("--json");

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // --help and --version end with a CommanderError too, and so does `scd` on its own, which prints the help
      if (error.exitCode === 0 || error.code === "commander.help" || error.code === "commander.helpDisplayed") return 0;
    }

    const message = error instanceof CommanderError ? error.message.replace(/^error: /, "") : messageFor(error);
    if (json) deps.stderr.write(`${JSON.stringify({ error: { status: statusFor(error), message } })}\n`);
    else deps.stderr.write(`Error: ${message}\n`);
    return exitCodeFor(error);
  }
}
