# TASK 037 — Bazaarvilla Winter Collection Products Availability Diagnostic & Fix Report

**Task Reference:** TASK-037  
**Branch:** `task/037-winter-collection-availability-fix`  
**Base Commit:** `017a3d1` (from `task/036-production-csv-image-reliability`)  
**Storefront URL:** [https://bazaarvilla.com](https://bazaarvilla.com)  
**Admin Portal:** [https://bazaarvilla.com/admin](https://bazaarvilla.com/admin)  
**Production Firestore Database:** `trendkartz` (Spark plan, production isolated)  
**Status:** **TASK 037 — ROOT CAUSE IDENTIFIED, LOCAL FIX VERIFIED, PRODUCTION APPROVAL PENDING.**  
**Conclusion Category:** **C — Both application logic and production data require correction.**

---

## 1. Executive Summary

The store owner reported that **every product in the "Winter Collection" appeared as "Unavailable" on the customer-facing storefront** ([https://bazaarvilla.com](https://bazaarvilla.com)).

Through a comprehensive read-only production audit, real headless browser DevTools reproduction, code tracing, and dry-run manifest generation, the exact multi-stage defect chain was identified:

1. **Root Cause Origin:** The store administrator created 6 apparel jacket/hoodie products in `/admin/products` on November 13, 2026. The admin checked "Enable Product Variants (Sizes & Colors)" (`hasVariants: true`), selected apparel sizes (e.g., S, M, L, XL, XXL) and input parent inventory (10, 106, 115), but did **not** click "Generate / Refresh Matrix".
2. **Admin Validation Flaw:** `validateVariantConfiguration` in `src/lib/products/variants.ts` verified size name uniqueness and color hex values, but omitted a mandatory check: `if (variants.length === 0) return { isValid: false }`. The admin form submitted successfully, saving documents with `hasVariants: true`, `sizesList: [...]`, `inventory: 10/106/115`, but `variants: []` (an empty array).
3. **Storefront PDP Lockout:** On the storefront Product Detail Page (`ProductCustomizer.tsx`), the variant matching logic resolved `matchedVariant = null` because the `variants` array had zero items. When `product.hasVariants` is true and `!matchedVariant`, the component sets `isVariantDisabled = true` and `currentStock = 0`, permanently disabling both "Add to Cart" and "Buy Now" buttons with the label **"Unavailable"**.
4. **Server-Side Checkout Gate:** Furthermore, `src/lib/orders/pricing.ts` (lines 276–280) strictly rejects any checkout for products with `hasVariants === true && variants.length === 0` with error `"is configured for variants but has no valid variants configured"`.

**Conclusion: Category C Applies.**  
- **Application Logic:** The admin form permitted saving invalid variant states, lacked warnings for 0-variant configurations, and lacked intelligent in-stock default variant selection on the storefront.
- **Production Data:** Exactly 6 Winter Special products in production Firestore hold genuine positive inventory (10 to 115 units) but have empty `variants: []` arrays, requiring owner-authorized repair.

All application defects have been repaired locally and verified with **723 unique automated tests (279 unit, 41 security rules, 403 integration, 0 failures, zero double-counting)** and a successful Next.js 16 production build. A non-destructive, read-only dry-run data repair manifest has been generated at [`docs/task-reports/TASK-037-repair-manifest.json`](./TASK-037-repair-manifest.json). Zero production writes were performed.

---

## 2. Production Baseline Verification

Before commencing the audit, the current production deployment was verified:
- **Netlify Published Deploy ID:** `6af784767b17f44f4b91ca75`
- **Published Git Commit:** `753d5b6` (`task/036-production-csv-image-reliability`)
- **Node Runtime:** Node.js v24.15.0
- **Framework:** Next.js 16.1.6 (Turbopack) with React 19.2.3
- **Branch Created:** `task/037-winter-collection-availability-fix` branched from commit `017a3d1`.

### Related Prior Tasks Context
- **TASK 029 (Flexible Variants & Sizing):** Established the multi-attribute variant matrix schema, variant inventory tracking, and variant-specific pricing overrides.
- **TASK 030 (Shopify CSV Bulk Import):** Handled Shopify CSV column mapping, handle grouping, and draft product creation.
- **TASK 034 (Dual Pricing):** Introduced Selling Price vs Compare-At MRP and automatic discount calculations.
- **TASK 035 (Shopify CSV Completeness):** Ingested remote Shopify CDN images into Cloudflare R2 with content-addressable SHA-256 keys.
- **TASK 036 (Production CSV Image Reliability):** Hardened serverless image ingestion against IPv6 routing failures and added media proxy cache guards.

---

## 3. Read-Only Production Audit

The audit connected directly to production Firestore project `trendkartz` using authenticated Admin SDK credentials in read-only mode via [`scripts/audit-task037-winter-collection.mjs`](../../scripts/audit-task037-winter-collection.mjs) and [`scripts/dryrun-winter-data-repair.mjs`](../../scripts/dryrun-winter-data-repair.mjs).

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

**Audit Conclusion:** All 6 affected Winter Collection products have **genuine positive inventory (10, 10, 106, 115, 10, 10 units)**. Not a single product is genuinely sold out. The "Unavailable" display is a **100% false-positive defect**.

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

## 6. Application Code Fixes

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

## 7. Existing Production Product Data Repair Dry Run

A strictly read-only dry-run script was developed at [`scripts/dryrun-winter-data-repair.mjs`](../../scripts/dryrun-winter-data-repair.mjs) and executed against production Firestore. It generated the complete dry-run manifest at [`docs/task-reports/TASK-037-repair-manifest.json`](./TASK-037-repair-manifest.json).

### Proposed Repair Options for Store Owner Approval

#### Option 1: Sized Variant Matrix Model (Recommended for Apparel)
- **Mechanism:** Generates deterministic variants for each size configured in `sizesList` using `generateVariantMatrix`. Standardizes variant SKUs (e.g., `BV-WTR-14A29E-S`), distributes genuine stored parent inventory evenly across sizes (with remainder assigned to first variant so total sum strictly matches stored stock), sets `totalPhysicalInventory`, and marks all variants `isActive: true`.
- **Advantage:** Enables independent stock tracking per size (S, M, L, XL, XXL) as intended by the variant architecture.
- **Stock Allocations:**
  - Product `14a29e10` (10 units across 5 sizes): S: 2, M: 2, L: 2, XL: 2, XXL: 2.
  - Product `2a4b51a9` (10 units across 4 sizes): S: 3, M: 2, L: 2, XL: 3.
  - Product `51adb109` (106 units across 4 sizes): S: 27, L: 26, M: 26, XL: 27.
  - Product `af7ddaf9` (115 units across 3 sizes): M: 39, L: 38, XL: 38.
  - Product `f1b8f647` (10 units across 4 sizes): M: 3, XL: 2, L: 2, XXL: 3.
  - Product `f728d2b8` (10 units across 5 sizes): M: 2, S: 2, XL: 2, L: 2, XXL: 2.

#### Option 2: Single-SKU Sized Product Model (Alternative)
- **Mechanism:** Sets `hasVariants: false` and preserves `sizes: sizesList`.
- **Advantage:** Single inventory pool (e.g., 106 units total); customers choose their size from the dropdown/pills, and any size draws from the common pool. Identical to healthy product `f176b9a7`.

**Production Status:** Zero production records have been modified. Execution awaits store owner approval.

---

## 8. Automated Tests

### Unit Tests (`tests/unit/winter-availability.test.ts`)
Added 16 comprehensive unit tests covering all required scenarios:
- `AVAIL-001`: Simple product with positive stock is purchasable with in-stock state.
- `AVAIL-002`: Simple product with zero stock strictly rejects purchase as out of stock.
- `AVAIL-003`: Product with multiple variants and mixed availability validates stock per variant.
- `AVAIL-004`: All variants out of stock results in sellableStock = 0.
- `AVAIL-005`: In-stock variant selected by customer resolves exact SKU, stock, and price.
- `AVAIL-006`: Initial variant resolution intelligently identifies first in-stock variant.
- `AVAIL-007`: Free Size product resolves universal option and maintains inventory integrity.
- `AVAIL-008`: Missing or invalid variant stock field fails safely to 0 without NaN.
- `AVAIL-009`: When product has variants, variant-level stock is authoritative; parent stock is ignored.
- `AVAIL-010`: CSV-imported product with genuine positive inventory generates valid matrix and stock.
- `AVAIL-011`: CSV-imported product with zero inventory preserves genuine 0 and is not marked in-stock.
- `AVAIL-012`: validateVariantConfiguration strictly rejects hasVariants=true when variants array is empty.
- `AVAIL-013`: Price, discount, and inventory remain consistent when customer switches variants.
- `AVAIL-014`: Unpublished or disabled products are strictly rejected during server checkout.
- `AVAIL-015`: Confirms root cause: hasVariants=true with variants=[] produces configuration error.
- `AVAIL-016`: Button states map cleanly across In Stock, Out of Stock, and Unavailable.

### Integration Tests (`tests/integration/winter-availability-lifecycle.test.ts`)
Added 6 lifecycle integration tests running against the Firebase Emulator Suite:
- `WINTER-001`: Product with `hasVariants=true` and empty `variants[]` is strictly rejected by server checkout (HTTP 400).
- `WINTER-002`: Repaired variant product allows valid checkout and decrements variant stock (HTTP 200).
- `WINTER-003`: Out-of-stock variant (inventory 0) is rejected with HTTP 400.
- `WINTER-004`: Simple in-stock product successfully checks out and decrements root inventory (HTTP 200).
- `WINTER-005`: Zero-stock simple product is rejected during checkout (HTTP 400).
- `WINTER-006`: Concurrent checkout requests on limited variant inventory prevent overselling (atomic transaction check).

---

## 9. Regression Verification Results

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

## 10. Deployment and Rollback Plan

### Deployment Plan
1. Obtain store owner approval for:
   - Application code changes on `task/037-winter-collection-availability-fix`.
   - Selected production data repair option (Option 1 vs Option 2).
2. Merge `task/037-winter-collection-availability-fix` into production branch and trigger Netlify build.
3. Verify live storefront deployment on `https://bazaarvilla.com`.
4. Run the production data repair script with `--apply` flag to update the 6 Winter documents in Firestore.
5. Perform live read-only verification of Winter Collection product pages to confirm Add to Cart and Buy Now buttons are enabled.

### Rollback Plan
- **Application Rollback:** Netlify one-click rollback to prior published deploy `6af784767b17f44f4b91ca75`.
- **Data Rollback:** The dry-run manifest at `docs/task-reports/TASK-037-repair-manifest.json` preserves the exact `currentStoredData` snapshot for all 6 products, enabling instant restoration via atomic backup script if needed.

---

## 11. Production Restrictions & Compliance

- **Production Writes:** **ZERO.** No production Firestore documents were created, updated, or deleted.
- **Inventory/Prices:** Untouched.
- **Customer Orders:** Untouched.
- **Test Purchases:** Zero production orders placed.
- **Audit Mode:** 100% read-only.

---

## 12. Final Status

**TASK 037 — ROOT CAUSE IDENTIFIED, LOCAL FIX VERIFIED, PRODUCTION APPROVAL PENDING.**
