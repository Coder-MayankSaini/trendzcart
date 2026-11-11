# TASK 029 — Bazaarvilla Flexible Product Sizes, Dimensions, Color Variants & Inventory Integrity Hardening

**Task ID:** TASK-029  
**Branch:** `task/029-flexible-product-variants`  
**Base Commit:** `8d7c843` (Documentation Commit following TASK 028 Deployed Production Baseline `3e7ff7000ab80681867889865e461c052070e104`)  
**Hardened Implementation Commit:** `b0dbdd2bd77cd72560d5f416ca6bfff95fd9180c` (`b0dbdd2`)  
**Production Site:** `https://bazaarvilla.com` (Netlify Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)  
**Published Deploy Baseline:** `6af369e6cbfc6c42b6b41349`  
**Automated Test Baseline Before:** 407 unique automated tests (110 unit + 297 integration)  
**Initial Task 029 Test Suite:** 432 unique automated tests (135 unit + 297 integration)  
**Hardened Test Suite After (Current):** **457 unique automated tests** (135 unit + 322 integration across 24 suites; 100% pass rate)  
**Security Rules Sub-suite:** 39 / 39 passed (included in integration total; zero double-counting)  
**Production Deployment Status:** **TASK 029 — LOCAL IMPLEMENTATION HARDENED, PRODUCTION APPROVAL PENDING.** (Strict Zero-Auto-Deploy Compliance)

---

## 1. Executive Summary & Production Hardening Scope

Following the initial architectural completion of TASK 029, a mandatory financial and inventory integrity audit was conducted prior to production release approval. 

Because TASK 029 modifies the financial calculation, reservation, and inventory lifecycle of a commercially live store, unit tests alone were recognized as insufficient to guarantee reliable transactional behavior under high concurrency and multi-item orders.

### Core Hardening Deliverables:
1. **Multi-Variant Same-Product Transaction Integrity:**
   - Audited all loops updating parent product documents within Firestore transactions (`orders/create`, `createPendingPrepaidOrder`, `releaseExpiredReservation`, `finalizeOrderPayment`, and `cancelOrder`).
   - Completely eliminated silent stock clamping (`Math.max(0, inventory - quantity)`).
   - Enforced fail-closed pre-validation within the transaction: if any variant or product lacks requested stock, the entire transaction is rejected with HTTP 400 before touching the database.
2. **25 Real Firebase Emulator Integration Tests Added:**
   - Expanded the integration test baseline from **297 to 322 integration tests** (+25 tests in `tests/integration/product-variants-lifecycle.test.ts`), bringing total unique automated tests to **457 tests**.
   - Verified multi-variant deductions, split personalized lines, high-concurrency contention on scarce variants, price tampering, missing/forged variant IDs, reservation release, late payment recovery, COD eligibility vs personalization, and idempotent cancellations.
3. **Variant ID & Cart Protection:**
   - For products with `hasVariants: true`, an authoritative `variantId` is strictly required.
   - Missing, forged, or cross-product variant IDs are rejected immediately with HTTP 400 without generic base-price or top-level inventory fallbacks.
   - Size and color selections are validated against authoritative catalog metadata.
4. **Oversized Matrix Handling (> 100 Variants):**
   - Eliminated silent matrix truncation.
   - Attempting to generate > 100 combinations rejects with an explicit validation error stating the requested count and the limit, preserving the previously valid matrix.
   - Conservative stock defaults (0 units) are used for newly generated variants to prevent inventing phantom sellable inventory.
5. **Active vs. Disabled Inventory Aggregation Semantics:**
   - Established explicit semantics distinguishing **Sellable Stock** (`inventory`), **Total Physical Stock** (`totalPhysicalInventory`), and **Disabled Stock** (`disabledStock`).
   - Temporarily disabling a variant preserves its physical stock count in accounting without losing units or double-counting upon re-activation.
6. **Active-Reservation Data Loss Prevention:**
   - Rebuilding or modifying matrices while customers hold pending reservations preserves variant IDs.
   - If an admin deletes or modifies a variant during an active reservation, `releaseExpiredReservation` and `cancelOrder` safely restore the variant into the collection as inactive rather than dropping stock.
7. **Production Isolation:**
   - Zero live production catalog data, live orders, or live payments were modified. All hardening was executed against the local Firebase Emulator.

---

## 2. Multi-Variant Transaction Audit & Findings

