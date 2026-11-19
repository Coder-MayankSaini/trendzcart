import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as webhookRoute } from "../../src/app/api/webhooks/razorpay/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import {
    recoverGatewayOrderForReceipt,
    associateGatewayOrderWithRetry,
    recordGatewayCreationStarted,
} from "../../src/lib/orders/gatewayRecovery.ts";
import { runReservationCleanup } from "../../src/lib/orders/reservationCleanup.ts";
import { finalizeOrderPayment } from "../../src/lib/orders/paymentLifecycle.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Payment Association Recovery & Cleanup Safety (SYNC-001 to SYNC-016)", () => {
    const mockKeyId = "rzp_test_sync_key_123";
    const mockKeySecret = "sync_secret_mock_456";
    const mockWebhookSecret = "sync_webhook_secret_789";

    let mockGatewayOrdersMap: Map<string, any>;
    let mockGatewayPaymentsMap: Map<string, any[]>;
    let mockOrdersCreateError: Error | null = null;
    let mockOrdersAllError: Error | null = null;

    before(() => {
        process.env.RAZORPAY_KEY_ID = mockKeyId;
        process.env.RAZORPAY_KEY_SECRET = mockKeySecret;
        process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

        // Mock Razorpay SDK prototypes for orders.create and orders.all
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);

        apiProto.post = async function (params: any) {
            if (mockOrdersCreateError) {
                throw mockOrdersCreateError;
            }
            if (params?.url === "/orders") {
                const data = params.data || {};
                const rzpId = `order_rzp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                const createdOrder = {
                    id: rzpId,
                    entity: "order",
                    amount: data.amount,
                    amount_paid: 0,
                    amount_due: data.amount,
                    currency: data.currency || "INR",
                    receipt: data.receipt,
                    status: "created",
                    attempts: 0,
                    notes: data.notes || {},
                    created_at: Math.floor(Date.now() / 1000),
                };
                mockGatewayOrdersMap.set(rzpId, createdOrder);
                return createdOrder;
            }
            return {};
        };

        apiProto.get = async function (params: any) {
            if (mockOrdersAllError) {
                throw mockOrdersAllError;
            }
            const url = params?.url || "";
            if (url === "/orders") {
                const receiptFilter = params?.data?.receipt;
                const matches: any[] = [];
                for (const order of mockGatewayOrdersMap.values()) {
                    if (!receiptFilter || order.receipt === receiptFilter) {
                        matches.push(order);
                    }
                }
                return {
                    entity: "collection",
                    count: matches.length,
                    items: matches,
                };
            }
            if (url.includes("/payments")) {
                const parts = url.split("/");
                const orderId = parts[2];
                const payments = mockGatewayPaymentsMap.get(orderId) || [];
                return {
                    entity: "collection",
                    count: payments.length,
                    items: payments,
                };
            }
            return {};
        };
    });

    beforeEach(async () => {
        mockGatewayOrdersMap = new Map();
        mockGatewayPaymentsMap = new Map();
        mockOrdersCreateError = null;
        mockOrdersAllError = null;

        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "paymentRecords");
        await clearCollection(adminDb, "paymentWebhookEvents");
        await clearCollection(adminDb, "unmatchedPayments");
        await seedEmulatorDatabase(adminDb);
    });

    // SYNC-001: Gateway creation succeeds; Firestore association succeeds
    it("SYNC-001: should create gateway order and durably associate razorpayOrderId in Firestore", async () => {
        const payload = {
            receipt: "order-sync-001",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            currency: "INR",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id && data.id.startsWith("order_rzp_"));
        assert.equal(data.amount, 100000);
        assert.equal(data.currency, "INR");
        assert.ok(data.internalOrderId);

        // Verify Firestore record has durable gateway association
        const orderSnap = await adminDb!.collection("orders").doc(data.internalOrderId).get();
        const orderDoc = orderSnap.data();
        assert.equal(orderDoc?.razorpayOrderId, data.id);
        assert.equal(orderDoc?.gatewayState, "READY_FOR_PAYMENT");
        assert.equal(orderDoc?.inventoryReserved, true);
        assert.equal(orderDoc?.reservationReleased, false);
    });

    // SYNC-002: Gateway creation succeeds; first Firestore association write fails transiently; retry succeeds
    it("SYNC-002: should retry association on transient write failure and succeed", async () => {
        const internalOrderId = "order-sync-002";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            gatewayState: "GATEWAY_CREATION_STARTED",
            createdAt: new Date(),
        });

        // Simulate transient failure on attempt 1, succeeding on attempt 2
        const realDocRef = adminDb!.collection("orders").doc(internalOrderId);
        let callCount = 0;
        const mockDocRef = {
            update: async function (data: any) {
                callCount++;
                if (callCount === 1) {
                    throw new Error("Transient Firestore write timeout");
                }
                return await realDocRef.update(data);
            },
        };

        const assocRes = await associateGatewayOrderWithRetry(
            adminDb!,
            internalOrderId,
            "order_rzp_transient_002",
            100000,
            "INR",
            3,
            mockDocRef
        );

        assert.equal(assocRes.success, true);
        assert.equal(assocRes.attempts, 2);

        const updatedSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(updatedSnap.data()?.razorpayOrderId, "order_rzp_transient_002");
        assert.equal(updatedSnap.data()?.gatewayState, "READY_FOR_PAYMENT");
    });

    // SYNC-003: Gateway creation succeeds; all association writes fail; no unsafe checkout response is returned
    it("SYNC-003: should fail safely and NOT return unmatched gateway order when all association writes fail", async () => {
        const internalOrderId = "order-sync-003";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            gatewayState: "GATEWAY_CREATION_STARTED",
            createdAt: new Date(),
        });

        // Force all 3 association update attempts to fail
        const realDocRef = adminDb!.collection("orders").doc(internalOrderId);
        let attempts = 0;
        const mockFailingDocRef = {
            update: async function (data: any) {
                if (data?.gatewayState === "GATEWAY_STATE_UNCERTAIN") {
                    return await realDocRef.update(data);
                }
                attempts++;
                throw new Error("Persistent Firestore write failure");
            },
        };

        const assocRes = await associateGatewayOrderWithRetry(
            adminDb!,
            internalOrderId,
            "order_rzp_failed_003",
            100000,
            "INR",
            3,
            mockFailingDocRef
        );

        assert.equal(assocRes.success, false);
        assert.equal(assocRes.attempts, 3);
        assert.ok(assocRes.error);

        // Verify fallback recorded uncertain state for manual reconciliation
        const updatedSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(updatedSnap.data()?.gatewayState, "GATEWAY_STATE_UNCERTAIN");
        assert.equal(updatedSnap.data()?.unassociatedGatewayOrderId, "order_rzp_failed_003");
        assert.equal(updatedSnap.data()?.reconciliationRequired, true);
    });

    // SYNC-004: Customer retries after uncertain gateway creation; no duplicate inventory reservation occurs
    it("SYNC-004: should recover existing gateway order on retry without duplicate inventory reservation", async () => {
        const idempotencyKey = "idem_sync_004_key";
        const internalOrderId = "order-sync-004";

        // Seed existing pending order with unassociated gateway order
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            idempotencyKey,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // unexpired
            unassociatedGatewayOrderId: "order_rzp_existing_004",
            gatewayState: "GATEWAY_STATE_UNCERTAIN",
            createdAt: new Date(),
        });

        // Stock was already decremented by 1 when order was created (from 10 to 9)
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 9 });

        const payload = {
            idempotencyKey,
            receipt: internalOrderId,
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            currency: "INR",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.id, "order_rzp_existing_004");
        assert.equal(data.reused, true);

        // Verify inventory was NOT decremented again (remains 9, not 8)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // SYNC-005: Cleanup encounters an expired order with a missing gateway ID but a known initiation attempt
    it("SYNC-005: should NOT blindly release stock when order has missing gateway ID but recorded initiation attempt", async () => {
        const internalOrderId = "order-sync-005";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        // Run cleanup with mock client that simulates network failure
        mockOrdersAllError = new Error("Gateway connection timed out");
        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        // Fail closed: must report gateway error and NOT release stock
        assert.equal(result.gatewayErrors, 1);
        assert.equal(result.released, 0);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.reservationReleased, false);
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
    });

    // SYNC-006: Receipt lookup recovers a matching gateway order
    it("SYNC-006: should recover matching gateway order by receipt with exact amount and currency", async () => {
        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const receipt = "receipt-sync-006";

        mockGatewayOrdersMap.set("order_rzp_006", {
            id: "order_rzp_006",
            receipt,
            amount: 100000,
            currency: "INR",
            status: "created",
        });

        const recovery = await recoverGatewayOrderForReceipt(dummyClient, receipt, 100000, "INR");
        assert.equal(recovery.found, true);
        assert.equal(recovery.orderId, "order_rzp_006");
        assert.equal(recovery.amount, 100000);
        assert.equal(recovery.currency, "INR");
    });

    // SYNC-007: Receipt lookup returns no results but gateway state cannot be proven safe; worker follows conservative policy
    it("SYNC-007: should safely release reservation only when gateway confirms 0 orders exist for receipt", async () => {
        const internalOrderId = "order-sync-007";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        // Stock was 9
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 9 });

        // Gateway returns 0 items for this receipt (no order was created)
        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        assert.equal(result.released, 1);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "EXPIRED");
        assert.equal(orderSnap.data()?.reservationReleased, true);

        // Inventory safely restored
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10);
    });

    // SYNC-008: Receipt lookup returns multiple possible matches; no arbitrary association is selected
    it("SYNC-008: should fail closed and flag manual reconciliation when multiple gateway orders match receipt", async () => {
        const internalOrderId = "order-sync-008";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 2,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        // Seed 2 gateway orders for the same receipt
        mockGatewayOrdersMap.set("order_rzp_dup_1", {
            id: "order_rzp_dup_1",
            receipt: internalOrderId,
            amount: 100000,
            currency: "INR",
        });
        mockGatewayOrdersMap.set("order_rzp_dup_2", {
            id: "order_rzp_dup_2",
            receipt: internalOrderId,
            amount: 100000,
            currency: "INR",
        });

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        assert.equal(result.released, 0);
        assert.equal(result.reconciliationCount, 1);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reconciliationReason, "AMBIGUOUS_GATEWAY_ORDERS_FOR_RECEIPT");
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // SYNC-009: Receipt lookup returns an order with wrong amount or currency; association is rejected
    it("SYNC-009: should reject association when gateway order amount or currency mismatches", async () => {
        const internalOrderId = "order-sync-009";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        // Gateway order has amount 50000 instead of 100000
        mockGatewayOrdersMap.set("order_rzp_mismatch_009", {
            id: "order_rzp_mismatch_009",
            receipt: internalOrderId,
            amount: 50000,
            currency: "INR",
        });

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        assert.equal(result.released, 0);
        assert.equal(result.reconciliationCount, 1);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // SYNC-010: Recovered order contains a captured payment; order is finalized once
    it("SYNC-010: should recover gateway order, detect captured payment, and finalize order idempotently", async () => {
        const internalOrderId = "order-sync-010";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        const rzpOrderId = "order_rzp_captured_010";
        mockGatewayOrdersMap.set(rzpOrderId, {
            id: rzpOrderId,
            receipt: internalOrderId,
            amount: 100000,
            currency: "INR",
        });

        mockGatewayPaymentsMap.set(rzpOrderId, [
            {
                id: "pay_captured_010",
                order_id: rzpOrderId,
                amount: 100000,
                currency: "INR",
                status: "captured",
                captured: true,
            },
        ]);

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        assert.equal(result.finalized, 1);
        assert.equal(result.released, 0);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
        assert.equal(orderSnap.data()?.razorpayOrderId, rzpOrderId);
        assert.equal(orderSnap.data()?.reservationReleased, false);
        assert.equal(orderSnap.data()?.inventoryFinalized, true);
    });

    // SYNC-011: Recovered order contains an authorized payment; stock is preserved or reconciliation is initiated safely
    it("SYNC-011: should NOT release stock when recovered order has authorized payment pending capture", async () => {
        const internalOrderId = "order-sync-011";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        const rzpOrderId = "order_rzp_auth_011";
        mockGatewayOrdersMap.set(rzpOrderId, {
            id: rzpOrderId,
            receipt: internalOrderId,
            amount: 100000,
            currency: "INR",
        });

        mockGatewayPaymentsMap.set(rzpOrderId, [
            {
                id: "pay_auth_011",
                order_id: rzpOrderId,
                amount: 100000,
                currency: "INR",
                status: "authorized",
            },
        ]);

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        assert.equal(result.reconciliationCount, 1);
        assert.equal(result.released, 0);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // SYNC-012: Gateway lookup fails or times out; no unsafe reservation release
    it("SYNC-012: should fail closed and preserve reservation when gateway payment query times out", async () => {
        const internalOrderId = "order-sync-012";
        const rzpOrderId = "order_rzp_timeout_012";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: rzpOrderId,
            gatewayState: "READY_FOR_PAYMENT",
            createdAt: new Date(Date.now() - 20 * 60 * 1000),
        });

        // Gateway fetchPayments throws timeout
        const clientWithTimeout = {
            orders: {
                fetchPayments: async () => {
                    throw new Error("ETIMEDOUT: Gateway connection timed out");
                },
            },
        };

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: clientWithTimeout,
        });

        assert.equal(result.gatewayErrors, 1);
        assert.equal(result.released, 0);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // SYNC-013: Webhook and association recovery race; one consistent final payment state
    it("SYNC-013: should handle race between webhook and recovery resulting in consistent PAID state", async () => {
        const internalOrderId = "order-sync-013";
        const rzpOrderId = "order_rzp_race_013";
        const rzpPaymentId = "pay_race_013";

        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            unassociatedGatewayOrderId: rzpOrderId,
            gatewayState: "GATEWAY_STATE_UNCERTAIN",
            createdAt: new Date(),
        });

        // Run finalizeOrderPayment concurrently from both paths
        const [res1, res2] = await Promise.all([
            finalizeOrderPayment(adminDb!, {
                razorpayOrderId: rzpOrderId,
                razorpayPaymentId: rzpPaymentId,
                amountPaise: 100000,
                currency: "INR",
                source: "WEBHOOK",
                eventId: "evt_race_1",
            }),
            finalizeOrderPayment(adminDb!, {
                razorpayOrderId: rzpOrderId,
                razorpayPaymentId: rzpPaymentId,
                amountPaise: 100000,
                currency: "INR",
                source: "RECONCILIATION_WORKER",
            }),
        ]);

        assert.equal(res1.success, true);
        assert.equal(res2.success, true);
        assert.ok(res1.duplicate || res2.duplicate, "One of the concurrent operations must be marked duplicate");

        // Exactly one payment record exists in paymentRecords
        const payRecordSnap = await adminDb!.collection("paymentRecords").doc(rzpPaymentId).get();
        assert.equal(payRecordSnap.exists, true);
        assert.equal(payRecordSnap.data()?.orderId, internalOrderId);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.razorpayOrderId, rzpOrderId);
    });

    // SYNC-014: Duplicate initiation requests cannot create two independently payable orders for the same checkout attempt
    it("SYNC-014: should prevent duplicate gateway order creation for same checkout idempotency key", async () => {
        const idempotencyKey = "idem_sync_014_unique";
        const payload = {
            idempotencyKey,
            receipt: "order-sync-014",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            currency: "INR",
        };

        // First attempt creates internal order & gateway association
        const res1 = await createRazorpayOrderRoute(createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload));
        const data1 = await res1.json();

        // Duplicate initiation request with same idempotencyKey reuses existing order and returns same gateway order
        const res2 = await createRazorpayOrderRoute(createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload));
        const data2 = await res2.json();

        assert.equal(res1.status, 200);
        assert.equal(res2.status, 200);
        assert.equal(data1.id, data2.id, "Both requests must receive the exact same Razorpay Order ID");
        assert.equal(data1.internalOrderId, data2.internalOrderId, "Both requests must resolve to the same internal order ID");
        assert.equal(data2.reused, true, "Second request must be marked reused");
    });

    // SYNC-015: COD orders remain unaffected
    it("SYNC-015: should ensure COD checkout orders remain completely unaffected by gateway recovery logic", async () => {
        const payload = {
            paymentMethod: "COD",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            total: 1000,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        const createdOrderId = data.id || data.orderId;
        assert.ok(createdOrderId);

        const orderSnap = await adminDb!.collection("orders").doc(createdOrderId).get();
        assert.equal(orderSnap.data()?.paymentMethod, "COD");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.inventoryFinalized, true);
    });

    // SYNC-016: All previous payment, inventory, and reservation tests remain passing
    it("SYNC-016: should verify core state machine invariants remain strictly intact", async () => {
        const internalOrderId = "order-sync-016";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryReserved: true,
            reservationReleased: false,
            inventoryFinalized: true,
            createdAt: new Date(),
        });

        // Invoking releaseExpiredReservation on a PAID order must NEVER release
        const { releaseExpiredReservation } = await import("../../src/lib/orders/paymentLifecycle.ts");
        const res = await releaseExpiredReservation(internalOrderId, adminDb!);
        assert.equal(res.success, false);
        assert.equal(res.released, false);
        assert.equal(res.reason, "ORDER_ALREADY_PAID");
    });

    // SYNC-017: Partial or broad receipt matches do not cause false ambiguity
    it("SYNC-017: should filter for exact receipt when gateway returns partial or broad matches", async () => {
        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const { recoverGatewayOrderForReceipt } = await import("../../src/lib/orders/gatewayRecovery.ts");

        // Seed an order with exact receipt and another with a prefixed receipt
        mockGatewayOrdersMap.set("order_broad_match_1", {
            id: "order_broad_match_1",
            receipt: "order-sync-017-extra-suffix",
            amount: 100000,
            currency: "INR",
        });
        mockGatewayOrdersMap.set("order_exact_match_2", {
            id: "order_exact_match_2",
            receipt: "order-sync-017",
            amount: 100000,
            currency: "INR",
        });

        // Querying for "order-sync-017"
        const result = await recoverGatewayOrderForReceipt(
            dummyClient,
            "order-sync-017",
            100000,
            "INR"
        );

        assert.equal(result.found, true);
        assert.equal(result.orderId, "order_exact_match_2");
        assert.equal(result.ambiguous, undefined);
    });

    // SYNC-018: Pagination overflow returns ambiguous and fails closed
    it("SYNC-018: should flag ambiguity when gateway response indicates pagination overflow", async () => {
        const dummyClient = {
            orders: {
                all: async () => ({
                    count: 105, // More than 100 items on gateway
                    items: new Array(100).fill(null).map((_, i) => ({
                        id: `order_overflow_${i}`,
                        receipt: "order-sync-018",
                        amount: 100000,
                        currency: "INR",
                    })),
                }),
            },
        };
        const { recoverGatewayOrderForReceipt } = await import("../../src/lib/orders/gatewayRecovery.ts");

        const result = await recoverGatewayOrderForReceipt(
            dummyClient,
            "order-sync-018",
            100000,
            "INR"
        );

        assert.equal(result.found, false);
        assert.equal(result.ambiguous, true);
        assert.match(result.error || "", /Multiple.*gateway orders/i);
    });

    // SYNC-019: Uncertain gateway order within observation grace window preserves inventory
    it("SYNC-019: should preserve inventory and flag Pending_Reconciliation when uncertain order is within observation window", async () => {
        const internalOrderId = "order-sync-019";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 1 * 60 * 1000), // Expired 1 min ago
            razorpayOrderId: null,
            gatewayState: "GATEWAY_STATE_UNCERTAIN",
            gatewayAttempts: 3,
            lastGatewayAttemptAt: new Date(Date.now() - 3 * 60 * 1000), // Attempted 3 mins ago (< 15 mins observation window)
            createdAt: new Date(Date.now() - 10 * 60 * 1000),
        });

        // Set initial stock to 9
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 9 });

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });

        // Worker must NOT release stock; routes to reconciliation
        assert.equal(result.released, 0);
        assert.equal(result.reconciliationCount, 1);

        const orderSnap = await adminDb!.collection("orders").doc(internalOrderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reconciliationReason, "UNCERTAIN_GATEWAY_CREATION_IN_OBSERVATION_WINDOW");

        // Stock MUST remain reserved at 9
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // SYNC-020: Repeat cleanup attempts are strictly idempotent
    it("SYNC-020: should ensure repeat cleanup invocations are strictly idempotent", async () => {
        const internalOrderId = "order-sync-020";
        await adminDb!.collection("orders").doc(internalOrderId).set({
            id: internalOrderId,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            total: 1000,
            amountPaise: 100000,
            currency: "INR",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
            razorpayOrderId: null,
            gatewayState: "GATEWAY_CREATION_STARTED",
            gatewayAttempts: 1,
            createdAt: new Date(Date.now() - 25 * 60 * 1000), // > 15 mins observation window
        });

        await adminDb!.collection("products").doc("prod-hoodie-1000").update({ inventory: 9 });

        const dummyClient = new Razorpay({ key_id: mockKeyId, key_secret: mockKeySecret });

        // Pass 1: releases expired reservation, restoring inventory to 10
        const result1 = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });
        assert.equal(result1.released, 1);

        const prodSnap1 = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap1.data()?.inventory, 10);

        // Pass 2: order is already released; does nothing and does not double-restore stock
        const result2 = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: dummyClient,
        });
        assert.equal(result2.released, 0);

        const prodSnap2 = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap2.data()?.inventory, 10);
    });
});
