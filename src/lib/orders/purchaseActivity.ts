/**
 * Product Purchase Activity Server Engine (TASK 023)
 *
 * Server-only calculation and persistence engine requiring Firebase Admin SDK.
 * Bounded query and aggregation for Firestore orders.
 */

import * as adminModule from "firebase-admin";
import type {
    ProductPurchaseActivityConfig,
    ProductPurchaseActivityData,
    PurchaseActivityPeriod,
    PurchaseActivityDisplayMode,
} from "./purchaseActivityTypes";
import {
    DEFAULT_ACTIVITY_PERIOD,
    DEFAULT_DISPLAY_THRESHOLD,
    MAX_CONFIGURED_UNITS,
    CACHE_TTL_MS,
    calculateUnitsSoldForProduct,
    evaluateStorefrontVisibility,
    formatPurchaseActivityBadge,
} from "./purchaseActivityTypes";

// Re-export all client-safe isomorphic types, constants, and utilities
export * from "./purchaseActivityTypes";

// In-flight calculation deduplication map to prevent concurrent executions for the same product
const inflightRecalculations = new Map<string, Promise<ProductPurchaseActivityData>>();

/**
 * Calculates fresh purchase activity stats for a product from Firestore orders,
 * updates the cached purchaseActivity field on the product document, and returns
 * the complete activity data.
 *
 * Reliably separates authoritative transaction-derived metrics (orderUnitsSold,
 * countsByPeriod, qualifyingOrdersCount) from administrator-configured display
 * values (customUnitsSold, displayMode).
 */
