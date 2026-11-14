# TASK 037 — Bazaarvilla Winter Collection Products Availability Diagnostic & Fix Report

**Task Reference:** TASK-037  
**Branch:** `task/037-winter-collection-availability-fix`  
**Base Commit:** `017a3d1` (from `task/036-production-csv-image-reliability`)  
**Deployed Code Commit:** `fbcf2b4bfc7f7c0a26c11a107f511c4d64d3d963`  
**Netlify Published Deploy ID:** `6af82c606f3fdab0c7d814a3` (Build ID: `6af82c606f3fdab0c7d814a1`)  
**Rollback Deploy ID:** `6af784767b17f44f4b91ca75`  
**Storefront URL:** [https://bazaarvilla.com](https://bazaarvilla.com)  
**Admin Portal:** [https://bazaarvilla.com/admin](https://bazaarvilla.com/admin)  
**Production Firestore Database:** `trendkartz` (Spark plan, production isolated)  
**Final Status:** **TASK 037 — CODE DEPLOYED & VERIFIED; SIX-PRODUCT INVENTORY REPAIR AWAITING OWNER APPROVAL.**  
**Conclusion Category:** **C — Both application logic and production data require correction.**

---

## 1. Executive Summary

The store owner observed a critical production issue: **Every product in the "Winter Collection" category appeared as "Unavailable" on the customer-facing website** ([https://bazaarvilla.com](https://bazaarvilla.com)).

Through a comprehensive read-only production audit, real headless browser DevTools reproduction, code tracing, and dry-run manifest generation, the exact defect chain was diagnosed and proved:

1. **Root Cause Origin:** The store administrator created 6 apparel jacket/hoodie products in `/admin/products` on November 13, 2026. The admin checked "Enable Product Variants (Sizes & Colors)" (`hasVariants: true`), selected apparel sizes (e.g., S, M, L, XL, XXL) and input parent inventory (10, 106, 115), but did **not** click "Generate / Refresh Matrix".
2. **Admin Validation Gap:** `validateVariantConfiguration` in `src/lib/products/variants.ts` verified size name uniqueness and color hex values, but omitted a mandatory check: `if (variants.length === 0) return { isValid: false }`. The admin form submitted successfully, saving documents with `hasVariants: true`, `sizesList: [...]`, `inventory: 10/106/115`, but `variants: []` (an empty array).
3. **Storefront PDP Lockout:** On the storefront Product Detail Page (`ProductCustomizer.tsx`), the variant matching logic resolved `matchedVariant = null` because the `variants` array had zero items. When `product.hasVariants` is true and `!matchedVariant`, the component sets `isVariantDisabled = true` and `currentStock = 0`, permanently disabling both "Add to Cart" and "Buy Now" buttons with the label **"Unavailable"**.
4. **Server-Side Checkout Gate:** Furthermore, `src/lib/orders/pricing.ts` strictly rejects any checkout for products with `hasVariants === true && variants.length === 0` with error `"is configured for variants but has no valid variants configured"`.

### Technical Gates Passed & Production Code Deployed
- All application code defects have been resolved and verified with **723 unique automated tests** (279 unit, 41 security rules, 403 integration, 100% pass; zero double-counting).
- The verified application code was deployed to Netlify production via remote Linux Container build (`npx netlify deploy --remote --prod`), published under Deploy ID `6af82c606f3fdab0c7d814a3`. Secret scanning passed with 0 leaks detected across 147 files.
- Live post-deployment smoke verification confirmed 9/9 operational checks passing on `https://bazaarvilla.com`.
- **Zero Production Data Mutations:** Exactly 0 production Firestore documents were modified during deployment.
- **Truth in Availability Preserved:** The 6 affected Winter Collection products correctly continue to display "Unavailable" until their actual inventory data is repaired by the store owner, preserving checkout integrity.

---

## 2. Production Baseline Verification

Before starting:
- **Netlify Published Deploy ID:** `6af82c606f3fdab0c7d814a3` (Previous: `6af784767b17f44f4b91ca75`)
- **Published Git Commit:** `fbcf2b4bfc7f7c0a26c11a107f511c4d64d3d963`
- **Node Runtime:** Node.js v24.15.0
- **Framework:** Next.js 16.1.6 (Turbopack) with React 19.2.3
- **Branch:** `task/037-winter-collection-availability-fix` branched from commit `017a3d1`.

### Related Prior Tasks Context
- **TASK 029 (Flexible Variants & Sizing):** Established the multi-attribute variant matrix schema, variant inventory tracking, and variant-specific pricing overrides.
- **TASK 030 (Shopify CSV Bulk Import):** Handled Shopify CSV column mapping, handle grouping, and draft product creation.
- **TASK 034 (Dual Pricing):** Introduced Selling Price vs Compare-At MRP and automatic discount calculations.
- **TASK 035 (Shopify CSV Completeness):** Ingested remote Shopify CDN images into Cloudflare R2 with content-addressable SHA-256 keys.
- **TASK 036 (Production CSV Image Reliability):** Hardened serverless image ingestion against IPv6 routing failures and added media proxy cache guards.

---

## 3. Read-Only Production Audit

The audit connected directly to production Firestore project `trendkartz` using authenticated Admin SDK credentials in read-only mode via [`scripts/audit-task037-winter-collection.mjs`](../../scripts/audit-task037-winter-collection.mjs) and [`scripts/check-reservations-task037.mjs`](../../scripts/check-reservations-task037.mjs).

- **Category Identified:** Name: `"Winter Special"`, Document ID: `ace36311-21a9-43ce-b377-e7a0852d3fd1`, `showOnHome: true`, `order: 5`.
- **Total Catalog Products in Database:** 46 products.
- **Total Products in "Winter Special":** 7 products (6 affected with empty variants, 1 healthy single-SKU product).
- **Active Reservations:** Exactly **0** active reservations across the entire database.
- **Existing Customer Orders:** Exactly **0** historical orders for Winter Collection products.
- **Image Assets:** All 29 associated images across the 6 Winter products were verified HTTP 200 PNG assets in Cloudflare R2 via [`scripts/verify-winter-images.mjs`](../../scripts/verify-winter-images.mjs).

### Product-Level Diagnostic Table

| Product ID | Title | SKU | Category ID & Name | Published | Root Stock | Avail Qty | Resv Qty | Tracking | Variants Count | Variant SKUs & Stock | Default Selection | Price / MRP | Storefront State | Reason Displayed "Unavailable" |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `14a29e10` | Men’s Premium Grey Bomber Jacket | *None* | `ace36311`<br>Winter Special | `true` | **10** | 10 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹750 / ₹6999 (89% OFF) | **Unavailable** | `hasVariants: true` but `variants: []`. PDP requires matched variant; `!matchedVariant` triggers `isVariantDisabled=true`. |
| `2a4b51a9` | Men’s Premium Grey Fleece Puffer Jacket | *None* | `ace36311`<br>Winter Special | `true` | **10** | 10 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹1400 / ₹8999 (84% OFF) | **Unavailable** | Same: `hasVariants: true`, sizes `S, M, L, XL` configured in `sizesList`, but `variants` array is empty. |
| `51adb109` | Men's Premium Black Sherpa Winter Jacket | *None* | `ace36311`<br>Winter Special | `true` | **106** | 106 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹1400 / ₹7888 (82% OFF) | **Unavailable** | Same: 106 genuine physical units in stock, but PDP evaluates `matchedVariant = null`, locking storefront. |
| `af7ddaf9` | Men’s Premium Black Hooded Winter Jacket | *None* | `ace36311`<br>Winter Special | `true` | **115** | 115 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹1300 / ₹6999 (81% OFF) | **Unavailable** | Same: 115 genuine physical units in stock, but empty variant matrix locks PDP. |
| `f1b8f647` | Men's Plain Zip-Up Jacket Combo (BOGO) | *None* | `ace36311`<br>Winter Special | `true` | **10** | 10 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹949 / ₹5999 (84% OFF) | **Unavailable** | Same: 10 genuine units in stock, sizes `M, XL, L, XXL`, but `variants: []`. |
| `f728d2b8` | Men's Solid Pullover Hoodie Combo (1+1) | *None* | `ace36311`<br>Winter Special | `true` | **10** | 10 | 0 | Yes | **0** | *None* (`variants: []`) | `null` | ₹699 / ₹3999 (83% OFF) | **Unavailable** | Same: 10 genuine units in stock, sizes `M, S, XL, L, XXL`, but `variants: []`. |
| `f176b9a7` | BazaarVilla White Varsity Bomber Jacket | *None* | `ace36311`<br>Winter Special | `true` | **95** | 95 | 0 | Yes | **0** | N/A (`hasVariants: false`) | Single SKU | ₹649 / ₹2999 (78% OFF) | **Available** | Healthy control: Uses legacy size selector (`sizes: ["L", "XL", "XXL"]`). Not affected by variant bug. |

**Audit Conclusion:** All 6 affected Winter Collection products have **genuine positive inventory (10, 10, 106, 115, 10, 10 units)**. Not a single product is genuinely sold out. The "Unavailable" display is a **100% false-positive defect** caused by empty variant arrays.

---

## 4. Real Headless Browser Reproduction

Using Chrome DevTools Protocol (CDP) on `https://bazaarvilla.com` via [`scripts/reproduce-task037-live.mjs`](../../scripts/reproduce-task037-live.mjs), the exact customer experience was captured:

1. **Winter Collection Grid:** The category page rendered all jackets and hoodies with clear images, titles, and discount badges (e.g., "89% OFF", "84% OFF").
2. **Product Detail Page Initial State:** Upon clicking any of the 6 Winter products (e.g., `/products/mens-premium-grey-bomber-jacket...`):
   - The stock badge rendered `Unavailable` in grey text.
   - The size selector rendered clickable buttons (`S`, `M`, `L`, `XL`, `XXL`).
   - The quantity selector was active.
   - **Both the "Add to Cart" and "Buy Now" buttons were disabled with the label "Unavailable".**
3. **Customer Interaction Test:** Clicking size pills (`M`, `L`, `XL`) visually updated the selected pill to black, but the buttons remained disabled with label "Unavailable".
4. **Console & Network Analysis:** Zero network or 500 errors occurred; the Next.js frontend rendered cleanly without crashes. The lock was purely an availability evaluation condition in `ProductCustomizer.tsx`.

### Screenshots Captured
- `01-live-categories-page.png` — Categories index showing Winter Special with 7 products.
- `02-live-winter-special-category-grid.png` — Winter Special product catalog grid.
- `03-live-prod1-grey-bomber-jacket-initial.png` — Grey Bomber Jacket initial PDP showing "Unavailable" buttons.
- `04-live-prod1-grey-bomber-jacket-size-M-clicked.png` — Size 'M' clicked; buttons remain locked as "Unavailable".
- `05-live-prod4-black-hooded-jacket-initial.png` — Black Hooded Jacket (115 stock) showing "Unavailable".
- `06-live-prod1-grey-bomber-jacket-mobile.png` — Mobile viewport (390px) confirming identical lockout.

All screenshots are stored in `docs/screenshots/task037/`.

---

## 5. Investigation of Availability Logic & Failure Modes

### Data Flow Trace
$$\text{Firestore Document} \xrightarrow{\text{Data Loader}} \text{ProductCustomizer} \xrightarrow{\text{Variant Normalization}} \text{resolveMatchingVariant} \xrightarrow{\text{matchedVariant: null}} \text{isVariantDisabled: true} \xrightarrow{\text{currentStock: 0}} \text{"Unavailable" UI}$$

### Investigation of Common Failure Modes

#### A. Product Stock Versus Variant Stock
- **Finding:** The products had positive stock at the parent level (`inventory: 10`, `inventory: 106`, etc.), but `hasVariants: true` was set. When `hasVariants: true`, the storefront architecture (TASK 029) relies authoritatively on variant-level inventory. Because `variants` was an empty array, variant stock was 0.
- **Resolution:** The inventory model must preserve variant-level authority while preventing the creation of variant products with 0 variants.

#### B. Missing Default Variant
- **Finding:** `ProductCustomizer.tsx` previously selected the first size in `sizesList` without checking variant availability. If the first variant was out of stock or if variants were empty, the customer was stranded in an unpurchasable state.
- **Resolution:** Implemented intelligent initial variant selection that auto-selects the first *active, in-stock variant* (`inventory > 0`).

#### C. Variant Matrix Integrity
- **Finding:** Standard combinations (S, M, L, XL, XXL) were present in `sizesList`, but never materialized into the `variants` array.
- **Resolution:** The matrix generation algorithm in `src/lib/products/variants.ts` is 100% correct when invoked. The issue was that the admin UI allowed saving without invoking it.

#### D. CSV Import Stock Mapping
- **Finding:** None of these 6 Winter products were created via the CSV importer. They were manually created via the admin UI (`/admin/products`) on November 13, 2026. The CSV importer (TASK 030/035) already enforces handle grouping and variant creation.

#### E. Reserved Inventory
- **Finding:** Exactly 0 reservations exist in production Firestore. No orders were stuck in pending state, and no inventory locks were active.

#### F. Publishing and Category State
- **Finding:** All products were published (`isVisible: true`) and properly associated with `categoryId: ace36311-21a9-43ce-b377-e7a0852d3fd1`. Product visibility was independent of the availability defect.

---

## 6. Application Code Fixes Implemented & Deployed

### 1. Hardened Variant Configuration Validation (`src/lib/products/variants.ts`)
Added strict validation preventing save of variant-enabled products with empty matrices:
```typescript
// src/lib/products/variants.ts
if (config.hasVariants) {
    if (!Array.isArray(config.variants) || config.variants.length === 0) {
        errors.push("Product has variants enabled, but no variant combinations have been generated. Click 'Generate / Refresh Matrix' before saving.");
    }
}
```

### 2. Intelligent Storefront Variant Resolution & Decoupled Button States (`src/components/storefront/ProductCustomizer.tsx`)
1. **Intelligent In-Stock Auto-Selection:** If configured variants exist, the component automatically selects the first active variant with `inventory > 0`. If all variants are sold out, it falls back to the first variant so the customer sees clear "Out of Stock" feedback instead of broken state.
2. **Decoupled Button Labels:** Separated `isVariantDisabled` (misconfigured or inactive variant) from `isOutOfStock` (`currentStock <= 0`).
   - Inactive/Misconfigured: Displays "Unavailable".
   - Zero stock: Displays "Out of Stock".
   - In stock: Displays "Add to Cart" / "Buy Now".
3. **Cart Validation Guard:** `handleAddToCart` detects if a product is misconfigured (`product.hasVariants && !hasConfiguredVariants`) and alerts the user cleanly rather than silently failing.

### 3. Admin Products UI Hardening (`src/components/admin/AdminProducts.tsx`)
1. **Visual Warning Banner:** Displays an amber warning banner if `formData.hasVariants === true && formData.variants.length === 0` with a 1-click **"Generate Combinations Now"** action.
2. **List Indicator:** Displays a prominent `⚠️ 0 Variants (Incomplete)` badge on both desktop table and mobile cards for any catalog product with empty variants.

---

## 7. Code-Only Production Deployment & Verification

### Deployment Metadata
- **Deployment Command:** `npx netlify deploy --remote --prod --message "TASK 037 — Winter Collection availability logic fix"`
- **Published Deploy ID:** `6af82c606f3fdab0c7d814a3` (Build ID: `6af82c606f3fdab0c7d814a1`)
- **Published Git Commit:** `fbcf2b4bfc7f7c0a26c11a107f511c4d64d3d963`
- **Secrets Scanning:** 147 files scanned; **0 secrets detected**.
- **Rollback Deploy ID:** `6af784767b17f44f4b91ca75`

### Live Post-Deployment Verification Results (`scripts/verify-live-task037.mjs`)

| Check # | Verification Area | Target Endpoint | Result | Status |
|---|---|---|---|---|
| **Check 1** | Homepage Brand & Integrity | `https://bazaarvilla.com` | HTTP 200, "Bazaarvilla" present, 79.6 KB | **PASS** |
| **Check 2** | Categories Catalog Route | `https://bazaarvilla.com/categories` | HTTP 200, catalog shell loaded | **PASS** |
| **Check 3** | Winter Special Filter Route | `https://bazaarvilla.com/products?category=Winter%20Special` | HTTP 200, "Winter" catalog rendered | **PASS** |
| **Check 4** | Cart Page Route | `https://bazaarvilla.com/cart` | HTTP 200, cart shell active | **PASS** |
| **Check 5** | Checkout Page Route | `https://bazaarvilla.com/checkout` | HTTP 200, checkout gate active | **PASS** |
| **Check 6** | Public Razorpay Commercial Config | `/api/razorpay/public-config` | HTTP 200, `commercialCheckoutEnabled: true` | **PASS** |
| **Check 7** | Healthy Control Product PDP | Varsity Bomber Jacket PDP | HTTP 200, active Add to Cart / Buy Now | **PASS** |
| **Check 8** | Affected Winter Product PDP | Puffer Jacket PDP | HTTP 200, truth-in-availability ("Unavailable") | **PASS** |
| **Check 9** | Zero Production Product-Data Mutations | Firestore `trendkartz` | 0 documents written, 0 modified | **PASS** |

---

## 8. Safe Six-Product Inventory Recovery Preparation

> [!IMPORTANT]
> **Safety Guarantee:** Per strict engineering directives, parent inventory has **NOT** been guessed or divided evenly across sizes. Physical size-specific inventory breakdown was never entered at creation time and remains **UNKNOWN / AWAITING OWNER INPUT**.

An admin-assisted inventory repair script was created at [`scripts/repair-winter-products.mjs`](../../scripts/repair-winter-products.mjs), together with a pre-formatted owner input template at [`docs/task-reports/TASK-037-owner-allocation-input.json`](./TASK-037-owner-allocation-input.json) and a detailed dry-run manifest at [`docs/task-reports/TASK-037-repair-manifest.json`](./TASK-037-repair-manifest.json).

### Product-by-Product Proposed Repair Breakdown

#### 1. Product `14a29e10-758e-4fd2-a10a-6c04c74fe73a`
- **Title:** `**Men’s Premium Grey Bomber Jacket with Black Ribbed Collar & Full Zip – Stylish Winter Casual Wear**`
- **Existing Sizes:** `S`, `M`, `L`, `XL`, `XXL`
- **Existing Parent Inventory:** 10 units (`inventory: 10`, `totalPhysicalInventory: 10`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-14A29E-S`, `BV-WTR-14A29E-M`, `BV-WTR-14A29E-L`, `BV-WTR-14A29E-XL`, `BV-WTR-14A29E-XXL`
  - Resulting Variant IDs: `var_size-s`, `var_size-m`, `var_size-l`, `var_size-xl`, `var_size-xxl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
  - Status: Awaiting owner input for allocations in `docs/task-reports/TASK-037-owner-allocation-input.json`.
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 10`, `totalPhysicalInventory: 10`, `sizes: ["S", "M", "L", "XL", "XXL"]`
  - Implications: Single pool of 10 shared across all 5 sizes. Customers can select any size. Fulfillment risk: store could receive orders for 5 XXL when physical stock only had 2 XXL.

#### 2. Product `2a4b51a9-991d-4d62-905e-d0e6cf243879`
- **Title:** `Men’s Premium Grey Fleece-Lined Hooded Puffer Winter Jacket`
- **Existing Sizes:** `S`, `M`, `L`, `XL`
- **Existing Parent Inventory:** 10 units (`inventory: 10`, `totalPhysicalInventory: 10`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-2A4B51-S`, `BV-WTR-2A4B51-M`, `BV-WTR-2A4B51-L`, `BV-WTR-2A4B51-XL`
  - Resulting Variant IDs: `var_size-s`, `var_size-m`, `var_size-l`, `var_size-xl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 10`, `totalPhysicalInventory: 10`, `sizes: ["S", "M", "L", "XL"]`
  - Implications: Shared pool of 10 units. Overselling risk per size exists if physical sizes run out.

#### 3. Product `51adb109-1acb-4f7e-96b7-cdccba9ed961`
- **Title:** `Men's Premium Black Sherpa Fur-Lined Winter Jacket`
- **Existing Sizes:** `S`, `L`, `M`, `XL`
- **Existing Parent Inventory:** 106 units (`inventory: 106`, `totalPhysicalInventory: 106`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-51ADB1-S`, `BV-WTR-51ADB1-L`, `BV-WTR-51ADB1-M`, `BV-WTR-51ADB1-XL`
  - Resulting Variant IDs: `var_size-s`, `var_size-l`, `var_size-m`, `var_size-xl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 106`, `totalPhysicalInventory: 106`, `sizes: ["S", "L", "M", "XL"]`
  - Implications: Shared pool of 106 units. Customer selects size, stock decrements from 106.

#### 4. Product `af7ddaf9-bb61-43fa-846f-22f9b69e4c01`
- **Title:** `Men’s Premium Black Hooded Winter Jacket with Soft Fur Fleece Lining & Full Zip`
- **Existing Sizes:** `M`, `L`, `XL`
- **Existing Parent Inventory:** 115 units (`inventory: 115`, `totalPhysicalInventory: 115`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-AF7DDA-M`, `BV-WTR-AF7DDA-L`, `BV-WTR-AF7DDA-XL`
  - Resulting Variant IDs: `var_size-m`, `var_size-l`, `var_size-xl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 115`, `totalPhysicalInventory: 115`, `sizes: ["M", "L", "XL"]`
  - Implications: Shared pool of 115 units.

#### 5. Product `f1b8f647-1b61-4b90-9978-a4f719c5d901`
- **Title:** `Men's Premium Plain Zip-Up Jacket Combo – Black & Olive Green | Buy 1 Get 1 Free`
- **Existing Sizes:** `M`, `XL`, `L`, `XXL`
- **Existing Parent Inventory:** 10 units (`inventory: 10`, `totalPhysicalInventory: 10`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-F1B8F6-M`, `BV-WTR-F1B8F6-XL`, `BV-WTR-F1B8F6-L`, `BV-WTR-F1B8F6-XXL`
  - Resulting Variant IDs: `var_size-m`, `var_size-xl`, `var_size-l`, `var_size-xxl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 10`, `totalPhysicalInventory: 10`, `sizes: ["M", "XL", "L", "XXL"]`
  - Implications: Shared pool of 10 units.

#### 6. Product `f728d2b8-089c-4cc1-9c7f-2f7fe0f0c3dd`
- **Title:** `Premium Men's Solid Pullover Hoodie Combo – Black & Mocha Brown (Pack of 2) | 1+1 FREE`
- **Existing Sizes:** `M`, `S`, `XL`, `L`, `XXL`
- **Existing Parent Inventory:** 10 units (`inventory: 10`, `totalPhysicalInventory: 10`)
- **Existing Variant Records:** `variants: []` (0 records)
- **Verified Size-Level Quantities:** **Unknown / Awaiting Owner Input**
- **Option 1 (Per-Size Matrix):**
  - Resulting SKUs: `BV-WTR-F728D2-M`, `BV-WTR-F728D2-S`, `BV-WTR-F728D2-XL`, `BV-WTR-F728D2-L`, `BV-WTR-F728D2-XXL`
  - Resulting Variant IDs: `var_size-m`, `var_size-s`, `var_size-xl`, `var_size-l`, `var_size-xxl`
  - Fields Changed: `variants: [...]`, `updatedAt: <timestamp>`
- **Option 2 (Shared Stock Pool):**
  - Fields Changed: `hasVariants: false`, `updatedAt: <timestamp>`
  - Preserved: `inventory: 10`, `totalPhysicalInventory: 10`, `sizes: ["M", "S", "XL", "L", "XXL"]`
  - Implications: Shared pool of 10 units.

---

## 9. Repair Safety & Execution Protocol

### Pre-Flight Safety Guarantees
1. **0 Active Reservations:** Verified via `scripts/check-reservations-task037.mjs` (0 reservations exist).
2. **0 Historical Orders:** Verified 0 customer orders have been placed for any of the 6 Winter Collection products.
3. **No Double-Counting:** Variant stock will strictly match the verified physical counts, and root `inventory` will match the sum of variants.
4. **Preserved Fields:** Descriptions, selling prices, MRP compare-at prices, R2 image URLs, categories, and purchase counters will remain completely untouched.
5. **Pre-Flight Snapshot:** Full JSON snapshot of all 6 products is preserved in [`scripts/task037-six-products-snapshot.json`](../../scripts/task037-six-products-snapshot.json).
6. **Atomic Batch Commit:** Writes will execute inside a single Firestore `batch.commit()`.
7. **Instant Rollback:** If any issue arises, the backup snapshot can be reapplied instantly via rollback script.

---

## 10. Automated Tests & Build Verification

All automated test suites, typechecks, and production builds were executed and verified cleanly:

| Test Suite | Command | Total Tests | Passed | Failed | Status |
|---|---|---|---|---|---|
| **Unit Tests** | `npm test` | 279 | 279 | 0 | **PASS (100%)** |
| **Security Rules** | `npm run test:rules` | 41 | 41 | 0 | **PASS (100%)** |
| **Integration Tests** | `npm run test:integration` | 403 | 403 | 0 | **PASS (100%)** |
| **TypeScript Typecheck** | `npm run typecheck` | N/A | 0 errors | 0 | **PASS (100%)** |
| **Next.js Production Build**| `npm run build` | 35 routes | 35/35 compiled | 0 | **PASS (100%)** |

**Total Unique Automated Tests:** **723 unique tests** (279 unit + 41 security rules + 403 integration, zero double-counting).

---

## 11. Final Status

**TASK 037 — CODE DEPLOYED & VERIFIED; SIX-PRODUCT INVENTORY REPAIR AWAITING OWNER APPROVAL.**
