import type { Command } from "commander";

import { Api, type Fetch } from "./api/client.js";
import { apiUrl, configPath, type Credentials, type Env, readConfig, resolveCredentials } from "./auth/config.js";
import { API_TOKENS_URL, CliError, ExitCode } from "./errors.js";
import { Output, type Writer } from "./output.js";
import { version } from "./version.js";

export const USER_AGENT = `saascustomdomains-cli/${version}`;

// Everything that touches the outside world, so tests can replace it
export interface Deps {
  env: Env;
  stdout: Writer;
  stderr: Writer;
  stdinIsTTY: boolean;
  readStdin: () => Promise<string>;
  prompt: (question: string, options?: { mask?: boolean }) => Promise<string>;
  fetch: Fetch;
  openBrowser: (url: string) => void;
  hostname: () => string;
  runCommand: (command: string, args: string[]) => Promise<number>;
}

export interface GlobalOptions {
  json?: boolean;
  token?: string;
  account?: string;
  input?: boolean;
  yes?: boolean;
}

export class Runtime {
  readonly configPath: string;

  constructor(readonly deps: Deps) {
    this.configPath = configPath(deps.env);
  }

  globals(cmd: Command): GlobalOptions {
    const options = cmd.optsWithGlobals<GlobalOptions>();
    return { ...options, account: options.account ?? (this.deps.env.SCD_ACCOUNT || undefined) };
  }

  out(cmd: Command) {
    return new Output(this.deps.stdout, this.deps.stderr, Boolean(this.globals(cmd).json));
  }

  get apiUrl() {
    return apiUrl(this.deps.env);
  }

  credentials(cmd: Command): Credentials | undefined {
    return resolveCredentials({ flag: this.globals(cmd).token, env: this.deps.env, config: readConfig(this.configPath) });
  }

  api(cmd: Command) {
    const credentials = this.credentials(cmd);
    if (!credentials) {
      throw new CliError(`You're not signed in. Run \`scd auth login\`, or set SCD_API_TOKEN to an API token from ${API_TOKENS_URL}.`, ExitCode.Auth);
    }
    return this.apiWithToken(credentials.token);
  }

  apiWithToken(token: string) {
    return new Api({ baseUrl: this.apiUrl, token, userAgent: USER_AGENT, fetch: this.deps.fetch });
  }

  canPrompt(cmd: Command) {
    return this.globals(cmd).input !== false && this.deps.stdinIsTTY;
  }

  // Asks before destructive actions. Without a terminal to ask in, --yes is required.
  async confirm(cmd: Command, question: string) {
    if (this.globals(cmd).yes) return;
    if (!this.canPrompt(cmd)) throw new CliError(`${question} Pass --yes to confirm without a prompt.`, ExitCode.Usage);

    const answer = await this.deps.prompt(`${question} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new CliError("Cancelled.");
  }
}