export async function calculateAndPersistProductPurchaseActivity(
    db: adminModule.firestore.Firestore,
    productId: string,
    configOverride?: Partial<ProductPurchaseActivityConfig>
): Promise<ProductPurchaseActivityData> {
    // Deduplicate concurrent recalculations for the same product when no explicit configOverride is provided
    if (!configOverride && inflightRecalculations.has(productId)) {
        return inflightRecalculations.get(productId)!;
    }

    const calculationPromise = (async () => {
        const productRef = db.collection("products").doc(productId);
        const productSnap = await productRef.get();

        if (!productSnap.exists) {
            throw new Error(`Product not found: ${productId}`);
        }

        const productData = productSnap.data() || {};
        const existingActivity = productData.purchaseActivity || {};

        // 1. Resolve Display Mode ("auto" | "custom")
        let displayMode: PurchaseActivityDisplayMode = "auto";
        if (configOverride?.displayMode === "auto" || configOverride?.displayMode === "custom") {
            displayMode = configOverride.displayMode;
        } else if (configOverride?.isCustomCount !== undefined) {
            displayMode = configOverride.isCustomCount ? "custom" : "auto";
        } else if (existingActivity.displayMode === "auto" || existingActivity.displayMode === "custom") {
            displayMode = existingActivity.displayMode;
        } else if (existingActivity.isCustomCount !== undefined) {
            displayMode = existingActivity.isCustomCount ? "custom" : "auto";
        }

        // 2. Resolve Configured Custom Count (clamped to [0, MAX_CONFIGURED_UNITS])
        let customUnitsSold = 0;
        if (typeof configOverride?.customUnitsSold === "number") {
            customUnitsSold = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(configOverride.customUnitsSold)));
        } else if (displayMode === "custom" && typeof configOverride?.unitsSold === "number") {
            customUnitsSold = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(configOverride.unitsSold)));
        } else if (typeof existingActivity.customUnitsSold === "number") {
            customUnitsSold = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(existingActivity.customUnitsSold)));
        } else if (displayMode === "custom" && typeof existingActivity.unitsSold === "number") {
            customUnitsSold = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(existingActivity.unitsSold)));
        }

        // 3. Resolve Display Controls (Period, Threshold, Enabled)
        const periodDays: PurchaseActivityPeriod = (
            configOverride?.periodDays && [7, 30, 90].includes(configOverride.periodDays)
                ? configOverride.periodDays
                : (existingActivity.periodDays && [7, 30, 90].includes(existingActivity.periodDays)
                    ? existingActivity.periodDays
                    : DEFAULT_ACTIVITY_PERIOD)
        ) as PurchaseActivityPeriod;

        const displayThreshold = typeof configOverride?.displayThreshold === "number"
            ? Math.max(0, Math.floor(configOverride.displayThreshold))
            : (typeof existingActivity.displayThreshold === "number"
                ? Math.max(0, Math.floor(existingActivity.displayThreshold))
                : DEFAULT_DISPLAY_THRESHOLD);

        const enabled = typeof configOverride?.enabled === "boolean"
            ? configOverride.enabled
            : (existingActivity.enabled ?? true);

        // 4. Authoritative Order Metrics Sync
        // Only run expensive Firestore orders scan when forced, missing buckets, or cache expired
        let countsByPeriod: Record<PurchaseActivityPeriod, number> = existingActivity.countsByPeriod || { 7: 0, 30: 0, 90: 0 };
        let qualifyingOrdersCount = existingActivity.qualifyingOrdersCount ?? 0;
        let uniquePurchasersCount = existingActivity.uniquePurchasersCount ?? 0;
        let orderUnitsSold = existingActivity.orderUnitsSold ?? countsByPeriod[periodDays] ?? 0;
        let lastOrderSyncAt = existingActivity.lastOrderSyncAt ?? existingActivity.lastCalculatedAt ?? 0;

        const isSwitchingToAuto = (existingActivity.displayMode === "custom" || existingActivity.isCustomCount === true) && displayMode === "auto";
        const hasAllPeriodBuckets = Boolean(
            existingActivity.countsByPeriod &&
            typeof existingActivity.countsByPeriod[7] === "number" &&
            typeof existingActivity.countsByPeriod[30] === "number" &&
            typeof existingActivity.countsByPeriod[90] === "number"
        );

        const needsOrderSync = (
            configOverride?.forceLiveRecalculate === true ||
            isSwitchingToAuto ||
            !hasAllPeriodBuckets ||
            !lastOrderSyncAt ||
            (Date.now() - lastOrderSyncAt > CACHE_TTL_MS)
        );

        if (needsOrderSync) {
            // Bounded query: Read orders from the past 90 days with a safety limit of 1000 documents
            const ninetyDaysAgo = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000); // 92 days with buffer
            const ordersSnap = await db
                .collection("orders")
                .where("createdAt", ">=", ninetyDaysAgo)
                .limit(1000)
                .get();

            const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

            const stats = calculateUnitsSoldForProduct(
                orders,
                productId,
                periodDays,
                Date.now()
            );

            countsByPeriod = stats.countsByPeriod;
            qualifyingOrdersCount = stats.qualifyingOrdersCount;
            uniquePurchasersCount = stats.uniquePurchasersCount;
            orderUnitsSold = stats.unitsSold;
            lastOrderSyncAt = Date.now();
        } else {
            // Update orderUnitsSold for the resolved period from cached genuine buckets
            orderUnitsSold = countsByPeriod[periodDays] ?? 0;
        }

        // 5. Compute Effective Display Units Sold
        // If custom mode is active, display the admin-configured value; otherwise use genuine order units
        const effectiveUnitsSold = displayMode === "custom" ? customUnitsSold : orderUnitsSold;
        const now = Date.now();
        const isVisible = evaluateStorefrontVisibility({ enabled, displayThreshold }, effectiveUnitsSold);
        const displayLabel = formatPurchaseActivityBadge(effectiveUnitsSold, periodDays);

        const fullActivityData: ProductPurchaseActivityData = {
            productId,
            enabled,
            periodDays,
            displayThreshold,
            displayMode,
            customUnitsSold,
            unitsSold: effectiveUnitsSold,
            isCustomCount: displayMode === "custom",
            orderUnitsSold,
            countsByPeriod,
            qualifyingOrdersCount,
            uniquePurchasersCount,
            lastOrderSyncAt,
            lastCalculatedAt: now,
            displayLabel,
            isVisibleOnStorefront: isVisible,
        };

        // 6. Persist to Product Document (Atomic Merge)
        await productRef.update({
            purchaseActivity: {
                enabled,
                periodDays,
                displayThreshold,
                displayMode,
                customUnitsSold,
                unitsSold: effectiveUnitsSold,
                isCustomCount: displayMode === "custom",
                orderUnitsSold,
                countsByPeriod,
                qualifyingOrdersCount,
                uniquePurchasersCount,
                lastOrderSyncAt,
                lastCalculatedAt: now,
            },
            updatedAt: now,
        });

        return fullActivityData;
    })();

    if (!configOverride) {
        inflightRecalculations.set(productId, calculationPromise);
        calculationPromise.finally(() => {
            inflightRecalculations.delete(productId);
        });
    }

    return calculationPromise;
}
