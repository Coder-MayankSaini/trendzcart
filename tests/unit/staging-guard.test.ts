import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    validateStagingIsolation,
    assertStagingIsolation,
    isStagingEnvironment,
} from "../../src/lib/security/stagingGuard.ts";

describe("Staging Guard & Production Isolation Tests", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Reset process.env before each test
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, originalEnv);

        // Ensure non-staging by default
        delete process.env.APP_ENV;
        delete process.env.NEXT_PUBLIC_APP_ENV;
        delete process.env.CONTEXT;
        delete process.env.STAGING_FIREBASE_PROJECT_ID;
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, originalEnv);
    });

    it("STAGE-ISO-001: should identify non-staging environments as isolated by default", () => {
        assert.equal(isStagingEnvironment(), false);
        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, true);
        assert.equal(result.isStaging, false);
        assert.equal(result.violations.length, 0);
    });

    it("STAGE-ISO-002: should PASS on valid isolated staging configuration", () => {
        process.env.APP_ENV = "staging";
        process.env.NEXT_PUBLIC_APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.FIREBASE_CLIENT_EMAIL = "staging-sa@bazaarvilla-staging.iam.gserviceaccount.com";
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "bazaarvilla-staging.appspot.com";
        process.env.RAZORPAY_KEY_ID = "rzp_test_validStagingKey123";
        process.env.RAZORPAY_KEY_SECRET = "validStagingSecret123";
        process.env.RAZORPAY_WEBHOOK_SECRET = "validStagingWebhookSecret123";
        process.env.URL = "https://bazaarvilla-staging.netlify.app";

        assert.equal(isStagingEnvironment(), true);
        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, true);
        assert.equal(result.isStaging, true);
        assert.equal(result.violations.length, 0);
        assert.doesNotThrow(() => assertStagingIsolation());
    });

    it("STAGE-ISO-003: RULE 1 — should FAIL if server and client Firebase project IDs mismatch", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "trendkartz-staging";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 1: Project ID Mismatch")));
        assert.throws(() => assertStagingIsolation(), /Project ID Mismatch/);
    });

    it("STAGE-ISO-004: RULE 1 — should FAIL if service account project does not match server project", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.FIREBASE_CLIENT_EMAIL = "service-acc@other-project.iam.gserviceaccount.com";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("Service account email project")));
    });

    it("STAGE-ISO-005: RULE 2 — should FAIL if Firebase project points to production", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla"; // Production project!
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 2: CRITICAL SAFETY VIOLATION")));
    });

    it("STAGE-ISO-006: RULE 3 — should FAIL if Cloud Storage bucket belongs to production", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "bazaarvilla.appspot.com"; // Production bucket!
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 3: CRITICAL SAFETY VIOLATION")));
    });

    it("STAGE-ISO-007: RULE 4 — should FAIL if Razorpay LIVE key is detected in staging", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.RAZORPAY_KEY_ID = "rzp_live_dangerousLiveKey123";
        process.env.RAZORPAY_KEY_SECRET = "liveSecret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 4: CRITICAL FINANCIAL RISK")));
    });

    it("STAGE-ISO-008: RULE 5 — should FAIL if required staging variables are missing", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        // Missing RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 5: Missing RAZORPAY_KEY_ID")));
        assert.ok(result.violations.some((v) => v.includes("RULE 5: Missing RAZORPAY_KEY_SECRET")));
    });

    it("STAGE-ISO-009: RULE 6 — should FAIL if environment indicators conflict", () => {
        process.env.APP_ENV = "staging";
        process.env.NEXT_PUBLIC_APP_ENV = "production"; // Conflicting!
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 6: Environment indicator conflict")));
    });

    it("STAGE-ISO-010: RULE 7 — should FAIL if emulator mode is mistakenly mixed with hosted staging", () => {
        process.env.APP_ENV = "staging";
        process.env.USE_FIREBASE_EMULATOR = "true";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging"; // Non-demo hosted project!
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 7: Emulator mode")));
    });

    it("STAGE-ISO-011: RULE 8 — should FAIL if staging deployment is bound to production custom domain", () => {
        process.env.APP_ENV = "staging";
        process.env.FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "bazaarvilla-staging";
        process.env.RAZORPAY_KEY_ID = "rzp_test_key";
        process.env.RAZORPAY_KEY_SECRET = "secret";
        process.env.URL = "https://bazaarvilla.com"; // Production apex domain!

        const result = validateStagingIsolation();
        assert.equal(result.isIsolated, false);
        assert.ok(result.violations.some((v) => v.includes("RULE 8: CRITICAL SAFETY VIOLATION")));
    });
});
