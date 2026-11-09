import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import * as adminModule from "firebase-admin";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";

const admin = (adminModule as any).default || adminModule;
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS, EXISTING_SYNTHETIC_ORDER } from "../fixtures/orders.ts";

describe("POST /api/orders/create Integration Tests (Firestore Emulator)", () => {
    const mockSecret = "test_razorpay_secret_key_mock_999";

    before(() => {
        process.env.RAZORPAY_KEY_ID = "rzp_test_mock_create";
        process.env.RAZORPAY_KEY_SECRET = mockSecret;

        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (url.includes("/payments/")) {
                return {
                    id: "pay_rzp_mock_67890",
                    entity: "payment",
                    amount: 100000,
                    currency: "INR",
                    status: "captured",
                    order_id: "order_rzp_mock_12345",
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
        await seedEmulatorDatabase(adminDb);
    });

    it("SEC-TEST-001: should reject client price manipulation and enforce database prices", async () => {
        // Product prod-hoodie-1000 is ₹1000 in DB. Attacker attempts to buy 2 units for ₹2 (₹1 each).
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    price: 1, // Tampered price
                    quantity: 2,
                },
            ],
            subtotal: 2,
            total: 2, // Tampered total
            couponCode: null,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        // Server detects total mismatch between client ₹2 and calculated ₹2000
        assert.equal(res.status, 400);
        assert.match(data.error, /total mismatch/i);

        // Verify that NO order was written to Firestore with total ₹2
        const ordersSnap = await adminDb!.collection("orders").where("total", "==", 2).get();
        assert.equal(ordersSnap.empty, true);
    });

    it("SEC-TEST-001b: should create order with authoritative database prices when client sends matching total", async () => {
        // Valid order: 2 units of prod-hoodie-1000 at catalog price ₹1000 = ₹2000
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 2,
                },
            ],
            subtotal: 2000,
            total: 2000,
            couponCode: null,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.total, 2000);

        // Verify persisted document in Firestore
        const savedOrderSnap = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(savedOrderSnap.exists, true);
        const savedData = savedOrderSnap.data();
        assert.equal(savedData?.total, 2000);
        assert.equal(savedData?.items[0].price, 1000);
    });

    it("SEC-TEST-002: should REJECT client paymentStatus: 'PAID' on Cash On Delivery orders", async () => {
        // Attacker attempts to mark COD order as PAID upon creation
        const payload = {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            couponCode: null,
            paymentMethod: "COD",
            paymentStatus: "PAID", // Tampered status
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.paymentStatus, "PENDING"); // Enforced as PENDING

        // Verify in Firestore document
        const savedOrderSnap = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(savedOrderSnap.data()?.paymentStatus, "PENDING");
    });

    it("SEC-TEST-003: should PREVENT order overwrite when client submits an existing order ID", async () => {
        // 1. Pre-seed victim's existing order
        await adminDb!.collection("orders").doc(EXISTING_SYNTHETIC_ORDER.id).set(EXISTING_SYNTHETIC_ORDER);

        // 2. Attacker attempts to overwrite victim's order with attacker's shipping details
        const attackerPayload = {
            id: EXISTING_SYNTHETIC_ORDER.id, // Targeting victim's order
            items: [{ productId: "prod-tshirt-500", quantity: 1 }],
            total: 500,
            couponCode: null,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: {
                ...SYNTHETIC_SHIPPING_ADDRESS,
                fullName: "Malicious Attacker",
                addressLine1: "Attacker Stash House",
            },
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", attackerPayload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.notEqual(data.id, EXISTING_SYNTHETIC_ORDER.id); // Assigned a new unique ID

        // 3. Verify victim's order remains completely intact
        const victimOrderSnap = await adminDb!.collection("orders").doc(EXISTING_SYNTHETIC_ORDER.id).get();
        const victimData = victimOrderSnap.data();
        assert.equal(victimData?.shippingAddress.fullName, "Victim Customer");
        assert.equal(victimData?.total, 1000);
    });

    it("SEC-TEST-006: should REJECT expired, inactive, or exhausted coupons", async () => {
        // Expired coupon
        const reqExpired = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "EXPIRED20",
            total: 800,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resExpired = await createOrderRoute(reqExpired);
        assert.equal(resExpired.status, 400);
        assert.match((await resExpired.json()).error, /expired/i);

        // Inactive coupon
        const reqInactive = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "INACTIVE50",
            total: 500,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resInactive = await createOrderRoute(reqInactive);
        assert.equal(resInactive.status, 400);
        assert.match((await resInactive.json()).error, /not active/i);

        // Usage limit reached coupon
        const reqMaxed = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "MAXEDOUT",
            total: 900,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resMaxed = await createOrderRoute(reqMaxed);
        assert.equal(resMaxed.status, 400);
        assert.match((await resMaxed.json()).error, /limit reached/i);
    });

    it("SEC-TEST-008: should accept valid Razorpay HMAC signatures and reject forged signatures", async () => {
        const orderId = "order_rzp_mock_12345";
        const paymentId = "pay_rzp_mock_67890";
        const validSignature = crypto
            .createHmac("sha256", mockSecret)
            .update(`${orderId}|${paymentId}`)
            .digest("hex");

        // 1. Valid Signature -> PAID status accepted
        const reqValid = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: validSignature,
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resValid = await createOrderRoute(reqValid);
        const dataValid = await resValid.json();
        assert.equal(resValid.status, 200);
        assert.equal(dataValid.paymentStatus, "PAID");

        // 2. Forged Signature -> Rejected
        const reqForged = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: "forged_invalid_hex_signature_abc",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resForged = await createOrderRoute(reqForged);
        assert.equal(resForged.status, 400);
        assert.match((await resForged.json()).error, /signature verification failed/i);
    });

    it("SEC-TEST-QTY: should reject zero, negative, or non-integer quantities", async () => {
        const reqZero = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 0 }],
            total: 0,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resZero = await createOrderRoute(reqZero);
        assert.equal(resZero.status, 400);

        const reqNegative = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: -2 }],
            total: -2000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resNegative = await createOrderRoute(reqNegative);
        assert.equal(resNegative.status, 400);

        const reqFractional = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1.5 }],
            total: 1500,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const resFractional = await createOrderRoute(reqFractional);
        assert.equal(resFractional.status, 400);
    });

    it("DEFECT CHECK: duplicate product lines aggregation before stock verification", async () => {
        // Product prod-scarce-stock-1 has inventory = 1.
        // Malicious or split cart sends 2 separate line items for the same product, each with quantity 1.
        // Total requested = 2, which exceeds available stock of 1!
        const payload = {
            items: [
                { productId: "prod-scarce-stock-1", quantity: 1 },
                { productId: "prod-scarce-stock-1", quantity: 1 },
            ],
            total: 1500,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);

        // Expected: should be rejected because total quantity (2) exceeds inventory (1).
        // Let's assert this behavior to test whether current pricing engine aggregates duplicate IDs:
        assert.equal(res.status, 400, "Should reject when sum of duplicate item quantities exceeds inventory");
    });
});
