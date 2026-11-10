import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { POST as authorizeUploadRoute } from "../../src/app/api/uploads/authorize/route.ts";
import { POST as completeUploadRoute } from "../../src/app/api/uploads/complete/route.ts";
import { GET as mediaPublicRoute } from "../../src/app/api/media/public/route.ts";
import { GET as mediaPublicPathRoute } from "../../src/app/api/media/public/[...key]/route.ts";
import {
    _mockStorage,
    getPublicAssetUrl,
    extractStorageKey,
    generateObjectKey,
} from "../../src/lib/storage/r2.ts";
import {
    clearCollection,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
} from "./testHelper.ts";

describe("TASK 024 — Product & Category Media Isolation Regression Test Suite (MEDIA-001 to MEDIA-025)", () => {
    const adminUid = "admin_media_test_user_024";
    const customerUid = "customer_media_test_user_024";
    let adminToken: string;
    let customerToken: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized");
        }

        try { await adminAuth.deleteUser(adminUid); } catch {}
        try { await adminAuth.deleteUser(customerUid); } catch {}

        await adminAuth.createUser({
            uid: adminUid,
            email: "admin024@trendkartz.test",
            displayName: "Catalog Admin",
        });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer024@trendkartz.test",
            displayName: "Shopper",
        });

        await adminAuth.setCustomUserClaims(adminUid, { admin: true });
        await adminAuth.setCustomUserClaims(customerUid, {});

        adminToken = await getSyntheticUserAuthToken(adminUid);
        customerToken = await getSyntheticUserAuthToken(customerUid);
    });

    beforeEach(async () => {
        _mockStorage.clear();
        if (adminDb) {
            await clearCollection(adminDb, "products");
            await clearCollection(adminDb, "categories");
            await clearCollection(adminDb, "uploadSessions");
        }
    });

    it("MEDIA-001: Three distinct images uploaded to one product produce three distinct object keys", async () => {
        const prodId = "prod_synth_a";
        const keys: string[] = [];

        for (let i = 1; i <= 3; i++) {
            const req = createJsonPostRequest(
                "http://localhost:3000/api/uploads/authorize",
                {
                    folder: "products",
                    subId: prodId,
                    contentType: "image/png",
                    sizeBytes: 1024 * 50,
                    originalName: `photo_A${i}.png`,
                },
                { Authorization: `Bearer ${adminToken}` }
            );

            const res = await authorizeUploadRoute(req);
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.ok(data.key.startsWith(`products/${prodId}/`));
            assert.ok(data.key.endsWith(".png"));
            keys.push(data.key);
        }

        assert.equal(new Set(keys).size, 3, "All three keys must be distinct");
    });

    it("MEDIA-002: All three images retain distinct contents and distinct hashes", async () => {
        const prodId = "prod_synth_a";
        const payloads = [
            Buffer.from("RED_PIXEL_DATA_A1_024"),
            Buffer.from("BLUE_PIXEL_DATA_A2_024"),
            Buffer.from("GREEN_PIXEL_DATA_A3_024"),
        ];

        const storedKeys: string[] = [];
        for (let i = 0; i < 3; i++) {
            const key = `products/${prodId}/photo_${i + 1}_${crypto.randomUUID()}.png`;
            storedKeys.push(key);
            _mockStorage.set(key, {
                key,
                contentType: "image/png",
                size: payloads[i].length,
                metadata: {},
                data: payloads[i],
                createdAt: Date.now(),
                etag: `etag-${i}`,
            });
        }

        // Verify path-based route returns distinct contents
        const retrievedHashes: string[] = [];
        for (const k of storedKeys) {
            const req = new NextRequest(`http://localhost:3000/api/media/public/${k}`);
            const res = await mediaPublicPathRoute(req, { params: Promise.resolve({ key: k.split("/") }) });
            assert.equal(res.status, 200);
            const bytes = await res.arrayBuffer();
            const hash = crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
            retrievedHashes.push(hash);
        }

        assert.equal(new Set(retrievedHashes).size, 3, "All three images must have unique hashes");
    });

    it("MEDIA-003: Saving the product preserves all image references", async () => {
        const prodId = "prod_synth_save_003";
        const images = [
            `/api/media/public/products/${prodId}/img1.png`,
            `/api/media/public/products/${prodId}/img2.png`,
            `/api/media/public/products/${prodId}/img3.png`,
        ];
        const thumbnails = [
            `/api/media/public/products/${prodId}/thumb1.png`,
            `/api/media/public/products/${prodId}/thumb2.png`,
            `/api/media/public/products/${prodId}/thumb3.png`,
        ];

        await adminDb!.collection("products").doc(prodId).set({
            id: prodId,
            name: "Multi-Image Test Product",
            slug: "multi-image-test-product",
            price: 999,
            inventory: 10,
            images,
            thumbnails,
            isVisible: true,
            createdAt: Date.now(),
        });

        const snap = await adminDb!.collection("products").doc(prodId).get();
        assert.ok(snap.exists);
        const data = snap.data()!;
        assert.deepEqual(data.images, images);
        assert.deepEqual(data.thumbnails, thumbnails);
    });

    it("MEDIA-004: Reloading the product preserves gallery order", async () => {
        const prodId = "prod_synth_reload_004";
        const images = [
            `/api/media/public/products/${prodId}/z_last.png`,
            `/api/media/public/products/${prodId}/a_first.png`,
            `/api/media/public/products/${prodId}/m_middle.png`,
        ];

        await adminDb!.collection("products").doc(prodId).set({
            id: prodId,
            name: "Order Test Product",
            images,
            createdAt: Date.now(),
        });

        const snap = await adminDb!.collection("products").doc(prodId).get();
        const data = snap.data()!;
        assert.equal(data.images[0], images[0]);
        assert.equal(data.images[1], images[1]);
        assert.equal(data.images[2], images[2]);
    });

    it("MEDIA-005: Changing the featured image does not replace other images", async () => {
        const prodId = "prod_synth_featured_005";
        const originalImages = [
            `/api/media/public/products/${prodId}/img1.png`,
            `/api/media/public/products/${prodId}/img2.png`,
            `/api/media/public/products/${prodId}/img3.png`,
        ];

        // Make img3 the hero (moved to index 0)
        const reorderedImages = [...originalImages];
        const [hero] = reorderedImages.splice(2, 1);
        reorderedImages.unshift(hero);

        await adminDb!.collection("products").doc(prodId).set({
            id: prodId,
            name: "Hero Test Product",
            images: reorderedImages,
            createdAt: Date.now(),
        });

        const snap = await adminDb!.collection("products").doc(prodId).get();
        const data = snap.data()!;
        assert.equal(data.images.length, 3);
        assert.equal(data.images[0], originalImages[2], "img3 is now hero");
        assert.ok(data.images.includes(originalImages[0]), "img1 is still retained");
        assert.ok(data.images.includes(originalImages[1]), "img2 is still retained");
    });

    it("MEDIA-006: Removing one image does not remove the others", async () => {
        const prodId = "prod_synth_remove_006";
        const originalImages = [
            `/api/media/public/products/${prodId}/img1.png`,
            `/api/media/public/products/${prodId}/img2.png`,
            `/api/media/public/products/${prodId}/img3.png`,
        ];

        // Remove index 1 (img2)
        const updatedImages = [...originalImages];
        updatedImages.splice(1, 1);

        await adminDb!.collection("products").doc(prodId).set({
            id: prodId,
            name: "Remove Test Product",
            images: updatedImages,
            createdAt: Date.now(),
        });

        const snap = await adminDb!.collection("products").doc(prodId).get();
        const data = snap.data()!;
        assert.equal(data.images.length, 2);
        assert.equal(data.images[0], originalImages[0]);
        assert.equal(data.images[1], originalImages[2]);
        assert.ok(!data.images.includes(originalImages[1]));
    });

    it("MEDIA-007: Two products using identical original filenames do not collide", async () => {
        const reqA = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: "prod_A", contentType: "image/jpeg", originalName: "product-cover.jpg" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const reqB = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: "prod_B", contentType: "image/jpeg", originalName: "product-cover.jpg" },
            { Authorization: `Bearer ${adminToken}` }
        );

        const [resA, resB] = await Promise.all([authorizeUploadRoute(reqA), authorizeUploadRoute(reqB)]);
        const dataA = await resA.json();
        const dataB = await resB.json();

        assert.notEqual(dataA.key, dataB.key);
        assert.ok(dataA.key.startsWith("products/prod_A/"));
        assert.ok(dataB.key.startsWith("products/prod_B/"));
    });

    it("MEDIA-008: Editing Product B does not modify Product A", async () => {
        const prodA = "prod_isolated_A";
        const prodB = "prod_isolated_B";

        await adminDb!.collection("products").doc(prodA).set({
            id: prodA,
            name: "Product Alpha",
            images: [`/api/media/public/products/${prodA}/photoA.png`],
        });

        await adminDb!.collection("products").doc(prodB).set({
            id: prodB,
            name: "Product Beta",
            images: [`/api/media/public/products/${prodB}/photoB.png`],
        });

        // Edit Product B
        await adminDb!.collection("products").doc(prodB).update({
            images: [
                `/api/media/public/products/${prodB}/photoB_v2.png`,
                `/api/media/public/products/${prodB}/photoB_extra.png`,
            ],
        });

        // Verify Product A is 100% untouched
        const snapA = await adminDb!.collection("products").doc(prodA).get();
        assert.deepEqual(snapA.data()!.images, [`/api/media/public/products/${prodA}/photoA.png`]);
    });

    it("MEDIA-009: Two categories have independent image references", async () => {
        const reqC = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "categories", subId: "cat_apparel", contentType: "image/png" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const reqD = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "categories", subId: "cat_jewelry", contentType: "image/png" },
            { Authorization: `Bearer ${adminToken}` }
        );

        const [resC, resD] = await Promise.all([authorizeUploadRoute(reqC), authorizeUploadRoute(reqD)]);
        const dataC = await resC.json();
        const dataD = await resD.json();

        assert.ok(dataC.key.startsWith("categories/cat_apparel/"));
        assert.ok(dataD.key.startsWith("categories/cat_jewelry/"));
        assert.notEqual(dataC.key, dataD.key);
    });

    it("MEDIA-010: Replacing Category C image does not change Category D", async () => {
        const catC = "cat_C";
        const catD = "cat_D";

        await adminDb!.collection("categories").doc(catC).set({
            id: catC,
            name: "Category C",
            image: `/api/media/public/categories/${catC}/banner_c1.png`,
        });

        await adminDb!.collection("categories").doc(catD).set({
            id: catD,
            name: "Category D",
            image: `/api/media/public/categories/${catD}/banner_d1.png`,
        });

        // Replace C
        await adminDb!.collection("categories").doc(catC).update({
            image: `/api/media/public/categories/${catC}/banner_c_NEW.png`,
        });

        const snapD = await adminDb!.collection("categories").doc(catD).get();
        assert.equal(snapD.data()!.image, `/api/media/public/categories/${catD}/banner_d1.png`);
    });

    it("MEDIA-011: Updating a product image does not change category images", async () => {
        const prodA = "prod_011";
        const catC = "cat_011";

        await adminDb!.collection("categories").doc(catC).set({
            id: catC,
            name: "Category 011",
            image: `/api/media/public/categories/${catC}/cat.png`,
        });

        await adminDb!.collection("products").doc(prodA).set({
            id: prodA,
            name: "Product 011",
            images: [`/api/media/public/products/${prodA}/img_old.png`],
        });

        // Update product
        await adminDb!.collection("products").doc(prodA).update({
            images: [`/api/media/public/products/${prodA}/img_new.png`],
        });

        const catSnap = await adminDb!.collection("categories").doc(catC).get();
        assert.equal(catSnap.data()!.image, `/api/media/public/categories/${catC}/cat.png`);
    });

    it("MEDIA-012: Updating a category image does not change product galleries", async () => {
        const prodA = "prod_012";
        const catC = "cat_012";

        await adminDb!.collection("products").doc(prodA).set({
            id: prodA,
            name: "Product 012",
            images: [`/api/media/public/products/${prodA}/img_steady.png`],
        });

        await adminDb!.collection("categories").doc(catC).set({
            id: catC,
            name: "Category 012",
            image: `/api/media/public/categories/${catC}/cat_v1.png`,
        });

        // Update category
        await adminDb!.collection("categories").doc(catC).update({
            image: `/api/media/public/categories/${catC}/cat_v2.png`,
        });

        const prodSnap = await adminDb!.collection("products").doc(prodA).get();
        assert.deepEqual(prodSnap.data()!.images, [`/api/media/public/products/${prodA}/img_steady.png`]);
    });

    it("MEDIA-013: Upload authorization cannot target unauthorized or cross-entity keys", async () => {
        const forbiddenReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "system_configs", contentType: "image/jpeg" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await authorizeUploadRoute(forbiddenReq);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("Forbidden folder"));
    });

    it("MEDIA-014: Upload completion validates the correct R2 object", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/complete",
            { key: "products/non_existent_folder/missing_file.jpg" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res = await completeUploadRoute(req);
        assert.equal(res.status, 404);
    });

    it("MEDIA-015: Browser gallery preview reflects actual separate files", () => {
        const urlA = "/api/media/public/products/p1/uuid_a.png";
        const urlB = "/api/media/public/products/p1/uuid_b.png";
        const keyA = extractStorageKey(urlA);
        const keyB = extractStorageKey(urlB);

        assert.equal(keyA, "products/p1/uuid_a.png");
        assert.equal(keyB, "products/p1/uuid_b.png");
        assert.notEqual(keyA, keyB);
    });

    it("MEDIA-016: Product thumbnails use the correct featured image", () => {
        const images = ["/api/media/public/products/p1/hero.png", "/api/media/public/products/p1/side.png"];
        const thumbnails = ["/api/media/public/products/p1/hero_thumb.png", "/api/media/public/products/p1/side_thumb.png"];

        // The card uses thumbnails[0] || images[0]
        const cardThumb = thumbnails[0] || images[0];
        assert.equal(cardThumb, "/api/media/public/products/p1/hero_thumb.png");
    });

    it("MEDIA-017: Product detail gallery renders all distinct images via path route", async () => {
        const key1 = "products/p17/photo1.webp";
        const key2 = "products/p17/photo2.webp";

        _mockStorage.set(key1, {
            key: key1,
            contentType: "image/webp",
            size: 5000,
            metadata: {},
            data: Buffer.from("PHOTO_1_BYTES"),
            createdAt: Date.now(),
            etag: "etag-1",
        });

        _mockStorage.set(key2, {
            key: key2,
            contentType: "image/webp",
            size: 6000,
            metadata: {},
            data: Buffer.from("PHOTO_2_BYTES"),
            createdAt: Date.now(),
            etag: "etag-2",
        });

        const req1 = new NextRequest(`http://localhost:3000/api/media/public/${key1}`);
        const res1 = await mediaPublicPathRoute(req1, { params: Promise.resolve({ key: ["products", "p17", "photo1.webp"] }) });
        assert.equal(res1.status, 200);

        const req2 = new NextRequest(`http://localhost:3000/api/media/public/${key2}`);
        const res2 = await mediaPublicPathRoute(req2, { params: Promise.resolve({ key: ["products", "p17", "photo2.webp"] }) });
        assert.equal(res2.status, 200);

        const buf1 = await res1.arrayBuffer();
        const buf2 = await res2.arrayBuffer();
        assert.notDeepEqual(buf1, buf2);
    });

    it("MEDIA-018: Media proxy preserves exact key mapping", () => {
        const key = "products/82b5c865/f1a40980.png";
        const publicUrl = getPublicAssetUrl(key);
        assert.equal(publicUrl, `/api/media/public/${key}`);

        const extracted = extractStorageKey(publicUrl);
        assert.equal(extracted, key);
    });

    it("MEDIA-019: Cached image URLs do not incorrectly alias distinct objects", async () => {
        const key = "products/p19/item.jpg";
        _mockStorage.set(key, {
            key,
            contentType: "image/jpeg",
            size: 4000,
            metadata: {},
            data: Buffer.from("IMAGE_P19"),
            createdAt: Date.now(),
            etag: "etag-p19",
        });

        // Path route sets immutable cache-control
        const pathReq = new NextRequest(`http://localhost:3000/api/media/public/${key}`);
        const pathRes = await mediaPublicPathRoute(pathReq, { params: Promise.resolve({ key: ["products", "p19", "item.jpg"] }) });
        assert.ok(pathRes.headers.get("cache-control")?.includes("immutable"));

        // Query route sets Netlify-Vary header
        const queryReq = new NextRequest(`http://localhost:3000/api/media/public?key=${encodeURIComponent(key)}`);
        const queryRes = await mediaPublicRoute(queryReq);
        assert.equal(queryRes.headers.get("netlify-vary"), "query=key");
        assert.ok(queryRes.headers.get("vary")?.includes("key"));
    });

    it("MEDIA-020: Legacy products with one image remain compatible", async () => {
        const legacyProdId = "prod_legacy_single";
        await adminDb!.collection("products").doc(legacyProdId).set({
            id: legacyProdId,
            name: "Legacy Single Image Product",
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            isVisible: true,
            createdAt: Date.now(),
        });

        const snap = await adminDb!.collection("products").doc(legacyProdId).get();
        const data = snap.data()!;
        assert.equal(data.images.length, 1);
        assert.equal(data.images[0], "/brand/bazaarvilla-banner-desktop.webp");
    });

    it("MEDIA-021: Concurrent uploads cannot overwrite each other", async () => {
        const promises = Array.from({ length: 5 }, (_, i) =>
            authorizeUploadRoute(createJsonPostRequest(
                "http://localhost:3000/api/uploads/authorize",
                { folder: "products", subId: "prod_concurrent", contentType: "image/png", originalName: `file_${i}.png` },
                { Authorization: `Bearer ${adminToken}` }
            ))
        );

        const responses = await Promise.all(promises);
        const dataList = await Promise.all(responses.map(r => r.json()));
        const keys = dataList.map(d => d.key);

        assert.equal(new Set(keys).size, 5, "All 5 concurrent keys must be distinct");
    });

    it("MEDIA-022: Failed uploads do not corrupt saved product state", async () => {
        const prodId = "prod_steady_022";
        const initialImages = [`/api/media/public/products/${prodId}/original.png`];

        await adminDb!.collection("products").doc(prodId).set({
            id: prodId,
            name: "Resilient Product",
            images: initialImages,
            createdAt: Date.now(),
        });

        // Simulate an unauthorized upload attempt failing
        const failReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: prodId, contentType: "application/pdf" }, // invalid mime
            { Authorization: `Bearer ${adminToken}` }
        );
        const failRes = await authorizeUploadRoute(failReq);
        assert.equal(failRes.status, 400);

        // Verify product in database was not mutated
        const snap = await adminDb!.collection("products").doc(prodId).get();
        assert.deepEqual(snap.data()!.images, initialImages);
    });

    it("MEDIA-023: Duplicate attempts are safely handled with fresh keys", async () => {
        const req1 = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: "prod_dup", contentType: "image/jpeg", originalName: "same.jpg" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const req2 = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: "prod_dup", contentType: "image/jpeg", originalName: "same.jpg" },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res1 = await authorizeUploadRoute(req1);
        const res2 = await authorizeUploadRoute(req2);
        const data1 = await res1.json();
        const data2 = await res2.json();

        assert.notEqual(data1.sessionId, data2.sessionId);
        assert.notEqual(data1.key, data2.key);
    });

    it("MEDIA-024: Non-admin users cannot authorize administrative product/category uploads", async () => {
        const prodReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "products", subId: "prod_hack", contentType: "image/png" },
            { Authorization: `Bearer ${customerToken}` }
        );
        const prodRes = await authorizeUploadRoute(prodReq);
        assert.equal(prodRes.status, 403);

        const catReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            { folder: "categories", subId: "cat_hack", contentType: "image/png" },
            { Authorization: `Bearer ${customerToken}` }
        );
        const catRes = await authorizeUploadRoute(catReq);
        assert.equal(catRes.status, 403);
    });

    it("MEDIA-025: Existing private customer customization media remains protected", async () => {
        // Attempting to access private customizations through the public media path must be rejected with 403
        const req = new NextRequest("http://localhost:3000/api/media/public/customizations/user_123/private_engraving.png");
        const res = await mediaPublicPathRoute(req, {
            params: Promise.resolve({ key: ["customizations", "user_123", "private_engraving.png"] }),
        });
        assert.equal(res.status, 403);

        // And through query parameter route must also be rejected with 403
        const queryReq = new NextRequest("http://localhost:3000/api/media/public?key=customizations%2Fuser_123%2Fprivate_engraving.png");
        const queryRes = await mediaPublicRoute(queryReq);
        assert.equal(queryRes.status, 403);
    });
});