### 2.1 The Silent Clamping Vulnerability (`Math.max(0, ...)`)
- **Audit Discovery:**
  Earlier implementations of variant deduction in `orders/create/route.ts` and `paymentLifecycle.ts` utilized:
  ```typescript
  return { ...v, inventory: Math.max(0, (Number(v.inventory) || 0) - dec) };
  ```
- **Risk:**
  If a customer requested 5 units of a variant that only had 2 units in stock, or under concurrent checkout requests before transaction isolation locks acquired the document, `Math.max(0, 2 - 5)` would evaluate to `0`. The order would succeed, and 3 units of merchandise would be oversold without stock backing.
- **Remediation:**
  Replaced with an authoritative pre-transaction check across all variant decrements:
  ```typescript
  // STRICT PRE-CHECK: Validate every variant stock before writing
  for (const [vId, decQty] of variantDecrements.entries()) {
      const v = prodData.variants.find((variant: any) => variant.id === vId);
      if (!v) {
          return { status: 400, error: `Variant '${vId}' not found on product.` };
      }
      const currentStock = Number(v.inventory) || 0;
      if (currentStock < decQty) {
          return {
              status: 400,
              error: `Insufficient stock for variant '${vId}'. Available: ${currentStock}, requested: ${decQty}.`,
          };
      }
  }

  // Exact decrement with underflow protection
  const updatedVariants = prodData.variants.map((v: any) => {
      const dec = variantDecrements.get(v.id) || 0;
      if (dec > 0) {
          const currentStock = Number(v.inventory) || 0;
          const newStock = currentStock - dec;
          if (newStock < 0) {
              throw new Error(`Negative inventory underflow prevented for variant ${v.id}`);
          }
          return { ...v, inventory: newStock };
      }
      return v;
  });
  ```

### 2.2 Parent Document Overwrite Audit
- **Audit Question:**
  Do loops that update the same parent product document multiple times inside a single transaction overwrite earlier variant deductions?
- **Inspection Findings:**
  Both `orders/create/route.ts` and `paymentLifecycle.ts` aggregate unique product IDs:
  ```typescript
  const uniquePIds = Array.from(new Set(pricing.validatedItems.map((item) => item.productId)));
  ```
  Within each product iteration, a `variantDecrements` Map groups deductions across **all** line items referencing that product. `transaction.update(productRef, ...)` is called **exactly once per product document** with the unified `updatedVariants` array and recalculated aggregate `inventory`. Subsequent variant updates never overwrite earlier deductions.
- **Multi-Line Deduction Test (`VAR-INT-001`, `VAR-INT-003`):**
  - Product initialized with:
    - `Black XL`: 5 units
    - `White M`: 3 units
    - Total aggregate: 8 units
  - Order placed with:
    - `Black XL` × 2
    - `White M` × 1
  - Verified Final State:
    - `Black XL` = 3
    - `White M` = 2
    - Parent `inventory` = 5
    - Order document snapshots both line items with distinct SKUs, sizes, colors, and prices.
    - Zero updates lost.

---

## 3. Complete Integration Test Suite (25 New Emulator Tests)

All 25 tests were implemented in `tests/integration/product-variants-lifecycle.test.ts` and verified against the local Firebase Emulator:

| Test ID | Test Scenario | Expected Behavior | Emulator Result |
|---|---|---|---|
| `VAR-INT-001` | Two different variants of same product in one order | Black XL (5 -> 3), White M (3 -> 2), parent stock (8 -> 5); single order snapshots both variants | **PASS** (408ms) |
| `VAR-INT-002` | Multiple quantities of same variant in single line | Black XL (5 -> 1) when ordered with quantity = 4 | **PASS** (94ms) |
| `VAR-INT-003` | Two lines containing same variant (separate personalizations) | Line 1 (qty 1, text A) + Line 2 (qty 2, text B) -> aggregates deduction to 3; stock becomes 2 | **PASS** (68ms) |
| `VAR-INT-004` | Concurrent checkout on scarce variant (Stock = 1) | Exactly 1 order succeeds (HTTP 200), 1 fails (HTTP 400); stock ends at 0, never negative | **PASS** (112ms) |
| `VAR-INT-005` | Concurrent checkout on different variants of same product | Alice buys Black XL (5 -> 4), Bob buys White M (3 -> 2); both succeed, neither overwrites | **PASS** (105ms) |
| `VAR-INT-006` | Insufficient variant inventory side effects | Requested 4 when stock is 3 -> HTTP 400; zero orders created; stock remains 3 | **PASS** (62ms) |
| `VAR-INT-007` | Variant price tampering | Client sends price = 10 for ₹1199 variant -> rejected with 400 Order Total Mismatch | **PASS** (55ms) |
| `VAR-INT-008` | Missing variantId on variant-managed product | Order item omits variantId -> strictly rejected with 400 (no fallback to base product) | **PASS** (51ms) |
| `VAR-INT-009` | Forged variantId belonging to another product | Client sends cap variantId on T-shirt product -> strictly rejected with 400 | **PASS** (49ms) |
| `VAR-INT-010` | Disabled variant purchase attempt | Variant with `isActive: false` -> strictly rejected with 400 (currently unavailable) | **PASS** (78ms) |
| `VAR-INT-011` | Saved cart containing outdated variant ID | Non-existent variant ID -> strictly rejected with 400 | **PASS** (61ms) |
| `VAR-INT-012` | Razorpay order creation & amount calculation | Black XL (₹1199) × 2 -> creates pending order with 239800 paise, reserves stock (5 -> 3) | **PASS** (60ms) |
| `VAR-INT-013` | Duplicate payment webhook events | Repeated `payment.captured` webhooks processed idempotently; variant stock decremented once | **PASS** (175ms) |
| `VAR-INT-014` | Expired reservation restoring exact variant | Prepaid order expires -> `releaseExpiredReservation` restores exact White M stock back to 3 | **PASS** (108ms) |
| `VAR-INT-015` | Multi-variant reservation release | Order with Black XL x 2 and White M x 1 expires -> restores Black XL (+2) and White M (+1) | **PASS** (142ms) |
| `VAR-INT-016` | Late payment after reservation release | Stock released and taken by another buyer -> late capture flags `Pending_Reconciliation` without overselling | **PASS** (218ms) |
| `VAR-INT-017` | COD transaction with ordinary variants | Standard size/color variant ordered via COD -> HTTP 200, status "Processing", stock decremented | **PASS** (84ms) |
| `VAR-INT-018` | COD transaction with personalized variants | Personalized variant (`requires_picture`) ordered via COD -> HTTP 400 `COD_NOT_ALLOWED_CUSTOM_PRODUCT` | **PASS** (73ms) |
| `VAR-INT-019` | Existing legacy product with no variants | Legacy product without `hasVariants` -> HTTP 200, decrements legacy `inventory` correctly | **PASS** (59ms) |
| `VAR-INT-020` | Immutable variant details in final order | Verified order item snapshot contains `variantId`, `sku`, `size`, `color`, `price`, `itemSubtotal` | **PASS** (64ms) |
| `VAR-INT-021` | Coupon calculations based on variant prices | 10% coupon on ₹1199 variant -> discount ₹119.9, total ₹1079.10 (not based on base price) | **PASS** (66ms) |
| `VAR-INT-022` | Admin modification during active reservation | Admin deletes variant while reservation active -> release restores variant as inactive without lost stock | **PASS** (150ms) |
| `VAR-INT-023` | Reservation cleanup idempotency | `runReservationCleanup` executed twice on expired variant order -> releases stock exactly once | **PASS** (172ms) |
| `VAR-INT-024` | Order cancellation stock restoration policy | `cancelOrder` restores exact variant stock; repeated cancellation call safely no-ops | **PASS** (188ms) |
| `VAR-INT-025` | High concurrency negative inventory guard | 5 concurrent requests for 1 unit each on stock = 3 -> exactly 3 succeed, 2 fail; stock = 0 | **PASS** (3393ms) |

---

## 4. Variant Matrix Limit & Oversized Handling Policy

### 4.1 Strict Limit Enforcement (`MAX_VARIANT_LIMIT = 100`)
- **Previous Defect:**  
  When an administrator configured combinations exceeding 100 (e.g. 12 sizes × 10 colors = 120), the matrix generator generated the first 100 and silently dropped the remaining 20.
- **Hardened Implementation:**  
  `generateVariantMatrix` calculates `requestedCount` prior to generation:
  ```typescript
  if (requestedCount > limit) {
      return {
          variants: options?.existingVariants ? [...options.existingVariants] : [],
          exceededLimit: true,
          requestedCount,
          limit,
          error: `Cannot generate variants: ${requestedCount} combinations were requested, which exceeds the supported limit of ${limit}. Please reduce the number of active sizes or colors.`,
      };
  }
  ```
- **Admin UI Behavior (`AdminProducts.tsx`):**
  If `exceededLimit === true`:
  - Alerts the merchant: *"Cannot generate variants: 120 combinations were requested, which exceeds the supported limit of 100. Please reduce the number of active sizes or colors."*
  - **Preserves previously valid matrix:** Does not modify or overwrite `formData.variants`.
  - **Prevents partial saves:** The save handler will not save an incomplete or truncated matrix.
