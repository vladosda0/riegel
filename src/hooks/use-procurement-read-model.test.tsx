import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProcurementReadProjectSummary } from "@/hooks/use-procurement-read-model";
import type { InventoryLocation, OrderWithLines, ProcurementItemV2 } from "@/types/entities";

const mocks = vi.hoisted(() => ({
  useWorkspaceMode: vi.fn(),
  useProject: vi.fn(),
  useProjectProcurementItemsState: vi.fn(),
  useOrders: vi.fn(),
  useLocations: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: mocks.useWorkspaceMode,
}));

vi.mock("@/hooks/use-mock-data", () => ({
  useProject: mocks.useProject,
}));

vi.mock("@/hooks/use-procurement-source", () => ({
  useProjectProcurementItemsState: mocks.useProjectProcurementItemsState,
}));

vi.mock("@/hooks/use-order-data", () => ({
  useOrders: mocks.useOrders,
}));

vi.mock("@/hooks/use-inventory-data", () => ({
  useLocations: mocks.useLocations,
}));

// The browser-store path stays inert: these subscriptions are what the cross-project snapshot
// hangs off, and every store is empty in a unit test, which is exactly the production shape in
// Supabase mode (see #215).
vi.mock("@/data/store", () => ({
  subscribe: () => () => {},
  getProjects: () => [],
}));
vi.mock("@/data/procurement-store", () => ({
  subscribeProcurement: () => () => {},
  getAllProcurementItemsV2: () => [],
}));
vi.mock("@/data/order-store", () => ({
  subscribeOrders: () => () => {},
  listOrdersByProject: () => [],
}));
vi.mock("@/data/inventory-store", () => ({
  subscribeInventory: () => () => {},
  listLocations: () => [],
  listStockByProject: () => [],
}));

vi.mock("@/hooks/use-home-sensitive-detail-map", () => ({
  useWorkspaceProjectsSensitiveDetailMap: () => ({
    canViewSensitiveDetailByProjectId: new Map<string, boolean>(),
    isLoading: false,
  }),
}));

const PROJECT_ID = "project-1";

function buildItem(overrides: Partial<ProcurementItemV2> = {}): ProcurementItemV2 {
  return {
    id: "item-1",
    projectId: PROJECT_ID,
    stageId: null,
    categoryId: null,
    type: "material",
    name: "Анкерные болты 16 мм",
    spec: null,
    unit: "pcs",
    requiredByDate: null,
    requiredQty: 10,
    orderedQty: 0,
    receivedQty: 0,
    plannedUnitPrice: 100,
    actualUnitPrice: 120,
    supplier: null,
    supplierPreferred: null,
    locationPreferredId: null,
    lockedFromEstimate: false,
    sourceEstimateItemId: null,
    sourceEstimateV2LineId: null,
    orphaned: false,
    orphanedAt: null,
    orphanedReason: null,
    linkUrl: null,
    notes: null,
    attachments: [],
    createdFrom: "manual",
    linkedTaskIds: [],
    archived: false,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  } satisfies ProcurementItemV2;
}

const LOCATIONS = [
  { id: "loc-site", projectId: PROJECT_ID, name: "Site", isDefault: true },
] as unknown as InventoryLocation[];

describe("useProcurementReadProjectSummary", () => {
  beforeEach(() => {
    mocks.useProject.mockReturnValue({
      project: { id: PROJECT_ID, title: "QA-20260723-sync" },
      stages: [],
      members: [],
    });
    mocks.useProjectProcurementItemsState.mockReturnValue({ items: [], isLoading: false });
    mocks.useOrders.mockReturnValue([] as OrderWithLines[]);
    mocks.useLocations.mockReturnValue(LOCATIONS);
  });

  it("builds the summary from the Supabase sources instead of the empty browser store", () => {
    // The defect in #215: every input came from the browser stores, which nothing hydrates in
    // Supabase mode, so this hook returned null for a project that demonstrably has items and
    // the AI sidebar carried no procurement context at all, silently.
    mocks.useWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "profile-9" });
    mocks.useProjectProcurementItemsState.mockReturnValue({
      items: [buildItem()],
      isLoading: false,
    });

    const { result } = renderHook(() => useProcurementReadProjectSummary(PROJECT_ID));

    expect(result.current).not.toBeNull();
    expect(result.current?.projectId).toBe(PROJECT_ID);
    expect(result.current?.projectTitle).toBe("QA-20260723-sync");
    expect(result.current?.totalCount).toBe(1);
    expect(result.current?.rows[0]).toMatchObject({
      name: "Анкерные болты 16 мм",
      requiredQty: 10,
      remainingQty: 10,
      status: "requested",
    });
  });

  it("returns null when the project genuinely has no live procurement items", () => {
    // Distinguishes "nothing here" from the #215 failure, which looked identical to a caller.
    mocks.useWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "profile-9" });
    mocks.useProjectProcurementItemsState.mockReturnValue({ items: [], isLoading: false });

    const { result } = renderHook(() => useProcurementReadProjectSummary(PROJECT_ID));

    expect(result.current).toBeNull();
  });

  it("ignores archived items, matching the cross-project snapshot", () => {
    mocks.useWorkspaceMode.mockReturnValue({ kind: "supabase", profileId: "profile-9" });
    mocks.useProjectProcurementItemsState.mockReturnValue({
      items: [buildItem({ id: "item-archived", archived: true })],
      isLoading: false,
    });

    const { result } = renderHook(() => useProcurementReadProjectSummary(PROJECT_ID));

    expect(result.current).toBeNull();
  });

  // This test was deleted once, on the reasoning that it "varies an input the code never reads"
  // and that a mode branch would be caught by the other three anyway. **That reasoning was wrong
  // and the deletion was reverted.** Measured rather than argued this time: import
  // useWorkspaceMode from @/hooks/use-workspace-source (the module this file actually mocks, NOT
  // use-mock-data, whose mock exports only useProject and makes the mutation crash instead of
  // fail) and add `if (mode.kind === "demo") return null;` to the useMemo. With this test present
  // the mutation is killed by exactly one test -- this one. With it absent the other three all
  // PASS, because each of them sets `kind: "supabase"` in its own body, so a demo-only branch is
  // invisible to every one of them.
  //
  // It is true that the hook reads no mode today, and that is precisely the invariant worth
  // pinning: the doc comment on useProcurementReadProjectSummary states "this needs no mode
  // branch of its own", and mode-dependent blindness IS the #215 defect class. The realistic
  // regression is a future reader told "demo is broken" adding exactly that branch.
  //
  // Still NOT proven by this test, and worth being honest about: that demo mode reads the browser
  // stores correctly. The source hooks are mocked, so that path is not exercised here at all; it
  // belongs to those hooks' own tests.
  it("produces the same summary in every workspace mode, i.e. carries no mode branch", () => {
    mocks.useProjectProcurementItemsState.mockReturnValue({
      items: [buildItem()],
      isLoading: false,
    });

    const results = (["demo", "local", "supabase"] as const).map((kind) => {
      mocks.useWorkspaceMode.mockReturnValue(
        kind === "supabase" ? { kind, profileId: "profile-9" } : { kind },
      );
      return renderHook(() => useProcurementReadProjectSummary(PROJECT_ID)).result.current;
    });

    expect(results[0]?.totalCount).toBe(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
