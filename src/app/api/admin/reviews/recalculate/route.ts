import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyAdminRequest,
    recalculateAndPersistProductStats,
    NO_CACHE_HEADERS,
} from "@/lib/reviews/adminReviews";

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.authorized || authResult.errorResponse) {
            return authResult.errorResponse!;
        }

        let body: any = {};
        try {
            body = await req.json();
        } catch {
            // body can be empty if provided via searchParams
        }

        const { searchParams } = new URL(req.url);
        const productId = (body?.productId || searchParams.get("productId") || "").trim();

        if (!productId) {
            return NextResponse.json(
                { error: "productId is required" },
                { status: 400, headers }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
        }

        const productDoc = await adminDb.collection("products").doc(productId).get();
        if (!productDoc.exists) {
            return NextResponse.json(
                { error: `Product '${productId}' not found` },
                { status: 404, headers }
            );
        }

        const updatedStats = await recalculateAndPersistProductStats(productId);

        return NextResponse.json(
            {
                success: true,
                message: "Product review aggregates recalculated successfully.",
                productId,
                stats: updatedStats,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Admin Recalculate Stats API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error recalculating review stats" },
            { status: 500, headers }
        );
    }
}
