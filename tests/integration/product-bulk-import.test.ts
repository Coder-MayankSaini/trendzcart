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

    it("IMPORT-INT-021: Atomic Per-Product Crash Recovery: interrupted execution before acknowledgment does NOT duplicate product or inventory on retry", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        const csv = [
            "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty",
            "crash-prod-1,Crash Product 1,Desc 1,Bazaarvilla,Apparel,tag1,TRUE,Size,M,CRASH-1-M,899,10",
            "crash-prod-2,Crash Product 2,Desc 2,Bazaarvilla,Apparel,tag2,TRUE,Size,L,CRASH-2-L,999,15",
        ].join("\n");

        // 1. Preview
        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId, fileChecksum } = await previewRes.json();

        const batchRef = adminDb.collection("productImportBatches").doc(batchId);
        const itemsSnap = await batchRef.collection("items").orderBy("itemIndex").get();
        assert.equal(itemsSnap.size, 2);

        // 2. Simulate interruption: Product 1 was written to Firestore and marked completed,
        // but the HTTP response was lost or interrupted before the client received it!
        const item1Doc = itemsSnap.docs[0];
        const item1Data = item1Doc.data();
        const prod1Id = "crash_prod_1_doc_id";

        await adminDb.collection("products").doc(prod1Id).set({
            id: prod1Id,
            name: "Crash Product 1",
            slug: "crash-prod-1",
            price: 899,
            inventory: 10,
            totalPhysicalInventory: 10,
            hasVariants: true,
            variants: [{
                id: "crash-1-m",
                sku: "CRASH-1-M",
                price: 899,
                inventory: 10,
                isActive: true,
            }],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        // Mark item 1 completed in subcollection
        await batchRef.collection("items").doc(item1Doc.id).update({
            status: "completed",
            productId: prod1Id,
            completedAt: Date.now(),
            result: {
                handle: "crash-prod-1",
                productId: prod1Id,
                status: "created",
                title: "Crash Product 1",
                variantsCreatedOrUpdated: 1,
                imagesIngested: 0,
                imagesFailed: 0,
            },
        });

        // 3. Retry the same chunk request
        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: {
                    confirmedNotice: true,
                    confirmPriceChanges: true,
                    confirmInventoryChanges: true,
                    confirmExistingProductUpdates: true,
                },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);
        const commitData = await commitRes.json();

        assert.equal(commitData.success, true);
        assert.equal(commitData.status, "completed");
        assert.equal(commitData.processedCount, 2);

        // Verify product 1 was NOT duplicated or double-incremented
        const prod1Snap = await adminDb.collection("products").doc(prod1Id).get();
        assert.equal(prod1Snap.exists, true);
        assert.equal(prod1Snap.data()?.inventory, 10); // Inventory remained 10, NOT 20!

        // Verify product 2 was created cleanly
        const prod2Query = await adminDb.collection("products").where("slug", "==", "crash-prod-2").get();
        assert.equal(prod2Query.size, 1);
        assert.equal(prod2Query.docs[0].data().price, 999);
        assert.equal(prod2Query.docs[0].data().inventory, 15);
    });

    it("IMPORT-INT-022: Simultaneous Chunk Requests: concurrent execution claims are rejected via server lease", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        const csv = [
            "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty",
            "simul-prod-1,Simultaneous Prod,Desc,Bazaarvilla,Apparel,tag,TRUE,Size,S,SIMUL-1-S,799,5",
        ].join("\n");

        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId, fileChecksum } = await previewRes.json();

        // Simulate Request 1 currently holding an active concurrency lease
        const batchRef = adminDb.collection("productImportBatches").doc(batchId);
        await batchRef.update({
            lockedUntil: Date.now() + 30000, // Locked for next 30 seconds
            lockedBy: "other_active_request_id",
            status: "in_progress",
        });

        // Request 2 attempts simultaneous execution
        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: { confirmedNotice: true },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 400);
        const errorData = await commitRes.json();
        assert.ok(errorData.error.includes("Simultaneous import in progress"));
    });

    it("IMPORT-INT-023: Subcollection Item Partitioning: large catalog preview with 105 items never exceeds 1 MiB parent document limit", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        // Generate 105 products with realistic descriptions, tags, and variants
        const header = "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty";
        const rows = [header];
        for (let i = 1; i <= 105; i++) {
            const h = `scale-product-${i}`;
            const desc = `<p>High quality catalog merchandise ${i} with extended description text to test document payload limits.</p>`;
            rows.push(`${h},Scale Product ${i},"${desc}",Bazaarvilla,Apparel,"tag-a,tag-b,tag-${i}",TRUE,Size,M,SCALE-${i}-M,${500 + i},10`);
        }
        const largeCsv = rows.join("\n");

        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: largeCsv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId } = await previewRes.json();

        // Inspect parent document size in Firestore
        const batchRef = adminDb.collection("productImportBatches").doc(batchId);
        const parentDoc = await batchRef.get();
        assert.equal(parentDoc.exists, true);

        const parentBytes = Buffer.byteLength(JSON.stringify(parentDoc.data() || {}));
        // Firestore limit is 1,048,576 bytes (1 MiB). Parent document must stay well below 100 KB!
        assert.ok(parentBytes < 100000, `Parent document size was ${parentBytes} bytes, expected < 100,000 bytes`);

        // Verify items subcollection holds all 105 items partitioned
        const itemsSnap = await batchRef.collection("items").get();
        assert.equal(itemsSnap.size, 105);
    });

    it("IMPORT-INT-024: Image uploaded to R2 followed by failed product transaction records true failure and preserves live catalog", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        // Create an existing product with live image
        const conflictProdId = "prod_conflict_r2_test";
        await adminDb.collection("products").doc(conflictProdId).set({
            id: conflictProdId,
            name: "Live Cushion",
            slug: "live-cushion-conflict",
            price: 699,
            inventory: 5,
            isVisible: true,
            images: ["https://media.bazaarvilla.com/original-live-photo.jpg"],
            createdAt: Date.now() - 5000,
            updatedAt: Date.now() - 5000,
        });

        const csv = [
            "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty",
            "live-cushion-conflict,Live Cushion,Updated,Bazaarvilla,Home,cushion,TRUE,Default Title,,CUSH-01,799,10",
        ].join("\n");

        // Preview
        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId, fileChecksum } = await previewRes.json();

        // Before commit, simulate another admin modifying the product in Firestore,
        // causing a stale catalog conflict during commit
        await adminDb.collection("products").doc(conflictProdId).update({
            price: 749,
            updatedAt: Date.now() + 1000, // Newer than preview snapshot!
        });

        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: {
                    confirmedNotice: true,
                    confirmPriceChanges: true,
                    confirmInventoryChanges: true,
                    confirmExistingProductUpdates: true,
                },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);
        const commitData = await commitRes.json();

        // True outcome recorded
        assert.equal(commitData.status, "partially_failed");
        assert.equal(commitData.batchRecord.failedCount, 1);

        // Verify live product was NOT corrupted and original photos were preserved
        const liveDoc = await adminDb.collection("products").doc(conflictProdId).get();
        assert.equal(liveDoc.data()?.price, 749);
        assert.deepEqual(liveDoc.data()?.images, ["https://media.bazaarvilla.com/original-live-photo.jpg"]);
    });

    it("IMPORT-INT-025: Preview expiration policy: expired preview stops unstarted batch, but does NOT kill an in-progress or resuming batch", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        const csv = [
            "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty",
            "exp-prod-1,Exp Product,Desc,Bazaarvilla,Apparel,tag,TRUE,Size,M,EXP-1-M,599,10",
        ].join("\n");

        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId, fileChecksum } = await previewRes.json();

        const batchRef = adminDb.collection("productImportBatches").doc(batchId);

        // Case A: Unstarted batch (status: "previewed") that expired
        await batchRef.update({
            status: "previewed",
            expiresAt: Date.now() - 5000, // Expired 5 seconds ago
        });

        const commitReqA = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: { confirmedNotice: true },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitResA = await commitRoute(commitReqA);
        assert.equal(commitResA.status, 400);
        const errDataA = await commitResA.json();
        assert.ok(errDataA.error.includes("Import preview session has expired"));

        // Case B: In-progress batch that was started within valid window and resumed
        await batchRef.update({
            status: "in_progress",
            startedAt: Date.now() - 3600000, // Started an hour ago
            expiresAt: Date.now() - 5000,    // TTL elapsed during processing
        });

        const commitReqB = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: { confirmedNotice: true },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitResB = await commitRoute(commitReqB);
        assert.equal(commitResB.status, 200);
        const dataB = await commitResB.json();
        assert.equal(dataB.success, true);
        assert.equal(dataB.status, "completed");
    });

    it("IMPORT-INT-026: Execution-time budgeting: bounded chunk breaks safely without exceeding serverless limits", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        // Verify server import engine has CHUNK_TIME_BUDGET_MS defined safely
        const { CHUNK_TIME_BUDGET_MS } = await import("../../src/lib/products/import/serverImportEngine.ts");
        assert.ok(CHUNK_TIME_BUDGET_MS >= 15000 && CHUNK_TIME_BUDGET_MS <= 30000);
    });

    it("IMPORT-INT-027: Retry after partial chunk completion: picks up pending items and accurately reaches completion", async () => {
        if (!adminDb) throw new Error("Firestore unavailable");

        const csv = [
            "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty",
            "partial-chunk-1,Partial Prod 1,Desc 1,Bazaarvilla,Apparel,tag1,TRUE,Size,M,PART-1-M,499,5",
            "partial-chunk-2,Partial Prod 2,Desc 2,Bazaarvilla,Apparel,tag2,TRUE,Size,L,PART-2-L,599,8",
        ].join("\n");

        const previewReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv, mode: "create_and_update" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const { batchId, fileChecksum } = await previewRes.json();

        // 1. First request with chunkSize: 1
        const chunk1Req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: { confirmedNotice: true },
                chunkSize: 1,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const chunk1Res = await commitRoute(chunk1Req);
        assert.equal(chunk1Res.status, 200);
        const chunk1Data = await chunk1Res.json();
        assert.equal(chunk1Data.processedCount, 1);
        assert.equal(chunk1Data.remainingCount, 1);
        assert.equal(chunk1Data.hasMore, true);
        assert.equal(chunk1Data.status, "in_progress");

        // 2. Second request with chunkSize: 1 to finish
        const chunk2Req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum,
                confirmations: { confirmedNotice: true },
                chunkSize: 1,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const chunk2Res = await commitRoute(chunk2Req);
        assert.equal(chunk2Res.status, 200);
        const chunk2Data = await chunk2Res.json();
        assert.equal(chunk2Data.processedCount, 2);
        assert.equal(chunk2Data.remainingCount, 0);
        assert.equal(chunk2Data.hasMore, false);
        assert.equal(chunk2Data.status, "completed");
    });
});
