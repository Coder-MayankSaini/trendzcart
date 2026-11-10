# TASK 027 — Bazaarvilla Customizable Product COD Restriction

**Task ID:** TASK-027  
**Date:** 2026-11-10  
**Investigator / Engineer:** Principal Full-Stack Engineer, E-Commerce Security Architect, Payment Integrity Specialist  
**Primary Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5, Firebase Auth, Cloud Firestore (Spark plan), Cloudflare R2, Razorpay Live Mode (2.9.6), Netlify Hosting  
**Git Branch:** `task/027-customizable-product-cod-restriction`  
**Base Commit:** `16b094ebfa4eff76d903d391ee07c31a4d9a7be6` (Code) / `5018105` (TASK 023 Documentation Baseline)  
**Latest Production Deploy ID:** [`6af34bfc4ee2926c4d5e5cdd`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af34bfc4ee2926c4d5e5cdd)  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo`)  
**Status:** **LOCALLY COMPLETE & VERIFIED — AWAITING EXPLICIT OWNER APPROVAL FOR PRODUCTION DEPLOYMENT**  

---

## 1. Executive Summary & Objective

In e-commerce operations, custom-crafted, personalized, or engraved merchandise (e.g., custom name necklaces, photo mugs, bespoke printing) represents bespoke inventory tailored strictly to an individual customer. If a Cash on Delivery (COD) order containing personalized items is cancelled or rejected upon delivery (RTO), the product cannot be returned to stock or resold, creating irreversible inventory loss.

### Business Rule Objective:
**If the shopping cart contains even one customizable/personalized product, Cash on Delivery (COD) must be disabled for the entire cart.**  
Regular products must retain their existing COD eligibility.

### Implementation Summary:
1. **Authoritative Identification:** Personalization status is derived strictly from trusted catalog metadata in Cloud Firestore (`isCustomized: true`, `customizationType: "requires_name" | "requires_picture"`, or legacy `customizable` / `isPersonalized`). Standard products with size (`sizes: ["S", "M", "L"]`) or color options alone are NOT treated as customizable.
2. **Frontend Checkout Experience:** When a customizable product enters the cart, the COD payment option is disabled (`cursor: not-allowed`, muted opacity, disabled radio input), an "Unavailable for Custom Items" badge is displayed, and an explanation banner appears. If COD was previously selected, the payment method automatically resets to `"RAZORPAY"`. If all customized products are removed from the cart, COD eligibility is immediately restored.
3. **Cart & Storefront Notifications:**
   - **Cart Page (`/cart`):** Displays a personalized order notice informing customers that COD will be disabled at checkout.
   - **Product Detail Page (PDP):** Customizable products display `Prepaid Only (Personalized Item)` instead of `Cash on Delivery Available`. Regular products retain `Cash on Delivery Available`.
   - **Admin Product Editor (`/admin/products`):** Provides a clear COD restriction indicator under the "Customizable Product" setting, plus `Custom` and `Prepaid Only` badges in desktop tables and mobile cards.
4. **Mixed-Cart Protection:** If a cart contains a mix of regular products and personalized products (e.g., Regular Hoodie + Custom Photo Frame), the entire order is restricted to prepaid payment. The cart is NOT split, regular products are NOT removed, and customers complete checkout with secure online payment.
5. **Mandatory Server-Side Enforcement (`/api/orders/create`):** Inside the atomic Firestore transaction, the server reads the actual product documents from the database. If `paymentMethod === "COD"` and any item in `items` is customizable according to trusted catalog data, the request is immediately rejected with HTTP 400 and structured error code `COD_NOT_ALLOWED_CUSTOM_PRODUCT`. This check runs during the transaction read phase BEFORE any inventory decrement, coupon modification, or order persistence. Client-supplied flags are strictly ignored.
6. **Automated Verification:** 396 unique automated tests passing (99 unit + 297 integration including 39 security rules tests; 0 failures). 9 CDP visual QA screenshots captured across desktop and mobile viewports.

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

## 4. Frontend & Storefront Modifications

### 1. Checkout Page (`src/app/(storefront)/checkout/page.tsx`)
- **Authoritative Cart Computation:** Uses `useMemo` to check `item.isCustomized` and `item.customizationData`. In addition, an asynchronous `useEffect` verifies cart product IDs against Cloud Firestore to handle stale local storage sessions.
- **Automatic State Recovery:** If `hasCustomizableItem` is true and `paymentMethod === "COD"`, a reactive `useEffect` automatically switches `paymentMethod` to `"RAZORPAY"`.
- **Disabled COD Option UI:**
  - `disabled={hasCustomizableItem}` applied to radio input.
  - Muted opacity (`0.65`), disabled cursor (`cursor: not-allowed`), neutral background.
  - Interactive click prevention: clicking the card or input does not change payment method.
  - Badge: `Unavailable for Custom Items` rendered with high contrast (`#fee2e2` / `#b91c1c`).
  - Subtitle updated to: `"Personalized products require upfront online payment"`.
