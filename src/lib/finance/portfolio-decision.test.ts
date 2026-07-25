import { describe, expect, it } from "vitest";
import { computePortfolioVerdict } from "@/lib/finance/portfolio-verdict";
import { computeNewProjectFit } from "@/lib/finance/what-if";
import { buildPortfolioCsv, type PortfolioCsvLabels } from "@/lib/finance/portfolio-export";
import {
  EMPTY_PORTFOLIO_SNAPSHOT,
  type PortfolioFinanceSnapshot,
  type PortfolioProjectRow,
} from "@/lib/finance/portfolio-read-model";

function snapshot(overrides: {
  marginCents?: number;
  contractCents?: number;
  marginPct?: number | null;
  atRiskCount?: number;
  backlogCents?: number;
  avgPercentComplete?: number | null;
  projects?: PortfolioProjectRow[];
}): PortfolioFinanceSnapshot {
  return {
    projects: overrides.projects ?? [],
    totals: {
      ...EMPTY_PORTFOLIO_SNAPSHOT.totals,
      contractValueCents: overrides.contractCents ?? 0,
      marginCents: overrides.marginCents ?? 0,
      marginPct: overrides.marginPct ?? null,
      atRiskCount: overrides.atRiskCount ?? 0,
      avgPercentComplete: overrides.avgPercentComplete ?? null,
    },
    pipeline: {
      ...EMPTY_PORTFOLIO_SNAPSHOT.pipeline,
      inWork: { count: 0, contractValueCents: 0, backlogCents: overrides.backlogCents ?? 0 },
    },
  };
}

function projectRow(overrides: Partial<PortfolioProjectRow> = {}): PortfolioProjectRow {
  return {
    projectId: "p",
    title: "Project",
    status: "in_work",
    financeVisibility: "detail",
    hasEstimate: true,
    contractValueCents: 1_000_000,
    costCents: 800_000,
    marginCents: 200_000,
    marginPct: 20,
    spentCents: 100_000,
    percentSpent: 12.5,
    toBePaidCents: 50_000,
    tasksDone: 1,
    tasksTotal: 4,
    percentComplete: 25,
    plannedStart: null,
    plannedEnd: null,
    scheduleBehindDays: 0,
    riskFlags: [],
    ...overrides,
  };
}

describe("computePortfolioVerdict", () => {
  it("says go when margin clears the target and nothing is at risk", () => {
    const result = computePortfolioVerdict(snapshot({ marginPct: 18, atRiskCount: 0, contractCents: 1_000_000, marginCents: 180_000 }));
    expect(result.verdict).toBe("go");
    expect(result.signals.portfolioMarginPct).toBe(18);
  });

  it("says caution when margin is healthy but a project is at risk", () => {
    expect(computePortfolioVerdict(snapshot({ marginPct: 20, atRiskCount: 1 })).verdict).toBe("caution");
  });

  it("says caution in the mid band (target > margin >= minimum)", () => {
    expect(computePortfolioVerdict(snapshot({ marginPct: 11, atRiskCount: 0 })).verdict).toBe("caution");
  });

  it("says no when margin is below the minimum", () => {
    expect(computePortfolioVerdict(snapshot({ marginPct: 5, atRiskCount: 0 })).verdict).toBe("no");
  });

  it("says caution when the margin signal is unknown", () => {
    expect(computePortfolioVerdict(snapshot({ marginPct: null })).verdict).toBe("caution");
  });
});

