# AGENTS.md

Notes for anyone (human or agent) changing this CLI.

## Layout

```
src/cli.ts           entry point: wires real stdin/stdout, fetch, the browser and child processes into run()
src/program.ts       builds the commander program, runs it, maps errors to output and exit codes
src/runtime.ts       Runtime: global options, credentials, the API client, confirmations
src/api/             REST client, response types and host → UUID lookups. No CLI concepts here.
src/auth/            config file, credential precedence, browser sign-in (PKCE + loopback), opening a browser
src/commands/        one file per command group; each exports register*(program, runtime)
src/errors.ts        CliError, exit codes, user-facing error messages
src/output.ts        tables, key/value fields, JSON
test/                vitest; helpers.ts has a fake API server and in-memory Deps
```

## Rules

- **Two layers.** `src/api` talks HTTP and knows nothing about commander, output or exit codes. Commands compose API calls into what a user wants to do. Don't generate commands from endpoints; `scd api` covers the long tail.
- **Hostnames in.** Commands take hosts (`app.customer.com`), account names, or UUIDs where there's no host (rules, certificates). Lookups live in `src/api/lookups.ts`.
- **Output contract.** stdout is data, stderr is everything else. `--json` prints the API's objects unchanged (plus documented extras such as `dns_records` on `domains get` and `domains add`). Never switch to JSON based on whether stdout is a TTY.
- **No surprise prompts.** Every prompt needs a flag that answers it. Destructive commands call `runtime.confirm()`, which requires `--yes` when there's no terminal or `--no-input` is set.
- **Exit codes** come from `exitCodeFor()` in `src/errors.ts`: 0 ok, 1 error, 2 usage, 4 auth, 5 not found, 6 rate limited. Keep the README table in sync.
- **Errors say what to do next**, for example "Run `scd auth login`".
- **Secrets.** Never print or log API tokens, except the upstream `auth_token` that `scd upstreams get` exists to show. The config file is written with mode 0600.
- **Dependencies.** Runtime dependencies are commander only. Use Node built-ins (fetch, http, crypto, readline) before adding a package.
- **Testability.** Anything that touches the outside world goes through `Deps` (see `src/runtime.ts`), so tests run commands with `run()` against the fake API in `test/helpers.ts`.

## Checks

```sh
npm test && npm run typecheck && npm run build
```

When you add or change a command, update the README's command table and add a test in `test/commands.test.ts`.

## Releasing

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.1.1 && git push origin main --tags`.
3. The `release` workflow builds, tests and runs `npm publish --provenance --access public`.

The workflow authenticates with npm trusted publishing (OIDC). Trusted publishing can only be set up for a package that exists, so the very first version is published by hand (`npm login`, then `npm publish --access public`). After that, add this repository and `release.yml` as a trusted publisher in the package settings on npmjs.com.
