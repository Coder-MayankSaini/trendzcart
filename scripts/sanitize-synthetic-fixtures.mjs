#!/usr/bin/env node
/**
 * TASK 016 — Synthetic Test Products and Coupons Deactivation
 * 
 * Safely marks historical synthetic test products as hidden/archived and coupons as inactive
 * so they can never be browsed or purchased on the public storefront.
 */

import fs from "fs";
import { execSync } from "child_process";
import admin from "firebase-admin";

function getEnv(key) {
    if (process.env[key]) return process.env[key];
    if (fs.existsSync(".env.local")) {
        const envContent = fs.readFileSync(".env.local", "utf-8");
        const match = envContent.match(new RegExp(`${key}\\s*=\\s*([^\\r\\n]+)`));
        if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
    return undefined;
}

const PROJECT_ID = "trendkartz";

async function initFirebaseAdmin() {
    let clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
    let privateKey = getEnv("FIREBASE_PRIVATE_KEY");

    if (!clientEmail || !privateKey) {
        try {
            clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
            privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
        } catch (e) {
            console.warn("Could not load Firebase Admin credentials from Netlify:", e.message);
        }
    }

    if (!admin.apps.length) {
        if (clientEmail && privateKey) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: PROJECT_ID,
                    clientEmail: clientEmail,
                    privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
                })
            });
        } else {
            throw new Error("Missing Firebase Admin credentials (FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY).");
        }
    }

    return admin.firestore();
}

const TEST_PRODUCT_IDS = [
    "task013_test_prod_custom",
    "task013_test_prod_lowstock",
    "task013_test_prod_simple"
];

const TEST_COUPON_IDS = [
    "TASK013_SAVE50",
    "TASK013_TEST_COUPON_SAVE50"
];

async function main() {
    const isApplyMode = process.argv.includes("--confirm-sanitize-fixtures");
    const modeLabel = isApplyMode ? "APPLY MODE (LIVE DATABASE UPDATE)" : "DRY-RUN MODE (READ-ONLY SIMULATION)";

    console.log("================================================================================");
    console.log("TASK 016 — SYNTHETIC TEST FIXTURES SANITIZATION & DEACTIVATION");
    console.log(`Mode:            ${modeLabel}`);
    console.log(`Firebase Target: ${PROJECT_ID}`);
    console.log("================================================================================\n");

    const db = await initFirebaseAdmin();

    console.log("--- 1. AUDITING SYNTHETIC TEST PRODUCTS ---");
    const productUpdates = [];
    for (const pid of TEST_PRODUCT_IDS) {
        const snap = await db.collection("products").doc(pid).get();
        if (!snap.exists) {
            console.log(`Product [${pid}]: NOT FOUND (already cleaned or absent)`);
            continue;
        }
        const data = snap.data();
        console.log(`Product [${pid}]:`);
        console.log(`  Current State:  name="${data.name}", isVisible=${data.isVisible}, inventory=${data.inventory}, isArchived=${data.isArchived}`);
        const patch = {
            isVisible: false,
            isArchived: true,
            isTestFixture: true,
            purchasable: false,
            status: "archived",
            archivedAt: new Date().toISOString(),
            archiveReason: "TASK_016_PRELAUNCH_TEST_FIXTURE_DEACTIVATION"
        };
        console.log(`  Planned Patch:  ${JSON.stringify(patch)}`);
        productUpdates.push({ ref: snap.ref, patch, name: data.name });
    }

    console.log("\n--- 2. AUDITING SYNTHETIC TEST COUPONS ---");
    const couponUpdates = [];
    for (const cid of TEST_COUPON_IDS) {
        const snap = await db.collection("coupons").doc(cid).get();
        if (!snap.exists) {
            console.log(`Coupon [${cid}]: NOT FOUND`);
            continue;
        }
        const data = snap.data();
        console.log(`Coupon [${cid}]:`);
        console.log(`  Current State:  code="${data.code || cid}", isActive=${data.isActive}, timesUsed=${data.timesUsed}`);
        const patch = {
            isActive: false,
            isTestFixture: true,
            status: "disabled",
            disabledAt: new Date().toISOString(),
            disableReason: "TASK_016_PRELAUNCH_TEST_FIXTURE_DEACTIVATION"
        };
        console.log(`  Planned Patch:  ${JSON.stringify(patch)}`);
        couponUpdates.push({ ref: snap.ref, patch, code: data.code || cid });
    }

    console.log(`\n================================================================================`);
    console.log(`SUMMARY: ${productUpdates.length} products to hide/archive, ${couponUpdates.length} coupons to deactivate.`);
    console.log(`================================================================================`);

    if (!isApplyMode) {
        console.log(`[STATUS: DRY-RUN COMPLETED SUCCESSFULLY]`);
        console.log(`To apply these deactivations, run with:`);
        console.log(`  node scripts/sanitize-synthetic-fixtures.mjs --confirm-sanitize-fixtures\n`);
        return;
    }

    console.log(`Applying sanitization patches...`);
    for (const p of productUpdates) {
        await p.ref.update(p.patch);
        console.log(`+ Product '${p.name}' marked isVisible: false, isArchived: true`);
    }
    for (const c of couponUpdates) {
        await c.ref.update(c.patch);
        console.log(`+ Coupon '${c.code}' marked isActive: false`);
    }
    console.log(`[SUCCESS] All synthetic fixtures have been deactivated in live Firestore!`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
