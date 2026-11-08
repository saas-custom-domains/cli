import { spawn } from "node:child_process";

// Opens a URL in the default browser. Failures are ignored: the URL is always printed as well.
export function openBrowser(url: string) {
  try {
    const child =
      process.platform === "darwin"
        ? spawn("open", [url], { stdio: "ignore", detached: true })
        : process.platform === "win32"
          ? // `start` treats the first quoted argument as a window title, hence the empty one
            spawn("cmd", ["/c", "start", '""', `"${url}"`], { stdio: "ignore", detached: true, windowsVerbatimArguments: true })
          : spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is printed, so the user can open it themselves
  }
}
