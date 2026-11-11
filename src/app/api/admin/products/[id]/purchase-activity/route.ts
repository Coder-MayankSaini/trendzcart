import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import {
    calculateAndPersistProductPurchaseActivity,
    DEFAULT_ACTIVITY_PERIOD,
    DEFAULT_DISPLAY_THRESHOLD,
    MAX_CONFIGURED_UNITS,
    TEST_FIXTURE_PRODUCT_IDS,
} from "@/lib/orders/purchaseActivity";
import type {
    PurchaseActivityPeriod,
    PurchaseActivityDisplayMode,
    ProductPurchaseActivityConfig,
} from "@/lib/orders/purchaseActivity";

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
    try {
        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers: NO_CACHE_HEADERS }
            );
        }

        // 1. Enforce admin custom claim authentication
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            const status = authResult.error?.includes("Missing") || authResult.error?.includes("Empty") ? 401 : 403;
            return NextResponse.json(
                { error: authResult.error || "Forbidden: Administrator authorization required" },
                { status, headers: NO_CACHE_HEADERS }
            );
        }

        const { id: productId } = await context.params;
        if (!productId || typeof productId !== "string" || !productId.trim()) {
            return NextResponse.json(
                { error: "Missing or invalid productId parameter" },
                { status: 400, headers: NO_CACHE_HEADERS }
            );
        }

        // 2. Verify target product exists and is commercial
        const productRef = adminDb.collection("products").doc(productId);
        const productSnap = await productRef.get();
        if (!productSnap.exists) {
            return NextResponse.json(
                { error: "Product not found" },
                { status: 404, headers: NO_CACHE_HEADERS }
            );
        }

        const productData = productSnap.data() || {};
        if (
            productData.isTestFixture === true ||
            productData.isArchived === true ||
            productData.category === "Testing" ||
            TEST_FIXTURE_PRODUCT_IDS.has(productId) ||
            productId.startsWith("task013_")
        ) {
            return NextResponse.json(
                { error: "Test fixture or archived products cannot have public purchase activity" },
                { status: 400, headers: NO_CACHE_HEADERS }
            );
        }

        // 3. Parse request payload
        let body: any = {};
        try {
            body = await req.json();
        } catch {
            body = {};
        }

        const configOverride: Partial<ProductPurchaseActivityConfig> = {};

        // Validate enabled
        if (body.enabled !== undefined) {
            if (typeof body.enabled !== "boolean") {
                return NextResponse.json(
                    { error: "Invalid enabled flag: Must be a boolean" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.enabled = body.enabled;
        }

        // Validate displayMode ("auto" | "custom")
        if (body.displayMode !== undefined) {
            if (body.displayMode !== "auto" && body.displayMode !== "custom") {
                return NextResponse.json(
                    { error: "Invalid displayMode: Must be 'auto' or 'custom'" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.displayMode = body.displayMode as PurchaseActivityDisplayMode;
        }

        // Validate periodDays (7 | 30 | 90)
        if (body.periodDays !== undefined) {
            const rawPeriod = body.periodDays;
            if (typeof rawPeriod !== "number" || !Number.isInteger(rawPeriod) || ![7, 30, 90].includes(rawPeriod)) {
                return NextResponse.json(
                    { error: "Invalid periodDays: Must be 7, 30, or 90" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.periodDays = rawPeriod as PurchaseActivityPeriod;
        }

        // Validate displayThreshold (non-negative integer <= 1000)
        if (body.displayThreshold !== undefined) {
            const rawThreshold = body.displayThreshold;
            if (
                typeof rawThreshold !== "number" ||
                !Number.isFinite(rawThreshold) ||
                !Number.isInteger(rawThreshold) ||
                rawThreshold < 0 ||
                rawThreshold > 1000
            ) {
                return NextResponse.json(
                    { error: "Invalid displayThreshold: Must be a non-negative whole integer up to 1000" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.displayThreshold = rawThreshold;
        }

        // Validate customUnitsSold / unitsSold (non-negative integer <= MAX_CONFIGURED_UNITS)
        const unitsInput = body.customUnitsSold !== undefined ? body.customUnitsSold : body.unitsSold;
        if (unitsInput !== undefined) {
            if (
                typeof unitsInput !== "number" ||
                !Number.isFinite(unitsInput) ||
                !Number.isInteger(unitsInput) ||
                unitsInput < 0
            ) {
                return NextResponse.json(
                    { error: "Invalid units count: Must be a non-negative whole integer" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            if (unitsInput > MAX_CONFIGURED_UNITS) {
                return NextResponse.json(
                    { error: `Invalid units count: Exceeds maximum allowed limit of ${MAX_CONFIGURED_UNITS.toLocaleString()}` },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.customUnitsSold = unitsInput;
            configOverride.unitsSold = unitsInput;
        }

        if (typeof body.isCustomCount === "boolean") {
            configOverride.isCustomCount = body.isCustomCount;
            if (configOverride.displayMode === undefined) {
                configOverride.displayMode = body.isCustomCount ? "custom" : "auto";
            }
        }

        if (body.forceLiveRecalculate === true) {
            configOverride.forceLiveRecalculate = true;
        }

        // 4. Recalculate and persist updated stats
        const updatedActivity = await calculateAndPersistProductPurchaseActivity(
            adminDb,
            productId,
            configOverride
        );

        return NextResponse.json(
            {
                success: true,
                activity: updatedActivity,
            },
            { status: 200, headers: NO_CACHE_HEADERS }
        );
    } catch (error: any) {
        console.error(`[Admin purchase-activity API] Error:`, error);
        const msg = error?.message || "Failed to update purchase activity";
        const status = msg.includes("not found") ? 404 : 500;
        return NextResponse.json(
            { error: msg },
            { status, headers: NO_CACHE_HEADERS }
        );
    }
}