describe("computeNewProjectFit", () => {
  const base = snapshot({ contractCents: 10_000_000, marginCents: 2_000_000, marginPct: 20, atRiskCount: 0 });

  it("derives cost from margin % and blends into the portfolio margin", () => {
    const fit = computeNewProjectFit(base, { contractCents: 2_000_000, marginPct: 10 });
    expect(fit.newCostCents).toBe(1_800_000);
    expect(fit.newMarginCents).toBe(200_000);
    // (2 000 000 + 200 000) / (10 000 000 + 2 000 000) = 18.33%
    expect(fit.newPortfolioMarginPct).toBeCloseTo(18.33, 1);
    expect(fit.addedBacklogCents).toBe(2_000_000);
  });

  it("prefers an explicit cost over the margin input", () => {
    const fit = computeNewProjectFit(base, { contractCents: 1_000_000, costCents: 900_000, marginPct: 50 });
    expect(fit.newCostCents).toBe(900_000);
    expect(fit.newMarginCents).toBe(100_000);
  });

  it("drops the portfolio verdict to no when the new project is thin enough", () => {
    // A huge low-margin project drags portfolio margin under the minimum.
    const fit = computeNewProjectFit(base, { contractCents: 100_000_000, marginPct: 1 });
    expect(fit.verdict).toBe("no");
  });

  it("counts date-overlapping active projects and reports the date basis", () => {
    const dated = snapshot({
      contractCents: 0,
      projects: [
        projectRow({ projectId: "a", status: "in_work", plannedStart: "2026-06-01", plannedEnd: "2026-08-01" }),
        projectRow({ projectId: "b", status: "in_work", plannedStart: "2026-09-01", plannedEnd: "2026-10-01" }),
        projectRow({ projectId: "c", status: "finished", plannedStart: "2026-06-01", plannedEnd: "2026-08-01" }),
      ],
    });
    const fit = computeNewProjectFit(dated, { contractCents: 1_000_000, marginPct: 20, startDate: "2026-07-01", durationDays: 30 });
    expect(fit.overlapFromDates).toBe(true);
    expect(fit.overlappingActiveCount).toBe(1); // only project "a" overlaps July; "c" is finished
  });

  it("counts the new project's own thin/negative margin toward the at-risk gate", () => {
    const healthy = snapshot({ contractCents: 100_000_000, marginCents: 30_000_000, marginPct: 30, atRiskCount: 0 });
    // Small loss-making project: blended margin stays well above target, but the new
    // project itself is at risk → must not return "go".
    const fit = computeNewProjectFit(healthy, { contractCents: 2_000_000, costCents: 3_000_000 });
    expect(fit.newMarginCents).toBe(-1_000_000);
    expect(fit.newPortfolioMarginPct).toBeGreaterThan(15);
    expect(fit.verdict).not.toBe("go");
  });

  it("falls back to the active-project count when dates are missing", () => {
    const undated = snapshot({
      contractCents: 0,
      projects: [
        projectRow({ projectId: "a", status: "in_work" }),
        projectRow({ projectId: "b", status: "paused" }),
        projectRow({ projectId: "c", status: "planning" }),
      ],
    });
    const fit = computeNewProjectFit(undated, { contractCents: 1_000_000, marginPct: 20 });
    expect(fit.overlapFromDates).toBe(false);
    expect(fit.overlappingActiveCount).toBe(2); // in_work + paused
  });
});

