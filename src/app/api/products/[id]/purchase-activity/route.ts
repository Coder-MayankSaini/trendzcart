import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    calculateAndPersistProductPurchaseActivity,
    buildPublicPurchaseActivityDTO,
    CACHE_TTL_MS,
    DEFAULT_ACTIVITY_PERIOD,
    DEFAULT_DISPLAY_THRESHOLD,
    evaluateStorefrontVisibility,
    formatPurchaseActivityBadge,
    TEST_FIXTURE_PRODUCT_IDS,
} from "@/lib/orders/purchaseActivity";

const PUBLIC_CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=1800",
    "Content-Type": "application/json",
};

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
    try {
        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500 }
            );
        }

        const { id: productId } = await context.params;

        if (!productId || typeof productId !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid productId parameter" },
                { status: 400 }
            );
        }

        // Exclude test fixture product IDs
        if (TEST_FIXTURE_PRODUCT_IDS.has(productId) || productId.startsWith("task013_")) {
            return NextResponse.json(
                { error: "Product not found or not commercial" },
                { status: 404 }
            );
        }

        // Fetch product document
        const productRef = adminDb.collection("products").doc(productId);
        const productSnap = await productRef.get();

        if (!productSnap.exists) {
            return NextResponse.json(
                { error: "Product not found" },
                { status: 404 }
            );
        }

        const productData = productSnap.data() || {};

        // If product is marked as test fixture or archived, do not expose public activity
        if (
            productData.isTestFixture === true ||
            productData.isArchived === true ||
            productData.purchasable === false ||
            productData.category === "Testing"
        ) {
            return NextResponse.json(
                { error: "Product not found or not commercial" },
                { status: 404 }
            );
        }

        const existingActivity = productData.purchaseActivity;
        const now = Date.now();

        // 1. If cache exists and is fresh (< 1 hour old), return immediately without scanning orders
        if (
            existingActivity &&
            typeof existingActivity.lastCalculatedAt === "number" &&
            now - existingActivity.lastCalculatedAt < CACHE_TTL_MS
        ) {
            const dto = buildPublicPurchaseActivityDTO({
                productId,
                enabled: existingActivity.enabled ?? true,
                periodDays: existingActivity.periodDays ?? DEFAULT_ACTIVITY_PERIOD,
                displayThreshold: existingActivity.displayThreshold ?? DEFAULT_DISPLAY_THRESHOLD,
                unitsSold: existingActivity.unitsSold ?? 0,
                countsByPeriod: existingActivity.countsByPeriod ?? { 7: 0, 30: 0, 90: 0 },
                qualifyingOrdersCount: existingActivity.qualifyingOrdersCount ?? 0,
                uniquePurchasersCount: existingActivity.uniquePurchasersCount ?? 0,
                lastCalculatedAt: existingActivity.lastCalculatedAt,
            });

            return NextResponse.json(dto, {
                status: 200,
                headers: PUBLIC_CACHE_HEADERS,
            });
        }

        // 2. Cache is stale or uninitialized: recalculate and persist
        const freshActivity = await calculateAndPersistProductPurchaseActivity(
            adminDb,
            productId
        );

        const publicDTO = buildPublicPurchaseActivityDTO(freshActivity);

        return NextResponse.json(publicDTO, {
            status: 200,
            headers: PUBLIC_CACHE_HEADERS,
        });
    } catch (error: any) {
        console.error(`[API purchase-activity] Failed for product:`, error);
        return NextResponse.json(
            { error: "Failed to retrieve purchase activity" },
            { status: 500 }
        );
    }
}
