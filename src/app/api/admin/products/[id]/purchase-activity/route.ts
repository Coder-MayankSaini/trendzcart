import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import {
    calculateAndPersistProductPurchaseActivity,
    DEFAULT_ACTIVITY_PERIOD,
    DEFAULT_DISPLAY_THRESHOLD,
} from "@/lib/orders/purchaseActivity";
import type {
    PurchaseActivityPeriod,
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
        if (!productId || typeof productId !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid productId parameter" },
                { status: 400, headers: NO_CACHE_HEADERS }
            );
        }

        // 2. Parse request payload
        let body: any = {};
        try {
            body = await req.json();
        } catch {
            // Optional body
            body = {};
        }

        const configOverride: Partial<ProductPurchaseActivityConfig> = {};

        if (typeof body.enabled === "boolean") {
            configOverride.enabled = body.enabled;
        }

        if (body.periodDays !== undefined) {
            const parsedPeriod = Number(body.periodDays) as PurchaseActivityPeriod;
            if (![7, 30, 90].includes(parsedPeriod)) {
                return NextResponse.json(
                    { error: "Invalid periodDays: Must be 7, 30, or 90" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.periodDays = parsedPeriod;
        }

        if (body.displayThreshold !== undefined) {
            const parsedThreshold = Number(body.displayThreshold);
            if (!Number.isFinite(parsedThreshold) || parsedThreshold < 0) {
                return NextResponse.json(
                    { error: "Invalid displayThreshold: Must be a non-negative number" },
                    { status: 400, headers: NO_CACHE_HEADERS }
                );
            }
            configOverride.displayThreshold = Math.floor(parsedThreshold);
        }

        // 3. Recalculate and persist updated stats
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
        return NextResponse.json(
            { error: error?.message || "Failed to update purchase activity" },
            { status: 500, headers: NO_CACHE_HEADERS }
        );
    }
}
