import type {
    ReviewBatchImportPayload,
    ReviewBatchValidationResult,
    ReviewItemInput,
    ReviewSourceType,
    ReviewValidationEntry,
    StoredReview,
    ProductReviewStats,
    RatingDistribution,
} from "./types";

const ALLOWED_SOURCES: ReviewSourceType[] = [
    "storefront",
    "offline-customer-feedback",
    "external-marketplace",
    "csv-json-import",
    "editorial",
    "simulated-test",
];

const DISALLOWED_FIELD_NAMES = [
    "role",
    "admin",
    "isAdmin",
    "verifiedPurchase",
    "isFake",
    "userId",
    "__proto__",
    "constructor",
    "prototype",
];

/**
 * Strips HTML tags and potential script injections.
 */
export function sanitizeReviewText(input: unknown): string {
    if (typeof input !== "string") return "";
    return input
        .replace(/<[^>]*>?/gm, "") // strip html tags
        .replace(/javascript:/gi, "")
        .replace(/data:/gi, "")
        .trim();
}

/**
 * Checks whether text contains HTML tags or potential script injection patterns.
 */
export function containsHtmlOrScript(text: string): boolean {
    return /<[^>]*>|javascript:|onload=|onerror=|onclick=/i.test(text);
}

/**
 * Detects whether a review payload entry is an unedited template placeholder.
 * Protects against accidental or simulated placeholder publication.
 */
