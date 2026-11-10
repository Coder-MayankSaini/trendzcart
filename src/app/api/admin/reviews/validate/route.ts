import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { verifyAdminRequest, NO_CACHE_HEADERS } from "@/lib/reviews/adminReviews";
import { validateReviewImportPayload } from "@/lib/reviews/validation";

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.authorized || authResult.errorResponse) {
            return authResult.errorResponse!;
        }

        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON request body" },
                { status: 400, headers }
            );
        }

        const rawProductId = body?.productId;
        if (!rawProductId || typeof rawProductId !== "string" || !rawProductId.trim()) {
            return NextResponse.json(
                { error: "Missing or invalid productId in request payload" },
                { status: 400, headers }
            );
        }
        const productId = rawProductId.trim();

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
        }

        // Verify product exists in Firestore
        const productDoc = await adminDb.collection("products").doc(productId).get();
        const productExists = productDoc.exists;
        const productName = productExists ? productDoc.data()?.name || "Product" : undefined;

        // Fetch existing external review IDs for this product to detect duplicates
        const existingReviewsSnap = await adminDb
            .collection("reviews")
            .where("productId", "==", productId)
            .get();

        const existingExternalIds = new Set<string>();
        for (const doc of existingReviewsSnap.docs) {
            const data = doc.data();
            if (data.externalReviewId && typeof data.externalReviewId === "string") {
                existingExternalIds.add(data.externalReviewId);
            }
        }

        const validationResult = validateReviewImportPayload(body, {
            productExists,
            productName,
            existingExternalIds,
            maxBatchSize: 200,
        });

        return NextResponse.json(
            {
                success: true,
                ...validationResult,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Admin Review Validation API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error validating review batch" },
            { status: 500, headers }
        );
    }
}
