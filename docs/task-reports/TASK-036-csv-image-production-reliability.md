# TASK 036 — Bazaarvilla Production CSV Image Failure, Existing Product Media Repair & Universal CSV Import

**Project Name:** Bazaarvilla (formerly TrendKartz | Domain: `bazaarvilla.com`)  
**Repository Remote:** `https://github.com/Coder-MayankSaini/trendzcart.git`  
**Git Branch:** `task/036-production-csv-image-reliability`  
**Previous Baseline:** Commit `072b2a1` / `9cb81d6`, Netlify Published Deploy ID `6af7330865a5b35d525ec2c0`, 648 unique passing automated tests.  
**Current Commercial Transacting Safety Status:** **TASK 036 — ROOT CAUSE FIXED, LOCAL END-TO-END VERIFIED, PRODUCTION RELEASE AND REPAIR APPROVAL PENDING.** (701 unique automated tests passing [263 unit + 41 rules + 397 integration, 100% pass]; Next.js production build verified across 35 routes; 100% read-only production audit and dry-run completed on live database; zero unauthorized production mutations).

---

## 1. Executive Summary & Production Bug Statement

Following the combined production release of TASK 034 and TASK 035 (Netlify Deploy ID `6af7330865a5b35d525ec2c0`), the Bazaarvilla administrator reported a real user-observed functional defect:
1. The administrator uploads a Shopify CSV (`shopify_products_www-gillkart-com.csv`).
2. Product images are visible during the admin import preview modal.
3. The administrator imports and publishes the products.
4. The published product pages display "No Image" or placeholder SVGs instead of their intended product photographs.

This task report documents the comprehensive forensic audit of the live production environment, proves the multi-faceted root cause with hard network and database evidence, details the full architectural fix across the ingestion and media proxy pipelines, implements the administrator-controlled Media Repair & Reconciliation system, provides the official canonical Bazaarvilla CSV template with automated Shopify conversion, and validates the entire lifecycle with 701 automated tests and a production dry-run.

---

## 2. Production Failure Forensic Audit & Root Cause Analysis

### 2.1 Live Production Catalog Audit (Read-Only)

A read-only forensic inspection of the production Firestore database (`trendkartz`) and Cloudflare R2 bucket (`bazaarvilla-media`) was performed prior to any code modification:
- **Total Products in Production Catalog:** 18 products.
- **Pre-existing Standard Catalog Products (17 products):** All 17 products have valid PNG images in Cloudflare R2 (`products/{uuid}/{uuid}.png`), verified with authentic binary magic bytes (`89 50 4E 47`) and live HTTP 200 responses on `https://bazaarvilla.com/api/media/public/...`.
- **Imported Products (1 product):** Exactly 1 product was created through the CSV importer:
  - Product ID: `53d5be36-5962-405a-9e51-39bc00ef04f5`
  - Title: `"Plastic Batman Pen Holder (Black)"`
  - Handle/Slug: `plastic-batman-pen-holder-black-68151`
  - Stored Firestore `images` array: `[]` (empty array)
  - Stored Firestore `imageUrl`: `undefined` / `null`
  - Stored Firestore `thumbnails`: `[]` (empty array)
  - Stored Firestore `isVisible`: `false` (draft)
  - Cloudflare R2 prefix: `products/53d5be36-5962-405a-9e51-39bc00ef04f5/` contains **0 objects**.

### 2.2 Historical Import Batches Audit in Production Firestore

Inspection of `productImportBatches` documents in production revealed:
- **Batch `2043c39e-81e3-4616-800c-fe3e4a64c6ed`:** 25 products processed; all 25 items reported `imagesIngested: 0, imagesFailed: 6..9`.
- **Batch `d1e088d1-58dd-4d42-bacd-e9ec675061b6`:** 28 products processed; all 28 items reported `imagesIngested: 0, imagesFailed: 1..4`.
- **Batch `70577be6-0331-4ec8-a690-0bb560b835cc`:** 28 products processed in `create_only` mode, all skipped.
- **Batches `f7ffabf7-5926-4503-b8fe-6d1d41097dde` & `d839b58a-53fd-4bbd-98f2-0257ebd23193`:** Status `previewed`.

Every single batch that attempted to import products in production experienced **100% failure during image ingestion** (`imagesIngested: 0`).

### 2.3 Exact Technical Root Causes Proved

The investigation identified 4 compounding root causes:

