import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const currentUser = {
  id: "u1",
  email: "a@b.co",
  name: "Alex Builder",
  avatar: undefined as string | undefined,
  locale: "en",
  timezone: "Europe/Moscow",
  plan: "free" as const,
  credits_free: 0,
  credits_paid: 0,
};
const contactInfo = { roleTitle: "Foreman", phone: "+7900", bio: "Bio text", signatureBlock: "Sig" };
const identityMutate = vi.fn();
const contactMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/hooks/use-mock-data", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/hooks/use-workspace-source", () => ({
  // Authenticated session: Save / avatar edits are enabled (not gated).
  useWorkspaceMode: () => ({ kind: "supabase", profileId: "u1" }),
  useWorkspaceProfileContactInfoState: () => ({ contactInfo, isLoading: false }),
  useUpdateWorkspaceProfileIdentity: () => ({ mutateAsync: identityMutate, isPending: false }),
  useUpdateWorkspaceProfileContactInfo: () => ({ mutateAsync: contactMutate, isPending: false }),
}));
vi.mock("@/hooks/use-avatar-upload", () => ({ useAvatarUpload: () => ({ uploadAvatar: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: (args: unknown) => toastMock(args) }));

import { ProfilePanel } from "@/components/settings/panels/ProfilePanel";

describe("ProfilePanel persistence", () => {
  beforeEach(() => {
    identityMutate.mockReset().mockResolvedValue(currentUser);
    contactMutate.mockReset().mockResolvedValue(contactInfo);
    toastMock.mockReset();
  });

  it("seeds fields from loaded identity + contact info", () => {
    render(<ProfilePanel />);
    expect(screen.getByDisplayValue("Alex Builder")).toBeInTheDocument();
    expect(screen.getByDisplayValue("a@b.co")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Foreman")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+7900")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bio text")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sig")).toBeInTheDocument();
  });

  it("saves identity and contact info with mapped values", async () => {
    render(<ProfilePanel />);
    fireEvent.change(screen.getByDisplayValue("Alex Builder"), { target: { value: "Alex B" } });
    fireEvent.change(screen.getByDisplayValue("Foreman"), { target: { value: "Lead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(identityMutate).toHaveBeenCalledTimes(1));
    expect(identityMutate).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Alex B", avatarUrl: null, timezone: "Europe/Moscow" }),
    );
    // `locale` is deliberately ABSENT: the interface language moved to
    // Настройки > Предпочтения (rovno #186) and this is a partial update, so
    // omitting the key leaves the column alone. Sending it from here is what let
    // an unrelated profile save clobber the user's language.
    expect(identityMutate.mock.calls[0][0]).not.toHaveProperty("locale");
    expect(contactMutate).toHaveBeenCalledWith(
      expect.objectContaining({ roleTitle: "Lead", phone: "+7900", bio: "Bio text", signatureBlock: "Sig" }),
    );
  });

  it("shows a failure toast when saving fails", async () => {
    identityMutate.mockRejectedValueOnce(new Error("nope"));
    render(<ProfilePanel />);
    fireEvent.change(screen.getByDisplayValue("Alex Builder"), { target: { value: "Alex C" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't save profile" })),
    );
  });
});
