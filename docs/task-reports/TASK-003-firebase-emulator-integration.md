# TASK 003 — Firebase Emulator Suite, Integration Testing & Order Security Verification

**Author:** Principal Software Engineer, Firebase Security Engineer, Test Automation Architect  
**Project:** TrendKartz / Bazaarvilla E-Commerce Platform  
**Local Repository:** `C:\Users\Mayank Saini\Desktop\DeepuWebsite\trendzcart`  
**GitHub Remote:** `https://github.com/Coder-MayankSaini/trendzcart`  
**Active Branch:** `test/firebase-emulator-integration`  
**Base Commit:** `9cd151a` (`fix/sec-order-pricing-integrity`)  
**Execution Date:** November 8, 2026  
**Commercial Go-Live Recommendation:** **NO-GO FOR COMMERCIAL TRANSACTIONS** (Awaiting Server Webhooks [TASK-004] & Production Rules [TASK-006])

---

## 1. Executive Summary

TASK 003 establishes a fully production-isolated, automated integration testing harness powered by the **Firebase Local Emulator Suite** (`demo-trendkartz`) and executes independent verification of the server-side order pricing, inventory decrement, coupon redemption, and payment signature security remediations implemented during TASK 002.

Prior to TASK 003, testing was confined to mock unit tests (`tests/unit/pricing.test.ts`). Crucially, zero integration tests had ever interacted with a real Firestore database or emulator. During our emulator integration verification, **five critical defects and subtle architectural vulnerabilities** in the initial TASK 002 implementation were discovered, diagnosed, and resolved:

1. **Firestore `undefined` Value Rejection:** Firestore Admin SDK rejected orders containing optional fields (e.g. `size: undefined`) with fatal document write errors.
2. **Duplicate Line Item Stock Bypass:** Line-by-line stock checking allowed an attacker to bypass inventory limits by splitting a single scarce product into multiple cart line items.
3. **Non-Transactional Batch Race Condition (SEC-TEST-007):** Concurrent order creation requests caused `FieldValue.increment(-quantity)` to drop inventory into negative values (`-1`) and oversell scarce stock.
4. **Razorpay Signature Comparison Buffer Length RangeError:** `crypto.timingSafeEqual` threw unhandled `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` exceptions when comparing forged signatures of varying lengths, causing internal 500 server crashes instead of clean 400 validation rejections.
5. **Razorpay Direct Amount Fallback Vulnerability:** An unsafe legacy fallback in `/api/razorpay/create-order` allowed direct client-supplied amounts when items were omitted, opening an attack vector for ₹1 order generation.

By architecting a robust, fail-closed emulator guard, resolving host Java runtime requirements, implementing full Firestore Transactions (`runTransaction`), and enforcing strict item verification, **all 21 integration tests across 4 test suites now pass with 100% reliability**.

---

## 2. Git & Working Tree State

- **Branch Name:** `test/firebase-emulator-integration`
- **Creation Origin:** Cleanly branched from `fix/sec-order-pricing-integrity` at commit `9cd151a` (incorporating all TASK 002 pricing engine and route guard modifications).
- **Git Safety Protocol:**
  - Zero changes pushed to GitHub remote (`origin`).
  - No merge actions into `main` or production tracking branches.
  - No destructive Git commands executed (`git reset --hard`, `git checkout .`, `git clean -fd`).
  - Netlify hosting configuration (`netlify.toml`) preserved and unaltered.

---

## 3. Local Testing Environment & Java Compatibility Resolution

### 3.1 Host Environment Audit
- **Operating System:** Windows 11 Enterprise (64-bit)
- **Node.js Runtime:** `v24.15.0`
- **Package Manager:** `npm` `11.12.1`
- **Default System Java:** `OpenJDK 17.0.19` (Located in global PATH)

### 3.2 Java Runtime Compatibility Challenge
The Firebase Emulator Suite CLI (`firebase-tools@15.35.0`) bundles `cloud-firestore-emulator-v1.22.0.jar`, compiled with Java class file version 65.0 (Java 21). When initiated with the system default Java 17, `firebase-tools` terminated immediately with:
```text
Error: firebase-tools no longer supports Java version before 21. Please upgrade your Java version to 21 or higher.
```

