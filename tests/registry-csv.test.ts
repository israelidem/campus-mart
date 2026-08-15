import { describe, expect, it } from "vitest";

import { RegistryFormatError, parseRegistryCsv } from "@/lib/students/registry-csv";

describe("parseRegistryCsv", () => {
  it("imports valid rows and normalises optional columns", () => {
    const result = parseRegistryCsv(
      [
        "matric_number,name,department,level",
        "25/LAW01/001,John Doe,Law,200",
        "25/LAW01/002,Jane Doe,,",
      ].join("\n"),
    );

    expect(result.valid).toEqual([
      { matricNumber: "25/LAW01/001", name: "John Doe", department: "Law", level: "200" },
      { matricNumber: "25/LAW01/002", name: "Jane Doe", department: undefined, level: undefined },
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
  });

  it("accepts the minimal two-column format from the PRD", () => {
    const result = parseRegistryCsv("matric_number,name\n25/LAW01/001,John Doe");
    expect(result.valid).toHaveLength(1);
  });

  it("reports invalid rows with their line number instead of dropping them", () => {
    const result = parseRegistryCsv(
      ["matric_number,name", "25/LAW01/001,John Doe", ",Missing Matric"].join("\n"),
    );

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.line).toBe(3);
    expect(result.invalid[0]?.reason).toBeTruthy();
  });

  it("detects duplicate matric numbers within the file", () => {
    const result = parseRegistryCsv(
      [
        "matric_number,name",
        "25/LAW01/001,John Doe",
        "25/LAW01/001,John Doe Again",
      ].join("\n"),
    );

    expect(result.valid).toHaveLength(1);
    expect(result.duplicates).toEqual([{ line: 3, matricNumber: "25/LAW01/001" }]);
  });

  it("honours quoted fields containing commas", () => {
    const result = parseRegistryCsv(
      'matric_number,name\n25/LAW01/001,"Doe, John"',
    );

    expect(result.valid[0]?.name).toBe("Doe, John");
  });

  it("tolerates a byte-order mark, CRLF line endings and blank lines", () => {
    const result = parseRegistryCsv(
      "\uFEFFmatric_number,name\r\n25/LAW01/001,John Doe\r\n\r\n",
    );

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it("rejects a file whose header row is missing required columns", () => {
    expect(() => parseRegistryCsv("matric,fullname\n25/LAW01/001,John Doe")).toThrow(
      RegistryFormatError,
    );
  });

  it("rejects an empty file", () => {
    expect(() => parseRegistryCsv("   \n\n")).toThrow(RegistryFormatError);
  });
});
