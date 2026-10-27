import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, type Auth, type AuthProvider } from "firebase/auth";

// Sign-in tries a popup first. A redirect hands the result back through the Firebase auth
// domain (<project>.firebaseapp.com), which is a different site from the page; iOS Safari's
// tracking prevention blocks that storage, so the page comes back signed out and loops. A popup
// returns the result to the page directly. The redirect is only the fallback when a popup can't
// open at all.
type SignInOps = {
  popup: (auth: Auth, provider: AuthProvider) => Promise<unknown>;
  redirect: (auth: Auth, provider: AuthProvider) => Promise<unknown>;
};

const POPUP_UNAVAILABLE = new Set(["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"]);
const USER_CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

/** "signed_in", "redirecting" or "cancelled"; any other failure is thrown. */
export async function startGoogleSignIn(
  auth: Auth,
  ops: SignInOps = { popup: signInWithPopup, redirect: signInWithRedirect },
): Promise<"signed_in" | "redirecting" | "cancelled"> {
  const provider = new GoogleAuthProvider();
  try {
    await ops.popup(auth, provider);
    return "signed_in";
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (USER_CANCELLED.has(code)) return "cancelled";
    if (!POPUP_UNAVAILABLE.has(code)) throw error;
  }
  await ops.redirect(auth, provider);
  return "redirecting";
}

/** A short, readable reason for a failed sign-in. */
export function signInErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "auth/unauthorized-domain") return "This address is not on the Firebase project's authorized domains.";
  if (code === "auth/network-request-failed") return "Sign-in could not reach Google. Check the connection and try again.";
  return code ? `Sign-in failed (${code}).` : "Sign-in failed.";
}
