# TASK 010 — Isolated Hosted Staging Environment, Razorpay Test Mode E2E Verification & Release Security Gates

## 1. Task Metadata
- **Task Number:** TASK 010
- **Task Title:** Isolated Hosted Staging Environment, Razorpay Test Mode E2E Verification & Release Security Gates
- **Date:** 2026-11-09
- **Active Git Branch:** `release/staging-validation-task-010` (safely branched from `fix/staging-verification-gateway-recovery`)
- **Base Commit:** `9cd151a3f07858a2063be9c4b02477d8231b9d36`
- **Release Commit:** `PENDING REVIEW / CHECKPOINT COMMIT AUTHORIZED LOCALLY` (Zero remote pushes)
- **Status:** **COMPLETED LOCALLY — STAGING PENDING** (Production and remote staging permission gates strictly preserved; Zero unauthorized remote pushes, cloud deployments, or live transactions)

---

## 2. Executive Summary
TASK 010 established the release snapshot for tasks 001–009, resolved critical security and payment recovery vulnerabilities identified in prior task audits, hardened customer profile field permissions, enhanced fail-closed staging isolation guards, triaged npm dependency vulnerabilities, and prepared complete provisioning instructions for an isolated hosted staging environment.

Key technical remediations implemented:
1. **Remediated Review Authorization Bypass (`REVIEW-BYPASS`):** Eliminated direct client SDK write access to `/reviews/{reviewId}` in `firestore.rules`. Created an authoritative, rate-limited server-side review submission API endpoint (`POST /api/reviews/submit`) that validates Firebase ID token identity, verifies genuine product delivery (`orderStatus == "Delivered"`), enforces rating bounds (1–5) and comment constraints (1–2000 chars), prevents client tampering with `isFake` or `verifiedPurchase`, and enforces duplicate review protection. Updated storefront `ProductReviews.tsx` to submit through this route.
2. **Hardened Customer Profile Field Permissions:** In `firestore.rules`, implemented a strict allowlist policy (`isCustomerProfileAllowedFields`) restricting customer writes on `/users/{uid}` strictly to `['uid', 'email', 'role', 'createdAt', 'updatedAt', 'displayName', 'name', 'phone', 'phoneNumber', 'shippingAddress', 'address']`. Enforced immutability of `uid` and `createdAt`, prevented role escalation to `admin`, and blocked injection of arbitrary or privileged fields (`credits`, `isEmailVerified`, `fraudRisk`).
3. **Revalidated Gateway Receipt Recovery:** Hardened `recoverGatewayOrderForReceipt` to filter gateway orders strictly for exact receipt equality (protecting against partial or broad prefix matches), handle pagination overflow fail-closed, and implemented a 15-minute observation grace window in `reservationCleanup.ts` for uncertain gateway creation (`GATEWAY_STATE_UNCERTAIN`), preventing premature stock release before eventual consistency reconciles.
4. **Enhanced Staging Isolation Guard:** Hardened `stagingGuard.ts` with all 8 mandatory fail-closed rules (project ID consistency, service account email validation, production project/domain detection, Razorpay `rzp_test_` key enforcement, missing variables check, conflicting environment indicators, and emulator/hosted collision detection).
5. **Comprehensive Automated Verification:**
   - Unit tests: 23/23 passing (12 pricing + 11 staging guard).
   - Rules tests: 38/38 passing (5 admin authorization + 23 firestore rules + 10 storage rules).
   - Integration tests: 190/190 passing across 14 test suites in Firebase Emulator Suite (`demo-trendkartz`).
   - Total automated tests: 213 passed, 0 failures.
   - TypeScript compiler: 0 errors across all `.ts` and `.mts` files.
   - Next.js production build: 25/25 routes compiled and optimized.
6. **External Operations Gate:** Because project owner authorization is required for remote cloud resource provisioning (Firebase project creation, Netlify site creation, remote Git push, live Test Mode transactions), all remote hosted tests (`STAGE-001` through `STAGE-025`) are marked **NOT EXECUTED** with a complete owner-executable provisioning runbook provided. Production commercial transactions remain strictly **NO-GO**.

---

