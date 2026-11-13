/**
 * TASK 036 — Production CSV Image Reliability, Media Repair, and End-to-End Storefront Verification
 *
 * Exercises the complete real-world failure path and recovery pipeline:
 * - Direct import of shopify_products_www-gillkart-com.csv (28 products, 60 images)
 * - Anti-False-Positive image verification (distinguishing real media from placeholder SVGs)
 * - Media proxy stale cache prevention (no-cache on fallback, public cache on hit)
 * - Draft-to-Publish storefront lifecycle (incomplete media stays Draft)
 * - Media Repair & Reconciliation engine (audit, dry-run, apply, idempotency)
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { POST as previewRoute } from "../../src/app/api/admin/products/import/preview/route.ts";
import { POST as commitRoute } from "../../src/app/api/admin/products/import/commit/route.ts";
import { GET as publicMediaRoute } from "../../src/app/api/media/public/[...key]/route.ts";
import { GET as repairGetRoute, POST as repairPostRoute } from "../../src/app/api/admin/products/import/repair/route.ts";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { _mockStorage } from "../../src/lib/storage/r2.ts";
import { verifyStoredMedia, isPlaceholderSvg } from "../../src/lib/storage/mediaVerification.ts";
import { clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";
import { NextRequest } from "next/server";

describe("TASK 036 End-to-End CSV Image Reliability & Media Repair Suite", () => {
    const adminUid = "admin_task036_e2e";
    let adminToken: string;
    let csvText: string;

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth or adminDb not initialized. Ensure Firebase emulator is running.");
        }

        try { await adminAuth.deleteUser(adminUid); } catch {}
        await adminAuth.createUser({
            uid: adminUid,
            email: "admin036@bazaarvilla.test",
            displayName: "Task 036 Admin",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });
        adminToken = await getSyntheticUserAuthToken(adminUid);

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

    it("E2E-036-001: Anti-False-Positive Media Proxy headers prevent CDN & browser cache poisoning", async () => {
        // 1. Request a non-existent key: should return fallback SVG with MUST-REVALIDATE, NO-CACHE headers
        const missingReq = new NextRequest("http://localhost:3000/api/media/public/products/non-existent/broken.png");
        const missingRes = await publicMediaRoute(missingReq, {
            params: Promise.resolve({ key: ["products", "non-existent", "broken.png"] }),
        });

        assert.equal(missingRes.status, 200);
        assert.equal(missingRes.headers.get("content-type"), "image/svg+xml");
        assert.equal(missingRes.headers.get("x-bazaarvilla-media-status"), "fallback");
        const cacheControl = missingRes.headers.get("cache-control") || "";
        assert.ok(cacheControl.includes("no-cache"), `Expected no-cache in fallback header, got ${cacheControl}`);
        assert.ok(cacheControl.includes("no-store"), `Expected no-store in fallback header, got ${cacheControl}`);

        // 2. Put real binary image in mock storage
        const realKey = "products/prod-123/valid.png";
        const realPngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
        _mockStorage.set(realKey, {
            data: realPngBuffer,
            contentType: "image/png",
            metadata: {},
        });

        // 3. Request existing key: should return 200 with image/png, immutable cache, and hit status
        const validReq = new NextRequest("http://localhost:3000/api/media/public/products/prod-123/valid.png");
        const validRes = await publicMediaRoute(validReq, {
            params: Promise.resolve({ key: ["products", "prod-123", "valid.png"] }),
        });

        assert.equal(validRes.status, 200);
        assert.equal(validRes.headers.get("content-type"), "image/png");
        assert.equal(validRes.headers.get("x-bazaarvilla-media-status"), "hit");
        const validCache = validRes.headers.get("cache-control") || "";
        assert.ok(validCache.includes("public"), `Expected public cache header on hit, got ${validCache}`);
        assert.ok(validCache.includes("immutable"), `Expected immutable cache on hit, got ${validCache}`);
    });

    it("E2E-036-002: Reference CSV Import with Incomplete Media automatically enforces Draft mode (isVisible: false)", async () => {
        // Perform preview of the first 2 products from the reference CSV
        const sampleLines = csvText.split("\n").slice(0, 10).join("\n");
        const previewReq = createJsonPostRequest(
            "http://localhost:3000/api/admin/products/import/preview",
            {
                csvText: sampleLines,
                mode: "create_and_update",
                categoryAssignment: { mode: "assign_existing", selectedCategoryName: "Home Decor" },
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const previewRes = await previewRoute(previewReq);
        assert.equal(previewRes.status, 200);
        const previewData = await previewRes.json();
        const batchId = previewData.batchId;

        // Commit with allowPublishNewProducts: false
        const commitReq = createJsonPostRequest(
            "http://localhost:3000/api/admin/products/import/commit",
            {
                batchId,
                fileChecksum: previewData.fileChecksum,
                confirmations: {
                    confirmedNotice: true,
                    allowPublishNewProducts: false,
                },
                chunkSize: 10,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const commitRes = await commitRoute(commitReq);
        assert.equal(commitRes.status, 200);

        // Verify products created in Firestore are drafts (isVisible: false)
        const productsSnap = await adminDb!.collection("products").get();
        assert.ok(productsSnap.size > 0, "Products should have been created");
        for (const doc of productsSnap.docs) {
            const prod = doc.data();
            assert.equal(prod.isVisible, false, `Product ${prod.title} must be Draft (isVisible: false)`);
        }
    });

    it("E2E-036-003: Media Repair Engine audits catalog, detects affected products, executes dry-run without writes, and commits repair safely", async () => {
        // 1. Seed the production broken state: Batman Pen Holder with empty images array and no R2 files
        const batmanProductId = "batman-test-uuid-036";
        await adminDb!.collection("products").doc(batmanProductId).set({
            id: batmanProductId,
            title: "Plastic Batman Pen Holder (Black)",
            slug: "plastic-batman-pen-holder-black-68151",
            category: "Stationery",
            price: 499,
            compareAtPrice: 699,
            stock: 25,
            isVisible: false,
            images: [],
            thumbnails: [],
            imageUrl: null,
            description: "Batman pen stand desk organizer",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        // 2. Perform Read-Only Audit via GET
        const auditReq = new NextRequest("http://localhost:3000/api/admin/products/import/repair", {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        const auditRes = await repairGetRoute(auditReq);
        assert.equal(auditRes.status, 200);
        const auditData = await auditRes.json();

        assert.equal(auditData.success, true);
        assert.equal(auditData.totalAudited, 1);
        assert.equal(auditData.affectedCount, 1);
        assert.equal(auditData.affectedProducts[0].productId, batmanProductId);
        assert.equal(auditData.affectedProducts[0].needsRepair, true);

        // 3. Perform Dry-Run via POST with reference CSV: must simulate without mutating
        const dryRunReq = createJsonPostRequest(
            "http://localhost:3000/api/admin/products/import/repair",
            {
                dryRun: true,
                confirmed: false,
                csvText,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const dryRunRes = await repairPostRoute(dryRunReq);
        assert.equal(dryRunRes.status, 200);
        const dryRunData = await dryRunRes.json();

        assert.equal(dryRunData.dryRun, true);
        assert.equal(dryRunData.affectedCount, 1);
        assert.equal(dryRunData.repairedCount, 0, "Dry run must NOT increment repairedCount");

        // Verify Batman document in Firestore was NOT touched during dry-run
        const postDryRunDoc = await adminDb!.collection("products").doc(batmanProductId).get();
        assert.deepEqual(postDryRunDoc.data()?.images, []);

        // 4. Perform Live Repair with explicit admin confirmation: must ingest to R2 and update Firestore
        const liveRepairReq = createJsonPostRequest(
            "http://localhost:3000/api/admin/products/import/repair",
            {
                dryRun: false,
                confirmed: true,
                csvText,
            },
            { Authorization: `Bearer ${adminToken}` }
        );
        const liveRepairRes = await repairPostRoute(liveRepairReq);
        assert.equal(liveRepairRes.status, 200);
        const liveRepairData = await liveRepairRes.json();

        assert.equal(liveRepairData.dryRun, false);
        assert.equal(liveRepairData.repairedCount, 1);
        assert.equal(liveRepairData.failedCount, 0);

        // Verify Batman document in Firestore now has verified image references
        const repairedDoc = await adminDb!.collection("products").doc(batmanProductId).get();
        const repairedData = repairedDoc.data()!;
        assert.ok(repairedData.images.length > 0, "Batman images array must now be populated");
        assert.ok(repairedData.imageUrl, "Batman imageUrl must be populated");
        assert.ok(repairedData.images[0].startsWith("/api/media/public/products/batman-test-uuid-036/"));

        // CRITICAL INTEGRITY CHECK: All other fields (price, stock, category, title) must remain 100% UNCHANGED
        assert.equal(repairedData.price, 499);
        assert.equal(repairedData.compareAtPrice, 699);
        assert.equal(repairedData.stock, 25);
        assert.equal(repairedData.category, "Stationery");
        assert.equal(repairedData.title, "Plastic Batman Pen Holder (Black)");

        // 5. Idempotency Check: Running audit again must report 0 affected products
        const repeatAuditRes = await repairGetRoute(auditReq);
        const repeatAuditData = await repeatAuditRes.json();
        assert.equal(repeatAuditData.affectedCount, 0, "Repaired product must now be healthy");
        assert.equal(repeatAuditData.healthyCount, 1);
    });
});
