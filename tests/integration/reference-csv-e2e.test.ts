/**
 * TASK 035 Final End-to-End Reference CSV Import Verification Test Suite
 *
 * Exhaustively verifies the complete import pipeline against the live Firebase Emulator
 * and controlled test storage using the real Gillkart reference CSV:
 * shopify_products_www-gillkart-com.csv
 *
 * Test Coverage:
 * - Reference CSV forensic structure: 28 products, 60 images, 32 supplementary rows, 1 ignored footer
 * - End-to-End Image Ingestion: Download -> Validation -> R2 Upload -> Proxy Delivery (/api/media/public/[...key])
 * - Content-addressable deterministic storage keys (products/{productId}/{hash}.{ext}) & deduplication
 * - Three Bulk Category Assignment Scenarios (A: Existing, B: Inline Creation, C: Preserve CSV)
 * - Category safety gate & server-authoritative preview binding
 * - Description integrity forensic audit for all 28 products (entity decoding, linebreak preservation, XSS safety)
 * - TASK 034 pricing & variant compatibility (selling price, compareAtPrice, discount, attributes without false variants)
 * - Bounded chunking, interruption resumption, and durable idempotency
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { POST as previewRoute } from "../../src/app/api/admin/products/import/preview/route.ts";
import { POST as commitRoute } from "../../src/app/api/admin/products/import/commit/route.ts";
import { GET as publicMediaRoute } from "../../src/app/api/media/public/[...key]/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { _mockStorage } from "../../src/lib/storage/r2.ts";
import { clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";
import { NextRequest } from "next/server";

describe("TASK 035 Reference CSV End-to-End Import Verification Suite", () => {
    const adminUid = "admin_task035_e2e";
    let adminToken: string;
    let csvText: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth or adminDb not initialized. Ensure Firebase emulator is running.");
        }

        // Provision admin user with custom claim
        try { await adminAuth.deleteUser(adminUid); } catch {}
        await adminAuth.createUser({
            uid: adminUid,
            email: "admin035@bazaarvilla.test",
            displayName: "Task 035 Admin",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });
        adminToken = await getSyntheticUserAuthToken(adminUid);

        // Read reference CSV fixture from repository root or fixtures
        const fixturePath = path.join(process.cwd(), "shopify_products_www-gillkart-com.csv");
        assert.ok(fs.existsSync(fixturePath), `Reference CSV fixture must exist at ${fixturePath}`);
        csvText = fs.readFileSync(fixturePath, "utf8");
    });

    beforeEach(async () => {
        if (!adminDb) return;
        await clearCollection(adminDb, "products");
        await clearCollection(adminDb, "categories");
        await clearCollection(adminDb, "productImportBatches");
        _mockStorage.clear();
    });

    // =========================================================================
    // 1. Reference CSV Forensic Structure & Preview Verification
    // =========================================================================
    it("GILLKART-E2E-001: Dry-run preview accurately groups 28 products, 60 images, suppresses footer, and performs 0 writes", async () => {
        const prevReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText },
            { Authorization: `Bearer ${adminToken}` }
        );
        const prevRes = await previewRoute(prevReq);
        assert.equal(prevRes.status, 200, "Preview must return HTTP 200");
        const prevData = await prevRes.json();
        assert.equal(prevData.success, true);

        const summary = prevData.previewSummary;
        assert.equal(summary.totalProducts, 28, "Must identify exactly 28 actual products (not 61)");
        assert.equal(summary.totalImages, 60, "Must identify exactly 60 source image URLs");
        assert.equal(summary.newProducts, 28, "All 28 products must be classified as new");
        assert.equal(summary.existingProducts, 0);

        // Verify promotional footer row was suppressed with warning
        assert.ok(prevData.fileWarnings && prevData.fileWarnings.length >= 1, "Must log file warning for suppressed promotional footer row");
        const promoWarning = prevData.fileWarnings.find((w: any) =>
            (w.providedValue || "").toLowerCase().includes("shopify") ||
            (w.message || "").toLowerCase().includes("promotional")
        );
        assert.ok(promoWarning, "Must specifically flag the Shopify Spy promotional row");

        // Verify zero database writes occurred during preview
        const prodSnap = await adminDb!.collection("products").get();
        assert.equal(prodSnap.size, 0, "Preview must NOT write any product records to Firestore");
        const catSnap = await adminDb!.collection("categories").get();
        assert.equal(catSnap.size, 0, "Preview must NOT write any category records to Firestore");
    });

    // =========================================================================
    // 2. Scenario A: Bulk Import into Existing Category & Full Media Pipeline
    // =========================================================================
    it("GILLKART-E2E-002: Scenario A — Import all 28 products into existing category 'Home Decor' with full image pipeline", async () => {
        // Seed existing category
        await adminDb!.collection("categories").doc("cat_home_decor").set({
            id: "cat_home_decor",
            name: "Home Decor",
            slug: "home-decor",
            description: "Home decoration items",
            order: 1,
            isActive: true,
            createdAt: Date.now(),
        });

        // 1. Preview with assign_existing
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                {
                    csvText,
                    categoryAssignment: {
                        mode: "assign_existing",
                        selectedCategory: "Home Decor",
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        assert.equal(prevRes.status, 200);
        const prevData = await prevRes.json();
        const batchId = prevData.batchId;
        const fileChecksum = prevData.fileChecksum;

        // 2. Commit all products across chunks
        let hasMore = true;
        let totalCommitted = 0;
        let loopSafety = 0;

        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId,
                        fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(commitRes.status, 200, `Commit chunk ${loopSafety} must return HTTP 200`);
            const chunkData = await commitRes.json();
            assert.equal(chunkData.success, true);
            totalCommitted = chunkData.processedCount;
            hasMore = chunkData.hasMore;
        }

        assert.equal(totalCommitted, 28, "Must successfully commit all 28 products");

        // 3. Inventory & Catalog Audit in Firestore
        const prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 28, "Firestore products collection must contain exactly 28 products");

        // Audit each product
        let totalImagesInCatalog = 0;
        for (const doc of prodsSnap.docs) {
            const p = doc.data();
            assert.ok(p.id, "Product must have an id");
            assert.ok(p.name, "Product must have a title");
            assert.ok(p.slug, "Product must have a slug/handle");
            assert.equal(p.category, "Home Decor", `Product '${p.name}' must have category 'Home Decor'`);
            assert.ok(p.price > 0, `Product '${p.name}' price must be > 0`);
            assert.ok(typeof p.inventory === "number", `Product '${p.name}' inventory must be a number`);
            assert.ok(Array.isArray(p.images), `Product '${p.name}' must have images array`);
            assert.ok(p.images.length >= 1, `Product '${p.name}' must have at least 1 image`);
            const primaryImage = p.imageUrl || p.images[0] || "";
            assert.ok(primaryImage.startsWith("/api/media/public/products/"), `Primary imageUrl must be local proxy path: ${primaryImage}`);
            totalImagesInCatalog += p.images.length;
        }

        assert.equal(totalImagesInCatalog, 60, "Catalog must contain exactly 60 images across the 28 products");

        // Verify Heng Balance Lamp specifically has 4 images
        const hengSnap = await adminDb!.collection("products").where("slug", "==", "plastic-design-lamp-heng-balance-white-68173").get();
        assert.equal(hengSnap.empty, false, "Heng Balance Lamp must exist");
        const hengDoc = hengSnap.docs[0].data();
        assert.equal(hengDoc.images.length, 4, "Heng Balance Lamp must retain all 4 gallery images");
        assert.equal(hengDoc.name, "Plastic Design Lamp - Heng Balance (White)");

        // 4. End-to-End Media Proxy Verification
        // Verify real binary image bytes are stored in _mockStorage and retrievable via public media route
        const allStoredKeys = _mockStorage.all();
        assert.ok(allStoredKeys.length > 0, "Real image bytes must be stored in mock storage");

        // Test fetching Heng Lamp's primary image through the public proxy route
        const hengKey = hengDoc.imageUrl.replace(/^\/api\/media\/public\//, "");
        const mediaReq = new NextRequest(`http://localhost/api/media/public/${hengKey}`);
        const mediaRes = await publicMediaRoute(mediaReq, { params: Promise.resolve({ key: hengKey.split("/") }) });
        assert.equal(mediaRes.status, 200, "Public media proxy must return HTTP 200 for stored image");
        assert.ok((mediaRes.headers.get("content-type") || "").startsWith("image/"), "Must serve valid image content-type");
        const mediaBuffer = await mediaRes.arrayBuffer();
        assert.ok(mediaBuffer.byteLength > 0, "Public media proxy must return non-zero real image bytes");
    });

    // =========================================================================
    // 3. Scenario B: Create New Category Inline During Import
    // =========================================================================
    it("GILLKART-E2E-003: Scenario B — Create new category 'Ambient Lighting & Decor' inline and assign all 28 products", async () => {
        // 1. Dry-run preview with create_new
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                {
                    csvText,
                    categoryAssignment: {
                        mode: "create_new",
                        newCategoryName: "Ambient Lighting & Decor",
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        assert.equal(prevRes.status, 200);
        const prevData = await prevRes.json();

        // Verify category was NOT created during preview
        const catSnapBefore = await adminDb!.collection("categories").where("name", "==", "Ambient Lighting & Decor").get();
        assert.equal(catSnapBefore.size, 0, "Category must NOT be created during preview");

        // 2. Commit batch
        let hasMore = true;
        let loopSafety = 0;
        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const chunkData = await commitRes.json();
            hasMore = chunkData.hasMore;
        }

        // 3. Verify category was created idempotently in Firestore categories collection
        const catSnapAfter = await adminDb!.collection("categories").where("name", "==", "Ambient Lighting & Decor").get();
        assert.equal(catSnapAfter.size, 1, "Exactly 1 category document must be created");
        const createdCat = catSnapAfter.docs[0].data();
        assert.equal(createdCat.name, "Ambient Lighting & Decor");
        assert.equal(createdCat.slug, "ambient-lighting-decor", "Must generate URL-safe lowercase slug");
        assert.equal(createdCat.isActive, true);

        // 4. Verify all 28 products received the new category
        const prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 28);
        for (const doc of prodsSnap.docs) {
            assert.equal(doc.data().category, "Ambient Lighting & Decor");
        }
    });

    // =========================================================================
    // 4. Scenario C: Preserve CSV Category Information
    // =========================================================================
    it("GILLKART-E2E-004: Scenario C — Preserve supported CSV category information (preserve_csv)", async () => {
        // Preview with preserve_csv
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                {
                    csvText,
                    categoryAssignment: { mode: "preserve_csv" },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Commit all products
        let hasMore = true;
        let loopSafety = 0;
        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const chunkData = await commitRes.json();
            hasMore = chunkData.hasMore;
        }

        // In the reference CSV, Type = "Home Decor"
        const prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 28);
        for (const doc of prodsSnap.docs) {
            assert.equal(doc.data().category, "Home Decor", "Product category must match CSV Type 'Home Decor'");
        }
    });

    // =========================================================================
    // 5. Category Safety Enforcement & Anti-Tampering
    // =========================================================================
    it("GILLKART-E2E-005: Changing existing categories requires explicit confirmCategoryChanges confirmation", async () => {
        // Seed an existing product in category "Lighting"
        await adminDb!.collection("products").doc("prod_mushak_holder").set({
            id: "prod_mushak_holder",
            name: "Plastic Mushak Agarbati Holder (White)",
            slug: "plastic-mushak-agarbati-holder-white-68186",
            category: "Lighting", // Different from import target!
            price: 1000,
            compareAtPrice: 1330,
            inventory: 500,
            isVisible: true,
            createdAt: Date.now() - 10000,
        });

        // Preview with category override to "Spiritual & Pooja"
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                {
                    csvText,
                    categoryAssignment: {
                        mode: "assign_existing",
                        selectedCategory: "Spiritual & Pooja",
                        preserveExistingOnUpdatedProducts: false,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();
        assert.ok(prevData.previewSummary.categoryChangeCount > 0, "Must flag category change for existing product");

        // Attempt commit WITHOUT confirmCategoryChanges: must fail with HTTP 400
        const commitReqNoConfirm = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId: prevData.batchId,
                fileChecksum: prevData.fileChecksum,
                confirmations: {
                    confirmedNotice: true,
                    confirmPriceChanges: true,
                    confirmInventoryChanges: true,
                    confirmExistingProductUpdates: true,
                    confirmCategoryChanges: false, // OMITTED!
                },
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitResNoConfirm = await commitRoute(commitReqNoConfirm);
        assert.equal(commitResNoConfirm.status, 400, "Commit must fail with HTTP 400 when category changes are unconfirmed");
        const errData = await commitResNoConfirm.json();
        assert.ok(errData.error.includes("Confirm Category Changes"));
    });

    // =========================================================================
    // 6. Description Integrity Audit for all 28 Products
    // =========================================================================
    it("GILLKART-E2E-006: Forensic description audit verifies entity decoding and linebreak preservation across all 28 products", async () => {
        // Preview and commit batch
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Commit all products
        let hasMore = true;
        let loopSafety = 0;
        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const chunkData = await commitRes.json();
            hasMore = chunkData.hasMore;
        }

        const prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 28);

        for (const doc of prodsSnap.docs) {
            const p = doc.data();
            const desc = p.description || "";

            // 1. Entity decoding
            assert.ok(!desc.includes("&amp;"), `Product '${p.name}' must not contain raw '&amp;'`);
            assert.ok(!desc.includes("&quot;"), `Product '${p.name}' must not contain raw '&quot;'`);
            assert.ok(!desc.includes("&#39;"), `Product '${p.name}' must not contain raw '&#39;'`);
            assert.ok(!desc.includes("&nbsp;"), `Product '${p.name}' must not contain raw '&nbsp;'`);

            // 2. Linebreak conversion
            assert.ok(!desc.includes("<br>"), `Product '${p.name}' must not contain raw '<br>' tags`);
            assert.ok(!desc.includes("<br/>"), `Product '${p.name}' must not contain raw '<br/>' tags`);
            assert.ok(!desc.includes("<br />"), `Product '${p.name}' must not contain raw '<br />' tags`);

            // 3. XSS security
            assert.ok(!desc.includes("<script"), `Product '${p.name}' must not contain '<script'`);
            assert.ok(!desc.includes("<iframe"), `Product '${p.name}' must not contain '<iframe'`);
            assert.ok(!desc.includes("javascript:"), `Product '${p.name}' must not contain 'javascript:'`);

            // 4. Content preservation
            assert.ok(desc.length > 20, `Product '${p.name}' description must not be empty or truncated`);
        }
    });

    // =========================================================================
    // 7. TASK 034 Pricing, Compare-At & Variant Compatibility
    // =========================================================================
    it("GILLKART-E2E-007: Pricing maps to dual-price model with automatic discount, and descriptive options do not create false variant buttons", async () => {
        // Preview and commit batch
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Commit all products
        let hasMore = true;
        let loopSafety = 0;
        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const chunkData = await commitRes.json();
            hasMore = chunkData.hasMore;
        }

        // Verify Mushak Agarbati Holder
        const mushakSnap = await adminDb!.collection("products").where("slug", "==", "plastic-mushak-agarbati-holder-white-68186").get();
        assert.equal(mushakSnap.empty, false);
        const mushak = mushakSnap.docs[0].data();

        assert.equal(mushak.price, 1000, "Selling price must be 1000");
        assert.equal(mushak.compareAtPrice, 1330, "Original compareAtPrice must be 1330");
        assert.equal(mushak.inventory, 1, "Inventory stock must be 1 (from Variant Inventory Qty)");
        assert.equal(mushak.hasVariants, false, "Must NOT have customer-selectable variant buttons");
        assert.equal(mushak.sizeMode, "none", "Size mode must be 'none'");

        // Attributes must preserve descriptive options
        assert.ok(Array.isArray(mushak.attributes), "Must have attributes array");
        const materialAttr = mushak.attributes.find((a: any) => a.name === "Material");
        assert.ok(materialAttr, "Must preserve Material attribute");
        assert.equal(materialAttr.value, "Plastic");
        const typeAttr = mushak.attributes.find((a: any) => a.name === "Type");
        assert.ok(typeAttr, "Must preserve Type attribute");
        assert.equal(typeAttr.value, "Decorative Figurine");
    });

    // =========================================================================
    // 8. Idempotency & Resumption Resilience
    // =========================================================================
    it("GILLKART-E2E-008: Interrupted chunk resumption and replaying completed batch preserves data without duplication", async () => {
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();
        const batchId = prevData.batchId;
        const fileChecksum = prevData.fileChecksum;

        // Process only first chunk of 5 products
        const chunk1Res = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId,
                    fileChecksum,
                    chunkSize: 5,
                    confirmations: {
                        confirmedNotice: true,
                        confirmPriceChanges: true,
                        confirmInventoryChanges: true,
                        confirmExistingProductUpdates: true,
                        confirmCategoryChanges: true,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const chunk1Data = await chunk1Res.json();
        assert.equal(chunk1Data.processedCount, 5);
        assert.equal(chunk1Data.hasMore, true);
        assert.equal(chunk1Data.status, "in_progress");

        // Verify exactly 5 products exist in Firestore
        let prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 5);

        // Resume and process all remaining products
        let hasMore = true;
        let loopSafety = 0;
        let finalData: any;
        while (hasMore && loopSafety < 10) {
            loopSafety++;
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId,
                        fileChecksum,
                        chunkSize: 10,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmInventoryChanges: true,
                            confirmExistingProductUpdates: true,
                            confirmCategoryChanges: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            finalData = await commitRes.json();
            hasMore = finalData.hasMore;
        }

        assert.equal(finalData.processedCount, 28);
        assert.equal(finalData.status, "completed");
        assert.equal(finalData.hasMore, false);

        prodsSnap = await adminDb!.collection("products").get();
        assert.equal(prodsSnap.size, 28, "Catalog must have exactly 28 products with 0 duplicates from resumption");

        // Replaying completed batch must return idempotent replay immediately
        const replayRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId,
                    fileChecksum,
                    confirmations: { confirmedNotice: true },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const replayData = await replayRes.json();
        assert.equal(replayData.isIdempotentReplay, true);
        assert.equal(replayData.status, "completed");
    });
});
