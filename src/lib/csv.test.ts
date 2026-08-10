import { describe, expect, it } from "vitest";

import { buildCsvDocument, buildCsvRow, escapeCsv } from "@/lib/csv";

const TAB = "\t";
const CR = "\r";

describe("escapeCsv", () => {
  it.each([
    ["equals", '=HYPERLINK("http://x","y")'],
    ["plus", "+1+1"],
    ["at", "@SUM(1)"],
    ["at with command payload", `@SUM(1+1)*cmd|' /C calc'!A0`],
    ["minus followed by a digit", "-1+cmd|' /C calc'!A0"],
    ["leading space then equals", " =1+1"],
    ["leading tab then equals", `${TAB}=1+1`],
    ["bare tab, non-formula tail", `${TAB}Hello`],
    ["bare carriage return, non-formula tail", `${CR}Hello`],
    ["non-breaking space then at", " @SUM(1)"],
  ])("apostrophe-guards a formula trigger (%s)", (_label, value) => {
    const cell = escapeCsv(value);
    // The guard may also RFC-quote, so assert on the first content character.
    const content = cell.startsWith('"') ? cell.slice(1) : cell;
    expect(content.startsWith("'")).toBe(true);
  });

  it.each([
    ["negative money", "-100000.00"],
    ["positive money", "100000.00"],
    ["integer", "-42"],
    ["exponential (toFixed emits it past 1e21)", "-1.5e+22"],
  ])("keeps a plain number numeric (%s)", (_label, value) => {
    expect(escapeCsv(value)).toBe(value);
  });

  it("does not guard ordinary text", () => {
    expect(escapeCsv("Фундамент")).toBe("Фундамент");
    expect(escapeCsv("")).toBe("");
  });

  it("RFC-quotes a cell containing a comma", () => {
    expect(escapeCsv("Этап 1, черновой")).toBe('"Этап 1, черновой"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCsv('Труба 1/2"')).toBe('"Труба 1/2"""');
  });

  it("quotes a lone carriage return so it cannot split the record", () => {
    // Regression for the second defect in #195: the old estimate quote test was
    // /[",\n]/ and omitted \r, so this cell was emitted bare and any parser that
    // honours a lone CR read two rows where the export wrote one.
    const cell = escapeCsv(`Stage A${CR}EVIL`);
    expect(cell.startsWith('"')).toBe(true);
    expect(cell.endsWith('"')).toBe(true);
  });

  it("quotes a cell containing a newline", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsvRow", () => {
  it("escapes every cell and joins with a comma", () => {
    expect(buildCsvRow(["Этап", "=1+1", "10"])).toBe("Этап,'=1+1,10");
  });
});

describe("buildCsvDocument", () => {
  it("escapes every cell of every row and joins with the default newline", () => {
    const csv = buildCsvDocument([
      ["Stage", "Work", "Line", "Qty", "Unit"],
      ["Этап 1", "Работа", "-1+cmd|' /C calc'!A0", "1", "m2"],
    ]);

    // The payload carries no comma, quote or CR, so it is apostrophe-guarded but
    // not RFC-quoted. Both defences are independent and both are asserted here.
    expect(csv).toBe(
      "Stage,Work,Line,Qty,Unit\nЭтап 1,Работа,'-1+cmd|' /C calc'!A0,1,m2",
    );
  });

  it("emits one record per row even when a title carries a lone CR", () => {
    const csv = buildCsvDocument([[`Stage A${CR}EVIL`, "W", "L", "1", "m2"]]);
    expect(csv.split("\n")).toHaveLength(1);
    expect(csv).toContain('"Stage A\rEVIL"');
  });

  it("honours a caller-supplied line ending", () => {
    expect(buildCsvDocument([["a"], ["b"]], "\r\n")).toBe("a\r\nb");
  });

  it("tolerates a ragged row (a header shorter than its data rows)", () => {
    expect(buildCsvDocument([[], ["a", "b"]])).toBe("\na,b");
  });
});