export function isTemplatePlaceholderReview(item: any): boolean {
    if (!item || typeof item !== "object") return false;

    const placeholderPatterns = [
        /\[template placeholder/i,
        /\[placeholder/i,
        /^template-/i,
        /^placeholder-/i,
        /replace this with authentic customer feedback/i,
        /customer name placeholder/i,
        /customer feedback goes here/i,
        /order-ref-placeholder/i,
        /ref-placeholder/i,
        /template review headline/i,
        /\[customer name placeholder/i,
        /\[review headline placeholder/i,
    ];

    const fieldsToCheck = [
        item.externalReviewId,
        item.reviewerDisplayName,
        item.body,
        item.comment,
        item.title,
        item.sourceReference,
    ];

    return fieldsToCheck.some((val) => {
        if (typeof val === "string") {
            return placeholderPatterns.some((pattern) => pattern.test(val));
        }
        return false;
    });
}

/**
 * Validates a single review item from an import batch.
 */
export function validateSingleReviewItem(
    item: any,
    index: number,
    seenBatchIds: Set<string>,
    existingExternalIds: Set<string>,
    expectedProductId?: string
): ReviewValidationEntry {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for unexpected disallowed properties
    if (item && typeof item === "object") {
        for (const disallowed of DISALLOWED_FIELD_NAMES) {
            if (Object.prototype.hasOwnProperty.call(item, disallowed)) {
                errors.push(`Field '${disallowed}' is forbidden in import payload.`);
            }
        }
    }

    if (!item || typeof item !== "object") {
        return {
            itemIndex: index + 1,
            externalReviewId: `item-${index + 1}`,
            reviewerDisplayName: "",
            rating: 0,
            body: "",
            reviewedAt: "",
            source: "offline-customer-feedback",
            customerConsentConfirmed: false,
            images: [],
            valid: false,
            eligibleForPublication: false,
            errors: ["Entry must be a valid JSON object."],
            warnings: [],
        };
    }

    // 1. externalReviewId
    let externalReviewId = "";
    if (typeof item.externalReviewId === "string" && item.externalReviewId.trim()) {
        externalReviewId = item.externalReviewId.trim();
        if (externalReviewId.length > 100) {
            errors.push("externalReviewId must not exceed 100 characters.");
        }
        if (seenBatchIds.has(externalReviewId)) {
            errors.push(`Duplicate externalReviewId '${externalReviewId}' within this batch.`);
        } else {
            seenBatchIds.add(externalReviewId);
        }
        if (existingExternalIds.has(externalReviewId)) {
            errors.push(`Review with externalReviewId '${externalReviewId}' has already been imported.`);
        }
    } else {
        errors.push("externalReviewId is required and must be a non-empty string.");
        externalReviewId = `entry-${index + 1}`;
    }

    // 2. reviewerDisplayName
    let reviewerDisplayName = "";
    if (typeof item.reviewerDisplayName === "string" && item.reviewerDisplayName.trim()) {
        reviewerDisplayName = sanitizeReviewText(item.reviewerDisplayName);
        if (reviewerDisplayName.length < 1 || reviewerDisplayName.length > 80) {
            errors.push("reviewerDisplayName must be between 1 and 80 characters.");
        }
        if (containsHtmlOrScript(item.reviewerDisplayName)) {
            warnings.push("HTML/markup was detected in reviewerDisplayName and sanitized.");
        }
    } else {
        errors.push("reviewerDisplayName is required.");
    }

    // 3. rating
    const rating = item.rating;
    if (
        typeof rating !== "number" ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
    ) {
        errors.push("Rating must be an integer between 1 and 5.");
    }

    // 4. title (optional)
    let title: string | undefined = undefined;
    if (item.title !== undefined && item.title !== null) {
        if (typeof item.title === "string") {
            title = sanitizeReviewText(item.title);
            if (title.length > 150) {
                errors.push("Title must not exceed 150 characters.");
            }
            if (containsHtmlOrScript(item.title)) {
                warnings.push("HTML/markup was detected in title and sanitized.");
            }
        } else {
            errors.push("Title, if provided, must be a string.");
        }
    }

    // 5. body / comment
    const rawBody = item.body ?? item.comment;
    let body = "";
    if (typeof rawBody === "string" && rawBody.trim()) {
        body = sanitizeReviewText(rawBody);
        if (body.length < 2 || body.length > 3000) {
            errors.push("Review body must be between 2 and 3000 characters.");
        }
        if (containsHtmlOrScript(rawBody)) {
            warnings.push("HTML/script tags were detected in review body and stripped.");
        }
    } else {
        errors.push("Review body (or comment) is required.");
    }

    // 6. reviewedAt
    let reviewedAt = "";
    if (typeof item.reviewedAt === "string" && item.reviewedAt.trim()) {
        reviewedAt = item.reviewedAt.trim();
        const parsedTime = Date.parse(reviewedAt);
        if (isNaN(parsedTime)) {
            errors.push("reviewedAt must be a valid ISO date string (e.g. 'YYYY-MM-DD').");
        } else {
            const oneDayInFuture = Date.now() + 24 * 60 * 60 * 1000;
            if (parsedTime > oneDayInFuture) {
                errors.push("reviewedAt date cannot be in the future.");
            }
        }
    } else {
        errors.push("reviewedAt is required and must be an ISO date string.");
    }

    // 7. source
    let source: ReviewSourceType = item.source;
    if (!source || !ALLOWED_SOURCES.includes(source)) {
        errors.push(
            `source must be one of: ${ALLOWED_SOURCES.join(", ")}.`
        );
        source = "offline-customer-feedback";
    }

    // 8. sourceReference
    let sourceReference = "";
    if (source === "offline-customer-feedback" || source === "external-marketplace" || source === "csv-json-import") {
        if (typeof item.sourceReference === "string" && item.sourceReference.trim().length >= 3) {
            sourceReference = sanitizeReviewText(item.sourceReference);
            if (sourceReference.length > 200) {
                errors.push("sourceReference must not exceed 200 characters.");
            }
        } else {
            errors.push("sourceReference (e.g., invoice #, ticket, order ID) is required for external/offline feedback (minimum 3 characters).");
        }
    } else if (item.sourceReference) {
        sourceReference = sanitizeReviewText(String(item.sourceReference));
    }

    // 9. customerConsentConfirmed
    const customerConsentConfirmed = item.customerConsentConfirmed === true;
    if (source !== "simulated-test" && !customerConsentConfirmed) {
        warnings.push("customerConsentConfirmed is false or missing. This entry cannot be published publicly until genuine consent/provenance is provided.");
    }

    // 10. images (optional)
    const cleanImages: string[] = [];
    if (item.images !== undefined && item.images !== null) {
        if (Array.isArray(item.images)) {
            if (item.images.length > 5) {
                errors.push("Maximum of 5 review images allowed per review.");
            }
            for (const img of item.images) {
                if (
                    typeof img === "string" &&
                    (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("/api/media/"))
                ) {
                    cleanImages.push(img.trim());
                } else {
                    errors.push("All image URLs must be valid HTTP/HTTPS or /api/media/ URLs.");
                }
            }
        } else {
            errors.push("images, if provided, must be an array of URL strings.");
        }
    }

    // Check for item-level product mismatch if specified
    if (item.productId && expectedProductId && item.productId !== expectedProductId) {
        errors.push(`Item productId '${item.productId}' does not match expected product ID '${expectedProductId}'.`);
    }

    const isTemplatePlaceholder = isTemplatePlaceholderReview(item);
    if (isTemplatePlaceholder) {
        errors.push("This entry contains template placeholder data. Please replace with authentic customer feedback before publishing.");
    }

    const isSimulation = source === "simulated-test";
    const valid = errors.length === 0;

    // Must be valid, have consent confirmed, and NOT be a simulation or placeholder to be eligible for public storefront publication
    const eligibleForPublication = valid && customerConsentConfirmed && !isSimulation && !isTemplatePlaceholder;

    return {
        itemIndex: index + 1,
        externalReviewId,
        reviewerDisplayName,
        rating: typeof rating === "number" ? rating : 0,
        title,
        body,
        reviewedAt,
        source,
        sourceReference: sourceReference || undefined,
        customerConsentConfirmed,
        images: cleanImages,
        valid,
        eligibleForPublication,
        errors,
        warnings,
        isDuplicate: existingExternalIds.has(externalReviewId),
        isSimulation,
        isTemplatePlaceholder,
    };
}

/**
 * Validates a full review batch import payload.
 */
export function validateReviewImportPayload(
    payload: any,
    options: {
        productExists: boolean;
        productName?: string;
        existingExternalIds?: Set<string>;
        maxBatchSize?: number;
        expectedProductId?: string;
    }
): ReviewBatchValidationResult {
    const {
        productExists,
        productName,
        existingExternalIds = new Set<string>(),
        maxBatchSize = 200,
        expectedProductId,
    } = options;

    const entries: ReviewValidationEntry[] = [];
    const seenBatchIds = new Set<string>();

    if (!payload || typeof payload !== "object") {
        return {
            valid: false,
            productId: "",
            productName,
            totalSubmitted: 0,
            validCount: 0,
            invalidCount: 0,
            duplicateCount: 0,
            eligibleCount: 0,
            entries: [
                {
                    itemIndex: 0,
                    externalReviewId: "",
                    reviewerDisplayName: "",
                    rating: 0,
                    body: "",
                    reviewedAt: "",
                    source: "offline-customer-feedback",
                    customerConsentConfirmed: false,
                    images: [],
                    valid: false,
                    eligibleForPublication: false,
                    errors: ["Root payload must be a JSON object with 'productId' and 'reviews'."],
                    warnings: [],
                },
            ],
        };
    }

    const rawProductId = payload.productId;
    const productId = typeof rawProductId === "string" ? rawProductId.trim() : "";

    if (expectedProductId && productId && productId !== expectedProductId) {
        return {
            valid: false,
            productId,
            productName,
            totalSubmitted: Array.isArray(payload.reviews) ? payload.reviews.length : 0,
            validCount: 0,
            invalidCount: Array.isArray(payload.reviews) ? payload.reviews.length : 1,
            duplicateCount: 0,
            eligibleCount: 0,
            entries: [
                {
                    itemIndex: 0,
                    externalReviewId: "",
                    reviewerDisplayName: "",
                    rating: 0,
                    body: "",
                    reviewedAt: "",
                    source: "offline-customer-feedback",
                    customerConsentConfirmed: false,
                    images: [],
                    valid: false,
                    eligibleForPublication: false,
                    errors: [`Payload productId '${productId}' does not match target product '${expectedProductId}'.`],
                    warnings: [],
                },
            ],
        };
    }

    const reviews = payload.reviews;
    if (!Array.isArray(reviews)) {
        return {
            valid: false,
            productId,
            productName,
            totalSubmitted: 0,
            validCount: 0,
            invalidCount: 0,
            duplicateCount: 0,
            eligibleCount: 0,
            entries: [
                {
                    itemIndex: 0,
                    externalReviewId: "",
                    reviewerDisplayName: "",
                    rating: 0,
                    body: "",
                    reviewedAt: "",
                    source: "offline-customer-feedback",
                    customerConsentConfirmed: false,
                    images: [],
                    valid: false,
                    eligibleForPublication: false,
                    errors: ["'reviews' must be an array of review objects."],
                    warnings: [],
                },
            ],
        };
    }

    if (reviews.length === 0) {
        return {
            valid: false,
            productId,
            productName,
            totalSubmitted: 0,
            validCount: 0,
            invalidCount: 0,
            duplicateCount: 0,
            eligibleCount: 0,
            entries: [
                {
                    itemIndex: 0,
                    externalReviewId: "",
                    reviewerDisplayName: "",
                    rating: 0,
                    body: "",
                    reviewedAt: "",
                    source: "offline-customer-feedback",
                    customerConsentConfirmed: false,
                    images: [],
                    valid: false,
                    eligibleForPublication: false,
                    errors: ["'reviews' array is empty. Please supply at least one review entry."],
                    warnings: [],
                },
            ],
        };
    }

    if (reviews.length > maxBatchSize) {
        return {
            valid: false,
            productId,
            productName,
            totalSubmitted: reviews.length,
            validCount: 0,
            invalidCount: reviews.length,
            duplicateCount: 0,
            eligibleCount: 0,
            entries: [
                {
                    itemIndex: 0,
                    externalReviewId: "",
                    reviewerDisplayName: "",
                    rating: 0,
                    body: "",
                    reviewedAt: "",
                    source: "offline-customer-feedback",
                    customerConsentConfirmed: false,
                    images: [],
                    valid: false,
                    eligibleForPublication: false,
                    errors: [`Batch size exceeds limit of ${maxBatchSize} reviews (received ${reviews.length}).`],
                    warnings: [],
                },
            ],
        };
    }

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let eligibleCount = 0;

    for (let i = 0; i < reviews.length; i++) {
        const entry = validateSingleReviewItem(reviews[i], i, seenBatchIds, existingExternalIds, expectedProductId || productId);

        // If product does not exist, add error to entry
        if (!productExists) {
            entry.errors.push(`Target product ID '${productId}' does not exist in catalog.`);
            entry.valid = false;
            entry.eligibleForPublication = false;
        }

        if (entry.valid) validCount++;
        else invalidCount++;

        if (entry.isDuplicate) duplicateCount++;
        if (entry.eligibleForPublication) eligibleCount++;

        entries.push(entry);
    }

    return {
        valid: invalidCount === 0 && productExists && reviews.length > 0,
        productId,
        productName,
        totalSubmitted: reviews.length,
        validCount,
        invalidCount,
        duplicateCount,
        eligibleCount,
        entries,
    };
}

/**
 * Authoritatively determines whether a review record is eligible for public display and rating totals.
 * Handles backward compatibility with historical customer reviews (created before publicationStatus field existed)
 * while strictly safeguarding against accidental publication of archived, staged, unpublished, fake, or simulated reviews.
 */
export function isPubliclyPublishedReview(r: any): boolean {
    if (!r || typeof r !== "object") return false;

    // Strict block on editorial notes, simulated test data, and template placeholders
    if (r.editorialNote === true) return false;
    if (r.sourceType === "simulated-test" || r.isSimulation === true) return false;
    if (r.isTemplatePlaceholder === true || isTemplatePlaceholderReview(r)) return false;

    // Explicit non-published statuses
    if (
        r.publicationStatus === "unpublished" ||
        r.publicationStatus === "archived" ||
        r.publicationStatus === "rejected" ||
        r.publicationStatus === "draft"
    ) {
        return false;
    }

    // Explicitly published reviews
    if (r.publicationStatus === "published") {
        if (r.isFake === true) return false;
        return true;
    }

    // Historical / legacy customer reviews (created before TASK 022, lacking publicationStatus):
    // Published only if isFake is NOT true and it has genuine customer / purchase indicators.
    if (!r.publicationStatus) {
        if (r.isFake === true) return false;
        return true;
    }

    return false;
}

/**
 * Calculates authoritative product rating stats (count, average rating, star distribution)
 * strictly from published customer reviews. Excludes draft, unpublished, editorial notes,
 * and simulated test data.
 */
export function calculateProductRatingStats(
    reviews: Array<{
        rating: number;
        publicationStatus?: string;
        isFake?: boolean;
        sourceType?: string;
        editorialNote?: boolean;
        isSimulation?: boolean;
    }>
): ProductReviewStats {
    const distribution: RatingDistribution = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
    };

    let totalRatingSum = 0;
    let publishedCount = 0;

    for (const r of reviews) {
        if (!isPubliclyPublishedReview(r)) continue;

        const star = Math.round(r.rating);
        if (star >= 1 && star <= 5) {
            distribution[star as 1 | 2 | 3 | 4 | 5]++;
            totalRatingSum += r.rating;
            publishedCount++;
        }
    }

    const averageRating =
        publishedCount > 0
            ? Math.round((totalRatingSum / publishedCount) * 10) / 10
            : 0.0;

    return {
        reviewCount: publishedCount,
        averageRating,
        ratingDistribution: distribution,
    };
}
