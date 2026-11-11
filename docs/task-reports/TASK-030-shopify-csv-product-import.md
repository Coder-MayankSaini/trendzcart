# TASK 030 — Bazaarvilla Shopify-Compatible CSV Bulk Product Import & Catalog Safety

**Task ID:** TASK-030  
**Branch:** `task/030-shopify-csv-product-import`  
**Base Commit:** `b8cdf28` (`b8cdf28a23ea999278569ab65ba7cfc7b4487f3c`) / Doc Commit: `6bb49b3`  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo` / Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)  
**Previous Published Deploy ID:** [`6af40ef0b0506f233476f778`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af40ef0b0506f233476f778) (TASK 029)  
**Automated Test Baseline Before:** 466 unique automated tests (139 unit + 327 integration, including 40 security-rule tests)  
**Total Automated Tests After Hardening:** **528 unique automated tests** (180 unit + 348 integration, including 41 security-rule tests across 25 suites; 100% pass rate)  
**New Tests Added in TASK 030:** **62 new automated tests** (41 unit tests in `tests/unit/csv-product-import.test.ts` + 20 integration tests in `tests/integration/product-bulk-import.test.ts` + 1 Firestore security rule test `RULE-015C` in `tests/integration/firestore-rules.test.ts`)  
**Visual QA Coverage:** 15 high-fidelity screenshots captured across 6 standard viewports (320px, 375px, 430px, 768px, 1024px, 1440px) in `docs/screenshots/task030/`  
**Production Release Status:** **TASK 030 — HARDENED LOCALLY, PRODUCTION APPROVAL PENDING.** (Zero live production catalog mutations executed; awaiting explicit store owner release authorization).

---

## 1. Executive Summary & Architectural Scope

TASK 030 implements a professional, secure bulk product importer for the Bazaarvilla administrator dashboard (`/admin/products`). It empowers administrators to create and update entire product lines via CSV files—supporting simple standalone products, personalized merchandise (TASK 027), and complex multi-attribute size and color variants (TASK 029).

### Core Engineering Objective:
Provide full compatibility with standard and legacy Shopify CSV product exports as well as downloadable Bazaarvilla-specific templates, under a **strict catalog safety constraint**:
> **Non-Negotiable Safety Rule:** No uploaded CSV may directly overwrite product prices, inventory, variants, or photographs without server-side validation and an explicit administrator confirmation.

### Key Deliverables:
1. **Interactive Admin Wizard (`ProductImportModal.tsx`):**
   - 5-step guided import flow: 
     1. Upload CSV & Select Mode (`create_and_update`, `create_only`, `update_only`).
     2. Column Mapping & Format Detection (Auto-detect Shopify Standard, Shopify Legacy, Bazaarvilla Standard, or Custom).
     3. Dry-Run Preview (Summary banner, product cards, field-by-field diffs, zero database mutations).
     4. Explicit Confirmation (Safety checkboxes verifying price updates, inventory updates, and existing product overwrites).
     5. Execution Results & Status.
   - Dedicated Audit History view inspecting past import batches (`/api/admin/products/import/history`).
   - Downloadable Bazaarvilla-specific templates:
     - Standard Product CSV Template
     - Size/Color Variant CSV Template
     - Personalized Merchandise CSV Template
   - Mobile and desktop responsive design down to 320px ultra-compact viewports.
2. **Shopify CSV Compatibility & Multi-Row Grouping (`mapping.ts`, `grouping.ts`):**
   - Supports multi-row parent/variant grouping keyed by normalized `Handle` / slug.
   - Handles image-only rows, variant-specific images, and repeated parent fields omitted from subsequent rows.
   - Robust column alias mapping covering standard Shopify headers (`Handle`, `Title`, `Body (HTML)`, `Option1 Name`, `Option1 Value`, `Variant SKU`, `Variant Price`, `Variant Inventory Qty`, `Image Src`, etc.).
   - Explicit unsupported column reporting (e.g. `Cost per item`, `Variant Grams`, `Google Shopping / Google Product Category`) with clear non-import explanations.
   - Detects 3rd variant option incompatibilities (Bazaarvilla supports Size + Color) and requires explicit resolution rather than discarding or corrupting attributes.
   - "Default Title" simple products handled cleanly without generating redundant visible size buttons.
3. **TASK 029 Variant & Dimension Integration (`dimensionsParser.ts`):**
   - Seamlessly converts Shopify dimension strings (e.g., `Large (26 × 26 cm)`, `Small — 20 × 20 cm`, `20x20x5 cm`) into structured physical dimensions (`width`, `height`, `depth`, `unit`).
   - Standard apparel sizes (XS–3XL) mapped to `apparel` mode; universal sizes to `free_size`.
   - Ambiguous dimension strings (e.g., `Size 26-28 with box`) flagged as warnings rather than guessed.
   - Enforces `MAX_VARIANT_LIMIT = 100` without silent matrix truncation.
   - Preserves stable variant identities and timestamps across updates.
4. **Personalization & COD Safeguards (TASK 027 Compliance):**
   - Supports explicit Bazaarvilla customization mappings (`requires_name`, `requires_picture`).
   - Never infers mandatory personalization solely from keywords like "custom" or "printed" in the title.
   - Preserves existing customization configuration on product updates if CSV omits customization columns.
   - Enforces the shared `isCustomizableProduct` invariant: personalized products remain prepaid-only; ordinary variants remain COD eligible.
5. **Existing Product Update Safety & Inventory Reconciliation:**
   - Matches existing products by stable Bazaarvilla document ID or normalized `handle` (never title alone).
   - Missing or blank columns in update rows preserve existing catalog values.
   - Reuses TASK 029's authoritative `reconcileProductInventoryOnSave` algorithm for inventory updates—preserving concurrent sales deductions made between preview and import.
   - Detects stale-preview conflicts (`liveUpdatedAt > previewUpdatedAt`) and requires re-validation.
6. **SSRF-Protected Cloudflare R2 Image Ingestion (`imageIngestion.ts`):**
   - Destination IP Pinning using `node:https`: resolves destination IP once, validates IP against private/loopback/cloud-metadata ranges (including IPv4-mapped IPv6), enforces Port 443, and pins the TCP socket directly to `pinnedIp:443`, eliminating TOCTOU DNS rebinding.
   - Inspects binary magic bytes content signatures (JPEG, PNG, WebP, GIF), strictly rejecting HTML, SVG, scripts, and executables.
   - Streaming 10MB file size limit with socket timeout abort.
   - Deduplicates identical images via SHA-256 content hashes, avoiding redundant R2 object storage.
   - Uploads to Cloudflare R2 under stable keys (`products/${productId}/${hash}.${ext}`) and delivers via `/api/media/public/[...key]`.
7. **Security & Formula Injection Hardening (`sanitizer.ts`):**
   - Protects against CSV formula injection (DDE/Formula injection): prefixes cell values beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` with single-quote escaping.
   - Sanitizes HTML product descriptions: strips `<script>`, `<iframe>`, `<svg>`, event handlers (`onload`, `onerror`), and `javascript:` URIs.
   - Protects against prototype pollution and enforces a strict allowlist of product fields (`ALLOWED_PRODUCT_IMPORT_FIELDS`).
   - Firestore security rules updated: `productImportBatches` collection is admin-read-only, with client SDK writes strictly prohibited (`allow write: if false;`).

