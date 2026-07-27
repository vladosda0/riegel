// rovno #186: profiles.locale must survive a Профиль save that does not mention it.
//
// Профиль stopped sending `locale` when its language selector was removed, which
// is only safe while updateProfileIdentity builds a PARTIAL update. A pre-merge
// review showed the invariant could be broken (`update.locale = patch.locale ?? "en"`)
// with lint, typecheck and all 1615 other tests still green, so nothing was
// guarding the one line every profile save now depends on. If it regresses, every
// save silently resets the user's locale.
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_ROW = {
  id: "u1",
  email: "a@b.co",
  full_name: "Alex Builder",
  avatar_url: null,
  locale: "ru",
  timezone: "Europe/Moscow",
  plan: "free",
  credits_free: 0,
  credits_paid: 0,
};

/** Captures the object handed to .update() on the profiles table. */
let capturedUpdate: Record<string, unknown> | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        update: (payload: Record<string, unknown>) => {
          capturedUpdate = payload;
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({ data: PROFILE_ROW, error: null }),
              }),
            }),
          };
        },
      };
    },
  },
}));

import { getWorkspaceSource } from "@/data/workspace-source";

async function identitySource() {
  return getWorkspaceSource({ kind: "supabase", profileId: "u1" });
}

describe("updateProfileIdentity builds a partial update", () => {
  beforeEach(() => {
    capturedUpdate = null;
  });

  it("omits locale entirely when the patch does not carry it", async () => {
    const source = await identitySource();

    await source.updateProfileIdentity({
      fullName: "Alex B",
      avatarUrl: null,
      timezone: "Europe/Moscow",
    });

    expect(capturedUpdate).not.toBeNull();
    // The assertion that matters: absent, not null and not defaulted. A `?? "en"`
    // or `?? null` would satisfy "has a locale key" and reset the column.
    expect(capturedUpdate!).not.toHaveProperty("locale");
    expect(capturedUpdate!).toEqual({
      full_name: "Alex B",
      avatar_url: null,
      timezone: "Europe/Moscow",
    });
  });

  it("still writes locale when it IS supplied", async () => {
    const source = await identitySource();

    await source.updateProfileIdentity({ locale: "en" });

    expect(capturedUpdate).toEqual({ locale: "en" });
  });

  it("writes an explicit null through rather than dropping it", async () => {
    // `undefined` means "leave alone"; null is a real value the caller chose.
    const source = await identitySource();

    await source.updateProfileIdentity({ fullName: null });

    expect(capturedUpdate).toEqual({ full_name: null });
  });
});
