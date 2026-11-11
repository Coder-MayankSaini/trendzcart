# TASK 030 — Bazaarvilla Shopify-Compatible CSV Bulk Product Import & Catalog Safety

**Task ID:** TASK-030  
**Branch:** `task/030-shopify-csv-product-import`  
**Base Commit:** `b8cdf28` (`b8cdf28a23ea999278569ab65ba7cfc7b4487f3c`) / Doc Commit: `6bb49b3`  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo` / Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)  
**Previous Published Deploy ID:** [`6af40ef0b0506f233476f778`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af40ef0b0506f233476f778) (TASK 029)  
**Automated Test Baseline Before:** 466 unique automated tests (139 unit + 327 integration, including 40 security-rule tests)  
**Total Automated Tests After:** **518 unique automated tests** (174 unit + 344 integration, including 41 security-rule tests across 25 suites; 100% pass rate)  
**New Tests Added in TASK 030:** **52 new automated tests** (35 unit tests in `tests/unit/csv-product-import.test.ts` + 16 integration tests in `tests/integration/product-bulk-import.test.ts` + 1 Firestore security rule test in `tests/integration/firestore-rules.test.ts`)  
**Visual QA Coverage:** 15 high-fidelity screenshots captured across 6 standard viewports (320px, 375px, 430px, 768px, 1024px, 1440px) in `docs/screenshots/task030/`  
**Production Release Status:** **TASK 030 — LOCALLY IMPLEMENTED, PRODUCTION APPROVAL PENDING.** (Zero live production catalog mutations executed; awaiting explicit store owner authorization).

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
   - Validates all image URLs: enforces HTTPS, rejects private/internal IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.169.254, ::1, fc00::), and protects against DNS rebinding and redirect-based SSRF.
   - Inspects binary magic bytes content signatures (JPEG, PNG, WebP, GIF), strictly rejecting HTML, SVG, and executables.
   - Streaming 10MB file size limit and 10s request timeout.
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
│       ├── commit/route.ts         # Batch execution & R2 image ingestion
│       ├── error-report/route.ts   # Sanitized CSV error report export
│       ├── history/route.ts        # Admin audit batches retrieval
│       ├── preview/route.ts        # Read-only dry-run preview generation
│       └── templates/route.ts      # Downloadable RFC-4180 CSV templates
├── components/
│   └── admin/
│       ├── AdminProducts.tsx       # Integrated "Import CSV" button
│       └── ProductImportModal.tsx  # 5-step responsive import wizard
└── lib/
    ├── products/
    │   └── import/
    │       ├── dimensionsParser.ts # Bracketed, dash, 3D, and apparel parser
    │       ├── grouping.ts         # Multi-row parent/variant grouping engine
    │       ├── imageIngestion.ts   # SSRF-guarded streaming R2 image ingestion
    │       ├── mapping.ts          # Column normalization & Shopify alias dictionary
    │       ├── sanitizer.ts        # Formula injection & XSS HTML sanitizer
    │       ├── serverImportEngine.ts # Dry-run preview & transactional batch commit
    │       ├── templates.ts        # Authoritative CSV template definitions
    │       └── types.ts            # Core TypeScript interfaces & DTOs
    └── storage/
        └── r2.ts                   # Added uploadBufferToR2 for direct ingest
```

### 3.1 CSV Formula Injection & HTML Sanitization (`sanitizer.ts`)
- **Formula Injection Defense:** Spreadsheets like Microsoft Excel, Google Sheets, and LibreOffice execute formulas starting with `=`, `+`, `-`, `@`, `\t`, or `\r`. The `sanitizeCsvCellValue` and `formatSafeCsvRow` functions detect these trigger characters and prepend a safe single-quote (`'`).
- **Description HTML Sanitization:** Product descriptions commonly arrive with rich HTML formatting. The `sanitizeHtmlDescription` utility strips dangerous tags (`script`, `iframe`, `object`, `embed`, `svg`, `link`, `style`), inline event listeners (`onload`, `onerror`, `onclick`), and `javascript:` URIs while preserving safe formatting (`<p>`, `<strong>`, `<em>`, `<ul>`, `<li>`, `<h3>`, `<br>`).
- **Prototype Pollution Prevention:** Object payloads are sanitized through `sanitizeProductPayload`, discarding `__proto__`, `constructor`, and `prototype` keys and filtering against `ALLOWED_PRODUCT_IMPORT_FIELDS`.

### 3.2 Shopify Column Aliases & Third Option Guard (`mapping.ts`)
Shopify CSV column names vary across current exports and legacy themes. The mapping engine normalizes headers (trimming punctuation and collapsing whitespace) and maps known aliases:

