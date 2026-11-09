# TrendKartz — Central Task Reports Index

**Project Name:** TrendKartz (Storefront: `TrendKartz` | Domain: `bazaarvilla.com`)  
**Repository Remote:** `https://github.com/Coder-MayankSaini/trendzcart.git`  
**Current Active Git Branch:** `release/staging-validation-task-010`  
**Primary Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5, Firebase Auth/Firestore/Storage/Admin SDK, Razorpay 2.9.6, Netlify Hosting  
**Current Commercial Transacting Safety Status:** **NO-GO FOR COMMERCIAL TRANSACTIONS** (Awaiting production deployment of rules, admin custom claims bootstrapping, hosted staging payment verification, and Netlify scheduled function deployment)

---

## 1. Project Overview & Relaunch Objective

TrendKartz is a full-stack e-commerce application selling ready-to-wear apparel and customized merchandise (e.g., photo printing and personalized text engraving). Originally built and deployed on Netlify with Firebase backend services, the application remained inactive for several months before being reconnected to a primary custom domain (`bazaarvilla.com`).

An exhaustive architecture audit ([`../REPOSITORY_AUDIT.md`](../REPOSITORY_AUDIT.md)) identified severe security and reliability vulnerabilities (client-controlled pricing, unauthenticated order overwrite, customer PII exposure, unverified Firestore security rules, and abandoned checkout inventory locks). 

The relaunch objective is to systematically harden backend trust boundaries, establish rigorous automated testing, upgrade vulnerable dependencies, and ensure 100% financial and data safety before accepting live customer payments.

---

## 2. Documentation References

- **Comprehensive Repository Audit:** [`docs/REPOSITORY_AUDIT.md`](../REPOSITORY_AUDIT.md)
- **Local Engineering Safety Rules:** [`Agent.md`](../../Agent.md)
- **Task Reports Directory:** [`docs/task-reports/`](./)

---

## 3. Master Task History

