import { CommanderError } from "commander";

import { ApiError } from "./api/client.js";
import { LookupError, type Resource } from "./api/lookups.js";

export const API_TOKENS_URL = "https://app.saascustomdomains.com/api_tokens";

export const ExitCode = {
  Ok: 0,
  Error: 1,
  Usage: 2,
  Auth: 4,
  NotFound: 5,
  RateLimited: 6,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = ExitCode.Error,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (error instanceof CommanderError) return error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
  if (error instanceof LookupError) return error.kind === "not_found" ? ExitCode.NotFound : ExitCode.Usage;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return ExitCode.Auth;
    if (error.status === 404) return ExitCode.NotFound;
    if (error.status === 429) return ExitCode.RateLimited;
  }
  return ExitCode.Error;
}

const LIST_COMMANDS: Record<Resource, string> = {
  account: "scd accounts list",
  custom_domain: "scd domains list",
  upstream: "scd upstreams list",
  redirect: "scd redirects list",
};

// The message to show for an error, with what to do next
export function messageFor(error: unknown): string {
  if (error instanceof LookupError) {
    return error.kind === "not_found" && error.resource !== "account" ? `${error.message} Run \`${LIST_COMMANDS[error.resource]}\` to see them.` : error.message;
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 0:
        return `${error.message}. Check your connection, or SCD_API_URL if you set it.`;
      case 401:
        return `Your API token is invalid or was deleted. Run \`scd auth login\`, or set SCD_API_TOKEN to a token from ${API_TOKENS_URL}.`;
      case 403:
        if (error.path.startsWith("/analytics/")) {
          return "This domain's account doesn't have the Domain Analytics add-on. Contact support to enable it.";
        }
        return error.message;
      case 429:
        return `The API rate limit was hit. Retry in ${error.retryAfterSeconds ?? 60} seconds.`;
      default:
        return error.errorCode ? `${error.message} (${error.errorCode})` : error.message;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export function statusFor(error: unknown): number | null {
  return error instanceof ApiError && error.status > 0 ? error.status : null;
}