- **Conservative Stock Defaults:**
  Newly generated variants default to `inventory: 0` (rather than inventing 10 units of sellable inventory). Merchants must explicitly enter physical stock counts before variants become purchasable.

---

## 5. Active vs. Disabled Inventory Aggregation Semantics

To prevent inventory from vanishing from accounting or double-counting upon re-activation, Bazaarvilla adopts an explicit 3-tier inventory model:

```typescript
export interface VariantStockBreakdown {
    sellableStock: number;       // Sum of stock from active variants (isActive !== false)
    totalPhysicalStock: number;  // Total physical inventory across all variants (active + disabled)
    disabledStock: number;       // Physical inventory held in disabled variants (isActive === false)
    variantCount: number;
    activeVariantCount: number;
    disabledVariantCount: number;
}
```

### Semantics & Guarantees:
1. **Sellable Stock (`product.inventory`):**
   - Populated with `breakdown.sellableStock`.
   - Used by storefront category listings, search results, and legacy inventory checks.
   - If a merchant disables a variant holding 15 physical units, `sellableStock` decreases by 15. Storefront shoppers cannot purchase or add disabled items to cart.
2. **Total Physical Stock (`product.totalPhysicalInventory`):**
   - Populated with `breakdown.totalPhysicalStock`.
   - Preserves complete warehouse/accounting stock count. The 15 units remain fully accounted for.
3. **Variant Record Persistence:**
   - Disabling a variant toggles `isActive: false` on the variant object. It **never** mutates or zeroes `v.inventory`.
   - When the variant is re-enabled (`isActive: true`), its 15 units immediately return to `sellableStock` without any manual re-entry or double counting.
4. **Transaction Synchronization:**
   - Both `orders/create/route.ts` and `paymentLifecycle.ts` compute `calculateVariantStockBreakdown(updatedVariants)` and persist both `inventory` and `totalPhysicalInventory` synchronously.

---

## 6. Active-Reservation Data Loss Prevention Policy

If an administrator modifies, deletes, or regenerates product variants while shoppers hold active pending prepaid reservations (15-minute window):

1. **Stable Identifier Preservation:**
   - Variant IDs follow deterministic formats (`var_{sizeId}_{colorId}`).
   - Matrix regeneration preserves custom SKUs, prices, stock, and photos by matching existing IDs.
2. **Safe Restoration on Expiration or Cancellation:**
   - In `releaseExpiredReservation` and `cancelOrder`:
     If an item's `variantId` cannot be found in `product.variants` (because an admin removed the variant during the 15-minute checkout window), the system **will not drop the stock**.
     It reconstructs the variant record from the immutable order item snapshot:
     ```typescript
     if (!existingVariantIds.has(vId)) {
         updatedVariants.push({
             id: vId,
             sizeName: itemSnapshot?.size || "",
             colorName: itemSnapshot?.color || "",
             sku: itemSnapshot?.sku || "",
             price: itemSnapshot?.price ?? null,
             inventory: incQty,
             isActive: false, // Restored as inactive so it does not become purchasable unexpectedly
             dimensions: itemSnapshot?.dimensions,
         });
     }
     ```
3. **Immutable Snapshot Integrity:**
   - All completed orders retain immutable snapshots (`variantId`, `sku`, `size`, `color`, `dimensions`, `price`, `itemSubtotal`).
   - Admin fulfillment screens render historical order details directly from the order record regardless of catalog modifications.

---

## 7. Automated Test & Build Execution Summary

### 7.1 Automated Test Suites

| Test Suite | Execution Command | Result | Pass Rate |
|---|---|---|---|
| **Unit Tests** | `npm test` | **135 / 135 passed** (18 suites) | **100% PASS** |
| **Firestore Rules & Claims** | `npm run test:rules` | **39 / 39 passed** (3 suites) | **100% PASS** |
| **Integration Test Suite** | `npm run test:integration` | **322 / 322 passed** (24 suites) | **100% PASS** |
| **TypeScript Typecheck** | `npm run typecheck` | **0 errors** | **100% PASS** |
| **Next.js Production Build** | `npm run build` | **35 / 35 routes** compiled cleanly | **100% PASS** |

### 7.2 Exact Test Counts (Zero Double-Counting)
- **Unit Tests:** 135 unique tests across 10 files.
- **Integration Tests:** 322 unique tests across 24 test suites (includes 39 Firestore/Storage security rules tests).
- **Total Unique Tests:** **457 automated tests** (all passing against the emulator).
- **Baseline Increase:** +25 integration tests compared to the TASK 028 baseline of 297 integration tests.

