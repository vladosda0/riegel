import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocsWidget } from "@/components/dashboard/DocsWidget";
import type { Document } from "@/types/entities";

function buildDocument(id: string, title: string, origin?: Document["origin"]): Document {
  return {
    id,
    project_id: "project-1",
    type: "contract",
    title,
    origin,
    versions: [{ id: `${id}-v1`, document_id: id, number: 1, status: "active", content: "" }],
  };
}

// Store insertion order is oldest -> newest, and so is the Supabase source
// (documents are selected with created_at ascending).
function renderDocsWidget(documents: Document[]) {
  return render(
    <MemoryRouter>
      <DocsWidget documents={documents} projectId="project-1" />
    </MemoryRouter>,
  );
}

describe("DocsWidget", () => {
  it("shows documents added after a pinned one instead of hiding them", () => {
    renderDocsWidget([
      buildDocument("doc-1", "Contract", "project_creation"),
      buildDocument("doc-2", "Wiring diagram"),
      buildDocument("doc-3", "Uploaded from demo"),
    ]);

    expect(screen.getByText("Contract")).toBeInTheDocument();
    expect(screen.getByText("Wiring diagram")).toBeInTheDocument();
    expect(screen.getByText("Uploaded from demo")).toBeInTheDocument();
  });

  it("keeps the pinned document first and the rest newest-first", () => {
    const { container } = renderDocsWidget([
      buildDocument("doc-1", "Contract", "project_creation"),
      buildDocument("doc-2", "Wiring diagram"),
      buildDocument("doc-3", "Uploaded from demo"),
    ]);

    const titles = Array.from(container.querySelectorAll(".truncate")).map((node) => node.textContent);
    expect(titles).toEqual(["Contract", "Uploaded from demo", "Wiring diagram"]);
  });

  it("badges only the pinned rows", () => {
    renderDocsWidget([
      buildDocument("doc-1", "Contract", "project_creation"),
      buildDocument("doc-2", "Wiring diagram"),
    ]);

    expect(screen.getAllByText("Pinned")).toHaveLength(1);
  });

  it("still caps the preview at four rows", () => {
    const { container } = renderDocsWidget([
      buildDocument("doc-1", "Contract", "project_creation"),
      buildDocument("doc-2", "Second"),
      buildDocument("doc-3", "Third"),
      buildDocument("doc-4", "Fourth"),
      buildDocument("doc-5", "Fifth"),
    ]);

    const titles = Array.from(container.querySelectorAll(".truncate")).map((node) => node.textContent);
    expect(titles).toEqual(["Contract", "Fifth", "Fourth", "Third"]);
  });

  it("shows the newest documents first when nothing is pinned", () => {
    const { container } = renderDocsWidget([
      buildDocument("doc-1", "Oldest"),
      buildDocument("doc-2", "Newest"),
    ]);

    const titles = Array.from(container.querySelectorAll(".truncate")).map((node) => node.textContent);
    expect(titles).toEqual(["Newest", "Oldest"]);
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("shows the empty state when the project has no documents", () => {
    renderDocsWidget([]);
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
  });
});
