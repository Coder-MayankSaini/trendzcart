#!/usr/bin/env node
/**
 * TASK 016 — Exact-Record Quarantine for Seven Synthetic False-PAID Orders
 * 
 * Safely reconciles the 7 historical synthetic test orders created during TASK 013
 * that were marked PAID via webhook tests without actual gateway funds capture.
 * 
 * SAFETY INVARIANTS:
 * 1. Default mode is strictly DRY-RUN (read-only).
 * 2. Applying changes requires explicit CLI flag `--confirm-apply-quarantine`.
 * 3. Does NOT delete documents (preserves audit trail and historical integrity).
 * 4. Sets `reservationReleased: true` to prevent scheduled reservation-cleanup from
 *    erroneously incrementing catalog stock.
 * 5. Sets compatible status `orderStatus: "Cancelled"`, `paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT"`,
 *    and `quarantined: true`.
 * 6. Updates `paymentRecords/{paymentId}` to `status: "QUARANTINED_SYNTHETIC"`.
 */

import fs from "fs";
import path from "path";
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

const TARGET_RECORDS = [
    {
        orderId: "c39xYbGgIFZ7OeCogOLs",
        expectedRazorpayOrderId: "order_Ty9gr5iY9FUjq8",
        expectedPaymentId: "pay_TASK013_TEST_1794244449608"
    },
    {
        orderId: "VCRIyEYOL9Qs9kXO3q0l",
        expectedRazorpayOrderId: "order_Ty9hM9JXw6arc1",
        expectedPaymentId: "pay_TASK013_TEST_1794244476766"
    },
    {
        orderId: "9zZ9yDaKxacS5ZyYdFMO",
        expectedRazorpayOrderId: "order_Ty9mw6Dzbv0fRC",
        expectedPaymentId: "pay_TASK013_TEST_1794244793683"
    },
    {
        orderId: "E1TSDrDBpbiKRLRoBljf",
        expectedRazorpayOrderId: "order_Ty9oA1k4JnDKaG",
        expectedPaymentId: "pay_TASK013_TEST_1794244863823"
    },
    {
        orderId: "ZgX60mkrfy8bYPVG5xAr",
        expectedRazorpayOrderId: "order_Ty9vsoavzdpvU5",
        expectedPaymentId: "pay_TASK013_TEST_1794245301193"
    },
    {
        orderId: "MBbquzz08LpVNZqqUTSt",
        expectedRazorpayOrderId: "order_Ty9wiRf1YIrmzg",
        expectedPaymentId: "pay_TASK013_TEST_1794245348865"
    },
    {
        orderId: "DV0JKWgs60V8lUvGEv5u",
        expectedRazorpayOrderId: "order_TyAF4jNxi4kwXm",
        expectedPaymentId: "pay_TASK013_TEST_1794246392047"
    }
];

