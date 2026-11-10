import { readFileSync } from "node:fs";

import { CliError, ExitCode } from "./errors.js";

export function readTextFile(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CliError(`Couldn't read ${path}: ${(error as Error).message}`, ExitCode.Usage);
  }
}

// Parses a --data value: inline JSON, @path/to/file.json, or @- for stdin
export async function parseData(value: string, readStdin: () => Promise<string>): Promise<unknown> {
  let text = value;
  if (value === "@-") text = await readStdin();
  else if (value.startsWith("@")) text = readTextFile(value.slice(1));

  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("--data must be valid JSON, @file.json, or @- to read from stdin.", ExitCode.Usage);
  }
}
