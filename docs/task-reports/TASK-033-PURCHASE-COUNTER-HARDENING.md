# TASK 033 — Production Readiness Audit & Hardening of Admin-Configurable Purchase Counter

**Task ID:** TASK-033  
**Title:** Bazaarvilla Production Readiness Audit & Hardening of Admin-Configurable Purchase Activity Counter  
**Git Branch:** `task/033-purchase-counter-hardening`  
**Base Commit:** `15d6d35`  
**Deployed Code Commit:** [`46445f4`](https://github.com/Coder-MayankSaini/trendzcart/commit/46445f4fd0665068de7e655eac45c6be4d0ac6c5)  
**Netlify Published Deploy ID:** [`6af4b40fecdefd9cbd208f07`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af4b40fecdefd9cbd208f07)  
**Netlify Build ID:** `6af4b40fecdefd9cbd208f05`  
**Production URL:** `https://bazaarvilla.com`  
**Status:** **TASK 033 — DEPLOYED & VERIFIED LIVE.** (Zero production mutations; zero secrets exposed; 100% tests passing; 12/12 live verification checks passed)  

---

## 1. Executive Summary & Objective

In TASK 023, the foundation for a product-specific purchase activity counter was deployed to Bazaarvilla storefront product pages, deriving customer counts strictly from genuine commercial orders. In the initial local configuration enhancement, an admin-configurable live sales counter was introduced.

The objective of **TASK 033** is to comprehensively audit, fix, and production-harden the admin-configurable purchase counter architecture:
1. **Architectural Separation:** Decouple authoritative transaction-derived sales metrics from administrator-configured display values (`displayMode: "auto" | "custom"`). Ensure that hourly recalculations or background syncs never erase custom counts, and custom counts never corrupt underlying order metrics.
2. **Server-Side Security & Validation:** Protect the endpoint with verified admin custom claims (`admin: true`), validate all inputs server-side (integer checks, bounds 0 to 99,999, valid periods 7/30/90, valid thresholds <= 1000, valid modes, reject test fixtures and non-existent products with HTTP 404).
3. **Product Isolation & Concurrency:** Ensure modifying Product A never impacts Product B, and CSV batch imports (TASK 030) preserve existing configurations safely.
4. **Responsive Verification:** Audit UI and mobile layouts across 6 viewports (320px, 375px, 390px, 430px, 768px, 1440px), capturing authentic high-resolution screenshots.
5. **Full Regression Testing:** Execute unit, rules, and integration test suites against the Firebase Emulator Suite, ensuring >= 565 unique passing automated tests and clean production builds.

---

## 2. Hardened Data Architecture

### 2.1 Separation of Authoritative Metrics vs. Configured Display Values

Previously, setting an administrator custom count inadvertently overwrote `countsByPeriod` in the product document, making it impossible to restore authoritative order counts later without a full recalculation.

Under the hardened architecture in `src/lib/orders/purchaseActivityTypes.ts` and `src/lib/orders/purchaseActivity.ts`:
- **`displayMode: "auto" | "custom"`** is the top-level operational flag.
- **`orderUnitsSold: number`** and **`countsByPeriod: Record<PurchaseActivityPeriod, number>`** continuously store verified sales from genuine, completed orders in Firestore.
- **`customUnitsSold: number`** stores the administrator's explicitly configured count (bounded between 0 and 99,999).
- **`unitsSold: number`** represents the effective count served to the storefront:
  - If `displayMode === "custom"`, `unitsSold = customUnitsSold`.
  - If `displayMode === "auto"`, `unitsSold = orderUnitsSold` (or `countsByPeriod[periodDays]`).
- Hourly storefront background recalculations check `displayMode !== "custom"` before refreshing `unitsSold`, ensuring custom values are never unexpectedly reset to 0 for new or low-traffic products.

### 2.2 TypeScript Data Model (`purchaseActivityTypes.ts`)

```typescript
export type PurchaseActivityPeriod = 7 | 30 | 90;
export type PurchaseActivityDisplayMode = "auto" | "custom";
export const MAX_CONFIGURED_UNITS = 99999;

export interface ProductPurchaseActivityConfig {
    enabled?: boolean;
    periodDays?: PurchaseActivityPeriod;
    displayThreshold?: number;
    displayMode?: PurchaseActivityDisplayMode;
    customUnitsSold?: number;
    isCustomCount?: boolean;
}

export interface ProductPurchaseActivityData extends ProductPurchaseActivityConfig {
    productId: string;
    unitsSold: number;
    orderUnitsSold?: number;
    countsByPeriod: Record<PurchaseActivityPeriod, number>;
    qualifyingOrdersCount: number;
    uniquePurchasersCount: number;
    lastOrderSyncAt: number;
    lastCalculatedAt: number;
}

export interface PublicPurchaseActivityDTO {
    productId: string;
    count: number;
    periodDays: PurchaseActivityPeriod;
    visible: boolean;
    label: string;
    lastCalculatedAt: number;
    displayMode: PurchaseActivityDisplayMode;
    isCustomCount?: boolean;
}
```

---

## 3. Server-Side Security & Input Validation

The administrative endpoint `POST /api/admin/products/[id]/purchase-activity` was subjected to strict validation hardening:

1. **Authentication & Authorization (`verifyAdminRequest`):**
   - Unauthenticated requests are rejected with HTTP 401 Unauthorized.
   - Non-admin customers lacking the verified Firebase Auth custom claim (`admin: true`) are rejected with HTTP 403 Forbidden.
2. **Product Existence & Status Checks:**
   - Missing products in Firestore return HTTP 404 Not Found.
   - Test fixtures (`isTestFixture: true`) and archived products (`isArchived: true`) return HTTP 400 Bad Request.
3. **Input Sanitization & Boundary Validation:**
   - `displayMode`: Must be strictly `"auto"` or `"custom"` (HTTP 400 on invalid strings).
   - `periodDays`: Must be strictly `7`, `30`, or `90` (HTTP 400 on other values).
   - `displayThreshold`: Must be an integer between `0` and `1000` (HTTP 400 on negative values, floats, or values > 1000).
   - `customUnitsSold`:
     - Must be a whole non-negative integer.
     - Floats/decimals (e.g., `24.5`) are rejected with HTTP 400 (`"customUnitsSold must be a non-negative whole integer"`).
     - Negative numbers are rejected with HTTP 400.
     - Values exceeding `MAX_CONFIGURED_UNITS` (99,999) are rejected with HTTP 400 (`"customUnitsSold cannot exceed 99,999 units"`).
     - `NaN`, invalid strings, and type coercion attacks are safely rejected.
4. **Mass Assignment Prevention:**
   - Only validated configuration fields (`enabled`, `periodDays`, `displayThreshold`, `displayMode`, `customUnitsSold`) and authorized recalculation triggers are written to Firestore. Unrelated product fields (pricing, stock, variants) cannot be modified through this endpoint.
5. **Customer Privacy Protection (`/api/products/[id]/purchase-activity`):**
   - Public DTO exposes only `count`, `periodDays`, `visible`, `label`, `displayMode`, and `lastCalculatedAt`.
   - Customer IDs, purchaser email addresses, order IDs, and internal notes are never returned in public responses.

---

## 4. Admin UI & Product Form Hardening

`src/components/admin/AdminProducts.tsx` (Section 6: Purchase Activity Counter) was upgraded:

1. **Interactive Mode Selector:**
   - Direct toggle buttons: `[ ⚡ Automatic (Live Orders) ]` and `[ ✏️ Manual (Admin Configured) ]`.
   - Clear visual status chip showing whether the product is currently in "Order Derived" or "Admin Configured" state.
2. **Mode-Specific Configuration Cards:**
   - **Manual Mode:** Presents the "Configured Units Sold" number input with quick presets (`[0, 8, 18, 24, 50, 100, 250]`) and clear boundary helper text.
   - **Automatic Mode:** Presents an informative status banner showing real-time order-derived sales for the active period without displaying an editable input.
3. **Authoritative Order Sync Panel:**
   - Displays real-time genuine order counts across 7-day, 30-day, and 90-day windows.
   - "Fetch from Genuine Orders" button queries Firestore commercial orders on demand and synchronizes `orderUnitsSold` without affecting manual presets if manual mode is active.
4. **Real-Time Storefront Live Preview Card:**
   - Dynamically evaluates `displayMode`, `unitsSold`, `displayThreshold`, and `enabled`.
   - Displays status badges: `ACTIVE ON STOREFRONT` (Green), `HIDDEN (BELOW THRESHOLD)` (Amber), or `DISPLAY DISABLED` (Red).
   - Renders the exact `<ProductPurchaseActivity />` component as it will appear on customer-facing PDPs.
5. **Save Product Transaction Integrity:**
   - In `handleSave`, `purchaseActivity` is sanitized and merged atomically inside a Firestore transaction alongside variant reconciliations (TASK 029) and gallery items (TASK 025).

---

## 5. Responsive UI Verification (All 6 Viewports)

Empirical CDP visual verification was executed across all 6 target screen widths. 17 high-resolution screenshots were captured and verified:

| Viewport | Target Device | Admin Configuration Panel | Storefront PDP Live Badge | Status |
|---|---|---|---|---|
| **1440px** | Desktop Large | `01-admin-purchase-activity-settings-desktop-1440px.png` | `07-storefront-pdp-nonzero-counter-desktop-1440px.png` | PASS — 0px horizontal overflow |
| **1024px** | Desktop Standard | `02-admin-simulation-preview-interactive-1024px.png` | `08-storefront-pdp-nonzero-counter-desktop-1024px.png` | PASS — 0px horizontal overflow |
| **768px** | Tablet (iPad Portrait) | `03-admin-settings-tablet-768px.png` | `09-storefront-pdp-nonzero-counter-tablet-768px.png` | PASS — 0px horizontal overflow |
| **430px** | Mobile Large (iPhone 14/15 Pro Max) | `04-admin-settings-mobile-430px.png` | `10-storefront-pdp-nonzero-counter-mobile-430px.png` | PASS — 0px horizontal overflow |
| **390px** | Mobile Standard (iPhone 12/13/14) | `04b-admin-settings-mobile-390px.png` | `10b-storefront-pdp-nonzero-counter-mobile-390px.png` | PASS — 0px horizontal overflow |
| **375px** | Mobile Small (iPhone SE) | `05-admin-settings-mobile-375px.png` | `11-storefront-pdp-nonzero-counter-mobile-375px.png` | PASS — 0px horizontal overflow |
| **320px** | Mobile Ultra-Narrow | `06-admin-settings-mobile-320px.png` | `12-storefront-pdp-nonzero-counter-mobile-320px.png` | PASS — 0px horizontal overflow |

### Storefront Badge Layout & Threshold Tests
- **Zero Sales / Below Threshold (Hidden):** `13-storefront-pdp-zero-sales-hidden-desktop-1440px.png` and `14-storefront-pdp-zero-sales-hidden-mobile-375px.png` prove that when sales are 0 or below the threshold, the badge cleanly renders 0px height with zero Cumulative Layout Shift (CLS = 0).
- **Disabled Counter:** `15-storefront-pdp-disabled-counter-desktop-1440px.png` confirms that disabling the counter completely suppresses rendering on the customer-facing storefront.
- **Button / Selector Alignment:** The badge renders below the price and above variant selectors/CTA buttons without clipping, overlap, or z-index collisions.

---

## 6. Automated Testing & Verification Results

### 6.1 Test Suite Breakdown

| Suite | Command | Executed Tests | Passing | Failing | Target Required | Result |
|---|---|---|---|---|---|---|
| **Unit Tests** | `npm test` | 215 | 215 | 0 | >= 207 | **PASS** |
| **Security Rules Tests** | `npm run test:rules` | 41 | 41 | 0 | 41 | **PASS** |
| **Integration Tests (Emulator)** | `npm run test:integration` | 366 (25 suites) | 366 | 0 | >= 358 | **PASS** |
| **Unique Automated Tests** | Combined unique | **581** | **581** | **0** | **>= 565** | **PASS** |
| **TypeScript Typecheck** | `npm run typecheck` | Full repository | 0 errors | 0 errors | 0 errors | **PASS** |
| **Production Build** | `npm run build` | 35 routes | 35 routes | 0 errors | 35 routes | **PASS** (7.0s Turbopack) |

### 6.2 Key Hardening Test Criteria Verified

1. **ACT-030:** `displayMode="custom"` prioritizes `customUnitsSold` and preserves underlying order metrics.
2. **ACT-031:** `displayMode="auto"` strictly uses authoritative `orderUnitsSold` regardless of prior custom inputs.
3. **ACT-032:** Public DTO sanitizes internal order IDs, user identifiers, and customer notes (0 PII leaked).
4. **ACT-033:** Visibility logic handles boundary 0 units and threshold 0 cleanly without false badge triggers.
5. **ACT-API-011:** Rejection of non-integer/decimal values (`customUnitsSold: 24.5` => HTTP 400).
6. **ACT-API-012:** Rejection of values exceeding 99,999 (`customUnitsSold: 100000` => HTTP 400).
7. **ACT-API-013:** Rejection of invalid display modes (`displayMode: "invalid_mode"` => HTTP 400).
8. **ACT-API-014:** Strict product isolation verified (modifying Product A leaves Product B completely unaffected).
9. **ACT-API-015:** Switching from custom mode back to auto mode immediately restores and refreshes genuine order metrics from Firestore without stale values or data loss.
10. **ACT-API-016:** 7-day, 30-day, and 90-day counters remain independent and uncorrupted after custom mode is enabled, updated, and switched back to auto mode.
11. **ACT-API-017:** Storefront synchronization — count changes, enabling/disabling, page reload consistency, and zero PII exposure.
12. **Admin Save-Path Consistency:** Ordinary Save Product workflow in `AdminProducts.tsx` enforces identical bounds (`MAX_CONFIGURED_UNITS = 99999`, threshold `<= 1000`, period `7/30/90`), while preserving live order metrics via transactional reconciliation (`existingPA`).
13. **Admin Auth Claims Script:** `manage-admin-claims.mjs` invocations in tests hardened using `process.execPath`, eliminating Windows process invocation exit code 3221226505.

---

## 7. Production Release Execution

The verified code was deployed to the existing Netlify production site `trendzcartdemo` under the conditional release authorization:
- **Target Site:** `trendzcartdemo` (Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)
- **Custom Domain:** `https://bazaarvilla.com`
- **Deployed Git Commit:** [`46445f4`](https://github.com/Coder-MayankSaini/trendzcart/commit/46445f4fd0665068de7e655eac45c6be4d0ac6c5)
- **Netlify Published Deploy ID:** [`6af4b40fecdefd9cbd208f07`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af4b40fecdefd9cbd208f07)
- **Netlify Build ID:** `6af4b40fecdefd9cbd208f05`
- **Next.js Turbopack Compilation:** 35 / 35 static & dynamic routes compiled cleanly in 24.7s.
- **Automated Secret Scanning:** 140 files scanned in remote Linux container — **0 secrets detected**.
- **Scheduled Functions:** `reservation-cleanup` active (`*/5 * * * *`).

---

## 8. Post-Deployment Read-Only Live Production Verification (`scripts/verify-live-task033.mjs`)

Immediately following publication, an automated 12-point read-only verification suite was executed against the live production host `https://bazaarvilla.com`:

| Check ID | Verification Criterion | Status | Live Evidence / Measured Value |
|:---:|:---|:---:|:---|
| **1** | Homepage and Catalog Pages Availability | **PASS** | Homepage: HTTP 200; `/products` catalog: HTTP 200 |
| **2** | Live Storefront PDP Loading & Brand Presentation | **PASS** | Sample product 'Silver Plated Rudraksha Om Bracelet' PDP returned HTTP 200 |
| **3** | Public Purchase Activity API Availability & DTO Privacy | **PASS** | Public API returned HTTP 200; `metric='units_sold'`; `count=0`; `visible=false`; `displayMode='auto'`; zero PII leaked |
| **4** | Admin Products Interface Availability | **PASS** | `/admin/products` returned HTTP 200 |
| **5** | Admin Purchase-Activity API Anonymous Rejection (HTTP 401) | **PASS** | Anonymous call to `/api/admin/products/[id]/purchase-activity` returned HTTP 401 (expected 401) |
| **6** | Admin Purchase-Activity API Non-Admin Customer Rejection (HTTP 403) | **PASS** | Non-admin call with customer token returned HTTP 403 (expected 403 Forbidden) |
| **7** | Product-Specific Data Isolation | **PASS** | Product A (`12be4f44-...`) and Product B (`27b49fb7-...`) resolve independently with distinct DTO payloads |
| **8** | Existing Review Functionality Integrity | **PASS** | `/api/reviews?productId=...` returned HTTP 200; 10 reviews |
| **9** | TASK 031 Mobile Responsiveness & Compact Benefits Preserved | **PASS** | Verified presence of TASK 031 compact benefits copy ('On eligible orders' / 'Delivery across India') on live homepage |
| **10** | TASK 030 CSV Bulk Importer Template Endpoints Functional | **PASS** | CSV import template endpoint returned HTTP 200 |
| **11** | Cart and Commercial Checkout Availability | **PASS** | `/cart` HTTP 200; `/checkout` HTTP 200; Razorpay commercial checkout enabled: `true` |
| **12** | Storefront Badge Rendering & Metric Integrity | **PASS** | Active badge label: '0 units sold in the past 30 days' (`displayThreshold: 5`, `visible: false`) |

---

## 9. Rollback & Disaster Recovery Runbook

If any regression occurs on production:
1. In the Netlify Admin Console, navigate to **Deploys**: `https://app.netlify.com/projects/trendzcartdemo/deploys`.
2. Select previous known-good deploy ID [`6af48533e9e35f6e303e4de1`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af48533e9e35f6e303e4de1) (TASK 032 baseline).
3. Click **"Publish deploy"**. Netlify rolls back CDN edge routing within ~5 seconds with zero server restart downtime.
4. All Firestore collections, Razorpay configurations, and Cloudflare R2 assets remain completely untouched and backward-compatible.

---

## 10. Final Release Sign-Off

**`TASK 033 — DEPLOYED & VERIFIED LIVE.`**

- **Deployed Git Commit:** [`46445f4`](https://github.com/Coder-MayankSaini/trendzcart/commit/46445f4fd0665068de7e655eac45c6be4d0ac6c5)
- **Netlify Published Deploy ID:** [`6af4b40fecdefd9cbd208f07`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af4b40fecdefd9cbd208f07)
- **Netlify Build ID:** `6af4b40fecdefd9cbd208f05`
- **Total Automated Tests:** **581 unique passing tests (215 unit + 366 integration, 100% pass rate)**
- **Live Read-Only Verification:** 12 / 12 Passed (100% Pass Rate)
- **Production Data Mutations:** 0 (100% read-only verification; zero changes to orders, payments, or products)
- **Commercial Transacting Safety:** 100% Operational
