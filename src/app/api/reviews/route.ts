import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { calculateProductRatingStats, isPubliclyPublishedReview } from "@/lib/reviews/validation";

const PUBLIC_CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

export async function GET(req: NextRequest) {
    const headers = new Headers(PUBLIC_CACHE_HEADERS);

    try {
        const { searchParams } = new URL(req.url);
        const productId = searchParams.get("productId")?.trim();
        const ratingFilter = searchParams.get("rating")?.trim();
        const sort = searchParams.get("sort")?.trim() || "newest";
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));

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

        // Bounded query for reviews to prevent excessive or unbounded Firestore reads
        const snap = await adminDb
            .collection("reviews")
            .where("productId", "==", productId)
            .limit(200)
            .get();

        const allDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

        // Overall stats calculated across all published customer reviews
        const stats = calculateProductRatingStats(allDocs);

        // Filter strictly to published customer reviews (including legacy compatibility)
        let publishedReviews = allDocs.filter(isPubliclyPublishedReview);

        // Filter by rating if specified
        if (ratingFilter && ratingFilter !== "ALL") {
            const targetRating = parseInt(ratingFilter, 10);
            if (!isNaN(targetRating) && targetRating >= 1 && targetRating <= 5) {
                publishedReviews = publishedReviews.filter(
                    (r) => Math.round(r.rating) === targetRating
                );
            }
        }

        // Sort reviews
        publishedReviews.sort((a, b) => {
            if (sort === "oldest") {
                return (a.createdAt || 0) - (b.createdAt || 0);
            }
            if (sort === "highest") {
                return (b.rating || 0) - (a.rating || 0) || (b.createdAt || 0) - (a.createdAt || 0);
            }
            if (sort === "lowest") {
                return (a.rating || 0) - (b.rating || 0) || (b.createdAt || 0) - (a.createdAt || 0);
            }
            // default: newest
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        const totalFiltered = publishedReviews.length;
        const totalPages = Math.ceil(totalFiltered / limit) || 1;
        const offset = (page - 1) * limit;
        const pageItems = publishedReviews.slice(offset, offset + limit);

        // Redact internal/sensitive audit metadata before public delivery
        const publicReviews = pageItems.map((r) => ({
            id: r.id,
            productId: r.productId,
            userName: r.userName || "Customer",
            rating: r.rating,
            title: r.title || null,
            comment: r.comment,
            images: r.images || [],
            createdAt: r.createdAt,
            verifiedPurchase: r.verifiedPurchase === true,
            sourceType: r.sourceType || (r.userId ? "storefront" : "offline-customer-feedback"),
            // DO NOT EXPOSE: sourceReference, customerConsentConfirmed, importedBy, importBatchId
        }));

        return NextResponse.json(
            {
                success: true,
                productId,
                stats,
                pagination: {
                    page,
                    limit,
                    total: totalFiltered,
                    totalPages,
                    hasMore: page < totalPages,
                },
                reviews: publicReviews,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Public Reviews GET API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error fetching product reviews" },
            { status: 500, headers }
        );
    }
}
