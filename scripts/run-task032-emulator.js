/**
 * Automated Firebase Emulator Runner for TASK 032 Functional Verification
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
env.COMMERCIAL_CHECKOUT_ENABLED = "true";

const fullCommand = `npx firebase emulators:exec --project demo-trendkartz --only firestore,auth "node --import ./tests/register.mjs scripts/verify-task032-emulator.mjs"`;

const child = spawn(fullCommand, {
    stdio: "inherit",
    env,
    shell: true,
});

child.on("close", (code) => {
    console.log(`\n[TASK 032 Emulator Functional Verification Exited with code: ${code}]`);
    process.exit(code || 0);
});
