import fs from "fs";
import path from "path";
import os from "os";
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

const RAZORPAY_KEY_ID = getEnv("RAZORPAY_KEY_ID") || "rzp_test_Ty8NdX6efCPisf";
const RAZORPAY_KEY_SECRET = getEnv("RAZORPAY_KEY_SECRET") || "DvQhosei36Cn5UB4dDPTJuDV";
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

async function getRazorpayResource(endpoint) {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/${endpoint}`, {
        headers: { Authorization: `Basic ${auth}` }
    });
    const status = res.status;
    let data = null;
    try {
        data = await res.json();
    } catch (e) {
        data = await res.text();
    }
    return { status, data };
}

const TARGET_ORDERS = [
    "c39xYbGgIFZ7OeCogOLs",
    "VCRIyEYOL9Qs9kXO3q0l",
    "9zZ9yDaKxacS5ZyYdFMO",
    "E1TSDrDBpbiKRLRoBljf",
    "ZgX60mkrfy8bYPVG5xAr",
    "MBbquzz08LpVNZqqUTSt",
    "DV0JKWgs60V8lUvGEv5u"
];

async function main() {
    console.log("================================================================================");
    console.log("TASK 016 — AUTHORITATIVE AUDIT & RECONCILIATION OF 7 SYNTHETIC FALSE-PAID ORDERS");
    console.log(`Firebase Project: ${PROJECT_ID}`);
    console.log("================================================================================\n");

    const db = await initFirebaseAdmin();
    const auditResults = [];

    for (const orderId of TARGET_ORDERS) {
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`Auditing Firestore Order ID: ${orderId}`);

        const orderSnap = await db.collection("orders").doc(orderId).get();
        if (!orderSnap.exists) {
            console.log(`[!] ORDER NOT FOUND in Firestore!`);
            auditResults.push({ orderId, exists: false });
            continue;
        }

        const orderDoc = orderSnap.data();
        const gatewayOrderId = orderDoc.razorpayOrderId || orderDoc.gatewayOrderId || null;
        const paymentId = orderDoc.razorpayPaymentId || orderDoc.paymentId || null;

        console.log(`  Firestore State:`);
        console.log(`    orderStatus:         ${orderDoc.orderStatus}`);
        console.log(`    paymentStatus:       ${orderDoc.paymentStatus}`);
        console.log(`    paymentMethod:       ${orderDoc.paymentMethod}`);
        console.log(`    total:               ₹${orderDoc.total}`);
        console.log(`    createdAt:           ${orderDoc.createdAt?.toDate ? orderDoc.createdAt.toDate().toISOString() : orderDoc.createdAt}`);
        console.log(`    gatewayOrderId:      ${gatewayOrderId}`);
        console.log(`    gatewayPaymentId:    ${paymentId}`);
        console.log(`    inventoryFinalized:  ${orderDoc.inventoryFinalized}`);
        console.log(`    reservationReleased: ${orderDoc.reservationReleased}`);
        console.log(`    quarantined:         ${orderDoc.quarantined || false}`);
        console.log(`    reconciliationReq:   ${orderDoc.reconciliationRequired || false}`);

        // Items and coupon
        console.log(`    Items:               ${JSON.stringify((orderDoc.items || []).map(i => ({ productId: i.productId || i.id, quantity: i.quantity, name: i.name })))}`);
        if (orderDoc.couponCode) {
            console.log(`    Coupon Code:         ${orderDoc.couponCode} (Discount: ₹${orderDoc.couponDiscount || 0})`);
        }

        // Check payment record in Firestore
        let paymentRecord = null;
        if (paymentId) {
            const paySnap = await db.collection("paymentRecords").doc(paymentId).get();
            paymentRecord = paySnap.exists ? paySnap.data() : null;
            console.log(`    paymentRecord doc:   ${paymentRecord ? "EXISTS" : "DOES NOT EXIST"}`);
            if (paymentRecord) {
                console.log(`      paymentRecord data: ${JSON.stringify(paymentRecord)}`);
            }
        }

        // Check Gateway Order
        let gatewayOrder = null;
        if (gatewayOrderId) {
            const rzpOrderRes = await getRazorpayResource(`orders/${gatewayOrderId}`);
            gatewayOrder = rzpOrderRes;
            console.log(`  Razorpay Gateway Order (${gatewayOrderId}):`);
            console.log(`    HTTP Status:         ${rzpOrderRes.status}`);
            if (rzpOrderRes.status === 200) {
                console.log(`    status:              ${rzpOrderRes.data.status}`);
                console.log(`    amount:              ${rzpOrderRes.data.amount} paise (₹${rzpOrderRes.data.amount / 100})`);
                console.log(`    amount_paid:         ${rzpOrderRes.data.amount_paid} paise`);
                console.log(`    amount_due:          ${rzpOrderRes.data.amount_due} paise`);
                console.log(`    attempts:            ${rzpOrderRes.data.attempts}`);
            } else {
                console.log(`    Error response:      ${JSON.stringify(rzpOrderRes.data)}`);
            }
        }

        // Check Gateway Payment
        let gatewayPayment = null;
        if (paymentId) {
            const rzpPayRes = await getRazorpayResource(`payments/${paymentId}`);
            gatewayPayment = rzpPayRes;
            console.log(`  Razorpay Gateway Payment (${paymentId}):`);
            console.log(`    HTTP Status:         ${rzpPayRes.status}`);
            if (rzpPayRes.status === 200) {
                console.log(`    status:              ${rzpPayRes.data.status}`);
                console.log(`    amount:              ${rzpPayRes.data.amount}`);
                console.log(`    captured:            ${rzpPayRes.data.captured}`);
            } else {
                console.log(`    Error / Description: ${JSON.stringify(rzpPayRes.data?.error?.description || rzpPayRes.data)}`);
            }
        }

        auditResults.push({
            orderId,
            exists: true,
            orderDoc,
            gatewayOrderId,
            paymentId,
            gatewayOrder,
            gatewayPayment,
            paymentRecord
        });
    }

    // Check affected catalog items current inventory
    console.log(`\n================================================================================`);
    console.log(`CURRENT CATALOG INVENTORY FOR PRODUCTS IN TEST ORDERS`);
    console.log(`================================================================================`);
    const productIds = new Set();
    for (const r of auditResults) {
        if (r.orderDoc?.items) {
            for (const item of r.orderDoc.items) {
                const pid = item.productId || item.id;
                if (pid) productIds.add(pid);
            }
        }
    }

    for (const pid of productIds) {
        const pSnap = await db.collection("products").doc(pid).get();
        if (pSnap.exists) {
            const pDoc = pSnap.data();
            console.log(`Product [${pid}]: name="${pDoc.name}", inventory=${pDoc.inventory}, isVisible=${pDoc.isVisible}`);
        } else {
            console.log(`Product [${pid}]: NOT FOUND in Firestore!`);
        }
    }

    // Check coupons
    console.log(`\n================================================================================`);
    console.log(`CURRENT COUPON USAGE FOR TEST COUPONS`);
    console.log(`================================================================================`);
    const couponCodes = new Set();
    for (const r of auditResults) {
        if (r.orderDoc?.couponCode) couponCodes.add(r.orderDoc.couponCode);
    }
    for (const code of couponCodes) {
        const cSnap = await db.collection("coupons").doc(code).get();
        if (cSnap.exists) {
            const cDoc = cSnap.data();
            console.log(`Coupon [${code}]: isActive=${cDoc.isActive}, timesUsed=${cDoc.timesUsed}, usageLimit=${cDoc.usageLimit}`);
        } else {
            console.log(`Coupon [${code}]: NOT FOUND in Firestore!`);
        }
    }

    console.log(`\nAuthoritative audit complete. Zero modifications made.`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
