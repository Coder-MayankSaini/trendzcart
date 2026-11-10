import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyAdminRequest,
    recalculateAndPersistProductStats,
    NO_CACHE_HEADERS,
} from "@/lib/reviews/adminReviews";
import type { ReviewPublicationStatus } from "@/lib/reviews/types";

/**
 * GET /api/admin/reviews?productId=...&status=...&page=1&limit=20
 * Admin review listing with full moderation and provenance data.
 */
export async function GET(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.authorized || authResult.errorResponse) {
            return authResult.errorResponse!;
        }

        const { searchParams } = new URL(req.url);
        const productId = searchParams.get("productId")?.trim();
        const statusFilter = searchParams.get("status")?.trim();
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

        if (!productId) {
            return NextResponse.json(
                { error: "productId parameter is required" },
                { status: 400, headers }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
        }

        let query: FirebaseFirestore.Query = adminDb
            .collection("reviews")
            .where("productId", "==", productId)
            .limit(200);

        const snap = await query.get();
        let reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

        // Sort by createdAt descending
        reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Filter by status if requested
        if (statusFilter && statusFilter !== "ALL") {
            reviews = reviews.filter((r) => {
                const pubStatus = r.publicationStatus || (r.isFake ? "unpublished" : "published");
                return pubStatus === statusFilter;
            });
        }

        const total = reviews.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const offset = (page - 1) * limit;
        const paginated = reviews.slice(offset, offset + limit);

        return NextResponse.json(
            {
                success: true,
                productId,
                page,
                limit,
                total,
                totalPages,
                hasMore: page < totalPages,
                reviews: paginated,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Admin Reviews GET API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error fetching reviews" },
            { status: 500, headers }
        );
    }
}

/**
 * PATCH /api/admin/reviews
 * Moderates a review (e.g. toggle publication status: published / unpublished / archived).
 */
export async function PATCH(req: NextRequest) {
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

        const { reviewId, publicationStatus } = body || {};
        if (!reviewId || typeof reviewId !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid reviewId" },
                { status: 400, headers }
            );
        }

        const allowedStatuses: ReviewPublicationStatus[] = ["published", "unpublished", "archived", "rejected"];
        if (!publicationStatus || !allowedStatuses.includes(publicationStatus)) {
            return NextResponse.json(
                { error: `publicationStatus must be one of: ${allowedStatuses.join(", ")}` },
                { status: 400, headers }
            );
        }

        // Transition guard: block publishing if paused during security transition
        if (publicationStatus === "published" && process.env.ADMIN_REVIEW_PUBLISHING_ENABLED === "false") {
            return NextResponse.json(
                {
                    error: "Review publishing is temporarily paused during production security transition. Deploy hardened Firestore rules before enabling review publishing.",
                    transitionPaused: true,
                },
                { status: 503, headers }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
        }

        const reviewRef = adminDb.collection("reviews").doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) {
            return NextResponse.json(
                { error: "Review document not found" },
                { status: 404, headers }
            );
        }

        const currentData = reviewDoc.data()!;
        const productId = currentData.productId;

        await reviewRef.update({
            publicationStatus,
            updatedAt: Date.now(),
        });

        // Recalculate stats for the target product
        const updatedStats = await recalculateAndPersistProductStats(productId);

        return NextResponse.json(
            {
                success: true,
                message: `Review publication status updated to '${publicationStatus}'.`,
                reviewId,
                publicationStatus,
                updatedStats,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Admin Reviews PATCH API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error updating review" },
            { status: 500, headers }
        );
    }
}

/**
 * DELETE /api/admin/reviews?reviewId=...
 * Deletes or archives a review document and recalculates stats.
 */
export async function DELETE(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.authorized || authResult.errorResponse) {
            return authResult.errorResponse!;
        }

        const { searchParams } = new URL(req.url);
        const reviewId = searchParams.get("reviewId")?.trim();

        if (!reviewId) {
            return NextResponse.json(
                { error: "reviewId parameter is required" },
                { status: 400, headers }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
        }

        const reviewRef = adminDb.collection("reviews").doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) {
            return NextResponse.json(
                { error: "Review not found" },
                { status: 404, headers }
            );
        }

        const productId = reviewDoc.data()?.productId;

        await reviewRef.delete();

        // Recalculate stats for target product
        let updatedStats = null;
        if (productId) {
            updatedStats = await recalculateAndPersistProductStats(productId);
        }

        return NextResponse.json(
            {
                success: true,
                message: "Review successfully deleted.",
                reviewId,
                updatedStats,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Admin Reviews DELETE API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error deleting review" },
            { status: 500, headers }
        );
    }
}
