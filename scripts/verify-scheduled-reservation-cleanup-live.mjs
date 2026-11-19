#!/usr/bin/env node
/**
 * TASK 015 — Scheduled Reservation Cleanup Live Environment Verification
 * Verifies actual inventory restoration on an expired unpaid Razorpay Test Mode order,
 * verifies idempotency (zero double restoration), and verifies genuine captured orders are protected.
 */

import fs from "fs";
import path from "path";
import os from "os";

function getEnv(key) {
    if (process.env[key]) return process.env[key];
    if (fs.existsSync(".env.local")) {
        const envContent = fs.readFileSync(".env.local", "utf-8");
        const match = envContent.match(new RegExp(`${key}\\s*=\\s*([^\\r\\n]+)`));
        if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
    throw new Error(`${key} not found in environment or .env.local`);
}

const RAZORPAY_KEY_ID = getEnv("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = getEnv("RAZORPAY_KEY_SECRET");
process.env.RAZORPAY_KEY_ID = RAZORPAY_KEY_ID;
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
const PROJECT_ID = "trendkartz";

async function loadFirebaseAdminEnvFromNetlify() {
    if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) return;
    try {
        const { execSync } = await import("child_process");
        const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
        const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
        if (clientEmail && privateKey) {
            process.env.FIREBASE_CLIENT_EMAIL = clientEmail;
            process.env.FIREBASE_PRIVATE_KEY = privateKey;
            process.env.FIREBASE_PROJECT_ID = "trendkartz";
        }
    } catch (e) {
        console.warn("Could not load Netlify credentials via CLI:", e.message);
    }
}

function getFirebaseAccessToken() {
    const p = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
    if (!fs.existsSync(p)) {
        throw new Error("firebase-tools.json not found");
    }
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data.tokens?.access_token;
}

function parseFirestoreFields(fields) {
    if (!fields) return {};
    const res = {};
    for (const [k, v] of Object.entries(fields)) {
        if ("stringValue" in v) res[k] = v.stringValue;
        else if ("integerValue" in v) res[k] = parseInt(v.integerValue, 10);
        else if ("doubleValue" in v) res[k] = parseFloat(v.doubleValue);
        else if ("booleanValue" in v) res[k] = v.booleanValue;
        else if ("timestampValue" in v) res[k] = v.timestampValue;
        else if ("nullValue" in v) res[k] = null;
        else if ("mapValue" in v) res[k] = parseFirestoreFields(v.mapValue.fields);
        else if ("arrayValue" in v) {
            res[k] = (v.arrayValue.values || []).map(item => {
                if ("stringValue" in item) return item.stringValue;
                if ("integerValue" in item) return parseInt(item.integerValue, 10);
                if ("mapValue" in item) return parseFirestoreFields(item.mapValue.fields);
                return item;
            });
        }
    }
    return res;
}

function encodeFirestoreFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") fields[k] = { stringValue: v };
        else if (typeof v === "number") {
            if (Number.isInteger(v)) fields[k] = { integerValue: v.toString() };
            else fields[k] = { doubleValue: v };
        } else if (typeof v === "boolean") fields[k] = { booleanValue: v };
        else if (v === null) fields[k] = { nullValue: null };
        else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
        else if (Array.isArray(v)) {
            fields[k] = {
                arrayValue: {
                    values: v.map(item => {
                        if (typeof item === "object" && item !== null) {
                            return { mapValue: { fields: encodeFirestoreFields(item) } };
                        }
                        if (typeof item === "string") return { stringValue: item };
                        if (typeof item === "number") return { integerValue: item.toString() };
                        return { stringValue: String(item) };
                    })
                }
            };
        } else if (typeof v === "object") {
            fields[k] = { mapValue: { fields: encodeFirestoreFields(v) } };
        }
    }
    return fields;
}

async function getFirestoreDoc(collection, docId) {
    const token = getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return parseFirestoreFields(json.fields);
}

