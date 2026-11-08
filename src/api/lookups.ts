import { type Api, ApiError } from "./client.js";
import type { Account, AccountCustomDomain, Page, Redirect, Upstream } from "./types.js";

// Commands take hostnames and names; the REST API takes UUIDs. These helpers translate.

export type Resource = "account" | "custom_domain" | "upstream" | "redirect";

export class LookupError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "ambiguous",
    readonly resource: Resource,
  ) {
    super(message);
    this.name = "LookupError";
  }
}

export function seg(value: string) {
  return encodeURIComponent(value);
}

// Lowercase, trimmed, without a trailing dot: the form the API stores hosts in
export function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function describeAccounts(accounts: Account[]) {
  return accounts.map((account) => `${account.name} (${account.uuid})`).join(", ");
}

// Accepts an account UUID or name. Without one, uses the user's only account.
export async function resolveAccount(api: Api, account?: string): Promise<Account> {
  // A UUID needs no lookup; the API answers 404 if it's wrong
  if (account && /^acc_[A-Za-z0-9]+$/.test(account)) return { uuid: account, name: account, personal: false };

  const accounts = await api.get<Account[]>("/accounts");

  if (account) {
    const matches = accounts.filter((a) => a.uuid === account || a.name.toLowerCase() === account.toLowerCase());
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new LookupError(`More than one account is named "${account}". Use the UUID instead: ${describeAccounts(matches)}.`, "ambiguous", "account");
    }
    throw new LookupError(`No account matches "${account}". Your accounts: ${describeAccounts(accounts)}.`, "not_found", "account");
  }

  if (accounts.length === 1) return accounts[0]!;
  if (accounts.length === 0) throw new LookupError("You don't have any accounts.", "not_found", "account");
  throw new LookupError(`You have ${accounts.length} accounts, so pass --account (name or UUID): ${describeAccounts(accounts)}.`, "ambiguous", "account");
}

// The account to search, or every account when none is given
export async function accountsToSearch(api: Api, account?: string) {
  return account ? [await resolveAccount(api, account)] : api.get<Account[]>("/accounts");
}

export async function findCustomDomain(api: Api, host: string): Promise<AccountCustomDomain> {
  const wanted = normalizeHost(host);
  const { data } = await api.get<Page<AccountCustomDomain>>("/custom_domains", { host: wanted });
  const domain = data.find((d) => d.host === wanted);
  if (domain) return domain;

  throw new LookupError(`No custom domain ${wanted} in your accounts.`, "not_found", "custom_domain");
}

export function customDomainPath(domain: AccountCustomDomain) {
  return `/accounts/${seg(domain.account_uuid)}/upstreams/${seg(domain.upstream_uuid)}/custom_domains/${seg(domain.uuid)}`;
}

export function upstreamPath(upstream: Upstream) {
  return `/accounts/${seg(upstream.account_uuid)}/upstreams/${seg(upstream.uuid)}`;
}

// Accepts an upstream host or UUID
export async function findUpstream(api: Api, hostOrUuid: string, account?: string): Promise<Upstream> {
  const isUuid = /^upstream_[A-Za-z0-9]+$/.test(hostOrUuid);
  const wanted = isUuid ? hostOrUuid : normalizeHost(hostOrUuid);

  for (const a of await accountsToSearch(api, account)) {
    if (isUuid) {
      try {
        return await api.get<Upstream>(`/accounts/${seg(a.uuid)}/upstreams/${seg(wanted)}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    } else {
      const { data } = await api.get<Page<Upstream>>(`/accounts/${seg(a.uuid)}/upstreams`, { host: wanted });
      const upstream = data.find((u) => u.host === wanted);
      if (upstream) return upstream;
    }
  }

  throw new LookupError(`No upstream ${wanted} in your accounts.`, "not_found", "upstream");
}

// Accepts a redirect UUID or its source host
export async function findRedirect(api: Api, uuidOrHost: string, account?: string): Promise<Redirect> {
  const isUuid = /^redirect_[A-Za-z0-9]+$/.test(uuidOrHost);
  const wanted = isUuid ? uuidOrHost : normalizeHost(uuidOrHost);
  const matches: Redirect[] = [];

  for (const a of await accountsToSearch(api, account)) {
    if (isUuid) {
      try {
        return await api.get<Redirect>(`/accounts/${seg(a.uuid)}/redirects/${seg(wanted)}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    } else {
      const { data } = await api.all<Redirect>(`/accounts/${seg(a.uuid)}/redirects`, { source_host: wanted });
      matches.push(...data.filter((r) => r.source_host === wanted));
    }
  }

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const options = matches.map((r) => `${r.uuid} (${r.match_path} → ${r.destination_url})`).join(", ");
    throw new LookupError(`${wanted} has ${matches.length} redirects. Use the UUID of the one you mean: ${options}.`, "ambiguous", "redirect");
  }
  throw new LookupError(`No redirect ${wanted} in your accounts.`, "not_found", "redirect");
}

// Rules belong to a custom domain, or to an upstream (and then apply to all of its domains)
export async function rulesPath(api: Api, target: { domain?: string; upstream?: string }, account?: string) {
  if (target.domain) return `${customDomainPath(await findCustomDomain(api, target.domain))}/rules`;
  if (target.upstream) return `${upstreamPath(await findUpstream(api, target.upstream, account))}/rules`;
  throw new Error("Pass either a custom domain or an upstream.");
}
