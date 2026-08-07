import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-workspace-source", () => ({
  useWorkspaceMode: () => ({ kind: "supabase", profileId: "profile-1" }),
}));

const updateItemMutate = vi.fn();
const addItemMutate = vi.fn();

vi.mock("@/hooks/use-user-catalogs", () => ({
  useUserCatalog: vi.fn(),
  useUserCatalogItems: vi.fn(),
  useMatchedArticleNames: () => ({ data: undefined }),
  useRenameUserCatalog: () => ({ mutate: vi.fn() }),
  useDeleteUserCatalog: () => ({ mutate: vi.fn() }),
  useUpdateUserCatalogItem: () => ({ mutate: updateItemMutate }),
  useAddUserCatalogItem: () => ({ mutate: addItemMutate }),
  useDeleteUserCatalogItem: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import UserCatalogPage from "@/pages/catalogs/UserCatalogPage";
import { useUserCatalog, useUserCatalogItems } from "@/hooks/use-user-catalogs";

const mockCatalog = useUserCatalog as unknown as Mock;
const mockItems = useUserCatalogItems as unknown as Mock;

const FLUSH_DELAY_MS = 600;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/home/catalogs/cat-1"]}>
        <Routes>
          <Route path="/home/catalogs/:catalogId" element={<UserCatalogPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UserCatalogPage debounced flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateItemMutate.mockClear();
    addItemMutate.mockClear();
    mockCatalog.mockReturnValue({
      data: { id: "cat-1", name: "Прайс", sourceFilename: null },
      isLoading: false,
      isError: false,
    });
    mockItems.mockReturnValue({
      data: [
        {
          id: "item-1",
          catalogId: "cat-1",
          position: 1,
          name: "Цемент",
          unit: "pcs",
          priceCents: 10000,
          resourceType: "material",
          supplierSku: null,
          matchedArticleId: null,
        },
      ],
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes an edit made inside the debounce window when the page unmounts", () => {
    const { unmount } = renderPage();

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "250" } });
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 100);
    expect(updateItemMutate).not.toHaveBeenCalled();

    unmount();

    expect(updateItemMutate).toHaveBeenCalledTimes(1);
    expect(updateItemMutate.mock.calls[0][0]).toMatchObject({
      itemId: "item-1",
      patch: { priceCents: 25000 },
    });
  });

  it("writes nothing on unmount when no row is dirty", () => {
    const { unmount } = renderPage();

    vi.advanceTimersByTime(FLUSH_DELAY_MS * 2);
    unmount();

    expect(updateItemMutate).not.toHaveBeenCalled();
    expect(addItemMutate).not.toHaveBeenCalled();
  });

  it("leaves a blocking row local on unmount instead of writing it", () => {
    const { unmount } = renderPage();

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "250" } });
    fireEvent.change(screen.getByDisplayValue("Цемент"), { target: { value: "" } });
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 100);

    unmount();

    expect(updateItemMutate).not.toHaveBeenCalled();
  });
});
