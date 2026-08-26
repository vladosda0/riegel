import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateOrgDialog } from "@/components/orgs/CreateOrgDialog";
import ruLocale from "@/locales/ru.json";
import enLocale from "@/locales/en.json";

// vi.mock factories are hoisted above the imports, so the handles they reference
// must be created with vi.hoisted (also hoisted) rather than module-scope consts.
const { mockCreateOrg, mockSetActiveOrg, mockAddOrgMembersByEmail, mockToast } = vi.hoisted(() => ({
  mockCreateOrg: vi.fn(),
  mockSetActiveOrg: vi.fn(),
  mockAddOrgMembersByEmail: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-orgs", () => ({
  useCreateOrganization: () => ({ mutateAsync: mockCreateOrg, isPending: false }),
  useSetActiveOrg: () => ({ mutateAsync: mockSetActiveOrg, isPending: false }),
}));
vi.mock("@/data/org-source", () => ({
  addOrgMembersByEmail: (...args: unknown[]) => mockAddOrgMembersByEmail(...args),
  suggestOrgSlug: (name: string) => name.toLowerCase(),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (args: unknown) => mockToast(args) }));

/**
 * The membership field can only ever add profiles the caller can already read.
 * `profiles_select` (rovno-db 20260306170000_grants_rls_enablement_and_policies.sql:120-147)
 * exposes the caller's own row, members of projects the caller OWNS, and owners
 * of projects the caller is a member of. Org membership is not one of the
 * branches, and no org-invite table or edge function exists, so an address that
 * does not resolve is simply dropped. These tests pin the copy to that reality.
 */
describe("CreateOrgDialog membership copy", () => {
  beforeEach(() => {
    mockCreateOrg.mockResolvedValue({ id: "org-1" });
    mockSetActiveOrg.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function openDialog() {
    render(<CreateOrgDialog open onOpenChange={() => {}} />);
  }

  async function submit(name: string, emails: string) {
    // [0] is the name Input, [1] the emails Textarea; both expose role "textbox".
    const [nameInput, emailsInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: name } });
    fireEvent.change(emailsInput, { target: { value: emails } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
  }

  function lastToastDescription(): string {
    const calls = mockToast.mock.calls as Array<[{ description?: string }]>;
    const success = calls.map(([arg]) => arg).filter((arg) => typeof arg.description === "string");
    return success[success.length - 1]?.description ?? "";
  }

  it("does not promise that unregistered addresses receive an invitation", () => {
    openDialog();

    const hint = screen.getByText(/comma-separated emails/i).textContent ?? "";

    expect(hint).not.toMatch(/will receive/i);
    expect(hint).toMatch(/not sent/i);
  });

  it("tells the user plainly that unresolved addresses were not added and nothing was sent", async () => {
    mockAddOrgMembersByEmail.mockResolvedValue({
      added: ["mate@example.com"],
      notFound: ["stranger@example.com"],
    });
    openDialog();

    await submit("QA org", "mate@example.com, stranger@example.com");

    const description = lastToastDescription();
    expect(description).toMatch(/not added/i);
    expect(description).not.toMatch(/not found/i);
    expect(description).toMatch(/no email invitations/i);
    // The wiring, not just the template: the dialog used to discard the
    // addresses and pass only a count.
    expect(description).toContain("stranger@example.com");
  });

  it("names every unresolved address, not just the first", async () => {
    mockAddOrgMembersByEmail.mockResolvedValue({
      added: [],
      notFound: ["one@example.com", "two@example.com"],
    });
    openDialog();

    await submit("QA org", "one@example.com, two@example.com");

    const description = lastToastDescription();
    expect(description).toContain("one@example.com");
    expect(description).toContain("two@example.com");
  });

  it("says nothing about invitations when every address resolved", async () => {
    mockAddOrgMembersByEmail.mockResolvedValue({ added: ["mate@example.com"], notFound: [] });
    openDialog();

    await submit("QA org", "mate@example.com");

    const description = lastToastDescription();
    expect(description).toMatch(/added: 1/i);
    expect(description).not.toMatch(/invitation/i);
  });

  // Tests run in English (src/test/setup.ts), so the Russian copy needs its own
  // assertion or it drifts back into promising something that is not built.
  it("keeps the Russian copy free of the same promise", () => {
    const hint = ruLocale["createOrgDialog.invite.hint"];

    expect(hint).not.toMatch(/приглашения отправим/i);
    expect(hint).toMatch(/не отправля/i);
  });

  // profiles_select (rovno-db 20260306170000:120-147) exposes the caller's own
  // row, members of projects the caller OWNS, and owners of projects the caller
  // is a member of. Two plain members of one project cannot see each other, so
  // the hint has to name ownership, not co-membership.
  it.each([
    ["ru", /владелец/, /работает с вами в проекте|есть аккаунт в Ровно\.\s*Кого/],
    ["en", /you own/, /work with you on a project|have a Rovno account\.\s*We will/],
  ] as const)("ties visibility to project ownership (%s)", (language, required, forbidden) => {
    const hint = (language === "ru" ? ruLocale : enLocale)["createOrgDialog.invite.hint"];

    expect(hint).toMatch(required);
    expect(hint).not.toMatch(forbidden);
  });

  // The addresses are in hand (addOrgMembersByEmail returns notFound: string[]),
  // so the partial toast names them instead of counting them.
  it.each(["ru", "en"] as const)("names the addresses that were not added (%s)", (language) => {
    const partial = (language === "ru" ? ruLocale : enLocale)["createOrgDialog.inviteSummaryPartial"];

    expect(partial).toContain("{{notFoundList}}");
    expect(partial).not.toContain("{{notFound}}");
  });
});
