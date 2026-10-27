/**
 * Minimal CSV parser for member import.
 * Supports quoted fields, commas, and CRLF. No streaming — MVP batches fit in memory
 * for pilot cohorts; chunked import can land later if files grow past tens of thousands.
 */

const HEADER_ALIASES: Record<string, string> = {
  displayname: "displayName",
  name: "displayName",
  fullname: "displayName",
  e164: "e164",
  phone: "e164",
  phonenumber: "e164",
  mobile: "e164",
  countrycode: "countryCode",
  country: "countryCode",
  contactbasis: "contactBasis",
  basis: "contactBasis",
  groupname: "groupName",
  group: "groupName",
  active: "active",
};

export type CsvParseError = { row: number; message: string };

export function parseCsv(text: string): {
  headers: string[];
  rows: Record<string, string>[];
  errors: CsvParseError[];
} {
  const lines = splitCsvLines(text);
  const errors: CsvParseError[] = [];
  if (lines.length === 0) {
    return { headers: [], rows: [], errors: [{ row: 1, message: "CSV is empty" }] };
  }

  const rawHeaders = parseCsvLine(lines[0]!);
  const headers = rawHeaders.map((h) => {
    const key = h.trim().toLowerCase().replace(/[\s_-]+/g, "");
    return HEADER_ALIASES[key] ?? h.trim();
  });

  if (!headers.includes("displayName") || !headers.includes("e164")) {
    errors.push({
      row: 1,
      message: "CSV header must include displayName (or name) and e164 (or phone)",
    });
    return { headers, rows: [], errors };
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (cells.length === 1 && cells[0] === "") continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      row[header] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }

  return { headers, rows, errors };
}

function splitCsvLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || text.endsWith("\n")) {
    lines.push(current);
  }
  return lines;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
