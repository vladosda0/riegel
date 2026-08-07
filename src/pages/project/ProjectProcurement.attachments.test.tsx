import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProjectProcurement from "@/pages/project/ProjectProcurement";
import { diffProcurementItemPatch } from "@/data/procurement-source";
import type { ProcurementItemV2 } from "@/types/entities";

const PROJECT_ID = "project-procurement-attachments";
const ITEM_ID = "procurement-attachments-item";

let workspaceMode: { kind: string; profileId?: string } = { kind: "supabase", profileId: "u1" };
// Lets a test seed the item the page renders. Attachments are always [] on the real supabase read
// paths, so the Remove-button case can only be reached by seeding one here.
let itemOverrides: Partial<ProcurementItemV2> = {};

const SEEDED_ATTACHMENT = {
  id: "att-1",
  url: "https://example.com/receipt.pdf",
  type: "link" as const,
  name: "receipt.pdf",
  isLocal: false,
  createdAt: "2026-08-07T00:00:00.000Z",
};

vi.mock("@/hooks/use-workspace-source", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-workspace-source")>(
    "@/hooks/use-workspace-source",
  );
  return {
    ...actual,
    useWorkspaceMode: () => workspaceMode,
    useWorkspaceCurrentUserState: () => ({
      user: { id: "u1", name: "Owner", email: "owner@example.com" },
      isLoading: false,
    }),
  };
});

vi.mock("@/hooks/use-procurement-source", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-procurement-source")>(
    "@/hooks/use-procurement-source",
  );
  return {
    ...actual,
    useProjectProcurementItemsState: () => ({ items: [buildItem(itemOverrides)], isLoading: false }),
  };
});

vi.mock("@/hooks/use-estimate-v2-data", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-estimate-v2-data")>(
    "@/hooks/use-estimate-v2-data",
  );
  return {
    ...actual,
    useEstimateV2Project: () => ({
      project: { id: PROJECT_ID, estimateStatus: "in_work", projectMode: "contractor", currency: "RUB" },
      stages: [],
      works: [],
      lines: [],
      isLoading: false,
      sync: actual.EMPTY_ESTIMATE_V2_PROJECT_SYNC_STATE,
    }),
    useEstimateV2ProjectSync: () => actual.EMPTY_ESTIMATE_V2_PROJECT_SYNC_STATE,
  };
});

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    usePermission: () => ({
      seam: {
        profileId: "u1",
        project: { id: PROJECT_ID, owner_id: "u1" },
        membership: { role: "owner", finance_visibility: "detail" },
      },
      isLoading: false,
    }),
  };
});