---

## 2. Production Baseline & Pre-Flight Verification

Before branching or creating code changes, the live production repository, active branch, and deployed commit were verified:

| Parameter | Authoritative Value | Verification State |
|---|---|---|
| **Production Domain** | `https://bazaarvilla.com` | Verified HTTP 200 OK |
| **Netlify Project** | `trendzcartdemo` (`4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`) | Verified Active |
| **Published Deploy ID** | `6af40ef0b0506f233476f778` (TASK 029) | Verified Live |
| **Base Code Commit** | `b8cdf28a23ea999278569ab65ba7cfc7b4487f3c` | Verified |
| **Task Documentation Commit**| `6bb49b3` | Verified |
| **Target Task Branch** | `task/030-shopify-csv-product-import` | Created & Active |
| **Baseline Test Count** | 466 unique automated tests (139 unit + 327 integration) | 100% Passing Baseline |

---

## 3. Architecture & Module Design

The bulk importer architecture is partitioned into modular, highly tested functional subsystems located in `src/lib/products/import/`:

```
src/
├── app/
│   └── api/admin/products/import/
│       ├── commit/route.ts         # Resumable chunk execution & R2 image ingestion
│       ├── error-report/route.ts   # Sanitized CSV error report export
│       ├── history/route.ts        # Admin audit batches retrieval
│       ├── preview/route.ts        # Server-bound dry-run preview generation & persistence
│       └── templates/route.ts      # Downloadable RFC-4180 CSV templates
├── components/
│   └── admin/
│       ├── AdminProducts.tsx       # Integrated "Import CSV" button
│       └── ProductImportModal.tsx  # 5-step responsive import wizard with chunk progression
└── lib/
    ├── products/
    │   └── import/
    │       ├── dimensionsParser.ts # Bracketed, dash, 3D, and apparel parser
    │       ├── grouping.ts         # Multi-row parent/variant grouping engine
    │       ├── imageIngestion.ts   # Destination-IP-pinned SSRF-guarded R2 ingestion
    │       ├── mapping.ts          # Column normalization & Shopify alias dictionary
    │       ├── sanitizer.ts        # Formula injection & XSS HTML sanitizer
    │       ├── serverImportEngine.ts # Durable preview persistence & chunked execution
    │       ├── templates.ts        # Authoritative CSV template definitions
    │       ├── types.ts            # Core TypeScript interfaces & DTOs
    │       └── validation.ts       # Strict price, stock, and catalog-wide SKU validation
    └── storage/
        └── r2.ts                   # Direct R2 buffer upload support
```

