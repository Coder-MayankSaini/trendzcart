import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Inventory & Coupon Concurrency Integration Tests (Firestore Emulator)", () => {
    beforeEach(async () => {
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await seedEmulatorDatabase(adminDb);
    });

    it("SEC-TEST-007: Concurrent orders on scarce inventory (Stock = 1)", async () => {
        // Product prod-scarce-stock-1 starts with inventory = 1.
        // User A and User B simultaneously submit orders for quantity = 1.
        const payloadUserA = {
            userId: "user-alice",
            items: [{ productId: "prod-scarce-stock-1", quantity: 1 }],
            total: 750,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: {
                ...SYNTHETIC_SHIPPING_ADDRESS,
                fullName: "Alice First",
            },
        };

        const payloadUserB = {
            userId: "user-bob",
            items: [{ productId: "prod-scarce-stock-1", quantity: 1 }],
            total: 750,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: {
                ...SYNTHETIC_SHIPPING_ADDRESS,
                fullName: "Bob Second",
            },
        };

        const reqA = createJsonPostRequest("http://localhost:3000/api/orders/create", payloadUserA);
        const reqB = createJsonPostRequest("http://localhost:3000/api/orders/create", payloadUserB);

        // Execute both requests concurrently
        const [resA, resB] = await Promise.all([
            createOrderRoute(reqA),
            createOrderRoute(reqB),
        ]);

        const statusA = resA.status;
        const statusB = resB.status;

        // Inspect final inventory in Firestore
        const productSnap = await adminDb!.collection("products").doc("prod-scarce-stock-1").get();
        const finalInventory = productSnap.data()?.inventory;

        // Count successful orders created for this test
        const ordersSnap = await adminDb!
            .collection("orders")
            .where("shippingAddress.fullName", "in", ["Alice First", "Bob Second"])
            .get();
        const successfulOrderCount = ordersSnap.size;

        console.log(`[CONCURRENCY TEST 007] Status A: ${statusA}, Status B: ${statusB}, Final Stock: ${finalInventory}, Orders Created: ${successfulOrderCount}`);

        // CONCURRENCY REQUIREMENT:
        // 1. Inventory must NEVER become negative (< 0)
        assert.ok(
            finalInventory >= 0,
            `CONCURRENCY FAILURE: Product inventory dropped below zero to ${finalInventory} due to unisolated batch increments!`
        );

        // 2. Exactly one order should succeed when stock was 1
        assert.equal(
            successfulOrderCount,
            1,
            `CONCURRENCY FAILURE: Expected exactly 1 order to succeed for stock=1, but ${successfulOrderCount} orders were committed!`
        );
    });

    it("CONCURRENCY TEST: Concurrent coupon redemptions with 1 redemption remaining", async () => {
        // Coupon LASTUSE1 has usageLimit: 5, timesUsed: 4 (1 redemption remaining).
        // User A and User B concurrently submit orders using LASTUSE1.
        const payloadUserA = {
            userId: "user-alice",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "LASTUSE1",
            total: 950,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const payloadUserB = {
            userId: "user-bob",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "LASTUSE1",
            total: 950,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const reqA = createJsonPostRequest("http://localhost:3000/api/orders/create", payloadUserA);
        const reqB = createJsonPostRequest("http://localhost:3000/api/orders/create", payloadUserB);

        await Promise.all([
            createOrderRoute(reqA),
            createOrderRoute(reqB),
        ]);

        const couponSnap = await adminDb!.collection("coupons").doc("LASTUSE1").get();
        const timesUsed = couponSnap.data()?.timesUsed;

        console.log(`[COUPON CONCURRENCY TEST] Final timesUsed for LASTUSE1: ${timesUsed} (limit: 5)`);

        assert.ok(
            timesUsed <= 5,
            `CONCURRENCY FAILURE: Coupon timesUsed (${timesUsed}) exceeded usageLimit (5)!`
        );
    });
});
