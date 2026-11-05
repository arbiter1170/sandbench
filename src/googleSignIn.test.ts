import type { Auth } from "firebase/auth";
import { describe, expect, it, vi } from "vitest";
import { signInErrorMessage, startGoogleSignIn } from "./googleSignIn";

const auth = {} as Auth;
const fail = (code: string) => Object.assign(new Error(code), { code });

describe("startGoogleSignIn", () => {
  it("uses a popup, not a redirect, when the popup works (the iOS loop fix)", async () => {
    const popup = vi.fn().mockResolvedValue({});
    const redirect = vi.fn();
    await expect(startGoogleSignIn(auth, { popup, redirect })).resolves.toBe("signed_in");
    expect(popup).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("falls back to a redirect only when a popup can't open", async () => {
    for (const code of ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"]) {
      const redirect = vi.fn().mockResolvedValue(undefined);
      await expect(startGoogleSignIn(auth, { popup: vi.fn().mockRejectedValue(fail(code)), redirect })).resolves.toBe("redirecting");
      expect(redirect).toHaveBeenCalledOnce();
    }
  });

  it("treats a closed popup as cancelled, and passes other errors on", async () => {
    const redirect = vi.fn();
    await expect(startGoogleSignIn(auth, { popup: vi.fn().mockRejectedValue(fail("auth/popup-closed-by-user")), redirect })).resolves.toBe("cancelled");
    await expect(startGoogleSignIn(auth, { popup: vi.fn().mockRejectedValue(fail("auth/unauthorized-domain")), redirect })).rejects.toMatchObject({ code: "auth/unauthorized-domain" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("explains common failures in plain words", () => {
    expect(signInErrorMessage(fail("auth/unauthorized-domain"))).toMatch(/authorized domains/);
    expect(signInErrorMessage(fail("auth/internal-error"))).toBe("Sign-in failed (auth/internal-error).");
    expect(signInErrorMessage("x")).toBe("Sign-in failed.");
  });
});
