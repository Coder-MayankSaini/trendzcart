import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { POST as authorizeUploadRoute } from "../../src/app/api/uploads/authorize/route.ts";
import { POST as completeUploadRoute } from "../../src/app/api/uploads/complete/route.ts";
import { GET as mediaDownloadRoute } from "../../src/app/api/media/download/route.ts";
import { GET as mediaPublicRoute } from "../../src/app/api/media/public/route.ts";
import { PUT as mockPutRoute } from "../../src/app/api/uploads/mock-put/route.ts";
import { POST as submitReviewRoute } from "../../src/app/api/reviews/submit/route.ts";
import { _mockStorage } from "../../src/lib/storage/r2.ts";
import {
    clearCollection,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
    seedEmulatorDatabase,
} from "./testHelper.ts";
import { NextRequest } from "next/server";

describe("Cloudflare R2 Authorization & Media Access Integration Tests (R2-013, R2-014, R2-017 to R2-021)", () => {
    const GUEST_ANON_UID = "guest_anon_r2_auth_101";
    const CUST_ALICE_UID = "cust_alice_r2_auth_202";
    const CUST_BOB_UID = "cust_bob_r2_auth_303";
    const ADMIN_UID = "admin_supervisor_r2_auth_999";

    let guestToken: string;
    let aliceToken: string;
    let bobToken: string;
    let adminToken: string;

    before(async () => {
        if (!adminAuth) throw new Error("adminAuth unavailable");

        // Clean & create test users in Auth Emulator
        try { await adminAuth.deleteUser(GUEST_ANON_UID); } catch {}
        try { await adminAuth.deleteUser(CUST_ALICE_UID); } catch {}
        try { await adminAuth.deleteUser(CUST_BOB_UID); } catch {}
        try { await adminAuth.deleteUser(ADMIN_UID); } catch {}

        await adminAuth.createUser({ uid: GUEST_ANON_UID, email: "guest_r2@trendkartz.test" });
        await adminAuth.createUser({ uid: CUST_ALICE_UID, email: "alice_r2@trendkartz.test" });
        await adminAuth.createUser({ uid: CUST_BOB_UID, email: "bob_r2@trendkartz.test" });
        await adminAuth.createUser({ uid: ADMIN_UID, email: "admin_r2@trendkartz.test" });

        // Provision admin custom claims
        await adminAuth.setCustomUserClaims(ADMIN_UID, { admin: true });

        guestToken = await getSyntheticUserAuthToken(GUEST_ANON_UID);
        aliceToken = await getSyntheticUserAuthToken(CUST_ALICE_UID);
        bobToken = await getSyntheticUserAuthToken(CUST_BOB_UID);
        adminToken = await getSyntheticUserAuthToken(ADMIN_UID);
    });

    beforeEach(async () => {
        _mockStorage.clear();
        if (adminDb) {
            await clearCollection(adminDb, "uploadSessions");
            await clearCollection(adminDb, "orders");
            await clearCollection(adminDb, "reviews");
            await seedEmulatorDatabase(adminDb);
        }
    });

    it("R2-013: Guest customer can complete a customization upload", async () => {
        // 1. Authorize with guest anonymous token
        const authReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/jpeg",
                sizeBytes: 15000,
                originalName: "guest_photo.jpg",
            },
            { Authorization: `Bearer ${guestToken}` }
        );

        const authRes = await authorizeUploadRoute(authReq);
        assert.equal(authRes.status, 200);
        const { uploadUrl, key, sessionId } = await authRes.json();
        assert.ok(key.startsWith(`customizations/${GUEST_ANON_UID}/`));

        // 2. Direct upload PUT
        const putReq = new Request(`http://localhost:3000${uploadUrl}`, {
            method: "PUT",
            headers: { "Content-Type": "image/jpeg" },
            body: Buffer.alloc(15000, "G"),
        });
        const putRes = await mockPutRoute(putReq as any);
        assert.equal(putRes.status, 200);

        // 3. Complete
        const compReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/complete",
            { sessionId, key },
            { Authorization: `Bearer ${guestToken}` }
        );
        const compRes = await completeUploadRoute(compReq);
        assert.equal(compRes.status, 200);
        const compData = await compRes.json();
        assert.equal(compData.success, true);
        assert.equal(compData.key, key);
    });

    it("R2-014: Registered customer retains their session and uploads cleanly", async () => {
        const authReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/png",
                sizeBytes: 25000,
                originalName: "alice_registered.png",
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const authRes = await authorizeUploadRoute(authReq);
        assert.equal(authRes.status, 200);
        const { key } = await authRes.json();
        assert.ok(key.startsWith(`customizations/${CUST_ALICE_UID}/`));
    });

    it("R2-017: Admin can retrieve a private customization image", async () => {
        // Seed Alice's private image in mock storage
        const aliceKey = `customizations/${CUST_ALICE_UID}/alice_confidential.jpg`;
        _mockStorage.set(aliceKey, {
            key: aliceKey,
            contentType: "image/jpeg",
            size: 30000,
            metadata: { ownerUid: CUST_ALICE_UID },
            data: Buffer.from("ALICE_CONFIDENTIAL_PHOTO_BYTES"),
            createdAt: Date.now(),
            etag: "etag-alice",
        });

        // Admin requests private download with Bearer token
        const req = new NextRequest(
            `http://localhost:3000/api/media/download?key=${encodeURIComponent(aliceKey)}`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
            }
        );

        const res = await mediaDownloadRoute(req);
        assert.equal(res.status, 200);
    });

    it("R2-018: Normal customer cannot retrieve another customer's image", async () => {
        const aliceKey = `customizations/${CUST_ALICE_UID}/alice_private.jpg`;
        _mockStorage.set(aliceKey, {
            key: aliceKey,
            contentType: "image/jpeg",
            size: 30000,
            metadata: { ownerUid: CUST_ALICE_UID },
            data: Buffer.from("ALICE_ONLY"),
            createdAt: Date.now(),
            etag: "etag-alice-2",
        });

        // Bob attempts to download Alice's private customization image
        const req = new NextRequest(
            `http://localhost:3000/api/media/download?key=${encodeURIComponent(aliceKey)}`,
            {
                headers: { Authorization: `Bearer ${bobToken}` },
            }
        );

        const res = await mediaDownloadRoute(req);
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.ok(data.error.includes("permission to access"));
    });

    it("R2-019: Public product image renders", async () => {
        const prodKey = "products/prod_100/hero_tee.webp";
        _mockStorage.set(prodKey, {
            key: prodKey,
            contentType: "image/webp",
            size: 12000,
            metadata: {},
            data: Buffer.from("PRODUCT_IMAGE_WEBP"),
            createdAt: Date.now(),
            etag: "etag-p1",
        });

        const req = new NextRequest(`http://localhost:3000/api/media/public?key=${encodeURIComponent(prodKey)}`);
        const res = await mediaPublicRoute(req);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/webp");
        assert.ok(res.headers.get("cache-control")?.includes("public"));
    });

    it("R2-020: Category image renders", async () => {
        const catKey = "categories/cat_apparel/banner.jpg";
        _mockStorage.set(catKey, {
            key: catKey,
            contentType: "image/jpeg",
            size: 18000,
            metadata: {},
            data: Buffer.from("CATEGORY_BANNER_JPEG"),
            createdAt: Date.now(),
            etag: "etag-c1",
        });

        const req = new NextRequest(`http://localhost:3000/api/media/public?key=${encodeURIComponent(catKey)}`);
        const res = await mediaPublicRoute(req);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "image/jpeg");
    });

    it("R2-021: Review image follows the intended authorization model", async () => {
        // Seed delivered order so Alice is a verified buyer of prod-hoodie-1000
        if (adminDb) {
            await adminDb.collection("orders").doc("order_alice_delivered_1").set({
                id: "order_alice_delivered_1",
                userId: CUST_ALICE_UID,
                orderStatus: "Delivered",
                paymentStatus: "PAID",
                items: [{ id: "prod-hoodie-1000", productId: "prod-hoodie-1000", name: "Synthetic Demo Hoodie", price: 1000, quantity: 1 }],
                createdAt: Date.now(),
            });
        }

        // Alice uploads review photo
        const authReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "reviews",
                subId: "prod-hoodie-1000",
                contentType: "image/jpeg",
                sizeBytes: 15000,
                originalName: "alice_review.jpg",
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const authRes = await authorizeUploadRoute(authReq);
        assert.equal(authRes.status, 200);
        const { key, publicUrl } = await authRes.json();
        assert.ok(key.startsWith(`reviews/prod-hoodie-1000/${CUST_ALICE_UID}/`));

        // Submit review with verified buyer
        const revReq = createJsonPostRequest(
            "http://localhost:3000/api/reviews/submit",
            {
                productId: "prod-hoodie-1000",
                rating: 5,
                comment: "R2 review image upload works seamlessly and securely!",
                images: [publicUrl],
                userName: "Alice Verified",
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const revRes = await submitReviewRoute(revReq);
        assert.equal(revRes.status, 201);
    });
});
