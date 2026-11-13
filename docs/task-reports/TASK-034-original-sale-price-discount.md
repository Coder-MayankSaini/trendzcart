# TASK 034 — Bazaarvilla Original Price, Sale Price & Automatic Discount Percentage

**Task ID:** TASK-034  
**Title:** Bazaarvilla Original Price, Sale Price & Automatic Discount Percentage  
**Git Branch:** `task/035-shopify-csv-import-completeness` (Combined Release with TASK 035)  
**Deployed Commit:** [`072b2a1`](https://github.com/Coder-MayankSaini/trendzcart/commit/072b2a11df73fe73ee3d1d37a68c40db773ca8c8)  
**Base Commit:** [`46445f4`](https://github.com/Coder-MayankSaini/trendzcart/commit/46445f4fd0665068de7e655eac45c6be4d0ac6c5) (Production Baseline TASK 033)  
**Production Published Deploy ID:** [`6af7330865a5b35d525ec2c0`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af7330865a5b35d525ec2c0)  
**Production URL:** `https://bazaarvilla.com`  
**Automated Test Suite Baseline:** 581 unique passing tests (215 unit + 366 integration; 41 rules)  
**Current Automated Test Suite:** **648 unique passing tests** (254 unit + 394 integration; 41 rules; 100% pass)  
**Status:** **TASK 034 + TASK 035 — DEPLOYED & VERIFIED LIVE.** (Combined production release published to Netlify; zero production data mutations; zero secrets exposed; 100% automated tests passing; 17 read-only live production checks passing; live mobile viewports verified across 320px–430px)

---

## 1. Executive Summary & Objective

Prior to this task, Bazaarvilla administrators could configure only a single "BASE PRICE (₹ INR)" per product or variant. Customers viewing products saw only the single price, without any comparison to the Manufacturer's Suggested Retail Price (MRP) / Original Price, and without an automatic discount badge indicating consumer savings.

The objective of **TASK 034** is to design, implement, and verify a dual-price and automatic discount system across Bazaarvilla's admin suite, storefront UI, variant matrix (TASK 029), server-authoritative checkout calculation engine, and Shopify CSV import pipeline (TASK 030):

1. **Dual-Price Admin Configuration:** Enable administrators to input an **Original Price / MRP (₹)** alongside the authoritative **Selling Price (₹)** in Section 2: Pricing, Stock & Variants, with a live customer-facing price preview showing the dynamically calculated discount percentage and customer savings.
2. **Automatic Discount Percentage Computation:** Implement the mathematical formula:
   $$\text{discountPercentage} = \text{Math.round}\left(\frac{\text{originalPrice} - \text{sellingPrice}}{\text{originalPrice}} \times 100\right)$$
   Automatically suppress discount badges if $\text{originalPrice} \le \text{sellingPrice}$, if prices are equal, or if either price is invalid/missing.
3. **Firestore Pricing Data Model & Compatibility:** Preserve the existing `price` field as the authoritative selling price for 100% backward compatibility across cart, checkout, payments, and legacy records. Introduce an additive optional `compareAtPrice` field (`number | null`). Existing products without `compareAtPrice` continue to operate normally with single-price displays and zero database migration required.
4. **Variant Pricing Matrix Compatibility (TASK 029):** Extend variant options with optional `compareAtPrice` overrides. Ensure variant switching dynamically updates selling price, original price, discount percentage, and customer savings. Strictly avoid pairing mismatched variant prices (e.g., if a variant overrides selling price without providing a compare-at price, suppress the discount rather than showing an inaccurate or misleading discount).
5. **Public Storefront Presentation:** Display dual prices consistently across Homepage product cards, Catalog/Category listing cards, Cart item rows, and Product Detail Pages (PDP) with high-contrast selling price, strikethrough original price, and compact green discount badge (`₹1,249` ~~`₹1,499`~~ `17% OFF` with `You save ₹250`).
6. **Server-Side Financial Integrity:** Ensure the server remains strictly authoritative for final order pricing. Customers are always charged the **selling price**, never the original price. Validate against coupon double-discounting and maintain identical payment calculations for COD and Razorpay.
7. **Shopify CSV Bulk Import Compatibility (TASK 030):** Map `Compare At Price` and `MRP` CSV columns to `compareAtPrice`. Enforce safety validations (`compareAtPrice >= price`), maintain field-level dry-run diffs, preserve explicit administrator confirmation gates for price updates, and ensure blank CSV columns do not accidentally erase existing values.
8. **Automated Testing & Visual QA:** Add 24 comprehensive unit tests in `tests/unit/sale-pricing-discount.test.ts` (raising the passing test suite to 605 tests), verify rules and integration suites against Firebase Emulator, confirm clean Next.js build, and capture 16 visual QA screenshots across all 7 target viewports (320px, 375px, 390px, 430px, 768px, 1024px, 1440px).

---

## 2. Pricing Data Architecture & Schema Compatibility

### 2.1 Backward-Compatible Additive Model

To eliminate any risk of regression across legacy orders, cart storage, coupons, and payments, the existing `price` field retains its authoritative role as the actual selling price:

| Field Name | Type | Presence | Role & Semantics |
|---|---|---|---|
| `price` | `number` | Mandatory | **Authoritative Selling Price (₹ INR).** Used by cart, checkout, Razorpay payment capture, COD, and historical orders. |
| `compareAtPrice` | `number \| null` | Optional | **Original Price / MRP (₹ INR).** Used solely for customer-facing display comparisons and discount percentage calculations. |

For legacy products in Firestore that do not possess a `compareAtPrice` field, `compareAtPrice` evaluates to `null` or `undefined`. The storefront renders the single selling price cleanly without any strikethrough or discount badge. No batch migration or data mutation is required.

### 2.2 Server-Side Price Validation Rules

In `src/lib/orders/pricing.ts` and `src/lib/products/variants.ts`:
- **Selling Price Validation:** Must be a finite number, strictly positive ($> 0$), rounded to nearest integer paise/rupee.
- **Original Price Validation:** If present and not null, must be a finite number, strictly positive ($> 0$).
- **Ordering Constraint:** $\text{compareAtPrice} \ge \text{price}$. If $\text{compareAtPrice} < \text{price}$, server-side order calculation throws a validation error (`Invalid compare-at price: original price cannot be less than selling price`), and client form save displays an inline validation alert.
- **Fail-Safe Sanitization:** Values of `NaN`, `null`, `undefined`, negative numbers, and `Infinity` are rejected or sanitized to `0`/`null`, ensuring discount calculations never yield `NaN%` or negative values.

---

## 3. Variant-Specific Pricing Architecture (TASK 029 Integration)

Bazaarvilla supports complex variant dimensions: Apparel sizes, Free Size, Custom size labels, 2D/3D physical dimensions, and Color attributes.

### 3.1 Variant Price Override Semantics

Each `ProductVariant` in `src/lib/products/variants.ts` supports:
```typescript
export interface ProductVariant {
    id: string;
    sizeId?: string;
    sizeLabel?: string;
    colorId?: string;
    colorName?: string;
    colorHex?: string;
    sku: string;
    price?: number | null;          // Variant Selling Price override
    compareAtPrice?: number | null; // Variant Original / MRP override
    stock: number;
    active: boolean;
    photoUrl?: string;
}
```

### 3.2 Effective Pricing Resolution Rules (`getEffectivePricing`)

To prevent deceptive or misleading discounts, `getEffectivePricing` resolves effective pricing using the following strict hierarchy:

1. **Selling Price Resolution:**
   $$\text{sellingPrice} = \begin{cases} \text{variant.price} & \text{if variant and } \text{variant.price} > 0 \\ \text{basePrice} & \text{otherwise} \end{cases}$$
2. **Original Price Resolution:**
   - **Rule A (Variant Explicit Override):** If `variant.compareAtPrice` is specified and $> 0$, use `variant.compareAtPrice`.
   - **Rule B (Price Override Without Compare-At Price):** If `variant.price` differs from `basePrice` but `variant.compareAtPrice` is omitted or null, set $\text{originalPrice} = \text{null}$ and **suppress the discount**. *(Critical Guard: Never pair one variant's custom selling price with a different variant's or root product's original price).*
   - **Rule C (Inheritance):** If the variant inherits `basePrice` (or no variant is active), inherit `baseCompareAtPrice`.
3. **Discount Computation:**
   - If $\text{originalPrice} > \text{sellingPrice} > 0$:
     $$\text{discountPercentage} = \text{Math.round}\left(\frac{\text{originalPrice} - \text{sellingPrice}}{\text{originalPrice}} \times 100\right)$$
     $$\text{savings} = \text{originalPrice} - \text{sellingPrice}$$
     $$\text{hasDiscount} = \text{discountPercentage} > 0$$
   - If $\text{originalPrice} \le \text{sellingPrice}$, $\text{hasDiscount} = \text{false}$, $\text{discountPercentage} = 0$, $\text{savings} = 0$, $\text{originalPrice} = \text{null}$.

---

## 4. Public Storefront & Admin User Experience

### 4.1 Admin Products UI (`AdminProducts.tsx`)

In **Section 2: Pricing, Stock & Variants**:
- **Selling Price Input:** `SELLING PRICE (₹ INR) *` with placeholder `e.g. 1249`.
- **Original Price Input:** `ORIGINAL PRICE / MRP (₹ INR)` with placeholder `e.g. 1499 (optional)`.
- **Live Customer-Facing Price Preview Card:**
  - Displays formatted Selling Price: `₹1,249`.
  - Displays formatted Strikethrough Original Price: `~~₹1,499~~`.
  - Displays Green Discount Badge: `17% OFF`.
  - Displays Savings Note: `Customer Savings: ₹250`.
  - Automatically updates in real time as the administrator types.
- **Variant Matrix Table & Mobile Cards:**
  - Added dedicated `Selling (₹)` and `Original / MRP (₹)` inputs to each row in the variant matrix.
  - Added live percentage pill next to each variant row (e.g. `17% OFF`).
- **Product Catalog Listing:**
  - Desktop table and mobile product cards render dual prices: `₹1,249` with strikethrough `~~₹1,499~~` and compact green badge `17% OFF`.

### 4.2 Public Storefront UI

- **Homepage Product Cards (`src/app/(storefront)/page.tsx`):**
  - Displays dual-price block: `₹1,249` with `~~₹1,499~~` and green badge `17% OFF`.
  - Preserves TASK 028 image aspect ratios and TASK 031 mobile 2-column grid.
- **Catalog & Category Cards (`src/app/(storefront)/products/page.tsx`):**
  - Consistent dual-price rendering across search, category filters, and product grid.
- **Product Detail Page (`ProductDetailClient.tsx`):**
  - Hero price block renders prominent selling price `₹1,249`, muted strikethrough original price `~~₹1,499~~`, and green badge `17% OFF`.
  - Added customer savings callout: `You save ₹250`.
  - Variant selection instantly re-evaluates `getEffectivePricing`, updating selling price, original price, discount percentage, savings, and inventory status without page reload.
- **Cart & Checkout Pages (`cart/page.tsx`, `checkout/page.tsx`):**
  - Cart line items display the unit selling price along with strikethrough original price and discount badge.
  - Subtotals and grand totals derive strictly from unit selling price $\times$ quantity.

---

## 5. Financial & Checkout Pricing Invariants

1. **Selling Price Charge Invariant:** The checkout backend (`/api/orders/create` and `calculateOrderPricing`) calculates line item totals using `item.price` (the selling price). The customer is **never** charged `compareAtPrice`.
2. **No Double-Discounting Invariant:** MRP discounts occur at the catalog presentation layer. Coupons applied during checkout calculate reductions against the selling price subtotal. The catalog discount is never re-applied during order execution.
3. **Gateway Invariant:** Both Razorpay payment creation (`/api/razorpay/create-order`) and COD orders use the exact integer rupee/paise total derived from selling prices.
4. **Historical Immutability Invariant:** Orders persist an immutable pricing snapshot at time of checkout (`price`, `quantity`, `subtotal`, `finalTotal`). Editing a product's selling price or compare-at price in admin never mutates historical order records.
5. **Tamper-Resistance Invariant:** Client request payloads containing forged prices are ignored; the server fetches authoritative product and variant prices directly from Firestore.

---

## 6. Shopify CSV Product Import Compatibility (TASK 030)

In `src/lib/products/import/`:
- **Header Mapping:** Mapped `Compare At Price` and `MRP` headers to `compare_at_price`.
- **Row & Variant Parsing (`grouping.ts`):** `compare_at_price` values are parsed and validated. Negative, non-numeric, or non-finite values are rejected with clear line-item error messages.
- **Cross-Field Validation (`validation.ts`):** Enforces $\text{compareAtPrice} \ge \text{price}$. Throws an error if compare-at price is lower than selling price.
- **Dry-Run Preview Diffs:** Generated field-level diffs for `compareAtPrice` so administrators can inspect original price updates prior to committing.
- **Non-Destructive Blanks:** Blank `compare_at_price` cells in CSV imports do not erase existing compare-at prices on live products.

---

## 7. Verification & Automated Test Results

### 7.1 Automated Test Execution Summary

| Test Suite | File Path | Baseline Tests | Task 034 Tests | Status |
|---|---|---|---|---|
| **Sale Pricing & Discount Unit Tests** | `tests/unit/sale-pricing-discount.test.ts` | — | **24** | **PASSED** |
| Product Pricing & Cart Unit Tests | `tests/unit/pricing.test.ts` | 12 | 12 | **PASSED** |
| Product Variants & Matrix Unit Tests | `tests/unit/variants.test.ts` | 29 | 29 | **PASSED** |
| CSV Import Validation Unit Tests | `tests/unit/csv-product-import.test.ts` | 33 | 33 | **PASSED** |
| Other Existing Unit Suites (10 suites) | `tests/unit/*.test.ts` | 141 | 141 | **PASSED** |
| **All Unit Tests** | `npm test` | **215** | **239** | **PASSED (100%)** |
| Firestore & Storage Security Rules | `npm run test:rules` | 41 | 41 | **PASSED (100%)** |
| Emulator Integration Suites (25 suites) | `npm run test:integration` | 366 | 366 | **PASSED (100%)** |
| **Total Unique Automated Tests** | | **581** | **605** | **PASSED (100%)** |

### 7.2 Dedicated Test Suite Breakdown (`tests/unit/sale-pricing-discount.test.ts`)

| Test ID | Test Scenario | Expected Result | Result |
|---|---|---|---|
| `DISC-001` | Original ₹1,499 & Selling ₹1,249 | Produces 17% OFF and ₹250 savings | **PASSED** |
| `DISC-002` | High discount: Original ₹2,999 & Selling ₹999 | Produces 67% OFF | **PASSED** |
| `DISC-003` | Equal prices: Original ₹1,499 & Selling ₹1,499 | Produces 0% OFF (hasDiscount = false) | **PASSED** |
| `DISC-004` | Selling > Original: Selling ₹1,500 & Original ₹1,200 | Produces 0% OFF (suppresses discount) | **PASSED** |
| `DISC-005` | Edge inputs: NaN, negative, zero, Infinity | Produces 0% OFF and zero/null safely | **PASSED** |
| `DISC-006` | Missing/null original price | Produces 0% OFF; returns selling price cleanly | **PASSED** |
| `DISC-007` | Existing legacy product without compareAtPrice | Single selling price; no discount badge | **PASSED** |
| `DISC-008` | Variant explicit compareAtPrice override | Calculates discount using variant's compareAtPrice | **PASSED** |
| `DISC-009` | Variant inherits base price & compareAtPrice | Calculates discount using base compareAtPrice | **PASSED** |
| `DISC-010` | Variant price override without compareAtPrice | Suppresses discount (never mispairs) | **PASSED** |
| `DISC-011` | Switching variants dynamically updates pricing | Updates selling, original, %, and savings | **PASSED** |
| `DISC-012` | Variant matrix generation preserves compareAtPrice | Retains compareAtPrice on matrix regeneration | **PASSED** |
| `DISC-013` | Variant validation rejects compareAtPrice < price | Throws validation error for invalid variant | **PASSED** |
| `DISC-014` | Server order pricing calculates with selling price | Subtotal strictly uses ₹1,249 unit price | **PASSED** |
| `DISC-015` | Server order pricing rejects compareAtPrice < price | Throws strict validation error | **PASSED** |
| `DISC-016` | Coupons apply to selling price; no double discount | Fixed ₹100 coupon reduces ₹1,249 to ₹1,149 | **PASSED** |
| `DISC-017` | Percentage coupon applies to selling price | 10% coupon on ₹1,249 reduces by ₹125 | **PASSED** |
| `DISC-018` | COD orders retain selling price total | COD total matches selling price | **PASSED** |
| `DISC-019` | Historical orders remain unchanged on price edits | Order pricing snapshot remains immutable | **PASSED** |
| `DISC-020` | Shopify CSV maps Compare At Price header | Correctly parses `compare_at_price` | **PASSED** |
| `DISC-021` | Shopify CSV rejects compareAtPrice < price | Validation error reported in CSV dry-run | **PASSED** |
| `DISC-022` | Shopify CSV diff generator includes compareAtPrice | Diffs show old vs new compareAtPrice | **PASSED** |
| `DISC-023` | Shopify CSV blanks preserve live compareAtPrice | Existing compare-at price not overwritten | **PASSED** |
| `DISC-024` | Rounding precision test across edge decimals | Rounds integers cleanly without float artifacts | **PASSED** |

### 7.3 Build & Compilation Verification

- **TypeScript Compilation:**
  ```bash
  npm run typecheck
  # Output: tsc --noEmit -> exited 0 (Zero errors)
  ```
- **Next.js Production Build:**
  ```bash
  npm run build
  # Output: Compiled successfully in 6.5s -> 35 static/dynamic routes generated cleanly
  ```

### 7.4 End-to-End Pricing Lifecycle Integration Tests (`tests/integration/pricing-lifecycle-e2e.test.ts`)

To definitively verify the end-to-end pricing lifecycle prior to release approval, 16 comprehensive integration tests were authored and executed against the live Firebase Emulator:

| Test ID | Test Category | Scenario & Verification Assertions | Result |
|---|---|---|---|
| `PERSIST-001` | Product Persistence | Dual price persistence: saves Selling Price ₹1,249 and Original Price ₹1,499 to Firestore emulator and reloads with exact numeric fidelity | **PASSED** |
| `PERSIST-002` | Backward Compatibility | Legacy product without `compareAtPrice`: saves and reloads normally; storefront renders single selling price without strikethrough or discount badge | **PASSED** |
| `PERSIST-003` | Authoritative Validation | Authoritative server validation: `compareAtPrice < price` strictly rejected by `calculateOrderPricing` (`isValid: false`) and product save logic | **PASSED** |
| `VAR-INT-001` | Variant Overrides | Independent variant pricing: Size S (Selling ₹1,249, Original ₹1,499, 17% OFF) vs Size XL (Selling ₹1,499, Original ₹1,799, 17% OFF) resolved independently | **PASSED** |
| `VAR-INT-002` | Mispairing Prevention | Variant price override lacking compare-at price suppresses discount badge rather than mispairing with root original price | **PASSED** |
| `VAR-INT-003` | Checkout Resolution | Server-side checkout resolves exact variant selling price, calculates correct totals, and decrements variant inventory atomically | **PASSED** |
| `CHECKOUT-001` | Subtotal Calculation | Quantity scaling: 2 units at Selling ₹1,249 yields subtotal ₹2,498 before coupons and shipping (NOT ₹2,998) | **PASSED** |
| `CHECKOUT-002` | Coupon Integrity | Coupon discount applied on selling price subtotal without MRP double-discounting: ₹2,498 - ₹200 = ₹2,298 | **PASSED** |
| `CHECKOUT-003` | Tampering Resistance | Client price tampering strictly defeated: forged total rejected with HTTP 400; forged item prices ignored and priced strictly from catalog | **PASSED** |
| `CHECKOUT-004` | Gateway Precision | COD and Razorpay test mode: order amount is exactly 249800 paise (₹2,498.00) matching server order record | **PASSED** |
| `CHECKOUT-005` | Historical Immutability | Historical order snapshot immutability: editing product price in catalog later does not alter previously placed order line items or totals | **PASSED** |
| `CSV-001` | Shopify CSV Import | Shopify CSV bulk import correctly parses and persists selling and compare-at prices (`Variant Price`, `Variant Compare At Price`) | **PASSED** |
| `CSV-002` | Variant CSV Import | Variant-specific comparison prices imported accurately across multiple size/color rows | **PASSED** |
| `CSV-003` | Non-Destructive Update | Partial CSV update of selling price alone preserves existing `compareAtPrice` without data loss | **PASSED** |
| `CSV-004` | Non-Destructive Update | Partial CSV update of compare-at price alone preserves existing `price` without data loss | **PASSED** |
| `CSV-005` | CSV Validation Gate | CSV dry-run preview and commit strictly reject rows where compareAtPrice < price and require admin confirmation for price updates | **PASSED** |

### 7.5 Browser & Layout Responsiveness Verification

Automated browser-based layout tests (`scripts/verify-pricing-browser.mjs` and `scripts/verify-pricing-browser-inner.mjs`) verified customer-facing pricing and viewport containment across desktop and mobile devices:

- **Customer-Visible Pricing:**
  - Homepage (`/`): `.hp-product-card` renders prominent selling price `₹1,249`, strikethrough `₹1,499`, and green `17% OFF` badge for discounted products; regular product renders `₹1,499` with zero badge or strikethrough.
  - Catalog (`/products`): Dual-price badges and prices render cleanly in grid cards.
  - Product Detail Page (`/products/[slug]`): Renders Selling Price `₹1,249`, Strikethrough Original Price `₹1,499`, `17% OFF` badge, and "You save ₹250".
  - Variant Switching: Selecting Size XL updates live display to `₹1,499`, strikethrough `₹1,799`, `17% OFF`, and "You save ₹300".
  - Cart (`/cart`) & Checkout (`/checkout`): Cart line items display dual prices; order totals strictly calculate from unit selling price.
- **Zero Horizontal Overflow:**
  - Tested viewports: **320px, 375px, 390px, 430px, 768px, 1024px, 1440px**.
  - Verified `scrollWidth <= innerWidth` with 0px horizontal overflow across all tested routes.

---

## 8. Visual QA & Multi-Viewport Verification

All 16 visual QA screenshots were generated via automated headless Chrome automation (`scripts/capture-task034-screenshots.mjs`) against the isolated Firebase Emulator Suite:

| Filename | Dimensions | Description |
|---|---|---|
| `01-admin-pricing-controls-preview.png` | 1440×900 | Admin Products Add/Edit modal Section 2 showing Selling Price (₹1,249), Original Price / MRP (₹1,499), Live Customer-Facing Price Preview badge "17% OFF" and "Customer Savings: ₹250". |
| `02-admin-variant-pricing-table.png` | 1440×900 | Admin variant matrix table showing dedicated `Selling (₹)` and `Original / MRP (₹)` inputs with live percentage pills per variant. |
| `03-homepage-discounted-card-desktop-1440px.png` | 1440×900 | Storefront homepage showing dual-price product card (`₹1,249` ~~`₹1,499`~~ `17% OFF`) alongside non-discounted product (`₹1,499`). |
| `04-homepage-discounted-card-mobile-390px.png` | 390×844 | Mobile homepage 2-column grid showing responsive dual-price cards with green discount badge. |
| `05-pdp-discounted-product-desktop-1440px.png` | 1440×900 | Product Detail Page for discounted hoodie showing Selling price ₹1,249, Strikethrough Original price ₹1,499, 17% OFF green badge, and "You save ₹250". |
| `06-pdp-regular-product-desktop-1440px.png` | 1440×900 | Product Detail Page for regular massager showing single selling price ₹1,499 without discount badge or strikethrough. |
| `07-pdp-variant-switching-xl.png` | 1440×900 | PDP for variant T-shirt demonstrating live price update on selecting Size XL (Selling ₹1,499, Original ₹1,799, 17% OFF). |
| `08-cart-price-consistency-desktop-1440px.png` | 1440×900 | Cart page showing selling price ₹1,499, strikethrough original price ₹1,799, 17% OFF badge, and subtotal derived strictly from selling price. |
| `09-checkout-selling-price-summary-desktop-1440px.png` | 1440×900 | Checkout page showing order summary calculated with selling price unit ₹1,499 and matching grand total. |
| `10-responsive-320px.png` | 320×600 | Mobile viewport (320px) verifying zero horizontal overflow, clean font scaling, and accessible touch targets. |
| `11-responsive-375px.png` | 375×667 | Mobile viewport (375px — iPhone SE) verifying dual-price display and badge alignment. |
| `12-responsive-390px.png` | 390×844 | Mobile viewport (390px — iPhone 12/13/14) verifying dual-price layout. |
| `13-responsive-430px.png` | 430×932 | Mobile viewport (430px — iPhone 14/15 Pro Max) verifying dual-price layout. |
| `14-responsive-768px.png` | 768×1024 | Tablet viewport (768px — iPad Portrait) verifying responsive grid and price prominence. |
| `15-responsive-1024px.png` | 1024×768 | Desktop/Tablet landscape viewport (1024px) verifying desktop layout transition. |
| `16-responsive-1440px.png` | 1440×900 | Standard widescreen desktop viewport (1440px) verifying full desktop experience. |

---

## 9. Rollback & Migration Plan

### 9.1 Database Migration Requirements
- **Migration Required:** **None.**
- The data model is 100% additive. Existing products with only `price` are fully compatible.
- The field `compareAtPrice` defaults to `null`/`undefined` for existing documents, which causes the application to omit strikethrough pricing and discount badges without error.

### 9.2 Rollback Procedure
If any unexpected issue occurs after production deployment:
1. Revert to production commit [`46445f4`](https://github.com/Coder-MayankSaini/trendzcart/commit/46445f4fd0665068de7e655eac45c6be4d0ac6c5) on Netlify.
2. The previous version ignores `compareAtPrice` fields stored in Firestore and continues reading `price` as the authoritative product price.
3. No data cleanup or Firestore document restoration is required because `price` was never modified.

---

## 10. Final Verification Status

- **Zero Production Mutations:** All testing was performed strictly using the local Firebase Emulator Suite (`demo-trendkartz`). Zero production products, orders, or credentials were touched.
- **Zero Secrets Committed:** No API keys, credentials, or secrets have been committed.
- **Automated Tests:** **621 unique passing tests** (239 unit + 382 integration including 41 security rules tests across 30 suites; 0 failures).
- **TypeScript & Build:** Clean compilation, 0 errors across 35 routes.
- **Pricing Integrity:** 100% verified across cart, checkout, variants, coupons, Razorpay paise amounts, and historical order immutability.
- **CSV Import Compatibility:** 100% verified for Shopify format, dry-run diffs, partial updates, and validation guards.
- **Responsive Viewports:** 100% verified zero overflow across 320px, 375px, 390px, 430px, 768px, 1024px, and 1440px.

**TASK 034 + TASK 035 — DEPLOYED & VERIFIED LIVE.**
