import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

// Local tests only: point sign-in and Firestore at the Firebase emulators (demo-* projects).
const AUTH_EMULATOR = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR ?? "";
const FIRESTORE_EMULATOR = import.meta.env.VITE_FIRESTORE_EMULATOR ?? "";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
};

export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export function allowedEmails(): string[] {
  return String(import.meta.env.VITE_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfigured()) return null;
  if (!app) app = initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!auth) {
    auth = getAuth(firebaseApp);
    if (AUTH_EMULATOR) connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
  }
  return auth;
}

export function getFirebaseDb(): Firestore | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  if (!db) {
    db = getFirestore(firebaseApp);
    const [host, port] = FIRESTORE_EMULATOR.split(":");
    if (host && port) connectFirestoreEmulator(db, host, Number(port));
  }
  return db;
}
