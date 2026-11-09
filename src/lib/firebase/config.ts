import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { isEmulatorMode, assertEmulatorSafety, DEMO_PROJECT_ID } from "./emulatorGuard";

const inEmulator = isEmulatorMode();

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || (inEmulator ? "fake-api-key" : "dummy"),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || (inEmulator ? "localhost" : "dummy"),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || (inEmulator ? DEMO_PROJECT_ID : "dummy"),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || (inEmulator ? `${DEMO_PROJECT_ID}.appspot.com` : "dummy"),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || (inEmulator ? "123456789" : "dummy"),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || (inEmulator ? "1:123456789:web:abcdef" : "dummy"),
};

// Initialize Firebase only once
let app: any;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
} catch (error) {
  console.warn("Firebase initialization skipped for build", error);
}

const isValid = firebaseConfig.apiKey !== "dummy";

export const auth = isValid ? getAuth(app) : {} as any;
export const db = isValid ? getFirestore(app) : {} as any;
export const storage = isValid ? getStorage(app) : {} as any;

// Connect to emulators if in emulator mode (avoid duplicate connection during hot reloads)
const g = globalThis as any;
if (inEmulator && isValid && !g.__FIREBASE_EMULATORS_CONNECTED__) {
  try {
    assertEmulatorSafety();
    if (db && typeof connectFirestoreEmulator === "function") {
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
    if (auth && typeof connectAuthEmulator === "function") {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
    if (storage && typeof connectStorageEmulator === "function") {
      connectStorageEmulator(storage, "127.0.0.1", 9199);
    }
    g.__FIREBASE_EMULATORS_CONNECTED__ = true;
  } catch (err) {
    console.error("Failed to connect Firebase Client SDK to emulators", err);
  }
}

export default app;