---

## 4. Production Safety Audit, Review Findings & Remediation Hardening

During executive architectural review of the initial TASK 030 implementation, 7 specific catalog-safety defects and execution risks were identified. Production deployment was held pending complete remediation. The following hardening was designed, implemented, and verified:

### 4.1 Zero Trust in Client-Submitted Data (`commit/route.ts`, `serverImportEngine.ts`)
- **Vulnerability Identified:** In the initial draft, `/api/admin/products/import/commit` accepted an array of `previews` in the HTTP POST body sent from the browser. A malicious actor with admin session credentials (or compromised browser extensions) could alter product prices, stock counts, document IDs, or bypass validation by tampering with the JSON payload sent to `commit`.
- **Remediation Implemented:**
  1. Complete removal of client-submitted preview data from `commit`.
  2. During the preview phase (`/api/admin/products/import/preview`), the server parses the raw CSV, validates all products, and persists the authoritative preview session into Firestore under `productImportBatches/{batchId}` with an explicit 1-hour expiration timestamp (`expiresAt = Date.now() + 3600000`).
  3. The batch record binds:
     - `fileChecksum`: SHA-256 hash of the exact CSV contents uploaded.
     - `adminUid`: Verified Firebase UID of the requesting administrator.
     - `groups`: Authoritative parsed product groups.
     - `existingSnapshots`: Immutable snapshot of existing catalog records at preview time (`updatedAt` timestamps, prices, stocks, variants).
  4. The `commit` endpoint accepts **only** `{ batchId, fileChecksum, confirmations, chunkSize }`.
  5. The server fetches the stored batch record, cryptographically verifies that `fileChecksum` matches the stored checksum, verifies that the caller `adminUid` matches the batch creator, verifies `expiresAt > Date.now()`, and reconstructs preview diffs directly on the server. The client cannot forge or alter product data.

