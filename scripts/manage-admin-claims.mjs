#!/usr/bin/env node
/**
 * TrendKartz / Bazaarvilla — Firebase Admin Custom Claims Management Tool
 *
 * Safe, tightly controlled provisioning and revocation of administrative privileges.
 * Preserves existing unrelated custom claims and provides a safe --dry-run option.
 *
 * Usage:
 *   node scripts/manage-admin-claims.mjs --uid <TARGET_UID> --action <grant|revoke|check> [--dry-run]
 *
 * Requirements:
 *   - NEVER exposes a public HTTP endpoint for claim elevation.
 *   - Explicit UID targeting required.
 *   - Requires verified Firebase Admin SDK configuration.
 */

import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import os from "os";

let cliAccessToken = null;
const TARGET_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "trendkartz";

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
        uid: "",
        action: "check",
        dryRun: false,
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--uid" && args[i + 1]) {
            parsed.uid = args[i + 1].trim();
            i++;
        } else if (args[i] === "--action" && args[i + 1]) {
            parsed.action = args[i + 1].trim().toLowerCase();
            i++;
        } else if (args[i] === "--dry-run") {
            parsed.dryRun = true;
        }
    }

    return parsed;
}

async function syncFirestoreProfile(db, uid, role) {
    if (cliAccessToken) {
        try {
            const url = `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=role&updateMask.fieldPaths=updatedAt`;
            const resp = await fetch(url, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${cliAccessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    fields: {
                        role: { stringValue: role },
                        updatedAt: { integerValue: String(Date.now()) },
                    },
                }),
            });
            if (resp.ok) {
                console.log(`+ Synchronized Firestore user profile users/${uid} to role: "${role}" (via Firestore REST)`);
                return;
            }
        } catch (e) {
            console.warn("! Warning: Could not sync Firestore profile via REST:", e);
        }
    }
    try {
        const userRef = db.collection("users").doc(uid);
        await userRef.set({ role, updatedAt: Date.now() }, { merge: true });
        console.log(`+ Synchronized Firestore user profile users/${uid} to role: "${role}"`);
    } catch (fsErr) {
        console.warn("! Warning: Could not sync Firestore profile document:", fsErr);
    }
}

async function main() {
    const { uid, action, dryRun } = parseArgs();

    if (!uid) {
        console.error("Error: Target user UID is required. Provide --uid <UID>");
        console.log("Usage: node scripts/manage-admin-claims.mjs --uid <UID> --action <grant|revoke|check> [--dry-run]");
        process.exit(1);
    }

    if (!["grant", "revoke", "check"].includes(action)) {
        console.error(`Error: Invalid action '${action}'. Permitted actions: grant, revoke, check`);
        process.exit(1);
    }

    // Initialize Firebase Admin if not already initialized
    if (!admin.apps.length) {
        if (process.env.USE_FIREBASE_EMULATOR === "true" || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
            console.log("[Info] Running in Firebase Emulator Mode (demo-trendkartz)");
            admin.initializeApp({
                projectId: process.env.FIREBASE_PROJECT_ID || "demo-trendkartz",
            });
        } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
            console.log("[Info] Connecting with server credentials");
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: TARGET_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
                }),
            });
        } else {
            const toolsConfigPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
            if (fs.existsSync(toolsConfigPath)) {
                const toolsData = JSON.parse(fs.readFileSync(toolsConfigPath, "utf-8"));
                const token = toolsData.tokens?.access_token;
                if (token) {
                    console.log(`[Info] Connecting via Firebase CLI session (${toolsData.user?.email || "active user"})`);
                    cliAccessToken = token;
                    admin.initializeApp({
                        credential: {
                            getAccessToken: async () => ({
                                access_token: token,
                                expires_in: 3600,
                            }),
                        },
                        projectId: TARGET_PROJECT_ID,
                    });
                }
            }
            if (!admin.apps.length) {
                console.error("Error: Neither Firebase service account env vars nor Firebase CLI session found.");
                process.exit(1);
            }
        }
    }

    const auth = admin.auth();
    const db = cliAccessToken ? null : admin.firestore();

    console.log("================================================================================");
    console.log("TRENDKARTZ / BAZAARVILLA — ADMIN CLAIMS MANAGER");
    console.log(`Target UID: ${uid}`);
    console.log(`Action:     ${action.toUpperCase()}`);
    console.log(`Execution:  ${dryRun ? "DRY-RUN (No changes applied)" : "LIVE EXECUTION"}`);
    console.log("================================================================================");

    try {
        const user = await auth.getUser(uid);
        console.log(`User found: ${user.email || "No email"} (Disabled: ${user.disabled})`);
        const existingClaims = (user.customClaims || {});
        console.log("Current Custom Claims:", JSON.stringify(existingClaims, null, 2));

        if (action === "check") {
            const hasAdmin = existingClaims.admin === true;
            console.log(`\nResult: User ${uid} ${hasAdmin ? "HAS" : "DOES NOT HAVE"} the 'admin: true' custom claim.`);
            process.exit(0);
        }

        if (action === "grant") {
            if (existingClaims.admin === true) {
                console.log("\n[Notice] User already has admin: true custom claim. No changes needed.");
                process.exit(0);
            }

            const updatedClaims = {
                ...existingClaims,
                admin: true,
            };

            console.log("\nProposed New Custom Claims:", JSON.stringify(updatedClaims, null, 2));

            if (dryRun) {
                console.log("\n[DRY-RUN COMPLETE] Verification successful. Zero modifications committed.");
                process.exit(0);
            }

            await auth.setCustomUserClaims(uid, updatedClaims);
            console.log(`\n+ Successfully set custom claim { admin: true } for UID: ${uid}`);

            // Synchronize Firestore profile for consistency
            await syncFirestoreProfile(db, uid, "admin");

            console.log("\nIMPORTANT: The user must sign out and sign in again, or call getIdTokenResult(true) to refresh claims.");
            process.exit(0);
        }

        if (action === "revoke") {
            if (existingClaims.admin !== true) {
                console.log("\n[Notice] User does not have admin: true custom claim. Nothing to revoke.");
                process.exit(0);
            }

            const remainingClaims = { ...existingClaims };
            delete remainingClaims.admin;
            console.log("\nProposed Remaining Custom Claims:", JSON.stringify(remainingClaims, null, 2));

            if (dryRun) {
                console.log("\n[DRY-RUN COMPLETE] Verification successful. Zero modifications committed.");
                process.exit(0);
            }

            await auth.setCustomUserClaims(uid, remainingClaims);
            console.log(`\n- Successfully revoked admin claim for UID: ${uid}`);

            // Synchronize Firestore profile
            await syncFirestoreProfile(db, uid, "customer");

            console.log("\nIMPORTANT: The user's active tokens will lose admin privileges after token expiration or refresh.");
            process.exit(0);
        }
    } catch (err) {
        console.error("\n[Error executing claims management]:", err);
        process.exit(1);
    }
}

main();
