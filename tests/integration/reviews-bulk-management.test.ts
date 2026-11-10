import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { POST as validateRoute } from "../../src/app/api/admin/reviews/validate/route.ts";
import { POST as publishBatchRoute } from "../../src/app/api/admin/reviews/publish-batch/route.ts";
import { GET as adminReviewsGetRoute, PATCH as adminReviewsPatchRoute, DELETE as adminReviewsDeleteRoute } from "../../src/app/api/admin/reviews/route.ts";
import { POST as recalculateRoute } from "../../src/app/api/admin/reviews/recalculate/route.ts";
import { GET as publicReviewsGetRoute } from "../../src/app/api/reviews/route.ts";
import { POST as customerSubmitRoute } from "../../src/app/api/reviews/submit/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { clearCollection, createJsonPostRequest, createJsonPatchRequest, getSyntheticUserAuthToken } from "./testHelper.ts";

describe("Review Bulk Import, Moderation & Storefront Aggregates Integration Tests (TASK 022)", () => {
    const adminUid = "admin_user_task022";
    const customerUid = "customer_user_task022";
    const targetProductId = "prod_bazaar_hoodie";
    const emptyProductId = "prod_empty_reviews";

    let adminToken: string;
    let customerToken: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized. Ensure Firebase emulator is running.");
        }

        // Setup test users in Auth Emulator
        for (const uid of [adminUid, customerUid]) {
            try { await adminAuth.deleteUser(uid); } catch {}
        }

        await adminAuth.createUser({
            uid: adminUid,
            email: "admin022@bazaarvilla.test",
            displayName: "Bazaarvilla Admin",
        });
        // Provision admin Custom Claim
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer022@bazaarvilla.test",
            displayName: "Test Customer",
        });

        adminToken = await getSyntheticUserAuthToken(adminUid);
        customerToken = await getSyntheticUserAuthToken(customerUid);
    });

    beforeEach(async () => {
        if (!adminDb) return;

        await clearCollection(adminDb, "reviews");
        await clearCollection(adminDb, "reviewImportBatches");
        await clearCollection(adminDb, "products");
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "rateLimits");

        // Seed products
        await adminDb.collection("products").doc(targetProductId).set({
            id: targetProductId,
            name: "Bazaarvilla Signature Green Hoodie",
            price: 1499,
            isVisible: true,
            inventory: 50,
            reviewCount: 0,
            averageRating: 0.0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        });

        await adminDb.collection("products").doc(emptyProductId).set({
            id: emptyProductId,
            name: "Bazaarvilla Cotton Cap",
            price: 399,
            isVisible: true,
            inventory: 100,
            reviewCount: 0,
            averageRating: 0.0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        });
    });

    // 1. Authorization Boundaries
    it("REV-IMPORT-001: should reject unauthenticated validation requests with HTTP 401", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/admin/reviews/validate", {
            productId: targetProductId,
            reviews: [],
        });
        const res = await validateRoute(req);
        assert.equal(res.status, 401);
    });

    it("REV-IMPORT-002: should reject non-admin customer tokens with HTTP 403", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/validate",
            { productId: targetProductId, reviews: [] },
            { Authorization: `Bearer ${customerToken}` }
        );
        const res = await validateRoute(req);
        assert.equal(res.status, 403);
    });

    // 2. Validation Endpoint Behavior
    it("REV-IMPORT-003: should validate a batch of 38 reviews and report summary and item entries", async () => {
        // Construct 38 valid review entries
        const reviews38 = Array.from({ length: 38 }, (_, i) => ({
            externalReviewId: `batch-item-${i + 1}`,
            reviewerDisplayName: `Genuine Customer ${i + 1}`,
            rating: (i % 5) + 1, // distributes 1 to 5
            title: `Review Title ${i + 1}`,
            body: `This is a genuine customer feedback comment #${i + 1} detailing fabric and stitching quality.`,
            reviewedAt: "2026-10-20",
            source: "offline-customer-feedback",
            sourceReference: `RECEIPT-NV-${1000 + i}`,
            customerConsentConfirmed: true,
        }));

        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/validate",
            { productId: targetProductId, reviews: reviews38 },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await validateRoute(req);
        assert.equal(res.status, 200);

        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.totalSubmitted, 38);
        assert.equal(data.validCount, 38);
        assert.equal(data.invalidCount, 0);
        assert.equal(data.duplicateCount, 0);
        assert.equal(data.eligibleCount, 38);
        assert.equal(data.entries.length, 38);
    });

    it("REV-IMPORT-004: should reject invalid reviews, missing consent, and simulated test entries from publication eligibility", async () => {
        const mixedBatch = [
            {
                externalReviewId: "valid-1",
                reviewerDisplayName: "Aman Gupta",
                rating: 5,
                body: "Great fit!",
                reviewedAt: "2026-10-15",
                source: "offline-customer-feedback",
                sourceReference: "REC-101",
                customerConsentConfirmed: true,
            },
            {
                externalReviewId: "invalid-rating",
                reviewerDisplayName: "Test",
                rating: 7, // Invalid rating
                body: "Too high",
                reviewedAt: "2026-10-15",
                source: "offline-customer-feedback",
                sourceReference: "REC-102",
                customerConsentConfirmed: true,
            },
            {
                externalReviewId: "no-consent",
                reviewerDisplayName: "No Consent",
                rating: 5,
                body: "Valid review text but customer did not grant publication consent",
                reviewedAt: "2026-10-15",
                source: "offline-customer-feedback",
                sourceReference: "REC-103",
                customerConsentConfirmed: false, // Ineligible
            },
            {
                externalReviewId: "simulated-entry",
                reviewerDisplayName: "Demo Buyer",
                rating: 5,
                body: "Synthetic simulated preview entry for internal test",
                reviewedAt: "2026-10-15",
                source: "simulated-test",
                customerConsentConfirmed: true, // Simulation must NEVER be published
            },
        ];

        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/validate",
            { productId: targetProductId, reviews: mixedBatch },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await validateRoute(req);
        assert.equal(res.status, 200);

        const data = await res.json();
        assert.equal(data.totalSubmitted, 4);
        assert.equal(data.validCount, 3);
        assert.equal(data.invalidCount, 1);
        assert.equal(data.eligibleCount, 1); // Only valid-1 is eligible

        // Verify simulated item is flagged
        const simEntry = data.entries.find((e: any) => e.externalReviewId === "simulated-entry");
        assert.equal(simEntry.isSimulation, true);
        assert.equal(simEntry.eligibleForPublication, false);
    });

    it("REV-IMPORT-005: should reject non-existent product in catalog (HTTP 404 on publish)", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            {
                productId: "prod_does_not_exist_999",
                reviews: [
                    {
                        externalReviewId: "rev-1",
                        reviewerDisplayName: "Buyer",
                        rating: 5,
                        body: "Valid body",
                        reviewedAt: "2026-10-15",
                        source: "offline-customer-feedback",
                        sourceReference: "REC-101",
                        customerConsentConfirmed: true,
                    },
                ],
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await publishBatchRoute(req);
        assert.equal(res.status, 404);
    });

    // 3. Batch Publication & Storefront Aggregates
    it("REV-IMPORT-006: should publish 38 reviews, persist provenance, exclude false Verified badges, and update product aggregates", async () => {
        // Construct 38 reviews: 20x 5-star, 10x 4-star, 5x 3-star, 2x 2-star, 1x 1-star
        // Total = 38 reviews
        // Sum = (20*5) + (10*4) + (5*3) + (2*2) + (1*1) = 100 + 40 + 15 + 4 + 1 = 160
        // Expected average = 160 / 38 = 4.2105... -> 4.2
        const ratingsDistribution = [
            ...Array(20).fill(5),
            ...Array(10).fill(4),
            ...Array(5).fill(3),
            ...Array(2).fill(2),
            ...Array(1).fill(1),
        ];

        const reviews38 = ratingsDistribution.map((r, i) => ({
            externalReviewId: `pub-item-${i + 1}`,
            reviewerDisplayName: `Customer ${i + 1}`,
            rating: r,
            title: `Review Title ${i + 1}`,
            body: `Comment text for review number ${i + 1} with high satisfaction.`,
            reviewedAt: "2026-10-10",
            source: "offline-customer-feedback",
            sourceReference: `INV-2026-${1000 + i}`,
            customerConsentConfirmed: true,
        }));

        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            { productId: targetProductId, reviews: reviews38 },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await publishBatchRoute(req);
        assert.equal(res.status, 201);

        const data = await res.json();
        assert.equal(data.success, true);
        assert.equal(data.publishedCount, 38);
        assert.ok(data.batchId);

        // Verify product document in Firestore was updated
        const prodDoc = await adminDb!.collection("products").doc(targetProductId).get();
        const prodData = prodDoc.data()!;
        assert.equal(prodData.reviewCount, 38);
        assert.equal(prodData.averageRating, 4.2);
        assert.deepEqual(prodData.ratingDistribution, {
            1: 1,
            2: 2,
            3: 5,
            4: 10,
            5: 20,
        });

        // Verify review documents in Firestore:
        // Must have verifiedPurchase == false (external reviews don't get false verified badges)
        const sampleReview = await adminDb!
            .collection("reviews")
            .where("externalReviewId", "==", "pub-item-1")
            .get();
        assert.equal(sampleReview.empty, false);
        const sampleData = sampleReview.docs[0].data();
        assert.equal(sampleData.verifiedPurchase, false);
        assert.equal(sampleData.publicationStatus, "published");
        assert.equal(sampleData.sourceType, "offline-customer-feedback");
        assert.equal(sampleData.sourceReference, "INV-2026-1000");
        assert.equal(sampleData.importBatchId, data.batchId);

        // Verify batch audit record was created in reviewImportBatches
        const batchDoc = await adminDb!.collection("reviewImportBatches").doc(data.batchId).get();
        assert.equal(batchDoc.exists, true);
        const batchData = batchDoc.data()!;
        assert.equal(batchData.totalSubmitted, 38);
        assert.equal(batchData.publishedEntries, 38);
        assert.equal(batchData.status, "published");
    });

    it("REV-IMPORT-007: should enforce idempotency and reject duplicate externalReviewIds in subsequent imports", async () => {
        const item = {
            externalReviewId: "idempotency-check-001",
            reviewerDisplayName: "First Customer",
            rating: 5,
            body: "Great item",
            reviewedAt: "2026-10-15",
            source: "offline-customer-feedback",
            sourceReference: "REC-FIRST-1",
            customerConsentConfirmed: true,
        };

        // First import succeeds
        const req1 = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            { productId: targetProductId, reviews: [item] },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res1 = await publishBatchRoute(req1);
        assert.equal(res1.status, 201);

        // Re-attempting the exact same externalReviewId must fail publication with 400
        const req2 = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            { productId: targetProductId, reviews: [item] },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res2 = await publishBatchRoute(req2);
        assert.equal(res2.status, 400);
        const data2 = await res2.json();
        assert.ok(data2.error.includes("No eligible reviews found"));
        assert.equal(data2.validationSummary.duplicateCount, 1);
    });

    // 4. Review Moderation & Aggregate Consistency
    it("REV-IMPORT-008: should update aggregates when admin unpublishes or deletes a review", async () => {
        // Publish 2 reviews: one 5-star, one 1-star -> avg = 3.0
        const reviews = [
            {
                externalReviewId: "mod-rev-5",
                reviewerDisplayName: "Buyer 5",
                rating: 5,
                body: "Perfect",
                reviewedAt: "2026-10-15",
                source: "offline-customer-feedback",
                sourceReference: "REF-5",
                customerConsentConfirmed: true,
            },
            {
                externalReviewId: "mod-rev-1",
                reviewerDisplayName: "Buyer 1",
                rating: 1,
                body: "Did not like color",
                reviewedAt: "2026-10-15",
                source: "offline-customer-feedback",
                sourceReference: "REF-1",
                customerConsentConfirmed: true,
            },
        ];

        const pubReq = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            { productId: targetProductId, reviews },
            { Authorization: `Bearer ${adminToken}` }
        );
        const pubRes = await publishBatchRoute(pubReq);
        assert.equal(pubRes.status, 201);

        let prod = (await adminDb!.collection("products").doc(targetProductId).get()).data()!;
        assert.equal(prod.reviewCount, 2);
        assert.equal(prod.averageRating, 3.0);

        // Get the review ID for mod-rev-1
        const snap = await adminDb!.collection("reviews").where("externalReviewId", "==", "mod-rev-1").get();
        const review1Id = snap.docs[0].id;

        // Unpublish mod-rev-1 via PATCH
        const patchReq = createJsonPatchRequest(
            "http://localhost:3000/api/admin/reviews",
            { reviewId: review1Id, publicationStatus: "unpublished" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const patchRes = await adminReviewsPatchRoute(patchReq);
        assert.equal(patchRes.status, 200);

        // Product review stats must now reflect ONLY the 5-star review (count=1, avg=5.0)
        prod = (await adminDb!.collection("products").doc(targetProductId).get()).data()!;
        assert.equal(prod.reviewCount, 1);
        assert.equal(prod.averageRating, 5.0);
        assert.equal(prod.ratingDistribution[1], 0);
        assert.equal(prod.ratingDistribution[5], 1);

        // Delete mod-rev-1 via DELETE
        const delReq = new Request(`http://localhost:3000/api/admin/reviews?reviewId=${review1Id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        const delRes = await adminReviewsDeleteRoute(delReq as any);
        assert.equal(delRes.status, 200);

        // Re-check product stats: still 1 review with 5.0
        prod = (await adminDb!.collection("products").doc(targetProductId).get()).data()!;
        assert.equal(prod.reviewCount, 1);
        assert.equal(prod.averageRating, 5.0);
    });

    // 5. Public Storefront Retrieval API
    it("REV-IMPORT-009: public /api/reviews should paginate, filter by rating, and redact private provenance", async () => {
        // Seed 15 published reviews
        const reviews15 = Array.from({ length: 15 }, (_, i) => ({
            externalReviewId: `storefront-item-${i + 1}`,
            reviewerDisplayName: `Store Customer ${i + 1}`,
            rating: (i % 5) + 1,
            title: `Title ${i + 1}`,
            body: `Public review text ${i + 1}`,
            reviewedAt: "2026-10-10",
            source: "offline-customer-feedback",
            sourceReference: `PRIVATE-INTERNAL-REF-${i + 1}`, // MUST BE REDACTED
            customerConsentConfirmed: true,
        }));

        await publishBatchRoute(
            createJsonPostRequest(
                "http://localhost:3000/api/admin/reviews/publish-batch",
                { productId: targetProductId, reviews: reviews15 },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        // Page 1 (limit 10)
        const page1Req = new Request(`http://localhost:3000/api/reviews?productId=${targetProductId}&page=1&limit=10`);
        const page1Res = await publicReviewsGetRoute(page1Req as any);
        assert.equal(page1Res.status, 200);

        const page1Data = await page1Res.json();
        assert.equal(page1Data.pagination.total, 15);
        assert.equal(page1Data.pagination.page, 1);
        assert.equal(page1Data.pagination.totalPages, 2);
        assert.equal(page1Data.pagination.hasMore, true);
        assert.equal(page1Data.reviews.length, 10);

        // Security / Privacy: confirm private fields are NOT exposed
        for (const rev of page1Data.reviews) {
            assert.equal(rev.sourceReference, undefined);
            assert.equal(rev.customerConsentConfirmed, undefined);
            assert.equal(rev.importedBy, undefined);
            assert.equal(rev.importBatchId, undefined);
        }

        // Filter by 5 stars only (3 items in 15 items: index 4, 9, 14)
        const filterReq = new Request(`http://localhost:3000/api/reviews?productId=${targetProductId}&rating=5`);
        const filterRes = await publicReviewsGetRoute(filterReq as any);
        const filterData = await filterRes.json();
        assert.equal(filterData.pagination.total, 3);
        assert.ok(filterData.reviews.every((r: any) => r.rating === 5));
    });

    // 6. Regression: Existing Customer In-App Submission
    it("REV-IMPORT-010: should preserve existing in-app customer review submission and update aggregates", async () => {
        // Seed a qualifying delivered order for customerUid
        await adminDb!.collection("orders").doc("order_cust_022").set({
            id: "order_cust_022",
            userId: customerUid,
            orderStatus: "Delivered",
            paymentStatus: "PAID",
            items: [{ id: emptyProductId, name: "Bazaarvilla Cotton Cap", price: 399, quantity: 1 }],
            createdAt: new Date().toISOString(),
        });

        const submitReq = createJsonPostRequest(
            "http://localhost:3000/api/reviews/submit",
            {
                productId: emptyProductId,
                rating: 5,
                comment: "Loved this cotton cap! Super comfortable.",
                userName: "Verified Test Customer",
            },
            { Authorization: `Bearer ${customerToken}` }
        );

        const submitRes = await customerSubmitRoute(submitReq);
        assert.equal(submitRes.status, 201);

        const submitData = await submitRes.json();
        assert.equal(submitData.review.verifiedPurchase, true);
        assert.equal(submitData.review.publicationStatus, "published");
        assert.equal(submitData.review.sourceType, "storefront");

        // Product aggregates must be automatically updated
        const emptyProd = (await adminDb!.collection("products").doc(emptyProductId).get()).data()!;
        assert.equal(emptyProd.reviewCount, 1);
        assert.equal(emptyProd.averageRating, 5.0);
        assert.equal(emptyProd.ratingDistribution[5], 1);
    });

    // 7. Simulation Safeguards & Private Status Isolation
    it("REV-IMPORT-011: should strictly reject publishing batches containing simulated-test reviews", async () => {
        const simulatedBatch = [
            {
                externalReviewId: "sim-item-001",
                reviewerDisplayName: "[Simulation] Demo User",
                rating: 5,
                title: "Simulated Review",
                body: "This is a simulated review fixture that must never reach the live database.",
                reviewedAt: "2026-10-10",
                source: "simulated-test",
                sourceReference: "DEMO-REF-001",
                customerConsentConfirmed: false,
            },
        ];

        const req = createJsonPostRequest(
            "http://localhost:3000/api/admin/reviews/publish-batch",
            { productId: targetProductId, reviews: simulatedBatch },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await publishBatchRoute(req);
        assert.equal(res.status, 400);

        const data = await res.json();
        assert.ok(data.error.includes("Simulated"));

        // Confirm nothing was written to Firestore reviews collection
        const snap = await adminDb!.collection("reviews").where("sourceType", "==", "simulated-test").get();
        assert.equal(snap.empty, true);
    });

    it("REV-IMPORT-012: public /api/reviews must hide unpublished, archived, rejected, and simulated reviews", async () => {
        const timestamp = Date.now();
        // Seed reviews with different publication statuses
        await adminDb!.collection("reviews").doc("rev_staged").set({
            id: "rev_staged",
            productId: targetProductId,
            rating: 5,
            comment: "Staged review not yet published",
            publicationStatus: "staged",
            createdAt: timestamp,
            isFake: false,
        });

        await adminDb!.collection("reviews").doc("rev_archived").set({
            id: "rev_archived",
            productId: targetProductId,
            rating: 1,
            comment: "Archived review",
            publicationStatus: "archived",
            createdAt: timestamp,
            isFake: false,
        });

        await adminDb!.collection("reviews").doc("rev_simulated").set({
            id: "rev_simulated",
            productId: targetProductId,
            rating: 5,
            comment: "Simulated review",
            sourceType: "simulated-test",
            publicationStatus: "published",
            createdAt: timestamp,
            isFake: false,
        });

        await adminDb!.collection("reviews").doc("rev_legit_pub").set({
            id: "rev_legit_pub",
            productId: targetProductId,
            rating: 5,
            userName: "Genuine Customer",
            comment: "Legitimate published review",
            publicationStatus: "published",
            createdAt: timestamp,
            isFake: false,
            sourceType: "storefront",
        });

        const req = new Request(`http://localhost:3000/api/reviews?productId=${targetProductId}`);
        const res = await publicReviewsGetRoute(req as any);
        assert.equal(res.status, 200);

        const data = await res.json();
        const returnedIds = data.reviews.map((r: any) => r.id);

        assert.ok(returnedIds.includes("rev_legit_pub"), "Published review must be visible");
        assert.ok(!returnedIds.includes("rev_staged"), "Staged review must NOT be visible");
        assert.ok(!returnedIds.includes("rev_archived"), "Archived review must NOT be visible");
        assert.ok(!returnedIds.includes("rev_simulated"), "Simulated review must NOT be visible");
    });
});