async function writeFirestoreDoc(collection, docId, data) {
    const token = getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    const res = await fetch(url, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ fields: encodeFirestoreFields(data) })
    });
    if (!res.ok) throw new Error(`Firestore PATCH failed: ${res.status} ${await res.text()}`);
    return await res.json();
}

async function createRazorpayOrder(receipt, amountPaise) {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt: receipt
        })
    });
    if (!res.ok) throw new Error(`Razorpay order create failed: ${res.status} ${await res.text()}`);
    return await res.json();
}

async function main() {
    await loadFirebaseAdminEnvFromNetlify();

    console.log("================================================================================");
    console.log("TASK 015 — SCHEDULED RESERVATION CLEANUP LIVE INVENTORY RESTORATION TEST");
    console.log(`Firebase Project: ${PROJECT_ID}`);
    console.log("================================================================================\n");

    const TEST_PRODUCT_ID = "task013_test_prod_simple";

    // STEP 1: Verify Initial Inventory Baseline
    console.log("STEP 1: Verifying baseline inventory for test product...");
    const baselineProduct = await getFirestoreDoc("products", TEST_PRODUCT_ID);
    const baselineStock = baselineProduct.inventory;
    console.log(`+ Product [${TEST_PRODUCT_ID}] baseline inventory: ${baselineStock}`);

    // STEP 2: Create authentic Razorpay Test Mode Order (Unpaid)
    console.log("\nSTEP 2: Creating authentic Razorpay Test Mode Order (Unpaid)...");
    const testOrderId = `task015_cleanuptest_${Date.now()}`;
    const rzpOrder = await createRazorpayOrder(testOrderId, 19900);
    console.log(`+ Razorpay Gateway Order Created: ${rzpOrder.id}`);
    console.log(`+ Gateway Order Status: '${rzpOrder.status}' (amount_paid: ${rzpOrder.amount_paid})`);

    // STEP 3: Create Firestore Pending Order with Expired Reservation
    console.log("\nSTEP 3: Creating expired internal reservation in Firestore...");
    const expiredTimestamp = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes in the past
    const reservedStock = baselineStock - 1;

    // Simulate stock reservation decrement
    await writeFirestoreDoc("products", TEST_PRODUCT_ID, {
        ...baselineProduct,
        inventory: reservedStock
    });
    console.log(`+ Stock reserved: decremented inventory from ${baselineStock} -> ${reservedStock}`);

    // Create the pending order document
    await writeFirestoreDoc("orders", testOrderId, {
        paymentMethod: "RAZORPAY",
        inventoryReserved: true,
        reservationReleased: false,
        reservationExpiresAt: expiredTimestamp,
        razorpayOrderId: rzpOrder.id,
        amountPaise: 19900,
        total: 199,
        currency: "INR",
        orderStatus: "Pending",
        paymentStatus: "PENDING",
        createdAt: expiredTimestamp,
        items: [
            {
                productId: TEST_PRODUCT_ID,
                quantity: 1,
                name: "TASK013 Test Simple Mug",
                price: 199
            }
        ]
    });
    console.log(`+ Created expired order doc [${testOrderId}] with reservationReleased=false`);

    // STEP 4: Trigger Reservation Cleanup Worker on Live Database
    console.log("\nSTEP 4: Invoking cleanup engine against live Firestore & Razorpay API...");
    // Import and execute cleanupExpiredReservations directly using Firebase Admin credentials
    const { adminDb: liveDb } = await import("../src/lib/firebase/admin.ts");
    const { runReservationCleanup } = await import("../src/lib/orders/reservationCleanup.ts");

    const cleanupResult = await runReservationCleanup(liveDb);
    console.log(`+ Worker Execution Result:`);
    console.log(`    processed:       ${cleanupResult.processed}`);
    console.log(`    released:        ${cleanupResult.released}`);
    console.log(`    finalized:       ${cleanupResult.finalized}`);
    console.log(`    skipped:         ${cleanupResult.skipped}`);
    console.log(`    reconciliation:  ${cleanupResult.reconciliationCount}`);
    console.log(`    gatewayErrors:   ${cleanupResult.gatewayErrors}`);
    console.log(`    firestoreErrors: ${cleanupResult.firestoreErrors}`);
    console.log(`    durationMs:      ${cleanupResult.durationMs}ms`);
    if (cleanupResult.errors.length > 0) {
        console.log(`    errors:          ${JSON.stringify(cleanupResult.errors)}`);
    }

    // STEP 5: Verify Order State Transition
    console.log("\nSTEP 5: Verifying Firestore order state transition...");
    const updatedOrder = await getFirestoreDoc("orders", testOrderId);
    console.log(`+ Order Status:         ${updatedOrder.orderStatus} (expected 'Expired')`);
    console.log(`+ Payment Status:       ${updatedOrder.paymentStatus} (expected 'EXPIRED')`);
    console.log(`+ Reservation Released: ${updatedOrder.reservationReleased} (expected true)`);

    if (
        updatedOrder.orderStatus !== "Expired" ||
        updatedOrder.paymentStatus !== "EXPIRED" ||
        updatedOrder.reservationReleased !== true
    ) {
        throw new Error("Order state was not updated correctly by cleanup worker!");
    }

    // STEP 6: Verify Stock Restoration
    console.log("\nSTEP 6: Verifying inventory restoration...");
    const restoredProduct = await getFirestoreDoc("products", TEST_PRODUCT_ID);
    console.log(`+ Product [${TEST_PRODUCT_ID}] restored inventory: ${restoredProduct.inventory} (expected ${baselineStock})`);

    if (restoredProduct.inventory !== baselineStock) {
        throw new Error(`Inventory not restored! Expected ${baselineStock}, got ${restoredProduct.inventory}`);
    }
    console.log(`+ Inventory restored exactly once: ${reservedStock} -> ${restoredProduct.inventory} SUCCESS!`);

    // STEP 7: Verify Worker Idempotency (Second Execution)
    console.log("\nSTEP 7: Executing second cleanup pass to verify idempotency (no double restoration)...");
    const secondCleanup = await runReservationCleanup(liveDb);
    console.log(`+ Second Run Result: released=${secondCleanup.released}, skipped=${secondCleanup.skipped}`);

    const productAfterSecond = await getFirestoreDoc("products", TEST_PRODUCT_ID);
    console.log(`+ Product [${TEST_PRODUCT_ID}] inventory after second run: ${productAfterSecond.inventory}`);
    if (productAfterSecond.inventory !== baselineStock) {
        throw new Error(`Double restoration defect! Inventory changed to ${productAfterSecond.inventory}`);
    }
    console.log("+ Zero duplicate restoration verified!");

    // STEP 8: Verify Genuine Captured Order is Protected
    console.log("\nSTEP 8: Verifying genuine captured order NtT2qGVlH9Gby51CYgGq is protected...");
    const capturedOrder = await getFirestoreDoc("orders", "NtT2qGVlH9Gby51CYgGq");
    console.log(`+ Captured Order paymentStatus:       ${capturedOrder.paymentStatus}`);
    console.log(`+ Captured Order orderStatus:         ${capturedOrder.orderStatus}`);
    console.log(`+ Captured Order inventoryFinalized:  ${capturedOrder.inventoryFinalized}`);
    console.log(`+ Captured Order reservationReleased: ${capturedOrder.reservationReleased}`);

    if (
        capturedOrder.paymentStatus !== "PAID" ||
        capturedOrder.reservationReleased === true
    ) {
        throw new Error("Genuinely captured order was compromised by cleanup worker!");
    }
    console.log("+ Genuinely captured order safely preserved as PAID and unreleased!");

    console.log("\n================================================================================");
    console.log("SCHEDULED RESERVATION CLEANUP LIVE VERIFICATION: 100% PASSED!");
    console.log("================================================================================");
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
