# Changelog

## 0.1.2

- The README links to the agent setup guides and shows how to run commands with `npx` in CI and agent sandboxes
- First release published through GitHub Actions (staged on npm, then approved)

## 0.1.1

- The npm package is now `@saas-custom-domains/cli`, published by the SaaS Custom Domains organization. It replaces `saascustomdomains`. The commands are still `scd` and `saascustomdomains`.
- The package homepage is https://saascustomdomains.com
- The README shows how to run it with `npx` and install it from npm
- Releases are staged on npm from GitHub Actions with trusted publishing, and go live once a maintainer approves them

## 0.1.0

First release.

- Browser sign-in (`scd auth login`) and API tokens (`--with-token`, `SCD_API_TOKEN`)
- Commands for accounts, upstreams, custom domains, DNS checks and records, cache purges, redirects, rules, uploaded certificates and analytics
- `scd api` for any endpoint, `scd skills install` for the agent skill, and `scd commands --json` for discovery
- `--json` output, `--yes` and `--no-input` for scripts, and documented exit codes