| Task ID | Task Title | Status | Git Branch | Report | Summary |
|---|---|---|---|---|---|
| **TASK-001** | Development Environment, Safety Baseline & Testing Strategy | **COMPLETED** | `chore/relaunch-safety-baseline` | [TASK-001-development-baseline.md](./TASK-001-development-baseline.md) | Verified Git baseline and Node/npm state; evaluated Firebase emulator & staging hybrid architecture; audited 34 package vulnerabilities; specified 10 critical security regression tests; designed first remediation blueprint. |
| **TASK-002** | Server-Side Price & Order Integrity Remediation | **COMPLETED** | `fix/sec-order-pricing-integrity` | [TASK-002-order-pricing-integrity.md](./TASK-002-order-pricing-integrity.md) | Fixed `firebase-admin` dependency placement; created modular server pricing engine; hardened `/api/orders/create` with catalog price lookup, coupon evaluation, server order ID generation, signature validation, and inventory decrements; added 12 unit tests (12/12 passed); verified typecheck and production build. |
| **TASK-003** | Firebase Emulator Suite, Integration Testing & Order Security Verification | **COMPLETED** | `test/firebase-emulator-integration` | [TASK-003-firebase-emulator-integration.md](./TASK-003-firebase-emulator-integration.md) | Configured production-isolated Firebase Emulator Suite (`demo-trendkartz`) with fail-closed safety guards; established automated multi-JDK resolution (Java 25); authored synthetic fixtures and 21 integration tests; diagnosed and resolved 5 critical defects; verified 100% pass across all 33 unit and integration tests; validated Next.js production build. |
| **TASK-004** | Secure Razorpay Payment Lifecycle, Server Webhooks & Idempotency | **COMPLETED** | `fix/razorpay-webhooks-idempotency` | [TASK-004-razorpay-webhooks-idempotency.md](./TASK-004-razorpay-webhooks-idempotency.md) | Re-architected checkout to persist durable pending orders with transactional stock reservation prior to payment gateway entry; built `/api/webhooks/razorpay` with raw-body HMAC-SHA256 signature verification using `RAZORPAY_WEBHOOK_SECRET`; implemented dual-layer idempotency; added reservation expiration release and late payment recovery (PAY-017); preserved COD; authored 20 integration tests (PAY-001 to PAY-020); verified 100% pass across 41 integration and 12 unit tests; validated production build. |
| **TASK-005** | Secure Guest Order Access, Customer Data Privacy & Rate Limiting | **COMPLETED** | `fix/guest-order-privacy` | [TASK-005-guest-order-privacy.md](./TASK-005-guest-order-privacy.md) | Remediated RSK-03; implemented dual-path order authorization (verified Firebase ID token for registered users, 256-bit cryptographic guest access tokens stored as non-recoverable SHA-256 hashes for guests); protected idempotent retries against token theft; enforced customer data minimization and strict DTO projection; built distributed Firestore rate limiter (30 req/min with 429 Retry-After); safeguarded legacy guest orders; authored 20 integration tests (PRIV-001 to PRIV-020); verified 100% pass across all 61 integration and 12 unit tests; validated production build (23 routes). |
| **TASK-006** | Firebase Security Rules, Storage Permissions & Secure Admin Authorization | **COMPLETED LOCALLY** | `fix/firestore-rules-custom-claims` | [TASK-006-firebase-rules-admin-authorization.md](./TASK-006-firebase-rules-admin-authorization.md) | Versioned `firestore.rules` and `storage.rules` (rules_version = '2'); denied direct client SDK operations on financial collections; migrated admin authorization to Firebase Auth Custom Claims (`admin: true`); refactored `ProductReviews.tsx` with dedicated server review eligibility route (`/api/reviews/eligibility`); built CLI provisioning tool with dry-run support; authored 35 rules tests; verified 100% pass across 109 tests; validated production build (24 routes). |
| **TASK-007** | Automated Inventory Reservation Cleanup, Razorpay Gateway Verification & Payment Reconciliation | **COMPLETED LOCALLY** | `fix/reservation-cleanup-payment-verification` | [TASK-007-reservation-cleanup-gateway-verification.md](./TASK-007-reservation-cleanup-gateway-verification.md) | Implemented native Netlify Scheduled Function (`netlify/functions/reservation-cleanup.mts`, `*/5 * * * *`) and core engine (`src/lib/orders/reservationCleanup.ts`) with bounded indexed queries; added server-to-server gateway reconciliation before stock release; hardened `/api/razorpay/verify-payment` with mandatory `razorpay.payments.fetch` status validation (currency, amount, captured check); added composite Firestore index; authored 25 operations tests (OPS-001 to OPS-025); verified 100% pass across 134 automated tests (12 unit + 122 integration); validated production build (24 routes). |
| **TASK-008** | Secure Guest Customization Uploads, Checkout Compatibility & Staging Readiness | **COMPLETED LOCALLY** | `fix/guest-customization-staging-readiness` | [TASK-008-guest-uploads-staging-readiness.md](./TASK-008-guest-uploads-staging-readiness.md) | Remediated guest customization upload blockage via transparent anonymous auth and scoped Cloud Storage rules (`customizations/{ownerUid}/{fileName}`); enforced client-side compression and format validation (JPEG, PNG, WebP <= 10MB); hardened `/api/orders/create` and `/api/razorpay/create-order` with server-side customization ownership, storage existence, and MIME type validation; authored 24 upload security tests (UPLOAD-001 to UPLOAD-024); formulated staging architecture and production release runbook; verified 100% pass across 158 tests (12 unit + 146 integration); validated production build (24 routes). |
| **TASK-009** | Razorpay Association Recovery, Isolated Hosted Staging Verification & Production Release Gates | **COMPLETED LOCALLY** | `fix/staging-verification-gateway-recovery` | [TASK-009-gateway-recovery-staging-verification.md](./TASK-009-gateway-recovery-staging-verification.md) | Remediated Razorpay order association edge cases (`GATEWAY-SYNC`); implemented explicit gateway lifecycle state machine, stable receipt querying (`orders.all({ receipt })`), attempt logging, and transactional order reuse; built fail-closed hosted staging isolation guards; hardened reservation cleanup and payment reconciliation; audited guest upload quotas and review submission boundaries; authored 16 gateway sync integration tests (SYNC-001 to SYNC-016); verified 100% pass across all 174 automated tests (12 unit + 162 integration); validated production build (24 routes). |
| **TASK-010** | Isolated Hosted Staging Environment, Razorpay Test Mode E2E Verification & Release Security Gates | **COMPLETED LOCALLY — STAGING PENDING** | `release/staging-validation-task-010` (`7bf9748`) | [TASK-010-hosted-staging-verification.md](./TASK-010-hosted-staging-verification.md) | Remediated review authorization bypass (`REVIEW-BYPASS`) via `POST /api/reviews/submit` and rules restriction; hardened profile field permissions with strict allowlist; revalidated gateway receipt recovery with exact match filtering and 15-minute observation window for uncertain orders; strengthened `stagingGuard.ts` with 8 fail-closed rules; audited 41 dependency vulnerabilities; formulated owner-executable staging provisioning runbook; authored 11 review and 4 gateway sync integration tests; verified 100% pass across all 213 automated tests (23 unit + 190 integration); validated production build (25 routes). |

