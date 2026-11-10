# TASK 023 — Bazaarvilla Product Purchase Activity Counter & Admin Configuration

**Task ID:** TASK-023  
**Date:** 2026-11-10  
**Investigator / Engineer:** Principal Full-Stack Engineer, E-Commerce Data Engineer, Firebase Security Engineer, Next.js UI/UX Specialist  
**Primary Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5, Firebase Authentication, Cloud Firestore (Spark plan), Firebase Admin SDK, Cloudflare R2, Razorpay Live Mode (2.9.6), Netlify  
**Git Branch:** `task/023-product-purchase-activity-counter`  
**Base Commit:** `9a32d47` (Docs) / `0b4f897` (Code — TASK 022 Deployed Baseline)  
**Deployed Production Commit:** `16b094ebfa4eff76d903d391ee07c31a4d9a7be6`  
**Published Production Deploy ID:** [`6af34bfc4ee2926c4d5e5cdd`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af34bfc4ee2926c4d5e5cdd)  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo`)  
**Status:** **COMPLETED & PUBLISHED TO PRODUCTION — 100% VERIFIED LIVE**  

---

## 1. Executive Summary & Verification Outcomes

Bazaarvilla previously lacked a native product-level purchase activity indicator on its Product Detail Pages (PDP). To enhance commercial confidence while strictly adhering to truth-in-advertising principles, TASK 023 delivers an authentic, order-derived product purchase activity indicator and administrative management system.

### Key Deliverables:
1. **Storefront PDP Purchase Activity Badge:** Displays an authentic, discreet indicator (e.g., `"24 units sold in the past 30 days"`) styled with Bazaarvilla's green design system (`#006B3C`, `#EAF8EE`, `#159947`) and flame/activity iconography directly adjacent to the price and availability section.
2. **Administrative Configuration Interface:** Fully integrated into `src/components/admin/AdminProducts.tsx` (Section 6: Purchase Activity Counter), offering mobile-responsive controls for per-product display visibility (enable/disable), rolling window selection (7, 30, or 90 days), sales threshold gating (0+, 5+, 10+, 25+), and an on-demand recalculation trigger with live demand statistics.
3. **Private Admin Simulation Preview:** A private, sandboxed simulation preview widget in the admin product editor allowing administrators to evaluate badge styling across simulated unit counts (presets: 1, 8, 24, 75, 150) without affecting live storefront data or mutating Firestore aggregations. Labeled with an unmistakable warning: `[SIMULATED PREVIEW — NOT VISIBLE ON LIVE STOREFRONT]`.
4. **Public & Administrative API Endpoints:**
   - Public DTO: `GET /api/products/[id]/purchase-activity` exposing only sanitized metric counts and labels with strict 1-hour Edge CDN caching headers and zero customer PII.
   - Admin Management: `POST /api/admin/products/[id]/purchase-activity` requiring verified Firebase Auth custom claims (`admin: true`), fail-closed input validation, and transactional Firestore caching.
5. **Firebase Spark Plan Optimization (0 Full-Storefront Scans):** Embedded cached `purchaseActivity` summary within the existing `products/{productId}` document. Product page loads perform 0 additional database reads. An automated 1-hour lazy server-side refresh occurs seamlessly during server rendering without cron dependencies or external paid services.
6. **Strict Authenticity & Data Isolation:**
   - Quarantined false-PAID orders from TASK 017 (`quarantined === true`, `UNPAID_SYNTHETIC_ARTIFACT`) are strictly excluded.
   - Owner live cutover verification transaction (`371905cc-2a2d-4aa1-a50c-5aec49359b41`, TASK 018 ₹1 test) is excluded as an administrative artifact.
   - Synthetic test products (`isTestFixture === true`, `task013_*`) are excluded from public activity routes.
   - Zero fabricated base numbers, random increments (+2/+3/+5), or false scarcity counters.

---

## 2. Production Baseline Verification & Deployed Releases Audit

Prior to beginning TASK 023, the production repository state and Git commit history were audited:

- **Deployed Production Commit:** `0b4f897` (Code) / `9a32d47` (Task 022 Documentation)
- **Netlify Published Deploy ID:** `6af32ea1de06339db927ce29`
- **Preceding Verified Releases Preserved:**
  - **TASK 021:** Mobile-Responsive Admin Dashboard (`411eb00`)
  - **TASK 024:** Product Image Gallery, Multi-Upload & Category Image Isolation Repair (`965631f`)
  - **TASK 025:** Admin Product Image Gallery Layout Repair (`d071ebc`)
  - **TASK 026:** Storefront Product Image Quality & Resolution Optimization (`af9aa4d`)
  - **TASK 022:** Bulk Review Import, Product Review Moderation & Storefront Aggregates (`0b4f897`)
- **Automated Test Baseline:** 333 unique passing tests (60 unit + 273 integration).
- **Git Branch Isolation:** Created clean branch `task/023-product-purchase-activity-counter` directly from baseline `9a32d47`.

---

## 3. Order Collection Schema & Commercial Integrity Audit

An exhaustive audit of the Firestore `orders`, `paymentRecords`, and `paymentWebhookEvents` collections was conducted:

| Field Name | Type | Description & Eligibility Semantics |
|---|---|---|
| `id` | `string` | Unique order identifier (e.g. `ord_...`, UUID). |
| `paymentMethod` | `"RAZORPAY" \| "COD"` | Payment rail utilized for the order. |
| `paymentStatus` | `string` | `"PAID"`, `"PENDING"`, `"FAILED"`, `"CANCELLED"`, `"UNPAID_SYNTHETIC_ARTIFACT"`. Only `"PAID"` confirms commercial receipt. |
| `orderStatus` | `string` | `"Pending"`, `"Processing"`, `"Shipped"`, `"Delivered"`, `"Completed"`, `"Cancelled"`, `"Refunded"`. |
| `inventoryFinalized` | `boolean` | `true` when stock decrements were permanently finalized following gateway verification. |
| `items` | `Array<{ productId, quantity, price }>` | Purchased line items. Product IDs are matched directly, and `quantity` is aggregated. |
| `createdAt` / `paidAt` | `Timestamp \| string \| number` | Order creation and payment confirmation timestamps. Normalized to epoch milliseconds. |
| `quarantined` | `boolean` | Set to `true` on synthetic historical orders from TASK 017; must always evaluate to `false` or `undefined`. |
| `isTestFixture` | `boolean` | Set to `true` on test fixture orders; strictly excluded. |

### Order Eligibility Predicate Matrix:
1. **Prepaid Orders (Razorpay):** Must have `paymentStatus === "PAID"` AND either `inventoryFinalized === true` or `orderStatus` in `["Processing", "Completed", "Delivered", "Shipped"]`. Canceled, refunded, or uncaptured orders are excluded.
2. **Cash on Delivery (COD) Orders:** Must have `orderStatus` in `["Processing", "Completed", "Delivered", "Shipped"]` and `orderStatus !== "Cancelled"`. Canceled or rejected COD orders are excluded.
3. **Idempotency & Deduplication:** Orders are aggregated by unique Firestore `orderId`. Multiple webhook events or payment retries never cause double-counting of line items.

---

## 4. Product Purchase Activity Metric Definition & Business Logic

### Authoritative Metric
- **Metric Type:** `units_sold`
- **Semantics:** Cumulative quantity of physical units purchased for the specific `productId` within a rolling window prior to calculation.
- **Rolling Windows Supported:**
  - **7 Days:** Rolling 168 hours (`now - 7 * 86400000`)
  - **30 Days (Default):** Rolling 720 hours (`now - 30 * 86400000`)
  - **90 Days:** Rolling 2160 hours (`now - 90 * 86400000`)
- **Display Wording:**
  - 1 unit: `"1 unit sold in the past {N} days"`
  - Multiple units: `"{X} units sold in the past {N} days"`
- **Strict Authenticity Rule:** Never labeled as "people bought" or "customers bought" because multiple units may be ordered by a single customer or in a single transaction. Unique purchaser count is tracked internally (`uniquePurchasersCount`) but distinct from `unitsSold`.

---

## 5. Quarantined Order & Test Mode Isolation Safeguards