### 4.2 Eliminating TOCTOU DNS Rebinding via Destination IP Pinning (`imageIngestion.ts`)
- **Vulnerability Identified:** The initial pre-flight DNS check resolved hostnames with `dns.promises.lookup`, verified that the IP was public, and then executed `fetch(imageUrl)`. Because Node's native `fetch` performs its own independent DNS resolution during connection setup, an attacker using a dynamic DNS service with a 0-second TTL could return a safe public IP on the initial lookup and immediately return `127.0.0.1` or `169.254.169.254` (AWS/GCP metadata) on the subsequent connection.
- **Remediation Implemented:**
  1. Destination IP Pinning: Replaced standard `fetch` with a custom `https.request` client that connects TCP sockets directly to the pre-validated IP address (`host: pinnedIp, port: 443`).
  2. The SNI TLS handshake (`servername: urlObj.hostname`) and HTTP `Host` header are set to the target domain name. The Node runtime is physically prevented from resolving the hostname a second time.
  3. Strict IPv4-mapped IPv6 detection: Decodes IPv4 addresses embedded in IPv6 representations (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`, `0:0:0:0:0:ffff:x.x.x.x`) and subjects them to the full private/reserved IP blocklist.
  4. Port 443 strictly enforced (rejects non-standard ports `8080`, `9099`, `22`, etc.).
  5. Redirect safety: Manual redirect handler re-resolves and validates destination IPs at each redirect hop before opening any socket.
  6. Streaming 10MB chunk abort and 10s socket timeout.
  7. Content signature magic bytes verification (JPEG, PNG, WebP, GIF), strictly rejecting HTML, SVG, scripts, and executable binaries.

### 4.3 Bounded Resumable Processing & Netlify Execution Limits (`serverImportEngine.ts`)
- **Vulnerability Identified:** Netlify Functions enforce a strict synchronous execution ceiling (10 seconds by default, up to 26 seconds on paid tiers). A 100-product CSV containing 300+ variant rows and external images could exceed this limit, causing an ungraceful serverless timeout mid-batch and leaving catalog records in an inconsistent state.
- **Remediation Implemented:**
  1. Bounded chunk processing: Slices pending product groups into chunks of `chunkSize` (default: 10 products per chunk).
  2. Durable progress tracking: Tracks `processedHandles: string[]`, `processedCount: number`, and `status: "in_progress" | "completed" | "partially_failed"` in Firestore `productImportBatches/{batchId}`.
  3. Resumability: If a chunk completes or fails, progress is durably saved. Subsequent requests resume processing strictly with remaining pending handles.
  4. Wizard integration: `ProductImportModal.tsx` executes chunk calls sequentially in a loop, displaying a real-time progress bar until `hasMore: false`.
  5. Zero additional paid infrastructure: Requires no external background queues (e.g. Inngest, Celery, BullMQ, Redis, or AWS SQS), maintaining 100% zero-cost operation on standard Netlify/Firebase infrastructure.

### 4.4 Duplicate Import & Idempotency Protection (`serverImportEngine.ts`)
- **Vulnerability Identified:** Network drops after Firestore writes but before client response could trigger browser retries or manual administrator re-clicks, creating duplicate variant additions or repeated image ingestion.
- **Remediation Implemented:**
  1. Batch state machine: If a commit request references an already completed batch (`status === "completed"`), the server detects the completed state and returns `{ success: true, isIdempotentReplay: true, message: "Batch was already completed..." }` without executing any duplicate writes or inventory operations.
  2. Per-product handle deduplication: When processing chunks, handles already present in `processedHandles` are skipped immediately.
  3. Distinction between batches: Re-uploading the same CSV creates a fresh batch with a new `batchId` and requires an independent dry-run preview and explicit confirmation, preventing accidental auto-runs while allowing legitimate repeat operations.

### 4.5 Safe Publishing Defaults (`serverImportEngine.ts`, `validation.ts`)
- **Safety Invariant:**
  1. Draft by Default: All newly imported products are created with `isVisible: false` (draft status) unless explicitly set to published. New products never become visible or purchasable in the public storefront without administrator review.
  2. Preservation on Updates: Existing products retain their current `isVisible` state on update rows unless the CSV explicitly specifies a status change.
  3. Fatal Price & Stock Validation:
     - Missing, zero, or negative base prices or variant prices trigger fatal errors (`PRICE_INVALID`), preventing accidentally free products.
     - Negative stock quantities trigger fatal errors (`STOCK_NEGATIVE`).
     - Products lacking photographs produce prominent warnings.

### 4.6 Existing Catalog Safety & Explicit Confirmation Gates
- **Safety Invariants:**
  1. Server-Enforced Confirmation Flags: The commit endpoint strictly checks confirmation requirements:
     - If existing product prices will change: `confirmPriceChanges: true` is mandatory.
     - If existing product inventory will change: `confirmInventoryChanges: true` is mandatory.
     - If existing product metadata will update: `confirmExistingProductUpdates: true` is mandatory.
     Missing confirmation flags result in immediate fail-closed HTTP 400 rejection.
  2. Catalog-wide Duplicate SKU Protection: During preview generation, the server queries the live catalog for existing SKUs outside the CSV file. If a CSV row specifies a SKU already claimed by an unrelated catalog product, a fatal validation error (`SKU_COLLISION`) is raised.
  3. Stale Catalog Invalidation: If an existing product is updated in Firestore after the preview was generated (`liveUpdatedAt > snapUpdatedAt`), the commit detects the conflict and rejects the update with an error requiring a refreshed preview.
  4. Concurrent Checkout Inventory Reconciliation: Uses TASK 029's `reconcileProductInventoryOnSave` to reconcile baseline inventory against live orders, preventing the bulk importer from overwriting concurrent sales deductions.

---

## 5. Automated Verification & Quality Gates

The test suite was expanded with 62 new automated tests across unit and integration suites. All 528 tests pass with 100% success:

### 5.1 Test Suite Execution Summary:
```
================================================================================
BAZAARVILLA — COMPREHENSIVE AUTOMATED TEST SUITE SUMMARY
================================================================================
Unit Tests (npm test):
  - 180 / 180 passing across 29 suites (+41 new unit tests for TASK 030)
  - Execution duration: ~460ms

Firestore & Storage Security Rules Tests (npm run test:rules):
  - 41 / 41 passing (+1 new RULE-015C test for productImportBatches)
  - Execution duration: ~9.0s

Firebase Emulator Integration Tests (npm run test:integration):
  - 348 / 348 passing across 25 suites (+21 new integration tests for TASK 030)
  - Execution duration: ~121.8s

TypeScript Typecheck (npm run typecheck):
  - 0 errors (tsc --noEmit)

Next.js Production Build (npm run build):
  - Compiled successfully with Turbopack in 4.9s
  - 35/35 routes compiled cleanly (including all 5 import API routes)

TOTAL UNIQUE AUTOMATED TESTS: 528 passing (0 failures, 100% pass rate)
================================================================================
```

### 5.2 Unit Test Breakdown (`tests/unit/csv-product-import.test.ts` — 41 Tests):
- **CSV Formula Injection:** `CSV-001` to `CSV-004` (detects and escapes `=`, `+`, `-`, `@`, `\t`, `\r`).
- **Header Normalization & Aliases:** `CSV-005` to `CSV-008` (trims whitespace, maps Shopify aliases, detects missing required columns).
- **Format Auto-Detection:** `CSV-009` to `CSV-012` (`shopify_standard`, `shopify_legacy`, `bazaarvilla_template`, `custom`).
- **Unsupported Columns Notice:** `CSV-013` to `CSV-014` (identifies and explains unsupported commercial columns).
- **Third Option Attribute Guard:** `CSV-015` (rejects 3rd independent variant options).
- **Multi-Row Grouping & Image Lines:** `CSV-016` to `CSV-019` (groups by handle, attaches extra photo rows, eliminates `Default Title`).
- **Dimension Parsing:** `CSV-020` to `CSV-026` (bracketed dimensions, dash dimensions, 3D dimensions, apparel sizes, ambiguous strings).
- **HTML Description Sanitization:** `CSV-027` to `CSV-030` (strips scripts, iframes, inline event handlers, `javascript:` URIs).
- **Prototype Pollution Defense:** `CSV-031` (strips `__proto__`, `constructor`, `prototype`).
- **Downloadable Templates RFC 4180 Validity:** `CSV-032` to `CSV-035` (validates standard, variant, and personalized templates).
- **Safety Hardening Additions:**
  - `CSV-036`: Rejects IPv4-mapped IPv6 loopback (`::ffff:127.0.0.1`) and cloud metadata (`::ffff:169.254.169.254`).
  - `CSV-037`: Rejects non-standard ports (enforces Port 443 only).
  - `CSV-038`: Rejects products with missing, zero, or negative base prices (`PRICE_INVALID`).
  - `CSV-039`: Rejects negative variant inventory quantities (`STOCK_NEGATIVE`).
  - `CSV-040`: Multiline fields and UTF-8 BOM handled safely via PapaParse.
  - `CSV-041`: Formula injection escapes tabs (`\t`) and carriage returns (`\r`).

### 5.3 Integration Test Breakdown (`tests/integration/product-bulk-import.test.ts` — 20 Tests):
- `IMPORT-INT-001`: Read-only dry run preview performs **zero production database mutations**.
- `IMPORT-INT-002`: Rejects unauthenticated requests with HTTP 401.
- `IMPORT-INT-003`: Rejects non-admin authenticated users with HTTP 403.
- `IMPORT-INT-004`: Successful creation of simple product from standard Shopify CSV row.
- `IMPORT-INT-005`: Multi-row variant product creation builds authoritative matrix, SKUs, and inventory.
- `IMPORT-INT-006`: `create_only` mode skips existing products without overwriting catalog data.
- `IMPORT-INT-007`: `update_only` mode updates existing products and skips non-existent rows.
- `IMPORT-INT-008`: Rejects oversized variant matrix exceeding `MAX_VARIANT_LIMIT = 100`.
- `IMPORT-INT-009`: Server preview binding: rejects commit requests that send forged client product data.
- `IMPORT-INT-010`: Rejects commit requests with tampered or mismatched file checksum.
- `IMPORT-INT-011`: Cross-admin protection: rejects commit when requesting admin does not match batch creator.
- `IMPORT-INT-012`: Preview expiration: rejects commit when preview timestamp exceeds 1-hour TTL.
- `IMPORT-INT-013`: Explicit confirmation: unconfirmed inventory changes strictly block commit.
- `IMPORT-INT-014`: Explicit confirmation: unconfirmed price changes strictly block commit.
- `IMPORT-INT-015`: Stale catalog conflict: rejects commit when product modified in Firestore between preview and commit.
- `IMPORT-INT-016`: Catalog-wide SKU conflict: detects duplicate SKU claimed by an unrelated catalog product.
- `IMPORT-INT-017`: Safe publishing default: new imported products default to `isVisible: false` (draft).
- `IMPORT-INT-018`: Resumable chunk execution: processes bounded chunks and completes full import across iterations.
- `IMPORT-INT-019`: Idempotency: re-submitting an already completed batch returns idempotent replay without mutations.
- `IMPORT-INT-020`: Live checkout reconciliation: preserves concurrent checkout inventory deductions during import.

---

## 6. Netlify Serverless Execution Limits & Cost Assessment

### 6.1 Serverless Function Limits (Netlify Standard)
| Constraint | Value | System Handling |
|---|---|---|
| **Max Execution Duration** | 10s default (up to 26s on Netlify Pro) | Handled via bounded chunk processing (10 products/chunk; each chunk completes in ~1.2s). |
| **Max Memory** | 1024 MB | Handled via streaming 10MB chunk abort; PapaParse streams without buffer bloat. |
| **Max Request Body** | 6 MB payload limit | Previews parse raw CSV (typical 100-product CSV is < 100 KB); commit passes only small metadata JSON (< 1 KB). |

### 6.2 Cost & Architectural Assessment for Large Imports
- **$0 Architecture Maintained:** No paid third-party task runners, background workers, or cache databases (Inngest, Celery, BullMQ, Redis, SQS) were added.
- **Durable Firestore State:** The batch state machine in `productImportBatches` stores cursor progress (`processedHandles`), allowing standard Netlify serverless functions to process arbitrarily large catalogs without timeouts or infrastructure bills.

---

## 7. Production Rollout and Rollback Plan

### 7.1 Zero-Downtime Rollout Sequence
1. **Pre-Deployment Check:** Confirm current production baseline is live at `https://bazaarvilla.com` on deploy `6af40ef0b0506f233476f778` with zero active checkout incidents.
2. **Deploy to Netlify:** Deploy branch `task/030-shopify-csv-product-import`. Netlify creates a new atomic release container without dropping in-flight customer checkouts.
3. **Verify API Endpoints:** Perform post-deployment smoke checks:
   - `GET /api/admin/products/import/templates?type=standard` returns HTTP 200 RFC-4180 CSV.
   - `GET /api/admin/products/import/history` returns HTTP 401 for anonymous and HTTP 200 for authenticated admin.
   - Customer storefront browsing and checkout operate with zero disruption.

### 7.2 Handling Unexpected Server Interruptions Mid-Import
- If a network failure occurs during chunk execution:
  1. Products in completed chunks remain safely stored in Firestore with draft status (`isVisible: false`).
  2. The batch record in `productImportBatches/{batchId}` retains `processedHandles`.
  3. Clicking "Resume Import" or re-submitting the chunk request automatically picks up remaining pending products without duplicating previously written items.

### 7.3 Immediate Rollback Procedure
If any unexpected defect occurs post-release:
1. **Instantaneous Netlify Rollback:** In the Netlify Admin Dashboard (or via CLI `netlify deploy --prod`), re-publish Deploy ID [`6af40ef0b0506f233476f778`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af40ef0b0506f233476f778) (TASK 029 baseline). Netlify switches CDN traffic within ~5 seconds with zero server restart time.
2. **Emergency Catalog Remediation:** If any imported batch requires complete removal:
   - Query `productImportBatches/{batchId}` for `createdProductIds`.
   - Execute an administrative soft-delete or batch delete on those IDs.
   - Because all newly imported products default to `isVisible: false`, draft products are never customer-visible.

---

## 8. Visual QA & Responsive Verification

Visual QA was executed using headless Google Chrome connected via Chrome DevTools Protocol (CDP) against a locally running Next.js instance on port 3333 backed by the Firebase Emulator suite.

15 high-definition screenshots were captured and verified across 6 standard viewports:
- **320px** — Ultra-compact mobile (iPhone SE narrow)
- **375px** — Standard mobile (iPhone 12/13/14)
- **430px** — Modern large mobile (iPhone 15/16 Pro Max)
- **768px** — Tablet portrait (iPad Mini / Air)
- **1024px** — Tablet landscape / Small desktop (iPad Pro / MacBook)
- **1440px** — High-resolution desktop

### Visual QA Screenshot Evidence (`docs/screenshots/task030/`):

| Screenshot Filename | Viewport | Verification Highlights |
|---|---|---|
| `01-admin-products-catalog-with-import-csv-desktop-1440px.png` | 1440×900 | Displays "Import CSV" button in header alongside "+ Add Product" with green secondary styling. |
| `02-admin-products-catalog-tablet-768px.png` | 768×1024 | Responsive header and action buttons stack neatly without clipping. |
| `03-admin-products-catalog-mobile-375px.png` | 375×812 | Mobile header wraps "Import CSV" and "+ Add Product" buttons with 44px touch targets. |
| `04-admin-products-catalog-mobile-320px.png` | 320×568 | Ultra-compact screen verification showing zero horizontal scroll or layout overflow. |
| `05-import-modal-step1-upload-desktop-1440px.png` | 1440×900 | Step 1 Upload wizard with mode selector, drag & drop zone, and 3 downloadable template cards. |
| `06-import-modal-step1-upload-mobile-375px.png` | 375×812 | Mobile Step 1 layout with stacked template download links and touch-friendly file picker. |
| `07-import-modal-step1-upload-mobile-320px.png` | 320×568 | Ultra-compact Step 1 dropzone and guidance text wrapping cleanly within 320px width. |
| `08-import-modal-step1-mobile-430px.png` | 430×932 | Modern mobile Step 1 view displaying balanced padding and typography. |
| `09-import-modal-step1-tablet-1024px.png` | 1024×768 | Tablet Step 1 view showing 3-column template grid and modal containment. |
| `10-import-modal-step2-mapping-desktop-1440px.png` | 1440×900 | Step 2 Column Mapping & Format Detection showing "Shopify Standard" detection, mapped headers, and unsupported columns notice. |
| `11-import-modal-step3-preview-dryrun-desktop-1440px.png` | 1440×900 | Step 3 Dry-Run Preview with stats summary banner, zero-mutation guarantee, and product cards with field diffs. |
| `12-import-modal-step3-preview-mobile-375px.png` | 375×812 | Mobile Step 3 view showing stacked metric badges and collapsible product cards. |
| `13-import-modal-step3-preview-mobile-320px.png` | 320×568 | Ultra-compact Step 3 preview cards rendering without text overlap or clipping. |
| `14-import-modal-step4-confirmation-desktop-1440px.png` | 1440×900 | Step 4 Explicit Confirmation screen with safety checkboxes for catalog overwrite and inventory updates. |
| `15-import-modal-audit-history-desktop-1440px.png` | 1440×900 | Audit History view displaying past import batch records, timestamps, admin UID, and summary metrics. |

---

## 9. Mandatory Release Gate & Deployment Posture

> [!CAUTION]
> **MANDATORY RELEASE GATE:**  
> In accordance with non-negotiable safety rules:
> **Zero production deployment has been executed.**  
> **Zero live catalog mutations have been performed.**  
>
> Current Release Status:  
> **TASK 030 — HARDENED LOCALLY, PRODUCTION APPROVAL PENDING.**

### Status Summary:
- **Local Branch:** `task/030-shopify-csv-product-import`
- **All Quality Gates Passed:** 
  - `npm test`: 180 / 180 passed (0 failures)
  - `npm run test:rules`: 41 / 41 passed (0 failures)
  - `npm run test:integration`: 348 / 348 passed (0 failures)
  - `npm run typecheck`: 0 errors
  - `npm run build`: 35 / 35 routes compiled cleanly
- **Visual QA:** 15 high-fidelity screenshots verified in `docs/screenshots/task030/`
- **Catalog Safety:** ZERO mutations performed against live production catalog (`demo-trendkartz` emulator used exclusively).
- **Awaiting Action:** Requesting store owner review and approval prior to any production Netlify deployment.
