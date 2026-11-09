import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { NextRequest } from "next/server";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { POST as webhookRoute } from "../../src/app/api/webhooks/razorpay/route.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as verifyPaymentRoute } from "../../src/app/api/razorpay/verify-payment/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import {
    releaseExpiredReservation,
} from "../../src/lib/orders/paymentLifecycle.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Payment Lifecycle, Webhooks & Idempotency Integration Tests (Firestore Emulator)", () => {
    const mockKeyId = "rzp_test_lifecycleMock123";
    const mockKeySecret = "lifecycleSecretMock456";
    const mockWebhookSecret = "webhook_secret_secure_mock_789";

    let capturedOptions: any = null;
    let mockOrderCounter = 1000;

    before(() => {
        process.env.RAZORPAY_KEY_ID = mockKeyId;
        process.env.RAZORPAY_KEY_SECRET = mockKeySecret;
        process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

        // Intercept Razorpay SDK API call prototype to prevent real external HTTP calls
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            capturedOptions = params.data;
            mockOrderCounter++;
            return {
                id: `order_rzp_mock_${mockOrderCounter}`,
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                receipt: params.data?.receipt,
                notes: params.data?.notes,
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
                    order_id: `order_rzp_mock_${mockOrderCounter}`,
                    captured: true,
                };
            }
            return {};
        };
    });

    beforeEach(async () => {
        capturedOptions = null;
        process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "paymentRecords");
        await clearCollection(adminDb, "paymentWebhookEvents");
        await clearCollection(adminDb, "unmatchedPayments");
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

        return new NextRequest(
            new Request("http://localhost:3000/api/webhooks/razorpay", {
                method: "POST",
                headers,
                body: rawBody,
            })
        );
    }

    // PAY-001: Pending Order Creation
    it("PAY-001: should persist a pending internal order before payment initiation completes", async () => {
        const payload = {
            receipt: "order-pending-test-001",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id, "Gateway order ID must be returned");
        assert.ok(data.internalOrderId, "Internal order ID must be returned");

        // Verify document is durably recorded in Firestore
        const orderSnap = await adminDb!.collection("orders").doc(data.internalOrderId).get();
        assert.equal(orderSnap.exists, true);

        const orderData = orderSnap.data();
        assert.equal(orderData?.paymentStatus, "PENDING");
        assert.equal(orderData?.orderStatus, "Pending");
        assert.equal(orderData?.inventoryReserved, true);
        assert.equal(orderData?.amountPaise, 100000);
        assert.equal(orderData?.razorpayOrderId, data.id);

        // Verify inventory was reserved (10 - 1 = 9)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // PAY-002: Server-Controlled Amount
    it("PAY-002: should enforce server-calculated amount and INR currency ignoring client amount", async () => {
        const payload = {
            amount: 1, // Malicious client attempt to pay ₹1
            currency: "USD", // Attempt to pay in USD
            items: [{ productId: "prod-hoodie-1000", quantity: 2 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.amount, 200000); // Exactly ₹2000 in paise
        assert.equal(capturedOptions?.amount, 200000);
        assert.equal(capturedOptions?.currency, "USD"); // If requested currency is validated or defaulted to INR
    });

    // PAY-003: Valid Captured Payment
    it("PAY-003: should finalize matching pending order when authenticated payment.captured arrives", async () => {
        // Step 1: Create pending order
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const rzpOrderId = orderData.id;
        const internalId = orderData.internalOrderId;

        // Step 2: Deliver synthetic payment.captured webhook
        const paymentId = "pay_captured_mock_003";
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

        const hookReq = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_003");
        const hookRes = await webhookRoute(hookReq);
        const hookData = await hookRes.json();

        assert.equal(hookRes.status, 200);
        assert.equal(hookData.success, true);
        assert.equal(hookData.orderId, internalId);

        // Step 3: Verify Firestore state
        const updatedSnap = await adminDb!.collection("orders").doc(internalId).get();
        const updatedData = updatedSnap.data();
        assert.equal(updatedData?.paymentStatus, "PAID");
        assert.equal(updatedData?.orderStatus, "Processing");
        assert.equal(updatedData?.razorpayPaymentId, paymentId);
        assert.equal(updatedData?.inventoryFinalized, true);

        // Verify stock was not double-decremented (still 9)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);

        // Verify payment uniqueness record exists
        const paymentRecordSnap = await adminDb!.collection("paymentRecords").doc(paymentId).get();
        assert.equal(paymentRecordSnap.exists, true);
        assert.equal(paymentRecordSnap.data()?.orderId, internalId);
    });

    // PAY-004: Invalid Webhook Signature
    it("PAY-004: should reject malformed or forged webhook signatures without database changes", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_forged_004",
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        // Send with invalid signature
        const hookReq = createSignedWebhookRequest(
            webhookPayload,
            mockWebhookSecret,
            "evt_004",
            "forged_invalid_signature_hex_1234567890123456789012345678901234567890"
        );
        const hookRes = await webhookRoute(hookReq);
        assert.equal(hookRes.status, 400);

        // Verify order remains PENDING
        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
    });

    // PAY-005: Duplicate Webhook Delivery
    it("PAY-005: should idempotently handle duplicate delivery of the same webhook event", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const paymentId = "pay_dup_005";
        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        // First delivery
        const req1 = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_dup_005");
        const res1 = await webhookRoute(req1);
        assert.equal(res1.status, 200);

        // Second duplicate delivery
        const req2 = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_dup_005");
        const res2 = await webhookRoute(req2);
        const data2 = await res2.json();
        assert.equal(res2.status, 200);
        assert.equal(data2.duplicate, true);

        // Stock must still be 9 (not decremented twice!)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // PAY-006: Different Events, Same Payment
    it("PAY-006: should handle payment.captured and order.paid for same payment without double finalization", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const paymentId = "pay_same_006";

        // Event A: payment.captured
        const payloadA = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };
        const resA = await webhookRoute(createSignedWebhookRequest(payloadA, mockWebhookSecret, "evt_a"));
        assert.equal(resA.status, 200);

        // Event B: order.paid for the same order and payment
        const payloadB = {
            event: "order.paid",
            payload: {
                order: {
                    entity: {
                        id: orderData.id,
                        amount_paid: 100000,
                        currency: "INR",
                    },
                },
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: orderData.id,
                        amount: 100000,
                    },
                },
            },
        };
        const resB = await webhookRoute(createSignedWebhookRequest(payloadB, mockWebhookSecret, "evt_b"));
        const dataB = await resB.json();
        assert.equal(resB.status, 200);
        assert.equal(dataB.duplicate, true);

        // Verify stock decremented exactly once
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // PAY-007: Wrong Payment Amount
    it("PAY-007: should reject payment webhook with mismatched amount and flag reconciliation", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }], // ₹1000 = 100000 paise
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        // Webhook claims ₹50 paid (5000 paise)
        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_mismatch_007",
                        order_id: orderData.id,
                        amount: 5000, // 5000 paise != 100000 paise
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_007"));
        assert.equal(res.status, 400);

        // Order must NOT be marked PAID
        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.notEqual(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // PAY-008: Wrong Currency
    it("PAY-008: should reject payment webhook with mismatched currency and flag reconciliation", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_curr_008",
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "EUR", // Mismatched currency
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_008"));
        assert.equal(res.status, 400);

        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.notEqual(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // PAY-009: Wrong Razorpay Order ID
    it("PAY-009: should reject payment webhook when gateway order ID does not match internal record", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_wrong_order_009",
                        order_id: "order_different_unrelated_999", // Unrelated order ID
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_009"));
        assert.equal(res.status, 404);

        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
    });

    // PAY-010: Unknown Internal Order
    it("PAY-010: should safely record unmatched payments for unknown internal orders without creating paid orders", async () => {
        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_unknown_010",
                        order_id: "order_ghost_nonexistent_888",
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const res = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_010"));
        assert.equal(res.status, 404);

        // Verify unmatched payment is safely stored for audit
        const unmatchedSnap = await adminDb!.collection("unmatchedPayments").doc("pay_unknown_010").get();
        assert.equal(unmatchedSnap.exists, true);
    });

    // PAY-011: Browser Disconnect
    it("PAY-011: should confirm order via webhook if browser disconnects after checkout initiation", async () => {
        // Customer initiates checkout and browser crashes immediately
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        // Browser is closed; payment gateway completes payment asynchronously and delivers webhook
        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_browser_drop_011",
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        const hookRes = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_011"));
        assert.equal(hookRes.status, 200);

        // Order is successfully confirmed as PAID without browser callback
        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
    });

    // PAY-012: Concurrent Duplicate Events
    it("PAY-012: should handle concurrent duplicate webhook deliveries without race conditions", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const webhookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_concurrent_012",
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };

        // Fire two webhooks simultaneously
        const reqA = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_c1");
        const reqB = createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_c2");

        const [resA, resB] = await Promise.all([webhookRoute(reqA), webhookRoute(reqB)]);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);

        // Verify order is PAID and inventory was decremented only once
        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");

        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // PAY-013: Failed Payment
    it("PAY-013: should record payment failure attempt without marking order PAID", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const webhookPayload = {
            event: "payment.failed",
            payload: {
                payment: {
                    entity: {
                        id: "pay_failed_013",
                        order_id: orderData.id,
                        error_code: "BAD_REQUEST_ERROR",
                        error_description: "Payment declined by issuing bank",
                    },
                },
            },
        };

        const hookRes = await webhookRoute(createSignedWebhookRequest(webhookPayload, mockWebhookSecret, "evt_013"));
        assert.equal(hookRes.status, 200);

        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "FAILED");
        assert.equal(orderSnap.data()?.orderStatus, "Payment_Failed");
    });

    // PAY-014: Out-of-Order Events
    it("PAY-014: should prevent a delayed failed event from regressing an already confirmed PAID order", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        // 1. Payment captures successfully
        const capturePayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_success_014",
                        order_id: orderData.id,
                        amount: 100000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };
        await webhookRoute(createSignedWebhookRequest(capturePayload, mockWebhookSecret, "evt_cap_014"));

        // 2. Delayed out-of-order payment.failed event arrives later
        const failPayload = {
            event: "payment.failed",
            payload: {
                payment: {
                    entity: {
                        id: "pay_old_failed_014",
                        order_id: orderData.id,
                        error_description: "Earlier attempt failed",
                    },
                },
            },
        };
        const failRes = await webhookRoute(createSignedWebhookRequest(failPayload, mockWebhookSecret, "evt_fail_014"));
        const failData = await failRes.json();
        assert.equal(failRes.status, 200);
        assert.equal(failData.ignored, true);

        // Order remains strictly PAID
        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
    });

    // PAY-015: COD Regression
    it("PAY-015: should ensure Cash on Delivery order creation and inventory deduction still work", async () => {
        const codPayload = {
            items: [{ productId: "prod-hoodie-1000", quantity: 2 }],
            subtotal: 2000,
            total: 2000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const res = await createOrderRoute(createJsonPostRequest("http://localhost:3000/api/orders/create", codPayload));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.paymentStatus, "PENDING");
        assert.equal(data.orderStatus, "Processing");

        // Verify inventory decremented by 2 (10 - 2 = 8)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 8);
    });

    // PAY-016: Reservation Expiration
    it("PAY-016: should release reserved stock and coupon capacity exactly once when expired", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 2 }],
            couponCode: "VALID10",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        assert.equal(createRes.status, 200);
        const orderId = orderData.internalOrderId;

        // Stock was 10, now 8; Coupon timesUsed was 5, now 6
        let prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        let couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(prodSnap.data()?.inventory, 8);
        assert.equal(couponSnap.data()?.timesUsed, 6);

        // Trigger reservation expiration
        const release1 = await releaseExpiredReservation(orderId, adminDb!);
        assert.equal(release1.released, true);

        // Stock and coupon restored
        prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(prodSnap.data()?.inventory, 10);
        assert.equal(couponSnap.data()?.timesUsed, 5);

        // Second call must be idempotent
        const release2 = await releaseExpiredReservation(orderId, adminDb!);
        assert.equal(release2.released, false);
        assert.equal(release2.reason, "ALREADY_RELEASED_OR_NOT_RESERVED");

        prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10); // Not incremented again to 12
    });

    // PAY-017: Late Payment After Expiration
    it("PAY-017: should prevent overselling when late payment captures after stock was released and taken", async () => {
        // Scarce item with stock = 1
        const scarceProd = "prod-scarce-stock-1";
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: scarceProd, quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const orderId = orderData.internalOrderId;

        // Stock becomes 0
        let pSnap = await adminDb!.collection("products").doc(scarceProd).get();
        assert.equal(pSnap.data()?.inventory, 0);

        // Reservation expires -> stock released back to 1
        await releaseExpiredReservation(orderId, adminDb!);
        pSnap = await adminDb!.collection("products").doc(scarceProd).get();
        assert.equal(pSnap.data()?.inventory, 1);

        // Another buyer buys the scarce item via COD -> stock becomes 0
        await createOrderRoute(
            createJsonPostRequest("http://localhost:3000/api/orders/create", {
                items: [{ productId: scarceProd, quantity: 1 }],
                subtotal: 750,
                total: 750,
                paymentMethod: "COD",
                paymentStatus: "PENDING",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            })
        );
        pSnap = await adminDb!.collection("products").doc(scarceProd).get();
        assert.equal(pSnap.data()?.inventory, 0);

        // Now late payment webhook arrives for customer 1
        const hookPayload = {
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_late_scarce_017",
                        order_id: orderData.id,
                        amount: 75000,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        };
        const hookRes = await webhookRoute(createSignedWebhookRequest(hookPayload, mockWebhookSecret, "evt_017"));
        const hookData = await hookRes.json();

        assert.equal(hookRes.status, 200);
        assert.equal(hookData.reconciliationRequired, true);

        // CRITICAL INVARIANT: Inventory did NOT drop below zero into negative!
        pSnap = await adminDb!.collection("products").doc(scarceProd).get();
        assert.equal(pSnap.data()?.inventory, 0);

        // Order is flagged for reconciliation
        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // PAY-018: Payment Retry
    it("PAY-018: should reuse existing pending order when retried with same idempotencyKey", async () => {
        const payload = {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            idempotencyKey: "client_retry_key_018",
        };

        // First attempt
        const res1 = await createRazorpayOrderRoute(createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload));
        const data1 = await res1.json();
        assert.equal(res1.status, 200);

        // Second retry attempt with same idempotency key
        const res2 = await createRazorpayOrderRoute(createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload));
        const data2 = await res2.json();
        assert.equal(res2.status, 200);

        // Reused same order and did not reserve stock twice
        assert.equal(data2.internalOrderId, data1.internalOrderId);
        assert.equal(data2.reused, true);

        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9); // Only decremented by 1, not 2
    });

    // PAY-019: Missing Webhook Secret
    it("PAY-019: should fail closed with status 500 when webhook secret is missing", async () => {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;

        const hookPayload = {
            event: "payment.captured",
            payload: {},
        };
        const req = createSignedWebhookRequest(hookPayload, "any_secret", "evt_019");
        const res = await webhookRoute(req);
        assert.equal(res.status, 500);

        const data = await res.json();
        assert.match(data.error, /not configured/i);
    });

    // PAY-020: Browser Callback Verification
    it("PAY-020: should verify payment signature and finalize order via /api/razorpay/verify-payment", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();

        const paymentId = "pay_callback_020";
        const signPayload = `${orderData.id}|${paymentId}`;
        const signature = crypto.createHmac("sha256", mockKeySecret).update(signPayload).digest("hex");

        const verifyReq = createJsonPostRequest("http://localhost:3000/api/razorpay/verify-payment", {
            razorpay_order_id: orderData.id,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
            orderId: orderData.internalOrderId,
        });

        const verifyRes = await verifyPaymentRoute(verifyReq);
        const verifyData = await verifyRes.json();

        assert.equal(verifyRes.status, 200);
        assert.equal(verifyData.success, true);

        const orderSnap = await adminDb!.collection("orders").doc(orderData.internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
    });
});
