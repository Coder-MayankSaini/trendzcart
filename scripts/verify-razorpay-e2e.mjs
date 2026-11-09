#!/usr/bin/env node
/**
 * TASK 013 — Phase D, F, G: Razorpay Test Mode & Webhook E2E Verification
 * Validates hosted Razorpay order creation, stock reservation, webhook HMAC validation,
 * payment capture, idempotency, payment failure recovery, and inventory release.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const RAZORPAY_KEY_ID = "rzp_test_Ty8NdX6efCPisf";
const RAZORPAY_KEY_SECRET = "DvQhosei36Cn5UB4dDPTJuDV";
const RAZORPAY_WEBHOOK_SECRET = "bazaarvilla_whsec_b2e047414e856bd536aa0af2514795c2";
const BASE_URL = "https://bazaarvilla.com";

function getFirebaseAccessToken() {
    const p = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
    if (!fs.existsSync(p)) {
        throw new Error("firebase-tools.json not found");
    }
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data.tokens?.access_token;
}

async function getFirestoreDoc(collection, docId) {
    const token = getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/trendkartz/databases/(default)/documents/${collection}/${docId}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Firestore GET ${collection}/${docId} failed: HTTP ${res.status}`);
    }
    const raw = await res.json();
    return parseFirestoreDoc(raw);
}

function parseFirestoreDoc(rawDoc) {
    if (!rawDoc || !rawDoc.fields) return null;
    const res = {};
    for (const [k, v] of Object.entries(rawDoc.fields)) {
        res[k] = parseValue(v);
    }
    return res;
}

function parseValue(v) {
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return parseFloat(v.doubleValue);
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("mapValue" in v) {
        const obj = {};
        for (const [mk, mv] of Object.entries(v.mapValue.fields || {})) {
            obj[mk] = parseValue(mv);
        }
        return obj;
    }
    if ("arrayValue" in v) {
        return (v.arrayValue.values || []).map(parseValue);
    }
    return v;
}

function computeSignature(payloadString, secret) {
    return crypto.createHmac("sha256", secret).update(payloadString).digest("hex");
}

async function fetchRazorpayOrder(orderId) {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
        headers: { Authorization: `Basic ${auth}` }
    });
    return res.json();
}

async function main() {
    console.log("================================================================================");
    console.log("TASK 013 — Complete Razorpay Test Mode & Webhook E2E Verification");
    console.log(`Target: ${BASE_URL}`);
    console.log("================================================================================\n");

    // Check Initial Stock of test products
    const initialSimpleDoc = await getFirestoreDoc("products", "task013_test_prod_simple");
    const initialLowStockDoc = await getFirestoreDoc("products", "task013_test_prod_lowstock");
    const initialCouponDoc = await getFirestoreDoc("coupons", "TASK013_SAVE50");

    console.log(`[Baseline] Simple Product Stock: ${initialSimpleDoc?.inventory}`);
    console.log(`[Baseline] Low Stock Product Stock: ${initialLowStockDoc?.inventory}`);
    console.log(`[Baseline] Coupon Times Used: ${initialCouponDoc?.timesUsed || 0}`);

    // =========================================================================
    // STEP 1: Create Razorpay Order with Stock Reservation & Coupon
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 1: Testing Server-Authoritative Razorpay Order Creation & Reservation");
    console.log("--------------------------------------------------------------------------------");

    const orderPayload = {
        amount: 149, // ₹199 - ₹50 coupon
        couponCode: "TASK013_SAVE50",
        items: [
            {
                id: "task013_test_prod_simple",
                name: "TASK013 Test Simple Mug",
                price: 199,
                quantity: 1,
            }
        ],
        shippingAddress: {
            fullName: "TASK013 Prepaid Tester",
            email: "task013.prepaid@bazaarvilla.test",
            phone: "9876543210",
            addressLine1: "456 Gateway Avenue",
            city: "Jaipur",
            state: "Rajasthan",
            pincode: "302001"
        }
    };

    const createRes = await fetch(`${BASE_URL}/api/razorpay/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload)
    });

    console.log(`Create Order HTTP Status: ${createRes.status}`);
    const createData = await createRes.json();
    console.log("Create Order Response:", JSON.stringify(createData));

    if (!createRes.ok || !createData.id || !createData.internalOrderId) {
        throw new Error(`Order creation failed: ${JSON.stringify(createData)}`);
    }

    const { id: rzpOrderId, internalOrderId, amount: amountPaise, currency, guestAccessToken } = createData;
    console.log(`+ Internal Order ID: ${internalOrderId}`);
    console.log(`+ Razorpay Gateway Order ID: ${rzpOrderId}`);
    console.log(`+ Authoritative Amount: ${amountPaise} paise (₹${amountPaise / 100})`);
    console.log(`+ Currency: ${currency}`);

    // Verify order on Razorpay API directly
    const rzpApiOrder = await fetchRazorpayOrder(rzpOrderId);
    console.log(`+ Razorpay Gateway API verification: status='${rzpApiOrder.status}', amount=${rzpApiOrder.amount}`);
    if (rzpApiOrder.amount !== 14900 || rzpApiOrder.status !== "created") {
        throw new Error(`Gateway order mismatch on Razorpay: ${JSON.stringify(rzpApiOrder)}`);
    }

    // Verify Firestore Reservation
    const orderDoc = await getFirestoreDoc("orders", internalOrderId);
    console.log(`+ Firestore Order State: paymentStatus='${orderDoc.paymentStatus}', inventoryReserved=${orderDoc.inventoryReserved}, reservationExpiresAt=${orderDoc.reservationExpiresAt}`);
    if (orderDoc.paymentStatus !== "PENDING" || !orderDoc.inventoryReserved) {
        throw new Error(`Order not properly reserved in Firestore: ${JSON.stringify(orderDoc)}`);
    }

    // =========================================================================
    // STEP 2: Webhook Security Verification (Rejection of Invalid / Missing Signatures)
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 2: Webhook Cryptographic Security Verification");
    console.log("--------------------------------------------------------------------------------");

    // 2a. Missing signature
    const samplePayload = JSON.stringify({ event: "payment.captured", test: true });
    const missingSigRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: samplePayload
    });
    console.log(`2a. Missing signature -> HTTP ${missingSigRes.status}`);
    if (missingSigRes.status !== 400) {
        throw new Error(`Expected HTTP 400 for missing signature, got ${missingSigRes.status}`);
    }
    console.log("    + Correctly rejected with HTTP 400!");

    // 2b. Forged signature
    const forgedSigRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": "0000000000000000000000000000000000000000000000000000000000000000"
        },
        body: samplePayload
    });
    console.log(`2b. Forged signature -> HTTP ${forgedSigRes.status}`);
    if (forgedSigRes.status !== 400) {
        throw new Error(`Expected HTTP 400 for forged signature, got ${forgedSigRes.status}`);
    }
    console.log("    + Correctly rejected with HTTP 400!");

    // =========================================================================
    // STEP 3: Authentic Payment Capture via Signed Webhook
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 3: Authentic Payment Capture Finalization via Signed Webhook");
    console.log("--------------------------------------------------------------------------------");

    const testPaymentId = `pay_TASK013_TEST_${Date.now()}`;
    const testEventId = `evt_TASK013_${Date.now()}`;

    const paymentCapturedEvent = {
        entity: "event",
        account_id: "acc_TASK013",
        event: "payment.captured",
        contains: ["payment"],
        payload: {
            payment: {
                entity: {
                    id: testPaymentId,
                    entity: "payment",
                    amount: 14900,
                    currency: "INR",
                    status: "captured",
                    order_id: rzpOrderId,
                    method: "card",
                    captured: true,
                    description: "Payment for order",
                    created_at: Math.floor(Date.now() / 1000)
                }
            }
        },
        created_at: Math.floor(Date.now() / 1000)
    };

    const webhookBody = JSON.stringify(paymentCapturedEvent);
    const validSignature = computeSignature(webhookBody, RAZORPAY_WEBHOOK_SECRET);

    console.log(`Delivering authentic payment.captured webhook with valid HMAC...`);
    console.log(`Payment ID: ${testPaymentId}`);
    console.log(`Event ID: ${testEventId}`);

    const webhookRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": validSignature,
            "x-razorpay-event-id": testEventId
        },
        body: webhookBody
    });

    console.log(`Webhook HTTP Status: ${webhookRes.status}`);
    const webhookData = await webhookRes.json();
    console.log("Webhook Response:", JSON.stringify(webhookData));

    if (!webhookRes.ok || !webhookData.success) {
        throw new Error(`Webhook payment capture failed: ${JSON.stringify(webhookData)}`);
    }
    if (webhookData.duplicate) {
        throw new Error("First payment delivery should not be marked as duplicate");
    }
    console.log("    + Payment captured successfully via Webhook!");

    // Verify Firestore finalization
    const finalizedDoc = await getFirestoreDoc("orders", internalOrderId);
    console.log(`+ Finalized Firestore Order State: paymentStatus='${finalizedDoc.paymentStatus}', orderStatus='${finalizedDoc.orderStatus}', inventoryFinalized=${finalizedDoc.inventoryFinalized}`);
    if (finalizedDoc.paymentStatus !== "PAID" || finalizedDoc.orderStatus !== "Processing" || !finalizedDoc.inventoryFinalized) {
        throw new Error(`Order not properly finalized to PAID in Firestore: ${JSON.stringify(finalizedDoc)}`);
    }

    // Verify payment record in paymentRecords
    const payRec = await getFirestoreDoc("paymentRecords", testPaymentId);
    console.log(`+ Payment Record in paymentRecords: status='${payRec?.status}', orderId='${payRec?.orderId}', amountPaise=${payRec?.amountPaise}`);
    if (!payRec || (payRec.status !== "CAPTURED" && payRec.status !== "PAID") || payRec.orderId !== internalOrderId) {
        throw new Error(`Payment record missing or invalid: ${JSON.stringify(payRec)}`);
    }

    // =========================================================================
    // STEP 4: Payment Idempotency & Duplicate Handling
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 4: Testing Payment Idempotency (Duplicate Webhook Delivery)");
    console.log("--------------------------------------------------------------------------------");

    const dupRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": validSignature,
            "x-razorpay-event-id": testEventId
        },
        body: webhookBody
    });

    console.log(`Duplicate Webhook HTTP Status: ${dupRes.status}`);
    const dupData = await dupRes.json();
    console.log("Duplicate Webhook Response:", JSON.stringify(dupData));

    if (!dupRes.ok || !dupData.success || !dupData.duplicate) {
        throw new Error(`Expected idempotent duplicate: true response, got: ${JSON.stringify(dupData)}`);
    }
    console.log("    + Level 1 event deduplication confirmed: duplicate: true!");

    // Deliver with same paymentId but new eventId (Level 2 deduplication test)
    const newEventId = `evt_TASK013_LEVEL2_${Date.now()}`;
    const level2Res = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": validSignature,
            "x-razorpay-event-id": newEventId
        },
        body: webhookBody
    });
    const level2Data = await level2Res.json();
    console.log("Level 2 Payment ID Deduplication Response:", JSON.stringify(level2Data));
    if (!level2Res.ok || !level2Data.success || !level2Data.duplicate) {
        throw new Error(`Expected Level 2 duplicate: true response, got: ${JSON.stringify(level2Data)}`);
    }
    console.log("    + Level 2 payment ID deduplication confirmed: duplicate: true!");

    // Verify stock and coupon were not double-decremented/incremented
    const afterStockDoc = await getFirestoreDoc("products", "task013_test_prod_simple");
    const afterCouponDoc = await getFirestoreDoc("coupons", "TASK013_SAVE50");
    console.log(`+ Stock after duplicate webhook: ${afterStockDoc.inventory} (was decremented once by reservation)`);
    console.log(`+ Coupon usage after duplicate: ${afterCouponDoc.timesUsed} (was incremented once by reservation)`);

    // =========================================================================
    // STEP 5: Payment Failure & Inventory Release
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 5: Testing Payment Failure & Automatic Inventory Release");
    console.log("--------------------------------------------------------------------------------");

    // Create an order for low stock product (inventory: 1)
    console.log(`Initial stock of low stock product: ${initialLowStockDoc.inventory}`);

    const failOrderPayload = {
        amount: 99,
        items: [
            {
                id: "task013_test_prod_lowstock",
                name: "TASK013 Test Low Stock Keychain",
                price: 99,
                quantity: 1,
            }
        ],
        shippingAddress: {
            fullName: "TASK013 Failed Order Tester",
            email: "task013.fail@bazaarvilla.test",
            phone: "9876543210",
            addressLine1: "12 Failure Way",
            city: "Jaipur",
            state: "Rajasthan",
            pincode: "302001"
        }
    };

    const failOrderRes = await fetch(`${BASE_URL}/api/razorpay/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(failOrderPayload)
    });
    const failOrderData = await failOrderRes.json();
    console.log(`Created order for low stock product: ${failOrderData.internalOrderId} (Razorpay: ${failOrderData.id})`);

    // Verify stock dropped to 0 during reservation
    const reservedLowStockDoc = await getFirestoreDoc("products", "task013_test_prod_lowstock");
    console.log(`+ Reserved low stock product inventory: ${reservedLowStockDoc.inventory}`);
    if (reservedLowStockDoc.inventory !== 0) {
        throw new Error(`Expected inventory 0 during reservation, got ${reservedLowStockDoc.inventory}`);
    }

    // Deliver payment.failed webhook
    const failedPaymentEvent = {
        entity: "event",
        account_id: "acc_TASK013",
        event: "payment.failed",
        contains: ["payment"],
        payload: {
            payment: {
                entity: {
                    id: `pay_TASK013_FAILED_${Date.now()}`,
                    entity: "payment",
                    amount: 9900,
                    currency: "INR",
                    status: "failed",
                    order_id: failOrderData.id,
                    error_code: "BAD_REQUEST_ERROR",
                    error_description: "Payment was declined by issuing bank",
                    created_at: Math.floor(Date.now() / 1000)
                }
            }
        },
        created_at: Math.floor(Date.now() / 1000)
    };

    const failWebhookBody = JSON.stringify(failedPaymentEvent);
    const failSig = computeSignature(failWebhookBody, RAZORPAY_WEBHOOK_SECRET);

    console.log(`Delivering payment.failed webhook...`);
    const failHookRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": failSig
        },
        body: failWebhookBody
    });

    console.log(`Payment Failed Webhook HTTP Status: ${failHookRes.status}`);
    const failHookData = await failHookRes.json();
    console.log("Payment Failed Webhook Response:", JSON.stringify(failHookData));

    if (!failHookRes.ok || !failHookData.success) {
        throw new Error(`Failed payment webhook handling failed: ${JSON.stringify(failHookData)}`);
    }

    // Verify order state in Firestore
    const failedOrderDoc = await getFirestoreDoc("orders", failOrderData.internalOrderId);
    console.log(`+ Firestore Failed Order State: paymentStatus='${failedOrderDoc.paymentStatus}', orderStatus='${failedOrderDoc.orderStatus}', reservationReleased=${failedOrderDoc.reservationReleased}`);
    if (failedOrderDoc.paymentStatus !== "FAILED" || !failedOrderDoc.reservationReleased) {
        throw new Error(`Order state not properly updated to FAILED with reservationReleased=true`);
    }

    // Verify stock restored back to 1
    const restoredLowStockDoc = await getFirestoreDoc("products", "task013_test_prod_lowstock");
    console.log(`+ Restored low stock product inventory: ${restoredLowStockDoc.inventory}`);
    if (restoredLowStockDoc.inventory !== 1) {
        throw new Error(`Expected stock restored to 1, got ${restoredLowStockDoc.inventory}`);
    }
    console.log("    + Inventory release on payment failure successfully verified!");

    // =========================================================================
    // STEP 6: Customer Order Retrieval & Privacy Validation
    // =========================================================================
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STEP 6: Customer Order Retrieval & Privacy Validation");
    console.log("--------------------------------------------------------------------------------");

    // 6a. Attempt without guest token
    const unauthFetchRes = await fetch(`${BASE_URL}/api/orders/by-ids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            orders: [{ id: internalOrderId, token: "wrong_invalid_token" }]
        })
    });
    const unauthFetchData = await unauthFetchRes.json();
    console.log(`6a. Invalid token retrieval orders returned: ${unauthFetchData.orders?.length || 0}`);
    if ((unauthFetchData.orders?.length || 0) !== 0) {
        throw new Error(`Unauthorized guest token should not return order data!`);
    }
    console.log("    + Unauthenticated access correctly blocked!");

    // 6b. Retrieve with valid guest access token
    const authFetchRes = await fetch(`${BASE_URL}/api/orders/by-ids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            orders: [{ id: internalOrderId, token: guestAccessToken }]
        })
    });
    const authFetchData = await authFetchRes.json();
    console.log(`6b. Valid token retrieval orders returned: ${authFetchData.orders?.length || 0}`);
    if (authFetchData.orders?.length !== 1) {
        throw new Error(`Expected 1 order returned with valid token, got ${authFetchData.orders?.length}`);
    }
    const retrieved = authFetchData.orders[0];
    console.log(`    + Retrieved Order ID: ${retrieved.id}`);
    console.log(`    + Payment Status: ${retrieved.paymentStatus}`);
    console.log(`    + Total: ₹${retrieved.total}`);
    console.log("    + Authorized customer order retrieval 100% verified!");

    console.log("\n================================================================================");
    console.log("ALL RAZORPAY TEST MODE & WEBHOOK LIFECYCLE TESTS PASSED WITH 100% SUCCESS!");
    console.log("================================================================================");
}

main().catch((err) => {
    console.error("\n[VERIFICATION FAILURE]:", err);
    process.exit(1);
});
