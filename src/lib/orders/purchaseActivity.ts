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
} from "./purchaseActivityTypes";
import {
    DEFAULT_ACTIVITY_PERIOD,
    DEFAULT_DISPLAY_THRESHOLD,
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

        const config: ProductPurchaseActivityConfig = {
            enabled: configOverride?.enabled ?? existingActivity.enabled ?? true,
            periodDays: configOverride?.periodDays ?? existingActivity.periodDays ?? DEFAULT_ACTIVITY_PERIOD,
            displayThreshold: configOverride?.displayThreshold ?? existingActivity.displayThreshold ?? DEFAULT_DISPLAY_THRESHOLD,
        };

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
            config.periodDays,
            Date.now()
        );

        const now = Date.now();
        const isVisible = evaluateStorefrontVisibility(config, stats.unitsSold);
        const displayLabel = formatPurchaseActivityBadge(stats.unitsSold, config.periodDays);

        const fullActivityData: ProductPurchaseActivityData = {
            ...config,
            productId,
            unitsSold: stats.unitsSold,
            countsByPeriod: stats.countsByPeriod,
            qualifyingOrdersCount: stats.qualifyingOrdersCount,
            uniquePurchasersCount: stats.uniquePurchasersCount,
            lastCalculatedAt: now,
            displayLabel,
            isVisibleOnStorefront: isVisible,
        };

        // Persist to product document for 0-extra-read storefront performance
        await productRef.update({
            purchaseActivity: {
                enabled: config.enabled,
                periodDays: config.periodDays,
                displayThreshold: config.displayThreshold,
                unitsSold: stats.unitsSold,
                countsByPeriod: stats.countsByPeriod,
                qualifyingOrdersCount: stats.qualifyingOrdersCount,
                uniquePurchasersCount: stats.uniquePurchasersCount,
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
