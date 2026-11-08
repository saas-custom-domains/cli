export interface Writer {
  write(text: string): unknown;
}

// stdout is for data, stderr for everything else, so `scd ... --json | jq` always gets clean JSON
export class Output {
  constructor(
    private readonly stdout: Writer,
    private readonly stderr: Writer,
    readonly json: boolean,
  ) {}

  print(text = "") {
    this.stdout.write(`${text}\n`);
  }

  info(text: string) {
    this.stderr.write(`${text}\n`);
  }

  printJson(value: unknown) {
    this.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  table(headers: string[], rows: unknown[][], empty = "Nothing to show.") {
    if (rows.length === 0) {
      this.info(empty);
      return;
    }
    this.print(formatTable(headers, rows.map((row) => row.map(cell))));
  }

  fields(pairs: [string, unknown][]) {
    const width = Math.max(...pairs.map(([label]) => label.length));
    for (const [label, value] of pairs) this.print(`${`${label}:`.padEnd(width + 2)}${cell(value)}`);
  }
}

export function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  return String(value);
}

export function formatTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

export function date(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

export function bytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${unit === 0 ? n : n.toFixed(1)} ${units[unit]}`;
}
