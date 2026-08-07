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

  // Disabling the controls is not enough on its own: `title` cannot surface on either control.
  // Button's base class carries `disabled:pointer-events-none` so it never receives hover, and
  // Chromium does not fire hover on a disabled input either. The visible badge is the only thing
  // that tells the user why the controls are greyed, which is the same "nothing tells them" gap
  // #291 was filed about.
  it("shows a visible «coming soon» badge in supabase mode, not just an unreachable title", () => {
    renderDetail();

    const urlInput = screen.getByPlaceholderText("Paste a link to receipt/invoice (PDF, Drive, etc.)");
    const addFileButton = screen.getByRole("button", { name: "Add file" });
    const badge = screen.getByText("Coming soon");

    expect(addFileButton).toBeDisabled();
    expect(badge).toBeVisible();
    // The badge must sit beside the controls it explains, not somewhere else on the page.
    expect(addFileButton.parentElement).toContainElement(badge);
    // A disabled control is out of the tab order, so the association is the only route assistive
    // tech has to the badge. Without these two assertions both aria-describedby attributes can be
    // deleted with the suite still green (measured).
    expect(urlInput).toHaveAttribute("aria-describedby", badge.id);
    expect(addFileButton).toHaveAttribute("aria-describedby", badge.id);
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
  // nothing a user can do reaches them. Before this test existed, deleting
  // `if (isSupabaseMode) return;` from ANY of the three left the whole suite green; the test below
  // now covers addUrlAttachment.
  //
  // Why only that one, measured rather than assumed. react-dom's `shouldPreventMouseEvent` drops
  // `onClick` when the fiber's PROPS carry `disabled` on an interactive element, and
  // `removeAttribute("disabled")` mutates the DOM node, not the props. So a handler exposed only
  // through onClick — which is exactly removeAttachment's Remove button — cannot be driven from a
  // test while the control is props-disabled. `onChange` and `onKeyDown` are not covered by that
  // switch and dispatch normally, which is why the URL input below is reachable. Both halves were
  // verified by instrumented probe, not read off the source.
  //
  // Deliberately NOT enumerating the rest of that switch here. It is a private React implementation
  // detail, nothing below depends on which other names it covers, and two attempts at spelling the
  // list out were both wrong (one too narrow, one inventing a handler name that does not exist).
  // If you need the full set, read it from react-dom rather than from this comment.
  //
  // A "removeAttachment refuses" test was written this way, measured to pass with the guard
  // DELETED, and removed again rather than shipped: an inert test reports coverage that does not
  // exist. An earlier version of this comment blamed the mocked items hook re-seeding editForm.
  // That was wrong and is corrected here: the seed effect early-returns on
  // `initializedDetailIdRef.current === detailItem.id`, the mock always returns the same id, and a
  // stable-identity mock changes nothing — removeAttachment is simply never invoked.
  //
  // So these two guards are knowingly uncovered, and the gap is recorded rather than papered over:
  //   - removeAttachment    — onClick only, see above; needs the handler extracted to a pure module
  //   - addLocalAttachments — driven by a hidden file input; needs a DataTransfer fixture
  // Tracked in rovno#298.
  it("addUrlAttachment refuses in supabase mode even when its keyboard path is driven directly", () => {
    renderDetail();

    const urlInput = screen.getByPlaceholderText("Paste a link to receipt/invoice (PDF, Drive, etc.)");
    fireEvent.change(urlInput, { target: { value: "https://example.com/added.pdf" } });
    fireEvent.keyDown(urlInput, { key: "Enter" });

    // The guard returned early, so no attachment row was created. Match the FULL url: addUrlAttachment
    // stores `name: url` and attachmentDisplayName renders it verbatim, so a "added.pdf" matcher
    // never matches whether the row exists or not, and the assertion would be inert.
    expect(screen.queryByText("https://example.com/added.pdf")).toBeNull();
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