1. **TASK 017 Historical Quarantined Orders:**
   The 7 historical synthetic false-PAID orders identified and atomically quarantined during TASK 017 contain `paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT"` and `quarantined: true`. The order eligibility filter `isOrderEligibleForPurchaseActivity` explicitly rejects any record where `order.quarantined === true` or `order.paymentStatus === "UNPAID_SYNTHETIC_ARTIFACT"`.
2. **TASK 018 Live Owner Validation Transaction:**
   Order `371905cc-2a2d-4aa1-a50c-5aec49359b41` (Razorpay payment `pay_TyEkKKO51nzlMx`, ₹1.00) represents an internal live cutover verification test executed by the store owner. It is classified as an administrative verification artifact and excluded from public demand metrics via order ID exclusion list `INTERNAL_TEST_ORDER_IDS`.
3. **Synthetic Test Products & Coupons:**
   Synthetic products (e.g. `task013_test_prod_simple`, `task013_test_prod_custom`) and fixtures with `isTestFixture === true` or `category === "Testing"` return HTTP 404 from public activity endpoints.

---

## 6. Firebase Spark Plan & Server Aggregation Architecture

Because Bazaarvilla operates on the Firebase Spark (free) tier, executing full order collection scans on every storefront page view would rapidly exceed daily read quotas.

### Architectural Solution:
1. **Denormalized Document Caching:** The product document in Firestore (`products/{productId}`) contains a denormalized `purchaseActivity` map:
   ```json
   {
     "enabled": true,
     "periodDays": 30,
     "displayThreshold": 5,
     "unitsSold": 24,
     "countsByPeriod": { "7": 6, "30": 24, "90": 48 },
     "qualifyingOrdersCount": 18,
     "uniquePurchasersCount": 16,
     "lastCalculatedAt": 1731264000000
   }
   ```
2. **0 Extra Reads on Page Loads:** Storefront PDP server-rendering (`getProductBySlug`) retrieves the product document once. The cached `purchaseActivity` is passed directly to `<ProductPurchaseActivity />` without any additional database queries.
3. **Bounded 1-Hour Lazy Refresh:** If `Date.now() - product.purchaseActivity.lastCalculatedAt > 3,600,000` (1 hour), the server initiates an asynchronous recalculation during the server component request.
4. **Bounded Rolling Query:** Orders are queried with a 90-day bounded timestamp filter:
   `db.collection("orders").where("createdAt", ">=", ninetyDaysAgoDate)`.
   Historical orders older than 90 days are never scanned.

---

## 7. Storefront UI/UX & Responsive Layout Implementation

### Component Design (`ProductPurchaseActivity.tsx`):
- **Visual Design:** Implemented using Bazaarvilla's green design system:
  - Background: `#EAF8EE` (Light mint tint)
  - Text: `#006B3C` (Bazaarvilla Forest Green)
  - Border: `rgba(0, 107, 60, 0.15)`
  - Icon: SVG fire / activity glyph (`#159947`)
- **Placement:** Placed directly beneath the product price row in the primary PDP purchase column, adjacent to the COD eligibility pill.
- **Layout Stability:** Fixed line-height and inline-flex alignment prevent Cumulative Layout Shift (CLS). When activity is disabled or below threshold, the component returns `null`, preserving catalog layout cleanly.

---

## 8. Administrative Configuration & Moderation Controls

Integrated into the admin product edit modal in `src/components/admin/AdminProducts.tsx` as **Section 6: Purchase Activity Counter**:

1. **Visibility Switch:** Toggle to enable or disable storefront activity display for the specific product.
2. **Reporting Period Selector:** Radio pill selector supporting `7 Days`, `30 Days (Default)`, and `90 Days`.
3. **Display Threshold Dropdown:** Configurable minimum sales requirement (`Always Show (0+)`, `5+ Units Sold (Default)`, `10+ Units Sold`, `25+ Units Sold`). If genuine sales fall below this threshold, the badge is hidden from customers; counts are never inflated.
4. **Live Demand Overview Card:** Displays genuine commercial statistics:
   - Units Sold (Active Period)
   - 7-Day / 30-Day / 90-Day breakdowns
   - Qualifying Orders & Unique Buyers
   - Last Calculation Timestamp