## 3. Prior Engineering Context
- **TASK 001 — Development Baseline:** Verified Node.js `v24.15.0` and npm `11.12.1`; evaluated emulator and staging architecture; cataloged dependencies; specified 10 security regression tests.
- **TASK 002 — Order Pricing and Integrity:** Built authoritative server pricing engine (`src/lib/orders/pricing.ts`); hardened `/api/orders/create`; enforced coupon validation and catalog price lookups; 12 unit tests passing.
- **TASK 003 — Firebase Emulator and Integration Tests:** Established production-isolated emulator suite (`demo-trendkartz`) with fail-closed emulator guard (`emulatorGuard.ts`); resolved negative stock race condition via `runTransaction`; 33 automated tests passing.
- **TASK 004 — Secure Payment Lifecycle:** Designed durable pending orders with stock reservation; built `/api/webhooks/razorpay` with raw-body HMAC-SHA256 signature verification; implemented dual-layer idempotency; 41 integration tests passing.
- **TASK 005 — Customer Order Privacy:** Resolved unauthenticated guest order exposure (`/api/orders/by-ids`); implemented dual-path authorization (verified Firebase ID token for registered users, 256-bit cryptographic guest access tokens stored as SHA-256 hashes); built distributed Firestore rate limiter; 61 integration tests passing.
- **TASK 006 — Firebase Security Rules and Admin Authorization:** Versioned `firestore.rules` and `storage.rules` (`rules_version = '2'`); restricted client SDK reads/writes on financial collections; migrated admin authorization to Firebase Auth Custom Claims (`admin: true`); built CLI claims manager; 109 automated tests passing.
- **TASK 007 — Reservation Cleanup and Payment Verification:** Implemented native Netlify Scheduled Function (`netlify/functions/reservation-cleanup.mts`, `*/5 * * * *`) and core cleanup engine (`reservationCleanup.ts`) with bounded queries; hardened synchronous payment verification (`/api/razorpay/verify-payment`) with mandatory `payments.fetch` status checks; 134 automated tests passing.
- **TASK 008 — Secure Guest Customization Uploads:** Established anonymous Firebase Auth for guests (`guestAuth.ts`); scoped Cloud Storage rules (`customizations/{ownerUid}/{fileName}`); built client image compression (`ProductCustomizer.tsx`); hardened server-side customization validation (`customizationAuth.ts`); 158 automated tests passing.
- **TASK 009 — Gateway Order Association Recovery:** Resolved `GATEWAY-SYNC` edge case; implemented gateway state machine (`gatewayRecovery.ts`), stable receipt lookup (`orders.all({ receipt })`), bounded Firestore association retries with exponential backoff, fail-closed stock protection, and staging isolation guard (`stagingGuard.ts`); 174 automated tests passing.

---

## 4. Git Release Snapshot & Repository Audit

### 4.1 Git Working Tree & Branch
- **Current Branch:** `release/staging-validation-task-010` (created directly from `fix/staging-verification-gateway-recovery`)
- **Base Commit:** `9cd151a3f07858a2063be9c4b02477d8231b9d36` (All prior tasks TASK-001 through TASK-009 preserved on working tree)
- **Cumulative Diff Review:**
  - 19 modified tracked files.
  - 17 untracked functional modules and test suites.
  - Clean local status with zero untracked runtime artifacts or build outputs.

### 4.2 Secret & Credential Scan
- **Command:** PowerShell recursive file search excluding `node_modules`, `.next`, and `.git`.
- **Findings:**
  - Zero private keys (`.pem`, `.key`) found in repository.
  - Zero Google service account JSON files stored on disk.
  - `.env.example` verified: contains only non-sensitive documentation placeholders and `demo-trendkartz` emulator defaults.
  - Zero live Razorpay credentials (`rzp_live_`) found in source code or configuration files.
  - `.gitignore` properly excludes `.env*` (except `.env.example`), `.next/`, `node_modules/`, `*-debug.log`, and `.netlify/`.

---

## 5. Review Authorization Remediation (TASK A)

### 5.1 Vulnerability Analysis (`REVIEW-BYPASS`)
In TASK 009 review, an authorization bypass was identified: while `src/app/api/reviews/eligibility/route.ts` checked whether a user had delivered orders before rendering the storefront review form, `firestore.rules` allowed any authenticated user to create a review document directly via the client SDK if:
```firestore
allow create: if (isAuthenticated()
  && request.resource.data.userId == request.auth.uid
  && request.resource.data.isFake == false) || isAdmin();
```
An attacker could bypass the eligibility check completely by invoking `setDoc(doc(db, "reviews", reviewId), ...)` from browser developer tools.

