import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as adminModule from "firebase-admin";
import Razorpay from "razorpay";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { runReservationCleanup } from "../../src/lib/orders/reservationCleanup.ts";
import netlifyScheduledHandler, { config as netlifyConfig } from "../../netlify/functions/reservation-cleanup.mts";
import {
    createPendingPrepaidOrder,
    releaseExpiredReservation,
    finalizeOrderPayment,
} from "../../src/lib/orders/paymentLifecycle.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

const admin = (adminModule as any).default || adminModule;

describe("Automated Inventory Reservation Cleanup & Reconciliation (Firestore Emulator)", () => {
    let mockPaymentFetcher: (orderId: string) => Promise<any> = async () => ({ count: 0, items: [] });
    let razorpayMockClient: any;

    before(() => {
        process.env.RAZORPAY_KEY_ID = "rzp_test_cleanup_key";
        process.env.RAZORPAY_KEY_SECRET = "cleanup_secret_mock";

        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (url.includes("/payments")) {
                return await mockPaymentFetcher(url);
            }
            return {};
        };

        razorpayMockClient = {
            orders: {
                fetchPayments: async (orderId: string) => {
                    return await mockPaymentFetcher(orderId);
                },
            },
        };
    });

    beforeEach(async () => {
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "paymentRecords");
        await clearCollection(adminDb, "paymentWebhookEvents");
        await clearCollection(adminDb, "unmatchedPayments");
        await seedEmulatorDatabase(adminDb);

        // Default mock: no payments for expired order
        mockPaymentFetcher = async () => ({ count: 0, items: [] });
    });

    // Helper to create an expired pending order fixture directly
    async function createSyntheticExpiredOrder(overrides: Record<string, any> = {}): Promise<string> {
        const orderRef = adminDb!.collection("orders").doc();
        const orderId = orderRef.id;
        const now = new Date();
        const past = new Date(now.getTime() - 16 * 60 * 1000); // Expired 16 minutes ago

        // Decrement product inventory to simulate reservation
        await adminDb!.collection("products").doc("prod-hoodie-1000").update({
            inventory: admin.firestore.FieldValue.increment(-1),
        });

        // Increment coupon usage
        await adminDb!.collection("coupons").doc("VALID10").update({
            timesUsed: admin.firestore.FieldValue.increment(1),
        });

        await orderRef.set({
            id: orderId,
            userId: null,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
            subtotal: 1000,
            discount: 100,
            couponDiscount: 100,
            total: 900,
            amountPaise: 90000,
            currency: "INR",
            couponCode: "VALID10",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            inventoryReserved: true,
            inventoryFinalized: false,
            reservationReleased: false,
            reservationExpiresAt: past,
            razorpayOrderId: `rzp_order_${orderId}`,
            createdAt: past,
            updatedAt: past,
            ...overrides,
        });

        return orderId;
    }

    // OPS-001: Expired Pending Order
    it("OPS-001: should discover expired prepaid reservation, verify unpaid status, and restore stock & coupon", async () => {
        const orderId = await createSyntheticExpiredOrder();

        // Stock decreased to 9, coupon timesUsed increased to 6
        let prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        let couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(prodSnap.data()?.inventory, 9);
        assert.equal(couponSnap.data()?.timesUsed, 6);

        // Run cleanup
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.processed, 1);
        assert.equal(result.released, 1);
        assert.equal(result.finalized, 0);
        assert.equal(result.errors.length, 0);

        // Verify stock and coupon restored
        prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(prodSnap.data()?.inventory, 10);
        assert.equal(couponSnap.data()?.timesUsed, 5);

        // Verify order state
        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        const orderData = orderSnap.data();
        assert.equal(orderData?.inventoryReserved, false);
        assert.equal(orderData?.reservationReleased, true);
        assert.equal(orderData?.paymentStatus, "EXPIRED");
        assert.equal(orderData?.orderStatus, "Expired");
        assert.ok(orderData?.expiredAt);
    });

    // OPS-002: Unexpired Order
    it("OPS-002: should NOT release or modify reservations that have not yet expired", async () => {
        const orderRef = adminDb!.collection("orders").doc();
        const future = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes

        await orderRef.set({
            id: orderRef.id,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: future,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.processed, 0);
        assert.equal(result.released, 0);

        const orderSnap = await orderRef.get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // OPS-003: Already Paid Order
    it("OPS-003: should NEVER release inventory for orders marked PAID", async () => {
        const past = new Date(Date.now() - 30 * 60 * 1000);
        const orderId = await createSyntheticExpiredOrder({
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryReserved: false,
            inventoryFinalized: true,
            reservationExpiresAt: past,
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
    });

    // OPS-004: COD Order
    it("OPS-004: should strictly ignore COD orders and never release their inventory", async () => {
        const past = new Date(Date.now() - 20 * 60 * 1000);
        const orderRef = adminDb!.collection("orders").doc();

        await orderRef.set({
            id: orderRef.id,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Processing",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: past,
            items: [{ productId: "prod-hoodie-1000", quantity: 1, price: 1000 }],
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0);

        const orderSnap = await orderRef.get();
        assert.equal(orderSnap.data()?.paymentMethod, "COD");
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // OPS-005: Repeated Cleanup (Idempotency)
    it("OPS-005: should release expired reservation on first run and safely no-op on repeated run", async () => {
        await createSyntheticExpiredOrder();

        const run1 = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(run1.processed, 1);
        assert.equal(run1.released, 1);

        const run2 = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(run2.processed, 0);
        assert.equal(run2.released, 0);

        // Product inventory restored exactly once (10)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10);
    });

    // OPS-006: Concurrent Cleanup Workers
    it("OPS-006: should guarantee stock is restored only once when two workers run concurrently", async () => {
        await createSyntheticExpiredOrder();

        // Run two workers simultaneously on the exact same expired order
        const [worker1, worker2] = await Promise.all([
            runReservationCleanup(adminDb!, { batchSize: 25, razorpayClient: razorpayMockClient }),
            runReservationCleanup(adminDb!, { batchSize: 25, razorpayClient: razorpayMockClient }),
        ]);

        const totalReleased = worker1.released + worker2.released;
        assert.equal(totalReleased, 1, "Only one worker must succeed in releasing");

        // Inventory must be exactly 10, not 11!
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10);
    });

    // OPS-007: Webhook During Cleanup
    it("OPS-007: should prevent stock release if payment webhook finalizes order while cleanup evaluates", async () => {
        const orderId = await createSyntheticExpiredOrder();

        // Simulate webhook capturing payment before release completes
        await finalizeOrderPayment(adminDb!, {
            razorpayOrderId: `rzp_order_${orderId}`,
            razorpayPaymentId: "pay_concurrent_webhook_7",
            amountPaise: 90000,
            currency: "INR",
            internalOrderId: orderId,
            source: "WEBHOOK",
        });

        // Now run cleanup
        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0, "Must not release stock for paid order");

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
    });

    // OPS-008: Captured Payment With Delayed Webhook
    it("OPS-008: should detect captured payment on gateway, finalize order idempotently, and NOT release inventory", async () => {
        const orderId = await createSyntheticExpiredOrder();

        // Gateway returns captured payment matching order amount & currency
        mockPaymentFetcher = async () => ({
            count: 1,
            items: [
                {
                    id: "pay_captured_delayed_008",
                    order_id: `rzp_order_${orderId}`,
                    amount: 90000,
                    currency: "INR",
                    status: "captured",
                    captured: true,
                },
            ],
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0, "Must not release stock");
        assert.equal(result.finalized, 1, "Must finalize order as PAID");

        // Verify order is marked PAID and stock is committed (inventory stays 9)
        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PAID");
        assert.equal(orderSnap.data()?.orderStatus, "Processing");
        assert.equal(orderSnap.data()?.inventoryFinalized, true);

        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // OPS-009: Gateway API Failure
    it("OPS-009: should fail closed and NOT release stock if gateway payment lookup fails or times out", async () => {
        const orderId = await createSyntheticExpiredOrder();

        // Gateway throws network timeout
        mockPaymentFetcher = async () => {
            throw new Error("Gateway connection timeout (504)");
        };

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0, "Must NOT release on gateway error");
        assert.equal(result.gatewayErrors, 1);
        assert.ok(result.errors.length > 0);

        // Order reservation is preserved for retry
        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "PENDING");
        assert.equal(orderSnap.data()?.reservationReleased, false);

        // Product inventory remains reserved (9)
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 9);
    });

    // OPS-010: Authorized but Uncaptured Payment
    it("OPS-010: should NOT release stock if payment is authorized, flagging order for reconciliation", async () => {
        const orderId = await createSyntheticExpiredOrder();

        // Gateway returns authorized status (not yet captured)
        mockPaymentFetcher = async () => ({
            count: 1,
            items: [
                {
                    id: "pay_auth_010",
                    order_id: `rzp_order_${orderId}`,
                    amount: 90000,
                    currency: "INR",
                    status: "authorized",
                },
            ],
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 0, "Must NOT release stock");
        assert.equal(result.reconciliationCount, 1);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
        assert.equal(orderSnap.data()?.reservationReleased, false);
    });

    // OPS-011: Missing Gateway Association
    it("OPS-011: should safely release stock if internal pending order has no gateway order association", async () => {
        const orderId = await createSyntheticExpiredOrder({
            razorpayOrderId: null, // Order initiation failed before gateway creation
        });

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.released, 1);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.paymentStatus, "EXPIRED");
        assert.equal(orderSnap.data()?.reservationReleased, true);

        // Inventory restored
        const prodSnap = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(prodSnap.data()?.inventory, 10);
    });

    // OPS-012: Large Cleanup Backlog
    it("OPS-012: should process large backlogs in bounded batches and indicate hasMore", async () => {
        // Create 7 expired orders
        for (let i = 0; i < 7; i++) {
            await createSyntheticExpiredOrder({
                razorpayOrderId: `rzp_batch_${i}`,
            });
        }

        // Run with batchSize = 3
        const batch1 = await runReservationCleanup(adminDb!, {
            batchSize: 3,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(batch1.processed, 3);
        assert.equal(batch1.released, 3);
        assert.equal(batch1.hasMore, true, "Must flag hasMore when backlog exceeds batchSize");

        // Second batch
        const batch2 = await runReservationCleanup(adminDb!, {
            batchSize: 3,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(batch2.processed, 3);
        assert.equal(batch2.released, 3);
        assert.equal(batch2.hasMore, true);

        // Final batch
        const batch3 = await runReservationCleanup(adminDb!, {
            batchSize: 3,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(batch3.processed, 1);
        assert.equal(batch3.released, 1);
        assert.equal(batch3.hasMore, false, "hasMore must be false when backlog cleared");
    });

    // OPS-013: Invalid Reservation Data
    it("OPS-013: should handle malformed or legacy documents gracefully without aborting entire batch", async () => {
        const past = new Date(Date.now() - 30 * 60 * 1000);

        // Insert malformed order (missing items array)
        const badDoc = adminDb!.collection("orders").doc("malformed_doc_13");
        await badDoc.set({
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            inventoryReserved: true,
            reservationReleased: false,
            reservationExpiresAt: past,
            items: null, // malformed!
            razorpayOrderId: "rzp_bad_13",
        });

        // Insert valid expired order
        const validId = await createSyntheticExpiredOrder();

        const result = await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        assert.equal(result.processed, 2);
        // Valid document was released despite malformed sibling
        assert.ok(result.released >= 1);

        const validSnap = await adminDb!.collection("orders").doc(validId).get();
        assert.equal(validSnap.data()?.paymentStatus, "EXPIRED");
    });

    // OPS-021: Late Payment After Expiration
    it("OPS-021: should prevent negative stock and route to reconciliation when late payment captures after release", async () => {
        // Product with 1 stock
        await adminDb!.collection("products").doc("prod-scarce-stock-1").set({
            id: "prod-scarce-stock-1",
            name: "Scarce Item",
            price: 500,
            inventory: 0, // reserved by expired order
            isVisible: true,
        });

        const orderId = await createSyntheticExpiredOrder({
            items: [{ productId: "prod-scarce-stock-1", quantity: 1, price: 500 }],
            amountPaise: 50000,
            total: 500,
            couponCode: null,
            discount: 0,
            couponDiscount: 0,
        });

        // Release expired order -> inventory becomes 1
        await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        let pSnap = await adminDb!.collection("products").doc("prod-scarce-stock-1").get();
        assert.equal(pSnap.data()?.inventory, 1);

        // Another buyer buys the scarce item -> inventory drops to 0
        await adminDb!.collection("products").doc("prod-scarce-stock-1").update({
            inventory: 0,
        });

        // Late payment arrives for the released order
        const latePaymentResult = await finalizeOrderPayment(adminDb!, {
            razorpayOrderId: `rzp_order_${orderId}`,
            razorpayPaymentId: "pay_late_021",
            amountPaise: 50000,
            currency: "INR",
            internalOrderId: orderId,
            source: "WEBHOOK",
        });

        assert.equal(latePaymentResult.reconciliationRequired, true);
        assert.equal(latePaymentResult.orderStatus, "Pending_Reconciliation");

        // Inventory must NEVER drop below zero
        pSnap = await adminDb!.collection("products").doc("prod-scarce-stock-1").get();
        assert.equal(pSnap.data()?.inventory, 0);

        const orderSnap = await adminDb!.collection("orders").doc(orderId).get();
        assert.equal(orderSnap.data()?.orderStatus, "Pending_Reconciliation");
        assert.equal(orderSnap.data()?.reconciliationRequired, true);
    });

    // OPS-022: Coupon Reuse After Expiration
    it("OPS-022: should restore coupon usage capacity exactly once allowing subsequent use", async () => {
        const orderId = await createSyntheticExpiredOrder();

        let couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(couponSnap.data()?.timesUsed, 6);

        await runReservationCleanup(adminDb!, {
            batchSize: 25,
            razorpayClient: razorpayMockClient,
        });

        couponSnap = await adminDb!.collection("coupons").doc("VALID10").get();
        assert.equal(couponSnap.data()?.timesUsed, 5); // Restored!
    });

    // OPS-023: Worker Restart / Partial Failure
    it("OPS-023: should cleanly resume and recover when previous worker execution was interrupted", async () => {
        const order1 = await createSyntheticExpiredOrder({ razorpayOrderId: "rzp_part_1" });
        const order2 = await createSyntheticExpiredOrder({ razorpayOrderId: "rzp_part_2" });

        // First run processes batch of 1
        const run1 = await runReservationCleanup(adminDb!, {
            batchSize: 1,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(run1.processed, 1);
        assert.equal(run1.released, 1);
        assert.equal(run1.hasMore, true);

        // Next run picks up remaining order
        const run2 = await runReservationCleanup(adminDb!, {
            batchSize: 1,
            razorpayClient: razorpayMockClient,
        });
        assert.equal(run2.processed, 1);
        assert.equal(run2.released, 1);

        // Both are released
        const snap1 = await adminDb!.collection("orders").doc(order1).get();
        const snap2 = await adminDb!.collection("orders").doc(order2).get();
        assert.equal(snap1.data()?.paymentStatus, "EXPIRED");
        assert.equal(snap2.data()?.paymentStatus, "EXPIRED");
    });

    // OPS-024: Netlify Function Entrypoint
    it("OPS-024: should execute native Netlify scheduled function handler and export valid 5-min cron config", async () => {
        await createSyntheticExpiredOrder();

        // Verify scheduled config
        assert.equal(netlifyConfig.schedule, "*/5 * * * *");

        // Execute handler directly
        const dummyReq = new Request("https://bazaarvilla.com/.netlify/functions/reservation-cleanup", {
            method: "POST",
        });

        const response = await netlifyScheduledHandler(dummyReq);
        assert.equal(response.status, 200);

        const data = await response.json();
        assert.equal(data.success, true);
        assert.ok(data.result);
        assert.equal(data.result.released, 1);
        assert.ok(data.invocationStart);
    });
});
