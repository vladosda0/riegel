// The three project-dashboard widgets navigate on an icon-only control, so its
// aria-label is the whole accessible name a screen reader gets.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DocsWidget } from "@/components/dashboard/DocsWidget";
import { GalleryWidget } from "@/components/dashboard/GalleryWidget";
import { TaskSummaryWidget } from "@/components/dashboard/TaskSummaryWidget";
import i18n from "@/i18n";

async function switchLanguage(lang: string) {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  await switchLanguage("ru");
});

afterEach(async () => {
  await switchLanguage("en");
});

describe("project dashboard widget view-all controls", () => {
  it("names the tasks control in Russian", () => {
    render(
      <MemoryRouter>
        <TaskSummaryWidget tasks={[]} projectId="project-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Все задачи" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^View all/ })).toBeNull();
  });

  it("names the documents control in Russian", () => {
    render(
      <MemoryRouter>
        <DocsWidget documents={[]} projectId="project-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Все документы" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^View all/ })).toBeNull();
  });

  it("names the gallery control in Russian", () => {
    render(
      <MemoryRouter>
        <GalleryWidget media={[]} projectId="project-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Вся галерея" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^View all/ })).toBeNull();
  });
});