---

## 4. Current Project State

- **Verified Facts:**
  - Git working tree is safely isolated on local release branch `release/staging-validation-task-010`.
  - Host runtime is Node.js `v24.15.0` with `npm` `11.12.1`.
  - Automated multi-JDK resolution detects and binds JetBrains JBR OpenJDK 25 for Firebase Emulator CLI.
  - Authoritative lockfile is `package-lock.json`.
  - Fail-closed emulator guard prevents any accidental connection to production Firebase or live Razorpay keys.
  - Fail-closed hosted staging isolation validator (`src/lib/security/stagingGuard.ts`) enforces 8 mandatory isolation rules.
  - Authoritative Firestore Security Rules (`firestore.rules`) and Storage Security Rules (`storage.rules`) loaded and enforced.
  - Native Netlify Scheduled Function (`netlify/functions/reservation-cleanup.mts`) configured with schedule `*/5 * * * *`.
  - Automated test suite established:
    - `npm test`: 23/23 unit tests passing in ~140ms.
    - `npm run test:rules`: 38/38 rules and authorization tests passing in ~10.7s.
    - `npm run test:integration`: 180/180 integration tests across 14 suites passing in ~82.9s.
    - `npm run typecheck`: 0 TypeScript errors across all `.ts` and `.mts` files.
    - `npm run build`: 25/25 routes compiling and optimizing in ~4.5s.
- **Implemented Work:**
  - Authoritative review submission endpoint (`src/app/api/reviews/submit/route.ts`).
  - Storefront review submission via authorized API (`src/components/storefront/ProductReviews.tsx`).
  - Profile field allowlist enforcement in `firestore.rules` (`isCustomerProfileAllowedFields`).
  - Direct client review write denial in `firestore.rules`.
  - Exact receipt filtering and pagination handling in `src/lib/orders/gatewayRecovery.ts`.
  - Observation grace window for uncertain orders in `src/lib/orders/reservationCleanup.ts`.
  - 8-rule fail-closed isolation guard in `src/lib/security/stagingGuard.ts`.
  - Production-isolated Firebase Emulator Suite (`firebase.json`).
  - Scoped customization namespace (`customizations/{ownerUid}/{fileName}`).
  - Transparent anonymous guest authentication helper (`src/lib/auth/guestAuth.ts`).
  - Storefront product customizer with client compression (`src/components/storefront/ProductCustomizer.tsx`).
  - Server-side customization attachment verification engine (`src/lib/orders/customizationAuth.ts`).
  - Native Netlify Scheduled Function (`netlify/functions/reservation-cleanup.mts`).
  - Core reservation cleanup engine with gateway reconciliation (`src/lib/orders/reservationCleanup.ts`).
  - Hardened synchronous payment verification endpoint (`src/app/api/razorpay/verify-payment/route.ts`).
  - Unified idempotent payment lifecycle state machine (`src/lib/orders/paymentLifecycle.ts`).
  - Razorpay gateway order association recovery engine (`src/lib/orders/gatewayRecovery.ts`).
  - Admin Custom Claims verification engine and CLI (`src/lib/auth/adminAuth.ts`, `scripts/manage-admin-claims.mjs`).
  - Dual-path customer order retrieval authorization with guest access tokens (`src/app/api/orders/by-ids/route.ts`, `src/lib/orders/orderAuth.ts`).
  - Distributed Firestore rate limiter (`src/lib/security/rateLimiter.ts`).
