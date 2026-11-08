#!/usr/bin/env node
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { createInterface } from "node:readline";

import { openBrowser } from "./auth/browser.js";
import { run } from "./program.js";

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Prompts go to stderr, so they never end up in piped output
function prompt(question: string, { mask = false } = {}) {
  return new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stderr.write("\n");
      resolve(answer);
    });
    // Don't echo secrets as they're typed
    if (mask) (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};
  });
}

function runCommand(command: string, args: string[]) {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  readStdin,
  prompt,
  fetch: globalThis.fetch,
  openBrowser,
  hostname,
  runCommand,
});
