// Portfolio CSV export (spec Part 3 §6 module 6 / P1). Full-precision values, one row
// per project; redacted (non-detail) projects export their non-monetary fields only.

// The formula-injection guard and the quoting rule live in @/lib/csv so this
// exporter and the estimate exporter cannot drift apart again (rovno #195).
import { buildCsvRow, CSV_BOM } from "@/lib/csv";
import type { PortfolioFinanceSnapshot, PortfolioProjectRow } from "@/lib/finance/portfolio-read-model";

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
  return buildCsvRow(cells);
}

/** Build a UTF-8 BOM CSV string for the portfolio (header + one row per project). */
export function buildPortfolioCsv(snapshot: PortfolioFinanceSnapshot, labels: CsvLabels): string {
  const header = buildCsvRow([
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
  ]);

  const lines = snapshot.projects.map((project) => rowFor(project, labels));
  return CSV_BOM + [header, ...lines].join("\r\n") + "\r\n";
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
