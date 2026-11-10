import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyAdminRequest,
    recalculateAndPersistProductStats,
    NO_CACHE_HEADERS,
} from "@/lib/reviews/adminReviews";
import { validateReviewImportPayload } from "@/lib/reviews/validation";
import type { StoredReview, ReviewImportBatchAudit } from "@/lib/reviews/types";

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.authorized || authResult.errorResponse) {
            return authResult.errorResponse!;
        }

        const adminUid = authResult.adminUid!;
        const adminEmail = authResult.adminEmail || "admin@bazaarvilla.com";

        if (!adminDb) {
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500, headers }
            );
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

        // 1. Verify Product Exists
        const productDoc = await adminDb.collection("products").doc(productId).get();
        if (!productDoc.exists) {
            return NextResponse.json(
                { error: `Product '${productId}' not found in catalog` },
                { status: 404, headers }
            );
        }
        const productName = productDoc.data()?.name || "Product";

        // 2. Query Existing External Review IDs to prevent duplicate insertion
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

        // 3. Authoritatively Validate Entire Batch
        const validation = validateReviewImportPayload(body, {
            productExists: true,
            productName,
            existingExternalIds,
            maxBatchSize: 200,
        });

        const eligibleEntries = validation.entries.filter((e) => e.eligibleForPublication);
        if (eligibleEntries.length === 0) {
            return NextResponse.json(
                {
                    error: "No eligible reviews found for publication. Verify that ratings are valid (1-5), externalReviewIds are unique, and customerConsentConfirmed is true.",
                    validationSummary: {
                        totalSubmitted: validation.totalSubmitted,
                        validCount: validation.validCount,
                        invalidCount: validation.invalidCount,
                        duplicateCount: validation.duplicateCount,
                        eligibleCount: validation.eligibleCount,
                    },
                },
                { status: 400, headers }
            );
        }

        // 4. Generate Batch Audit ID
        const batchId = crypto.randomUUID();
        const importTimestamp = Date.now();

        // 5. Commit Reviews via Firestore Batch Write
        const batch = adminDb.batch();
        const storedReviewsToReturn: any[] = [];

        for (const entry of eligibleEntries) {
            const reviewId = crypto.randomUUID();
            const reviewRef = adminDb.collection("reviews").doc(reviewId);

            // Construct authoritative stored review document
            const reviewDoc: StoredReview = {
                id: reviewId,
                productId,
                userId: null, // Imported external feedback has no in-app user account
                userName: entry.reviewerDisplayName,
                rating: entry.rating,
                title: entry.title || null,
                comment: entry.body,
                images: entry.images || [],
                createdAt: Date.parse(entry.reviewedAt) || importTimestamp,
                isFake: false, // Genuine customer feedback
                verifiedPurchase: false, // External/offline feedback does not receive false in-app verified purchase badges
                publicationStatus: "published",
                sourceType: entry.source,
                sourceReference: entry.sourceReference || null,
                externalReviewId: entry.externalReviewId,
                customerConsentConfirmed: true,
                editorialNote: false,
                publishedAt: importTimestamp,
                importedAt: importTimestamp,
                importedBy: adminUid,
                importBatchId: batchId,
                updatedAt: importTimestamp,
            };

            batch.set(reviewRef, reviewDoc);
            storedReviewsToReturn.push({
                id: reviewId,
                externalReviewId: entry.externalReviewId,
                reviewerDisplayName: entry.reviewerDisplayName,
                rating: entry.rating,
            });
        }

        // 6. Record Batch Audit Trail Document
        const batchAuditRef = adminDb.collection("reviewImportBatches").doc(batchId);
        const batchAuditDoc: ReviewImportBatchAudit = {
            batchId,
            productId,
            productName,
            adminUid,
            adminEmail,
            createdAt: importTimestamp,
            totalSubmitted: validation.totalSubmitted,
            validEntries: validation.validCount,
            rejectedEntries: validation.invalidCount + (validation.validCount - eligibleEntries.length),
            publishedEntries: eligibleEntries.length,
            duplicateEntries: validation.duplicateCount,
            status: eligibleEntries.length === validation.totalSubmitted ? "published" : "partially_published",
            errorSummary: validation.entries
                .filter((e) => !e.eligibleForPublication)
                .map((e) => `[Item ${e.itemIndex} ${e.externalReviewId}]: ${e.errors.join("; ") || e.warnings.join("; ")}`),
        };

        batch.set(batchAuditRef, batchAuditDoc);

        // Commit all review documents and audit record atomically
        await batch.commit();

        // 7. Recalculate Authoritative Product Review Stats
        const updatedStats = await recalculateAndPersistProductStats(productId);

        return NextResponse.json(
            {
                success: true,
                message: `Successfully imported and published ${eligibleEntries.length} customer reviews.`,
                batchId,
                publishedCount: eligibleEntries.length,
                skippedCount: validation.totalSubmitted - eligibleEntries.length,
                updatedStats,
                reviews: storedReviewsToReturn,
            },
            { status: 201, headers }
        );
    } catch (err: any) {
        console.error("[Admin Publish Batch API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error publishing review batch" },
            { status: 500, headers }
        );
    }
}
