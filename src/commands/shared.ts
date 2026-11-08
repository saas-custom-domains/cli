import { type Command, InvalidArgumentError } from "commander";

import type { Api, Query } from "../api/client.js";
import type { Page } from "../api/types.js";
import type { Output } from "../output.js";

export function positiveInt(value: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Must be a whole number of 1 or more.");
  return n;
}

export interface PagingOptions {
  page?: number;
  perPage?: number;
  all?: boolean;
}

export function withPaging(cmd: Command) {
  return cmd
    .option("--page <n>", "Page to show, starting at 1", positiveInt)
    .option("--per-page <n>", "Items per page, up to 100 (default 20)", positiveInt)
    .option("--all", "Fetch every page");
}

export function fetchPage<T>(api: Api, path: string, query: Query, paging: PagingOptions): Promise<Page<T>> {
  if (paging.all) return api.all<T>(path, query);
  return api.get<Page<T>>(path, { ...query, page: paging.page, per_page: paging.perPage });
}

// Tells people when a table shows only part of the list. The API returns the last page for a page past the end.
export function pagingNote(out: Output, page: Page<unknown>, paging: PagingOptions) {
  const { count } = page.pagination;
  if (out.json || paging.all || page.data.length >= count) return;

  const perPage = paging.perPage ?? 20;
  const current = page.pagination.page ?? paging.page ?? 1;
  const first = (current - 1) * perPage + 1;
  const last = first + page.data.length - 1;
  if (last < count) out.info(`\nShowing ${first}-${last} of ${count}. Use --page ${current + 1}, or --all for everything.`);
}
