import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentShareDialog } from "@/components/documents/DocumentShareDialog";

const { mockCreate, mockRevoke, mockToast } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRevoke: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/hooks/use-document-shares", () => ({
  useDocumentShareMutations: () => ({
    create: { mutateAsync: mockCreate, isPending: false },
    revoke: { mutateAsync: mockRevoke, isPending: false },
  }),
}));

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";

function renderDialog(overrides: Partial<Parameters<typeof DocumentShareDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "project-1",
    document: { id: "doc-1", title: "Договор №5", visibilityClass: "shared_project" as const },
    existingShare: null,
    canChangeVisibility: true,
    onMakeShared: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<DocumentShareDialog {...props} />), props };
}

describe("DocumentShareDialog", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate.mockReset();
    mockRevoke.mockReset();
    mockToast.mockReset();
    mockCreate.mockResolvedValue({ documentId: "doc-1", shareToken: TOKEN, createdAt: "2026-09-08T00:00:00Z" });
    mockRevoke.mockResolvedValue(true);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints the link on open for a shared document and copies it", async () => {
    renderDialog();

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("doc-1"));
    const input = await screen.findByLabelText("Link");
    expect((input as HTMLInputElement).value).toBe(`${window.location.origin}/share/document/${TOKEN}`);
    expect(screen.getByText("Anyone with the link can download the file without signing in.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/document/${TOKEN}`));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" }));
  });

  it("reuses a known active share instead of asking the backend again", async () => {
    renderDialog({ existingShare: { documentId: "doc-1", shareToken: TOKEN, createdAt: "2026-09-08T00:00:00Z" } });

    const input = await screen.findByLabelText("Link");
    expect((input as HTMLInputElement).value).toContain(TOKEN);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("revokes after confirmation and closes", async () => {
    const { props } = renderDialog();
    await screen.findByLabelText("Link");

    fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
    // The confirm dialog's action carries the same label; it is the last one.
    const buttons = await screen.findAllByRole("button", { name: "Revoke link" });
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("doc-1"));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Public link revoked" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the backend's reason when minting fails", async () => {
    mockCreate.mockRejectedValue(new Error("only project owners or co-owners can share a document"));
    renderDialog();

    expect(await screen.findByText("only project owners or co-owners can share a document")).toBeInTheDocument();
    expect(screen.queryByLabelText("Link")).not.toBeInTheDocument();
  });

  it("explains that an internal document has no link and offers to make it shared first", async () => {
    const { props } = renderDialog({
      document: { id: "doc-2", title: "Internal memo", visibilityClass: "internal" },
    });

    expect(screen.getByTestId("document-share-internal-warning")).toHaveTextContent(
      "Internal documents cannot be shared.",
    );
    expect(mockCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Make Shared and share" }));
    expect(await screen.findByText("Make the document shared?")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });

    await waitFor(() => expect(props.onMakeShared).toHaveBeenCalledWith("doc-2"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("doc-2"));
    expect(await screen.findByLabelText("Link")).toBeInTheDocument();
  });

  it("mints exactly once when the parent flips the class, as ProjectDocuments does", async () => {
    // The parent updates visibilityClass as soon as onMakeShared resolves,
    // which re-runs the dialog's mount effect with isInternal false. Before the
    // in-flight claim that produced TWO concurrent create_document_share calls,
    // and the loser could hit the active-share unique index.
    function Harness() {
      const [visibilityClass, setVisibilityClass] = useState<"internal" | "shared_project">("internal");
      return (
        <DocumentShareDialog
          open
          onOpenChange={vi.fn()}
          projectId="project-1"
          document={{ id: "doc-2", title: "Internal memo", visibilityClass }}
          existingShare={null}
          canChangeVisibility
          onMakeShared={async () => {
            setVisibilityClass("shared_project");
          }}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Make Shared and share" }));
    expect(await screen.findByText("Make the document shared?")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });

    expect(await screen.findByLabelText("Link")).toBeInTheDocument();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("does not silently mint a replacement when the known share disappears", async () => {
    // A co-owner revoking the token elsewhere empties the cache while this
    // dialog is open. Re-minting there publishes a live link nobody asked for.
    const share = { documentId: "doc-1", shareToken: TOKEN, createdAt: "2026-09-08T00:00:00Z" };
    const { rerender } = render(
      <DocumentShareDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        document={{ id: "doc-1", title: "Договор №5", visibilityClass: "shared_project" }}
        existingShare={share}
        canChangeVisibility
        onMakeShared={vi.fn()}
      />,
    );

    expect(await screen.findByLabelText("Link")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();

    rerender(
      <DocumentShareDialog
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        document={{ id: "doc-1", title: "Договор №5", visibilityClass: "shared_project" }}
        existingShare={null}
        canChangeVisibility
        onMakeShared={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockCreate).not.toHaveBeenCalled());
    // ...and it must not keep showing the dead link either.
    expect(await screen.findByText(/was revoked/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Link")).toBeNull();

    // The copy tells the user to create a new one, so that control must exist
    // and must mint exactly once.
    fireEvent.click(screen.getByRole("button", { name: "Create a new link" }));

    expect(await screen.findByLabelText("Link")).toBeInTheDocument();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith("doc-1");
  });

  it("hides the make-shared action from a member who cannot reclassify", () => {
    renderDialog({
      document: { id: "doc-2", title: "Internal memo", visibilityClass: "internal" },
      canChangeVisibility: false,
    });

    expect(screen.getByTestId("document-share-internal-warning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make Shared and share" })).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not mint the link when making the document shared fails", async () => {
    const onMakeShared = vi.fn().mockRejectedValue(new Error("Only users with internal-doc visibility can change documents.visibility_class"));
    renderDialog({
      document: { id: "doc-2", title: "Internal memo", visibilityClass: "internal" },
      onMakeShared,
    });

    fireEvent.click(screen.getByRole("button", { name: "Make Shared and share" }));
    await screen.findByText("Make the document shared?");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
    });

    await waitFor(() => expect(onMakeShared).toHaveBeenCalled());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await screen.findByText(/internal-doc visibility/)).toBeInTheDocument();
  });
});