### 5.2 Server Route Implementation (`POST /api/reviews/submit`)
Created `src/app/api/reviews/submit/route.ts`:
1. **Token Authentication:** Verifies `Authorization: Bearer <idToken>` using `adminAuth.verifyIdToken(idToken, true)`.
2. **Authoritative Identity:** Binds `userId` authoritatively to the decoded token UID. Ignores any client-supplied `userId`.
3. **Input Validation:**
   - `productId`: non-empty trimmed string. Verifies product exists in `products` collection via `adminDb`.
   - `rating`: integer strictly between 1 and 5.
   - `comment`: trimmed non-empty string, maximum 2000 characters.
   - `images`: optional array of valid HTTP/HTTPS URLs (maximum 5).
   - `userName`: sanitized string (max 100 chars), defaulting to user's display name or `"Verified Buyer"`.
4. **Qualifying Purchase Verification:** Queries `orders` collection where `userId == uid` and `orderStatus == "Delivered"`. Verifies the order contains the product and is not marked `FAILED`. Rejects with HTTP 403 if no qualifying delivered purchase exists.
5. **Duplicate Review Policy:** Queries `reviews` collection where `productId == productId` and `userId == uid`. Rejects with HTTP 409 if a review already exists.
6. **Authoritative Moderation Fields:** Forces `isFake: false`, `verifiedPurchase: true`, and server-generated `reviewId = crypto.randomUUID()`.
7. **Rate Limiting:** Protects the route with distributed Firestore rate limiting (`checkRateLimit`) at 10 requests per minute per UID/IP.

### 5.3 Firestore Security Rules Update
Updated `firestore.rules`:
```firestore
match /reviews/{reviewId} {
  allow read: if true;
  allow create, update, delete: if isAdmin();
}
```
Direct client SDK creation, update, and deletion are strictly denied. Legitimate administrators maintain full moderation rights. All customer submissions must pass through `POST /api/reviews/submit`.

### 5.4 Frontend Integration
Updated `src/components/storefront/ProductReviews.tsx` to submit form data to `/api/reviews/submit` using the user's verified Firebase ID token instead of direct `setDoc`.

### 5.5 Automated Test Verification
Authored `tests/integration/reviews-submission.test.ts` (11 tests):
- `REV-001`: Verified buyer with delivered order submits review (HTTP 201). **PASSED**
- `REV-002`: Customer with NO purchase history rejected (HTTP 403). **PASSED**
- `REV-003`: Order in Processing rejected (HTTP 403). **PASSED**
- `REV-004`: Delivered order with different product rejected (HTTP 403). **PASSED**
- `REV-005`: Forged client `userId` ignored; bound to token UID. **PASSED**
- `REV-006`: Missing/invalid Authorization token rejected (HTTP 401). **PASSED**
- `REV-007`: Duplicate review rejected (HTTP 409). **PASSED**
- `REV-008`: Invalid ratings (0, 6, 3.5, string) rejected (HTTP 400). **PASSED**
- `REV-009`: Empty and oversized comments rejected (HTTP 400). **PASSED**
- `REV-010`: Injected moderation fields (`isFake`, `verifiedPurchase`, `id`) overridden. **PASSED**
- `REV-011`: Non-existent product rejected (HTTP 404). **PASSED**
- `RULE-015` in `firestore-rules.test.ts`: Direct client SDK write denied fail-closed. **PASSED**

---

## 6. Profile Authorization Hardening (TASK B)

### 6.1 Vulnerability Analysis
Previously, customer profile updates on `/users/{uid}` in `firestore.rules` checked that `role` was not updated to `admin`, but did not restrict arbitrary field additions. A malicious user could potentially inject unauthorized fields (e.g., `credits`, `isEmailVerified`, `fraudRisk`, `internalTier`).

