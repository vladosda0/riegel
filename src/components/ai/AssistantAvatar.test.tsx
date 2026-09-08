import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantAvatar } from "@/components/ai/AssistantAvatar";
import { ASSISTANT_AVATAR_SRC } from "@/data/assistant-identity";

describe("AssistantAvatar", () => {
  it("renders the mascot portrait, labelled with the assistant's name", () => {
    render(<AssistantAvatar />);
    const img = screen.getByRole("img", { name: "Shurik" });
    expect(img).toHaveAttribute("src", ASSISTANT_AVATAR_SRC);
  });

  it("falls back to the generic glyph when the portrait fails to load", () => {
    // The artwork is a hand-dropped file under public/, not a build output, so
    // a branch without it must still render a usable chat row.
    const { container } = render(<AssistantAvatar />);
    fireEvent.error(screen.getByRole("img", { name: "Shurik" }));
    expect(screen.queryByRole("img", { name: "Shurik" })).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("drops the portrait from the a11y tree when a visible name label follows it", () => {
    render(<AssistantAvatar decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
