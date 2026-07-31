import { beforeEach, describe, expect, it, vi } from "vitest";

const { singleMock } = vi.hoisted(() => ({ singleMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({ single: singleMock }),
      }),
    }),
  },
}));

import {
  createWorkspaceProjectInvite,
  ProjectInviteAlreadyOutstandingError,
} from "@/data/workspace-source";

const SUPABASE_MODE = { kind: "supabase", profileId: "profile-1" } as const;

const INPUT = {
  projectId: "project-1",
  email: "contractor@example.com",
  role: "contractor",
  aiAccess: "consult_only",
  viewerRegime: null,
  creditLimit: 50,
  invitedBy: "profile-1",
} as const;

/**
 * Shape of a PostgREST unique-violation as it actually arrives. The index name
 * lives in `message`, which is what the narrowing reads.
 */
function uniqueViolation(constraint: string) {
  return {
    data: null,
    error: {
      code: "23505",
      message: `duplicate key value violates unique constraint "${constraint}"`,
      details: "Key (project_id, lower(email))=(project-1, contractor@example.com) already exists.",
      hint: null,
    },
  };
}

describe("createWorkspaceProjectInvite conflict handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a typed error when a pending invite for the address already exists", async () => {
    singleMock.mockResolvedValue(uniqueViolation("idx_project_invites_active_email"));

    await expect(createWorkspaceProjectInvite(SUPABASE_MODE, { ...INPUT }))
      .rejects.toBeInstanceOf(ProjectInviteAlreadyOutstandingError);
  });

  it("carries the address so a caller can name it", async () => {
    singleMock.mockResolvedValue(uniqueViolation("idx_project_invites_active_email"));

    const error = await createWorkspaceProjectInvite(SUPABASE_MODE, { ...INPUT })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProjectInviteAlreadyOutstandingError);
    expect((error as ProjectInviteAlreadyOutstandingError).email).toBe("contractor@example.com");
  });

  /**
   * The narrowing that keeps this honest. `project_invites` also carries
   * `unique (invite_token)`; a 23505 from THAT is a gen_random_uuid collision,
   * and telling the user to go revoke an invite would send them chasing a
   * problem they do not have. A bare `code === "23505"` check would.
   */
  it("does NOT claim a conflict for a unique violation on another constraint", async () => {
    singleMock.mockResolvedValue(uniqueViolation("project_invites_invite_token_key"));

    const error = await createWorkspaceProjectInvite(SUPABASE_MODE, { ...INPUT })
      .catch((err: unknown) => err);

    expect(error).not.toBeInstanceOf(ProjectInviteAlreadyOutstandingError);
    expect((error as { code?: string }).code).toBe("23505");
  });

  it("passes any other PostgREST error through untouched", async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "new row violates row-level security policy", details: "", hint: null },
    });

    const error = await createWorkspaceProjectInvite(SUPABASE_MODE, { ...INPUT })
      .catch((err: unknown) => err);

    expect(error).not.toBeInstanceOf(ProjectInviteAlreadyOutstandingError);
    expect((error as { code?: string }).code).toBe("42501");
  });

  it("returns the created row when the insert succeeds", async () => {
    singleMock.mockResolvedValue({ data: { id: "invite-1", email: "contractor@example.com" }, error: null });

    const created = await createWorkspaceProjectInvite(SUPABASE_MODE, { ...INPUT });

    expect(created).toEqual({ id: "invite-1", email: "contractor@example.com" });
  });
});