| Canonical Field | Recognized Shopify / Bazaarvilla Headers |
|---|---|
| `handle` | `Handle`, `URL handle`, `Slug`, `Product Handle` |
| `title` | `Title`, `Product Name`, `Name` |
| `description` | `Body (HTML)`, `Description`, `Body`, `Product Description` |
| `vendor` | `Vendor`, `Brand`, `Manufacturer` |
| `category` | `Type`, `Product Type`, `Category`, `Product Category` |
| `tags` | `Tags`, `Product Tags` |
| `option1Name` | `Option1 Name`, `Option 1 Name` |
| `option1Value` | `Option1 Value`, `Option 1 Value` |
| `option2Name` | `Option2 Name`, `Option 2 Name` |
| `option2Value` | `Option2 Value`, `Option 2 Value` |
| `sku` | `Variant SKU`, `SKU` |
| `price` | `Variant Price`, `Price` |
| `inventory` | `Variant Inventory Qty`, `Variant Inventory Quantity`, `Inventory`, `Stock` |
| `imageSrc` | `Image Src`, `Product Image URL`, `Image` |
| `variantImage` | `Variant Image`, `Variant Image URL` |

- **Third Option Attribute Guard:** Shopify supports up to three variant attributes (e.g. Size, Color, Material). Bazaarvilla currently supports Size and Color. If a CSV provides `Option3 Name` / `Option3 Value`, the parser detects the third independent attribute and returns a structured fatal error (`THIRD_OPTION_NOT_SUPPORTED`), preventing data corruption or accidental attribute loss.

### 3.3 Multi-Row Product Grouping (`grouping.ts`)
Shopify CSV files represent multi-variant products across multiple lines sharing the same `Handle`. The grouping engine handles:
- **Variant Lines:** Distinct rows sharing the handle, specifying Option1/Option2 combinations, variant SKUs, prices, and inventory counts.
- **Image-Only Lines:** Additional product photos placed on secondary rows with blank titles and variant details.
- **Flexible Attribute Ordering:** Automatically detects whether Size is in Option1 and Color in Option2, or vice versa.
- **Default Title Elimination:** Standalone products with `Default Title` in Option1 are parsed as simple products with `hasVariants: false`, preventing phantom size choices on the storefront.
- **Cross-Product SKU Collision Detection:** Detects duplicate SKUs across completely different products within the file and reports them before execution.

### 3.4 Dimension & Sizing Parser (`dimensionsParser.ts`)
Reuses the authoritative variant schema from TASK 029:
- **Mode D (Named with Dimensions):** Formats such as `Large (26 × 26 cm)`, `Small — 20 × 20 cm`, and `20x20x5 cm` are extracted into numeric width, height, optional depth, and unit (`cm`, `inch`, `mm`).
- **Ambiguous Strings:** Values like `Size 26-28 with box` or `Standard Pack (3 pcs)` are preserved as custom labels or flagged as ambiguous without making unfounded assumptions.
- **Matrix Limit Safety:** Respects `MAX_VARIANT_LIMIT = 100`. Rejecting oversized matrices rather than silently truncating entries.

### 3.5 SSRF-Protected R2 Image Ingestion (`imageIngestion.ts`)
External image URLs provided in CSVs are ingested into Bazaarvilla's Cloudflare R2 bucket (`bazaarvilla-media`) with multi-layer network protection:
1. **Network Safety & SSRF Filter:** Resolves domain via DNS (`dns.promises.lookup`) and validates resolved IP against `isPrivateIp`. Rejects:
   - Loopback (`127.0.0.0/8`, `::1`)
   - RFC 1918 Private Ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - Link-Local & Cloud Metadata (`169.254.169.254`, `fe80::/10`)
   - Unique Local IPv6 (`fc00::/7`)
2. **Redirect Validation:** Follows HTTP redirects manually up to 3 hops, re-verifying DNS and destination IP at every hop to prevent redirect-based SSRF bypasses.
3. **MIME & Magic Bytes Inspection:** Reads binary signatures (`detectImageMagicBytes`) directly from incoming byte streams. Allows only:
   - JPEG (`FF D8 FF`)
   - PNG (`89 50 4E 47`)
   - WebP (`52 49 46 46 ... 57 45 42 50`)
   - GIF (`47 49 46 38`)
   Strictly rejects HTML, SVG, scripts, and executable payloads.
4. **Deduplication:** Computes SHA-256 hashes of image buffers. Reuses identical images to conserve R2 storage.
5. **Non-Destructive Failures:** Image ingestion failures report clear row-level warnings and do not overwrite or delete existing production R2 images.

---

## 4. Security Hardening & Firestore Rules

### 4.1 Security Rules Hardening (`firestore.rules`)
The audit collection `productImportBatches` stores records of all bulk import attempts, administrator identities, checksums, and execution metrics. Direct client SDK write access is strictly prohibited:

```javascript
match /productImportBatches/{batchId} {
    allow read: if isAdmin();
    allow write: if false; // Only Cloud Functions & Firebase Admin SDK can create/modify audit records
}
```

A dedicated integration test criterion (`RULE-015C`) was added to `tests/integration/firestore-rules.test.ts` to verify:
- Verified administrators can read import audit batches.
- Unauthenticated users and regular customers cannot read audit batches.
- Browser client SDKs (including admin clients) cannot create, update, or delete audit records directly.

---

## 5. Automated Verification & Quality Gates

The test suite was expanded with 52 new automated tests. All tests pass with zero failures:

### 5.1 Test Suite Summary:
```
================================================================================
BAZAARVILLA — AUTOMATED TEST SUITE EXECUTION SUMMARY
================================================================================
Unit Tests (npm test):
  - 174 / 174 passing across 28 suites (+35 new unit tests)
  - Execution duration: ~520ms

Firestore & Storage Rules Tests (npm run test:rules):
  - 41 / 41 passing (+1 new RULE-015C test)
  - Execution duration: ~10.8s

Firebase Emulator Integration Tests (npm run test:integration):
  - 344 / 344 passing across 25 suites (+17 new integration tests)
  - Execution duration: ~141.8s

TypeScript Typecheck (npm run typecheck):
  - 0 errors (tsc --noEmit)

Next.js Production Build (npm run build):
  - Compiled successfully with Turbopack in 6.0s
  - 35/35 routes compiled cleanly (including all 5 new import API routes)

TOTAL UNIQUE AUTOMATED TESTS: 518 passing (0 failures, 100% pass rate)
================================================================================
```

### 5.2 Unit Test Breakdown (`tests/unit/csv-product-import.test.ts` — 35 Tests):
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

### 5.3 Integration Test Breakdown (`tests/integration/product-bulk-import.test.ts` — 16 Tests):
- `IMPORT-INT-001`: Read-only dry run preview performs **zero production database mutations**.
- `IMPORT-INT-002`: Rejects unauthenticated requests with HTTP 401.
- `IMPORT-INT-003`: Rejects non-admin authenticated users with HTTP 403.
- `IMPORT-INT-004`: Successful creation of simple product from standard Shopify CSV row.
- `IMPORT-INT-005`: Multi-row variant product creation builds authoritative matrix, SKUs, and inventory.
- `IMPORT-INT-006`: `create_only` mode skips existing products without overwriting catalog data.
- `IMPORT-INT-007`: `update_only` mode updates existing products and skips non-existent rows.
- `IMPORT-INT-008`: Stale-preview conflict detection rejects import when product modified between preview and commit.
- `IMPORT-INT-009`: Preserves existing personalization settings when CSV update omits customization columns.
- `IMPORT-INT-010`: Concurrency-safe inventory reconciliation preserves concurrent checkout deductions.
- `IMPORT-INT-011`: Global duplicate SKU collision detection across different products.
- `IMPORT-INT-012`: Rejects oversized variant matrix exceeding `MAX_VARIANT_LIMIT = 100`.
- `IMPORT-INT-013`: Rejects unsupported third variant attribute option.
- `IMPORT-INT-014`: SSRF image ingestion protection rejects private IPs and loopback hosts.
- `IMPORT-INT-015`: Content signature magic bytes verification rejects HTML and non-image payloads.
- `IMPORT-INT-016`: Successful batch import persists durable audit record in `productImportBatches`.

---

## 6. Visual QA & Responsive Verification

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

## 7. Mandatory Release Gate & Deployment Posture

> [!CAUTION]
> **MANDATORY RELEASE GATE:**  
> In accordance with safety rules, no uploaded CSV may directly overwrite product prices, inventory, variants, or photographs without server-side validation and an explicit administrator confirmation.
>
> **Do not deploy to production. Do not modify the live catalog.**  
>
> Current Release Status:  
> **TASK 030 — LOCALLY IMPLEMENTED, PRODUCTION APPROVAL PENDING.**

### Status Summary:
- **Local Branch:** `task/030-shopify-csv-product-import`
- **All Quality Gates Passed:** 
  - `npm test`: 174 / 174 passed
  - `npm run test:rules`: 41 / 41 passed
  - `npm run test:integration`: 344 / 344 passed
  - `npm run typecheck`: 0 errors
  - `npm run build`: 35 / 35 routes compiled cleanly
- **Visual QA:** 15 high-fidelity screenshots verified in `docs/screenshots/task030/`
- **Catalog Safety:** ZERO mutations performed against live production catalog (`demo-trendkartz` emulator used exclusively).
- **Awaiting Action:** Requesting store owner review and approval prior to any production Netlify deployment.