- **Tested Work:**
  - 12 unit pricing tests (`tests/unit/pricing.test.ts`).
  - 11 unit staging guard tests (`tests/unit/staging-guard.test.ts`).
  - 8 emulator safety tests (`tests/integration/emulator-safety.test.ts`).
  - 8 order creation integration tests (`tests/integration/orders-create.test.ts`).
  - 3 Razorpay order integration tests (`tests/integration/razorpay-create-order.test.ts`).
  - 2 concurrency & race condition integration tests (`tests/integration/inventory-concurrency.test.ts`).
  - 20 payment lifecycle & webhook integration tests (`tests/integration/payment-lifecycle.test.ts`).
  - 21 guest order privacy & rate limiting integration tests (`tests/integration/guest-order-privacy.test.ts`).
  - 5 admin custom claims integration tests (`tests/integration/admin-authorization.test.ts`).
  - 23 Firestore security rules integration tests (`tests/integration/firestore-rules.test.ts`).
  - 10 Cloud Storage security rules integration tests (`tests/integration/storage-rules.test.ts`).
  - 17 reservation cleanup operations integration tests (`tests/integration/reservation-cleanup.test.ts`).
  - 8 gateway verification operations integration tests (`tests/integration/gateway-verification.test.ts`).
  - 24 customization upload & authorization integration tests (`tests/integration/customization-upload.test.ts`).
  - 20 gateway association recovery integration tests (`tests/integration/gateway-association-recovery.test.ts`).
  - 11 review submission integration tests (`tests/integration/reviews-submission.test.ts`).
  - **Total Automated Tests: 213 unique passing tests (23 unit + 190 integration), 0 failures.**
- **Deployed Work:**
  - Deployment remains untouched on Netlify pointing to `bazaarvilla.com`.
  - Zero modifications to production console, credentials, or remote Git repository.
- **Commercial Transacting Safety Assessment:**
  - **VERDICT: NO-GO.** Core payment lifecycle, server-to-server webhooks, idempotency, guest order privacy, rate limiting, local security rules, automated reservation cleanup, synchronous gateway verification, secure guest customization uploads, Razorpay gateway order recovery, review authorization, and profile hardening are now fully implemented and verified locally. However, live transactions must remain disabled until production security rules deployment, production admin custom claims assignment, hosted staging verification, and Netlify scheduled function deployment are complete.

---

## 5. Outstanding Critical Risks Summary

