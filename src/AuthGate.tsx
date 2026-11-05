import { useEffect, useState, type ReactNode } from "react";
import { getRedirectResult, onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseConfigured, getFirebaseAuth, isEmailAllowed } from "./firebase";
import { signInErrorMessage, startGoogleSignIn } from "./googleSignIn";

type GateState =
  | { status: "loading" }
  | { status: "needs_config" }
  | { status: "signed_out" }
  | { status: "denied"; email: string }
  | { status: "ready"; user: User };

export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [signInError, setSignInError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured()) {
      setState({ status: "needs_config" });
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setState({ status: "needs_config" });
      return;
    }

    let active = true;
    // Only the fallback redirect lands here; show its failure instead of looping silently.
    void getRedirectResult(auth).catch((error) => {
      if (active) setSignInError(signInErrorMessage(error));
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setState({ status: "signed_out" });
        return;
      }
      if (!isEmailAllowed(user.email)) {
        setState({ status: "denied", email: user.email || "unknown" });
        await signOut(auth);
        return;
      }
      setState({ status: "ready", user });
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="auth-gate">
        <p className="auth-title">Sandbench</p>
        <p className="hint">Checking sign-in…</p>
      </div>
    );
  }

  if (state.status === "needs_config") {
    return (
      <div className="auth-gate">
        <p className="auth-title">Sandbench</p>
        <p className="measure">
          Firebase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> (or set Vercel{" "}
          <code>VITE_*</code> env vars) and redeploy. See <code>docs/deploy-vercel.md</code>.
        </p>
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="auth-gate">
        <p className="auth-title">Sandbench</p>
        <p className="measure">
          You signed in as <strong>{state.email}</strong>, but this demo is private. Ask the owner to add your email
          to the allowlist.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const auth = getFirebaseAuth();
            if (auth) void signOut(auth);
            setState({ status: "signed_out" });
          }}
        >
          Try another account
        </button>
      </div>
    );
  }

  if (state.status === "signed_out") {
    return (
      <div className="auth-gate">
        <p className="auth-title">Sandbench</p>
        <p className="measure">Sign in with Google to open this private workspace. Your bots sync to your account.</p>
        <button
          type="button"
          className="primary"
          disabled={signingIn}
          onClick={() => {
            const auth = getFirebaseAuth();
            if (!auth) return;
            setSignInError("");
            setSigningIn(true);
            // Called straight from the tap, so iOS lets the popup open.
            startGoogleSignIn(auth)
              .catch((error) => setSignInError(signInErrorMessage(error)))
              .finally(() => setSigningIn(false));
          }}
        >
          {signingIn ? "Signing in…" : "Continue with Google"}
        </button>
        {signInError && (
          <p className="hint" role="alert">
            {signInError}
          </p>
        )}
      </div>
    );
  }

  return <>{children(state.user)}</>;
}

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const auth = getFirebaseAuth();
        if (auth) void signOut(auth);
      }}
    >
      Sign out
    </button>
  );
}