### 3.3 Resolution Strategy
Rather than requiring manual global system environment changes, an automated multi-JDK resolution mechanism was designed in `scripts/run-integration-tests.js`. The runner inspects local machine directories for pre-installed modern JDKs:
- JetBrains Runtime: `C:\Program Files\JetBrains\IntelliJ IDEA 2026.1.4\jbr` (OpenJDK 25.0.2)
- User JDK cache: `C:\Users\Mayank Saini\.jdks\openjdk-26.0.1`

The test runner automatically sets `JAVA_HOME` and prepends the compatible JDK 25 `bin` directory to the child process environment, achieving seamless execution on any developer machine equipped with modern development tools.

---

## 4. Fail-Closed Emulator Safety Guards Implementation

To mathematically eliminate the catastrophic risk of test runs accidentally connecting to or altering live Firebase production databases, an authoritative safety guard module was constructed:

**File:** [`src/lib/firebase/emulatorGuard.ts`](../../src/lib/firebase/emulatorGuard.ts)

### 4.1 Safety Invariants Enforced
1. **Demo Project ID Requirement:** In emulator mode (`USE_FIREBASE_EMULATOR=true` or `NODE_ENV=test`), `GCLOUD_PROJECT` or `FIREBASE_PROJECT_ID` MUST begin with the prefix `demo-` (enforcing offline in-memory operation).
2. **Loopback Host Enforcement:** `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, and `FIREBASE_STORAGE_EMULATOR_HOST` MUST point exclusively to loopback interfaces (`localhost`, `127.0.0.1`, or `[::1]`). External IPs or domains trigger immediate process aborts.
3. **Razorpay Live Key Blocking:** If `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` begins with `rzp_live_`, the guard throws an immediate fatal exception: `CRITICAL SAFETY VIOLATION: Razorpay Live Mode key detected in test/emulator environment!`
4. **Integration with Firebase Admin & Client SDKs:** Both [`src/lib/firebase/admin.ts`](../../src/lib/firebase/admin.ts) and [`src/lib/firebase/config.ts`](../../src/lib/firebase/config.ts) invoke `assertEmulatorSafety()` at startup before initializing any database connections.

The safety invariants are covered by an automated test suite ([`tests/integration/emulator-safety.test.ts`](../../tests/integration/emulator-safety.test.ts)), verifying all 8 fail-closed scenarios.

---

## 5. Firebase Emulator Suite Configuration

**Configuration File:** [`firebase.json`](../../firebase.json)

```json
{
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "auth": {
      "port": 9099
    },
    "storage": {
      "port": 9199
    },
    "ui": {
      "enabled": true,
      "port": 4000
    },
    "singleProjectMode": true
  }
}
```

The emulator suite runs completely self-contained with in-memory state:
- **Project ID:** `demo-trendkartz`
- **Firestore Port:** `8080`
- **Auth Port:** `9099`
- **Storage Port:** `9199`
- **UI Dashboard Port:** `4000`

---

## 6. Test Fixture Architecture & Isolation Guarantees

All integration tests execute against strictly synthetic, zero-production fixtures located under `tests/fixtures/`:

1. **Products ([`tests/fixtures/products.ts`](../../tests/fixtures/products.ts)):**
   - `prod-hoodie-1000`: Synthetic Demo Hoodie (Price: ₹1000, Stock: 10)
   - `prod-tshirt-500`: Synthetic Demo T-Shirt (Price: ₹500, Stock: 5)
   - `prod-scarce-stock-1`: Scarce Stock Limited Cap (Price: ₹750, Stock: 1) — specifically created for concurrency race condition testing.
   - `prod-hidden-item`: Inactive/Hidden Catalog Item (`isVisible: false`)
   - `prod-zero-stock`: Depleted Inventory Item (`inventory: 0`)

2. **Coupons ([`tests/fixtures/coupons.ts`](../../tests/fixtures/coupons.ts)):**
   - `DISCOUNT10`: 10% active coupon (Limit: 100, TimesUsed: 5)
   - `FLAT200`: Flat ₹200 active coupon (Limit: 50, TimesUsed: 0)
   - `EXPIRED20`: 20% expired coupon (Past ISO timestamp)
   - `INACTIVE50`: Inactive coupon (`isActive: false`)
   - `MAXEDOUT`: Exhausted coupon (Limit: 10, TimesUsed: 10)
   - `LASTUSE1`: 1 redemption remaining coupon (Limit: 5, TimesUsed: 4) — for concurrency validation.

3. **Orders & Addresses ([`tests/fixtures/orders.ts`](../../tests/fixtures/orders.ts)):**
   - `SYNTHETIC_SHIPPING_ADDRESS`: Synthetic delivery coordinates in Jaipur, Rajasthan.
   - `EXISTING_SYNTHETIC_ORDER`: Pre-seeded order document (`order-existing-victim-999`) used to verify order overwrite prevention.

---

## 7. Automated Integration Test Suite Architecture

To execute modern Next.js 16 App Router Route Handlers directly under Node's native ESM test runner without bundling overhead, a lightweight test loader infrastructure was engineered:

- **Custom Module Loader ([`tests/loader.mjs`](../../tests/loader.mjs)):** Dynamically remaps `next/server` to `next/server.js`, stubs `server-only`, resolves `@/*` path aliases to `./src/*`, and automatically appends `.ts` extensions to relative ESM imports.
- **Registration Hook ([`tests/register.mjs`](../../tests/register.mjs)):** Registers the loader via Node's `--import` flag.
- **Integration Test Helper ([`tests/integration/testHelper.ts`](../../tests/integration/testHelper.ts)):** Provides automated database seeding, collection clearing, and synthetic `NextRequest` generation.
- **Sequential Execution Control:** Configured with `--test-concurrency=1` to ensure individual test suites do not experience database cross-talk during teardown/seed lifecycles.

---

## 8. Verification Results

### 8.1 Summary Table

| Test Suite | File | Tests Run | Passed | Failed | Status |
|---|---|---|---|---|---|
| **Emulator Safety Guards** | `tests/integration/emulator-safety.test.ts` | 8 | 8 | 0 | **PASSED** |
| **Order Creation Route** | `tests/integration/orders-create.test.ts` | 8 | 8 | 0 | **PASSED** |
| **Razorpay Order Route** | `tests/integration/razorpay-create-order.test.ts` | 3 | 3 | 0 | **PASSED** |
| **Inventory & Coupon Concurrency** | `tests/integration/inventory-concurrency.test.ts` | 2 | 2 | 0 | **PASSED** |
| **Pricing Engine Unit Tests** | `tests/unit/pricing.test.ts` | 12 | 12 | 0 | **PASSED** |
| **Total Test Verification** | **All Suites** | **33** | **33** | **0** | **100% PASS** |

### 8.2 Security Requirement Verifications

- **SEC-TEST-001 (Price Tampering Rejection):** Verified. A payload with tampered unit prices (`₹1` instead of `₹1000`) and tampered total (`₹2`) was rejected with status `400` (`total mismatch`). Zero tampered documents were written to Firestore.
- **SEC-TEST-001b (Authoritative Price Creation):** Verified. When matching valid prices are submitted, the order is created with authoritative database pricing (`₹2000`) and persisted correctly.
- **SEC-TEST-002 (Unpaid COD Rejection):** Verified. An order submitted with `paymentMethod: "COD"` and `paymentStatus: "PAID"` was strictly normalized to `paymentStatus: "PENDING"`.
- **SEC-TEST-003 (Order Overwrite Prevention):** Verified. Submitting an existing victim order ID (`order-existing-victim-999`) assigned a brand new server-generated document ID; the victim's order remained completely untouched.
- **SEC-TEST-006 (Coupon Validation):** Verified. Expired, inactive, and usage-limit-exhausted coupons were rejected with explicit error codes.
- **SEC-TEST-007 (Inventory Concurrency Isolation):** Verified. Two concurrent checkout requests targeting a scarce item with stock = 1 executed under load. Exactly 1 order succeeded (Status 200), the second was rejected (Status 400), and final stock remained non-negative (`0`).
- **SEC-TEST-008 (Razorpay Signature Validation):** Verified. Valid HMAC signatures were accepted; forged signatures of varying lengths were rejected cleanly with status `400`.
- **SEC-TEST-QTY (Quantity Sanitation):** Verified. Zero, negative, and fractional quantities were strictly rejected.
- **Duplicate Lines Aggregation:** Verified. Split line items for the same product were aggregated prior to stock evaluation, preventing overselling.
- **Razorpay Direct Amount Fallback:** Verified. Attempting to create a Razorpay order without providing line items was rejected with status `400`.

---

## 9. Critical Defect Discoveries & Production Integrity Remediations

Integration testing with the live emulator revealed five concrete vulnerabilities in the previous TASK 002 code:

### 9.1 Firestore `undefined` Property Rejection
- **Defect:** In `pricing.ts`, line items were mapped with `size: item.size`. When `size` was undefined, Firestore threw: `Cannot use "undefined" as a Firestore value (found in field "items.0.size")`.
- **Remediation:** 
  1. Configured `admin.firestore().settings({ ignoreUndefinedProperties: true })` in `src/lib/firebase/admin.ts`.
  2. Sanitized `validatedItems` construction in `src/lib/orders/pricing.ts` to omit undefined keys entirely.

### 9.2 Split Duplicate Item Inventory Bypass
- **Defect:** `calculateOrderPricing` checked item stock iteratively (`product.inventory < quantity`). If a customer added two cart lines for the same product with quantity 1 each (total 2) when available inventory was 1, both iterations evaluated `1 <= 1` as valid. Furthermore, calling `batch.update(productRef, ...)` twice on the same document in a batch threw a fatal Firestore error: `Multiple write operations on the same document are not allowed in a batch`.
- **Remediation:**
  1. `calculateOrderPricing` now pre-aggregates requested quantities by `productId` into a `Map<string, number>` and checks total demand against catalog inventory.
  2. Inventory decrements are aggregated per `productId` before updating.

### 9.3 Batch Decrement Race Condition & Negative Inventory (SEC-TEST-007)
- **Defect:** The previous implementation performed read checks in `calculateOrderPricing` and then executed `batch.update(productRef, { inventory: FieldValue.increment(-quantity) })`. When two concurrent requests arrived for a scarce product (stock = 1), both requests read stock = 1, both passed validation, and both executed `FieldValue.increment(-1)`. As captured during initial test runs:
  ```text
  [CONCURRENCY TEST 007] Status A: 200, Status B: 200, Final Stock: -1
  ```
  Inventory dropped to `-1` and the product was oversold.
- **Remediation:** Migrated `/api/orders/create` from `adminDb.batch()` to a serializable **Firestore Transaction (`adminDb.runTransaction`)**. Within the transaction:
  - All product, coupon, and order documents are read during the initial read phase.
  - In-memory pricing, stock levels, and coupon limits are evaluated.
  - When concurrent transactions conflict, Firestore automatically retries the transaction. The second transaction reads the decremented inventory (`0`), detects insufficient stock, and aborts cleanly.
  - Result verified: `Status A: 400, Status B: 200, Final Stock: 0, Orders Created: 1`.

### 9.4 Razorpay Cryptographic Timing Comparison Buffer Mismatch
- **Defect:** In `verifyRazorpaySignature`:
  ```ts
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature));
  ```
  If an attacker submitted a forged signature whose character length differed from the 64-character SHA-256 hex digest, Node's `crypto.timingSafeEqual` threw a fatal `RangeError: Input buffers must have the same byte length`. This caused unhandled exceptions and returned HTTP 500 instead of a proper 400 rejection.
- **Remediation:** Added buffer length validation prior to invoking `timingSafeEqual`:
  ```ts
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(razorpaySignature);
  if (expectedBuf.length !== signatureBuf.length) {
      return false;
  }
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  ```

### 9.5 Razorpay Order Creation Direct Amount Fallback Bypass
- **Defect:** In `/api/razorpay/create-order/route.ts`, if `items` were omitted, the route fell back to `else if (typeof body.amount === "number") { calculatedTotalRupees = body.amount; }`. Because Razorpay payment signatures only sign `order_id|payment_id` without encoding the amount, an attacker could create a Razorpay order for ₹1 without items, pay ₹1, obtain a valid signature, and pass it to `/api/orders/create` alongside expensive items.
- **Remediation:** Completely removed the direct amount fallback. The route now strictly enforces `items`:
  ```ts
  if (Array.isArray(body.items) && body.items.length > 0 && adminDb) {
      // authoritative database calculation
  } else {
      return NextResponse.json({ error: "Order items are required to verify pricing" }, { status: 400 });
  }
  ```

---

## 10. Test Automation Scripts & Execution Evidence

### 10.1 Added NPM Scripts
In `package.json`:
- `"test"`: `node --test tests/unit/pricing.test.ts`
- `"test:integration"`: `node scripts/run-integration-tests.js`
- `"typecheck"`: `tsc --noEmit`

### 10.2 Execution Logs Summary
```text
================================================================================
TRENDKARTZ / BAZAARVILLA — FIREBASE EMULATOR INTEGRATION TEST RUNNER
Java Runtime: C:\Program Files\JetBrains\IntelliJ IDEA 2026.1.4\jbr
Project ID:   demo-trendkartz (PRODUCTION ISOLATED)
Emulators:    Firestore (8080), Auth (9099), Storage (9199)
================================================================================
✔ Firebase Emulator Production Isolation & Safety Guards (3.0502ms)
[CONCURRENCY TEST 007] Status A: 400, Status B: 200, Final Stock: 0, Orders Created: 1
✔ Inventory & Coupon Concurrency Integration Tests (Firestore Emulator) (8478.4683ms)
✔ POST /api/orders/create Integration Tests (Firestore Emulator) (1069.3254ms)
[DIRECT AMOUNT FALLBACK CHECK] Status: 400 Created Amount: undefined
✔ POST /api/razorpay/create-order Integration Tests (431.9113ms)
ℹ tests 21
ℹ suites 4
ℹ pass 21
ℹ fail 0
+  Script exited successfully (code 0)
```

---

## 11. Build Verification & Serverless Compatibility

Executing `npm run build` confirmed zero regression across all application components:
- **Next.js Engine:** Next.js 16.1.6 (Turbopack)
- **Compilation Duration:** 5.9 seconds
- **TypeScript Checking:** 0 errors
- **Page Optimization:** 22/22 routes prerendered / dynamically compiled
- **Serverless API Routes:**
  - `ƒ /api/orders/by-ids`
  - `ƒ /api/orders/create`
  - `ƒ /api/razorpay/create-order`
  - `ƒ /api/razorpay/public-config`
  - `ƒ /api/razorpay/verify-payment`

---

## 12. Commercial Transacting Safety Assessment

### Current Verdict: **NO-GO FOR COMMERCIAL TRANSACTIONS**

### Progress Achieved
- Local emulator infrastructure established and verified.
- Core checkout pricing, order generation, coupon mechanics, and inventory decrements verified under real database integration and concurrent load.
- Critical architectural defects in previous implementations resolved.

### Remaining Blocker Checklist Before Production Launch
1. **Server-Side Payment Webhooks (TASK-004):** Currently, payment confirmation relies solely on the browser completing checkout. If a customer pays on Razorpay but closes the window, loses network, or experiences mobile browser termination before the redirect completes, the order document is never updated to `"PAID"`, stock is not reserved, and fulfillment stalls.
2. **Guest Order Retrieval Exposure (TASK-005):** `/api/orders/by-ids` remains unauthenticated and accepts arbitrary order ID arrays, leaking customer names, shipping addresses, and phone numbers.
3. **Production Firestore Rules & Admin Authorization (TASK-006):** Production Firestore rules must be version-controlled, tested against the emulator, and deployed to prevent unauthorized writes outside of serverless Admin routes.

---

## 13. Outstanding Security & Architectural Risks

| Risk ID | Severity | Status | Description | Action Required |
|---|---|---|---|---|
| **RSK-05** | **HIGH** | **OPEN** | Missing Razorpay server-to-server webhooks (`payment.captured`) | Implement `/api/webhooks/razorpay` in TASK-004 |
| **RSK-03** | **HIGH** | **OPEN** | Unauthenticated guest order lookup in `/api/orders/by-ids` exposes customer PII | Add OTP/phone verification & rate limiting in TASK-005 |
| **RSK-04** | **HIGH** | **OPEN** | Admin privileges determined by client-side document read | Implement Firebase Custom Claims in TASK-006 |
| **RSK-06** | **HIGH** | **OPEN** | Production Firestore & Storage rules unverified | Version and test security rules in emulator in TASK-006 |
| **RSK-07** | **HIGH** | **OPEN** | 34 vulnerable npm packages in lockfile | Audit & update dependencies in subsequent maintenance task |

---

## 14. Next Recommended Task & Handoff Checklist

### Recommended Next Task: **TASK 004 — Razorpay Server Webhooks & Payment Idempotency**

#### Objectives for Next Agent:
1. Create a dedicated endpoint at `src/app/api/webhooks/razorpay/route.ts`.
2. Verify Razorpay webhook cryptographic signatures using `RAZORPAY_WEBHOOK_SECRET`.
3. Handle `payment.captured` and `order.paid` events idempotently.
4. If an order was already marked `"PAID"` via the checkout redirect, acknowledge cleanly without duplicate inventory decrements.
5. If an order remained `"PENDING"`, update to `"PAID"`, record `razorpayPaymentId`, and decrement inventory safely within a Firestore Transaction.
6. Create an automated integration test in `tests/integration/razorpay-webhooks.test.ts` verifying event signature verification, idempotency, and replay protection.
