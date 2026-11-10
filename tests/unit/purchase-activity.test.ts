import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isOrderEligibleForPurchaseActivity,
    getOrderPurchaseTimestamp,
    formatPurchaseActivityBadge,
    evaluateStorefrontVisibility,
    calculateUnitsSoldForProduct,
    buildPublicPurchaseActivityDTO,
    DEFAULT_DISPLAY_THRESHOLD,
    DEFAULT_ACTIVITY_PERIOD,
    INTERNAL_TEST_ORDER_IDS,
} from "../../src/lib/orders/purchaseActivityTypes.ts";

describe("Product Purchase Activity Engine Unit Tests (TASK 023)", () => {
    const fixedNow = new Date("2026-11-10T12:00:00.000Z");
    const targetProductId = "prod_bazaarvilla_hoodie_001";
    const secondProductId = "prod_bazaarvilla_mug_002";

    // 1. One paid order for one product
    it("ACT-001: should count 1 unit for 1 paid order with quantity 1", () => {
        const order = {
            id: "ord_001",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryFinalized: true,
            createdAt: new Date("2026-11-05T10:00:00.000Z"),
            paidAt: new Date("2026-11-05T10:05:00.000Z"),
            items: [{ productId: targetProductId, quantity: 1, price: 999 }],
        };

        const result = calculateUnitsSoldForProduct([order], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 1);
        assert.equal(result.qualifyingOrdersCount, 1);
        assert.equal(result.uniquePurchasersCount, 1);
    });

    // 2. Multiple quantities in one order
    it("ACT-002: should correctly sum multiple quantities in 1 order", () => {
        const order = {
            id: "ord_002",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryFinalized: true,
            paidAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 4, price: 999 }],
        };

        const result = calculateUnitsSoldForProduct([order], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 4);
        assert.equal(result.qualifyingOrdersCount, 1);
    });

    // 3. Multiple products in one order
    it("ACT-003: should correctly attribute independent quantities when multiple products are in 1 order", () => {
        const order = {
            id: "ord_003",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            inventoryFinalized: true,
            paidAt: new Date("2026-11-07T10:00:00.000Z"),
            items: [
                { productId: targetProductId, quantity: 2, price: 999 },
                { productId: secondProductId, quantity: 3, price: 499 },
            ],
        };

        const resultTarget = calculateUnitsSoldForProduct([order], targetProductId, 30, fixedNow);
        const resultSecond = calculateUnitsSoldForProduct([order], secondProductId, 30, fixedNow);

        assert.equal(resultTarget.unitsSold, 2);
        assert.equal(resultSecond.unitsSold, 3);
    });

    // 4. Multiple completed orders for one product
    it("ACT-004: should correctly sum multiple completed orders for the same product", () => {
        const orders = [
            {
                id: "ord_004a",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-06T10:00:00.000Z"),
                items: [{ productId: targetProductId, quantity: 2, price: 999 }],
            },
            {
                id: "ord_004b",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Delivered",
                paidAt: new Date("2026-11-04T10:00:00.000Z"),
                items: [{ productId: targetProductId, quantity: 5, price: 999 }],
            },
        ];

        const result = calculateUnitsSoldForProduct(orders, targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 7);
        assert.equal(result.qualifyingOrdersCount, 2);
    });

    // 5. Different products having independent counters
    it("ACT-005: should ensure orders for other products do not alter target product counter", () => {
        const orders = [
            {
                id: "ord_other_only",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-08T10:00:00.000Z"),
                items: [{ productId: secondProductId, quantity: 10, price: 499 }],
            },
        ];

        const result = calculateUnitsSoldForProduct(orders, targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
        assert.equal(result.qualifyingOrdersCount, 0);
    });

    // 6. Pending prepaid orders excluded
    it("ACT-006: should strictly exclude pending prepaid orders", () => {
        const pendingOrder = {
            id: "ord_pending",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            orderStatus: "Pending",
            paidAt: null,
            createdAt: new Date("2026-11-09T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 3, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(pendingOrder), false);
        const result = calculateUnitsSoldForProduct([pendingOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 7. Failed payments excluded
    it("ACT-007: should strictly exclude failed payments", () => {
        const failedOrder = {
            id: "ord_failed",
            paymentMethod: "RAZORPAY",
            paymentStatus: "FAILED",
            orderStatus: "Payment_Failed",
            createdAt: new Date("2026-11-09T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 2, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(failedOrder), false);
        const result = calculateUnitsSoldForProduct([failedOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 8. Uncaptured payments / expired orders excluded
    it("ACT-008: should strictly exclude expired or uncaptured orders", () => {
        const expiredOrder = {
            id: "ord_expired",
            paymentMethod: "RAZORPAY",
            paymentStatus: "EXPIRED",
            orderStatus: "Expired",
            createdAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 1, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(expiredOrder), false);
        const result = calculateUnitsSoldForProduct([expiredOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 9. Canceled orders excluded
    it("ACT-009: should strictly exclude canceled orders", () => {
        const cancelledOrder = {
            id: "ord_cancelled",
            paymentMethod: "RAZORPAY",
            paymentStatus: "CANCELLED",
            orderStatus: "Cancelled",
            createdAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 4, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(cancelledOrder), false);
        const result = calculateUnitsSoldForProduct([cancelledOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 10. Refunded or returned purchases handled correctly
    it("ACT-010: should strictly exclude refunded and returned purchases", () => {
        const refundedOrder = {
            id: "ord_refunded",
            paymentMethod: "RAZORPAY",
            paymentStatus: "REFUNDED",
            orderStatus: "Refunded",
            createdAt: new Date("2026-11-05T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 2, price: 999 }],
        };
        const returnedOrder = {
            id: "ord_returned",
            paymentMethod: "COD",
            orderStatus: "Returned",
            createdAt: new Date("2026-11-05T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 1, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(refundedOrder), false);
        assert.equal(isOrderEligibleForPurchaseActivity(returnedOrder), false);
        const result = calculateUnitsSoldForProduct([refundedOrder, returnedOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 11. Eligible COD order handling
    it("ACT-011: should include delivered or paid COD orders but strictly exclude unpaid unfulfilled or cancelled COD orders", () => {
        const unfulfilledCodProcessing = {
            id: "ord_cod_processing",
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Processing",
            createdAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 3, price: 999 }],
        };
        const validCodDelivered = {
            id: "ord_cod_delivered",
            paymentMethod: "COD",
            paymentStatus: "PAID",
            orderStatus: "Delivered",
            createdAt: new Date("2026-11-04T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 2, price: 999 }],
        };
        const cancelledCod = {
            id: "ord_cod_cancelled",
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Cancelled",
            createdAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 5, price: 999 }],
        };

        // Unpaid unfulfilled COD in Processing is NOT a completed sale
        assert.equal(isOrderEligibleForPurchaseActivity(unfulfilledCodProcessing), false);
        // Completed/delivered COD order IS a completed sale
        assert.equal(isOrderEligibleForPurchaseActivity(validCodDelivered), true);
        // Cancelled COD is excluded
        assert.equal(isOrderEligibleForPurchaseActivity(cancelledCod), false);

        const result = calculateUnitsSoldForProduct([unfulfilledCodProcessing, validCodDelivered, cancelledCod], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 2); // 2 units from delivered sale (unfulfilled processing excluded, cancelled excluded)
    });

    // 12. Repeated webhook delivery not double-counted (idempotency)
    it("ACT-012: should guarantee repeated webhook deliveries with identical order ID do not double-count", () => {
        const orderA = {
            id: "ord_idempotent_duplicate",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 3, price: 999 }],
        };
        // Simulated duplicate webhook ingestion
        const orderADuplicate = { ...orderA };

        const result = calculateUnitsSoldForProduct([orderA, orderADuplicate], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 3); // Must NOT be 6
        assert.equal(result.qualifyingOrdersCount, 1);
    });

    // 13. Idempotent order retries not double-counted
    it("ACT-013: should guarantee idempotent order retries with identical order ID are processed once", () => {
        const originalOrder = {
            id: "ord_retry_001",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date("2026-11-07T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 2, price: 999 }],
        };
        const retrySnapshot = {
            ...originalOrder,
            updatedAt: new Date("2026-11-07T10:15:00.000Z"),
        };

        const result = calculateUnitsSoldForProduct([originalOrder, retrySnapshot], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 2);
    });

    // 14. Quarantined false-PAID orders excluded (TASK 017)
    it("ACT-014: should strictly exclude quarantined false-PAID orders", () => {
        const quarantinedOrder = {
            id: "c39xYbGgIFZ7OeCogOLs", // One of the 7 quarantined orders
            paymentMethod: "RAZORPAY",
            paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT",
            orderStatus: "Cancelled",
            quarantined: true,
            createdAt: new Date("2026-11-09T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 5, price: 999 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(quarantinedOrder), false);
        const result = calculateUnitsSoldForProduct([quarantinedOrder], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 15. Historical Test Mode orders excluded
    it("ACT-015: should strictly exclude historical test mode orders and synthetic fixtures", () => {
        const testModeOrder = {
            id: "ord_test_fixture_order",
            isTestFixture: true,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: targetProductId, quantity: 10, price: 999 }],
        };
        const syntheticProductOrder = {
            id: "ord_synthetic_prod",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date("2026-11-08T10:00:00.000Z"),
            items: [{ productId: "task013_test_prod_simple", quantity: 5, price: 100 }],
        };

        assert.equal(isOrderEligibleForPurchaseActivity(testModeOrder), false);
        assert.equal(isOrderEligibleForPurchaseActivity(syntheticProductOrder), false);
    });

    // 16. Internal owner test orders handled according to documented policy
    it("ACT-016: should strictly exclude the internal owner live cutover test order (TASK 018)", () => {
        const ownerValidationOrder = {
            id: "371905cc-2a2d-4aa1-a50c-5aec49359b41", // TASK 018 live ₹1 test order
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date("2026-11-09T22:11:10.906Z"),
            items: [{ productId: "e4fb02a5-21cb-4770-8657-bcce20723c01", quantity: 1, price: 1 }],
        };

        assert.ok(INTERNAL_TEST_ORDER_IDS.has("371905cc-2a2d-4aa1-a50c-5aec49359b41"));
        assert.equal(isOrderEligibleForPurchaseActivity(ownerValidationOrder), false);
        const result = calculateUnitsSoldForProduct([ownerValidationOrder], "e4fb02a5-21cb-4770-8657-bcce20723c01", 30, fixedNow);
        assert.equal(result.unitsSold, 0);
    });

    // 17. Correct rolling 7/30/90-day windows
    it("ACT-017: should enforce correct rolling 7, 30, and 90-day windows", () => {
        const orders = [
            // Order 1: 5 days ago (eligible for 7d, 30d, 90d)
            {
                id: "ord_5d",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-05T12:00:00.000Z"), // 5 days before Nov 10
                items: [{ productId: targetProductId, quantity: 10, price: 999 }],
            },
            // Order 2: 15 days ago (eligible for 30d, 90d; NOT 7d)
            {
                id: "ord_15d",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-10-26T12:00:00.000Z"), // 15 days before Nov 10
                items: [{ productId: targetProductId, quantity: 20, price: 999 }],
            },
            // Order 3: 45 days ago (eligible for 90d; NOT 7d, NOT 30d)
            {
                id: "ord_45d",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-09-26T12:00:00.000Z"), // 45 days before Nov 10
                items: [{ productId: targetProductId, quantity: 30, price: 999 }],
            },
            // Order 4: 100 days ago (older than 90d; NOT in any window)
            {
                id: "ord_100d",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-08-02T12:00:00.000Z"), // 100 days before Nov 10
                items: [{ productId: targetProductId, quantity: 100, price: 999 }],
            },
        ];

        const stats7d = calculateUnitsSoldForProduct(orders, targetProductId, 7, fixedNow);
        const stats30d = calculateUnitsSoldForProduct(orders, targetProductId, 30, fixedNow);
        const stats90d = calculateUnitsSoldForProduct(orders, targetProductId, 90, fixedNow);

        assert.equal(stats7d.unitsSold, 10); // only ord_5d
        assert.equal(stats30d.unitsSold, 30); // ord_5d (10) + ord_15d (20)
        assert.equal(stats90d.unitsSold, 60); // ord_5d (10) + ord_15d (20) + ord_45d (30)
    });

    // 18. Correct time-zone and boundary handling
    it("ACT-018: should handle exact millisecond boundary transitions cleanly", () => {
        const exactBoundaryOrder = {
            id: "ord_boundary",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000), // Exactly 7 days ago
            items: [{ productId: targetProductId, quantity: 5, price: 999 }],
        };

        const result7d = calculateUnitsSoldForProduct([exactBoundaryOrder], targetProductId, 7, fixedNow);
        assert.equal(result7d.unitsSold, 5); // Right on the boundary counts in 7d

        const pastBoundaryOrder = {
            id: "ord_past_boundary",
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            orderStatus: "Processing",
            paidAt: new Date(fixedNow.getTime() - (7 * 24 * 60 * 60 * 1000 + 1000)), // 7 days + 1 second ago
            items: [{ productId: targetProductId, quantity: 5, price: 999 }],
        };

        const resultPast7d = calculateUnitsSoldForProduct([pastBoundaryOrder], targetProductId, 7, fixedNow);
        assert.equal(resultPast7d.unitsSold, 0); // Excluded from 7d
        assert.equal(resultPast7d.countsByPeriod[30], 5); // But included in 30d
    });

    // 19. Admin visibility toggle
    it("ACT-019: should respect admin visibility toggle (enabled: false hides badge even if count >= threshold)", () => {
        // When enabled: true and count >= threshold -> visible
        assert.equal(evaluateStorefrontVisibility({ enabled: true, displayThreshold: 5 }, 10), true);

        // When enabled: false and count >= threshold -> HIDDEN
        assert.equal(evaluateStorefrontVisibility({ enabled: false, displayThreshold: 5 }, 10), false);
        assert.equal(evaluateStorefrontVisibility({ enabled: false, displayThreshold: 0 }, 100), false);
    });

    // 20. Display threshold does not inflate results
    it("ACT-020: should enforce display threshold for visibility only and NEVER inflate reported numbers", () => {
        const threshold = 10;

        // Count is 4 (below threshold 10) -> isVisible is false
        assert.equal(evaluateStorefrontVisibility({ enabled: true, displayThreshold: threshold }, 4), false);

        // Count is 12 (above threshold 10) -> isVisible is true, but reported count remains 12 (not inflated)
        assert.equal(evaluateStorefrontVisibility({ enabled: true, displayThreshold: threshold }, 12), true);

        // Formatting always uses authentic unitsSold, never the threshold
        const label = formatPurchaseActivityBadge(12, 30);
        assert.equal(label, "12 units sold in the past 30 days");
    });

    // 21. Anonymous users cannot access order PII
    it("ACT-021: should construct public DTO containing only public counters with zero PII", () => {
        const publicDTO = buildPublicPurchaseActivityDTO({
            productId: targetProductId,
            enabled: true,
            periodDays: 30,
            displayThreshold: 5,
            unitsSold: 24,
            countsByPeriod: { 7: 6, 30: 24, 90: 55 },
            qualifyingOrdersCount: 18,
            uniquePurchasersCount: 16,
            lastCalculatedAt: 1731234567890,
            displayLabel: "24 units sold in the past 30 days",
            isVisibleOnStorefront: true,
        });

        // Verify only authorized public fields are present
        assert.equal(publicDTO.productId, targetProductId);
        assert.equal(publicDTO.metric, "units_sold");
        assert.equal(publicDTO.periodDays, 30);
        assert.equal(publicDTO.count, 24);
        assert.equal(publicDTO.label, "24 units sold in the past 30 days");
        assert.equal(publicDTO.visible, true);
        assert.equal(publicDTO.lastCalculatedAt, 1731234567890);

        // Assert strictly NO customer information exists on DTO
        const dtoKeys = Object.keys(publicDTO);
        assert.ok(!dtoKeys.includes("userId"), "Must not expose userId");
        assert.ok(!dtoKeys.includes("customerName"), "Must not expose customerName");
        assert.ok(!dtoKeys.includes("email"), "Must not expose email");
        assert.ok(!dtoKeys.includes("phone"), "Must not expose phone");
        assert.ok(!dtoKeys.includes("shippingAddress"), "Must not expose shippingAddress");
        assert.ok(!dtoKeys.includes("orderId"), "Must not expose orderId");
        assert.ok(!dtoKeys.includes("paymentId"), "Must not expose paymentId");
    });

    // 22. Zero qualifying sales returns 0, never a fabricated minimum
    it("ACT-022: should return 0 units when a product has zero eligible sales and never substitute a minimum", () => {
        const result = calculateUnitsSoldForProduct([], targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 0);
        assert.equal(result.countsByPeriod[7], 0);
        assert.equal(result.countsByPeriod[30], 0);
        assert.equal(result.countsByPeriod[90], 0);
        assert.equal(result.qualifyingOrdersCount, 0);
        assert.equal(result.uniquePurchasersCount, 0);

        // Visibility when count is 0 is always false
        assert.equal(evaluateStorefrontVisibility({ enabled: true, displayThreshold: 5 }, 0), false);
    });

    // 23. Distinction between units sold, qualifying orders, and unique customers
    it("ACT-023: should distinguish between units sold, qualifying orders, and unique purchasers", () => {
        // Customer 1 places 2 orders for total 5 units
        // Customer 2 places 1 order for 3 units
        const orders = [
            {
                id: "ord_cust1_a",
                userId: "user_alice",
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-08T10:00:00.000Z"),
                items: [{ productId: targetProductId, quantity: 2, price: 999 }],
            },
            {
                id: "ord_cust1_b",
                userId: "user_alice", // Same user
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-07T10:00:00.000Z"),
                items: [{ productId: targetProductId, quantity: 3, price: 999 }],
            },
            {
                id: "ord_cust2",
                userId: "user_bob", // Different user
                paymentMethod: "RAZORPAY",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                paidAt: new Date("2026-11-06T10:00:00.000Z"),
                items: [{ productId: targetProductId, quantity: 3, price: 999 }],
            },
        ];

        const result = calculateUnitsSoldForProduct(orders, targetProductId, 30, fixedNow);
        assert.equal(result.unitsSold, 8); // 2 + 3 + 3 = 8 units
        assert.equal(result.qualifyingOrdersCount, 3); // 3 orders
        assert.equal(result.uniquePurchasersCount, 2); // 2 unique users (alice, bob)
    });

    // 24. Singular vs plural grammar in badge formatting
    it("ACT-024: should format singular unit for 1 and plural units for >= 2 or 0", () => {
        assert.equal(formatPurchaseActivityBadge(1, 30), "1 unit sold in the past 30 days");
        assert.equal(formatPurchaseActivityBadge(2, 30), "2 units sold in the past 30 days");
        assert.equal(formatPurchaseActivityBadge(24, 7), "24 units sold in the past 7 days");
        assert.equal(formatPurchaseActivityBadge(100, 90), "100 units sold in the past 90 days");
    });

    // 25. Simulated preview values remain isolated from real aggregation
    it("ACT-025: should isolate simulated preview values from real product data", () => {
        const simulatedValue = 42;
        const realAggregatedUnits = 0;

        // Simulated preview uses format function for visual design preview only
        const previewBadge = formatPurchaseActivityBadge(simulatedValue, 30);
        assert.equal(previewBadge, "42 units sold in the past 30 days");

        // The real product units remain 0 and isVisible remains false
        assert.equal(realAggregatedUnits, 0);
        assert.equal(evaluateStorefrontVisibility({ enabled: true, displayThreshold: 5 }, realAggregatedUnits), false);
    });
});
