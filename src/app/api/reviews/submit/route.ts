import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        if (!adminAuth || !adminDb) {
            return NextResponse.json(
                { error: "Firebase Admin services unavailable" },
                { status: 500, headers }
            );
        }

        // 1. Verify Authorization Header
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Unauthorized: Missing or malformed Authorization header" },
                { status: 401, headers }
            );
        }

        const idToken = authHeader.slice(7).trim();
        if (!idToken) {
            return NextResponse.json(
                { error: "Unauthorized: Empty bearer token" },
                { status: 401, headers }
            );
        }

        let decodedToken;
        try {
            decodedToken = await adminAuth.verifyIdToken(idToken, true);
        } catch (authErr: any) {
            return NextResponse.json(
                { error: "Unauthorized: Invalid or revoked ID token" },
                { status: 401, headers }
            );
        }

        const callerUid = decodedToken.uid;
        if (!callerUid) {
            return NextResponse.json(
                { error: "Unauthorized: Missing UID in token" },
                { status: 401, headers }
            );
        }

        // 2. Rate Limiting per UID
        const clientIp = getClientIp(req);
        const rateLimitKey = `review_submit_${callerUid}_${clientIp}`;
        const rateLimitResult = await checkRateLimit(adminDb, {
            key: rateLimitKey,
            limit: 10,
            windowMs: 60 * 1000,
        });

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: "Rate limit exceeded. Too many review submissions." },
                {
                    status: 429,
                    headers: {
                        ...NO_CACHE_HEADERS,
                        "Retry-After": String(rateLimitResult.retryAfterSeconds),
                    },
                }
            );
        }

        // 3. Parse and Validate Request Body
        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON request body" },
                { status: 400, headers }
            );
        }

        const { productId, rating, comment, images, userName } = body || {};

        if (!productId || typeof productId !== "string" || !productId.trim()) {
            return NextResponse.json(
                { error: "Missing or invalid productId" },
                { status: 400, headers }
            );
        }
        const cleanProductId = productId.trim();

        if (
            typeof rating !== "number" ||
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
        ) {
            return NextResponse.json(
                { error: "Rating must be an integer between 1 and 5" },
                { status: 400, headers }
            );
        }

        if (typeof comment !== "string" || !comment.trim()) {
            return NextResponse.json(
                { error: "Comment is required and cannot be empty" },
                { status: 400, headers }
            );
        }
        const cleanComment = comment.trim();
        if (cleanComment.length > 2000) {
            return NextResponse.json(
                { error: "Comment must not exceed 2000 characters" },
                { status: 400, headers }
            );
        }

        let cleanImages: string[] = [];
        if (Array.isArray(images)) {
            if (images.length > 5) {
                return NextResponse.json(
                    { error: "Maximum of 5 review images allowed" },
                    { status: 400, headers }
                );
            }
            for (const img of images) {
                if (typeof img !== "string" || !img.trim() || (!img.startsWith("http://") && !img.startsWith("https://") && !img.startsWith("/api/media/"))) {
                    return NextResponse.json(
                        { error: "Invalid image URL in review images" },
                        { status: 400, headers }
                    );
                }
                cleanImages.push(img.trim());
            }
        }

        const cleanUserName =
            typeof userName === "string" && userName.trim()
                ? userName.trim().slice(0, 100)
                : decodedToken.name || "Verified Buyer";

        // 4. Confirm Product Exists
        const productDoc = await adminDb.collection("products").doc(cleanProductId).get();
        if (!productDoc.exists) {
            return NextResponse.json(
                { error: "Product not found" },
                { status: 404, headers }
            );
        }

        // 5. Enforce Duplicate Review Policy & Qualifying Purchase Check Atomically
        // Query for qualifying delivered orders containing the productId
        const ordersSnap = await adminDb
            .collection("orders")
            .where("userId", "==", callerUid)
            .where("orderStatus", "==", "Delivered")
            .get();

        let qualifyingOrderFound = false;
        for (const doc of ordersSnap.docs) {
            const data = doc.data();
            // Order must not be marked FAILED
            if (data.paymentStatus === "FAILED") continue;

            if (Array.isArray(data.items)) {
                const hasItem = data.items.some(
                    (item: any) =>
                        item && (item.id === cleanProductId || item.productId === cleanProductId)
                );
                if (hasItem) {
                    qualifyingOrderFound = true;
                    break;
                }
            }
        }

        if (!qualifyingOrderFound) {
            return NextResponse.json(
                {
                    error:
                        "Review submission requires a verified, delivered purchase of this product.",
                },
                { status: 403, headers }
            );
        }

        // Check for existing review by this customer for this product
        const existingReviewSnap = await adminDb
            .collection("reviews")
            .where("productId", "==", cleanProductId)
            .where("userId", "==", callerUid)
            .limit(1)
            .get();

        if (!existingReviewSnap.empty) {
            return NextResponse.json(
                { error: "You have already reviewed this product." },
                { status: 409, headers }
            );
        }

        // 6. Generate Server-Authoritative Review Payload
        // Enforce: Client CANNOT control isFake, verifiedPurchase, or reviewId
        const reviewId = crypto.randomUUID();
        const reviewPayload = {
            id: reviewId,
            productId: cleanProductId,
            userId: callerUid,
            userName: cleanUserName,
            rating,
            comment: cleanComment,
            images: cleanImages,
            createdAt: Date.now(),
            isFake: false,
            verifiedPurchase: true,
        };

        await adminDb.collection("reviews").doc(reviewId).set(reviewPayload);

        return NextResponse.json(
            {
                success: true,
                message: "Review submitted successfully.",
                review: reviewPayload,
            },
            { status: 201, headers }
        );
    } catch (err: any) {
        console.error("[Review Submission API Error]:", err);
        return NextResponse.json(
            { error: "Internal server error submitting review" },
            { status: 500, headers }
        );
    }
}