---

## 8. Security Rules & Index Requirements

1. **Firestore Rules Inspection:**
   - `/products/{productId}` rules already strictly enforce `allow create, update, delete: if isAdmin();`.
   - Public clients are restricted to read-only access for visible products (`resource.data.isVisible == true`).
   - Browser customers **cannot** modify `product.variants` or `product.inventory` directly.
   - All order creation and inventory adjustments occur exclusively via server Route Handlers using the Firebase Admin SDK (`adminDb`).
2. **Index Requirements:**
   - Product variants are embedded directly within the parent `products/{productId}` document inside the `variants` array.
   - Because variants are co-located in the parent document, **no new Firestore composite indexes or collection group queries are required**.
   - All variant queries and deductions execute atomically within existing document-level transaction locks.
3. **Firestore Document Size Limit Safeguard:**
   - Firestore documents have a hard size limit of 1 MiB (1,048,576 bytes).
   - A fully populated variant record uses approximately 250 bytes.
   - At the hard cap of 100 variants, the total matrix consumes approximately 25 KB—less than 3% of the 1 MiB document limit.

---

## 9. Backward Compatibility & Migration Strategy

- **Zero Mandatory Database Migration:**
  Existing products without `hasVariants: true` continue functioning with zero schema changes.
- **Dual-Sync Sizing:**
  When editing a variant product in AdminProducts, active size names are mirrored to the legacy `sizes: string[]` array, maintaining compatibility with external integrations or third-party webhooks.
- **TASK 030 CSV Import Compatibility:**
  The schema and validation rules in `src/lib/products/variants.ts` directly support the upcoming Shopify-compatible CSV importer.

---

## 10. Image Integrity Reconciliation (TASK 028 Follow-Up)

As documented in the TASK 028 follow-up audit, the apparent SHA-256 hash discrepancy on source necklace images was an artifact of comparing two different sets of valid R2 object keys between a static test fixture list and the live product document. 
- All Cloudflare R2 assets remain unmodified.
- No image data was corrupted, modified, or re-compressed.
- `object-fit: contain` remains verified and active.

---

## 11. Netlify Production Rollout & Rollback Runbook

### Rollout Plan (Upon Owner Approval):
1. **Approval Gate Verification:** Verify that the owner has explicitly reviewed this report and granted deployment approval.
2. **Branch Merge:** Merge `task/029-flexible-product-variants` into `main`.
3. **Netlify Production Build:**
   ```bash
   git push origin main
   ```
4. **Live Smoke Checks:**
   - Verify PDP variant pill selection, dynamic pricing updates, and photo switching.
   - Verify cart separation for distinct variants.
   - Test one live ₹1 COD or test-gated purchase with variants.
   - Confirm AdminProducts Section 2 renders accurately.

### Rollback Plan:
If any unexpected transactional issue arises post-deployment:
1. In the Netlify console, navigate to **Deploys**.
2. Select previous published deploy `6af369e6cbfc6c42b6b41349` (TASK 028).
3. Click **Publish Deploy**.
4. Rollback executes instantly at the Edge CDN (< 5 seconds) without data migration concerns.

---

## 12. Remaining Critical Risks & Observations

1. **Third-Party CDN Image Caching:**  
   Browser caching on Cloudflare R2 images may take up to 60 seconds to reflect newly assigned variant gallery images if an admin rapidly replaces photo URLs.
2. **High-Velocity Variant Flash Sales:**  
   Under extreme load (> 50 transactions/second on the exact same variant), Firestore document transaction write rate limits (1 write/second per document) will serialize requests. The transaction retry mechanism safely sequences buyers, rejecting only when physical stock is exhausted.

---

## 13. Production Release Status

> [!IMPORTANT]
> **TASK 029 — LOCAL IMPLEMENTATION HARDENED, PRODUCTION APPROVAL PENDING.**  
>
> All mandatory checks, transaction loops, silent clamping removals, matrix limits, active/disabled inventory semantics, and 25 actual integration tests are **100% complete and verified**.
>
> In accordance with strict instructions:
> - **NO PRODUCTION DEPLOYMENT HAS BEEN INITIATED.**
> - **NO CODE HAS BEEN PUSHED TO REMOTE REPOSITORIES.**
> - **NO LIVE INVENTORY, ORDERS, OR CATALOG DATA HAVE BEEN MODIFIED.**
>
> Awaiting owner authorization to proceed with production release.
