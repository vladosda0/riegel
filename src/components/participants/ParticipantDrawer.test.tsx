import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ParticipantDrawer } from "@/components/participants/ParticipantDrawer";
import type { ParticipantRecord } from "@/components/participants/participants-shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const record: ParticipantRecord = {
  target: { kind: "member", userId: "user-2" },
  key: "member:user-2",
  displayName: "Contractor",
  secondaryLabel: "contractor@example.com",
  role: "co_owner",
  aiAccess: "project_pool",
  financeVisibility: "detail",
  internalDocsVisibility: "edit",
  creditLimit: 10,
  isSelf: false,
};

function renderDrawer() {
  return render(
    <ParticipantDrawer
      open
      onOpenChange={() => {}}
      mode={{ kind: "edit", record }}
      actor={{
        role: "owner",
        aiAccess: "project_pool",
        financeVisibility: "detail",
        internalDocsVisibility: "edit",
      }}
      projectMode="contractor"
      seat={{
        editorsUsed: 1,
        editorsPending: 0,
        viewersUsed: 0,
        viewersPending: 0,
        editorsLimit: 10,
        viewersLimit: 10,
      }}
      resendAvailable={false}
      saving={false}
      removing={false}
      revoking={false}
      resending={false}
      onCreate={() => {}}
      onSave={() => {}}
      onRemoveMember={() => {}}
      onRevokeInvite={() => {}}
      onResendInvite={() => {}}
    />,
  );
}

describe("ParticipantDrawer per-member AI request limit", () => {
  it("presents the request limit as not yet available, like the photo and document limits beside it", () => {
    renderDrawer();

    // Nothing reads project_members.credit_limit: the quota gateway meters the
    // member's own subscription. Offering an editable number promises an
    // enforcement that does not exist (rovno#301, option B).
    const input = screen.getByLabelText("participants.drawer.requestsLimit");
    expect(input).toBeDisabled();

    // The three pool limits now read the same way on one screen.
    expect(screen.getAllByText("participants.drawer.soon")).toHaveLength(3);
  });
});
