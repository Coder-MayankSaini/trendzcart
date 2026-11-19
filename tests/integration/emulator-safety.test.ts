import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertEmulatorSafety, isEmulatorMode, DEMO_PROJECT_ID } from "../../src/lib/firebase/emulatorGuard.ts";

describe("Firebase Emulator Production Isolation & Safety Guards", () => {
    const originalEnv = { ...process.env };

    const resetEnv = () => {
        process.env = { ...originalEnv };
    };

    it("should accept valid demo project ID and localhost emulator configuration", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

        const result = assertEmulatorSafety();
        assert.equal(result.isSafe, true);
        assert.equal(result.isEmulator, true);
        assert.equal(result.reasons.length, 0);
    });

    it("FAIL-CLOSED: should REJECT non-demo project ID in emulator mode", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = "trendkartz-production-live";
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

        assert.throws(
            () => assertEmulatorSafety(),
            (err: any) => {
                assert.match(err.message, /SAFETY VIOLATION/);
                assert.match(err.message, /demo project ID/);
                return true;
            }
        );
    });

    it("FAIL-CLOSED: should REJECT missing FIRESTORE_EMULATOR_HOST in emulator mode", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        delete process.env.FIRESTORE_EMULATOR_HOST;

        assert.throws(
            () => assertEmulatorSafety(),
            (err: any) => {
                assert.match(err.message, /FIRESTORE_EMULATOR_HOST is missing/);
                return true;
            }
        );
    });

    it("FAIL-CLOSED: should REJECT external non-localhost emulator host", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "remote-db.evil.com:8080";

        assert.throws(
            () => assertEmulatorSafety(),
            (err: any) => {
                assert.match(err.message, /must point to localhost/);
                return true;
            }
        );
    });

    it("FAIL-CLOSED: should REJECT missing Auth host when Auth is required", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

        assert.throws(
            () => assertEmulatorSafety({ requireAuth: true }),
            (err: any) => {
                assert.match(err.message, /FIREBASE_AUTH_EMULATOR_HOST is missing/);
                return true;
            }
        );
    });

    it("FAIL-CLOSED: should REJECT missing Storage host when Storage is required", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;

        assert.throws(
            () => assertEmulatorSafety({ requireStorage: true }),
            (err: any) => {
                assert.match(err.message, /FIREBASE_STORAGE_EMULATOR_HOST is missing/);
                return true;
            }
        );
    });

    it("FAIL-CLOSED: should REJECT Razorpay Live Mode key in test/emulator environment", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        process.env.RAZORPAY_KEY_ID = "rzp_live_abc1234567890XYZ";

        assert.throws(
            () => assertEmulatorSafety(),
            (err: any) => {
                assert.match(err.message, /Razorpay LIVE mode key detected/);
                return true;
            }
        );
    });

    it("should allow Razorpay Test Mode keys in emulator environment", () => {
        resetEnv();
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = DEMO_PROJECT_ID;
        process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
        process.env.RAZORPAY_KEY_ID = "rzp_test_mockKey123";

        const result = assertEmulatorSafety();
        assert.equal(result.isSafe, true);
    });

    // Cleanup
    resetEnv();
});