### 6.2 Implementation
Added explicit allowed-field validation function in `firestore.rules`:
```firestore
function isCustomerProfileAllowedFields(data) {
  return data.keys().hasOnly([
    'uid', 'email', 'role', 'createdAt', 'updatedAt',
    'displayName', 'name', 'phone', 'phoneNumber',
    'shippingAddress', 'address'
  ]);
}

match /users/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow create: if (isOwner(uid)
    && request.resource.data.uid == uid
    && request.resource.data.role == 'customer'
    && isCustomerProfileAllowedFields(request.resource.data))
    || isAdmin();
  allow update: if (isOwner(uid)
    && request.resource.data.uid == resource.data.uid
    && request.resource.data.role == resource.data.role
    && request.resource.data.role == 'customer'
    && (!('createdAt' in request.resource.data) || request.resource.data.createdAt == resource.data.createdAt)
    && isCustomerProfileAllowedFields(request.resource.data))
    || isAdmin();
  allow delete: if isAdmin();
}
```

### 6.3 Automated Test Verification
Updated `tests/integration/firestore-rules.test.ts`:
- `RULE-005`: Customer cannot escalate role to admin. **PASSED**
- `RULE-005B`: Customer can update permitted fields (`displayName`, `phone`, `shippingAddress`, `updatedAt`). **PASSED**
- `RULE-005C`: Customer cannot inject arbitrary fields (`admin`, `credits`, `isEmailVerified`). **PASSED**
- `RULE-005D`: Customer cannot tamper with immutable `uid` or `createdAt`. **PASSED**

---

## 7. Payment Recovery & Receipt Reconciliation Review (TASK C)

### 7.1 Assumptions & Gateway SDK Verification
1. **Method & Arguments:** Razorpay SDK `orders.all({ receipt, count: 100 })` queries `/orders?receipt={receipt}&count=100`.
2. **Filtering Behavior:** Hardened `recoverGatewayOrderForReceipt` in `src/lib/orders/gatewayRecovery.ts` to filter returned items strictly for exact receipt equality (`candidate.receipt === receipt`), guarding against gateway prefix or broad match behavior.
3. **Pagination Handling:** If the gateway response indicates more items exist (`response.count > items.length && items.length >= 100`), or multiple exact matches exist, the function fails closed with `ambiguous: true` and routes the order for manual administrator review.
4. **Conservative Empty Result Policy:** In `src/lib/orders/reservationCleanup.ts`, if receipt lookup returns 0 matching orders, the engine checks whether gateway creation was uncertain (`GATEWAY_STATE_UNCERTAIN`) or attempted within the 15-minute observation grace window (`timeSinceAttemptMs < 15 * 60 * 1000`). If within the window, stock is **NOT** released; the order is marked `orderStatus: "Pending_Reconciliation"` with `reconciliationReason: "UNCERTAIN_GATEWAY_CREATION_IN_OBSERVATION_WINDOW"`. Only after the observation window has elapsed is stock safely restored.

### 7.2 Regression Tests Added
Updated `tests/integration/gateway-association-recovery.test.ts`:
- `SYNC-017`: Exact receipt filtering ignores partial or broad matches without false ambiguity. **PASSED**
- `SYNC-018`: Gateway pagination overflow flags ambiguity and fails closed. **PASSED**
- `SYNC-019`: Uncertain gateway order within observation window preserves stock and routes to reconciliation. **PASSED**
- `SYNC-020`: Repeat cleanup invocations are strictly idempotent (no double-restoration). **PASSED**

---

## 8. Staging Environment Architecture & Isolation Guards

### 8.1 Isolation Boundaries
| Parameter | Local Emulator | Staging (Prepared) | Production (Forbidden) |
|---|---|---|---|
| **Environment Indicator** | `NODE_ENV=test` | `APP_ENV=staging` | `APP_ENV=production` |
| **Firebase Project ID** | `demo-trendkartz` | `bazaarvilla-staging` | `bazaarvilla` |
| **Storage Bucket** | `demo-trendkartz.appspot.com` | `bazaarvilla-staging.appspot.com` | `bazaarvilla.appspot.com` |
| **Razorpay Key Mode** | Mock / Disabled | `rzp_test_...` (Test Mode) | `rzp_live_...` (Live Mode) |
| **Hosting Domain** | `localhost:3000` | `bazaarvilla-staging.netlify.app` | `bazaarvilla.com` |
| **Webhook Endpoint** | `/api/webhooks/razorpay` | `/api/webhooks/razorpay` (staging secret) | Production secret |

