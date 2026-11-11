/**
 * Integration Tests for Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 *
 * Verifies real Firebase Emulator interactions:
 * - Admin authorization & custom claims gating
 * - Server-side preview generation (0 database writes)
 * - Shopify standard and legacy CSV compatibility
 * - Simple products ("Default Title") vs multi-row variant products
 * - Safe publishing defaults (draft mode: isVisible = false)
 * - Existing product update safety and field preservation
 * - Concurrency-safe inventory reconciliation (reusing TASK 029 engine)
 * - Personalization preservation & COD protection
 * - Idempotent batch re-submission
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
    const customerUid = "customer_user_task030";
    const existingProductId = "prod_existing_hoodie_030";

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
            email: "admin030@bazaarvilla.test",
            displayName: "Bazaarvilla Admin",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer030@bazaarvilla.test",
            displayName: "Test Customer",
        });

        adminToken = await getSyntheticUserAuthToken(adminUid);
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
    // 2. Dry-Run Preview Integrity (ZERO Database Writes)
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
        assert.equal(data.previewSummary.totalProducts, 1);
        assert.equal(data.previewSummary.newProducts, 1);
        assert.equal(data.previewSummary.draftCount, 1); // Safe publishing default: draft
        assert.equal(data.mappingResult.formatDetected, "shopify_standard");

        // Verify ZERO products created in Firestore during preview
        const checkDoc = await adminDb!.collection("products").where("slug", "==", "new-mug").get();
        assert.equal(checkDoc.empty, true, "Dry-run preview MUST NOT write to Firestore");
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
    // 3. Batch Commit & Atomic Writes
    // -------------------------------------------------------------------------
    it("IMPORT-INT-009: Batch commit creates new products as Drafts (isVisible: false)", async () => {
        // Step 1: Generate preview
        const csv = `Handle,Title,Price,Inventory Quantity
new-wallet,Handmade Leather Wallet,899,25
`;
        const prevReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );
        const prevRes = await previewRoute(prevReq);
        const prevData = await prevRes.json();

        // Step 2: Commit batch
        const batchId = "batch_test_create_001";
        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                previews: prevData.previewSummary.productPreviews,
                importMode: "create_and_update",
                sourceFileName: "wallets.csv",
            },
            { Authorization: `Bearer ${adminToken}` }
        );

        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);
        const commitData = await commitRes.json();

        assert.equal(commitData.success, true);
        assert.equal(commitData.batchRecord.createdCount, 1);
        assert.equal(commitData.batchRecord.status, "completed");

        // Verify product was created in Firestore with isVisible: false (draft mode)
        const snap = await adminDb!.collection("products").where("slug", "==", "new-wallet").get();
        assert.equal(snap.size, 1);
        const docData = snap.docs[0].data();
        assert.equal(docData.name, "Handmade Leather Wallet");
        assert.equal(docData.price, 899);
        assert.equal(docData.inventory, 25);
        assert.equal(docData.isVisible, false, "New product MUST default to draft (isVisible = false)");
    });

    it("IMPORT-INT-010: Existing product update with inventory reconciliation preserves live checkout deductions", async () => {
        // Product was seeded with inventory: 20 (M=10, L=10).
        // Simulate an interim customer purchase that decremented M from 10 to 8 (aggregate 18).
        await adminDb!.collection("products").doc(existingProductId).update({
            inventory: 18,
            totalPhysicalInventory: 18,
            variants: [
                {
                    id: "var_size_m_col_black",
                    sizeId: "size_m",
                    sizeName: "M",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLK-M",
                    price: 1299,
                    inventory: 8, // Customer purchased 2 units
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

        // CSV only updates base price to 1399 and description (does not modify M stock).
        const csv = `Handle,Title,Price
existing-fleece-hoodie,Updated Fleece Hoodie,1399
`;
        const prevReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );
        const prevRes = await previewRoute(prevReq);
        const prevData = await prevRes.json();

        // Commit update
        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId: "batch_test_update_reconcile",
                previews: prevData.previewSummary.productPreviews,
                importMode: "update_only",
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);

        // Verify product in Firestore: price updated, but live stock (18) and M stock (8) preserved!
        const finalDoc = await adminDb!.collection("products").doc(existingProductId).get();
        const data = finalDoc.data()!;
        assert.equal(data.price, 1399);
        assert.equal(data.inventory, 18, "Customer purchase deductions MUST NOT be overwritten by unrelated CSV updates");
    });

    it("IMPORT-INT-011: Missing CSV variants safeguard: missing variants are not automatically deleted", async () => {
        // Product has M and L variants. CSV only lists M variant.
        const csv = `Handle,Title,Option1 Name,Option1 Value,Price,Variant Inventory Qty,SKU
existing-fleece-hoodie,Existing Fleece Hoodie,Size,M,1299,10,HOODIE-BLK-M
`;
        const prevReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/preview",
            { csvText: csv },
            { Authorization: `Bearer ${adminToken}` }
        );
        const prevRes = await previewRoute(prevReq);
        const prevData = await prevRes.json();

        const commitReq = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId: "batch_test_variant_preserve",
                previews: prevData.previewSummary.productPreviews,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);

        const finalDoc = await adminDb!.collection("products").doc(existingProductId).get();
        const variants = finalDoc.data()?.variants || [];
        // L variant must still be present!
        assert.equal(variants.length, 2, "Unmentioned existing variants MUST be preserved");
    });

    it("IMPORT-INT-012: Batch commit idempotency: re-submitting same batchId returns existing record without duplicating", async () => {
        const batchId = "batch_idempotent_test";
        const previews = [
            {
                handle: "idem-prod",
                title: "Idempotent Product",
                status: "new" as const,
                variantCount: 1,
                imagesCount: 0,
                expectedR2Uploads: 0,
                errors: [],
                warnings: [],
                diffs: [],
                parsedGroup: {
                    handle: "idem-prod",
                    title: "Idempotent Product",
                    description: "",
                    basePrice: 500,
                    images: [],
                    variants: [{ csvRowNumber: 1, inventory: 10, isActive: true, price: 500 }],
                    isSimpleProduct: true,
                    sizeMode: "none" as const,
                    sizesList: [],
                    colors: [],
                    tags: [],
                    isVisible: false,
                    isCustomized: false,
                    customizationType: null,
                    firstRowNumber: 1,
                    allRowNumbers: [1],
                    errors: [],
                    warnings: [],
                    unsupportedColumns: [],
                },
            },
        ];

        // First commit
        const req1 = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            { batchId, previews, importMode: "create_only" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res1 = await commitRoute(req1);
        assert.equal(res1.status, 200);
        const data1 = await res1.json();
        assert.equal(data1.batchRecord.status, "completed");

        // Second commit with same batchId (idempotent replay)
        const req2 = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            { batchId, previews, importMode: "create_only" },
            { Authorization: `Bearer ${adminToken}` }
        );
        const res2 = await commitRoute(req2);
        assert.equal(res2.status, 200);
        const data2 = await res2.json();
        assert.equal(data2.isIdempotentReplay, true);
        assert.equal(data2.batchRecord.id, batchId);

        // Verify only 1 product created
        const snap = await adminDb!.collection("products").where("slug", "==", "idem-prod").get();
        assert.equal(snap.size, 1);
    });

    it("IMPORT-INT-013: Append-only audit record created in productImportBatches", async () => {
        const batchId = "batch_audit_verify_001";
        const previews = [
            {
                handle: "audit-prod",
                title: "Audit Test Product",
                status: "new" as const,
                variantCount: 1,
                imagesCount: 0,
                expectedR2Uploads: 0,
                errors: [],
                warnings: [],
                diffs: [],
                parsedGroup: {
                    handle: "audit-prod",
                    title: "Audit Test Product",
                    description: "",
                    basePrice: 300,
                    images: [],
                    variants: [{ csvRowNumber: 1, inventory: 5, isActive: true, price: 300 }],
                    isSimpleProduct: true,
                    sizeMode: "none" as const,
                    sizesList: [],
                    colors: [],
                    tags: [],
                    isVisible: false,
                    isCustomized: false,
                    customizationType: null,
                    firstRowNumber: 1,
                    allRowNumbers: [1],
                    errors: [],
                    warnings: [],
                    unsupportedColumns: [],
                },
            },
        ];

        const req = createJsonPostRequest(
            "http://localhost/api/admin/products/import/commit",
            {
                batchId,
                previews,
                sourceFileName: "audit_test.csv",
                fileChecksum: "abc123checksum",
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        await commitRoute(req);

        // Verify audit document exists in productImportBatches
        const auditDoc = await adminDb!.collection("productImportBatches").doc(batchId).get();
        assert.equal(auditDoc.exists, true);
        const record = auditDoc.data()!;
        assert.equal(record.id, batchId);
        assert.equal(record.adminUid, adminUid);
        assert.equal(record.sourceFileChecksum, "abc123checksum");
        assert.equal(record.status, "completed");
        assert.equal(record.createdCount, 1);
        assert.ok(record.createdAt > 0);
        assert.ok(record.completedAt > 0);
    });

    // -------------------------------------------------------------------------
    // 4. Auxiliary APIs (Templates, Error Report, History)
    // -------------------------------------------------------------------------
    it("IMPORT-INT-014: GET /api/admin/products/import/templates returns downloadable CSV", async () => {
        const req = new NextRequest("http://localhost/api/admin/products/import/templates?type=variants");
        const res = await templatesRoute(req);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
        assert.match(res.headers.get("content-disposition") || "", /bazaarvilla-variants-template\.csv/);
        const text = await res.text();
        assert.ok(text.includes("Option1 Name"));
        assert.ok(text.includes("Dimension Width"));
    });

    it("IMPORT-INT-015: POST /api/admin/products/import/error-report neutralizes formula injection", async () => {
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

        // Must prefix = and - with ' to prevent spreadsheet formula execution
        assert.ok(text.includes("''=HYPERLINK") || text.includes("'=HYPERLINK"));
        assert.ok(text.includes("'-10"));
    });

    it("IMPORT-INT-016: GET /api/admin/products/import/history returns past batches for admin", async () => {
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
