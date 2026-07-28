import * as React from "react";

import type { ToastActionElement, ToastProps } from "@/components/ui/toast";

// Raised from the stock shadcn value of 1. With 1, `[new, ...state].slice(0, 1)`
// evicts the previous toast the instant a second one is dispatched, so two
// messages raised in the same tick left the user seeing only the last. That is
// reachable whenever an AI proposal queue holds more than one unavailable type
// (rovno #224): each fast-fail dispatches its own specific toast, and every one
// but the last was silently discarded.
//
// Toasts still auto-close on the Radix default duration, and TOAST_REMOVE_DELAY
// only governs how long an already-closed entry lingers in the array, so a
// higher limit stacks a few simultaneously visible toasts rather than letting
// them accumulate on screen.
const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 1000000;

type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType["ADD_TOAST"];
      toast: ToasterToast;
    }
  | {
      type: ActionType["UPDATE_TOAST"];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType["DISMISS_TOAST"];
      toastId?: ToasterToast["id"];
    }
  | {
      type: ActionType["REMOVE_TOAST"];
      toastId?: ToasterToast["id"];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST": {
      // Suppress a toast that duplicates one already ON SCREEN. Raising
      // TOAST_LIMIT above 1 removed the accidental protection the old limit gave
      // to every `toast()` call inside a loop: a per-item error handler that
      // used to overwrite itself would otherwise stack N identical copies (blog
      // image upload, catalog row flush). Deduping in the reducer keeps that
      // protection regardless of the call site, including ones not written yet.
      //
      // Deliberately narrow, so it suppresses noise and nothing else:
      // - only against toasts still `open`. Once one has closed, an identical
      //   message is a NEW event and must be shown, or a repeated user action
      //   would give no feedback.
      // - never when either toast carries an `action`. Those are interactive
      //   (the Undo affordance in use-apply-template-stages and
      //   use-add-library-work) and suppressing one would hide a control whose
      //   `dismiss` handle the caller is holding.
      // - `title` is a ReactNode, so `===` only matches primitives. An element
      //   title never dedupes, which fails toward showing too much rather than
      //   too little.
      const duplicatesOpenToast = state.toasts.some(
        (existing) =>
          existing.open &&
          !existing.action &&
          !action.toast.action &&
          existing.title === action.toast.title &&
          existing.variant === action.toast.variant,
      );
      if (duplicatesOpenToast) return state;
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, "id">;

function toast({ ...props }: Toast) {
  const id = genId();

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return {
    id: id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { useToast, toast };