5. **Recalculate On-Demand Button:** Triggers an immediate recalculation of sales counts from Firestore orders via `POST /api/admin/products/[id]/purchase-activity`.

---

## 9. Private Simulation Preview Mode & Storefront Isolation

To allow the store administrator to review badge appearance across various numbers without affecting live data, a sandboxed simulation panel is provided:

- **Isolated State:** Managed entirely in client component local state (`useState`); no network requests or database mutations are executed.
- **Interactive Preset Pills:** Administrator can click presets (`1 unit`, `8 units`, `24 units`, `75 units`, `150 units`) or input a custom integer.
- **Unmistakable Safeguard Warning:** The preview renders with a prominent orange/amber warning banner:
  `[SIMULATED PREVIEW — NOT VISIBLE ON LIVE STOREFRONT]`
- **Zero Storefront Bleed:** Simulation props are never transmitted to public endpoints or saved to the Firestore product document.

---

## 10. Automated Visual Verification Across Viewports

Automated in-browser screenshot capture was executed via Playwright (`scripts/capture-task023-screenshots.mjs`) across 6 responsive viewports (320px, 375px, 430px, 768px, 1024px, 1440px).

### Captured Screenshots Directory: `docs/screenshots/task023/`
1. **Storefront PDP Activity Badge:**
   - `docs/screenshots/task023/pdp-activity-badge-320px.png` (iPhone SE narrow)
   - `docs/screenshots/task023/pdp-activity-badge-375px.png` (Standard mobile)
   - `docs/screenshots/task023/pdp-activity-badge-430px.png` (iPhone Pro Max)
   - `docs/screenshots/task023/pdp-activity-badge-768px.png` (iPad portrait)
   - `docs/screenshots/task023/pdp-activity-badge-1024px.png` (iPad landscape)
   - `docs/screenshots/task023/pdp-activity-badge-1440px.png` (Desktop widescreen)
2. **Admin Configuration Panel (Section 6):**
   - `docs/screenshots/task023/admin-activity-section-375px.png`
   - `docs/screenshots/task023/admin-activity-section-430px.png`
   - `docs/screenshots/task023/admin-activity-section-768px.png`
   - `docs/screenshots/task023/admin-activity-section-1024px.png`
   - `docs/screenshots/task023/admin-activity-section-1440px.png`
3. **Private Admin Simulation Preview:**
   - `docs/screenshots/task023/admin-simulation-preview-375px.png`
   - `docs/screenshots/task023/admin-simulation-preview-768px.png`
   - `docs/screenshots/task023/admin-simulation-preview-1440px.png`
4. **Admin Product List Activity Badge:**
   - `docs/screenshots/task023/admin-product-card-activity-pill-375px.png`

---

## 11. Security Model, Authentication & Data Minimization

1. **Authentication & Authorization:**
   - Admin route (`POST /api/admin/products/[id]/purchase-activity`) requires a valid Firebase Auth ID token bearing custom claim `admin: true`. Unauthenticated requests receive HTTP 401; non-admin users receive HTTP 403.
   - Public route (`GET /api/products/[id]/purchase-activity`) requires no authentication and permits anonymous storefront reading.
2. **Customer Data Minimization:**
   - The public API response DTO strictly projects only:
     `{ productId, metric: "units_sold", periodDays, count, label, visible, lastCalculatedAt }`.
   - Never exposes customer names, email addresses, phone numbers, delivery addresses, order IDs, payment IDs, or raw order documents.
3. **Firestore Security Rules:**
   - `products` collection: Client SDK write access is forbidden (`allow write: if false;`). Public reads allow viewing catalog items (`allow read: if true;`). All activity updates occur via Firebase Admin SDK.
   - `orders` collection: Direct client reads are denied to anonymous clients and restricted to the order owner. Client SDK writes are completely denied.

---

## 12. Comprehensive Automated Regression Test Suite

