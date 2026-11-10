import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { calculateProductRatingStats } from "./validation";
import type { ProductReviewStats } from "./types";

export const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
};

export interface AdminAuthResult {
    authorized: boolean;
    adminUid?: string;
    adminEmail?: string;
    errorResponse?: NextResponse;
}

/**
 * Validates that an incoming NextRequest contains a valid Firebase ID token
 * with an authoritative Custom Claim `admin: true`.
 * Fails closed on any error or missing claim.
 */
export async function verifyAdminRequest(req: NextRequest): Promise<AdminAuthResult> {
    const headers = new Headers(NO_CACHE_HEADERS);

    if (!adminAuth || !adminDb) {
        return {
            authorized: false,
            errorResponse: NextResponse.json(
                { error: "Firebase Admin services unavailable" },
                { status: 500, headers }
            ),
        };
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return {
            authorized: false,
            errorResponse: NextResponse.json(
                { error: "Unauthorized: Missing or malformed Authorization header" },
                { status: 401, headers }
            ),
        };
    }

    const idToken = authHeader.slice(7).trim();
    if (!idToken) {
        return {
            authorized: false,
            errorResponse: NextResponse.json(
                { error: "Unauthorized: Empty bearer token" },
                { status: 401, headers }
            ),
        };
    }

    try {
        const decodedToken = await adminAuth.verifyIdToken(idToken, true);
        if (!decodedToken || decodedToken.admin !== true) {
            return {
                authorized: false,
                errorResponse: NextResponse.json(
                    { error: "Forbidden: Administrator privileges required" },
                    { status: 403, headers }
                ),
            };
        }

        return {
            authorized: true,
            adminUid: decodedToken.uid,
            adminEmail: decodedToken.email || undefined,
        };
    } catch (err: any) {
        return {
            authorized: false,
            errorResponse: NextResponse.json(
                { error: "Unauthorized: Invalid or revoked administrator token" },
                { status: 401, headers }
            ),
        };
    }
}

/**
 * Authoritatively recalculates and stores reviewCount, averageRating, and ratingDistribution
 * on the product document in Firestore.
 */
export async function recalculateAndPersistProductStats(
    productId: string
): Promise<ProductReviewStats> {
    if (!adminDb) {
        throw new Error("adminDb not available");
    }

    const reviewsSnap = await adminDb
        .collection("reviews")
        .where("productId", "==", productId)
        .get();

    const reviewsData = reviewsSnap.docs.map((d) => d.data() as any);
    const stats = calculateProductRatingStats(reviewsData);

    const productRef = adminDb.collection("products").doc(productId);
    const prodDoc = await productRef.get();

    if (prodDoc.exists) {
        await productRef.update({
            reviewCount: stats.reviewCount,
            averageRating: stats.averageRating,
            ratingDistribution: stats.ratingDistribution,
            updatedAt: Date.now(),
        });
    }

    return stats;
}
