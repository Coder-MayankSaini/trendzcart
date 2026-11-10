/**
 * Product Purchase Activity Types & Isomorphic Helpers (TASK 023)
 *
 * Client-safe pure types, formatting, and aggregation functions.
 * Free of Node-specific dependencies (such as firebase-admin) so it can be safely
 * bundled in React 19 Client Components and Server Components.
 */

export type PurchaseActivityPeriod = 7 | 30 | 90;

export const DEFAULT_ACTIVITY_PERIOD: PurchaseActivityPeriod = 30;
export const DEFAULT_DISPLAY_THRESHOLD = 5;
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour freshness target

export interface ProductPurchaseActivityConfig {
    enabled: boolean;
    periodDays: PurchaseActivityPeriod;
    displayThreshold: number;
}

export interface ProductPurchaseActivityStats {
    productId: string;
    unitsSold: number;
    countsByPeriod: Record<PurchaseActivityPeriod, number>;
    qualifyingOrdersCount: number;
    uniquePurchasersCount: number;
    lastCalculatedAt: number;
}

export interface ProductPurchaseActivityData extends ProductPurchaseActivityConfig, ProductPurchaseActivityStats {
    displayLabel: string;
    isVisibleOnStorefront: boolean;
}

export interface PublicPurchaseActivityDTO {
    productId: string;
    metric: "units_sold";
    periodDays: PurchaseActivityPeriod;
    count: number;
    displayThreshold: number;
    label: string;
    visible: boolean;
    lastCalculatedAt: number;
}

/**
 * Known internal validation and owner test order IDs that must be excluded
 * from customer-facing demand calculations.
 */
export const INTERNAL_TEST_ORDER_IDS = new Set<string>([
    "371905cc-2a2d-4aa1-a50c-5aec49359b41", // TASK 018 owner live 1-rupee test
]);

/**
 * Known test fixture product IDs that are not commercial inventory.
 */
export const TEST_FIXTURE_PRODUCT_IDS = new Set<string>([
    "task013_test_prod_custom",
    "task013_test_prod_lowstock",
    "task013_test_prod_simple",
    "e4fb02a5-21cb-4770-8657-bcce20723c01", // 1Rupee Test item
]);

/**
 * Validates whether an individual order represents a genuine, completed commercial purchase.
 */
export function isOrderEligibleForPurchaseActivity(order: any): boolean {
    if (!order || typeof order !== "object") {
        return false;
    }

    // 1. Quarantined historical false-PAID orders (TASK 017)
    if (
        order.quarantined === true ||
        order.paymentStatus === "UNPAID_SYNTHETIC_ARTIFACT" ||
        order.orderStatus === "Synthetic_Test_Artifact"
    ) {
        return false;
    }

    // 2. Explicit cancellation, return, or refund states
    const cancelledOrReturnedStatuses = ["Cancelled", "Refunded", "Returned"];
    if (cancelledOrReturnedStatuses.includes(order.orderStatus)) {
        return false;
    }
    if (order.paymentStatus === "CANCELLED" || order.paymentStatus === "REFUNDED") {
        return false;
    }

    // 3. Failed or expired payment states
    if (order.paymentStatus === "FAILED" || order.paymentStatus === "EXPIRED") {
        return false;
    }

    // 4. Test fixtures and internal owner test transactions
    if (order.isTestFixture === true || order.allowTestFixtures === true) {
        return false;
    }
    if (order.id && INTERNAL_TEST_ORDER_IDS.has(order.id)) {
        return false;
    }

    // Check if the order contains test fixture products
    if (Array.isArray(order.items)) {
        const containsTestFixture = order.items.some((item: any) => {
            const pid = item?.productId || item?.id;
            return pid && (TEST_FIXTURE_PRODUCT_IDS.has(pid) || pid.startsWith("task013_"));
        });
        if (containsTestFixture) {
            return false;
        }
    }

    // 5. Payment method evaluation
    const paymentMethod = (order.paymentMethod || "RAZORPAY").toUpperCase();

    if (paymentMethod === "COD") {
        // Truth-in-advertising: For "units sold", an unpaid/unfulfilled COD order in "Processing"
        // or "Shipped" is NOT a completed sale. A COD order is only eligible once delivered or paid.
        if (order.paymentStatus === "PAID") {
            return true;
        }
        const completedCodStatuses = ["Completed", "Delivered"];
        return completedCodStatuses.includes(order.orderStatus);
    }

    if (paymentMethod === "RAZORPAY" || paymentMethod === "PREPAID") {
        // Prepaid orders MUST have confirmed captured payment
        if (order.paymentStatus !== "PAID") {
            return false;
        }

        // Must have finalized inventory or valid post-payment status
        const validPaidStatuses = ["Processing", "Completed", "Delivered", "Shipped"];
        const hasValidStatus = validPaidStatuses.includes(order.orderStatus);
        const hasFinalizedInventory = order.inventoryFinalized === true;

        return hasValidStatus || hasFinalizedInventory;
    }

    // Reject unknown or unhandled payment methods
    return false;
}

/**
 * Extracts the authoritative purchase epoch timestamp (in milliseconds) from an order.
 * Prioritizes payment confirmation date (paidAt), falling back to creation date (createdAt).
 */
