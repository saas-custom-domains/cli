import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { apiUrl, appUrl, configPath, readConfig, resolveCredentials, writeConfig } from "../src/auth/config.js";

describe("resolveCredentials", () => {
  const config = { token: "from-config" };

  it("prefers the flag, then SCD_API_TOKEN, then the saved token", () => {
    expect(resolveCredentials({ flag: "from-flag", env: { SCD_API_TOKEN: "from-env" }, config })).toEqual({ token: "from-flag", source: "flag" });
    expect(resolveCredentials({ env: { SCD_API_TOKEN: "from-env" }, config })).toEqual({ token: "from-env", source: "env" });
    expect(resolveCredentials({ env: {}, config })).toEqual({ token: "from-config", source: "config" });
    expect(resolveCredentials({ env: { SCD_API_TOKEN: "" }, config: {} })).toBeUndefined();
  });
});

describe("config file", () => {
  it("lives under XDG_CONFIG_HOME, or ~/.config", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe(join("/xdg", "saascustomdomains", "config.json"));
    expect(configPath({ HOME: "/home/me" })).toBe(join("/home/me", ".config", "saascustomdomains", "config.json"));
  });

  it("is written readable only by the user and read back", () => {
    const path = join(mkdtempSync(join(tmpdir(), "scd-")), "nested", "config.json");
    writeConfig(path, { token: "secret" });

    expect(readConfig(path)).toEqual({ token: "secret" });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reads a missing or broken file as empty", () => {
    expect(readConfig("/nonexistent/config.json")).toEqual({});
  });
});

describe("URLs", () => {
  it("default to production and follow SCD_APP_URL and SCD_API_URL", () => {
    expect(appUrl({})).toBe("https://app.saascustomdomains.com");
    expect(apiUrl({})).toBe("https://app.saascustomdomains.com/api/v1");
    expect(apiUrl({ SCD_APP_URL: "http://localhost:3000/" })).toBe("http://localhost:3000/api/v1");
    expect(apiUrl({ SCD_API_URL: "http://localhost:4010/api/v1/" })).toBe("http://localhost:4010/api/v1");
  });
});