### 8.2 Staging Isolation Guard (`src/lib/security/stagingGuard.ts`)
Enforces the 8 mandatory fail-closed rules:
1. Server and client Firebase Project ID mismatch rejected; service account project mismatch rejected.
2. Production Firebase project ID (`bazaarvilla`, `trendzcart`) in staging rejected.
3. Production Storage bucket in staging rejected.
4. Razorpay `rzp_live_` key in staging rejected; non-`rzp_test_` key format rejected.
5. Missing required staging variables (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) rejected.
6. Conflicting environment indicators (`APP_ENV=staging` vs `NEXT_PUBLIC_APP_ENV=production`) rejected.
7. Emulator mode (`USE_FIREBASE_EMULATOR=true`) combined with non-demo hosted staging credentials rejected.
8. Production custom domain (`bazaarvilla.com`) configured in staging context rejected.

Guard is enforced at financial boundaries:
- `src/app/api/razorpay/create-order/route.ts`
- `src/app/api/razorpay/verify-payment/route.ts`
- `src/app/api/webhooks/razorpay/route.ts`
- `src/lib/orders/reservationCleanup.ts`

### 8.3 Automated Isolation Tests
Authored `tests/unit/staging-guard.test.ts` (11 tests):
`STAGE-ISO-001` through `STAGE-ISO-011` all passed in ~11ms.

---

## 9. Staging Provisioning Instructions (Owner Runbook)

To provision the isolated hosted staging environment when approved, execute the following steps:

### Step 1: Firebase Staging Project Creation
```bash
# 1. Login to Firebase CLI
firebase login

# 2. Create dedicated staging project (or select existing staging project)
firebase projects:create bazaarvilla-staging --display-name "Bazaarvilla Staging"

# 3. Deploy Security Rules and Indexes to staging exclusively
firebase deploy --project bazaarvilla-staging --only firestore:rules,storage,firestore:indexes
```

### Step 2: Enable Firebase Authentication Providers
In Firebase Console (`bazaarvilla-staging`):
1. Navigate to **Authentication** -> **Sign-in method**.
2. Enable **Anonymous** authentication (required for guest customization uploads).
3. Enable **Email/Password** and **Google** sign-in providers.

### Step 3: Bootstrap Staging Administrator Claim
```bash
# Set custom claim admin: true for approved staging administrator UID
node scripts/manage-admin-claims.mjs set <STAGING_ADMIN_FIREBASE_UID>
```

### Step 4: Dedicated Netlify Staging Site Creation
In Netlify Console:
1. Create a new site from Git: select `Coder-MayankSaini/trendzcart`, branch `release/staging-validation-task-010`.
2. Set Site Name: `bazaarvilla-staging` (Site URL: `https://bazaarvilla-staging.netlify.app`).
3. Configure Staging Environment Variables:
   ```text
   APP_ENV=staging
   NEXT_PUBLIC_APP_ENV=staging
   FIREBASE_PROJECT_ID=bazaarvilla-staging
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=bazaarvilla-staging
   NEXT_PUBLIC_FIREBASE_API_KEY=<STAGING_FIREBASE_API_KEY>
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=bazaarvilla-staging.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=bazaarvilla-staging.appspot.com
   NEXT_PUBLIC_FIREBASE_APP_ID=<STAGING_APP_ID>
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<STAGING_SENDER_ID>
   FIREBASE_CLIENT_EMAIL=<STAGING_SERVICE_ACCOUNT_EMAIL>
   FIREBASE_PRIVATE_KEY="<STAGING_SERVICE_ACCOUNT_PRIVATE_KEY>"
   RAZORPAY_KEY_ID=rzp_test_<STAGING_KEY_ID>
   RAZORPAY_KEY_SECRET=<STAGING_KEY_SECRET>
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_<STAGING_KEY_ID>
   RAZORPAY_WEBHOOK_SECRET=<STAGING_WEBHOOK_SECRET>
   ```

### Step 5: Configure Razorpay Test Mode Webhook
In Razorpay Dashboard (Test Mode):
1. Navigate to **Settings** -> **Webhooks**.
2. Add Webhook URL: `https://bazaarvilla-staging.netlify.app/api/webhooks/razorpay`
3. Secret: `<STAGING_WEBHOOK_SECRET>`
4. Active Events:
   - `payment.captured`
   - `order.paid`
   - `payment.failed`