### Unit Test Suite (`tests/unit/purchase-activity.test.ts`): 25 Tests Passing
- `ACT-001`: Count 1 unit for 1 paid order.
- `ACT-002`: Sum multiple quantities in a single order (e.g. qty 4 = 4 units).
- `ACT-003`: Match specific product ID when an order contains multiple products.
- `ACT-004`: Sum across multiple qualifying orders for the same product.
- `ACT-005`: Ensure distinct products have independent counters.
- `ACT-006`: Exclude pending prepaid orders (`paymentStatus: "PENDING"`).
- `ACT-007`: Exclude failed payments (`paymentStatus: "FAILED"`).
- `ACT-008`: Exclude uncaptured payments without finalized inventory.
- `ACT-009`: Exclude canceled orders (`orderStatus: "Cancelled"`).
- `ACT-010`: Exclude refunded orders (`orderStatus: "Refunded"`).
- `ACT-011`: Include eligible Cash on Delivery orders (`paymentMethod: "COD"`, `orderStatus: "Processing"`).
- `ACT-012`: Exclude canceled Cash on Delivery orders (`orderStatus: "Cancelled"`).
- `ACT-013`: Prevent double-counting from duplicate webhook deliveries or retry deliveries.
- `ACT-014`: Exclude quarantined synthetic false-PAID orders (`quarantined: true`, `UNPAID_SYNTHETIC_ARTIFACT`).
- `ACT-015`: Exclude historical Test Mode orders and fixtures (`isTestFixture: true`).
- `ACT-016`: Exclude owner live cutover test order (`371905cc-2a2d-4aa1-a50c-5aec49359b41`).
- `ACT-017`: Verify rolling 7-day window boundary filtering.
- `ACT-018`: Verify rolling 30-day window boundary filtering.
- `ACT-019`: Verify rolling 90-day window boundary filtering.
- `ACT-020`: Verify accurate timezone and timestamp normalization.
- `ACT-021`: Verify admin visibility toggle (`enabled: false` yields `visible: false`).
- `ACT-022`: Verify display threshold hides count without inflating value.
- `ACT-023`: Verify accurate badge label formatting for singular and plural units.
- `ACT-024`: Verify zero sales returns 0 units and never fabricates base numbers.
- `ACT-025`: Verify cache TTL evaluation (1-hour validity window).

### Integration Test Suite (`tests/integration/purchase-activity-api.test.ts`): 10 Tests Passing
- `ACT-API-001`: Reject unauthenticated POST to admin API with HTTP 401.
- `ACT-API-002`: Reject non-admin customer POST to admin API with HTTP 403.
- `ACT-API-003`: Reject invalid `periodDays` with HTTP 400.
- `ACT-API-004`: Reject negative `displayThreshold` with HTTP 400.
- `ACT-API-005`: Allow authorized admin to configure settings and recalculate stats against Firestore.
- `ACT-API-006`: Public API returns public DTO without customer PII or raw orders.
- `ACT-API-007`: Public API returns `visible: false` when units sold < display threshold.
- `ACT-API-008`: Public API returns HTTP 404 for synthetic fixtures and nonexistent products.
- `ACT-API-009`: Public API returns 0 units when product has no sales.
- `ACT-API-010`: Real Firestore aggregation strictly excludes quarantined false-PAID orders.

---

## 13. Static Typecheck, Lint & Production Build Verification

- **TypeScript Compilation:** `npm run typecheck` passed with 0 errors.
- **Unit Test Runner:** `npm test` passed with 85/85 tests passing across 7 suites.
- **Firestore Security Rules:** `npm run test:rules` passed with 39/39 security rules tests.
- **Full Integration Suite:** `npm run test:integration` passed with 283/283 tests passing across 22 suites.
- **Turbopack Production Build:** `npm run build` compiled 35 static and dynamic routes cleanly with code 0.
- **Total Unique Automated Tests:** **368 passing** (85 unit + 283 integration; 0 double-counting).

---

## 14. Netlify Production Deployment & Live Verification Evidence

Conditional authorization was granted by the store owner following rigorous verification of hourly refresh mechanics, Firestore query scalability, and truth-in-advertising COD semantics.

