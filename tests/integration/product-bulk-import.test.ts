/**
 * Integration Tests for Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 *
 * Verifies real Firebase Emulator interactions:
 * - Admin authorization & custom claims gating
 * - Server-side preview generation (0 database writes)
 * - Server-authoritative preview binding (anti-tampering & anti-manipulation)
 * - Checksum matching and preview expiration
 * - Explicit confirmation checkpoints (price, stock, existing updates)
 * - Shopify standard and legacy CSV compatibility
 * - Simple products ("Default Title") vs multi-row variant products
 * - Safe publishing defaults (draft mode: isVisible = false)
 * - Existing product update safety, stale conflict detection, and field preservation
 * - Concurrency-safe inventory reconciliation (reusing TASK 029 engine)
 * - Catalog-wide duplicate SKU detection
 * - Bounded chunked execution & interrupted batch resumption (Netlify timeout resilience)
 * - End-to-end idempotent batch re-submission
 * - Append-only audit records in productImportBatches
 * - Error report formula injection neutralization
 * - Templates and history APIs
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { POST as previewRoute } from "../../src/app/api/admin/products/import/preview/route.ts";
import { POST as commitRoute } from "../../src/app/api/admin/products/import/commit/route.ts";
import { GET as templatesRoute } from "../../src/app/api/admin/products/import/templates/route.ts";
import { GET as historyRoute } from "../../src/app/api/admin/products/import/history/route.ts";
import { POST as errorReportRoute } from "../../src/app/api/admin/products/import/error-report/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";
import { NextRequest } from "next/server";

describe("Shopify-Compatible CSV Bulk Product Import Integration Tests (TASK 030)", () => {
    const adminUid = "admin_user_task030";
    const otherAdminUid = "other_admin_task030";
    const customerUid = "customer_user_task030";
    const existingProductId = "prod_existing_hoodie_030";

    let adminToken: string;
    let otherAdminToken: string;
    let customerToken: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized. Ensure Firebase emulator is running.");
        }

        // Setup test users in Auth Emulator
        for (const uid of [adminUid, otherAdminUid, customerUid]) {
            try { await adminAuth.deleteUser(uid); } catch {}
        }

        await adminAuth.createUser({
            uid: adminUid,
            email: "admin030@bazaarvilla.test",
            displayName: "Bazaarvilla Admin",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        await adminAuth.createUser({
            uid: otherAdminUid,
            email: "otheradmin030@bazaarvilla.test",
            displayName: "Other Admin",
        });
        await adminAuth.setCustomUserClaims(otherAdminUid, { admin: true });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer030@bazaarvilla.test",
            displayName: "Test Customer",
        });

        adminToken = await getSyntheticUserAuthToken(adminUid);
        otherAdminToken = await getSyntheticUserAuthToken(otherAdminUid);
        customerToken = await getSyntheticUserAuthToken(customerUid);
    });

    beforeEach(async () => {
        if (!adminDb) return;

        await clearCollection(adminDb, "products");
        await clearCollection(adminDb, "productImportBatches");

        // Seed an existing product in Firestore
        await adminDb.collection("products").doc(existingProductId).set({
            id: existingProductId,
            name: "Existing Fleece Hoodie",
            slug: "existing-fleece-hoodie",
            description: "<p>Original warm fleece hoodie.</p>",
            price: 1299,
            inventory: 20,
            totalPhysicalInventory: 20,
            isVisible: true,
            isCustomized: true,
            customizationType: "requires_name", // Personalized -> Prepaid only
            hasVariants: true,
            sizeMode: "apparel",
            sizesList: [
                { id: "size_m", name: "M", isActive: true },
                { id: "size_l", name: "L", isActive: true },
            ],
            colors: [
                { id: "col_black", name: "Black", isActive: true },
            ],
            variants: [
                {
                    id: "var_size_m_col_black",
                    sizeId: "size_m",
                    sizeName: "M",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLK-M",
                    price: 1299,
                    inventory: 10,
                    isActive: true,
                    createdAt: 1000,
                },
                {
                    id: "var_size_l_col_black",
                    sizeId: "size_l",
                    sizeName: "L",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLK-L",
                    price: 1299,
                    inventory: 10,
                    isActive: true,
                    createdAt: 1000,
                },
            ],
            images: ["/api/media/public/products/hoodie-front.jpg"],
            thumbnails: ["/api/media/public/products/hoodie-front.jpg"],
            createdAt: 1000,
            updatedAt: 1000,
        });
    });

    // -------------------------------------------------------------------------
    // 1. Authorization & Claims Enforcement
    // -------------------------------------------------------------------------
    it("IMPORT-INT-001: Unauthenticated requests to /api/admin/products/import/preview must return HTTP 401", async () => {
        const req = createJsonPostRequest("http://localhost/api/admin/products/import/preview", {
            csvText: "Handle,Title,Price\ntest-tee,Test Tee,499",
        });
        const res = await previewRoute(req);
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.match(data.error, /unauthorized|missing/i);
    });

    it("IMPORT-INT-002: Customer requests (without admin custom claim) must return HTTP 401", async () => {
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: "Handle,Title,Price\ntest-tee,Test Tee,499" },
            { Authorization: `Bearer ${customerToken}` }
        );
        const res = await previewRoute(req);
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.match(data.error, /forbidden|lacks administrative/i);
    });

    // -------------------------------------------------------------------------
    // 2. Dry-Run Preview Integrity (ZERO Database Writes & Server Persistence)
    // -------------------------------------------------------------------------
    it("IMPORT-INT-003: Authorized admin preview with Shopify standard CSV performs ZERO database writes", async () => {
        const csv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant Price,Variant Inventory Qty,Image Src
new-mug,"Artisanal Ceramic Mug","<p>Handcrafted mug.</p>",Bazaarvilla,Kitchen,"mug, ceramic",false,Title,Default Title,349,50,https://example.com/mug.jpg
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.success, true);
        assert.ok(data.batchId);
        assert.ok(data.fileChecksum);
        assert.equal(data.previewSummary.totalProducts, 1);
        assert.equal(data.previewSummary.newProducts, 1);
        assert.equal(data.previewSummary.draftCount, 1); // Safe publishing default: draft
        assert.equal(data.mappingResult.formatDetected, "shopify_standard");

        // Verify ZERO products created in products collection during preview
        const checkDoc = await adminDb!.collection("products").where("slug", "==", "new-mug").get();
        assert.equal(checkDoc.empty, true, "Dry-run preview MUST NOT write to products collection");

        // Verify authoritative preview session persisted in productImportBatches
        const batchDoc = await adminDb!.collection("productImportBatches").doc(data.batchId).get();
        assert.equal(batchDoc.exists, true);
        assert.equal(batchDoc.data()?.status, "previewed");
        assert.equal(batchDoc.data()?.sourceFileChecksum, data.fileChecksum);
    });

    it("IMPORT-INT-004: Simple product with 'Default Title' does not create bogus size options", async () => {
        const csv = `Handle,Title,Price,Option1 Name,Option1 Value,SKU
canvas-bag,Canvas Tote Bag,499,Title,Default Title,BAG-01
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        const prod = data.previewSummary.productPreviews[0];

        assert.equal(prod.parsedGroup.isSimpleProduct, true);
        assert.equal(prod.parsedGroup.sizeMode, "none");
        assert.equal(prod.parsedGroup.sizesList.length, 0);
    });

    it("IMPORT-INT-005: Existing product detection by handle computes field diffs and detects changes", async () => {
        const csv = `Handle,Title,Price,Variant Inventory Qty
existing-fleece-hoodie,Existing Fleece Hoodie,1499,30
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.previewSummary.existingProducts, 1);
        const preview = data.previewSummary.productPreviews[0];
        assert.equal(preview.status, "existing_update");
        assert.equal(preview.existingProductId, existingProductId);

        // Price change: 1299 -> 1499
        assert.deepEqual(preview.priceChange, { from: 1299, to: 1499 });

        // Inventory adjustment: 20 -> 30 (delta +10)
        assert.deepEqual(preview.inventoryChange, { from: 20, to: 30, sellableDelta: 10 });
    });

    it("IMPORT-INT-006: Personalization preservation: omitting customization columns preserves existing setting", async () => {
        const csv = `Handle,Title,Price
existing-fleece-hoodie,Existing Fleece Hoodie,1299
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        const preview = data.previewSummary.productPreviews[0];

        // Should warn that personalization is preserved rather than wiping it
        const customWarn = preview.warnings.find((w: any) => w.field === "customizationType");
        assert.ok(customWarn);
        assert.match(customWarn.message, /Existing personalization settings will be safely preserved/i);
    });

    it("IMPORT-INT-007: Third Shopify option incompatibility returns fatal error in preview", async () => {
        const csv = `Handle,Title,Price,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value
jacket,Winter Jacket,2999,Size,M,Color,Black,Material,Leather
jacket,,,Size,M,Color,Black,Material,Down
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.previewSummary.invalidProducts, 1);
        assert.equal(data.previewSummary.canProceedWithImport, false);
        const fatalErr = data.previewSummary.productPreviews[0].errors.find((e: any) => e.field === "option3");
        assert.ok(fatalErr);
        assert.match(fatalErr.message, /3rd independent attribute/i);
    });

    it("IMPORT-INT-008: Invalid price (<= 0) is flagged as fatal error", async () => {
        const csv = `Handle,Title,Price
free-stuff,Freebie,-50
`;
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await previewRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.previewSummary.canProceedWithImport, false);
        const priceErr = data.previewSummary.productPreviews[0].errors.find((e: any) => e.field === "price");
        assert.ok(priceErr);
        assert.match(priceErr.message, /Invalid price '-50'/i);
    });

    // -------------------------------------------------------------------------
    // 3. Server-Side Preview Binding & Anti-Tampering Hardening
    // -------------------------------------------------------------------------
    it("IMPORT-INT-009: Server strictly rejects commit with manipulated/mismatched fileChecksum", async () => {
        const csv = `Handle,Title,Price\nmug-anti-tamper,Mug,299\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Attempt commit with forged checksum
        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: "forged_checksum_12345",
                    confirmations: { confirmedNotice: true },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        assert.equal(commitRes.status, 400);
        const errData = await commitRes.json();
        assert.match(errData.error, /checksum mismatch/i);
    });

    it("IMPORT-INT-010: Server strictly rejects commit attempt by a different administrator", async () => {
        const csv = `Handle,Title,Price\nmug-cross-admin,Mug,299\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` } // Generated by adminUid
            )
        );
        const prevData = await prevRes.json();

        // Other admin attempts to commit this batch
        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: { confirmedNotice: true },
                },
                { Authorization: `Bearer ${otherAdminToken}` } // Different admin token!
            )
        );

        assert.equal(commitRes.status, 400);
        const errData = await commitRes.json();
        assert.match(errData.error, /unauthorized.*another administrator/i);
    });

    it("IMPORT-INT-011: Server strictly rejects commit of an expired preview session (> 1 hour)", async () => {
        const csv = `Handle,Title,Price\nmug-expired,Mug,299\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Manually simulate expired timestamp in Firestore
        await adminDb!.collection("productImportBatches").doc(prevData.batchId).update({
            expiresAt: Date.now() - 5000, // 5 seconds in the past
        });

        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: { confirmedNotice: true },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        assert.equal(commitRes.status, 400);
        const errData = await commitRes.json();
        assert.match(errData.error, /preview.*expired/i);
    });

    // -------------------------------------------------------------------------
    // 4. Explicit Administrator Confirmation Checkpoints
    // -------------------------------------------------------------------------
    it("IMPORT-INT-012: Explicit confirmation: unconfirmed price changes strictly block commit", async () => {
        const csv = `Handle,Title,Price\nexisting-fleece-hoodie,Existing Fleece Hoodie,1899\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();
        assert.equal(prevData.previewSummary.priceChangeCount, 1);

        // Commit without confirmPriceChanges
        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: {
                        confirmedNotice: true,
                        confirmPriceChanges: false, // OMITTED!
                        confirmInventoryChanges: true,
                        confirmExistingProductUpdates: true,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        assert.equal(commitRes.status, 400);
        const errData = await commitRes.json();
        assert.match(errData.error, /confirm price changes/i);
    });

    it("IMPORT-INT-013: Explicit confirmation: unconfirmed inventory changes strictly block commit", async () => {
        const csv = `Handle,Title,Price,Variant Inventory Qty\nexisting-fleece-hoodie,Existing Fleece Hoodie,1299,50\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();
        assert.equal(prevData.previewSummary.inventoryChangeCount, 1);

        // Commit without confirmInventoryChanges
        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: {
                        confirmedNotice: true,
                        confirmPriceChanges: true,
                        confirmInventoryChanges: false, // OMITTED!
                        confirmExistingProductUpdates: true,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        assert.equal(commitRes.status, 400);
        const errData = await commitRes.json();
        assert.match(errData.error, /confirm inventory changes/i);
    });

    // -------------------------------------------------------------------------
    // 5. Existing Product Update Safety & Stale Conflicts
    // -------------------------------------------------------------------------
    it("IMPORT-INT-014: Stale conflict detection: product modified after preview was generated aborts update", async () => {
        const csv = `Handle,Title,Price\nexisting-fleece-hoodie,Updated Hoodie,1499\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Simulate concurrent product edit in Firestore that advances updatedAt
        await adminDb!.collection("products").doc(existingProductId).update({
            updatedAt: Date.now() + 5000,
        });

        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: {
                        confirmedNotice: true,
                        confirmPriceChanges: true,
                        confirmInventoryChanges: true,
                        confirmExistingProductUpdates: true,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );

        // Commit should fail the conflicting product and mark it failed
        assert.equal(commitRes.status, 200);
        const data = await commitRes.json();
        assert.equal(data.batchRecord.failedCount, 1);
        const failedResult = data.batchRecord.results.find((r: any) => r.handle === "existing-fleece-hoodie");
        assert.ok(failedResult);
        assert.match(failedResult.error, /catalog conflict.*modified/i);
    });

    it("IMPORT-INT-015: Catalog-wide duplicate SKU against another product is rejected in preview", async () => {
        // existing-fleece-hoodie has SKU HOODIE-BLK-M
        // Attempt to create a brand new product using that same SKU!
        await adminDb!.collection("products").doc(existingProductId).update({
            sku: "HOODIE-BLK-M",
        });

        const csv = `Handle,Title,Price,SKU\nbrand-new-jacket,Brand New Jacket,1999,HOODIE-BLK-M\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        assert.equal(prevData.previewSummary.canProceedWithImport, false);
        const fatalSkuErr = prevData.previewSummary.productPreviews[0].errors.find((e: any) => e.field === "sku");
        assert.ok(fatalSkuErr);
        assert.match(fatalSkuErr.message, /already assigned to another catalog product/i);
    });

    // -------------------------------------------------------------------------
    // 6. Bounded Resumable Chunking & Idempotency
    // -------------------------------------------------------------------------
    it("IMPORT-INT-016: Bounded chunked execution processes products in slices and resumes without duplicates", async () => {
        // Create CSV with 3 products
        const csv = `Handle,Title,Price\nchunk-prod-1,Chunk Product 1,199\nchunk-prod-2,Chunk Product 2,299\nchunk-prod-3,Chunk Product 3,399\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();
        const batchId = prevData.batchId;

        // Chunk 1: process with chunkSize = 2
        const chunk1Res = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: { confirmedNotice: true },
                    chunkSize: 2,
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const chunk1Data = await chunk1Res.json();
        assert.equal(chunk1Data.success, true);
        assert.equal(chunk1Data.processedCount, 2);
        assert.equal(chunk1Data.totalProducts, 3);
        assert.equal(chunk1Data.hasMore, true);
        assert.equal(chunk1Data.status, "in_progress");

        // Chunk 2: resume and process remaining 1 product
        const chunk2Res = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: { confirmedNotice: true },
                    chunkSize: 2,
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const chunk2Data = await chunk2Res.json();
        assert.equal(chunk2Data.success, true);
        assert.equal(chunk2Data.processedCount, 3);
        assert.equal(chunk2Data.hasMore, false);
        assert.equal(chunk2Data.status, "completed");

        // Replay of completed batch returns idempotent replay without mutations
        const replayRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: { confirmedNotice: true },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const replayData = await replayRes.json();
        assert.equal(replayData.isIdempotentReplay, true);
        assert.equal(replayData.status, "completed");
    });

    // -------------------------------------------------------------------------
    // 7. Inventory Reconciliation Under Live Checkout
    // -------------------------------------------------------------------------
    it("IMPORT-INT-017: Existing product update preserves interim customer checkout deductions", async () => {
        // Product seeded with inventory: 20 (M=10, L=10).
        // Simulate interim checkout that decremented M stock from 10 to 7 (aggregate 17).
        await adminDb!.collection("products").doc(existingProductId).update({
            inventory: 17,
            totalPhysicalInventory: 17,
            variants: [
                {
                    id: "var_size_m_col_black",
                    sizeId: "size_m",
                    sizeName: "M",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLK-M",
                    price: 1299,
                    inventory: 7, // 3 units purchased by real customers
                    isActive: true,
                    createdAt: 1000,
                },
                {
                    id: "var_size_l_col_black",
                    sizeId: "size_l",
                    sizeName: "L",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLK-L",
                    price: 1299,
                    inventory: 10,
                    isActive: true,
                    createdAt: 1000,
                },
            ],
            updatedAt: 1000,
        });

        // CSV only updates base price to 1399 (does not touch stock)
        const csv = `Handle,Title,Price\nexisting-fleece-hoodie,Updated Fleece Hoodie,1399\n`;
        const prevRes = await previewRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/preview",
                { csvText: csv },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        const prevData = await prevRes.json();

        // Commit update
        const commitRes = await commitRoute(
            createJsonPostRequest(
                "http://localhost/api/admin/products/import/commit",
                {
                    batchId: prevData.batchId,
                    fileChecksum: prevData.fileChecksum,
                    confirmations: {
                        confirmedNotice: true,
                        confirmPriceChanges: true,
                        confirmInventoryChanges: true,
                        confirmExistingProductUpdates: true,
                    },
                },
                { Authorization: `Bearer ${adminToken}` }
            )
        );
        assert.equal(commitRes.status, 200);

        // Verify product in Firestore: price updated, but live stock (17) preserved!
        const finalDoc = await adminDb!.collection("products").doc(existingProductId).get();
        const data = finalDoc.data()!;
        assert.equal(data.price, 1399);
        assert.equal(data.inventory, 17, "Customer purchase deductions MUST NOT be overwritten");
    });

    // -------------------------------------------------------------------------
    // 8. Auxiliary APIs & Security
    // -------------------------------------------------------------------------
    it("IMPORT-INT-018: GET /api/admin/products/import/templates returns downloadable CSV", async () => {
        const req = new NextRequest("http://localhost/api/admin/products/import/templates?type=variants");
        const res = await templatesRoute(req);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
        assert.match(res.headers.get("content-disposition") || "", /bazaarvilla-variants-template\.csv/);
        const text = await res.text();
        assert.ok(text.includes("Option1 Name"));
        assert.ok(text.includes("Dimension Width"));
    });

    it("IMPORT-INT-019: POST /api/admin/products/import/error-report neutralizes formula injection", async () => {
        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/error-report",
            {
                errors: [
                    {
                        rowNumber: 2,
                        handle: "=HYPERLINK('http://evil.com')",
                        field: "price",
                        providedValue: "-10",
                        message: "Invalid price",
                        suggestedCorrection: "Enter positive price",
                        fatal: true,
                    },
                ],
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const res = await errorReportRoute(req);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
        const text = await res.text();

        assert.ok(text.includes("''=HYPERLINK") || text.includes("'=HYPERLINK"));
        assert.ok(text.includes("'-10"));
    });

    it("IMPORT-INT-020: GET /api/admin/products/import/history returns past batches for admin", async () => {
        const req = new NextRequest("http://localhost/api/admin/products/import/history", {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        const res = await historyRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(Array.isArray(data.batches));
    });
});
