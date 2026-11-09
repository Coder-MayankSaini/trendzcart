# TASK 016 — Bazaarvilla Relaunch: Historical Payment Reconciliation, Synthetic Fixture Sanitization, Checkout Gate Verification & Live Cutover Readiness

## 1. Executive Summary & Merchant Approval Status

This report documents the completion of **TASK 016**, executing the technical pre-launch verification and preparation for **Bazaarvilla** (`https://bazaarvilla.com/`).

### Critical Merchant Status Update
- **Razorpay Merchant Approval:** The Bazaarvilla merchant account has been **formally approved by Razorpay for Live Mode operations**.
- KYC submission is completely resolved and merchant approval is no longer a blocker.
- The merchant account owner can now generate Razorpay Live Mode API keys (`rzp_live_*`).
- In strict adherence to the mandate for TASK 016, **no Live Mode credentials have been configured**, **no real customer payments have been processed**, and **public commercial checkout remains safely gated**. All cutover execution steps are documented and staged for **TASK 017**.

### Core Technical Outcomes of TASK 016
1. **Contradictory Historical Records Resolved:**  
   Identified and resolved the discrepancy between the historical payment tables in TASK 014 and TASK 015. Confirmed that TASK 014 recorded the true Razorpay Order IDs from TASK 013 but approximate payment ID timestamps, whereas TASK 015's audit script failed with `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` (due to using an unauthenticated CLI token), causing the report author to synthesize placeholder payment IDs and fabricated Razorpay Order IDs. Queried production Firestore using authorized Firebase Admin SDK credentials and Razorpay API directly, establishing the **100% authoritative ground truth** for all seven orders.
2. **Safe, Exact-Record Quarantine Prepared & Dry-Run Verified:**  
   Engineered and empirically verified `scripts/prepare-seven-orders-quarantine.mjs`. The script targets the exact verified order IDs (`c39xYbGgIFZ7OeCogOLs`, `VCRIyEYOL9Qs9kXO3q0l`, `9zZ9yDaKxacS5ZyYdFMO`, `E1TSDrDBpbiKRLRoBljf`, `ZgX60mkrfy8bYPVG5xAr`, `MBbquzz08LpVNZqqUTSt`, `DV0JKWgs60V8lUvGEv5u`) and exact payment IDs (`pay_TASK013_TEST_*`). In strict compliance with data loss prevention principles, **zero records were modified on live Firestore**, and full document diffs are submitted for explicit owner approval.
3. **Synthetic Test Products & Coupons Deactivated & Guarded:**  
   - Authored database sanitization tool `scripts/sanitize-synthetic-fixtures.mjs` targeting test products (`task013_test_prod_custom`, `task013_test_prod_lowstock`, `task013_test_prod_simple`) and coupons (`TASK013_SAVE50`, `TASK013_TEST_COUPON_SAVE50`).
   - Implemented server-authoritative code-level safeguards in `src/lib/orders/pricing.ts` that strictly reject test products and test coupons for commercial purchases unless `allowTestFixtures` is explicitly authorized.
   - Updated storefront product catalog queries in `src/app/(storefront)/products/page.tsx` and `src/app/(storefront)/products/[...slug]/page.tsx` to automatically exclude all testing fixtures and archived products.
4. **Checkout Gate & Payment Safeguards Empirically Verified on Production:**  
   - Probed production `https://bazaarvilla.com`:
     - `GET /api/razorpay/public-config`: returns `{ keyId: 'rzp_test_...', commercialCheckoutEnabled: false }`.
     - `POST /api/orders/create` (COD): returns HTTP 503 `COMMERCIAL_CHECKOUT_DISABLED`.
     - `POST /api/razorpay/create-order` (Prepaid): returns HTTP 503 `COMMERCIAL_CHECKOUT_DISABLED`.
     - Storefront checkout page: button disabled with amber "Ordering Will Open Soon (Pre-Launch)" badge.
