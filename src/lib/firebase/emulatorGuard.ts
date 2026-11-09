/**
 * Production Isolation and Firebase Emulator Safety Guards
 *
 * Enforces strict fail-closed behavior to guarantee tests and local development
 * never accidentally communicate with production Firebase or live Razorpay gateways.
 */

export const DEMO_PROJECT_ID = "demo-trendkartz";
export const EXPECTED_FIRESTORE_PORT = "8080";
export const EXPECTED_AUTH_PORT = "9099";
export const EXPECTED_STORAGE_PORT = "9199";

export interface EmulatorSafetyCheckResult {
    isSafe: boolean;
    isEmulator: boolean;
    reasons: string[];
}

/**
 * Determines whether the current execution context intends to use Firebase Emulators.
 */
export function isEmulatorMode(): boolean {
    const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" ||
        process.env.USE_FIREBASE_EMULATOR === "true";
    const hasHost = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const isTest = process.env.NODE_ENV === "test";
    const isDemoProject = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.startsWith("demo-") ||
        process.env.FIREBASE_PROJECT_ID?.startsWith("demo-") ||
        process.env.GCLOUD_PROJECT?.startsWith("demo-"));

    return useEmulator || hasHost || isTest || Boolean(isDemoProject);
}

/**
 * Validates that all safety constraints for emulator execution are strictly satisfied.
 * Throws a fatal Error if any violation is detected, preventing silent fallback to production.
 */
export function assertEmulatorSafety(options?: { requireAuth?: boolean; requireStorage?: boolean }): EmulatorSafetyCheckResult {
    const reasons: string[] = [];
    const inEmulator = isEmulatorMode();

    if (!inEmulator) {
        return { isSafe: true, isEmulator: false, reasons: [] };
    }

    // 1. Verify Project ID is an isolated demo project
    const projectId = process.env.FIREBASE_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT;

    if (!projectId || !projectId.startsWith("demo-")) {
        reasons.push(
            `SAFETY VIOLATION: Emulator mode requires a demo project ID starting with 'demo-' (e.g. '${DEMO_PROJECT_ID}'), but got: '${projectId || "undefined"}'. Refusing to continue.`
        );
    }

    // 2. Verify Firestore Emulator Host points strictly to localhost / loopback
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (!firestoreHost) {
        reasons.push(
            "SAFETY VIOLATION: FIRESTORE_EMULATOR_HOST is missing in emulator mode. Refusing to connect to production Firestore."
        );
    } else if (!firestoreHost.startsWith("127.0.0.1:") && !firestoreHost.startsWith("localhost:")) {
        reasons.push(
            `SAFETY VIOLATION: FIRESTORE_EMULATOR_HOST must point to localhost/127.0.0.1, but got: '${firestoreHost}'.`
        );
    }

    // 3. Verify Auth Emulator Host if required
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (options?.requireAuth) {
        if (!authHost) {
            reasons.push("SAFETY VIOLATION: FIREBASE_AUTH_EMULATOR_HOST is missing when Auth emulator is required.");
        } else if (!authHost.startsWith("127.0.0.1:") && !authHost.startsWith("localhost:") && !authHost.startsWith("http://127.0.0.1:") && !authHost.startsWith("http://localhost:")) {
            reasons.push(`SAFETY VIOLATION: FIREBASE_AUTH_EMULATOR_HOST must point to localhost, but got: '${authHost}'.`);
        }
    }

    // 4. Verify Storage Emulator Host if required
    const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (options?.requireStorage) {
        if (!storageHost) {
            reasons.push("SAFETY VIOLATION: FIREBASE_STORAGE_EMULATOR_HOST is missing when Storage emulator is required.");
        } else if (!storageHost.startsWith("127.0.0.1:") && !storageHost.startsWith("localhost:")) {
            reasons.push(`SAFETY VIOLATION: FIREBASE_STORAGE_EMULATOR_HOST must point to localhost, but got: '${storageHost}'.`);
        }
    }

    // 5. Reject live Razorpay keys in testing/emulator environments
    const razorpayKey = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (razorpayKey && razorpayKey.startsWith("rzp_live_")) {
        reasons.push(
            "SAFETY VIOLATION: Razorpay LIVE mode key detected in test/emulator environment. Live credentials strictly forbidden."
        );
    }

    if (reasons.length > 0) {
        const errorMsg = `[FAIL-CLOSED SAFETY ENFORCEMENT]\n${reasons.join("\n")}`;
        throw new Error(errorMsg);
    }

    return { isSafe: true, isEmulator: true, reasons: [] };
}