---

## 10. Hosted Verification Test Results (STAGE-001 through STAGE-025)

Because remote cloud resource creation requires explicit owner approval (Section 7), the hosted tests are documented below with status **NOT EXECUTED (Awaiting Owner Remote Provisioning Approval)**:

| Test ID | Scenario | Expected Behavior | Actual Status | Evidence / Blockers |
|---|---|---|---|---|
| **STAGE-001** | Production Isolation | Uses `bazaarvilla-staging`, zero production resources | **NOT EXECUTED** | Staging Firebase project not yet provisioned. |
| **STAGE-002** | Registered Authentication | Customer signs in, profile created with `role: customer` | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-003** | Anonymous Guest Authentication | Anonymous guest signs in transparently | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-004** | Public Catalog | Visible products and categories browse smoothly | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-005** | Hidden Product Protection | Hidden products cannot be read by public queries | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-006** | Guest Customization Upload | Synthetic JPEG uploaded to `customizations/{guestUid}/` | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-007** | Cross-Customer Storage Isolation | Customer B cannot read Customer A customization | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-008** | COD Checkout | Cash on Delivery order created, stock decremented | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-009** | Razorpay Pending Order | Internal order created with stock reserved before checkout | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-010** | Gateway Association | Razorpay test order maps to internal order and receipt | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-011** | Successful Test Payment | Test payment captured via Razorpay Test Mode card | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-012** | Real Webhook Delivery | Test Mode webhook arrives and verifies signature | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-013** | Webhook Idempotency | Duplicate webhook causes single payment record | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-014** | Browser Disconnect | Payment finalizes via webhook even if browser closes | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-015** | Payment Failure | Failed payment transitions order to FAILED | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-016** | Authorized Order History | User sees own orders; guest uses guest access token | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-017** | Admin Authorization | User with `admin: true` accesses Admin Console | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-018** | Admin Fulfillment | Admin retrieves customer customization image | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-019** | Abandoned Checkout | Unpaid order expires; stock safely restored | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-020** | Netlify Function Discovery | `reservation-cleanup.mts` discovered by Netlify | **NOT EXECUTED** | Requires hosted Netlify deployment. |
| **STAGE-021** | Gateway Association Recovery | Gateway order recovered via receipt on association timeout | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-022** | Inventory Concurrency | Concurrent checkouts do not oversell inventory | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-023** | Price Manipulation Prevention | Tampered client price rejected authoritatively | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-024** | Guest Order Privacy | Order ID alone does not expose customer data | **NOT EXECUTED** | Requires hosted staging deployment. |
| **STAGE-025** | Full Customer Journey | End-to-end storefront to fulfillment lifecycle | **NOT EXECUTED** | Requires hosted staging deployment. |

---

## 11. Netlify Scheduled Function Verification (TASK H)
- **Function File:** `netlify/functions/reservation-cleanup.mts`
- **Schedule:** `*/5 * * * *` (every 5 minutes)
- **Local Emulator Verification:** Test `OPS-024` verified handler execution, batch processing, and export of `@netlify/functions` config with schedule `*/5 * * * *`.
- **Automatic Execution in Hosted Staging:** **NOT VERIFIED (Awaiting Published Netlify Staging Deployment)**. Netlify Scheduled Functions run on cron schedules only for published site deployments (not branch previews).

---

## 12. Upload Security & Retention Assessment (TASK I)
1. **Ownership & Isolation:** Cloud Storage rules restrict write access to `customizations/{ownerUid}/{fileName}`. Owner UID must match `request.auth.uid`. Cross-user access is denied (`UPLOAD-004`).
2. **Quota & Rate Limits:** Image size is capped at 10MB in Storage rules. Valid MIME types are strictly constrained to `image/jpeg`, `image/png`, and `image/webp`. Filenames are restricted to alphanumeric and hyphens.
3. **Retention Analysis:**
   - Active, fulfilled, and paid customization images must **NOT** be subjected to blanket lifecycle deletion (e.g. 7-day deletion), as doing so would destroy evidence required for customer support, re-orders, and returns.
   - Orphaned uploads (files uploaded by anonymous users who abandoned checkout without placing an order) should be identified by comparing storage file paths against confirmed order customization attachments.
   - **Recommendation:** Implement an automated orphan cleanup worker in a dedicated follow-up task.