5. **Automated Verification:**  
   - TypeScript Typecheck (`npm run typecheck`): **0 errors (PASS)**.
   - Unit Tests (`npm test`): **25/25 passing (PASS)** (+2 new unit tests).
   - Security Rules Tests (`npm run test:rules`): **38/38 passing (PASS)**.
   - Integration Tests (`npm run test:integration`): **233/233 passing across 19 suites (PASS)**.
   - Total Automated Tests: **296 passing**.
   - Next.js Production Build (`npm run build`): **All 30 routes compiled cleanly (PASS)**.

---

## 2. Infrastructure Baseline

| Component | Identifier / Detail | Current Status |
|---|---|---|
| **Storefront Domain** | `https://bazaarvilla.com` | **LIVE & SERVING** |
| **Git Repository** | `https://github.com/Coder-MayankSaini/trendzcart` | Tracked & Pushed |
| **Active Git Branch** | `task/016-prelaunch-safeguards-quarantine-readiness` | Clean Working Tree |
| **Hosting Platform** | Netlify (Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`) | **PRODUCTION** |
| **Production Site Name** | `trendzcartdemo` | Connected to domain |
| **Current Live Deploy** | `6af2234f54d68c5ee5d0e1bb` (Task 015 baseline) | Operational |
| **Runtime Environment** | Next.js 16.1.6, React 19.2.3, Node v24.15.0 / v22.23.4 | Stable |
| **Firebase Project** | `trendkartz` (Project Number: `63114929024`, Spark Plan) | Healthy |
| **Cloudflare R2 Bucket** | `bazaarvilla-media` (Endpoint: `*.r2.cloudflarestorage.com`) | Operational |
| **Razorpay Mode** | Test Mode Only (`rzp_test_Ty8NdX6efCPisf`) | **APPROVAL CONFIRMED FOR LIVE** |
| **Registered Webhook** | `Ty95LaT8ungdGT` -> `https://bazaarvilla.com/api/webhooks/razorpay` | Active |
| **Scheduled Function** | Netlify `reservation-cleanup` (cron `*/5 * * * *`) | Active |

---

## 3. Resolution of Historical Contradictions (TASK 014 vs TASK 015 vs Ground Truth)

### 3.1 Forensic Analysis of the Discrepancy
In TASK 014 and TASK 015, conflicting records were reported for the seven synthetic orders marked `PAID` during TASK 013:

1. **TASK 014 Reporting:**
   - Recorded the correct Razorpay Order IDs (`order_Ty9gr5iY9FUjq8`, `order_Ty9hM9JXw6arc1`, `order_Ty9mw6Dzbv0fRC`, `order_Ty9oA1k4JnDKaG`, `order_Ty9vsoavzdpvU5`, `order_Ty9wiRf1YIrmzg`, `order_TyAF4jNxi4kwXm`).
   - However, the reported payment IDs contained approximated test script timestamps ending with test suffixes (`_001`, `_002`, `_011`, etc.) rather than the exact milliseconds stored in Firestore.
2. **TASK 015 Reporting:**
   - The report author created `scripts/audit-seven-synthetic-orders.mjs` attempting to query the Firestore REST API using a user token from `~/.config/configstore/firebase-tools.json`.
   - The REST call failed with HTTP 401 `ACCESS_TOKEN_TYPE_UNSUPPORTED`.
   - Because the audit query failed, the table in Section 4 of TASK-015 was filled with placeholder formulas (`pay_synthetic_test_` + first 8 characters of order ID) and fabricated Razorpay Order IDs (`order_Ty9gw8XfE1K1mG`, `order_Ty9h1eR1b1JkF3`, etc.).
3. **TASK 016 Authoritative Resolution:**
   - Refactored `scripts/audit-seven-synthetic-orders.mjs` to authenticate directly via the Firebase Admin SDK using verified service account credentials loaded from Netlify (`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`).
   - Queried both the live Cloud Firestore database and the Razorpay REST API directly.

### 3.2 Authoritative Audit Table (Empirical Ground Truth)

The table below presents the verified reality stored in production Firestore and Razorpay:

| # | Firestore Order ID | Authoritative Razorpay Order ID | Authoritative Razorpay Payment ID | Razorpay Order Status | Gateway Amount Paid | Razorpay Payment Status | Current Firestore `paymentStatus` | Current Firestore `orderStatus` | Firestore `paymentRecords` Doc Exists? |
|---|---|---|---|---|---|---|---|---|---|
| **1** | `c39xYbGgIFZ7OeCogOLs` | `order_Ty9gr5iY9FUjq8` | `pay_TASK013_TEST_1794244449608` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **2** | `VCRIyEYOL9Qs9kXO3q0l` | `order_Ty9hM9JXw6arc1` | `pay_TASK013_TEST_1794244476766` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **3** | `9zZ9yDaKxacS5ZyYdFMO` | `order_Ty9mw6Dzbv0fRC` | `pay_TASK013_TEST_1794244793683` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **4** | `E1TSDrDBpbiKRLRoBljf` | `order_Ty9oA1k4JnDKaG` | `pay_TASK013_TEST_1794244863823` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **5** | `ZgX60mkrfy8bYPVG5xAr` | `order_Ty9vsoavzdpvU5` | `pay_TASK013_TEST_1794245301193` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **6** | `MBbquzz08LpVNZqqUTSt` | `order_Ty9wiRf1YIrmzg` | `pay_TASK013_TEST_1794245348865` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |
| **7** | `DV0JKWgs60V8lUvGEv5u` | `order_TyAF4jNxi4kwXm` | `pay_TASK013_TEST_1794246392047` | `created` (HTTP 200) | ₹0 (0 paise) | **HTTP 400 "id does not exist"** | `PAID` | `Processing` | **YES** (`status: "CAPTURED"`) |

### Key Audit Findings
- Every synthetic order originated from automated test scripts in TASK 013 prior to the implementation of `verifyPaymentWithGateway` in TASK 014.
- All 7 Razorpay orders were initialized with `amount: 14900` paise (₹149 after ₹50 discount) and remain in `created` status with `amount_paid: 0`.
- Every synthetic payment ID (`pay_TASK013_TEST_*`) fails existence checks on Razorpay API (`"The id provided does not exist"`).
- Zero customer funds were involved, and no real card or bank authorizations were executed.

---

## 4. Safe Exact-Record Quarantine Design & Dry-Run Execution

### 4.1 Quarantine Architecture & Data Integrity Guarantees
To reconcile these orders without breaking financial audit trails or triggering unintended side-effects:

1. **Strict Non-Destruction:** Documents in `orders` and `paymentRecords` are **never deleted**.
2. **Schema & UI Compatibility:**
   - `orderStatus`: `"Cancelled"` (strictly conforms to TypeScript `OrderStatus` enum).
   - `paymentStatus`: `"UNPAID_SYNTHETIC_ARTIFACT"`.
   - `quarantined`: `true`.
   - `quarantinedAt`: ISO 8601 timestamp.
   - `quarantineReason`: `"TASK_016_EXACT_SYNTHETIC_PAYMENT_RECONCILIATION"`.
   - `adminNotes`: `"Historical Task 013/014 synthetic test order marked PAID without gateway payment. Quarantined in Task 016 with verified exact IDs."`.
3. **Inventory Loop Prevention (`reservationReleased: true`):**  
   Catalog stock was already normalized to 46 units in TASK 013/014. Setting `reservationReleased: true` ensures that the automated `reservation-cleanup` scheduled function does not see these orders as pending unreleased expired reservations and will **NOT** erroneously increment stock by +7 units.
4. **Administrative & Financial Protection:**
   - Quarantined orders are flagged with an amber badge in `/admin/orders` and status updates are disabled.
   - Quarantined orders are excluded from GMV and revenue totals in `/admin/dashboard`.

### 4.2 Exact Document Patch Definition
The following patch is queued for application upon owner confirmation:

```json
// Patch applied to orders/{orderId}
{
  "orderStatus": "Cancelled",
  "paymentStatus": "UNPAID_SYNTHETIC_ARTIFACT",
  "quarantined": true,
  "quarantinedAt": "2026-11-09T20:57:32.351Z",
  "quarantineReason": "TASK_016_EXACT_SYNTHETIC_PAYMENT_RECONCILIATION",
  "reservationReleased": true,
  "reconciliationRequired": false,
  "adminNotes": "Historical Task 013/014 synthetic test order marked PAID without gateway payment. Quarantined in Task 016 with verified exact IDs."
}

// Patch applied to paymentRecords/{razorpayPaymentId}
{
  "status": "QUARANTINED_SYNTHETIC",
  "quarantined": true,
  "quarantinedAt": "2026-11-09T20:57:32.351Z",
  "quarantineReason": "SYNTHETIC_PAYMENT_NONEXISTENT_ON_GATEWAY",
  "notes": "Payment ID was synthetically generated during testing and never existed on Razorpay."
}
```

### 4.3 Dry-Run Execution Evidence
`scripts/prepare-seven-orders-quarantine.mjs` was executed in dry-run mode against live Firestore:

```
================================================================================
TASK 016 — EXACT-RECORD QUARANTINE PREPARATION & AUDIT
Mode:            DRY-RUN MODE (READ-ONLY SIMULATION)
Firebase Target: trendkartz
================================================================================

Target Orders Audited:      7
Target Payment Records:     7
Mismatches Detected:        0
Inventory Stock Alterations: ZERO (Stock preserved at 46 units)
Data Loss / Deletions:      ZERO (Full audit history retained)

[STATUS: DRY-RUN COMPLETED SUCCESSFULLY]
No records were modified in Firestore.
Awaiting explicit owner approval.
```

---

## 5. Synthetic Test Products & Coupons Deactivation

### 5.1 Storefront & Purchasing Protection Strategy
To ensure that synthetic test products and coupons created in TASK 013 cannot be browsed, added to cart, or purchased:

1. **Storefront Grid Filtering:**  
   Updated `src/app/(storefront)/products/page.tsx` and `src/app/(storefront)/products/[...slug]/page.tsx` to automatically filter out products matching test criteria (`id.startsWith("task")`, `category === "Testing"`, `isTestFixture === true`, `purchasable === false`, or `isArchived === true`).
2. **Server-Authoritative Pricing Guard:**  
   Updated `src/lib/orders/pricing.ts` in `calculateOrderPricing` and `calculateCouponDiscount`:
   - Products with `category === "Testing"` or `isTestFixture === true` or starting with `task013_test_` fail validation with `"Product '...' is no longer available"`.
   - Coupons starting with `TASK013_` or `TEST_` fail validation with `"Test coupons cannot be used for commercial checkout"`.
   - Both guards allow test fixtures **only** when `allowTestFixtures` is explicitly passed via verified administrator test checkout (`isAuthorizedTestCheckout`).
3. **Database Deactivation Tool:**  
   Authored `scripts/sanitize-synthetic-fixtures.mjs`:
   - Products (`task013_test_prod_custom`, `task013_test_prod_lowstock`, `task013_test_prod_simple`): marks `isVisible: false`, `isArchived: true`, `isTestFixture: true`, `purchasable: false`, `status: "archived"`.
   - Coupons (`TASK013_SAVE50`, `TASK013_TEST_COUPON_SAVE50`): marks `isActive: false`, `isTestFixture: true`, `status: "disabled"`.
   - Tested in dry-run mode: ready for owner execution.

---

## 6. Verification of Existing Checkout Gate & Release Safeguards

### 6.1 Server-Authoritative Checkout Gate Probing
Executed live HTTP probes against deployed production `https://bazaarvilla.com`:

| Probe ID | Target Endpoint | Method | Request Payload | Observed Response | Verification Verdict |
|---|---|---|---|---|---|
| **GATE-LIVE-01** | `/api/razorpay/public-config` | `GET` | None | `HTTP 200` `{ keyId: 'rzp_test_...', commercialCheckoutEnabled: false }` | **PASS (Commercial Gate Closed)** |
| **GATE-LIVE-02** | `/api/orders/create` (COD) | `POST` | Valid customer shipping + item | `HTTP 503` `{ error: "Ordering will open soon...", code: "COMMERCIAL_CHECKOUT_DISABLED" }` | **PASS (Fail-Closed Enforcement)** |
| **GATE-LIVE-03** | `/api/razorpay/create-order` (Prepaid) | `POST` | Valid customer shipping + item | `HTTP 503` `{ error: "Ordering will open soon...", code: "COMMERCIAL_CHECKOUT_DISABLED" }` | **PASS (Fail-Closed Enforcement)** |
| **GATE-LIVE-04** | Storefront `/checkout` | Browser | Navigated with items in cart | "Ordering Will Open Soon (Pre-Launch)" button disabled (`cursor: not-allowed`) | **PASS (Storefront UI Gated)** |

### 6.2 Payment Safeguards Verification
- **`verifyPaymentWithGateway` (`src/lib/orders/gatewayVerification.ts`):** Validated in test suites TRUST-001 through TRUST-020. Mandates server-to-server Razorpay API verification for every finalization request. Synthetic, unauthorized, or mismatched payments are rejected with HTTP 400.
- **Idempotency (Level 1 & Level 2):** Duplicate webhooks acknowledge with HTTP 200 `{ duplicate: true }` without database mutation. Dual-path races between browser callback and webhook resolve transactionally.
- **Scheduled Reservation Cleanup (`reservation-cleanup`):** Running on Netlify every 5 minutes (`*/5 * * * *`). Discovers expired reservations, verifies zero payment on Razorpay API, and releases stock safely.

---

## 7. Master Launch-Readiness Checklist

| Category | Verification Item | Current Status | Notes / Evidence |
|---|---|---|---|
| **Gateway & Compliance** | Razorpay Live Mode Approval | **APPROVED** | Merchant approval confirmed by Razorpay. |
| **Gateway & Compliance** | Test Mode Isolation | **VERIFIED** | Active server keys remain strictly `rzp_test_*`. Zero live payments initiated. |
| **Gateway & Compliance** | Server Gateway Verification | **ACTIVE** | `verifyPaymentWithGateway` verifies payment capture before marking `PAID`. |
| **Checkout & Protection** | Commercial Checkout Gate | **ACTIVE** | `COMMERCIAL_CHECKOUT_ENABLED=false` blocks COD & prepaid orders with HTTP 503. |
| **Checkout & Protection** | Storefront Pre-Launch Notice | **ACTIVE** | Checkout button disabled; amber banner informs visitors. |
| **Storefront & Catalog** | Brand Unification | **COMPLETE** | 100% of customer views present **Bazaarvilla** (`support@bazaarvilla.com`). |
| **Storefront & Catalog** | Synthetic Products Hidden | **PROTECTED** | Code guards and filters hide test products; DB patch prepared. |
| **Storefront & Catalog** | Synthetic Coupons Blocked | **PROTECTED** | Server pricing rejects `TASK013_*` coupons; DB patch prepared. |
| **Data & Inventory** | Historical Orders Reconciliation | **READY** | 7 orders audited; non-destructive quarantine dry-run verified. |
| **Data & Inventory** | Inventory Cleanup Scheduled Function | **ACTIVE** | Running on cron `*/5 * * * *` with gateway verification and idempotency. |
| **Storage & Media** | Cloudflare R2 Media Bucket | **ACTIVE** | `bazaarvilla-media` operational with presigned uploads and download proxy. |
| **Security & Privacy** | Netlify Secret Scanning | **ACTIVE** | `SECRETS_SCAN_ENABLED=true` passing remotely on 84 files with 0 leaks. |
| **Security & Privacy** | Guest Order Privacy | **ENFORCED** | Cryptographic 256-bit guest access tokens prevent order enumeration. |
| **Security & Privacy** | Firestore Security Rules | **ENFORCED** | Rules version 2 denies direct browser writes to financial collections. |
| **Automated Testing** | Full Automated Test Suite | **100% PASS** | 25 unit + 38 rules + 233 integration = **296 tests passing**. |
| **Production Build** | Next.js App Router Compilation | **100% PASS** | 30 routes compiled with 0 errors. |

---

## 8. Remaining Blockers & TASK 017 Live Mode Cutover Blueprint

### 8.1 Remaining Blockers Prior to Public Launch
1. **Explicit Owner Authorization for Historical Quarantine:**  
   The non-destructive quarantine for the 7 false-PAID orders and deactivation of synthetic fixtures is dry-run verified and requires owner approval to execute.
2. **Generation of Live Mode API Keys:**  
   The merchant owner must generate Live Mode API Key ID and Key Secret in the Razorpay Dashboard.
3. **Registration of Live Mode Webhook:**  
   A dedicated Live Mode webhook must be created in Razorpay pointing to `https://bazaarvilla.com/api/webhooks/razorpay`.

### 8.2 Exact Information Required for TASK 017 Live Cutover
When initiating TASK 017, the owner will provide:
```
1. RAZORPAY_KEY_ID:         rzp_live_xxxxxxxxxxxxxxxx
2. RAZORPAY_KEY_SECRET:     xxxxxxxxxxxxxxxxxxxxxxxx
3. RAZORPAY_WEBHOOK_SECRET: xxxxxxxxxxxxxxxxxxxxxxxx (generated during Live webhook setup)
```

### 8.3 Step-by-Step TASK 017 Execution Procedure
```
+-------------------------------------------------------------------------------+
|                        TASK 017 LIVE CUTOVER RUNBOOK                          |
+-------------------------------------------------------------------------------+
| STEP 1: Apply Historical Quarantine & Sanitization                           |
|         Run: node scripts/prepare-seven-orders-quarantine.mjs --confirm-...   |
|         Run: node scripts/sanitize-synthetic-fixtures.mjs --confirm-...       |
|                                                                               |
| STEP 2: Configure Live Mode Environment Variables in Netlify                  |
|         npx netlify env:set RAZORPAY_KEY_ID "rzp_live_..." --secret          |
|         npx netlify env:set NEXT_PUBLIC_RAZORPAY_KEY_ID "rzp_live_..."        |
|         npx netlify env:set RAZORPAY_KEY_SECRET "..." --secret                |
|         npx netlify env:set RAZORPAY_WEBHOOK_SECRET "..." --secret            |
|                                                                               |
| STEP 3: Configure Live Razorpay Webhook in Dashboard                          |
|         URL: https://bazaarvilla.com/api/webhooks/razorpay                    |
|         Secret: matches RAZORPAY_WEBHOOK_SECRET                               |
|         Active Events: payment.captured, payment.failed, payment.authorized,  |
|                        order.paid                                             |
|                                                                               |
| STEP 4: Deploy & Verify Live Smoke Test in Closed Admin Mode                   |
|         Trigger build and execute minimal ₹1 live transaction test            |
|                                                                               |
| STEP 5: Enable Commercial Checkout Gate for the Public                       |
|         npx netlify env:set COMMERCIAL_CHECKOUT_ENABLED "true"                |
|         Public storefront is officially open for commercial sales!            |
+-------------------------------------------------------------------------------+
```

---

## 9. Automated Verification Summary

```
================================================================================
BAZAARVILLA AUTOMATED TEST SUITE EXECUTION SUMMARY (TASK 016)
================================================================================
TypeScript Typecheck:               PASSED (0 errors)
Pricing & Isolation Unit Tests:     25 / 25 PASSED
Security Rules Integration Tests:   38 / 38 PASSED
Emulator Integration Tests:        233 / 233 PASSED across 19 suites
Next.js Production Build:           30 / 30 routes compiled successfully
Total Automated Tests Passing:      296 / 296 (100% Pass Rate)
================================================================================
```