function buildItem(overrides: Partial<ProcurementItemV2> = {}): ProcurementItemV2 {
  return {
    id: ITEM_ID,
    projectId: PROJECT_ID,
    stageId: "stage-1",
    categoryId: null,
    type: "material",
    name: "Cement bags",
    spec: "M500",
    unit: "pcs",
    requiredByDate: null,
    requiredQty: 10,
    orderedQty: 0,
    receivedQty: 0,
    plannedUnitPrice: 100,
    actualUnitPrice: null,
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <MemoryRouter initialEntries={[`/project/${PROJECT_ID}/procurement/${ITEM_ID}`]}>
          <Routes>
            <Route path="/project/:id/procurement/:itemId" element={<ProjectProcurement />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectProcurement attachments", () => {
  beforeEach(() => {
    workspaceMode = { kind: "supabase", profileId: "u1" };
    itemOverrides = {};
  });

  it("disables the attachment controls in supabase mode, where nothing it produces is persisted", () => {
    renderDetail();

    const urlInput = screen.getByPlaceholderText("Paste a link to receipt/invoice (PDF, Drive, etc.)");
    const addFileButton = screen.getByRole("button", { name: "Add file" });

    expect(urlInput).toBeDisabled();
    expect(addFileButton).toBeDisabled();
  });

  // Control: the guard must be keyed on supabase mode, not applied unconditionally. A fix that
  // simply disabled the controls everywhere would pass the test above and fail this one.
  it("keeps the attachment controls enabled in local mode, where the draft is persisted", () => {
    workspaceMode = { kind: "local" };
    renderDetail();

    const urlInput = screen.getByPlaceholderText("Paste a link to receipt/invoice (PDF, Drive, etc.)");
    const addFileButton = screen.getByRole("button", { name: "Add file" });

    expect(urlInput).not.toBeDisabled();
    expect(addFileButton).not.toBeDisabled();
  });

  // Control: documents the invariant the UI guard depends on. An attachment-only delta produces an
  // empty patch, which the Save handler reports as success, so the editor must not be able to
  // create that delta in supabase mode.
  it("produces an empty supabase patch for an attachment-only change", () => {
    const original = buildItem();
    const draft = buildItem({
      attachments: [SEEDED_ATTACHMENT],
    });

    expect(diffProcurementItemPatch(original, draft)).toEqual({});
  });

  // Disabling the controls is not enough on its own: `title` cannot surface on a disabled control,
  // because Button's base class carries `disabled:pointer-events-none` and so never receives hover.
  // The visible badge is the only thing that tells the user why the controls are greyed, which is
  // the same "nothing tells them" gap #291 was filed about.
  it("shows a visible «coming soon» badge in supabase mode, not just an unreachable title", () => {
    renderDetail();

    const addFileButton = screen.getByRole("button", { name: "Add file" });
    const badge = screen.getByText("Coming soon");

    expect(addFileButton).toBeDisabled();
    expect(badge).toBeVisible();
    // The badge must sit beside the controls it explains, not somewhere else on the page.
    expect(addFileButton.parentElement).toContainElement(badge);
  });

  // Control: the badge is an explanation for a supabase-only restriction. In local mode the controls
  // work, so an unconditional badge would be a lie.
  it("shows no badge in local mode, where the controls work", () => {
    workspaceMode = { kind: "local" };
    renderDetail();

    expect(screen.getByRole("button", { name: "Add file" })).not.toBeDisabled();
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  // removeAttachment is the third attachments patchEditForm site. It is unreachable in supabase mode
  // today only because both read paths hardcode `attachments: []`, so this test seeds one to prove
  // the guard is on the control rather than on that accident.
  it("disables Remove for an existing attachment in supabase mode", () => {
    itemOverrides = {
      attachments: [SEEDED_ATTACHMENT],
    };
    renderDetail();

    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  // The three handler guards are belt-and-braces behind controls that are already disabled, so
  // nothing a user can do reaches them, and the `disabled` assertions above do not cover them: a
  // mutation run confirmed that deleting `if (isSupabaseMode) return;` from a handler leaves the
  // whole suite green. The test below strips the attribute the UI relies on and drives the handler
  // directly. It is deliberately exercising a state the UI cannot produce today, because that is
  // the state the guards exist for: the day `attachments` gains a read path.
  //
  // Only addUrlAttachment is covered this way, and the reason is measured, not assumed. In supabase
  // mode this harness cannot observe a draft mutation at all: the mocked
  // useProjectProcurementItemsState returns a fresh buildItem() on every render, so detailItem's
  // identity changes constantly and the detail re-seeds editForm, reverting any edit before an
  // assertion can see it. Verified by probe — with the removeAttachment guard DELETED, a
  // forced-enabled Remove click still leaves the row on screen, while the same click in local mode
  // (stable store data, no re-seed) drops it. A "removeAttachment refuses" test written this way
  // therefore passes with or without the guard, which is worse than no test.
  //
  // So these two guards are knowingly uncovered, and the gap is recorded rather than papered over:
  //   - removeAttachment  (1708) — not observable through this harness, see above
  //   - addLocalAttachments (1681) — driven by a hidden file input; needs a DataTransfer fixture
  // Covering them properly means either a stable-identity mock or extracting the three handlers into
  // a pure module. Tracked in rovno#298.
  it("addUrlAttachment refuses in supabase mode even when the control is forced enabled", () => {
    renderDetail();

    const urlInput = screen.getByPlaceholderText("Paste a link to receipt/invoice (PDF, Drive, etc.)");
    urlInput.removeAttribute("disabled");
    fireEvent.change(urlInput, { target: { value: "https://example.com/added.pdf" } });
    fireEvent.keyDown(urlInput, { key: "Enter" });

    // The guard returned early, so no attachment row was created.
    expect(screen.queryByText("added.pdf")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  // Control: the same seeded attachment stays removable in local mode, where the draft persists.
  it("keeps Remove enabled for an existing attachment in local mode", () => {
    workspaceMode = { kind: "local" };
    itemOverrides = {
      attachments: [SEEDED_ATTACHMENT],
    };
    renderDetail();

    expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled();
  });
});
