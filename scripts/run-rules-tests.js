/**
 * Rules Test Runner with Automated Firebase Emulator Lifecycle
 * Runs firestore-rules.test.ts, storage-rules.test.ts, and admin-authorization.test.ts
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

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

const testRunnerScript = path.join(process.cwd(), "tests", "run-rules-temp.mjs");
const runnerContent = `
import { spawnSync } from "child_process";

const tests = [
    "tests/integration/admin-authorization.test.ts",
    "tests/integration/firestore-rules.test.ts",
    "tests/integration/storage-rules.test.ts"
];

const result = spawnSync(process.execPath, ["--import", "./tests/register.mjs", "--test", "--test-concurrency=1", ...tests], {
    stdio: "inherit",
    env: process.env
});

process.exit(result.status || 0);
`;

fs.writeFileSync(testRunnerScript, runnerContent);

const fullCommand = `npx firebase emulators:exec --project demo-trendkartz --only firestore,auth,storage "node tests/run-rules-temp.mjs"`;

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
    console.log(`\n[Rules Test Suite Exited with code: ${code}]`);
    process.exit(code || 0);
});
