# SaaS Custom Domains CLI

Manage [SaaS Custom Domains](https://saascustomdomains.com) from your terminal, scripts and coding agents: add your customers' custom domains, get the DNS records they need, check why a domain isn't live yet, and manage upstreams, redirects, rules and analytics.

```console
$ scd domains add app.customer.com
Added app.customer.com to upstream app.yourapp.com.

Ask your customer to add these DNS records:

TYPE   NAME              VALUE                     PURPOSE
CNAME  app.customer.com  in.saascustomdomains.com  proxy

Check progress with `scd domains get app.customer.com`.
```

## Install

The CLI needs Node.js 20 or newer. Run any command without installing:

```sh
npx @saas-custom-domains/cli <command>
```

Or install it, which puts `scd` and `saascustomdomains` on your PATH:

```sh
npm install -g @saas-custom-domains/cli
```

To build it from source:

```sh
git clone https://github.com/saas-custom-domains/cli.git
cd cli
npm install
npm link
```

## Sign in

```sh
scd auth login
```

This opens your browser. Sign in to SaaS Custom Domains (with two-factor authentication if you use it) and click **Continue**. The CLI saves an API token named "CLI: <your computer's name>" in `~/.config/saascustomdomains/config.json`, readable only by you. You can see and delete the token under [Settings → API](https://app.saascustomdomains.com/api_tokens). If the browser doesn't open, the CLI prints the URL.

To use an API token instead, create one under [Settings → API](https://app.saascustomdomains.com/api_tokens), then either save it:

```sh
echo "$SCD_TOKEN" | scd auth login --with-token
```

or set it for each run, which is the usual choice for CI and agents:

```sh
export SCD_API_TOKEN=...
```

`scd auth status` shows who you're signed in as and where the token comes from. `scd auth logout` removes the saved token.

## Quick start

```sh
scd upstreams create app.yourapp.com      # the app your custom domains forward to (once)
scd domains add app.customer.com          # add a customer's domain and get its DNS records
scd domains get app.customer.com          # DNS and certificate status, and the records it needs
scd domains verify app.customer.com       # check the DNS records now
scd domains list --status dns_records_not_found --all   # who still hasn't set up DNS
```

Commands take hostnames rather than UUIDs. If you have more than one account, pass `--account <name or UUID>` or set `SCD_ACCOUNT`.

## Commands

| Command | What it does |
| --- | --- |
| `scd auth login \| logout \| status` | Sign in with the browser or an API token, sign out, show the current user |
| `scd accounts list` | List your accounts |
| `scd upstreams list \| get \| create \| delete` | Manage upstreams, the apps your custom domains forward to. `get` shows the auth token your app should check |
| `scd domains list \| get \| add \| delete` | Manage custom domains. `add` takes `--upstream`, `--redirect-to-www`, `--challenge-type`, `--instructions-recipient` and `--prepend-path` |
| `scd domains verify \| dns-records \| purge-cache` | Check DNS now, show the DNS records a domain needs, purge its HTTP cache |
| `scd redirects list \| get \| create \| update \| delete` | Manage domain redirects, for example `old-brand.com` → `https://newbrand.com` |
| `scd rules list \| create \| delete` | Manage rules on a domain (`--domain`) or upstream (`--upstream`). `create` takes the rule as JSON with `--data` |
| `scd certificates list \| create \| delete` | Manage custom TLS certificates. `create` uploads a certificate and its private key from PEM files |
| `scd analytics <host>` | Requests, data transfer and response codes; `--web` for visitors, pageviews and top pages. Needs the Domain Analytics add-on |
| `scd api <method> <path>` | Call any API endpoint and print the JSON response |
| `scd skills install` | Install the [SaaS Custom Domains skill](https://github.com/saas-custom-domains/skills) for your coding agent with `npx skills add` |
| `scd commands` | List every command; with `--json`, the full tree with arguments and options |

Run `scd <command> --help` for options and examples. Lists show 20 items; use `--page`, `--per-page` (up to 100) or `--all`.

`scd api` covers everything else in the [API reference](https://docs.saascustomdomains.com), with paths relative to `/api/v1`:

```sh
scd api GET /me
scd api GET '/custom_domains?status=dns_records_not_found&per_page=100'
scd api PATCH /accounts/acc_123/upstreams/upstream_456/rules/update_positions --data @positions.json
```

## Scripts, CI and agents

- **JSON output.** Add `--json` to any command for machine-readable output on stdout. The CLI never switches to JSON on its own, for example when output is piped. Messages and warnings go to stderr, so stdout stays clean.
- **No prompts.** Deleting asks for confirmation in a terminal. Without one, or with `--no-input`, the command fails unless you pass `--yes`.
- **Errors.** With `--json`, errors are printed to stderr as `{"error": {"status": 404, "message": "..."}}`, where `status` is the API's HTTP status, or `null` for errors that didn't come from the API.
- **Discovery.** `scd commands --json` describes every command, argument and option.
- **Rate limits.** The API allows 360 requests per minute per token, and 5 DNS checks per minute. On a `429`, the CLI exits with code 6 and says when to retry.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Error |
| 2 | Bad usage, or input needed (for example `--yes`) |
| 4 | Not signed in, invalid token, or no access |
| 5 | Not found |
| 6 | Rate limited |

Environment variables:

| Variable | Description |
| --- | --- |
| `SCD_API_TOKEN` | API token. Takes precedence over the saved token; `--token` takes precedence over both |
| `SCD_ACCOUNT` | Default account, by name or UUID |
| `SCD_API_URL` | API base URL. Default `https://app.saascustomdomains.com/api/v1` |
| `SCD_APP_URL` | App URL used for browser sign-in. Default `https://app.saascustomdomains.com` |
| `XDG_CONFIG_HOME` | Where the config file goes. Default `~/.config` |

In CI and agent sandboxes, run commands without installing anything: `SCD_API_TOKEN=... npx @saas-custom-domains/cli domains list --json`.

For coding agents, the [skill](https://github.com/saas-custom-domains/skills) teaches the integration (API calls in your app, DNS instructions, webhooks, verifying forwarded requests), and the [MCP server](https://docs.saascustomdomains.com/mcp) at `https://mcp.saascustomdomains.com/mcp` gives chat assistants the same operations as tools. Setup for Claude Code, Cursor, Codex, VS Code and other agents: https://saascustomdomains.com/agent-setup

## Local development with scd-mock

[scd-mock](https://github.com/saas-custom-domains/scd-mock) is a local mock of the API and proxy. Point the CLI at it:

```sh
export SCD_API_URL=http://localhost:4010/api/v1 SCD_API_TOKEN=scd_test_token SCD_ACCOUNT=acc_local
scd upstreams list
scd domains add acme.localhost --upstream localhost
```

scd-mock implements the upstream and custom domain endpoints. Commands that find a custom domain by its host (`domains get`, `verify`, `delete` and others) use `GET /custom_domains`, which scd-mock doesn't implement yet. For those, use `scd api` with the domain's path, for example `scd api POST /accounts/acc_local/upstreams/upstream_local/custom_domains/<uuid>/verify_dns_records`.

## Develop

```sh
npm install
npm test            # vitest
npm run typecheck
npm run build       # compiles src/ to dist/
```

See [AGENTS.md](AGENTS.md) for how the code is organized and how releases work: push a `vX.Y.Z` tag, GitHub Actions stages the version on npm, and a maintainer approves it.

## Links

- [API docs](https://docs.saascustomdomains.com) and [OpenAPI spec](https://docs.saascustomdomains.com/openapi.json)
- [MCP server](https://docs.saascustomdomains.com/mcp)
- [Agent skill](https://github.com/saas-custom-domains/skills) and [agent setup guides](https://saascustomdomains.com/agent-setup)
- [Example apps](https://github.com/saas-custom-domains) for Next.js, Rails, Django, Laravel and more

## License

MIT
