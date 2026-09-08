import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantWelcome } from "@/components/ai/AssistantWelcome";
import { ASSISTANT_TELEGRAM_CHANNEL_URL } from "@/data/assistant-identity";

describe("AssistantWelcome", () => {
  it("greets the user by the assistant's name and states his role", () => {
    render(<AssistantWelcome />);
    expect(screen.getByText("Hi! I'm Shurik")).toBeInTheDocument();
    expect(screen.getByText("AI construction assistant")).toBeInTheDocument();
  });

  it("lists what the assistant can be asked for", () => {
    render(<AssistantWelcome />);
    expect(screen.getByText(/Work out the estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/Draft documents/i)).toBeInTheDocument();
  });

  it("invites the user to the Telegram channel, opened safely in a new tab", () => {
    render(<AssistantWelcome />);
    const link = screen.getByRole("link", { name: /Telegram channel/i });
    expect(link).toHaveAttribute("href", ASSISTANT_TELEGRAM_CHANNEL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    // Without noopener the opened tab keeps a handle on window.opener.
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
