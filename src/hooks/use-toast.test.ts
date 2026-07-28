import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useToast } from "@/hooks/use-toast";

/**
 * Regression for rovno #224's pre-merge audit.
 *
 * The stock shadcn use-toast ships TOAST_LIMIT = 1, and the reducer builds the
 * next state as `[action.toast, ...state.toasts].slice(0, TOAST_LIMIT)`. With a
 * limit of 1 that discards the PREVIOUS toast the moment a second one is
 * dispatched, so any code path raising two messages in the same tick showed only
 * the last one.
 *
 * That path is real: an AI proposal queue can hold more than one type that fails
 * closed (update_estimate and add_procurement), and each dispatches its own
 * specific "not available yet" toast. The user was told about one of them and
 * never learned about the other.
 *
 * These tests pin the behaviour rather than the constant, so they keep working
 * if the limit is raised further, and fail if it goes back to 1.
 */
describe("useToast", () => {
  beforeEach(() => {
    // The toast store is module-level and persists between tests. Dismissing is
    // not enough (dismissed toasts linger in the array until REMOVE_DELAY), so
    // assertions below are written to be independent of leftovers.
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.dismiss();
    });
  });

  it("keeps two toasts dispatched in the same tick", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "estimate unavailable" });
      result.current.toast({ title: "procurement unavailable" });
    });

    const titles = result.current.toasts.map((entry) => entry.title);
    expect(titles).toContain("estimate unavailable");
    expect(titles).toContain("procurement unavailable");
  });

  it("does not evict the earlier toast when a second one arrives", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "first" });
    });
    expect(result.current.toasts.map((e) => e.title)).toContain("first");

    act(() => {
      result.current.toast({ title: "second" });
    });

    // The exact assertion that failed with TOAST_LIMIT = 1: "first" was gone.
    expect(result.current.toasts.map((e) => e.title)).toContain("first");
    expect(result.current.toasts.map((e) => e.title)).toContain("second");
  });
});
