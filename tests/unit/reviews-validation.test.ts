import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    validateReviewImportPayload,
    validateSingleReviewItem,
    calculateProductRatingStats,
    sanitizeReviewText,
    containsHtmlOrScript,
} from "../../src/lib/reviews/validation.ts";

describe("Review Bulk Import Validation Unit Tests (TASK 022)", () => {
    const validItem = {
        externalReviewId: "ext-rev-001",
        reviewerDisplayName: "Rahul Sharma",
        rating: 5,
        title: "Exceptional Fabric & Fit",
        body: "Received this product yesterday and the quality exceeds expectations. The stitching is top notch.",
        reviewedAt: "2026-10-15",
        source: "offline-customer-feedback" as const,
        sourceReference: "STORE-RECEIPT-99821",
        customerConsentConfirmed: true,
    };

    it("VAL-001: should validate a well-formed review item successfully", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();
        const result = validateSingleReviewItem(validItem, 0, seen, existing);

        assert.equal(result.valid, true);
        assert.equal(result.eligibleForPublication, true);
        assert.equal(result.errors.length, 0);
        assert.equal(result.externalReviewId, "ext-rev-001");
        assert.equal(result.rating, 5);
        assert.equal(result.customerConsentConfirmed, true);
    });

    it("VAL-002: should reject invalid ratings (< 1, > 5, non-integer, or string)", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const cases = [0, 6, -1, 3.5, "5", null, undefined];
        for (const badRating of cases) {
            const result = validateSingleReviewItem(
                { ...validItem, externalReviewId: `id-${badRating}`, rating: badRating },
                0,
                seen,
                existing
            );
            assert.equal(result.valid, false);
            assert.ok(result.errors.some((e) => e.includes("Rating must be an integer between 1 and 5")));
        }
    });

    it("VAL-003: should reject empty, missing, or oversized display names", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const emptyRes = validateSingleReviewItem(
            { ...validItem, reviewerDisplayName: "" },
            0,
            seen,
            existing
        );
        assert.equal(emptyRes.valid, false);
        assert.ok(emptyRes.errors.some((e) => e.includes("reviewerDisplayName is required")));

        const longName = "A".repeat(85);
        const longRes = validateSingleReviewItem(
            { ...validItem, reviewerDisplayName: longName },
            0,
            seen,
            existing
        );
        assert.equal(longRes.valid, false);
        assert.ok(longRes.errors.some((e) => e.includes("between 1 and 80 characters")));
    });

    it("VAL-004: should sanitize HTML tags and strip script injections from comments", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const dirtyItem = {
            ...validItem,
            reviewerDisplayName: "<b>Hacker</b>",
            title: "<script>alert('xss')</script>Great",
            body: "Loved it <img src=x onerror=alert(1)> and will buy again! <script>window.location='evil.com'</script>",
        };

        const result = validateSingleReviewItem(dirtyItem, 0, seen, existing);
        assert.equal(result.valid, true);
        assert.equal(result.reviewerDisplayName, "Hacker");
        assert.equal(result.title, "alert('xss')Great");
        assert.ok(!result.body.includes("<script>"));
        assert.ok(!result.body.includes("<img"));
        assert.ok(result.warnings.length > 0);
    });

    it("VAL-005: should reject future review dates (> current time + 1 day)", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const futureDate = "2099-01-01";
        const result = validateSingleReviewItem(
            { ...validItem, reviewedAt: futureDate },
            0,
            seen,
            existing
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes("date cannot be in the future")));
    });

    it("VAL-006: should reject malformed or non-ISO dates", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const result = validateSingleReviewItem(
            { ...validItem, reviewedAt: "not-a-real-date" },
            0,
            seen,
            existing
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes("valid ISO date string")));
    });

    it("VAL-007: should require sourceReference for offline and external feedback", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const result = validateSingleReviewItem(
            { ...validItem, sourceReference: "" },
            0,
            seen,
            existing
        );
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes("sourceReference")));
    });

    it("VAL-008: should mark entry as INELIGIBLE for publication if customerConsentConfirmed is false", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const result = validateSingleReviewItem(
            { ...validItem, customerConsentConfirmed: false },
            0,
            seen,
            existing
        );
        // Valid structure, but not eligible for public storefront publication
        assert.equal(result.valid, true);
        assert.equal(result.eligibleForPublication, false);
        assert.ok(result.warnings.some((w) => w.includes("customerConsentConfirmed is false")));
    });

    it("VAL-009: should mark simulated-test reviews as private simulation and never eligible for publication", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const simItem = {
            ...validItem,
            source: "simulated-test" as const,
            customerConsentConfirmed: true,
        };

        const result = validateSingleReviewItem(simItem, 0, seen, existing);
        assert.equal(result.valid, true);
        assert.equal(result.isSimulation, true);
        assert.equal(result.eligibleForPublication, false);
    });

    it("VAL-010: should reject duplicate externalReviewId within the same batch", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const res1 = validateSingleReviewItem(validItem, 0, seen, existing);
        assert.equal(res1.valid, true);

        const res2 = validateSingleReviewItem(validItem, 1, seen, existing);
        assert.equal(res2.valid, false);
        assert.ok(res2.errors.some((e) => e.includes("Duplicate externalReviewId")));
    });

    it("VAL-011: should reject externalReviewId that has already been imported previously", () => {
        const seen = new Set<string>();
        const existing = new Set<string>(["ext-rev-001"]);

        const res = validateSingleReviewItem(validItem, 0, seen, existing);
        assert.equal(res.valid, false);
        assert.equal(res.isDuplicate, true);
        assert.ok(res.errors.some((e) => e.includes("already been imported")));
    });

    it("VAL-012: should reject forbidden injected properties (role, admin, verifiedPurchase, isFake)", () => {
        const seen = new Set<string>();
        const existing = new Set<string>();

        const maliciousItem = {
            ...validItem,
            admin: true,
            role: "admin",
            verifiedPurchase: true,
            isFake: false,
        };

        const res = validateSingleReviewItem(maliciousItem, 0, seen, existing);
        assert.equal(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes("is forbidden")));
    });

    it("VAL-013: should validate full batch payload and report counts accurately", () => {
        const payload = {
            productId: "prod_hoodie_101",
            reviews: [
                validItem,
                {
                    ...validItem,
                    externalReviewId: "ext-rev-002",
                    rating: 4,
                    reviewerDisplayName: "Priya Nair",
                },
                {
                    ...validItem,
                    externalReviewId: "ext-rev-003",
                    rating: 6, // invalid
                },
                {
                    ...validItem,
                    externalReviewId: "ext-rev-004",
                    customerConsentConfirmed: false, // valid structure, ineligible for publication
                },
            ],
        };

        const result = validateReviewImportPayload(payload, {
            productExists: true,
            productName: "Signature Hoodie",
        });

        assert.equal(result.totalSubmitted, 4);
        assert.equal(result.validCount, 3);
        assert.equal(result.invalidCount, 1);
        assert.equal(result.eligibleCount, 2); // only items 1 and 2
        assert.equal(result.valid, false); // overall batch has 1 invalid item
    });

    it("VAL-014: should fail validation if target product does not exist in catalog", () => {
        const payload = {
            productId: "non_existent_product",
            reviews: [validItem],
        };

        const result = validateReviewImportPayload(payload, {
            productExists: false,
        });

        assert.equal(result.valid, false);
        assert.ok(result.entries[0].errors.some((e) => e.includes("does not exist")));
    });

    it("VAL-015: should reject oversized batches exceeding maximum batch limit", () => {
        const oversizedReviews = Array.from({ length: 205 }, (_, i) => ({
            ...validItem,
            externalReviewId: `rev-${i}`,
        }));

        const result = validateReviewImportPayload(
            { productId: "prod_1", reviews: oversizedReviews },
            { productExists: true, maxBatchSize: 200 }
        );

        assert.equal(result.valid, false);
        assert.ok(result.entries[0].errors.some((e) => e.includes("exceeds limit of 200")));
    });

    it("VAL-016: calculateProductRatingStats should accurately aggregate ratings and star distribution", () => {
        const reviews = [
            { rating: 5, publicationStatus: "published" },
            { rating: 5, publicationStatus: "published" },
            { rating: 4, publicationStatus: "published" },
            { rating: 3, publicationStatus: "published" },
            { rating: 1, publicationStatus: "published" },
            { rating: 5, publicationStatus: "unpublished" }, // excluded
            { rating: 5, editorialNote: true }, // excluded
            { rating: 5, sourceType: "simulated-test" }, // excluded
            { rating: 5, isFake: true, publicationStatus: "draft" }, // excluded
        ];

        const stats = calculateProductRatingStats(reviews);

        assert.equal(stats.reviewCount, 5);
        // (5 + 5 + 4 + 3 + 1) / 5 = 18 / 5 = 3.6
        assert.equal(stats.averageRating, 3.6);
        assert.deepEqual(stats.ratingDistribution, {
            1: 1,
            2: 0,
            3: 1,
            4: 1,
            5: 2,
        });
    });

    it("VAL-017: calculateProductRatingStats should return 0.0 and zero counts when no published reviews exist", () => {
        const stats = calculateProductRatingStats([]);
        assert.equal(stats.reviewCount, 0);
        assert.equal(stats.averageRating, 0.0);
        assert.deepEqual(stats.ratingDistribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    });
});
