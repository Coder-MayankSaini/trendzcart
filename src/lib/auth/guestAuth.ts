import { auth } from "@/lib/firebase/config";
import { signInAnonymously, User } from "firebase/auth";

/**
 * Ensures an active Firebase Authentication session exists.
 * If a customer is already signed in (either registered or anonymous),
 * returns the existing User.
 * If unauthenticated, transparently signs in anonymously so the customer
 * obtains a legitimate, scoped UID for secure Cloud Storage uploads.
 */
export async function ensureAuthenticatedUser(): Promise<User> {
    if (auth.currentUser) {
        return auth.currentUser;
    }
    const cred = await signInAnonymously(auth);
    return cred.user;
}