export function getOrderPurchaseTimestamp(order: any): number {
    if (!order) return 0;

    const candidate = order.paidAt || order.deliveredAt || order.createdAt || order.updatedAt;
    if (!candidate) return 0;

    if (typeof candidate.toMillis === "function") {
        return candidate.toMillis();
    }
    if (typeof candidate.toDate === "function") {
        return candidate.toDate().getTime();
    }
    if (candidate instanceof Date) {
        return candidate.getTime();
    }
    if (typeof candidate === "number") {
        return candidate;
    }
    if (typeof candidate === "string") {
        const parsed = Date.parse(candidate);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

/**
 * Formats the purchase activity badge label using clear rolling-window semantics.
 */
export function formatPurchaseActivityBadge(
    unitsSold: number,
    periodDays: PurchaseActivityPeriod
): string {
    const unitWord = unitsSold === 1 ? "unit" : "units";
    return `${unitsSold} ${unitWord} sold in the past ${periodDays} days`;
}

/**
 * Determines whether the purchase activity counter should be visible on the public storefront.
 * The displayThreshold controls visibility only; it NEVER inflates reported numbers.
 */
export function evaluateStorefrontVisibility(
    config: { enabled?: boolean; displayThreshold?: number } | null | undefined,
    unitsSold: number
): boolean {
    const isEnabled = config?.enabled ?? true;
    const threshold = typeof config?.displayThreshold === "number" ? Math.max(0, config.displayThreshold) : DEFAULT_DISPLAY_THRESHOLD;

    return isEnabled && unitsSold >= threshold && unitsSold > 0;
}

/**
 * Aggregates product purchase counts across rolling 7, 30, and 90 day windows
 * from a list of order documents. Operates idempotently by order ID.
 */
export function calculateUnitsSoldForProduct(
    orders: any[],
    productId: string,
    periodDays: PurchaseActivityPeriod = DEFAULT_ACTIVITY_PERIOD,
    referenceNow: Date | number = Date.now()
): {
    unitsSold: number;
    countsByPeriod: Record<PurchaseActivityPeriod, number>;
    qualifyingOrdersCount: number;
    uniquePurchasersCount: number;
} {
    const nowMs = typeof referenceNow === "number" ? referenceNow : referenceNow.getTime();

    const countsByPeriod: Record<PurchaseActivityPeriod, number> = {
        7: 0,
        30: 0,
        90: 0,
    };

    let qualifyingOrdersCount = 0;
    const uniquePurchasersSet = new Set<string>();
    const processedOrderIds = new Set<string>();

    for (const order of orders) {
        // Enforce idempotency: process each order document at most once
        const orderId = order.id || order._id;
        if (orderId && processedOrderIds.has(orderId)) {
            continue;
        }
        if (orderId) {
            processedOrderIds.add(orderId);
        }

        if (!isOrderEligibleForPurchaseActivity(order)) {
            continue;
        }

        const purchaseTimestamp = getOrderPurchaseTimestamp(order);
        if (purchaseTimestamp <= 0) {
            continue;
        }

        const ageMs = nowMs - purchaseTimestamp;
        // Exclude future-dated orders (beyond 2-minute clock skew allowance)
        if (ageMs < -120_000) {
            continue;
        }

        const clampedAgeMs = Math.max(0, ageMs);

        // Sum units for matching product in this order
        let unitsInThisOrder = 0;
        const items = Array.isArray(order.items) ? order.items : [];

        for (const item of items) {
            const itemId = item?.productId || item?.id;
            if (itemId === productId) {
                const qty = Number(item?.quantity);
                if (Number.isFinite(qty) && qty > 0) {
                    unitsInThisOrder += Math.floor(qty);
                }
            }
        }

        if (unitsInThisOrder <= 0) {
            continue;
        }

        // Apply rolling window buckets
        const ms7d = 7 * 24 * 60 * 60 * 1000;
        const ms30d = 30 * 24 * 60 * 60 * 1000;
        const ms90d = 90 * 24 * 60 * 60 * 1000;

        if (clampedAgeMs <= ms7d) {
            countsByPeriod[7] += unitsInThisOrder;
        }
        if (clampedAgeMs <= ms30d) {
            countsByPeriod[30] += unitsInThisOrder;

            // Track qualifying orders and unique purchasers for the default 30d window
            qualifyingOrdersCount += 1;
            const purchaserIdentifier =
                order.userId ||
                order.shippingAddress?.email?.toLowerCase().trim() ||
                order.shippingAddress?.phone ||
                orderId;
            if (purchaserIdentifier) {
                uniquePurchasersSet.add(purchaserIdentifier);
            }
        }
        if (clampedAgeMs <= ms90d) {
            countsByPeriod[90] += unitsInThisOrder;
        }
    }

    const selectedUnitsSold = countsByPeriod[periodDays] ?? countsByPeriod[30];

    return {
        unitsSold: selectedUnitsSold,
        countsByPeriod,
        qualifyingOrdersCount,
        uniquePurchasersCount: uniquePurchasersSet.size,
    };
}

/**
 * Builds the public, privacy-safe DTO for public consumption.
 * Strictly redacts customer PII, order IDs, addresses, and internal metadata.
 */
export function buildPublicPurchaseActivityDTO(
    activity: ProductPurchaseActivityData | (ProductPurchaseActivityConfig & ProductPurchaseActivityStats)
): PublicPurchaseActivityDTO {
    const isVisible = evaluateStorefrontVisibility(
        { enabled: activity.enabled, displayThreshold: activity.displayThreshold },
        activity.unitsSold
    );

    return {
        productId: activity.productId,
        metric: "units_sold",
        periodDays: activity.periodDays,
        count: activity.unitsSold,
        displayThreshold: activity.displayThreshold,
        label: formatPurchaseActivityBadge(activity.unitsSold, activity.periodDays),
        visible: isVisible,
        lastCalculatedAt: activity.lastCalculatedAt,
    };
}
