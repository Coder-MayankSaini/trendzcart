# TASK 027 — Bazaarvilla Customizable Product COD Restriction

**Task ID:** TASK-027  
**Date:** 2026-11-10  
**Investigator / Engineer:** Principal Full-Stack Engineer, E-Commerce Security Architect, Payment Integrity Specialist  
**Primary Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5, Firebase Auth, Cloud Firestore (Spark plan), Cloudflare R2, Razorpay Live Mode (2.9.6), Netlify Hosting  
**Git Branch:** `task/027-customizable-product-cod-restriction`  
**Base Commit:** `16b094ebfa4eff76d903d391ee07c31a4d9a7be6` (Code) / `5018105` (TASK 023 Documentation Baseline)  
**Deployed Production Commit:** [`87261bc`](https://github.com/Coder-MayankSaini/trendzcart/commit/87261bc6aa52f6b0e8305e5165fd3f0324624a69)  
**Published Production Deploy ID:** [`6af358848c8957162298eb3c`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af358848c8957162298eb3c)  
**Netlify Build ID:** `6af358848c8957162298eb3a`  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo` / Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)  
**Unique Deploy URL:** [https://main--trendzcartdemo.netlify.app](https://main--trendzcartdemo.netlify.app)  
**Status:** **APPROVED, FULLY DEPLOYED TO PRODUCTION & 100% VERIFIED LIVE**  

---

## 1. Executive Summary & Objective

In e-commerce operations, custom-crafted, personalized, or engraved merchandise (e.g., custom name necklaces, photo mugs, bespoke printing) represents bespoke inventory tailored strictly to an individual customer. If a Cash on Delivery (COD) order containing personalized items is cancelled or rejected upon delivery (RTO), the product cannot be returned to stock or resold, creating irreversible inventory loss.

### Business Rule Objective:
**If the shopping cart contains even one customizable/personalized product, Cash on Delivery (COD) must be disabled for the entire cart.**  
Regular products must retain their existing COD eligibility.

### Implementation Summary:
1. **Authoritative Identification:** Personalization status is derived strictly from trusted catalog metadata in Cloud Firestore (`isCustomized: true`, `customizationType: "requires_name" | "requires_picture"`, or legacy `customizable` / `isPersonalized`) via the shared browser-safe utility `src/lib/orders/customizationEligibility.ts`. Standard products with size (`sizes: ["S", "M", "L"]`) or color options alone are NOT treated as customizable.
2. **Frontend Checkout Experience & Anti-Flicker Protection:** When a customizable product enters the cart, the COD payment option is disabled (`cursor: not-allowed`, muted opacity, disabled radio input), an "Unavailable for Custom Items" badge is displayed, and an explanation banner appears. During asynchronous catalog verification, a neutral "Checking eligibility..." state prevents premature selection. If catalog verification fails, the checkout fails-closed. If COD was previously selected, the payment method automatically resets to `"RAZORPAY"`. If all customized products are removed from the cart, COD eligibility is immediately restored.
3. **Cart & Storefront Notifications:**
   - **Cart Page (`/cart`):** Displays a personalized order notice informing customers that COD will be disabled at checkout.
   - **Product Detail Page (PDP):** Customizable products display `Prepaid Only (Personalized Item)` instead of `Cash on Delivery Available`. Regular products retain `Cash on Delivery Available`.
   - **Product Customizer (`ProductCustomizer.tsx`):** Consistently activates customization input fields based on `isCustomizableProduct` and forwards full customization payload to cart.
   - **Admin Product Editor (`/admin/products`):** Provides a clear COD restriction indicator under the "Customizable Product" setting, plus `Custom` and `Prepaid Only` badges in desktop tables and mobile cards.
4. **Mixed-Cart Protection:** If a cart contains a mix of regular products and personalized products (e.g., Regular Hoodie + Custom Photo Frame), the entire order is restricted to prepaid payment. The cart is NOT split, regular products are NOT removed, and customers complete checkout with secure online payment.
5. **Mandatory Server-Side Enforcement (`/api/orders/create`):** Inside the atomic Firestore transaction, the server reads the actual product documents from the database. If `paymentMethod === "COD"` and any item in `items` is customizable according to trusted catalog data, the request is immediately rejected with HTTP 400 and structured error code `COD_NOT_ALLOWED_CUSTOM_PRODUCT`. This check runs during the transaction read phase BEFORE any inventory decrement, coupon modification, or order persistence. Client-supplied flags are strictly ignored.
6. **Automated Verification:** 396 unique automated tests passing (99 unit + 297 integration including 39 security rules tests; 0 failures). 9 CDP visual QA screenshots captured across desktop and mobile viewports.
7. **Production Verification:** Deployed via Netlify remote Linux container build. 10/10 live verification checks passed on `https://bazaarvilla.com` (0 failures).

---

## 2. Production Baseline & Historical Release Audit

Prior to beginning TASK 027, the production repository state and Git commit history were audited:

- **Deployed Production Commit:** `16b094ebfa4eff76d903d391ee07c31a4d9a7be6` (Netlify Published Deploy ID: `6af34bfc4ee2926c4d5e5cdd`)
- **TASK 023 Verification:** 368 unique automated tests passing (85 unit + 283 integration including 39 rules).
- **All Preceding Releases Preserved:**
  - **TASK 017/018:** Razorpay Live Mode Cutover, ₹1 real-money purchase verification, quarantine isolation.
  - **TASK 020:** High-impact sale banner & brand identity baseline.
  - **TASK 021:** Mobile-responsive admin dashboard across all viewports.
  - **TASK 022:** Bulk product review management, audit provenance, and PDP review distributions.
  - **TASK 023:** Product purchase activity counter, admin toggle, and live simulation previews.
  - **TASK 024/025/026:** Product gallery isolation, hero layout repairs, and high-definition image sharpness.
- **Git Branch Creation:** Branched cleanly as `task/027-customizable-product-cod-restriction` from production commit `5018105` (code identical to `16b094e`).

---

## 3. Customizable Product Eligibility Definition

### Authoritative Catalog Metadata:
A product is recognized as customizable / personalized if and only if its trusted Firestore document satisfies any of the following:
- `isCustomized === true` (primary product schema flag set via Admin Product Editor).
- `customizationType === "requires_name"` (requires customer text / name engraving).
- `customizationType === "requires_picture"` (requires customer photo upload).
- `customizable === true` or `isPersonalized === true` (legacy/extensible schema compatibility).

### Non-Personalized Exclusions:
- Standard products with size selections (`sizes: ["S", "M", "L", "XL"]`) are **NOT** customizable.
- Standard products with color variations are **NOT** customizable.
- Regular apparel and lifestyle accessories remain 100% COD-eligible.

### Trust Boundary Isolation:
- **Client Flags Ignored:** A client sending `{ isCustomized: false }` for a catalog product that is personalized cannot bypass COD restrictions. The server checks the catalog.
- **Forged Client Flags Ignored:** A client sending `{ isCustomized: true }` for a standard product does not cause COD to be rejected; the server checks catalog truth.
- **Dynamic Configuration Handling:** If an administrator updates a product from regular to customizable in Firestore after a customer added it to their cart, the server reads the latest catalog state at checkout and enforces the restriction.
- **Fail-Safe Missing Record Handling:** If any cart product ID cannot be retrieved or verified in the database, the server rejects the order with HTTP 400 rather than risking an invalid COD order.

---

## 4. Frontend & Storefront Modifications & Anti-Flicker Gates

### 1. Shared Pure Utility (`src/lib/orders/customizationEligibility.ts`)
Created a browser-safe, pure TypeScript module exporting:
- `isCustomizableProduct(candidate)`: Single source of truth across client and server.
- `evaluateCodEligibility(items, catalog)`: Evaluates whole-cart eligibility and formats structured explanations.

### 2. Checkout Page Anti-Flicker & Fail-Closed Gates (`src/app/(storefront)/checkout/page.tsx`)
- **Anti-Flicker State Machine:**
  - `isCodBlocked = hasCustomizableItem`: Active immediately if client cart metadata indicates personalization or if catalog verification finds a customizable item.
  - `isCodPendingVerification`: Active while asynchronous catalog verification is in-flight. Renders neutral `Checking eligibility...` status and keeps COD unclickable to prevent flickering.
  - `isCodVerificationFailed`: Active if catalog verification encounters network errors or missing catalog IDs. Fails closed (`Verification unavailable`), ensuring unverified items cannot use COD.
  - `isCodAllowed = !isCodBlocked && !isCodPendingVerification && !isCodVerificationFailed`.
- **Automatic State Recovery:** If `!isCodAllowed && paymentMethod === "COD"`, automatically resets `paymentMethod` to `"RAZORPAY"`.
- **Disabled COD Option UI:**
  - `disabled={!isCodAllowed}` applied to radio input.
  - Muted opacity (`0.65`), disabled cursor (`cursor: not-allowed`), neutral background.
  - Interactive click prevention: clicking the card or input does not change payment method.
  - Badges: `Unavailable for Custom Items` (red), `Checking eligibility...` (slate), `Verification unavailable` (amber).
- **Prepaid Order Banner:** Prominent explanation banner rendered directly below payment methods when custom items are present.
- **Responsive Compatibility:** Fully tested across desktop (1440px) and mobile (390px, 430px) viewports.

### 3. Shopping Cart Page (`src/app/(storefront)/cart/page.tsx`)
- Uses `isCustomizableProduct` to display a personalized order notice informing customers that Cash on Delivery is disabled and online payment is required at checkout.

### 4. Product Detail Page (`src/app/(storefront)/products/[...slug]/page.tsx`)
- Replaced unconditional "Cash on Delivery Available" badge with `isCustomizableProduct(product)` logic:
  - If customizable: Displays `Prepaid Only (Personalized Item)` in sky blue (`#0369a1` on `rgba(14, 165, 233, 0.1)`).
  - If standard product: Retains `Cash on Delivery Available` in Bazaarvilla green (`#16a34a`).
- Passes full product metadata (`isCustomized`, `customizationType`, `customizable`, `isPersonalized`) to `ProductCustomizer`.

### 5. Product Customizer (`src/components/storefront/ProductCustomizer.tsx`)
- Standardized with `isCustomizableProduct(product)`:
  - Consistently renders customization input sections.
  - Attaches `isCustomized: true` and customization metadata to cart items on add.

### 6. Admin Product Management (`src/components/admin/AdminProducts.tsx`)
- **Creation/Edit Form:** Added explanatory notice under the "Customizable Product" setting:
  > Cash on Delivery (COD) will be automatically disabled at checkout for orders containing this product.
- **Desktop Table & Mobile Cards:** Displays `Custom` and `Prepaid Only` badges next to customized products.
- **Edit Initialization (`handleEdit`):** Initializes `isCustomized: isCustomizableProduct(prod)` ensuring legacy flags are recognized in the admin editor.

---

## 5. Mandatory Server-Side Enforcement (`/api/orders/create`)

The server-side validation is implemented in `src/app/api/orders/create/route.ts` inside the atomic `adminDb.runTransaction()` block:

```typescript
// MANDATORY SERVER-SIDE COD RESTRICTION (TASK 027)
if (body.paymentMethod === "COD") {
    const ineligibleItems: Array<{ id: string; name: string }> = [];

    for (const item of body.items) {
        const productId = item.productId || item.id;
        if (!productId) {
            return {
                status: 400,
                error: "Cannot process COD: order item is missing a valid product ID.",
            };
        }

        const docSnap = productMap.get(productId);
        if (!docSnap || !docSnap.exists) {
            return {
                status: 400,
                error: `Cannot process COD: Product '${productId}' not found in catalog.`,
            };
        }

        const prodData = docSnap.data();
        if (isCustomizableProduct(prodData)) {
            ineligibleItems.push({
                id: productId,
                name: prodData?.name || item.name || productId,
            });
        }
    }

    if (ineligibleItems.length > 0) {
        const itemNames = ineligibleItems.map((i) => `'${i.name}'`).join(", ");
        return {
            status: 400,
            code: "COD_NOT_ALLOWED_CUSTOM_PRODUCT",
            error: `Cash on Delivery is not available for orders containing customizable or personalized items (${itemNames}). Please select an online payment method to complete your purchase.`,
            ineligibleItems,
        };
    }
}
```

### Key Security & Transactional Guarantees:
1. **Read Phase Execution:** Runs strictly in the Firestore transaction READ phase before writes.
2. **Zero Side Effects on Rejection:** If rejected, transaction returns early before write phase. No order document is created, 0 inventory is decremented, and coupon `timesUsed` is not incremented.
3. **Structured Error Payload:** Returns HTTP 400 with `{ error, code: "COD_NOT_ALLOWED_CUSTOM_PRODUCT", ineligibleItems }`.
4. **Prepaid Rail Continuity:** Razorpay prepaid orders (`paymentMethod === "RAZORPAY"`) are completely unaffected and proceed through payment capture.

---

## 6. Automated Testing Verification & Results

### Test Suite Execution Summary:

| Suite | Command | Total Tests | Passing | Failing | Description |
|---|---|---|---|---|---|
| **Unit Tests** | `npm test` | **99** | 99 | 0 | Pricing, staging guard, admin responsive, admin gallery, storefront quality, reviews validation, purchase activity, and **COD customization restriction (`COD-UNIT-001` to `COD-UNIT-014`)**. |
| **Rules Tests** | `npm run test:rules` | **39** | 39 | 0 | Firestore and Storage security rules (subset of integration tests). |
| **Integration Tests** | `npm run test:integration` | **297** | 297 | 0 | 23 integration suites on Firebase emulator, including **COD restriction integration suite (`COD-INT-001` to `COD-INT-014`)**. |
| **TypeScript Typecheck** | `npm run typecheck` | N/A | Pass | 0 | `tsc --noEmit` clean compile (0 errors). |
| **Next.js Production Build** | `npm run build` | 35 routes | Pass | 0 | All 35 routes compiled cleanly with Turbopack. |
| **TOTAL UNIQUE AUTOMATED TESTS** | All Suites | **396** | **396** | **0** | **100% PASSING (Zero double-counting; +28 tests over TASK 023 baseline).** |

### TASK 027 Test Criteria Matrix:

| Test ID | Test Category | Scenario Verified | Outcome |
|---|---|---|---|
| `COD-UNIT-001` | Unit | Standard product with `isCustomized: false` returns false | **PASS** |
| `COD-UNIT-002` | Unit | Standard product with size variants alone (`sizes: ["S", "M", "L"]`) returns false | **PASS** |
| `COD-UNIT-003` | Unit | Product with `isCustomized: true` returns true | **PASS** |
| `COD-UNIT-004` | Unit | Product with `customizationType: "requires_name"` returns true | **PASS** |
| `COD-UNIT-005` | Unit | Product with `customizationType: "requires_picture"` returns true | **PASS** |
| `COD-UNIT-006` | Unit | Backwards-compatible `customizable: true` / `isPersonalized: true` return true | **PASS** |
| `COD-UNIT-007` | Unit | Null/undefined/empty input fail-safely returns false | **PASS** |
| `COD-UNIT-008` | Unit | Regular products only → COD eligible | **PASS** |
| `COD-UNIT-009` | Unit | One personalized product in cart → COD strictly blocked | **PASS** |
| `COD-UNIT-010` | Unit | Multiple personalized products → COD blocked and all items listed | **PASS** |
| `COD-UNIT-011` | Unit | Mixed cart (regular apparel + custom product) → COD blocked | **PASS** |
| `COD-UNIT-012` | Unit | Removing all personalized products restores COD eligibility | **PASS** |
| `COD-UNIT-013` | Unit | Personalized product with empty customization fields → COD blocked | **PASS** |
| `COD-UNIT-014` | Unit | Forged client flag (`isCustomized: true` on regular product) ignored | **PASS** |
| `COD-INT-001` | Integration | Regular product only → COD order created with status `PENDING` / `Processing` | **PASS** |
| `COD-INT-002` | Integration | One personalized product → rejected with HTTP 400 and structured code | **PASS** |
| `COD-INT-003` | Integration | Multiple personalized products → rejected with HTTP 400, listing both items | **PASS** |
| `COD-INT-004` | Integration | Mixed cart (regular hoodie + custom frame) → rejected with HTTP 400 | **PASS** |
| `COD-INT-005` | Integration | Removing custom product leaving regular items → COD succeeds | **PASS** |
| `COD-INT-006` | Integration | Product with size choices alone → COD succeeds (sizes != personalized) | **PASS** |
| `COD-INT-007` | Integration | Personalized product with empty customization payload → COD blocked | **PASS** |
| `COD-INT-008` | Integration | Forged client flag on regular product → ignored, COD succeeds | **PASS** |
| `COD-INT-009` | Integration | Direct API request attempting COD on custom product → strictly rejected | **PASS** |
| `COD-INT-010` | Integration | Rejected COD attempt produces NO order, inventory, or coupon side effects | **PASS** |
| `COD-INT-011` | Integration | Prepaid Razorpay checkout works cleanly for customizable products | **PASS** |
| `COD-INT-012` | Integration | Product dynamically updated to customized in DB → subsequent COD rejected | **PASS** |
| `COD-INT-013` | Integration | Product dynamically updated to regular in DB → subsequent COD allowed | **PASS** |
| `COD-INT-014` | Integration | Unverifiable / non-existent product in catalog fails safely with HTTP 400 | **PASS** |

---

## 7. Visual Verification Evidence (Screenshots)

All 9 visual QA screenshots were captured via Chrome DevTools Protocol (CDP) and are archived in `docs/screenshots/task027/`:

| Screenshot File | Viewport | Description |
|---|---|---|
| `01-pdp-regular-cod-available.png` | 1440×900 | PDP for standard product showing "Cash on Delivery Available" in green. |
| `02-pdp-customizable-prepaid-only.png` | 1440×900 | PDP for custom photo frame showing "Prepaid Only (Personalized Item)" badge. |
| `03-cart-customizable-note-desktop.png` | 1440×900 | Shopping cart desktop view showing personalized order note in order summary. |
| `04-cart-customizable-note-mobile.png` | 390×844 | Shopping cart mobile view showing responsive personalized order note. |
| `05-checkout-regular-cod-available-desktop.png` | 1440×900 | Checkout with standard hoodie showing COD enabled and selectable. |
| `06-checkout-customizable-cod-blocked-desktop.png` | 1440×900 | Checkout with custom item showing disabled COD, badge, and explanation banner. |
| `07-checkout-mixed-cart-cod-blocked-desktop.png` | 1440×900 | Mixed cart (hoodie + custom frame) showing COD disabled for entire order. |
| `08-checkout-customizable-cod-blocked-mobile.png` | 390×844 | Mobile checkout view showing disabled COD card, badge, and explanation notice. |
| `09-admin-products-table-badges.png` | 1440×900 | Admin products dashboard showing `Custom` and `Prepaid Only` badges. |

---

## 8. Subsequent Feature Backlog (Preserved)

As required by TASK 027 instructions, the following roadmap features are strictly preserved in the backlog:
1. **Product image containment with `object-fit: contain`** (preserves aspect ratios across catalogs).
2. **Flexible product sizing, dimensions, and color variants** (expanded SKU attributes).
3. **Shopify-compatible CSV bulk product importer** (mass catalog onboarding).

---

## 9. Production Deployment & Live Verification Evidence

Conditional deployment authorization was granted by the store owner following review of the implementation, security checks, anti-flicker gates, and regression test suites.

### Production Deployment Execution:
- **Command:** `npx netlify deploy --remote --prod --message "TASK 027 - Customizable Product COD Restriction"`
- **Git Commit:** [`87261bc`](https://github.com/Coder-MayankSaini/trendzcart/commit/87261bc6aa52f6b0e8305e5165fd3f0324624a69)
- **Netlify Published Deploy ID:** [`6af358848c8957162298eb3c`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af358848c8957162298eb3c)
- **Netlify Build ID:** `6af358848c8957162298eb3a`
- **Secrets Scan:** 122 files scanned — 0 secrets detected.
- **Scheduled Functions:** `reservation-cleanup` active (`*/5 * * * *`).
- **Site Status:** Site is live ✨

### Post-Deployment Live Verification Results (`scripts/verify-live-task027.mjs`):
Executed post-deployment automated verification against live host `https://bazaarvilla.com` (**10/10 checks passed**):

| # | Check Area | Description | Live Outcome | Status |
|---|---|---|---|---|
| **1** | **PDP Indicators** | Personalized necklace (`/products/personalized-eyes-...`) contains "Prepaid Only (Personalized Item)" and omits "Cash on Delivery Available". | HTTP 200, contains Prepaid Only=true, COD Available=false | **PASSED** |
| **2** | **Catalog Metadata** | Live Firestore document `82b5c865-3128-4515-96e5-80f7f0eed58e` evaluated authoritatively with `isCustomizableProduct`. | Exists=true, `isCustomizableProduct=true` | **PASSED** |
| **3** | **COD API Enforcement** | Direct `POST /api/orders/create` attempting COD order on personalized item with forged client flags. | HTTP 400, `code: "COD_NOT_ALLOWED_CUSTOM_PRODUCT"` | **PASSED** |
| **4** | **Zero Side Effects** | Rejected COD attempt produces NO order document and leaves product inventory untouched. | Order doc created=false, inventory unchanged (10 -> 10) | **PASSED** |
| **5** | **Mixed Cart Rule** | Algorithmic whole-cart evaluation: cart containing regular items + custom necklace is strictly ineligible. | `isEligible=false`, `code: "COD_NOT_ALLOWED_CUSTOM_PRODUCT"` | **PASSED** |
| **6** | **Regular Cart Rule** | Cart containing only regular non-customized products retains COD eligibility. | `isEligible=true` | **PASSED** |
| **7** | **Razorpay Live Mode** | `GET /api/razorpay/public-config` returns active Live Mode credentials with open commercial checkout. | HTTP 200, `commercialCheckoutEnabled: true`, key starts `rzp_live_` | **PASSED** |
| **8** | **Review System (TASK 022)** | Public review retrieval API remains fully operational. | HTTP 200, array returned cleanly | **PASSED** |
| **9** | **Purchase Counter (TASK 023)** | Public purchase activity counter API remains fully operational. | HTTP 200, sanitized metrics returned | **PASSED** |
| **10** | **Core Storefront Routes** | Core storefront entry points (`/`, `/cart`, `/checkout`, `/categories`) return healthy responses without errors. | All routes returned HTTP 200 | **PASSED** |

---

## 10. Rollback & Disaster Recovery Procedures

1. **Immediate Netlify Rollback:** If unexpected production anomalies occur, publish the previous verified deployment immediately:
   - Deploy ID: [`6af34bfc4ee2926c4d5e5cdd`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af34bfc4ee2926c4d5e5cdd) (TASK 023 baseline).
2. **Git Rollback Reference:** Revert to commit `16b094ebfa4eff76d903d391ee07c31a4d9a7be6`.
3. **Database Integrity:** Zero destructive migrations were performed. Customer orders and catalog records remain completely intact and backwards-compatible.
