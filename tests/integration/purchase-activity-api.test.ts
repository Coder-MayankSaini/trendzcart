import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as publicPurchaseActivityRoute } from "../../src/app/api/products/[id]/purchase-activity/route.ts";
import { POST as adminPurchaseActivityRoute } from "../../src/app/api/admin/products/[id]/purchase-activity/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";

describe("Product Purchase Activity API & Security Integration Tests (TASK 023)", () => {
    const adminUid = "admin_user_task023";
    const customerUid = "customer_user_task023";
    const commercialProductId = "prod_bazaarvilla_linen_shirt";
    const emptyProductId = "prod_bazaarvilla_no_sales";
    const testFixtureId = "task013_test_prod_simple";

    let adminToken: string;
    let customerToken: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized. Ensure Firebase emulator is running.");
        }

        // Setup test users in Auth Emulator
        for (const uid of [adminUid, customerUid]) {
            try { await adminAuth.deleteUser(uid); } catch {}
        }

        await adminAuth.createUser({
            uid: adminUid,
            email: "admin023@bazaarvilla.test",
            displayName: "Bazaarvilla Admin",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer023@bazaarvilla.test",
            displayName: "Regular Customer",
        });

        adminToken = await getSyntheticUserAuthToken(adminUid);
        customerToken = await getSyntheticUserAuthToken(customerUid);
    });

    beforeEach(async () => {
        if (!adminDb) return;

        await clearCollection(adminDb, "products");
        await clearCollection(adminDb, "orders");

        // Seed commercial product
        await adminDb.collection("products").doc(commercialProductId).set({
            id: commercialProductId,
            name: "Bazaarvilla Premium Linen Shirt",
            slug: "bazaarvilla-premium-linen-shirt",
            price: 1499,
            inventory: 50,
            isVisible: true,
            createdAt: Date.now(),
        });

        // Seed empty product
        await adminDb.collection("products").doc(emptyProductId).set({
            id: emptyProductId,
            name: "Bazaarvilla Silk Pocket Square",
            slug: "bazaarvilla-silk-pocket-square",
            price: 499,
            inventory: 10,
            isVisible: true,
            createdAt: Date.now(),
        });

        // Seed test fixture product
        await adminDb.collection("products").doc(testFixtureId).set({
            id: testFixtureId,
            name: "Synthetic Test Fixture",
            slug: "synthetic-test-fixture",
            isTestFixture: true,
            isArchived: true,
            isVisible: false,
            createdAt: Date.now(),
        });
    });

    // 1. Admin Auth Enforcement
    it("ACT-API-001: should reject unauthenticated POST to admin purchase-activity API with HTTP 401", async () => {
        const req = new NextRequest(`http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`, {
            method: "POST",
            body: JSON.stringify({ enabled: true }),
        });

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 401);
        const data = await res.json();
        assert.ok(data.error);
    });

    it("ACT-API-002: should reject non-admin customer POST to admin purchase-activity API with HTTP 403", async () => {
        const req = createJsonPostRequest(
            `http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`,
            { enabled: true },
            { Authorization: `Bearer ${customerToken}` }
        );

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 403);
        const data = await res.json();
        assert.ok(data.error.includes("Forbidden") || data.error.includes("privileges"));
    });

    it("ACT-API-003: should reject invalid periodDays (must be 7, 30, or 90) with HTTP 400", async () => {
        const req = createJsonPostRequest(
            `http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`,
            { periodDays: 45 },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("7, 30, or 90"));
    });

    it("ACT-API-004: should reject negative displayThreshold with HTTP 400", async () => {
        const req = createJsonPostRequest(
            `http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`,
            { displayThreshold: -5 },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("non-negative"));
    });

    // 2. Admin Recalculation & Config Persistence
    it("ACT-API-005: should allow authorized admin to configure settings and recalculate stats", async () => {
        // Seed 2 paid orders and 1 COD order for commercialProductId
        const now = new Date();
        const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

        await adminDb!.collection("orders").doc("ord_paid_1").set({
            id: "ord_paid_1",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryFinalized: true,
            createdAt: fourDaysAgo,
            paidAt: fourDaysAgo,
            items: [{ productId: commercialProductId, quantity: 3, price: 1499 }],
        });

        await adminDb!.collection("orders").doc("ord_cod_2").set({
            id: "ord_cod_2",
            paymentMethod: "COD",
            paymentStatus: "PAID",
            orderStatus: "Delivered",
            createdAt: tenDaysAgo,
            items: [{ productId: commercialProductId, quantity: 5, price: 1499 }],
        });

        // Seed 1 cancelled order that must be excluded
        await adminDb!.collection("orders").doc("ord_cancelled").set({
            id: "ord_cancelled",
            paymentMethod: "RAZORPAY",
            paymentStatus: "CANCELLED",
            orderStatus: "Cancelled",
            createdAt: fourDaysAgo,
            items: [{ productId: commercialProductId, quantity: 10, price: 1499 }],
        });

        const req = createJsonPostRequest(
            `http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`,
            {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.activity.unitsSold, 8); // 3 + 5 (10 cancelled excluded)
        assert.equal(data.activity.countsByPeriod[7], 3); // 3 units within 7 days
        assert.equal(data.activity.countsByPeriod[30], 8); // 8 units within 30 days
        assert.equal(data.activity.displayLabel, "8 units sold in the past 30 days");
        assert.equal(data.activity.isVisibleOnStorefront, true);

        // Verify product in Firestore was updated
        const productSnap = await adminDb!.collection("products").doc(commercialProductId).get();
        const savedActivity = productSnap.data()?.purchaseActivity;
        assert.equal(savedActivity.unitsSold, 8);
        assert.equal(savedActivity.periodDays, 30);
        assert.equal(savedActivity.displayThreshold, 5);
    });

    // 3. Public API & Privacy Protection
    it("ACT-API-006: public API should return public DTO without customer PII or raw orders", async () => {
        // Pre-populate product purchaseActivity
        await adminDb!.collection("products").doc(commercialProductId).update({
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 12,
                countsByPeriod: { 7: 4, 30: 12, 90: 25 },
                qualifyingOrdersCount: 8,
                uniquePurchasersCount: 7,
                lastCalculatedAt: Date.now(),
            },
        });

        const req = new NextRequest(`http://localhost:3000/api/products/${commercialProductId}/purchase-activity`);
        const res = await publicPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();

        // Check public DTO structure
        assert.equal(data.productId, commercialProductId);
        assert.equal(data.metric, "units_sold");
        assert.equal(data.periodDays, 30);
        assert.equal(data.count, 12);
        assert.equal(data.label, "12 units sold in the past 30 days");
        assert.equal(data.visible, true);
        assert.ok(typeof data.lastCalculatedAt === "number");

        // Assert strictly NO customer information or orders exposed
        assert.equal(data.userId, undefined);
        assert.equal(data.customerName, undefined);
        assert.equal(data.email, undefined);
        assert.equal(data.phone, undefined);
        assert.equal(data.shippingAddress, undefined);
        assert.equal(data.orderId, undefined);
        assert.equal(data.orders, undefined);
    });

    it("ACT-API-007: public API should return visible: false when count < displayThreshold", async () => {
        await adminDb!.collection("products").doc(commercialProductId).update({
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 10, // Threshold is 10
                unitsSold: 3,         // Count is only 3
                lastCalculatedAt: Date.now(),
            },
        });

        const req = new NextRequest(`http://localhost:3000/api/products/${commercialProductId}/purchase-activity`);
        const res = await publicPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.visible, false);
        assert.equal(data.count, 3); // Authentic count is not inflated
    });

    it("ACT-API-008: public API should return 404 for synthetic test fixtures and nonexistent products", async () => {
        // Test fixture product ID
        const reqFixture = new NextRequest(`http://localhost:3000/api/products/${testFixtureId}/purchase-activity`);
        const resFixture = await publicPurchaseActivityRoute(reqFixture, {
            params: Promise.resolve({ id: testFixtureId }),
        });
        assert.equal(resFixture.status, 404);

        // Nonexistent product ID
        const reqNotFound = new NextRequest("http://localhost:3000/api/products/nonexistent-id/purchase-activity");
        const resNotFound = await publicPurchaseActivityRoute(reqNotFound, {
            params: Promise.resolve({ id: "nonexistent-id" }),
        });
        assert.equal(resNotFound.status, 404);
    });

    it("ACT-API-009: public API should return 0 units when product has no sales and not invent base numbers", async () => {
        const req = new NextRequest(`http://localhost:3000/api/products/${emptyProductId}/purchase-activity`);
        const res = await publicPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: emptyProductId }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.count, 0);
        assert.equal(data.visible, false);
        assert.equal(data.label, "0 units sold in the past 30 days");
    });

    it("ACT-API-010: should strictly exclude quarantined false-PAID orders from real Firestore aggregation", async () => {
        const now = new Date();

        // 1 genuine order for 2 units
        await adminDb!.collection("orders").doc("ord_genuine").set({
            id: "ord_genuine",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryFinalized: true,
            createdAt: now,
            paidAt: now,
            items: [{ productId: commercialProductId, quantity: 2, price: 1499 }],
        });

        // 1 quarantined false-PAID order for 50 units (simulating TASK 017 artifact)
        await adminDb!.collection("orders").doc("c39xYbGgIFZ7OeCogOLs").set({
            id: "c39xYbGgIFZ7OeCogOLs",
            paymentMethod: "RAZORPAY",
            paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT",
            orderStatus: "Cancelled",
            quarantined: true,
            createdAt: now,
            items: [{ productId: commercialProductId, quantity: 50, price: 1499 }],
        });

        const req = createJsonPostRequest(
            `http://localhost:3000/api/admin/products/${commercialProductId}/purchase-activity`,
            { recalculate: true },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await adminPurchaseActivityRoute(req, {
            params: Promise.resolve({ id: commercialProductId }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.activity.unitsSold, 2); // 50 quarantined units strictly excluded!
    });
});
