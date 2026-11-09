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
const PROJECT_ID = "trendkartz";

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

async function getFirestoreDoc(collection, docId) {
    const token = getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Firestore GET ${collection}/${docId} failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return parseFirestoreFields(json.fields);
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
    console.log("TASK 015 — READ-ONLY DRY-RUN AUDIT OF 7 HISTORICAL SYNTHETIC FALSE-PAID ORDERS");
    console.log(`Firebase Project: ${PROJECT_ID}`);
    console.log("================================================================================\n");

    const auditResults = [];

    for (const orderId of TARGET_ORDERS) {
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`Auditing Firestore Order ID: ${orderId}`);

        const orderDoc = await getFirestoreDoc("orders", orderId);
        if (!orderDoc) {
            console.log(`[!] ORDER NOT FOUND in Firestore!`);
            auditResults.push({ orderId, exists: false });
            continue;
        }

        const gatewayOrderId = orderDoc.razorpayOrderId || orderDoc.gatewayOrderId || null;
        const paymentId = orderDoc.razorpayPaymentId || orderDoc.paymentId || null;

        console.log(`  Firestore State:`);
        console.log(`    orderStatus:         ${orderDoc.orderStatus}`);
        console.log(`    paymentStatus:       ${orderDoc.paymentStatus}`);
        console.log(`    paymentMethod:       ${orderDoc.paymentMethod}`);
        console.log(`    total:               ${orderDoc.total}`);
        console.log(`    createdAt:           ${orderDoc.createdAt}`);
        console.log(`    gatewayOrderId:      ${gatewayOrderId}`);
        console.log(`    gatewayPaymentId:    ${paymentId}`);
        console.log(`    inventoryFinalized:  ${orderDoc.inventoryFinalized}`);
        console.log(`    reservationReleased: ${orderDoc.reservationReleased}`);
        console.log(`    quarantined:         ${orderDoc.quarantined || false}`);
        console.log(`    reconciliationReq:   ${orderDoc.reconciliationRequired || false}`);

        // Items and coupon
        console.log(`    Items:               ${JSON.stringify((orderDoc.items || []).map(i => ({ productId: i.productId, quantity: i.quantity, name: i.name })))}`);
        if (orderDoc.couponCode) {
            console.log(`    Coupon Code:         ${orderDoc.couponCode} (Discount: ${orderDoc.couponDiscount})`);
        }

        // Check payment record in Firestore
        let paymentRecord = null;
        if (paymentId) {
            paymentRecord = await getFirestoreDoc("paymentRecords", paymentId);
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
                console.log(`    amount:              ${rzpOrderRes.data.amount} paise`);
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
                if (item.productId) productIds.add(item.productId);
            }
        }
    }

    for (const pid of productIds) {
        const pDoc = await getFirestoreDoc("products", pid);
        if (pDoc) {
            console.log(`Product [${pid}]: name="${pDoc.name}", inventory=${pDoc.inventory}`);
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
        const cDoc = await getFirestoreDoc("coupons", code);
        if (cDoc) {
            console.log(`Coupon [${code}]: active=${cDoc.active}, usageCount=${cDoc.usageCount}, maxUsage=${cDoc.maxUsage}`);
        } else {
            console.log(`Coupon [${code}]: NOT FOUND in Firestore!`);
        }
    }

    console.log(`\nAudit dry run complete. No modifications made.`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
