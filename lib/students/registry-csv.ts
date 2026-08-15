import { registryRowSchema, type RegistryRow } from "@/validations/student";

/**
 * Student registry CSV parsing (PRD §16).
 *
 * Pure and side-effect free: it validates the file, reports every invalid row
 * with its line number, and detects duplicates within the file itself. The
 * caller decides what to persist.
 */
export type RegistryParseResult = {
  valid: RegistryRow[];
  /** Rows rejected by validation, with the reason. */
  invalid: { line: number; raw: string; reason: string }[];
  /** Rows whose matric number appeared earlier in the same file. */
  duplicates: { line: number; matricNumber: string }[];
};

const REQUIRED_HEADERS = ["matric_number", "name"] as const;
const MAX_ROWS = 20_000;

/** Splits a CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_").replace(/^\uFEFF/, "");
}

export class RegistryFormatError extends Error {}

/**
 * Parses a registry CSV. Requires a header row containing at least
 * `matric_number` and `name`; `department` and `level` are optional.
 */
export function parseRegistryCsv(content: string): RegistryParseResult {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) throw new RegistryFormatError("The file is empty");

  const headers = splitCsvLine(lines[0]!).map(normaliseHeader);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new RegistryFormatError(
      `The header row must include: ${REQUIRED_HEADERS.join(", ")} (missing ${missing.join(", ")})`,
    );
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    throw new RegistryFormatError(`Files are limited to ${MAX_ROWS.toLocaleString()} rows`);
  }

  const index = {
    matricNumber: headers.indexOf("matric_number"),
    name: headers.indexOf("name"),
    department: headers.indexOf("department"),
    level: headers.indexOf("level"),
  };

  const result: RegistryParseResult = { valid: [], invalid: [], duplicates: [] };
  const seen = new Set<string>();

  dataLines.forEach((line, offset) => {
    const lineNumber = offset + 2; // 1-based, header occupies line 1
    const fields = splitCsvLine(line);
    const pick = (position: number) => {
      const value = position >= 0 ? fields[position]?.trim() : undefined;
      return value ? value : undefined;
    };

    const parsed = registryRowSchema.safeParse({
      matricNumber: pick(index.matricNumber) ?? "",
      name: pick(index.name) ?? "",
      department: pick(index.department),
      level: pick(index.level),
    });

    if (!parsed.success) {
      result.invalid.push({
        line: lineNumber,
        raw: line,
        reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      return;
    }

    if (seen.has(parsed.data.matricNumber)) {
      result.duplicates.push({ line: lineNumber, matricNumber: parsed.data.matricNumber });
      return;
    }

    seen.add(parsed.data.matricNumber);
    result.valid.push(parsed.data);
  });

  return result;
}
