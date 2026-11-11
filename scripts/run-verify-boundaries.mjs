/**
 * Runner for Breakpoint Boundary Verification (TASK 031)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

console.log("================================================================================");
console.log("TASK 031 — BREAKPOINT BOUNDARY VERIFICATION HARNESS (479, 480, 767, 768, 959, 960, 980px)");
console.log(`JDK Runtime: ${compatibleJdk || "System Default"}`);
console.log("================================================================================");

const cmd = `npx firebase emulators:exec --project demo-trendkartz --only firestore,auth "node scripts/verify-breakpoint-boundaries.mjs"`;

const child = spawn(cmd, {
    stdio: "inherit",
    env,
    shell: true,
});

child.on("close", (code) => {
    console.log(`\n[Boundary Verification Harness Exited with code: ${code}]`);
    process.exit(code || 0);
});
