// Portfolio CSV export (spec Part 3 §6 module 6 / P1). Full-precision values, one row
// per project; redacted (non-detail) projects export their non-monetary fields only.

import type { PortfolioFinanceSnapshot, PortfolioProjectRow } from "@/lib/finance/portfolio-read-model";

const BOM = "﻿";

function escapeCsv(value: string): string {
  // Neutralize spreadsheet formula injection: a cell starting with = + - @ (or tab/CR)
  // is evaluated as a formula by Excel/Sheets even inside quotes, so prefix a literal
  // apostrophe before RFC-quoting. Skip plain signed numbers (e.g. "-100000.00") so
  // negative money/percent cells stay numeric rather than becoming text; the match is
  // anchored end to end so free text merely opening with "-<digit>" is still guarded.
  // Importers strip leading whitespace before evaluating a cell, so the trigger is
  // also tested behind optional leading whitespace. `\s` is the full ECMAScript
  // WhiteSpace set (space, tab, CR, LF, VT, FF, NBSP, BOM, U+2028...), which closes
  // that whole family at once: do NOT narrow it to an ASCII-only strip. The bare
  // class is kept alongside it so a leading tab/CR is still guarded when what follows
  // is not itself a trigger. Both tests are regexes, which coerce, so the one
  // non-string a cell can actually be (an undefined label lookup) degrades to an
  // empty cell instead of aborting the export. Other non-string shapes are NOT
  // supported: they would still throw on .replace below.
  const isPlainNumber = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
  const opensFormula = /^[=+\-@\t\r]/.test(value) || /^\s*[=+\-@]/.test(value);
  const guarded = !isPlainNumber && opensFormula ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function moneyCell(cents: number | null): string {
  // Full rubles with 2 decimals; dot decimal so spreadsheets parse it as a number.
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function pctCell(value: number | null): string {
  return value == null ? "" : value.toFixed(1);
}

interface CsvLabels {
  columns: {
    title: string;
    status: string;
    contract: string;
    cost: string;
    marginAmount: string;
    marginPct: string;
    spent: string;
    progressPct: string;
    toBePaid: string;
    risks: string;
  };
  status: Record<PortfolioProjectRow["status"], string>;
  risk: Record<"overspend" | "behind" | "thin_margin", string>;
}

function rowFor(project: PortfolioProjectRow, labels: CsvLabels): string {
  const cells = [
    project.title,
    labels.status[project.status],
    moneyCell(project.contractValueCents),
    moneyCell(project.costCents),
    moneyCell(project.marginCents),
    pctCell(project.marginPct),
    moneyCell(project.spentCents),
    pctCell(project.percentComplete),
    moneyCell(project.toBePaidCents),
    project.riskFlags.map((flag) => labels.risk[flag]).join("; "),
  ];
  return cells.map((cell) => escapeCsv(cell)).join(",");
}

/** Build a UTF-8 BOM CSV string for the portfolio (header + one row per project). */
export function buildPortfolioCsv(snapshot: PortfolioFinanceSnapshot, labels: CsvLabels): string {
  const header = [
    labels.columns.title,
    labels.columns.status,
    labels.columns.contract,
    labels.columns.cost,
    labels.columns.marginAmount,
    labels.columns.marginPct,
    labels.columns.spent,
    labels.columns.progressPct,
    labels.columns.toBePaid,
    labels.columns.risks,
  ].map((cell) => escapeCsv(cell)).join(",");

  const lines = snapshot.projects.map((project) => rowFor(project, labels));
  return BOM + [header, ...lines].join("\r\n") + "\r\n";
}

export type { CsvLabels as PortfolioCsvLabels };

/** Trigger a browser download of the CSV. No-op outside the browser. */
export function downloadPortfolioCsv(csv: string, filename: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