---

## 13. Dependency Vulnerability Assessment (TASK J)
- **Audit Tool:** `npm audit --json`
- **Findings:** 41 vulnerabilities (2 low, 21 moderate, 16 high, 2 critical).
- **Classification:**
  - **Critical (2):** `websocket-driver` (<0.7.5) via `firebase-tools` (development emulator CLI tooling only). Not bundled into production runtime.
  - **High (16):** `@grpc/grpc-js`, `@fastify/busboy`, `zod` via `firebase-tools` / dev dependencies.
  - **Moderate (21):** `uuid` buffer bounds check in v3/v5/v6 when `buf` is passed (application uses `crypto.randomUUID()` in Node runtime; no buffer misuse).
  - **Low (2):** `@babel/core` sourceMappingURL comments in dev build tooling.
- **Verdict:** No direct exploitable critical vulnerability in the core production customer transaction path. `npm audit fix --force` was intentionally avoided to protect project stability.

---

## 14. Local Verification Summary (TASK L)

```bash
npm run typecheck         # 0 errors
npm test                  # 23/23 unit tests passed (138ms)
npm run test:rules        # 38/38 rules tests passed (10.7s)
npm run test:integration  # 190/190 integration tests passed (68.4s, 14 suites)
npm run build             # 25/25 routes compiled and optimized (4.5s)
```

### Test Count Reconciliation
- Unit tests: 23 passed (12 pricing + 11 staging guard).
- Rules tests: 38 passed (5 admin auth + 23 firestore rules + 10 storage rules).
- Integration test suites: 14 suites (190 tests passed).
  *(Note: The 38 rules tests are executed within the 190 integration tests under the emulator runner).*
- Total unique automated tests: 213 passing tests, 0 failures.

---

## 15. Production Release Gate Matrix (TASK K)

| Gate | Requirement | Status | Evidence / Blockers | Required Owner Action |
|---|---|---|---|---|
| **GATE-01** | Auditable, reproducible release commit | **READY LOCALLY** | Branch `release/staging-validation-task-010` created with all changes verified. | Approve commit and branch push. |
| **GATE-02** | Server pricing and coupon integrity | **PASSED** | Unit tests (12/12) and integration tests verify server authority. | None. |
| **GATE-03** | Inventory concurrency and reservation safety | **PASSED** | `inventory-concurrency.test.ts` and `reservation-cleanup.test.ts` verified. | None. |
| **GATE-04** | Razorpay webhook and gateway verification | **PASSED** | Raw-body HMAC verification and `payments.fetch` status verified. | None. |
| **GATE-05** | Gateway order association recovery | **PASSED** | All 20 SYNC recovery scenarios passed in emulator. | None. |
| **GATE-06** | Customer order privacy | **PASSED** | Dual-path tokens, SHA-256 hashes, and DTO projection verified. | None. |
| **GATE-07** | Firestore and Storage access restrictions | **PASSED LOCALLY** | Versioned rules tested (38/38 passed). | Deploy rules to production Firebase. |
| **GATE-08** | Admin Custom Claims authorization | **PASSED LOCALLY** | Custom claims engine and CLI tested (5/5 passed). | Bootstrap production administrator claims. |
| **GATE-09** | Guest customization upload security | **PASSED LOCALLY** | Scoped namespaces and anonymous auth verified (24/24 passed). | Deploy storage rules to production. |
| **GATE-10** | Verified hosted staging checkout | **BLOCKED** | Hosted staging environment pending owner approval. | Approve staging cloud provisioning. |
| **GATE-11** | Verified Netlify background cleanup | **BLOCKED** | Requires published Netlify staging deployment. | Deploy staging Netlify site. |
| **GATE-12** | Reviewed dependency security | **PASSED** | Triage completed; 0 critical runtime path vulnerabilities. | Schedule future dependency updates. |
| **GATE-13** | Reviewed production environment configuration | **BLOCKED** | Production environment variables unverified. | Audit production Netlify environment. |
| **GATE-14** | Production rules backup and rollback procedure | **BLOCKED** | Production rules not yet backed up. | Back up existing production rules. |
| **GATE-15** | Review-submission authorization | **PASSED LOCALLY** | Direct client writes blocked; server route verified (11/11 passed). | Deploy rules and API to production. |
| **GATE-16** | DNS and HTTPS verification | **BLOCKED** | Live domain check pending release. | Confirm DNS records for bazaarvilla.com. |
| **GATE-17** | Monitoring and payment reconciliation procedures | **BLOCKED** | Production alerting and manual reconciliation runbook pending. | Configure operational alerts. |

