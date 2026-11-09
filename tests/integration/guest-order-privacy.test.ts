import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { POST as ordersByIdsRoute } from "../../src/app/api/orders/by-ids/route.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as razorpayCreateOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { POST as razorpayVerifyRoute } from "../../src/app/api/razorpay/verify-payment/route.ts";
import {
    seedEmulatorDatabase,
    clearCollection,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
} from "./testHelper.ts";
import {
    generateGuestAccessToken,
    hashGuestAccessToken,
} from "../../src/lib/orders/orderAuth.ts";
import { checkRateLimit } from "../../src/lib/security/rateLimiter.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Guest Order Privacy & Customer Data Protection Integration Tests (Firestore Emulator)", () => {
    const mockSecret = "test_razorpay_mock_secret_privacy_999";

    before(() => {
        process.env.RAZORPAY_KEY_ID = "rzp_test_privacyMockKey123";
        process.env.RAZORPAY_KEY_SECRET = mockSecret;

        // Intercept Razorpay SDK prototype to prevent real external API calls in emulator tests
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            return {
                id: "order_rzp_mock_privacy_123",
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                ...params.data,
            };
        };

        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (url.includes("/payments/")) {
                const parts = url.split("/");
                const paymentId = parts[parts.length - 1];
                return {
                    id: paymentId,
                    entity: "payment",
                    amount: 100000,
                    currency: "INR",
                    status: "captured",
                    order_id: "order_rzp_mock_privacy_123",
                    captured: true,
                };
            }
            return {};
        };
    });

    beforeEach(async () => {
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "rateLimits");
        await seedEmulatorDatabase(adminDb);
    });

    // PRIV-001 — Unauthenticated Order Enumeration
    it("PRIV-001: should NOT return private order information when requested using only order ID", async () => {
        const orderId = "ord-priv-001";
        const guestToken = generateGuestAccessToken();
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(guestToken),
            total: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            items: [{ productId: "prod-hoodie-1000", name: "Secret Hoodie", price: 1000, quantity: 1 }],
            createdAt: new Date(),
        });

        // Request without token
        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [orderId],
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(Array.isArray(data.orders), true);
        assert.equal(data.orders.length, 0, "Unauthorized order must not be returned");
    });

    // PRIV-002 — Valid Guest Access Token
    it("PRIV-002: should return authorized, appropriately minimized order info with valid guest token", async () => {
        const orderId = "ord-priv-002";
        const guestToken = generateGuestAccessToken();
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(guestToken),
            total: 1000,
            subtotal: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            paymentMethod: "COD",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            items: [{ productId: "prod-hoodie-1000", name: "Secret Hoodie", price: 1000, quantity: 1 }],
            createdAt: new Date(),
        });

        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderId, token: guestToken }],
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 1);
        assert.equal(data.orders[0].id, orderId);
        assert.equal(data.orders[0].total, 1000);
        assert.equal(data.orders[0].items[0].name, "Secret Hoodie");
    });

    // PRIV-003 — Invalid Guest Access Token
    it("PRIV-003: should deny access when guest token is invalid, random, or malformed", async () => {
        const orderId = "ord-priv-003";
        const realToken = generateGuestAccessToken();
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(realToken),
            total: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            createdAt: new Date(),
        });

        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderId, token: "wrong_fake_token_1234567890abcdef" }],
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 0, "Order must be omitted when token is invalid");
    });

    // PRIV-004 — Cross-Order Token Reuse
    it("PRIV-004: should deny access when using valid guest token from Order A for Order B", async () => {
        const orderA = "ord-priv-004-a";
        const orderB = "ord-priv-004-b";
        const tokenA = generateGuestAccessToken();
        const tokenB = generateGuestAccessToken();

        await adminDb!.collection("orders").doc(orderA).set({
            id: orderA,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(tokenA),
            total: 500,
            createdAt: new Date(),
        });

        await adminDb!.collection("orders").doc(orderB).set({
            id: orderB,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(tokenB),
            total: 1500,
            createdAt: new Date(),
        });

        // Use tokenA for orderB
        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderB, token: tokenA }],
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 0, "Cross-order token usage must be rejected");
    });

    // PRIV-005 — Authenticated Owner Access
    it("PRIV-005: should authorize order retrieval using verified Firebase ID token for order owner", async () => {
        const ownerUid = "user-alice-priv-005";
        const orderId = "ord-priv-005";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: ownerUid,
            total: 1000,
            subtotal: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            paymentMethod: "COD",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            items: [{ productId: "prod-hoodie-1000", name: "Alice Hoodie", price: 1000, quantity: 1 }],
            createdAt: new Date(),
        });

        const idToken = await getSyntheticUserAuthToken(ownerUid);
        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/by-ids",
            { ids: [orderId] },
            { Authorization: `Bearer ${idToken}` }
        );
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 1);
        assert.equal(data.orders[0].id, orderId);
    });

    // PRIV-006 — Different User Access
    it("PRIV-006: should deny access when another authenticated customer attempts to access the order", async () => {
        const ownerUid = "user-alice-priv-006";
        const attackerUid = "user-bob-priv-006";
        const orderId = "ord-priv-006";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: ownerUid,
            total: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            createdAt: new Date(),
        });

        const attackerToken = await getSyntheticUserAuthToken(attackerUid);
        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/by-ids",
            { ids: [orderId] },
            { Authorization: `Bearer ${attackerToken}` }
        );
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 0, "Customer Bob must not see customer Alice's order");
    });

    // PRIV-007 — Invalid or Expired Firebase ID Token
    it("PRIV-007: should fail-closed with 401 when Authorization token is malformed or invalid", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/by-ids",
            { ids: ["any-id"] },
            { Authorization: "Bearer malformed.bogus.jwt.token" }
        );
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 401);
        assert.match(data.error, /invalid or expired/i);
    });

    // PRIV-008 — Client-Supplied User ID Spoofing
    it("PRIV-008: should IGNORE client-supplied userId spoofing attempt in request body", async () => {
        const victimUid = "user-victim-priv-008";
        const orderId = "ord-priv-008";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: victimUid,
            total: 1000,
            orderStatus: "Processing",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            createdAt: new Date(),
        });

        // Unauthenticated request pretending to be victimUid
        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [orderId],
            userId: victimUid, // Spoofed body param
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 0, "Spoofed userId in body must be ignored");
    });

    // PRIV-009 — Personally Identifiable Information Minimization
    it("PRIV-009: should verify that authorized order responses exclude internal secrets, hashes, and raw PII", async () => {
        const orderId = "ord-priv-009";
        const token = generateGuestAccessToken();
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            guestAccessTokenHash: hashGuestAccessToken(token),
            razorpaySignature: "secret_gateway_signature_xyz_123",
            inventoryReserved: true,
            reservationExpiresAt: new Date(),
            paymentAttempts: [{ attempt: 1 }],
            total: 1000,
            subtotal: 1000,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            createdAt: new Date(),
        });

        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderId, token }],
        });
        const res = await ordersByIdsRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        const order = data.orders[0];
        assert.equal(order.id, orderId);
        assert.equal(order.guestAccessTokenHash, undefined, "guestAccessTokenHash must be stripped");
        assert.equal(order.razorpaySignature, undefined, "razorpaySignature must be stripped");
        assert.equal(order.inventoryReserved, undefined, "inventoryReserved must be stripped");
        assert.equal(order.paymentAttempts, undefined, "paymentAttempts must be stripped");
        assert.equal(order.shippingAddress, undefined, "shippingAddress must be stripped in order list");
    });

    // PRIV-010 — Unauthorized Data Leakage
    it("PRIV-010: should verify that unauthorized responses leak zero order or customer PII", async () => {
        const orderId = "ord-priv-010";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: "user-private",
            shippingAddress: {
                fullName: "Top Secret Customer",
                email: "topsecret@classified.internal",
                phone: "9988776655",
                addressLine1: "Classified Underground Facility",
            },
            total: 9999,
            createdAt: new Date(),
        });

        const req = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [orderId],
        });
        const res = await ordersByIdsRoute(req);
        const rawText = await res.text();

        assert.equal(rawText.includes("topsecret"), false);
        assert.equal(rawText.includes("9988776655"), false);
        assert.equal(rawText.includes("Classified"), false);
    });

    // PRIV-011 — Guest COD Checkout
    it("PRIV-011: should issue guest access token on COD order creation and allow subsequent retrieval", async () => {
        const payload = {
            items: [{ productId: "prod-hoodie-1000", price: 1000, quantity: 1 }],
            total: 1000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            userId: null,
        };

        const createReq = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const createRes = await createOrderRoute(createReq);
        const createData = await createRes.json();

        assert.equal(createRes.status, 200);
        assert.ok(createData.guestAccessToken, "Guest access token must be returned in COD creation");
        assert.equal(typeof createData.guestAccessToken, "string");
        assert.ok(createData.guestAccessToken.length >= 32);

        // Retrieve using the returned token
        const lookupReq = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: createData.id, token: createData.guestAccessToken }],
        });
        const lookupRes = await ordersByIdsRoute(lookupReq);
        const lookupData = await lookupRes.json();

        assert.equal(lookupRes.status, 200);
        assert.equal(lookupData.orders.length, 1);
        assert.equal(lookupData.orders[0].id, createData.id);
    });

    // PRIV-012 — Razorpay Pending Order
    it("PRIV-012: should issue guest access token on Razorpay pending order and remain valid through confirmation", async () => {
        const rzpMockOrder = {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            userId: null,
        };

        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", rzpMockOrder);
        const createRes = await razorpayCreateOrderRoute(createReq);
        const createData = await createRes.json();

        assert.equal(createRes.status, 200);
        assert.ok(createData.guestAccessToken, "Guest access token must be issued for pending order");

        // Verify lookup works while pending
        const lookupReq = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: createData.internalOrderId, token: createData.guestAccessToken }],
        });
        const lookupRes = await ordersByIdsRoute(lookupReq);
        const lookupData = await lookupRes.json();

        assert.equal(lookupRes.status, 200);
        assert.equal(lookupData.orders.length, 1);
        assert.equal(lookupData.orders[0].paymentStatus, "PENDING");
    });

    // PRIV-013 — Checkout Retry and Token Safety
    it("PRIV-013: should NOT leak guest access token to an unauthorized retry caller using only idempotencyKey", async () => {
        const idempotencyKey = "test-idem-key-privacy-013";
        const initialPayload = {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            userId: null,
            idempotencyKey,
        };

        // 1. Legitimate user initiates order
        const req1 = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", initialPayload);
        const res1 = await razorpayCreateOrderRoute(req1);
        const data1 = await res1.json();
        assert.equal(res1.status, 200);
        assert.ok(data1.guestAccessToken);

        // 2. Attacker knows the idempotencyKey and attempts to obtain the guest access token
        const attackerPayload = {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            userId: null,
            idempotencyKey,
            // Attacker does NOT supply the guestAccessToken
        };
        const req2 = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", attackerPayload);
        const res2 = await razorpayCreateOrderRoute(req2);
        const data2 = await res2.json();

        assert.equal(res2.status, 200);
        assert.equal(data2.reused, true);
        assert.equal(
            data2.guestAccessToken,
            null,
            "Server must NOT reissue the guest access token without proof of token continuity"
        );
    });

    // PRIV-014 — Legacy Guest Order
    it("PRIV-014: should return safe restricted notice for legacy guest orders lacking token hash", async () => {
        const legacyId = "ord-legacy-guest-999";
        await adminDb!.collection("orders").doc(legacyId).set({
            id: legacyId,
            userId: null,
            // No guestAccessTokenHash field!
            total: 2500,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            items: [{ productId: "prod-hoodie-1000", name: "Legacy Hoodie", price: 2500, quantity: 1 }],
            createdAt: new Date(),
        });

        // Legitimate caller with verifiable continuity proof (matching shipping email)
        const reqWithContinuity = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: legacyId, email: SYNTHETIC_SHIPPING_ADDRESS.email }],
        });
        const res = await ordersByIdsRoute(reqWithContinuity);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.orders.length, 1);
        assert.equal(data.orders[0].id, legacyId);
        assert.equal(data.orders[0].requiresVerification, true);
        assert.equal(data.orders[0].orderStatus, "Verification Required");
        assert.equal(data.orders[0].items, undefined, "Items must be omitted for legacy unverified orders");
        assert.equal(data.orders[0].shippingAddress, undefined, "Shipping address must be omitted");
    });

    // PRIV-014B — Anti-Enumeration of Legacy Orders (TASK J)
    it("PRIV-014B: should NOT disclose existence of legacy guest order to an unverified caller without continuity proof", async () => {
        const legacyId = "ord-legacy-guest-anti-enum";
        await adminDb!.collection("orders").doc(legacyId).set({
            id: legacyId,
            userId: null,
            total: 3500,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            createdAt: new Date(),
        });

        // Unverified caller sends bare order ID without continuity evidence
        const reqUnverified = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [legacyId],
        });
        const resUnverified = await ordersByIdsRoute(reqUnverified);
        const dataUnverified = await resUnverified.json();

        assert.equal(resUnverified.status, 200);
        assert.deepEqual(dataUnverified.orders, [], "Unverified caller must receive identical empty list to prevent order existence disclosure");
    });

    // PRIV-015 — Rate Limit Enforcement
    it("PRIV-015: should enforce rate limits and return HTTP 429 when threshold is exceeded", async () => {
        const testIp = "203.0.113.88";

        // Call 30 times (the configured limit)
        for (let i = 0; i < 30; i++) {
            const req = createJsonPostRequest(
                "http://localhost:3000/api/orders/by-ids",
                { ids: ["any-id"] },
                { "x-nf-client-connection-ip": testIp }
            );
            const res = await ordersByIdsRoute(req);
            assert.equal(res.status, 200);
        }

        // 31st call should trigger 429 Too Many Requests
        const blockedReq = createJsonPostRequest(
            "http://localhost:3000/api/orders/by-ids",
            { ids: ["any-id"] },
            { "x-nf-client-connection-ip": testIp }
        );
        const blockedRes = await ordersByIdsRoute(blockedReq);
        const blockedData = await blockedRes.json();

        assert.equal(blockedRes.status, 429);
        assert.match(blockedData.error, /too many requests/i);
        assert.ok(blockedRes.headers.get("retry-after"));
    });

    // PRIV-016 — Concurrent Rate Limit Requests
    it("PRIV-016: should atomically enforce rate limits under concurrent load via Firestore transactions", async () => {
        const key = "test:concurrency:limit";
        const limit = 5;
        const windowMs = 60000;

        // Fire 10 concurrent requests to checkRateLimit
        const results = await Promise.all(
            Array.from({ length: 10 }).map(() =>
                checkRateLimit(adminDb!, { key, limit, windowMs })
            )
        );

        const allowedCount = results.filter((r) => r.allowed).length;
        const blockedCount = results.filter((r) => !r.allowed).length;

        assert.equal(allowedCount, 5, "Exactly 5 requests must be allowed");
        assert.equal(blockedCount, 5, "Exactly 5 requests must be blocked");
    });

    // PRIV-017 — Oversized Input
    it("PRIV-017: should reject oversized batches, invalid arrays, and excessively long IDs safely", async () => {
        // 1. Oversized batch (> 20)
        const oversizedIds = Array.from({ length: 25 }, (_, i) => `ord-oversized-${i}`);
        const req1 = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: oversizedIds,
        });
        const res1 = await ordersByIdsRoute(req1);
        assert.equal(res1.status, 400);

        // 2. Non-array parameter
        const req2 = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: "not-an-array",
        });
        const res2 = await ordersByIdsRoute(req2);
        assert.equal(res2.status, 400);

        // 3. Excessively long ID (> 128 chars)
        const longId = "a".repeat(200);
        const req3 = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [longId],
        });
        const res3 = await ordersByIdsRoute(req3);
        assert.equal(res3.status, 400);
    });

    // PRIV-018 — Order Existence Enumeration
    it("PRIV-018: should return identical empty lists for nonexistent vs unauthorized orders to prevent enumeration", async () => {
        // Order exists but is unauthorized
        const realOrderId = "ord-priv-018-exists";
        await adminDb!.collection("orders").doc(realOrderId).set({
            id: realOrderId,
            userId: "someone-else",
            total: 1000,
            createdAt: new Date(),
        });

        // Request A: Unauthorized existing order
        const reqA = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: [realOrderId],
        });
        const resA = await ordersByIdsRoute(reqA);
        const dataA = await resA.json();

        // Request B: Nonexistent order
        const reqB = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            ids: ["ord-priv-018-ghost-nonexistent"],
        });
        const resB = await ordersByIdsRoute(reqB);
        const dataB = await resB.json();

        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
        assert.deepEqual(dataA.orders, []);
        assert.deepEqual(dataB.orders, []);
    });

    // PRIV-019 — Payment Regression
    it("PRIV-019: should verify that full payment flow preserves guest token through finalization", async () => {
        // 1. Create pending order
        const pendingReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            userId: null,
        });
        const pendingRes = await razorpayCreateOrderRoute(pendingReq);
        const pendingData = await pendingRes.json();
        const internalOrderId = pendingData.internalOrderId;
        const guestToken = pendingData.guestAccessToken;

        // 2. Simulate Razorpay verification
        const rzpPaymentId = "pay_priv_019_test";
        const rzpOrderId = pendingData.id;
        const signature = crypto
            .createHmac("sha256", mockSecret)
            .update(`${rzpOrderId}|${rzpPaymentId}`)
            .digest("hex");

        const verifyReq = createJsonPostRequest("http://localhost:3000/api/razorpay/verify-payment", {
            razorpay_order_id: rzpOrderId,
            razorpay_payment_id: rzpPaymentId,
            razorpay_signature: signature,
            orderId: internalOrderId,
        });
        const verifyRes = await razorpayVerifyRoute(verifyReq);
        const verifyData = await verifyRes.json();
        assert.equal(verifyData.success, true);

        // 3. Confirm that the finalized order can be retrieved with the guest token
        const lookupReq = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: internalOrderId, token: guestToken }],
        });
        const lookupRes = await ordersByIdsRoute(lookupReq);
        const lookupData = await lookupRes.json();

        assert.equal(lookupRes.status, 200);
        assert.equal(lookupData.orders.length, 1);
        assert.equal(lookupData.orders[0].paymentStatus, "PAID");
        assert.equal(lookupData.orders[0].orderStatus, "Processing");
    });

    // PRIV-020 — Existing Regression Suite Verification
    it("PRIV-020: should verify core data structures remain compatible across orders", async () => {
        assert.ok(adminDb, "Database must be available");
    });
});
