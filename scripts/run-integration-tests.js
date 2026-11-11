/**
 * Integration Test Runner with Automated Firebase Emulator Lifecycle
 * Automatically configures JDK compatibility, initializes demo emulators,
 * runs integration test suites, and exits cleanly.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

// Auto-detect a compatible JDK >= 21
function resolveCompatibleJdk() {
    const candidates = [
        "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1.4\\jbr",
        path.join(process.env.USERPROFILE || "", ".jdks", "openjdk-26.0.1"),
        path.join(process.env.USERPROFILE || "", ".jdks", "openjdk-27"),
    ];

    for (const candidate of candidates) {
        const javaExe = path.join(candidate, "bin", "java.exe");
        if (fs.existsSync(javaExe)) {
            return candidate;
        }
    }
    return null;
}

const compatibleJdk = resolveCompatibleJdk();
const env = { ...process.env };

if (compatibleJdk) {
    env.JAVA_HOME = compatibleJdk;
    env.PATH = `${path.join(compatibleJdk, "bin")};${env.PATH}`;
}

env.USE_FIREBASE_EMULATOR = "true";
env.FIREBASE_PROJECT_ID = "demo-trendkartz";
env.GCLOUD_PROJECT = "demo-trendkartz";
env.NODE_ENV = "test";
env.COMMERCIAL_CHECKOUT_ENABLED = "true";

console.log("================================================================================");
console.log("TRENDKARTZ / BAZAARVILLA — FIREBASE EMULATOR INTEGRATION TEST RUNNER");
console.log(`Java Runtime: ${compatibleJdk || "System Default"}`);
console.log("Project ID:   demo-trendkartz (PRODUCTION ISOLATED)");
console.log("Emulators:    Firestore (8080), Auth (9099), Storage (9199)");
console.log("================================================================================");

// Write a small runner script for the test command to avoid Windows argument quote-mangling
const testRunnerScript = path.join(process.cwd(), "tests", "run-all-integration.mjs");
const runnerContent = `
import { spawnSync } from "child_process";

const tests = [
    "tests/integration/emulator-safety.test.ts",
    "tests/integration/orders-create.test.ts",
    "tests/integration/razorpay-create-order.test.ts",
    "tests/integration/inventory-concurrency.test.ts",
    "tests/integration/payment-lifecycle.test.ts",
    "tests/integration/guest-order-privacy.test.ts",
    "tests/integration/admin-authorization.test.ts",
    "tests/integration/firestore-rules.test.ts",
    "tests/integration/storage-rules.test.ts",
    "tests/integration/customization-upload.test.ts",
    "tests/integration/reservation-cleanup.test.ts",
    "tests/integration/gateway-verification.test.ts",
    "tests/integration/gateway-association-recovery.test.ts",
    "tests/integration/reviews-submission.test.ts",
    "tests/integration/reviews-bulk-management.test.ts",
    "tests/integration/r2-storage.test.ts",
    "tests/integration/r2-authorization.test.ts",
    "tests/integration/r2-checkout.test.ts",
    "tests/integration/payment-trust-boundary.test.ts",
    "tests/integration/commercial-checkout-gate.test.ts",
    "tests/integration/media-isolation.test.ts",
    "tests/integration/purchase-activity-api.test.ts",
    "tests/integration/cod-customization-restriction.test.ts",
    "tests/integration/product-variants-lifecycle.test.ts"
];

const result = spawnSync(process.execPath, ["--import", "./tests/register.mjs", "--test", "--test-concurrency=1", ...tests], {
    stdio: "inherit",
    env: process.env
});

process.exit(result.status || 0);
`;

fs.writeFileSync(testRunnerScript, runnerContent);

const fullCommand = `npx firebase emulators:exec --project demo-trendkartz --only firestore,auth,storage "node tests/run-all-integration.mjs"`;

const child = spawn(fullCommand, {
    stdio: "inherit",
    env,
    shell: true,
});

child.on("close", (code) => {
    try {
        if (fs.existsSync(testRunnerScript)) {
            fs.unlinkSync(testRunnerScript);
        }
    } catch {}
    console.log(`\n[Integration Test Suite Exited with code: ${code}]`);
    process.exit(code || 0);
});
