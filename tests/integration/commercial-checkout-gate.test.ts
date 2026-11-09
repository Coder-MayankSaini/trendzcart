import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { GET as publicConfigRoute } from "../../src/app/api/razorpay/public-config/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("GATE-001 to GATE-008: Commercial Checkout Gate & Quarantine Safeguards (Firestore Emulator)", () => {
    const mockTestAuthSecret = "test_auth_secret_token_task015_999";

    before(() => {
        process.env.RAZORPAY_KEY_ID = "rzp_mock_gate_key";
        process.env.RAZORPAY_KEY_SECRET = "mock_gate_secret_123";
        process.env.TEST_CHECKOUT_AUTHORIZATION_TOKEN = mockTestAuthSecret;

        // Mock Razorpay SDK prototype to avoid external network calls during test
        const dummy = new Razorpay({ key_id: "rzp_mock_client", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.get = async function () {
            return {};
        };
        apiProto.post = async function (params: any) {
            return {
                id: "order_gate_mock_12345",
                entity: "order",
                amount: 100000,
                amount_paid: 0,
                amount_due: 100000,
                currency: "INR",
                receipt: "test_receipt",
                status: "created",
                attempts: 0,
            };
        };
    });

    beforeEach(async () => {
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await seedEmulatorDatabase(adminDb);
    });

    it("GATE-001: should reject public COD order creation when commercial checkout is disabled", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            couponCode: null,
            userId: null,
        });

        const res = await createOrderRoute(req as any);
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.code, "COMMERCIAL_CHECKOUT_DISABLED");
        assert.ok(data.error.includes("Ordering will open soon"));

        // Ensure zero orders were written to Firestore
        const ordersSnap = await adminDb.collection("orders").get();
        assert.equal(ordersSnap.size, 0);
    });

    it("GATE-002: should reject public Razorpay prepaid order creation when commercial checkout is disabled", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            receipt: "order_gate_test_002",
        });

        const res = await createRazorpayOrderRoute(req as any);
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.code, "COMMERCIAL_CHECKOUT_DISABLED");

        // Ensure zero orders were written to Firestore
        const ordersSnap = await adminDb.collection("orders").get();
        assert.equal(ordersSnap.size, 0);
    });

    it("GATE-003: should prevent arbitrary client body flags from bypassing the checkout gate", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            couponCode: null,
            userId: null,
            isTest: true,
            bypassGate: true,
            testMode: true,
        });

        const res = await createOrderRoute(req as any);
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.code, "COMMERCIAL_CHECKOUT_DISABLED");
    });

    it("GATE-004: should allow order creation when valid secret test authorization header is provided", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";

        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
                paymentStatus: "PENDING",
                couponCode: null,
                userId: null,
            },
            {
                "x-bazaarvilla-test-authorization": mockTestAuthSecret,
            }
        );

        const res = await createOrderRoute(req as any);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.id);
        assert.equal(data.success, true);
        assert.equal(data.orderStatus, "Processing");

        // Verify order saved in Firestore
        const savedDoc = await adminDb.collection("orders").doc(data.id).get();
        assert.equal(savedDoc.exists, true);
    });

    it("GATE-005: should reject invalid test authorization header with HTTP 503", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";

        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
                paymentStatus: "PENDING",
                couponCode: null,
                userId: null,
            },
            {
                "x-bazaarvilla-test-authorization": "wrong_forged_secret_token",
            }
        );

        const res = await createOrderRoute(req as any);
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.code, "COMMERCIAL_CHECKOUT_DISABLED");
    });

    it("GATE-006: should allow public orders normally when COMMERCIAL_CHECKOUT_ENABLED=true", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            couponCode: null,
            userId: null,
        });

        const res = await createOrderRoute(req as any);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.id);
        assert.equal(data.paymentStatus, "PENDING");
    });

    it("GATE-007: public-config route should expose commercialCheckoutEnabled state", async () => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "false";
        const resFalse = await publicConfigRoute();
        const dataFalse = await resFalse.json();
        assert.equal(dataFalse.commercialCheckoutEnabled, false);

        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
        const resTrue = await publicConfigRoute();
        const dataTrue = await resTrue.json();
        assert.equal(dataTrue.commercialCheckoutEnabled, true);

        // Reset
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
    });

    it("GATE-008: should verify quarantined orders are safely protected from accidental fulfillment", async () => {
        const orderId = "test_order_quarantined_008";
        await adminDb.collection("orders").doc(orderId).set({
            orderStatus: "Cancelled",
            paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT",
            quarantined: true,
            quarantinedAt: new Date().toISOString(),
            total: 149,
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            createdAt: new Date().toISOString(),
        });

        const docSnap = await adminDb.collection("orders").doc(orderId).get();
        const data = docSnap.data();
        assert.equal(data?.quarantined, true);
        assert.equal(data?.paymentStatus, "UNPAID_SYNTHETIC_ARTIFACT");
    });
});