- **Prepaid Order Banner:** Prominent explanation banner rendered directly below payment methods:
  > **Prepaid Only for Personalized Items:** Your cart contains customized products. Because personalized items are crafted specifically for you upon receiving the order, Cash on Delivery is disabled for this entire order. Please complete your purchase securely with online payment (UPI, Cards, NetBanking).
- **Responsive Compatibility:** Fully tested across desktop (1440px) and mobile (390px, 430px) viewports.

### 2. Shopping Cart Page (`src/app/(storefront)/cart/page.tsx`)
- Added order-summary notice above checkout trigger:
  > **Personalized Order:** Cart includes custom items. Cash on Delivery is disabled; online payment (UPI/Cards) required at checkout.

### 3. Product Detail Page (`src/app/(storefront)/products/[...slug]/page.tsx`)
- Replaced unconditional "Cash on Delivery Available" badge with conditional logic:
  - If `product.isCustomized`: Displays `Prepaid Only (Personalized Item)` in sky blue (`#0369a1` on `rgba(14, 165, 233, 0.1)`).
  - If standard product: Retains `Cash on Delivery Available` in Bazaarvilla green (`#16a34a`).

### 4. Admin Product Management (`src/components/admin/AdminProducts.tsx`)
- **Creation/Edit Form:** Added explanatory notice under the "Customizable Product" setting:
  > Cash on Delivery (COD) will be automatically disabled at checkout for orders containing this product.
- **Desktop Table & Mobile Cards:** Displays `Custom` and `Prepaid Only` badges next to customized products.

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
1. **Read Phase Execution:** Runs strictly in the Firestore transaction READ phase.
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

As required by TASK 027 instructions, the following roadmap features are preserved in the backlog and were NOT implemented:
1. Product image containment with `object-fit: contain`.
2. Flexible product sizing and color variants.
3. Shopify-compatible CSV bulk product importer.

---

## 9. Production Deployment Readiness & Approval Gate

### Deployment Risk Assessment:
- **Financial Risk:** Zero. Razorpay Live Mode credentials, HMAC signature verification, and server-to-server payment verification (`verifyPaymentWithGateway`) remain completely untouched and verified.
- **Order Security:** Improved. Transactional validation blocks non-resellable personalized products from unpaid COD processing while preserving legitimate COD checkouts for standard catalog items.
- **Database Migrations:** Zero destructive data migrations performed; existing catalog records and customer orders are 100% preserved.
- **Rollback Plan:** Clean Git revert to commit `16b094ebfa4eff76d903d391ee07c31a4d9a7be6` (published Netlify deploy `6af34bfc4ee2926c4d5e5cdd`).

> [!IMPORTANT]
> **Production Deployment Safety Gate:**
> In strict compliance with Section 8 of the prompt, **no Netlify production deployment has been performed.**
> All changes are committed and verified locally on branch `task/027-customizable-product-cod-restriction`.
> Production deployment is safely paused awaiting explicit owner authorization.
