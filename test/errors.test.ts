import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/api/client.js";
import { LookupError } from "../src/api/lookups.js";
import { CliError, exitCodeFor, messageFor } from "../src/errors.js";

describe("exitCodeFor", () => {
  it.each([
    [new ApiError("x", 401, "/me"), 4],
    [new ApiError("x", 403, "/x"), 4],
    [new ApiError("x", 404, "/x"), 5],
    [new ApiError("x", 429, "/x"), 6],
    [new ApiError("x", 500, "/x"), 1],
    [new ApiError("x", 0, "/x"), 1],
    [new LookupError("x", "not_found", "custom_domain"), 5],
    [new LookupError("x", "ambiguous", "account"), 2],
    [new CliError("x", 2), 2],
    [new CommanderError(1, "commander.unknownOption", "x"), 2],
    [new Error("x"), 1],
  ])("%s → %i", (error, code) => {
    expect(exitCodeFor(error)).toBe(code);
  });
});

describe("messageFor", () => {
  it("tells people how to fix a bad token", () => {
    expect(messageFor(new ApiError("x", 401, "/me"))).toContain("scd auth login");
  });

  it("includes the retry time for rate limits", () => {
    expect(messageFor(new ApiError("x", 429, "/x", undefined, 17))).toContain("17 seconds");
  });

  it("explains the analytics add-on on 403", () => {
    expect(messageFor(new ApiError("Forbidden", 403, "/analytics/custom_domains/d/proxy_summary"))).toContain("Domain Analytics add-on");
  });

  it("points to the list command when a lookup fails", () => {
    expect(messageFor(new LookupError("No custom domain x.com in your accounts.", "not_found", "custom_domain"))).toContain("scd domains list");
  });
});
