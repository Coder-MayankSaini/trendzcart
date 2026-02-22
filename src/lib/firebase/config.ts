import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "dummy",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "dummy",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "dummy",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "dummy",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "dummy",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "dummy",
};

// Initialize Firebase only once
let app;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
} catch (error) {
  console.warn("Firebase initialization skipped for build", error);
}

// Bypassing Firebase SDK execution if run at build time without valid API Keys
const isValid = firebaseConfig.apiKey !== "dummy";

export const auth = isValid ? getAuth(app as any) : {} as any;
export const db = isValid ? getFirestore(app as any) : {} as any;
export const storage = isValid ? getStorage(app as any) : {} as any;
export default app;