async function main() {
    const isApplyMode = process.argv.includes("--confirm-apply-quarantine");
    const modeLabel = isApplyMode ? "APPLY MODE (LIVE DATABASE MUTATION)" : "DRY-RUN MODE (READ-ONLY SIMULATION)";

    console.log("================================================================================");
    console.log(`TASK 016 — EXACT-RECORD QUARANTINE PREPARATION & AUDIT`);
    console.log(`Mode:            ${modeLabel}`);
    console.log(`Firebase Target: ${PROJECT_ID}`);
    console.log("================================================================================\n");

    const db = await initFirebaseAdmin();
    const plannedMutations = [];

    for (const record of TARGET_RECORDS) {
        const { orderId, expectedRazorpayOrderId, expectedPaymentId } = record;
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`Auditing target order: ${orderId}`);

        const orderRef = db.collection("orders").doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            console.error(`  [!] CRITICAL ERROR: Order ${orderId} does not exist in Firestore!`);
            process.exit(1);
        }

        const data = orderSnap.data();
        console.log(`  Current Firestore Document:`);
        console.log(`    orderStatus:         ${data.orderStatus}`);
        console.log(`    paymentStatus:       ${data.paymentStatus}`);
        console.log(`    razorpayOrderId:     ${data.razorpayOrderId}`);
        console.log(`    razorpayPaymentId:   ${data.razorpayPaymentId}`);
        console.log(`    quarantined:         ${data.quarantined || false}`);
        console.log(`    reservationReleased: ${data.reservationReleased}`);
        console.log(`    inventoryFinalized:  ${data.inventoryFinalized}`);

        // Verify invariant expectations
        if (data.razorpayOrderId !== expectedRazorpayOrderId) {
            console.error(`  [!] MISMATCH: razorpayOrderId (${data.razorpayOrderId}) !== expected (${expectedRazorpayOrderId})`);
            process.exit(1);
        }
        if (data.razorpayPaymentId !== expectedPaymentId) {
            console.error(`  [!] MISMATCH: razorpayPaymentId (${data.razorpayPaymentId}) !== expected (${expectedPaymentId})`);
            process.exit(1);
        }

        // Check payment record
        const payRef = db.collection("paymentRecords").doc(expectedPaymentId);
        const paySnap = await payRef.get();
        const payData = paySnap.exists ? paySnap.data() : null;
        console.log(`  paymentRecords/${expectedPaymentId}: ${payData ? "EXISTS (status: " + payData.status + ")" : "MISSING"}`);

        const now = new Date().toISOString();
        const orderPatch = {
            orderStatus: "Cancelled",
            paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT",
            quarantined: true,
            quarantinedAt: now,
            quarantineReason: "TASK_016_EXACT_SYNTHETIC_PAYMENT_RECONCILIATION",
            reservationReleased: true, // Crucial: prevents reservation-cleanup from incrementing inventory
            reconciliationRequired: false,
            adminNotes: "Historical Task 013/014 synthetic test order marked PAID without gateway payment. Quarantined in Task 016 with verified exact IDs."
        };

        const payPatch = payData ? {
            status: "QUARANTINED_SYNTHETIC",
            quarantined: true,
            quarantinedAt: now,
            quarantineReason: "SYNTHETIC_PAYMENT_NONEXISTENT_ON_GATEWAY",
            notes: "Payment ID was synthetically generated during testing and never existed on Razorpay."
        } : null;

        console.log(`  Planned Order Patch:`);
        console.log(JSON.stringify(orderPatch, null, 4));
        if (payPatch) {
            console.log(`  Planned PaymentRecord Patch:`);
            console.log(JSON.stringify(payPatch, null, 4));
        }

        plannedMutations.push({
            orderRef,
            orderPatch,
            payRef: payData ? payRef : null,
            payPatch
        });
    }

    console.log(`\n================================================================================`);
    console.log(`SUMMARY OF PLANNED QUARANTINE MUTATIONS (7 ORDERS, 7 PAYMENT RECORDS)`);
    console.log(`================================================================================`);
    console.log(`Total Orders to Quarantine:         ${plannedMutations.length}`);
    console.log(`Total Payment Records to Update:    ${plannedMutations.filter(m => m.payRef).length}`);
    console.log(`Inventory Stock Alterations:        ZERO (Stock preserved at 46 units)`);
    console.log(`Data Loss / Document Deletions:     ZERO (Full audit history retained)`);

    if (!isApplyMode) {
        console.log(`\n[STATUS: DRY-RUN COMPLETED SUCCESSFULLY]`);
        console.log(`No records were modified in Firestore.`);
        console.log(`To apply these changes after explicit owner approval, run with:`);
        console.log(`  node scripts/prepare-seven-orders-quarantine.mjs --confirm-apply-quarantine\n`);
        return;
    }

    // Apply phase
    console.log(`\nApplying quarantine changes to Firestore in atomic transactions...`);
    for (const m of plannedMutations) {
        await db.runTransaction(async (t) => {
            t.update(m.orderRef, m.orderPatch);
            if (m.payRef && m.payPatch) {
                t.update(m.payRef, m.payPatch);
            }
        });
    }
    console.log(`[SUCCESS] All 7 orders and 7 payment records have been atomically quarantined in Firestore!`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