describe("buildPortfolioCsv", () => {
  const labels: PortfolioCsvLabels = {
    columns: {
      title: "Project", status: "Status", contract: "Contract", cost: "Cost",
      marginAmount: "Margin", marginPct: "Margin %", spent: "Spent",
      progressPct: "Progress %", toBePaid: "To be paid", risks: "Risks",
    },
    status: { planning: "Planning", in_work: "In work", paused: "Paused", finished: "Finished" },
    risk: { overspend: "Overspend", behind: "Behind", thin_margin: "Thin margin" },
  };

  it("writes a BOM header and full-precision rows, escaping commas", () => {
    const snap = snapshot({
      projects: [
        projectRow({ title: "Берёзки, дом 1", contractValueCents: 464_947_480, marginCents: 27_255_480, marginPct: 5.9, riskFlags: ["overspend"] }),
      ],
    });
    const csv = buildPortfolioCsv(snap, labels);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Project,Status,Contract");
    expect(csv).toContain('"Берёзки, дом 1"'); // comma in title is quoted
    expect(csv).toContain("4649474.80"); // contract in rubles, 2dp
    expect(csv).toContain("Overspend");
  });

  it("neutralizes spreadsheet formula injection in project titles", () => {
    const snap = snapshot({
      projects: [projectRow({ title: "=HYPERLINK(\"http://evil\",\"x\")" })],
    });
    const csv = buildPortfolioCsv(snap, labels);
    // Leading "=" is prefixed with an apostrophe, then RFC-quoted (it contains a comma).
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).not.toContain("\n=HYPERLINK");
  });

  // Built by code point so the table below carries no literal control characters.
  const TAB = String.fromCharCode(9);
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const VT = String.fromCharCode(11);
  const FF = String.fromCharCode(12);
  const NBSP = String.fromCharCode(160);
  const BOM_CHAR = String.fromCharCode(65279);

  /** First CSV field of a row, unquoted, so the assertion is not coupled to quoting. */
  const firstCell = (row: string): string => {
    if (!row.startsWith('"')) return row.split(",")[0];
    let out = "";
    for (let i = 1; i < row.length; i += 1) {
      if (row[i] === '"') {
        if (row[i + 1] === '"') { out += '"'; i += 1; continue; }
        break;
      }
      out += row[i];
    }
    return out;
  };

  it.each([
    ["equals", "=1+1"],
    ["plus", "+1+1"],
    ["at", "@SUM(1)"],
    ["tab", `${TAB}=1+1`],
    ["carriage return", `${CR}=1+1`],
    ["line feed", `${LF}=1+1`],
    ["leading space", " =1+1"],
    // The strip is the full ECMAScript WhiteSpace set, not just space/tab/CR/LF.
    // A leading NBSP is a routine artifact of a title pasted from Word or a web page.
    ["vertical tab", `${VT}=1+1`],
    ["form feed", `${FF}=1+1`],
    ["non-breaking space", `${NBSP}=1+1`],
    ["byte order mark", `${BOM_CHAR}=1+1`],
    ["comma inside the payload", "=SUM(1,2)"],
    // A bare TAB or CR is guarded even when what follows is not a formula, because
    // an importer that strips it would expose whatever comes next. These two are the
    // only rows that exercise the bare trigger class on its own.
    ["bare tab, non-formula tail", `${TAB}Hello`],
    ["bare carriage return, non-formula tail", `${CR}Hello`],
    // The numeric exemption must not swallow free text that merely opens with "-<digit>".
    ["negative-number lookalike", "-1+cmd|' /C calc'!A0"],
  ])("apostrophe-guards a formula-trigger title (%s)", (_label, title) => {
    const snap = snapshot({ projects: [projectRow({ title })] });
    const csv = buildPortfolioCsv(snap, labels);
    // Everything after the header terminator is the single data row; a title may
    // itself contain CR/LF, so do not split the body on line breaks.
    const body = csv.slice(csv.indexOf("\r\n") + 2);
    expect(firstCell(body)).toBe(`'${title}`);
  });

  it("renders an empty cell when a status label lookup misses", () => {
    // A status outside the union makes labels.status[...] undefined. That one cell
    // must degrade to empty rather than aborting the whole export, and the row must
    // keep its field count so the CSV stays parseable.
    const snap = snapshot({ projects: [projectRow({ title: "Ok" })] });
    (snap.projects[0] as unknown as { status: string }).status = "archived";
    let csv = "";
    expect(() => { csv = buildPortfolioCsv(snap, labels); }).not.toThrow();
    const body = csv.slice(csv.indexOf("\r\n") + 2);
    expect(body.trim().split(",")).toHaveLength(10);
    expect(body.startsWith("Ok,,")).toBe(true);
  });

  it("keeps exponential-notation money numeric (toFixed emits it past 1e21)", () => {
    // toFixed switches to exponential once the ruble value reaches 1e21, and a
    // spreadsheet still reads "-1e+22" as a number, so the exemption must cover it
    // or a huge money cell silently becomes apostrophe-prefixed text.
    const snap = snapshot({ projects: [projectRow({ title: "Huge", marginCents: -1e24 })] });
    const csv = buildPortfolioCsv(snap, labels);
    expect(csv).toContain("-1e+22");
    expect(csv).not.toContain("'-1e+22");
  });

  it("keeps negative money cells numeric (not apostrophe-guarded as a formula)", () => {
    const snap = snapshot({
      projects: [projectRow({ title: "Loss maker", marginCents: -100_000, marginPct: -20, toBePaidCents: -5_000 })],
    });
    const csv = buildPortfolioCsv(snap, labels);
    const dataLine = csv.trim().split("\r\n")[1];
    // Negative values stay as plain signed decimals, never "'-...".
    expect(dataLine).toContain("-1000.00");
    expect(dataLine).toContain("-20.0");
    expect(dataLine).not.toContain("'-");
  });

  it("leaves money cells empty for redacted projects", () => {
    const snap = snapshot({
      projects: [projectRow({ title: "Hidden", financeVisibility: "none", contractValueCents: null, costCents: null, marginCents: null, marginPct: null, spentCents: null, percentSpent: null, toBePaidCents: null })],
    });
    const csv = buildPortfolioCsv(snap, labels);
    const dataLine = csv.trim().split("\r\n")[1];
    expect(dataLine).toBe("Hidden,In work,,,,,,25.0,,");
  });
});