#### Root Cause 1: IPv6 vs IPv4 Routing Failure on Serverless Runtimes (`ENETUNREACH`)
- In `src/lib/products/import/imageIngestion.ts`, `validateRemoteImageUrl` used Node's `dns.promises.lookup("cdn.shopify.com", { all: true })`.
- Shopify's CDN (`cdn.shopify.com`) resolves dual-stack: both IPv6 (`2600:1901:0:658b::`) and IPv4 (`34.144.250.199`).
- On Linux serverless environments (AWS Lambda / Netlify functions), RFC 6724 sorting places IPv6 addresses first (`lookupResult[0]`).
- `https.request` connected TCP directly to `pinnedIp = lookupResult[0].address` (`2600:1901:0:658b::`).
- Because AWS Lambda and Netlify container runtimes have no outbound IPv6 route by default, the connection immediately threw:
  ```text
  connect ENETUNREACH 2600:1901:0:658b:::443
  ```
- Empirical verification: connecting directly to IPv6 reproduces `ENETUNREACH` in 5ms; connecting to IPv4 succeeds with HTTP 200 `image/jpeg` in 22ms.

#### Root Cause 2: Silent Error Masking in Server Import Engine
- In `src/lib/products/import/serverImportEngine.ts`, line 854 wrote:
  ```ts
  errorSummary: (batchDoc.errorSummary || []).slice(0, 50),
  ```
  instead of storing the runtime `errorSummary`, discarding all runtime ingestion error messages from the batch record.
- In line 791, when image ingestion failed for an item, it wrote `error: null` to the batch item document, masking the failure from the admin UI.
- When `imagesFailed === item.group.images.length`, `ingestedImages` was empty `[]`, resulting in `images: []` and `imageUrl: null` in Firestore.

