import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as adminModule from "firebase-admin";
import { POST as submitReviewRoute } from "../../src/app/api/reviews/submit/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";

const admin = (adminModule as any).default || adminModule;

describe("POST /api/reviews/submit Integration Tests (Firestore Emulator)", () => {
    const verifiedBuyerUid = "user_verified_buyer_101";
    const nonBuyerUid = "user_non_buyer_102";
    const pendingBuyerUid = "user_pending_buyer_103";
    const otherProductBuyerUid = "user_other_product_104";

    const targetProductId = "prod_reviewable_jacket";
    const otherProductId = "prod_unrelated_tshirt";

    let buyerToken: string;
    let nonBuyerToken: string;
    let pendingBuyerToken: string;
    let otherBuyerToken: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized. Ensure Firebase emulator is running.");
        }

        // 1. Create or clean test users in Auth Emulator
        for (const uid of [verifiedBuyerUid, nonBuyerUid, pendingBuyerUid, otherProductBuyerUid]) {
            try { await adminAuth.deleteUser(uid); } catch {}
            await adminAuth.createUser({
                uid,
                email: `${uid}@trendkartz.test`,
                displayName: `User ${uid}`,
            });
        }

        buyerToken = await getSyntheticUserAuthToken(verifiedBuyerUid);
        nonBuyerToken = await getSyntheticUserAuthToken(nonBuyerUid);
        pendingBuyerToken = await getSyntheticUserAuthToken(pendingBuyerUid);
        otherBuyerToken = await getSyntheticUserAuthToken(otherProductBuyerUid);
    });

    beforeEach(async () => {
        if (!adminDb) return;

        await clearCollection(adminDb, "reviews");
        await clearCollection(adminDb, "orders");
        await clearCollection(adminDb, "rateLimits");

        // Seed target product in products collection
        await adminDb.collection("products").doc(targetProductId).set({
            id: targetProductId,
            name: "Premium Denim Jacket",
            price: 1999,
            isVisible: true,
            inventory: 50,
        });

        await adminDb.collection("products").doc(otherProductId).set({
            id: otherProductId,
            name: "Classic Cotton T-Shirt",
            price: 499,
            isVisible: true,
            inventory: 100,
        });

        // 1. Seed qualifying delivered order for verifiedBuyerUid
        await adminDb.collection("orders").doc("order_delivered_buyer").set({
            id: "order_delivered_buyer",
            userId: verifiedBuyerUid,
            orderStatus: "Delivered",
            paymentStatus: "PAID",
            paymentMethod: "RAZORPAY",
            total: 1999,
            items: [
                {
                    id: targetProductId,
                    productId: targetProductId,
                    name: "Premium Denim Jacket",
                    price: 1999,
                    quantity: 1,
                },
            ],
            createdAt: new Date().toISOString(),
        });

        // 2. Seed pending (undelivered) order for pendingBuyerUid
        await adminDb.collection("orders").doc("order_pending_buyer").set({
            id: "order_pending_buyer",
            userId: pendingBuyerUid,
            orderStatus: "Processing",
            paymentStatus: "PAID",
            paymentMethod: "RAZORPAY",
            total: 1999,
            items: [
                {
                    id: targetProductId,
                    productId: targetProductId,
                    name: "Premium Denim Jacket",
                    price: 1999,
                    quantity: 1,
                },
            ],
            createdAt: new Date().toISOString(),
        });

        // 3. Seed delivered order for otherProductBuyerUid containing a different product
        await adminDb.collection("orders").doc("order_other_product").set({
            id: "order_other_product",
            userId: otherProductBuyerUid,
            orderStatus: "Delivered",
            paymentStatus: "PAID",
            paymentMethod: "RAZORPAY",
            total: 499,
            items: [
                {
                    id: otherProductId,
                    productId: otherProductId,
                    name: "Classic Cotton T-Shirt",
                    price: 499,
                    quantity: 1,
                },
            ],
            createdAt: new Date().toISOString(),
        });
    });

    it("REV-001: should allow a verified buyer with a delivered order to submit a review", async () => {
        const payload = {
            productId: targetProductId,
            rating: 5,
            comment: "Exceptional quality and fast delivery! Highly recommended.",
            images: ["https://storage.googleapis.com/test-bucket/reviews/image1.jpg"],
            userName: "Alice Buyer",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${buyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 201);
        assert.equal(data.success, true);
        assert.equal(data.review.productId, targetProductId);
        assert.equal(data.review.userId, verifiedBuyerUid);
        assert.equal(data.review.rating, 5);
        assert.equal(data.review.comment, payload.comment);
        assert.equal(data.review.isFake, false);
        assert.equal(data.review.verifiedPurchase, true);

        // Verify document persisted in Firestore
        const reviewDoc = await adminDb!.collection("reviews").doc(data.review.id).get();
        assert.equal(reviewDoc.exists, true);
        assert.equal(reviewDoc.data()?.userId, verifiedBuyerUid);
        assert.equal(reviewDoc.data()?.verifiedPurchase, true);
    });

    it("REV-002: should reject review submission when customer has NO purchase history", async () => {
        const payload = {
            productId: targetProductId,
            rating: 5,
            comment: "Looks great even though I never bought it!",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${nonBuyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 403);
        assert.match(data.error, /verified, delivered purchase/i);

        // Verify NO review was written to Firestore
        const reviewsSnap = await adminDb!.collection("reviews").where("userId", "==", nonBuyerUid).get();
        assert.equal(reviewsSnap.empty, true);
    });

    it("REV-003: should reject review submission when order is still in Processing (not yet Delivered)", async () => {
        const payload = {
            productId: targetProductId,
            rating: 4,
            comment: "Ordered it, waiting for delivery.",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${pendingBuyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 403);
        assert.match(data.error, /verified, delivered purchase/i);
    });

    it("REV-004: should reject review submission when order is Delivered but does NOT contain product", async () => {
        const payload = {
            productId: targetProductId, // Bought otherProductId, not targetProductId
            rating: 4,
            comment: "Reviewing the wrong product.",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${otherBuyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 403);
        assert.match(data.error, /verified, delivered purchase/i);
    });

    it("REV-005: should ignore client-forged userId and bind authoritatively to verified token UID", async () => {
        const payload = {
            productId: targetProductId,
            userId: "spoofed_victim_uid_999", // Attacker attempts to forge review under someone else's name
            rating: 5,
            comment: "Authentic review with attempted forged UID.",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${buyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 201);
        assert.equal(data.review.userId, verifiedBuyerUid); // Bound to token, NOT spoofed_victim_uid_999
        assert.notEqual(data.review.userId, "spoofed_victim_uid_999");
    });

    it("REV-006: should reject request with missing or invalid Authorization token", async () => {
        const payload = {
            productId: targetProductId,
            rating: 5,
            comment: "Unauthenticated review attempt.",
        };

        // Missing Authorization header
        const reqNoAuth = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload);
        const resNoAuth = await submitReviewRoute(reqNoAuth);
        assert.equal(resNoAuth.status, 401);

        // Malformed token
        const reqBadToken = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: "Bearer invalid.jwt.token",
        });
        const resBadToken = await submitReviewRoute(reqBadToken);
        assert.equal(resBadToken.status, 401);
    });

    it("REV-007: should enforce duplicate review policy (reject second review from same customer for same product)", async () => {
        const payload = {
            productId: targetProductId,
            rating: 5,
            comment: "First legitimate review.",
        };

        // 1. First submission succeeds
        const req1 = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${buyerToken}`,
        });
        const res1 = await submitReviewRoute(req1);
        assert.equal(res1.status, 201);

        // 2. Second submission for same product rejected with HTTP 409
        const req2 = createJsonPostRequest("http://localhost:3000/api/reviews/submit", {
            ...payload,
            comment: "Second duplicate review attempt.",
        }, {
            Authorization: `Bearer ${buyerToken}`,
        });
        const res2 = await submitReviewRoute(req2);
        const data2 = await res2.json();

        assert.equal(res2.status, 409);
        assert.match(data2.error, /already reviewed/i);
    });

    it("REV-008: should reject invalid ratings (bounds < 1 or > 5 or non-integers)", async () => {
        const invalidRatings = [0, 6, -1, 3.5, NaN, null, "5"];

        for (const badRating of invalidRatings) {
            const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", {
                productId: targetProductId,
                rating: badRating,
                comment: "Testing invalid ratings",
            }, {
                Authorization: `Bearer ${buyerToken}`,
            });

            const res = await submitReviewRoute(req);
            assert.equal(res.status, 400, `Expected 400 for rating: ${badRating}`);
        }
    });

    it("REV-009: should reject empty or oversized comments", async () => {
        // Empty comment
        const reqEmpty = createJsonPostRequest("http://localhost:3000/api/reviews/submit", {
            productId: targetProductId,
            rating: 5,
            comment: "   ",
        }, {
            Authorization: `Bearer ${buyerToken}`,
        });
        const resEmpty = await submitReviewRoute(reqEmpty);
        assert.equal(resEmpty.status, 400);

        // Oversized comment > 2000 characters
        const reqHuge = createJsonPostRequest("http://localhost:3000/api/reviews/submit", {
            productId: targetProductId,
            rating: 5,
            comment: "A".repeat(2001),
        }, {
            Authorization: `Bearer ${buyerToken}`,
        });
        const resHuge = await submitReviewRoute(reqHuge);
        assert.equal(resHuge.status, 400);
    });

    it("REV-010: should ignore client-provided moderation fields (isFake, verifiedPurchase, id)", async () => {
        const payload = {
            productId: targetProductId,
            rating: 5,
            comment: "Testing privileged field injection",
            id: "client_chosen_id_123",
            isFake: true, // Attacker attempts to mark review fake or manipulate moderation
            verifiedPurchase: false,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${buyerToken}`,
        });

        const res = await submitReviewRoute(req);
        const data = await res.json();

        assert.equal(res.status, 201);
        assert.notEqual(data.review.id, "client_chosen_id_123");
        assert.equal(data.review.isFake, false); // Server enforced false
        assert.equal(data.review.verifiedPurchase, true); // Server enforced true
    });

    it("REV-011: should reject review when target product does not exist in catalog", async () => {
        const payload = {
            productId: "non_existent_product_999",
            rating: 5,
            comment: "Reviewing ghost product",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/reviews/submit", payload, {
            Authorization: `Bearer ${buyerToken}`,
        });

        const res = await submitReviewRoute(req);
        assert.equal(res.status, 404);
    });
});
