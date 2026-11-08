import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_APP_URL = "https://app.saascustomdomains.com";

export interface Config {
  token?: string;
}

export type Env = Record<string, string | undefined>;

export function configPath(env: Env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "saascustomdomains", "config.json");
}

export function readConfig(path: string): Config {
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    return typeof config === "object" && config !== null ? config : {};
  } catch {
    return {};
  }
}

// The file holds an API token, so only the user can read it
export function writeConfig(path: string, config: Config) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteConfig(path: string) {
  rmSync(path, { force: true });
}

export type TokenSource = "flag" | "env" | "config";

export interface Credentials {
  token: string;
  source: TokenSource;
}

// Precedence: --token, then SCD_API_TOKEN, then the token saved by `scd auth login`
export function resolveCredentials({ flag, env, config }: { flag?: string; env: Env; config: Config }): Credentials | undefined {
  if (flag) return { token: flag, source: "flag" };
  if (env.SCD_API_TOKEN) return { token: env.SCD_API_TOKEN, source: "env" };
  if (config.token) return { token: config.token, source: "config" };
  return undefined;
}

export function appUrl(env: Env) {
  return (env.SCD_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

export function apiUrl(env: Env) {
  return (env.SCD_API_URL || `${appUrl(env)}/api/v1`).replace(/\/+$/, "");
}
