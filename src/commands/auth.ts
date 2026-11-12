import type { Command } from "commander";

import { ApiError } from "../api/client.js";
import type { User } from "../api/types.js";
import { appUrl, readConfig, writeConfig } from "../auth/config.js";
import { loginWithBrowser } from "../auth/login.js";
import { API_TOKENS_URL, CliError, ExitCode } from "../errors.js";
import { type Runtime, USER_AGENT } from "../runtime.js";

export function registerAuth(program: Command, rt: Runtime) {
  const auth = program.command("auth").description("Sign in, sign out and see which user the CLI acts as");

  auth
    .command("login")
    .description("Sign in with your browser, or save an API token")
    .option("--with-token", "Read an API token from stdin instead of signing in with the browser")
    .option("--no-browser", "Print the sign-in URL instead of opening a browser")
    .addHelpText(
      "after",
      `
Signing in creates an API token named "CLI: <this computer's name>". You can see and delete it under
Settings → API (${API_TOKENS_URL}).

Examples:
  scd auth login
  echo "$SCD_TOKEN" | scd auth login --with-token`,
    )
    .action(async (opts: { withToken?: boolean; browser: boolean }, cmd: Command) => {
      const out = rt.out(cmd);
      const token = opts.withToken
        ? await readToken(rt, cmd)
        : await loginWithBrowser({
            appUrl: appUrl(rt.deps.env),
            name: rt.deps.hostname(),
            userAgent: USER_AGENT,
            open: opts.browser ? rt.deps.openBrowser : undefined,
            log: (message) => out.info(message),
            fetch: rt.deps.fetch,
          });

      const user = await currentUser(rt, token);
      writeConfig(rt.configPath, { ...readConfig(rt.configPath), token });

      if (out.json) out.printJson({ user, config_path: rt.configPath });
      else out.print(`Signed in as ${user.name}. The token is saved in ${rt.configPath}.`);
      if (rt.deps.env.SCD_API_TOKEN) out.info("Note: SCD_API_TOKEN is set in your environment, and it takes precedence over the saved token.");
    });

  auth
    .command("logout")
    .description("Remove the saved API token from this computer")
    .action((_opts, cmd: Command) => {
      const out = rt.out(cmd);
      const config = readConfig(rt.configPath);
      const hadToken = Boolean(config.token);
      if (hadToken) {
        delete config.token;
        writeConfig(rt.configPath, config);
      }

      if (out.json) out.printJson({ removed: hadToken });
      else if (hadToken) out.print(`Removed the saved token. To revoke it too, delete it under Settings → API: ${API_TOKENS_URL}`);
      else out.print("There's no saved token on this computer.");
      if (rt.deps.env.SCD_API_TOKEN) out.info("SCD_API_TOKEN is still set in your environment, so commands keep using it.");
    });

  auth
    .command("status")
    .description("Show the signed-in user and where the API token comes from")
    .action(async (_opts, cmd: Command) => {
      const out = rt.out(cmd);
      const credentials = rt.credentials(cmd);
      if (!credentials) {
        throw new CliError(`You're not signed in. Run \`scd auth login\`, or set SCD_API_TOKEN to an API token from ${API_TOKENS_URL}.`, ExitCode.Auth);
      }

      const user = await rt.apiWithToken(credentials.token).get<User>("/me");
      const source = { flag: "the --token flag", env: "the SCD_API_TOKEN environment variable", config: rt.configPath }[credentials.source];

      if (out.json) {
        out.printJson({ user, token_source: credentials.source, config_path: rt.configPath, api_url: rt.apiUrl });
        return;
      }
      out.fields([
        ["Signed in as", user.name],
        ["Token from", source],
        ["API", rt.apiUrl],
      ]);
    });
}

async function readToken(rt: Runtime, cmd: Command) {
  let token: string;
  if (rt.deps.stdinIsTTY) {
    if (!rt.canPrompt(cmd)) throw new CliError("Pipe the token in, for example: echo \"$SCD_TOKEN\" | scd auth login --with-token", ExitCode.Usage);
    token = await rt.deps.prompt(`Paste an API token from ${API_TOKENS_URL}: `, { mask: true });
  } else {
    token = await rt.deps.readStdin();
  }

  token = token.trim();
  if (!token) throw new CliError("No API token was given.", ExitCode.Usage);
  return token;
}

async function currentUser(rt: Runtime, token: string) {
  try {
    return await rt.apiWithToken(token).get<User>("/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new CliError(`That API token isn't valid. Create one under Settings → API: ${API_TOKENS_URL}`, ExitCode.Auth);
    }
    throw error;
  }
}
