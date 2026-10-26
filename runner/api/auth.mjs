// Every /api request must carry a Firebase ID token for an email on the server-side
// allowlist. The browser allowlist (VITE_ALLOWED_EMAILS) is a convenience only; this is
// the check that counts. No token or a bad token is 401; a valid token for an account
// that is not allowed (or has no verified email) is 403.

export function parseAllowlist(raw) {
  return String(raw || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function createAuth({ verifyIdToken, allowedEmails }) {
  const allowed = new Set(allowedEmails);
  return async function authenticate(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
    if (!match) return { status: 401, error: "Sign in first." };
    let claims;
    try {
      claims = await verifyIdToken(match[1]);
    } catch {
      return { status: 401, error: "The sign-in token is not valid. Sign in again." };
    }
    const email = typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!email || claims.email_verified !== true || !allowed.has(email)) {
      return { status: 403, error: "This account is not allowed to use this runner." };
    }
    // `exp` (seconds) lets long-lived streams end when the token does.
    return { user: { uid: claims.uid, email, ...(Number.isFinite(claims.exp) ? { exp: claims.exp } : {}) } };
  };
}

/** Real verifier. firebase-admin is loaded lazily so tests never need it. */
export async function firebaseVerifier(projectId) {
  const { initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const app = initializeApp({ projectId }, "sandbench-runner");
  const auth = getAuth(app);
  // Signature, audience and expiry only; this needs the project id and Google's public
  // keys, not a service account. Revocation checks (checkRevoked) would need a service
  // account secret, so they wait for SB-05. Tokens expire within an hour either way.
  return (token) => auth.verifyIdToken(token);
}
