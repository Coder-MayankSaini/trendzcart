import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { NextRequest } from "next/server";
import { POST as webhookRoute } from "../../src/app/api/webhooks/razorpay/route.ts";
import { POST as verifyPaymentRoute } from "../../src/app/api/razorpay/verify-payment/route.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as getOrdersByIdsRoute } from "../../src/app/api/orders/by-ids/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import {
    finalizeOrderPayment,
    releaseExpiredReservation,
} from "../../src/lib/orders/paymentLifecycle.ts";
import { runReservationCleanup } from "../../src/lib/orders/reservationCleanup.ts";
import { recoverGatewayOrderForReceipt } from "../../src/lib/orders/gatewayRecovery.ts";
import { verifyPaymentWithGateway } from "../../src/lib/orders/gatewayVerification.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("TRUST-001 to TRUST-020: Payment Trust Boundary & Integrity Verification (Firestore Emulator)", () => {
    const mockKeyId = "rzp_test_trust_key_101";
    const mockKeySecret = "trust_secret_mock_202";
    const mockWebhookSecret = "trust_webhook_secret_mock_303";

    let mockGatewayPaymentResponse: any = null;
    let mockPaymentFetchError: Error | null = null;
    let mockOrdersFetchPaymentsResponse: any = null;

    before(() => {
        process.env.RAZORPAY_KEY_ID = mockKeyId;
        process.env.RAZORPAY_KEY_SECRET = mockKeySecret;
        process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

        // Intercept Razorpay SDK prototype to safely mock server-to-server gateway calls
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);

        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (mockPaymentFetchError) {
                throw mockPaymentFetchError;
            }
            if (url.includes("/payments/") && !url.includes("/orders/")) {
                if (mockGatewayPaymentResponse) {
                    return mockGatewayPaymentResponse;
                }
                const err: any = new Error("The id provided does not exist");
                err.statusCode = 400;
                err.error = { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" };
                throw err;
            }
            if (url.includes("/orders/") && url.includes("/payments")) {
                return mockOrdersFetchPaymentsResponse || { entity: "collection", count: 0, items: [] };
            }
            return {};
        };
    });

    beforeEach(async () => {
        mockGatewayPaymentResponse = null;
        mockPaymentFetchError = null;
        mockOrdersFetchPaymentsResponse = null;

        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "paymentRecords");
        await clearCollection(adminDb, "paymentWebhookEvents");
        await clearCollection(adminDb, "unmatchedPayments");
        await clearCollection(adminDb, "products");
        await clearCollection(adminDb, "coupons");
        await seedEmulatorDatabase(adminDb);
    });

    function createSignedWebhookRequest(
        eventPayload: any,
        secret = mockWebhookSecret,
        eventId?: string,
        signatureOverride?: string
    ): NextRequest {
        const rawBody = JSON.stringify(eventPayload);
        const signature =
            signatureOverride !== undefined
                ? signatureOverride
                : crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-razorpay-signature": signature,
        };
        if (eventId) {
            headers["x-razorpay-event-id"] = eventId;
        }

        return new NextRequest(new Request("http://localhost:3000/api/webhooks/razorpay", {
            method: "POST",
            headers,
            body: rawBody,
        }));
    }

    async function createTestPendingOrder(orderId: string, rzpOrderId: string, amountPaise = 100000, currency = "INR") {
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: amountPaise / 100 }],
            total: amountPaise / 100,
            amountPaise,
            currency,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            gatewayState: "READY_FOR_PAYMENT",
            orderStatus: "Pending",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: true,
            inventoryFinalized: false,
            reservationReleased: false,
            razorpayOrderId: rzpOrderId,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    }

    // TRUST-001: Signed webhook with nonexistent payment cannot mark order PAID
    it("TRUST-001: should reject signed webhook referring to nonexistent payment ID", async () => {
        const orderId = "order_trust_001";
        const rzpOrderId = "rzp_order_trust_001";
        await createTestPendingOrder(orderId, rzpOrderId, 100000);

        // Gateway returns 400 does not exist
        mockPaymentFetchError = Object.assign(new Error("The id provided does not exist"), {
            statusCode: 400,
            error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" },
        });

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_synthetic_fake_001",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_001"));
        assert.equal(res.status, 400);

        // Crucial invariant: Order MUST remain PENDING!
        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.orderStatus, "Pending");

        const payRec = await adminDb!.collection("paymentRecords").doc("pay_synthetic_fake_001").get();
        assert.equal(payRec.exists, false);
    });

    // TRUST-002: Signed webhook claiming captured when gateway status is created cannot finalize
    it("TRUST-002: should reject webhook claiming captured status when gateway status is created", async () => {
        const orderId = "order_trust_002";
        const rzpOrderId = "rzp_order_trust_002";
        await createTestPendingOrder(orderId, rzpOrderId, 100000);

        mockGatewayPaymentResponse = {
            id: "pay_created_002",
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "created",
            captured: false,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_created_002",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured", // False claim in payload
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_002"));
        assert.equal(res.status, 400);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
    });

    // TRUST-003: Authorized-but-not-captured payment does not become PAID
    it("TRUST-003: should record payment.authorized attempt without marking order as PAID", async () => {
        const orderId = "order_trust_003";
        const rzpOrderId = "rzp_order_trust_003";
        await createTestPendingOrder(orderId, rzpOrderId, 100000);

        const authPayload = {
            event: "payment.authorized",
            payload: {
                payment: {
                    entity: {
                        id: "pay_auth_003",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "authorized",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(authPayload, mockWebhookSecret, "evt_trust_003"));
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.status, "AUTHORIZED");

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        const orderData = orderSnap.data();
        assert.equal(orderData?.paymentStatus, "PENDING");
        assert.equal(orderData?.gatewayState, "PAYMENT_AUTHORIZED");
        assert.equal(orderData?.paymentAttempts?.length, 1);
        assert.equal(orderData?.paymentAttempts[0].status, "AUTHORIZED");
    });

    // TRUST-004: Genuine captured payment with matching amount, currency, and order ID finalizes exactly once
    it("TRUST-004: should authoritatively finalize genuine captured payment matching all parameters", async () => {
        const orderId = "order_trust_004";
        const rzpOrderId = "rzp_order_trust_004";
        const paymentId = "pay_genuine_004";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockGatewayPaymentResponse = {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_004"));
        assert.equal(res.status, 200);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
        assert.equal(orderSnap.data()?.inventoryFinalized, true);

        const payRec = await adminDb!.collection("paymentRecords").doc(paymentId).get();
        assert.equal(payRec.exists, true);
        assert.equal(payRec.data()?.status, "CAPTURED");
    });

    // TRUST-005: Gateway payment amount mismatch is rejected
    it("TRUST-005: should reject payment when gateway amount does not match order payable total", async () => {
        const orderId = "order_trust_005";
        const rzpOrderId = "rzp_order_trust_005";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        // Gateway reports ₹500 (50000 paise) instead of expected ₹1000 (100000 paise)
        mockGatewayPaymentResponse = {
            id: "pay_amount_mismatch_005",
            order_id: rzpOrderId,
            amount: 50000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_amount_mismatch_005",
                        order_id: rzpOrderId,
                        amount: 50000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_005"));
        assert.equal(res.status, 400);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.notEqual(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // TRUST-006: Gateway currency mismatch is rejected
    it("TRUST-006: should reject payment when gateway currency does not match order currency", async () => {
        const orderId = "order_trust_006";
        const rzpOrderId = "rzp_order_trust_006";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockGatewayPaymentResponse = {
            id: "pay_curr_mismatch_006",
            order_id: rzpOrderId,
            amount: 100000,
            currency: "USD", // Mismatched currency
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_curr_mismatch_006",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "USD",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_006"));
        assert.equal(res.status, 400);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.notEqual(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // TRUST-007: Gateway order ID mismatch is rejected
    it("TRUST-007: should reject payment when gateway payment references a different order ID", async () => {
        const orderId = "order_trust_007";
        const rzpOrderId = "rzp_order_trust_007";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        // Gateway payment belongs to an unrelated gateway order
        mockGatewayPaymentResponse = {
            id: "pay_order_mismatch_007",
            order_id: "rzp_order_unrelated_999",
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_order_mismatch_007",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_007"));
        assert.equal(res.status, 400);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.notEqual(orderSnap.data()?.paymentStatus, "PAID");
    });

    // TRUST-008: Gateway payment lookup failure preserves a safe reconciliation state
    it("TRUST-008: should fail-closed on gateway network error and preserve order reconciliation state", async () => {
        const orderId = "order_trust_008";
        const rzpOrderId = "rzp_order_trust_008";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockPaymentFetchError = new Error("Gateway connection timeout ETIMEDOUT");

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_timeout_008",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_trust_008"));
        assert.equal(res.status, 502);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        // Invariant: MUST NOT mark PAID on timeout
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reconciliationReason, "GATEWAY_TIMEOUT_DURING_WEBHOOK");
    });

    // TRUST-009: Duplicate webhook event is idempotent
    it("TRUST-009: should acknowledge duplicate webhook event idempotently without modifying state", async () => {
        const orderId = "order_trust_009";
        const rzpOrderId = "rzp_order_trust_009";
        const paymentId = "pay_dup_009";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockGatewayPaymentResponse = {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        // First delivery
        const res1 = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_dup_009"));
        assert.equal(res1.status, 200);
        assert.equal((await res1.json()).duplicate, false);

        // Second delivery (same event ID)
        const res2 = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_dup_009"));
        assert.equal(res2.status, 200);
        assert.equal((await res2.json()).duplicate, true);
    });

    // TRUST-010: Same payment ID delivered under multiple event IDs finalizes once
    it("TRUST-010: should enforce payment ID uniqueness across different event IDs", async () => {
        const orderId = "order_trust_010";
        const rzpOrderId = "rzp_order_trust_010";
        const paymentId = "pay_unique_010";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockGatewayPaymentResponse = {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        // Event A
        const resA = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_10_A"));
        assert.equal(resA.status, 200);

        // Event B (different event ID, same payment ID)
        const resB = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_10_B"));
        assert.equal(resB.status, 200);
        assert.equal((await resB.json()).duplicate, true);
    });

    // TRUST-011: Webhook and browser verification race cannot double-finalize
    it("TRUST-011: should handle concurrent race between browser callback and webhook safely", async () => {
        const orderId = "order_trust_011";
        const rzpOrderId = "rzp_order_trust_011";
        const paymentId = "pay_race_011";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        mockGatewayPaymentResponse = {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const signature = crypto.createHmac("sha256", mockKeySecret).update(`${rzpOrderId}|${paymentId}`).digest("hex");

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const browserReq = createJsonPostRequest("http://localhost:3000/api/razorpay/verify-payment", {
            razorpay_order_id: rzpOrderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            orderId,
        });
        const webhookReq = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_race_011");

        // Execute concurrently
        const [browserRes, webhookRes] = await Promise.all([
            verifyPaymentRoute(browserReq),
            webhookRoute(webhookReq),
        ]);

        assert.equal(browserRes.status, 200);
        assert.equal(webhookRes.status, 200);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");

        // Verify stock is not decremented twice
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10); // Catalog stock maintained
    });

    // TRUST-012: Delayed captured payment is reconciled without corrupting inventory
    it("TRUST-012: should reconcile late captured payment after reservation release without overselling", async () => {
        const orderId = "order_trust_012";
        const rzpOrderId = "rzp_order_trust_012";
        const paymentId = "pay_late_012";

        // Create expired order with released reservation
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            paymentMethod: "RAZORPAY",
            paymentStatus: "EXPIRED",
            orderStatus: "Expired",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: false,
            reservationReleased: true,
            razorpayOrderId: rzpOrderId,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Set product stock to 0 to test negative-stock prevention
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 0 });

        mockGatewayPaymentResponse = {
            id: paymentId,
            order_id: rzpOrderId,
            amount: 100000,
            currency: "INR",
            status: "captured",
            captured: true,
        };

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_late_012"));
        assert.equal(res.status, 200);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        const orderData = orderSnap.data();
        assert.equal(orderData?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderData?.reconciliationRequired, true);

        // Product inventory must remain 0 and NOT drop to -1
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 0);
    });

    // TRUST-013: Older payment.authorized event cannot regress an already PAID order
    it("TRUST-013: should ignore older payment.authorized webhook on an already PAID order", async () => {
        const orderId = "order_trust_013";
        const rzpOrderId = "rzp_order_trust_013";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        // Mark PAID first
        await adminDb!.collection("orders").doc(orderId).update({
            paymentStatus: "PAID",
            orderStatus: "Processing",
            razorpayPaymentId: "pay_captured_prior_013",
        });

        const authPayload = {
            event: "payment.authorized",
            payload: {
                payment: {
                    entity: {
                        id: "pay_older_auth_013",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "authorized",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(authPayload, mockWebhookSecret, "evt_trust_013"));
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ignored, true);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
    });

    // TRUST-014: Payment failure event cannot overwrite a legitimately captured payment
    it("TRUST-014: should ignore payment.failed webhook when order is already PAID", async () => {
        const orderId = "order_trust_014";
        const rzpOrderId = "rzp_order_trust_014";
        await createTestPendingOrder(orderId, rzpOrderId, 100000, "INR");

        await adminDb!.collection("orders").doc(orderId).update({
            paymentStatus: "PAID",
            orderStatus: "Processing",
            razorpayPaymentId: "pay_captured_valid_014",
        });

        const failPayload = {
            event: "payment.failed",
            payload: {
                payment: {
                    entity: {
                        id: "pay_failed_stale_014",
                        order_id: rzpOrderId,
                        amount: 100000,
                        currency: "INR",
                        status: "failed",
                        error_description: "Bank timeout",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(failPayload, mockWebhookSecret, "evt_trust_014"));
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ignored, true);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
    });

    // TRUST-015: Cleanup cannot release inventory when gateway status is unresolved
    it("TRUST-015: should NOT release inventory during cleanup if order has uncertain gateway state", async () => {
        const orderId = "order_trust_015";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            total: 1000,
            amountPaise: 100000,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            gatewayState: "GATEWAY_STATE_UNCERTAIN",
            orderStatus: "Pending",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 30 * 60 * 1000), // Expired 30 mins ago
            lastGatewayAttemptAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago (within observation window)
            createdAt: new Date(Date.now() - 35 * 60 * 1000),
            updatedAt: new Date(),
        });

        const mockClient = {
            orders: {
                all: async () => ({ count: 0, items: [] }),
            },
        };

        const result = await runReservationCleanup(adminDb!, 10, { razorpayClient: mockClient });
        assert.equal(result.released, 0);
        assert.equal(result.reconciliationCount, 1);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        // Inventory must remain reserved!
        assert.equal(orderSnap.data()?.inventoryReserved, true);
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // TRUST-016: Gateway recovery cannot associate a different merchant order or mismatched receipt
    it("TRUST-016: should fail-closed during receipt recovery when gateway returns mismatched receipt", async () => {
        const mockClient = {
            orders: {
                all: async () => ({
                    count: 1,
                    items: [
                        {
                            id: "order_other_merchant_16",
                            receipt: "mismatched_receipt_different_id",
                            amount: 100000,
                            currency: "INR",
                        },
                    ],
                }),
            },
        };

        const recovery = await recoverGatewayOrderForReceipt(mockClient, "expected_receipt_16", 100000, "INR");
        assert.equal(recovery.found, false);
        assert.equal(recovery.count, 0); // Filtered out because receipt did not match
    });

    // TRUST-017: Synthetic invalid PAID records are detected by the reconciliation audit
    it("TRUST-017: should detect synthetic invalid payment records where gateway reports id does not exist", async () => {
        const syntheticPaymentId = "pay_TASK013_SYNTHETIC_AUDIT_TEST";
        const orderId = "order_trust_017";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            paymentStatus: "PAID",
            razorpayPaymentId: syntheticPaymentId,
            amountPaise: 14900,
            currency: "INR",
        });

        // Gateway returns 400 does not exist
        const mockClient = {
            payments: {
                fetch: async () => {
                    const err: any = new Error("The id provided does not exist");
                    err.statusCode = 400;
                    err.error = { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" };
                    throw err;
                },
            },
        };

        const result = await verifyPaymentWithGateway(mockClient, {
            paymentId: syntheticPaymentId,
            expectedAmountPaise: 14900,
            expectedCurrency: "INR",
        });

        assert.equal(result.verified, false);
        assert.equal(result.notFound, true);
        assert.match(result.error || "", /does not exist/i);
    });

    // TRUST-018: Guest order privacy remains intact after reconciliation
    it("TRUST-018: should prevent unauthorized guest lookup after payment reconciliation", async () => {
        const orderId = "order_trust_018";
        const rawGuestToken = "guest_token_secret_18";
        const tokenHash = crypto.createHash("sha256").update(rawGuestToken).digest("hex");

        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            guestAccessTokenHash: tokenHash,
            paymentStatus: "PAID",
            orderStatus: "Processing",
            total: 1000,
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        // 1. Invalid token lookup -> 0 orders
        const reqInvalid = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderId, token: "wrong_token_forged" }],
        });
        const resInvalid = await getOrdersByIdsRoute(reqInvalid);
        assert.equal((await resInvalid.json()).orders?.length, 0);

        // 2. Valid token lookup -> exactly 1 order
        const reqValid = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orders: [{ id: orderId, token: rawGuestToken }],
        });
        const resValid = await getOrdersByIdsRoute(reqValid);
        const dataValid = await resValid.json();
        assert.equal(dataValid.orders?.length, 1);
        assert.equal(dataValid.orders[0].id, orderId);
    });

    // TRUST-019: COD orders remain independent of Razorpay
    it("TRUST-019: should ensure Cash On Delivery orders remain independent of Razorpay gateway", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.paymentStatus, "PENDING");

        // Verify persisted order document in Firestore
        const savedOrderSnap = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(savedOrderSnap.exists, true);
        const savedOrder = savedOrderSnap.data();
        assert.equal(savedOrder?.paymentMethod, "COD");
        assert.equal(savedOrder?.paymentStatus, "PENDING");
        assert.equal(savedOrder?.razorpayOrderId, null);
        assert.equal(savedOrder?.razorpayPaymentId, null);
    });

    // TRUST-020: Repeated reservation cleanup cannot restore the same stock twice
    it("TRUST-020: should ensure repeated reservation cleanup cannot restore stock twice", async () => {
        const orderId = "order_trust_020";
        await adminDb!.collection("orders").doc(orderId).set({
            id: orderId,
            userId: null,
            items: [{ productId: "prod-hoodie-1000", quantity: 2, price: 1000 }],
            total: 2000,
            amountPaise: 200000,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            gatewayState: "NOT_STARTED", // Never initiated at gateway -> safe to release
            orderStatus: "Pending",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 30 * 60 * 1000),
            createdAt: new Date(Date.now() - 35 * 60 * 1000),
            updatedAt: new Date(),
        });

        // Initial inventory is 10
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 10 });

        // First cleanup execution: releases and restores 2 units (stock becomes 12)
        const result1 = await runReservationCleanup(adminDb!, 10);
        assert.equal(result1.released, 1);

        const prodSnap1 = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap1.data()?.inventory, 12);

        // Second cleanup execution: should skip already-released order, stock must remain 12
        const result2 = await runReservationCleanup(adminDb!, 10);
        assert.equal(result2.released, 0);

        const prodSnap2 = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap2.data()?.inventory, 12);
    });
});
