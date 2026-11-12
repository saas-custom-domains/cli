// Response shapes from https://docs.saascustomdomains.com/openapi.json, limited to the fields the CLI reads.
// Commands print whole API objects in --json mode, so nothing here filters what users get.

export interface User {
  id: number;
  name: string;
}

export interface Account {
  uuid: string;
  name: string;
  personal: boolean;
}

export interface Pagination {
  page: number;
  count: number;
}

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

export interface Upstream {
  uuid: string;
  host: string;
  port: number;
  tls: boolean;
  bubble_io: boolean;
  compression_enabled: boolean;
  geocoding_enabled: boolean;
  auth_token: string;
  account_uuid: string;
  created_at: string;
}

export type DnsStatus = "pending_check" | "dns_records_found" | "dns_records_not_found" | "dns_check_unnecessary";

export interface CustomDomain {
  uuid: string;
  host: string;
  status: DnsStatus;
  challenge_type: "http01" | "dns01";
  acme_challenge_dns_record_status: "valid" | "pending" | "not_found" | "invalid";
  tls_certificate_issued: boolean;
  redirect_to_www: boolean;
  prepend_path: string | null;
  bubble_target_path: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_favicon_url: string | null;
  meta_image_url: string | null;
  last_dns_check_at: string | null;
  upstream_uuid: string;
  created_at: string;
}

// An item of GET /custom_domains, which lists domains across accounts
export interface AccountCustomDomain extends CustomDomain {
  account_uuid: string;
  upstream_host: string;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  purpose: "proxy" | "acme_challenge";
}

export interface DnsVerificationResult {
  host: string;
  dns_status: "valid" | "pending" | "invalid";
  message: string;
}

export interface Redirect {
  uuid: string;
  source_host: string;
  match_path: string;
  destination_url: string;
  redirect_type: "permanent" | "found";
  preserve_path: boolean;
  preserve_query_string: boolean;
  active: boolean;
  account_uuid: string;
}

export interface Rule {
  uuid: string;
  name: string;
  active: boolean;
  position: number;
  matchers: { type: string }[];
  handlers: { type: string }[];
  scope: "upstream" | "domain";
}

export interface CustomCertificate {
  uuid: string;
  subject: string;
  sans: string[];
  issuer: string;
  expires_at: string;
}

export interface ProxySummary {
  request_count: number;
  total_data_transfer_bytes: number;
  average_response_time_seconds: number;
  response_codes: { name: string; http_code: number; count: number; percentage: number }[];
}

export interface RankedEntry {
  name: string;
  count: number;
  percentage: number;
}

export interface WebSummary {
  unique_visitors_count: number;
  total_pageviews_count: number;
  total_visits_count: number;
  top_pages: RankedEntry[];
  top_sources: RankedEntry[];
}

export interface Message {
  message: string;
}