| Risk ID | Severity | Category | Description | Status | Reference |
|---|---|---|---|---|---|
| **RSK-01** | **CRITICAL** | Financial / Security | Client-controlled pricing in `/api/orders/create` allows ₹1 orders or free purchases. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-003 Report](./TASK-003-firebase-emulator-integration.md#8-verification-results) |
| **RSK-02** | **CRITICAL** | Integrity / Security | Unauthenticated order creation permits arbitrary overwriting of existing orders in Firestore. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-003 Report](./TASK-003-firebase-emulator-integration.md#8-verification-results) |
| **SEC-TEST-007** | **HIGH** | Concurrency / Stock | Non-transactional batch decrement allowed inventory to drop below zero under concurrent checkouts. | **VERIFIED RESOLVED (runTransaction)** | [TASK-003 Report](./TASK-003-firebase-emulator-integration.md#93-batch-decrement-race-condition--negative-inventory-sec-test-007) |
| **RSK-05** | **HIGH** | Payment / Reliability | Missing Razorpay server webhooks causes captured payments to be lost if browser closes. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-004 Report](./TASK-004-razorpay-webhooks-idempotency.md#11-automated-test-results) |
| **RSK-03** | **HIGH** | Privacy / Security | Unauthenticated guest order lookup in `/api/orders/by-ids` exposes customer PII. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-005 Report](./TASK-005-guest-order-privacy.md#10-security-test-results-priv-001-through-priv-020) |
| **RSK-06** | **CRITICAL** | Firestore / Security | Direct client SDK access on `orders` collection could bypass API restrictions if Firestore rules allow open reads. | **VERIFIED RESOLVED LOCALLY** (Requires Production Deployment) | [TASK-006 Report](./TASK-006-firebase-rules-admin-authorization.md#6-new-firestore-security-architecture) |
| **RSK-04** | **HIGH** | Auth / Security | Admin authorization relies on client-side check of Firestore `users/{uid}`. | **VERIFIED RESOLVED LOCALLY** (Custom Claims Tested) | [TASK-006 Report](./TASK-006-firebase-rules-admin-authorization.md#8-administrative-authorization-migration) |
| **PAY-SCHED**| **HIGH** | Stock / Reliability | No automated background worker or cron invokes `releaseExpiredReservation()` for abandoned checkouts. | **VERIFIED RESOLVED LOCALLY** (Netlify Scheduled Function Tested) | [TASK-007 Report](./TASK-007-reservation-cleanup-gateway-verification.md#5-new-scheduled-cleanup-architecture) |
| **PAY-GATEWAY**| **CRITICAL**| Payment / Verification | Synchronous callback verified HMAC signature without querying gateway server-to-server for captured status. | **VERIFIED RESOLVED LOCALLY** (payments.fetch Verified) | [TASK-007 Report](./TASK-007-reservation-cleanup-gateway-verification.md#7-synchronous-gateway-verification) |
| **GUEST-UPLOAD**| **HIGH** | Storefront / Upload | Guest customers cannot upload customizer photos because `storage.rules` requires authentication. | **VERIFIED RESOLVED LOCALLY** (Anonymous Auth + Scoped Rules Tested) | [TASK-008 Report](./TASK-008-guest-uploads-staging-readiness.md#5-chosen-secure-upload-architecture) |
| **GATEWAY-SYNC**| **MEDIUM** | Payment / State | If Firestore update fails after gateway order creation, internal order lacks `razorpayOrderId`. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-009 Report Section 8](./TASK-009-gateway-recovery-staging-verification.md#8-task-c--recovery-implementation-details) |
| **REVIEW-BYPASS**| **MEDIUM** | Security / Integrity | Direct client Firestore write to `reviews` collection allows creating unverified reviews bypassing `/api/reviews/eligibility` check if `isFake == false`. | **VERIFIED RESOLVED (Emulator Tested)** | [TASK-010 Report Section 5](./TASK-010-hosted-staging-verification.md#5-review-authorization-remediation-task-a) |
| **RSK-07** | **HIGH** | Security / Dependencies | 41 vulnerabilities in npm lockfile (2 critical in `protobufjs`/`websocket-driver`). | **TRIAGED (Dev Tooling)** | [TASK-010 Section 13](./TASK-010-hosted-staging-verification.md#13-dependency-vulnerability-assessment-task-j) |

---

## 6. Recommended Next Task

### **TASK 011 — Hosted Staging Cloud Provisioning, Live Razorpay Test Mode Execution & Netlify Scheduler Verification**
- **Objective:**
  1. Obtain explicit project owner approval for external cloud provisioning.
  2. Provision dedicated staging Firebase project (`bazaarvilla-staging`) and isolated Netlify staging site (`bazaarvilla-staging.netlify.app`).
  3. Deploy Firestore rules, Cloud Storage rules, and composite indexes to staging project.
  4. Bootstrap staging administrator custom claims (`scripts/manage-admin-claims.mjs`).
  5. Configure staging environment variables using Razorpay **Test Mode** credentials and verify staging isolation guards.
  6. Execute the 25 hosted staging test scenarios (`STAGE-001` through `STAGE-025`) using synthetic accounts and Razorpay test payment methods.
  7. Verify real webhook delivery and automated Netlify background scheduled function execution on the hosted staging URL.
- **Prerequisites:** TASK-010 completion, verified local release branch `release/staging-validation-task-010`, and explicit project owner authorization for staging cloud resource creation.