### Production Deployment Details:
- **Deployed Production Commit:** [`16b094ebfa4eff76d903d391ee07c31a4d9a7be6`](https://github.com/Coder-MayankSaini/trendzcart/commit/16b094ebfa4eff76d903d391ee07c31a4d9a7be6)
- **Netlify Published Deploy ID:** [`6af34bfc4ee2926c4d5e5cdd`](https://app.netlify.com/projects/trendzcartdemo/deploys/6af34bfc4ee2926c4d5e5cdd)
- **Build ID:** `6af34bfc4ee2926c4d5e5cdb`
- **Netlify Site:** `trendzcartdemo` (Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)
- **Published Production Domain:** [https://bazaarvilla.com/](https://bazaarvilla.com/)
- **Unique Deploy URL:** [https://main--trendzcartdemo.netlify.app](https://main--trendzcartdemo.netlify.app)
- **Secrets Scan:** 121 files scanned — 0 leaks detected.
- **Scheduled Functions:** `reservation-cleanup` active (`*/5 * * * *`).
- **Site Status:** Site is live ✨

### Post-Deployment Live Verification Results (`scripts/verify-live-task023.mjs`):
Executed post-deployment automated verification against live host `https://bazaarvilla.com` (**9/9 checks passed**):

| Check | Area | Live Result | Status |
|---|---|---|---|
| **1. Admin Token Generation** | Authentication | Successfully provisioned valid Firebase ID token for authorized admin UID `jdi97hwEJQYt5NXoUhyISOpW7Hl1`. | **PASSED** |
| **2. Public API Data Boundary** | Security & Privacy | `GET /api/products/[id]/purchase-activity` returned HTTP 200, count: 0, visible: false, and 100% PII redacted. | **PASSED** |
| **3. Edge CDN Cache Headers** | Performance | `Cache-Control: public, s-maxage=3600, stale-while-revalidate=1800` active on response. | **PASSED** |
| **4. Fixture Exclusion** | Security & Integrity | Synthetic test fixture `task013_test_prod_simple` returned HTTP 404. | **PASSED** |
| **5. Admin API 401 Rejection** | Access Control | Unauthenticated `POST /api/admin/products/[id]/purchase-activity` rejected with HTTP 401. | **PASSED** |
| **6. Admin Recalculation** | Admin Control | Authenticated admin recalculation returned HTTP 200 with `{ success: true, activity: { unitsSold: 0, periodDays: 30 } }`. | **PASSED** |
| **7. Storefront PDP Rendering** | Storefront | PDP at `/products/personalized-eyes-engraved-bar-necklace...` rendered cleanly (HTTP 200, 64,477 bytes, 0 hydration errors). | **PASSED** |
| **8. Review System Preservation** | Backward Compatibility | `GET /api/reviews?productId=...` returned HTTP 200 (TASK 022 preserved). | **PASSED** |
| **9. Commercial Checkout Gate** | Payment Integrity | `/api/razorpay/public-config` returned HTTP 200 with `commercialCheckoutEnabled: true`. | **PASSED** |

---

## 15. Rollback & Disaster Recovery Procedures

1. **Storefront Killswitch:** The administrator can disable the purchase activity badge instantly per product or globally by toggling `enabled: false` in Admin Products.
2. **Immediate Netlify Rollback:** If unexpected regressions occur, immediately publish the previous verified deployment:
   - Deploy ID: `6af32ea1de06339db927ce29` (TASK 022 Deployed Baseline).
3. **Database Safety:** The `purchaseActivity` map on `products` is purely informational and non-destructive. Removing or setting `purchaseActivity: null` causes zero side-effects on catalog browsing, ordering, or checkout.

---

## 16. Maintenance, Monitoring & Future Operational Guidance

1. **Eventual Consistency:** Purchase activity updates within 1 hour of order completion or instantly upon administrative recalculation.
2. **Quarantine Maintenance:** Any future synthetic or test orders generated during manual QA must be flagged with `isTestFixture: true` to prevent accidental inclusion in customer-facing purchase counts.
3. **Owner Purchases:** If additional owner test orders are conducted on production, ensure the resulting order ID is added to `INTERNAL_TEST_ORDER_IDS` in `src/lib/orders/purchaseActivityTypes.ts`.
