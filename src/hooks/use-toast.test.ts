import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useToast } from "@/hooks/use-toast";

/**
 * Pins TOAST_LIMIT against the burst the app's own AI proposal queue produces.
 *
 * The stock shadcn value is 1, and the reducer builds the next state as
 * `[action.toast, ...state.toasts].slice(0, TOAST_LIMIT)`. At 1 that evicts the
 * PREVIOUS toast the instant a second is dispatched, so any code raising several
 * messages in the same tick showed only the last.
 *
 * `runQueueExecution` does exactly that: it dispatches one toast per confirmed
 * queue item, and the fast-fail path breaks before the loop's only `await`, so
 * consecutive fast-fails dispatch with no render between them. Making
 * `add_procurement` fail closed (rovno #224) put two such types in reach of one
 * queue, and a queue can hold up to four items because `createProjectProposals`
 * emits one proposal per intent regex.
 *
 * These tests pin the BEHAVIOUR against that maximum burst rather than the
 * constant, so they keep passing if the limit is raised further and fail if it
 * drops back to a value the queue can overflow.
 */
describe("useToast", () => {
  it("keeps every message of a four-item queue burst", () => {
    // Four is the maximum reachable: createProjectProposals emits at most one
    // add_task, update_estimate, add_procurement and generate_document.
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "add_task" });
      result.current.toast({ title: "update_estimate" });
      result.current.toast({ title: "add_procurement" });
      result.current.toast({ title: "generate_document" });
    });

    const titles = result.current.toasts.map((entry) => entry.title);
    for (const expected of ["add_task", "update_estimate", "add_procurement", "generate_document"]) {
      expect(titles, `lost ${expected}`).toContain(expected);
    }
  });

  it("does not evict the earlier toast when a second one arrives", () => {
    // The minimal case, and the one that regressed first: two fast-failing types
    // in a single queue.
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Не получится применить к смете", variant: "destructive" });
    });
    act(() => {
      result.current.toast({ title: "Не получится добавить в снабжение", variant: "destructive" });
    });

    const titles = result.current.toasts.map((entry) => entry.title);
    expect(titles).toContain("Не получится применить к смете");
    expect(titles).toContain("Не получится добавить в снабжение");
  });
});