---

## 16. Deployment and External Action Log
- **Local Commits Created:** Prepared on local branch `release/staging-validation-task-010`.
- **Git Pushes Performed:** **NONE** (Zero remote pushes).
- **Firebase Projects Created:** **NONE** (Zero external cloud projects created).
- **Staging Rules Deployed:** **NONE** (Awaiting owner approval).
- **Netlify Staging Sites Deployed:** **NONE** (Awaiting owner approval).
- **Razorpay Test Mode Transactions Executed:** **NONE** (Awaiting owner approval).
- **Production Resources Modified:** **NONE** (Strictly untouched).

---

## 17. Outstanding Risks Register

| Risk ID | Severity | Category | Description | Status |
|---|---|---|---|---|
| **GATE-10** | **HIGH** | Staging / E2E | Real Razorpay Test Mode checkout unverified on hosted URL. | **BLOCKED BY OWNER APPROVAL** |
| **GATE-11** | **HIGH** | Ops / Cron | Automatic cron trigger of Netlify Scheduled Function unverified on published site. | **BLOCKED BY HOSTED DEPLOYMENT** |
| **RSK-06** | **CRITICAL** | Firestore | Production Firebase currently runs unverified rules. | **BLOCKED BY PRODUCTION GATE** |
| **RSK-04** | **HIGH** | Auth | Production administrators have not been bootstrapped with custom claims. | **BLOCKED BY PRODUCTION GATE** |
| **RSK-07** | **MEDIUM** | Dependencies | 41 vulnerabilities reported by `npm audit` (mostly CLI/dev dependencies). | **DOCUMENTED** |

---

## 18. Recommended Next Task

### **TASK 011 — Hosted Staging Cloud Provisioning, Live Razorpay Test Mode Execution & Netlify Scheduler Verification**
- **Objectives:**
  1. Obtain explicit project owner approval for remote operations.
  2. Provision dedicated staging Firebase project (`bazaarvilla-staging`) and isolated Netlify staging site (`bazaarvilla-staging.netlify.app`).
  3. Deploy `firestore.rules`, `storage.rules`, and `firestore.indexes.json` to staging project.
  4. Bootstrap staging administrator custom claim via `scripts/manage-admin-claims.mjs`.
  5. Configure staging environment variables with Razorpay Test Mode credentials.
  6. Execute real Razorpay Test Mode transactions across scenarios `STAGE-001` through `STAGE-025`.
  7. Verify real webhook delivery and automated Netlify Scheduled Function cron execution.
- **Prerequisites:** Project owner approval and cloud console access.

---

## 19. Context for the Next AI Agent

### Active State
- **Branch:** `release/staging-validation-task-010`
- **Base Commit:** `9cd151a3f07858a2063be9c4b02477d8231b9d36`
- **Key Modules Implemented:**
  - `src/app/api/reviews/submit/route.ts`: Authoritative review submission API.
  - `firestore.rules`: Review direct writes blocked; customer profile allowed fields enforced.
  - `src/lib/orders/gatewayRecovery.ts`: Exact receipt filtering and pagination handling.
  - `src/lib/orders/reservationCleanup.ts`: 15-minute observation grace window for uncertain orders.
  - `src/lib/security/stagingGuard.ts`: 8 mandatory fail-closed staging isolation rules.
- **Verification Commands:**
  ```bash
  npm run typecheck         # 0 errors
  npm test                  # 23 unit tests pass
  npm run test:rules        # 38 rules tests pass
  npm run test:integration  # 190 integration tests pass
  npm run build             # 25 routes compile successfully
  ```
- **Safety Policy:** Never push to remote or touch production Firebase/Razorpay without explicit owner authorization. Commercial launch remains strictly **NO-GO**.
