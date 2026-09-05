import { __unsafeSetRuntimeAuthStateForTests } from "@/hooks/use-runtime-auth";

export function authenticateRuntimeAuth(profileId = "profile-1"): void {
  __unsafeSetRuntimeAuthStateForTests({
    status: "authenticated",
    session: null,
    user: null,
    profileId,
  });
}

export function guestRuntimeAuth(): void {
  __unsafeSetRuntimeAuthStateForTests({
    status: "guest",
    session: null,
    user: null,
    profileId: null,
  });
}

export function loadingRuntimeAuth(): void {
  __unsafeSetRuntimeAuthStateForTests({
    status: "loading",
    session: null,
    user: null,
    profileId: null,
  });
}
