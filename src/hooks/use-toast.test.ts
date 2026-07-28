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

  it("suppresses a duplicate of a toast that is still on screen", () => {
    // Raising TOAST_LIMIT removed the accidental protection the old limit of 1
    // gave to `toast()` calls inside a loop, where a per-item error handler
    // overwrote itself. Without dedup, dropping N images against a failing
    // upload stacks N identical destructive toasts.
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Не удалось загрузить изображение", variant: "destructive" });
      result.current.toast({ title: "Не удалось загрузить изображение", variant: "destructive" });
      result.current.toast({ title: "Не удалось загрузить изображение", variant: "destructive" });
    });

    const matching = result.current.toasts.filter(
      (entry) => entry.title === "Не удалось загрузить изображение",
    );
    expect(matching).toHaveLength(1);
  });

  it("still shows two DIFFERENT messages, which is what the limit was raised for", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Не получится применить к смете", variant: "destructive" });
      result.current.toast({ title: "Не получится добавить в снабжение", variant: "destructive" });
    });

    const titles = result.current.toasts.map((entry) => entry.title);
    expect(titles).toContain("Не получится применить к смете");
    expect(titles).toContain("Не получится добавить в снабжение");
  });

  it("does not suppress a repeat once the earlier toast has closed", () => {
    // A closed toast is a finished event. A repeated user action must still give
    // feedback, so dedup is scoped to toasts that are still open.
    const { result } = renderHook(() => useToast());

    let handle: { id: string; dismiss: () => void };
    act(() => {
      handle = result.current.toast({ title: "Скопировано" });
    });
    act(() => {
      handle!.dismiss();
    });
    act(() => {
      result.current.toast({ title: "Скопировано" });
    });

    const open = result.current.toasts.filter((entry) => entry.title === "Скопировано" && entry.open);
    expect(open).toHaveLength(1);
  });

  it("never suppresses a toast carrying an action", () => {
    // Those are interactive (the Undo affordance), and the caller holds the
    // returned dismiss handle. Hiding one would hide a control.
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Этапы применены", action: { type: "div" } as never });
      result.current.toast({ title: "Этапы применены", action: { type: "div" } as never });
    });

    const matching = result.current.toasts.filter((entry) => entry.title === "Этапы применены");
    expect(matching).toHaveLength(2);
  });
});