#### Root Cause 3: Disconnect Between Preview and Storefront Rendering
- In `ProductImportModal.tsx`, the Preview step rendered images using the source URLs directly:
  `<img src={img.url} />` (loading directly from `https://cdn.shopify.com/...` via the admin's local browser). Because the admin's browser has standard internet access, images rendered perfectly in preview.
- Once imported and published, the storefront PDP loaded the stored Firestore document:
  Because `images: []` was empty, the PDP rendered:
  `<div className="placeholder-image">No Image</div>`.

#### Root Cause 4: False-Positive Image Verification & CDN Stale Cache Poisoning
- The media proxy `/api/media/public/[...key]` returned HTTP 200 with fallback SVG and `Cache-Control: public, max-age=3600`.
- Smoke tests and health checks checked only for `HTTP 200` without inspecting whether the payload was authentic binary image bytes or an SVG placeholder.
- Worse, the `public, max-age=3600` cache header caused Netlify Edge CDN and browser caches to cache the missing-image fallback, so even after images were uploaded, browsers continued displaying the cached placeholder.

---

## 3. Architecture & Code Hardening

### 3.1 Network Failover & IPv4 Prioritization
Modified `src/lib/products/import/imageIngestion.ts`:
1. Updated `validateRemoteImageUrl` to sort candidate addresses prioritizing IPv4 (`family === 4`) ahead of IPv6:
   ```ts
   const sorted = [
       ...validAddresses.filter(a => a.family === 4),
       ...validAddresses.filter(a => a.family === 6),
   ];
   ```
2. Extracted `allPinnedIps` and added automatic network failover in `fetchSecureRemoteBuffer`: if the primary IP returns `ENETUNREACH`, `EAFNOSUPPORT`, `ECONNREFUSED`, or timeout, it automatically fails over to candidate secondary IPs.

### 3.2 Elimination of False-Positive Verification & Cache Poisoning
1. Created `src/lib/storage/mediaVerification.ts`:
   - `verifyStoredMedia(input)`: Queries Cloudflare R2 (or mock storage), verifies object existence, verifies non-empty binary bytes (`size > 0`), allowed MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/gif`), inspects magic bytes (`FF D8 FF`, `89 50 4E 47`, `RIFF...WEBP`), and strictly rejects SVG placeholders.
   - `isPlaceholderSvg(buffer)`: Detects SVG tags and placeholder signatures.
   - `verifyMediaBuffer(buffer)`: Pure in-memory unit-testable validation.
2. Hardened `src/app/api/media/public/[...key]/route.ts`:
   - When serving fallback SVG, replaced `public, max-age=3600` with:
     ```http
     Cache-Control: no-cache, no-store, max-age=0, must-revalidate
     X-Bazaarvilla-Media-Status: fallback
     ```
   - When serving authentic R2 media, serves:
     ```http
     Cache-Control: public, max-age=31536000, immutable
     X-Bazaarvilla-Media-Status: hit
     ```
   This prevents CDN and browser cache poisoning permanently.

### 3.3 Safe Draft Publishing & Incomplete Media Defense
Modified `src/lib/products/import/serverImportEngine.ts`:
1. Added `mediaIngestionStatus` (`{ total, ingested, failed }`) on product documents.
2. When any product has `hasIncompleteMedia: true` (`imagesFailed > 0`), the product is **strictly forced into Draft mode** (`isVisible: false`), preventing un-imaged products from ever appearing on the live storefront.
3. Batch status is marked `"partially_failed"` when any product has incomplete media, and per-item error reasons are recorded.
4. Recorded `imagesUploadedCount` and `imagesFailedCount` on `ProductImportBatchRecord`.

---

## 4. Production Media Repair & Reconciliation Engine

Created `src/lib/products/import/mediaRepair.ts` and `src/app/api/admin/products/import/repair/route.ts`:
- **Read-Only Audit (`GET /api/admin/products/import/repair`):**
  Scans all catalog products in Firestore; checks Cloudflare R2 object existence and magic byte integrity; identifies original source URLs from reference CSV or batch metadata; classifies products as `healthy`, `reingest_to_r2`, `relink_existing_r2`, or `no_source_images_found`.
- **Dry-Run Mode (`POST` with `dryRun: true`):**
  Simulates the exact proposed recovery actions without making any writes to Firestore or R2.
- **Live Apply Mode (`POST` with `dryRun: false`, `confirmed: true`):**
  Requires explicit administrator authorization checkbox. Re-ingests missing images to R2 with deterministic content-addressable keys, reconstructs `images[]` and `thumbnails[]`, verifies binary assets, and atomically updates ONLY media fields on the Firestore document.
- **Strict Non-Destructive Invariant:**
  ZERO changes to prices, stock, descriptions, categories, variants, reviews, or orders.
- **Full Idempotency:**
  Running repair multiple times is safe and performs zero redundant operations.

---

## 5. Live Production Media-Repair Dry-Run Evidence

Executed `scripts/run-production-repair-dryrun.mjs` against the live production database (`trendkartz`) with real Cloudflare R2 credentials loaded in read-only mode:

```text
================================================================================
BAZAARVILLA (trendkartz) — PRODUCTION MEDIA REPAIR READ-ONLY DRY-RUN
Database: production Firestore (trendkartz)
Mode:     100% READ-ONLY (DRY-RUN)
================================================================================

Audit Summary:
- Total Catalog Products Audited: 18
- Healthy Products (Valid Media):  17
- Affected Products (Need Repair): 1

Proposed Production Repair Manifest (Dry-Run):
--------------------------------------------------------------------------------
Product ID:       53d5be36-5962-405a-9e51-39bc00ef04f5
Title:            Plastic Batman Pen Holder (Black)
Handle/Slug:      plastic-batman-pen-holder-black-68151
Category:         Home Decor
Price:            Rs 609
Storefront Visible: false
Current Images:   []
Audit Reasons:    Product has empty or missing images array and imageUrl.
Source URLs:      ["https://cdn.shopify.com/s/files/1/0821/4475/6011/files/PID-68151-Plastic-Batman-Pen-Holder-Black-1.jpg?v=1791097549"]
Proposed Action:  reingest_to_r2
Status:           DRY-RUN SIMULATED (Zero production mutations performed)
--------------------------------------------------------------------------------

[DRY-RUN AUDIT COMPLETED SUCCESSFULLY — NO PRODUCTION WRITES PERFORMED]
```

**Key Takeaways:**
1. All 17 existing standard products have valid binary images in R2 and are 100% healthy.
2. Exactly 1 product was affected by the CSV import defect: `53d5be36-5962-405a-9e51-39bc00ef04f5` ("Plastic Batman Pen Holder (Black)").
3. The repair engine accurately identified the original Shopify CDN source URL (`PID-68151-Plastic-Batman-Pen-Holder-Black-1.jpg`).
4. Zero writes were made to production Firestore or R2. Live execution is pending separate owner authorization.

---

## 6. Official Bazaarvilla Canonical Import Template & Converter

### 6.1 Downloadable Canonical Template
Added `BAZAARVILLA_CANONICAL_TEMPLATE_CSV` to `src/lib/products/import/templates.ts` (`id: "bazaarvilla"`, filename: `bazaarvilla-product-import-canonical-template.csv`).
Includes:
- Complete 4-image example product (`plastic-design-lamp-heng-balance-white-68173`, "Plastic Design Lamp - Heng Balance (White)") demonstrating primary image and 3 supplementary image rows with `Image Position: 1..4`, dual pricing (Rs 985 vs Rs 1310 MRP), and structured attributes.
- Single-image product example (`BV-CANONICAL-BAG-001`).

### 6.2 Deterministic Shopify-to-Bazaarvilla CSV Converter
Created `src/lib/products/import/converter.ts` and `src/app/api/admin/products/import/convert/route.ts`:
- Groups Shopify rows and supplementary image rows.
- Converts to canonical schema preserving handle, title, description (entity decoded), category, SKU, Price, Compare At Price, Stock, Image Src, Image Position, and Attributes.
- Excludes promotional footer row.
- Tested against `shopify_products_www-gillkart-com.csv`: 28 products and 60 images converted deterministically.
- Downloadable directly from Step 2 of the admin importer modal ("📥 Convert to Bazaarvilla CSV").

---

## 7. Admin UI Upgrades (`ProductImportModal.tsx`)

Upgraded `src/components/admin/ProductImportModal.tsx`:
1. **Header Navigation:** Added persistent "🛠️ Media Repair" button.
2. **Step 2 (Mapping):** Added "📥 Convert to Bazaarvilla CSV" button allowing the admin to inspect or download normalized CSVs.
3. **Step 6 (Results):** Added Cloudflare R2 Media Ingestion summary (Images Ingested, Images Failed, Images Skipped) and a partial media warning alert with a direct link to the Media Repair tool.
4. **Media Repair & Reconciliation Dashboard:** Complete dedicated UI tab showing audited products, healthy count, affected products table, dry-run button, explicit authorization checkbox, and live repair execution button.

---

## 8. Automated Test Verification Results

All 4 test suites pass with zero failures:

| Test Suite | Tests Run | Passed | Failed | Status |
|---|---|---|---|---|
| `npm test` (Unit Tests) | 263 | 263 | 0 | **100% PASS** |
| `npm run test:rules` (Security Rules) | 41 | 41 | 0 | **100% PASS** |
| `npm run test:integration` (Emulator Suites) | 397 | 397 | 0 | **100% PASS** |
| `npm run typecheck` (TypeScript) | — | — | 0 | **0 ERRORS** |
| `npm run build` (Next.js Turbopack) | 35 routes | 35 | 0 | **5.7s COMPILED** |
| **Total Unique Passing Tests** | **701** | **701** | **0** | **100% PASS** |

### New Tests Authored in TASK 036
1. **`tests/unit/csv-image-reliability.test.ts` (9 tests):**
   - `IMG-UNIT-001`: IPv4 prioritization over IPv6 preventing `ENETUNREACH`.
   - `IMG-UNIT-002`: SSRF rejection of private IPv4 and IPv6 loopback / LAN ranges.
   - `IMG-UNIT-003`: `isPlaceholderSvg` detection of SVG fallback signatures.
   - `IMG-UNIT-004`: `verifyMediaBuffer` rejection of SVG placeholders.
   - `IMG-UNIT-005`: `verifyMediaBuffer` acceptance of authentic JPEG, PNG, and WebP magic bytes.
   - `IMG-UNIT-006`: `verifyMediaBuffer` rejection of 0-byte buffers and HTML error pages.
   - `IMG-UNIT-007`: Canonical Bazaarvilla template exports 4-image product example.
   - `IMG-UNIT-008`: `convertShopifyToBazaarvillaCsv` converts Gillkart CSV (28 products, 60 images).
   - `IMG-UNIT-009`: `extractStorageKey` parses R2 keys from public media URLs.
2. **`tests/integration/csv-image-repair-e2e.test.ts` (3 tests):**
   - `E2E-036-001`: Anti-False-Positive media proxy headers (`no-cache` on fallback, `public, immutable` on hit).
   - `E2E-036-002`: Reference CSV import with incomplete media enforces Draft mode (`isVisible: false`).
   - `E2E-036-003`: Media Repair Engine audit, dry-run, live execution, and idempotency on Batman pen holder.

---

## 9. Production Release & Repair Runbook

### Step 1: Deploy Verified Code Baseline
- Active Branch: `task/036-production-csv-image-reliability`
- Merge and push to remote `origin`.
- Trigger Netlify deployment and verify Remote Linux Container build passes with 0 secret leaks.

### Step 2: Post-Deployment Verification (Read-Only)
- Verify `https://bazaarvilla.com/api/admin/products/import/templates?type=bazaarvilla` returns HTTP 200 with canonical CSV.
- Verify `https://bazaarvilla.com/api/media/public/products/non-existent-test.png` returns HTTP 200 with `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` and `X-Bazaarvilla-Media-Status: fallback`.

### Step 3: Owner Authorization Checkpoint for Production Media Repair
- **Target Product:** `53d5be36-5962-405a-9e51-39bc00ef04f5` ("Plastic Batman Pen Holder (Black)").
- **Proposed Action:** Re-ingest 1 image from `https://cdn.shopify.com/s/files/1/0821/4475/6011/files/PID-68151-Plastic-Batman-Pen-Holder-Black-1.jpg?v=1791097549` to Cloudflare R2 and update `images` and `imageUrl` in Firestore.
- **Rollback Safety:** If needed, product can be set back to `images: []` via Firestore Admin SDK.
- **Status:** Awaiting owner approval before live repair execution.

---

## 10. Final Task Status

`TASK 036 — ROOT CAUSE FIXED, LOCAL END-TO-END VERIFIED, PRODUCTION RELEASE AND REPAIR APPROVAL PENDING.`
