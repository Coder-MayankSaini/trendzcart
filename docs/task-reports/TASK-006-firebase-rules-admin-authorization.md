# TASK-006 — Firebase Security Rules, Storage Permissions & Secure Admin Authorization

## 1. Task Metadata
- **Task ID:** TASK-006
- **Task Title:** Firebase Security Rules, Storage Permissions & Secure Admin Authorization
- **Execution Date:** November 9, 2026
- **Git Branch:** `fix/firestore-rules-custom-claims`
- **Base Commit:** `9cd151a3f07858a2063be9c4b02477d8231b9d36` (inherited uncommitted changes from TASK-001 through TASK-005)
- **Local Implementation Status:** **COMPLETED LOCALLY**
- **Production Rules Status:** **NOT VERIFIED / NOT DEPLOYED** (Requires owner export and manual production deployment)
- **Production Commercial Transacting Status:** **NO-GO FOR COMMERCIAL TRANSACTIONS** (Awaiting production deployment of rules, custom claims bootstrapping, and automated reservation scheduler)

---

## 2. Executive Summary
TASK-006 hardens the fundamental backend security perimeters of the **TrendKartz / Bazaarvilla** application by eliminating client-controlled trust boundaries in Cloud Firestore and Cloud Storage.

Prior to this task, the repository lacked version-controlled `firestore.rules` and `storage.rules`, leaving the application vulnerable to complete client SDK bypasses if production rules were permissive. Administrative access was determined exclusively by reading `users/{uid}.role === "admin"` from Firestore documents, enabling any authenticated user to elevate themselves to administrator if user profile writes were open. Furthermore, legacy guest order retrieval in `/api/orders/by-ids` leaked financial totals and provided an oracle for order existence enumeration.

### Key Remediation Achievements
1. **Firestore Security Architecture (`firestore.rules`):**
   - Implemented `rules_version = '2'` with least-privilege default-deny semantics.
   - Enforced client-read and client-write deny policies on financially authoritative `orders`, `paymentRecords`, `paymentWebhookEvents`, `rateLimits`, and `unmatchedPayments` collections.
   - Guarded public catalog reads to require `isVisible == true`, while granting administrative access only to verified `request.auth.token.admin == true` holders.
   - Restricted coupon listing and modification to administrators while allowing single coupon lookups for customer checkout preview.
   - Replaced browser-side order querying in `ProductReviews.tsx` with a dedicated authenticated server route (`/api/reviews/eligibility`).
2. **Cloud Storage Security Architecture (`storage.rules`):**
   - Protected public catalog assets (`products/`, `categories/`) with admin-only write permissions, 10MB/5MB size limits, and image MIME-type validation.
   - Restricted customer customization uploads (`customizations/`) to authenticated users, enforced overwrite prevention (`resource == null`), and denied public/customer read access (admin inspection only).
   - Enforced UID-prefixed review photo uploads (`reviews/{productId}/{uid}_*`), rejecting unauthenticated uploads, spoofed UID prefixes, and oversized assets.
3. **Administrative Custom Claims Migration:**
   - Replaced reliance on client Firestore `role: "admin"` with cryptographically signed Firebase Authentication Custom Claims (`admin: true`).
   - Hardened `AuthContext.tsx`, `AdminGuard.tsx`, and `Navbar.tsx` to evaluate custom claims via `getIdTokenResult()`, preventing privilege escalation from forged Firestore documents.
   - Implemented server-side token claim validation utility `src/lib/auth/adminAuth.ts`.
   - Authored safe administrative provisioning and revocation tool `scripts/manage-admin-claims.mjs` with `--dry-run`, claim preservation, and Firestore profile synchronization.
4. **Historical Guest Order Enumeration Remediation (TASK J):**
   - Corrected `/api/orders/by-ids/route.ts` to require verifiable continuity (matching customer email, phone, or token) before returning restricted legacy order recovery notices.
   - Eliminated financial total leakage (`total`, `subtotal`) in unverified responses, returning identical empty lists (`{ orders: [] }`) for nonexistent versus unverified legacy IDs.
5. **Comprehensive Automated Rules Test Suite:**
   - Installed `@firebase/rules-unit-testing@5.0.2` and authored 35 new integration tests:
     - 20 Firestore rules tests (RULE-001 through RULE-020).
     - 10 Storage rules tests (STORAGE-001 through STORAGE-010).
     - 5 Admin custom claims and provisioning tests.
   - **Total test suite: 109 automated tests passing (12 unit + 97 integration), 0 failures.**

---

## 3. Previous Task Context
- **TASK-001:** Identified lack of version-controlled security rules and client-side admin privilege escalation risk (RSK-04, RSK-06).
- **TASK-002:** Re-architected `/api/orders/create` with server-calculated catalog pricing, coupon validation, and inventory decrements.
- **TASK-003:** Configured isolated Firebase Emulator Suite (`demo-trendkartz`) with fail-closed safety guards and multi-JDK support.
- **TASK-004:** Built durable pending order persistence, Razorpay HMAC-SHA256 server webhooks, dual-layer idempotency, and inventory reservation expiration engine.
- **TASK-005:** Secured customer order retrieval via dual-path authentication (Firebase ID tokens for registered users, SHA-256 guest access tokens for guests), atomic distributed rate limiting, and customer PII minimization.

TASK-006 resolves the remaining client SDK vulnerabilities by placing ironclad rules at the database and storage layers.

---

## 4. Firebase Access Inventory

The following access-control matrix inventories every collection and Cloud Storage path across the entire codebase:

| Resource | Operation | Caller | Current Authorization | Required Authorization | Files |
|---|---|---|---|---|---|
| `users/{uid}` | Read | Client SDK | Owner or Admin | Owner (`request.auth.uid == uid`) or Admin claim (`request.auth.token.admin == true`) | `src/context/AuthContext.tsx` |
| `users/{uid}` | Create | Client SDK | Owner (`uid == request.auth.uid`) | Owner only, validated fields (`role == 'customer'`), never self-grant admin | `src/context/AuthContext.tsx` |
| `users/{uid}` | Update | Client SDK | Owner | Owner (cannot alter `uid` or elevate `role`), or Admin claim | `src/context/AuthContext.tsx` |
| `users/{uid}` | Delete | Client SDK | None | Admin claim only | — |
| `products/{id}` | Read (Single) | Client SDK | Public | `resource.data.isVisible == true` or Admin claim | `src/app/(admin)/admin/products/page.tsx`, `src/components/admin/AdminProducts.tsx` |
| `products` | List / Query | Client SDK | Public / Admin | Filtered by `isVisible == true` for public; Admin claim for unfiltered | `src/components/admin/AdminProducts.tsx` |
| `products/{id}` | Create/Update/Delete | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`) | `src/components/admin/AdminProducts.tsx` |
| `products` | Read/Write (Server) | Admin SDK | Serverless | Server-only (bypasses rules) | `src/app/(storefront)/page.tsx`, `products/page.tsx`, `create/route.ts` |
| `categories` | Read / List | Client SDK | Public | Public read (`allow read: if true;`) | `src/app/(storefront)/categories/page.tsx`, `AdminProducts.tsx` |
| `categories/{id}` | Create/Update/Delete | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`) | `src/app/(admin)/admin/categories/page.tsx`, `AdminProducts.tsx` |
| `coupons/{code}` | Get (Single) | Client SDK | Customer | Public single document get (know exact code) | `src/app/(storefront)/cart/page.tsx` |
| `coupons` | List / Enumerate | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`), deny public list | `src/app/(admin)/admin/coupons/page.tsx` |
| `coupons/{code}` | Create/Update/Delete | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`) | `src/app/(admin)/admin/coupons/page.tsx` |
| `reviews` | Read / Query | Client SDK | Public | Public read (`allow read: if true;`) | `src/components/storefront/ProductReviews.tsx` |
| `reviews/{id}` | Create | Client SDK | Customer / Admin | Authenticated owner (`userId == request.auth.uid` && `isFake == false`) or Admin claim | `src/components/storefront/ProductReviews.tsx`, `AdminProducts.tsx` |
| `reviews/{id}` | Update / Delete | Client SDK | Owner / Admin | Authenticated owner or Admin claim; cannot alter `isFake` or `userId` | `src/components/storefront/ProductReviews.tsx` |
| `orders/{id}` | Read (Single / List) | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`); client reads DENIED to non-admins | `src/app/(admin)/admin/dashboard/page.tsx`, `src/app/(admin)/admin/orders/page.tsx` |
| `orders/{id}` | Create / Delete | Client SDK | None | Deny all client SDK writes (`allow create, delete: if false;`) | Server-only (`/api/orders/create`) |
| `orders/{id}` | Update Status | Client SDK | Admin | Admin claim only (`request.auth.token.admin == true`) | `src/app/(admin)/admin/orders/page.tsx` |
| `paymentRecords/{id}` | Read / Write | Server only | Serverless | Deny all client SDK access (`allow read, write: if false;`) | `src/lib/orders/paymentLifecycle.ts` |
| `paymentWebhookEvents/{id}` | Read / Write | Server only | Serverless | Deny all client SDK access (`allow read, write: if false;`) | `src/app/api/webhooks/razorpay/route.ts` |
| `unmatchedPayments/{id}` | Read / Write | Server only | Serverless | Deny all client SDK access (`allow read, write: if false;`) | `src/lib/orders/paymentLifecycle.ts` |
| `rateLimits/{key}` | Read / Write | Server only | Serverless | Deny all client SDK access (`allow read, write: if false;`) | `src/lib/security/rateLimiter.ts` |
| `products/{id}/*` | Read | Storage SDK | Public | Public read (`allow read: if true;`) | `src/components/admin/AdminProducts.tsx` |
| `products/{id}/*` | Upload / Delete | Storage SDK | Admin | Admin claim only, size <= 10MB, image MIME type | `src/components/admin/AdminProducts.tsx` |
| `categories/{id}/*` | Read | Storage SDK | Public | Public read (`allow read: if true;`) | `src/app/(admin)/admin/categories/page.tsx` |
| `categories/{id}/*` | Upload / Delete | Storage SDK | Admin | Admin claim only, size <= 5MB, image MIME type | `src/app/(admin)/admin/categories/page.tsx` |
| `reviews/{prodId}/*` | Read | Storage SDK | Public | Public read (`allow read: if true;`) | `src/components/storefront/ProductReviews.tsx` |
| `reviews/{prodId}/*` | Upload | Storage SDK | Owner / Admin | Authenticated matching UID prefix (`{uid}_*`) or Admin, size <= 5MB, image MIME | `src/components/storefront/ProductReviews.tsx`, `AdminProducts.tsx` |
| `customizations/*` | Read | Storage SDK | Admin | Admin claim only (`request.auth.token.admin == true`); deny public/customer reads | `src/components/storefront/ProductCustomizer.tsx` |
| `customizations/*` | Upload | Storage SDK | Customer | Authenticated, size <= 10MB, image MIME, no overwrite (`resource == null`) | `src/components/storefront/ProductCustomizer.tsx` |

---

## 5. Existing Rules Assessment
- **Version Control Status:** Prior to TASK-006, `firestore.rules` and `storage.rules` were absent from git. `firebase.json` did not reference rules files.
- **Emulator Default Behavior:** The Firebase Emulator Suite previously logged:
  `! firestore: Did not find a Cloud Firestore rules file specified in a firebase.json config file. The emulator will default to allowing all reads and writes.`
- **Production Rules Verification:**
  > [!IMPORTANT]
  > **PRODUCTION RULES: NOT VERIFIED**  
  > Live production rules reside in Google Firebase Console and have not been exported into the repository. They must not be assumed secure.
- **Export Procedure for Project Owner:**
  To export the live production rules from Firebase Console:
  1. Navigate to [Firebase Console](https://console.firebase.google.com/) -> Select project `trendzcart-XXXX` (or active production project).
  2. In Build menu, select **Firestore Database** -> Click the **Rules** tab -> Copy contents to a local backup file (`firestore.rules.prod.bak`).
  3. In Build menu, select **Storage** -> Click the **Rules** tab -> Copy contents to a local backup file (`storage.rules.prod.bak`).
  4. Alternatively, using Firebase CLI:
     ```bash
     firebase login
     firebase firestore:rules:get --project <PRODUCTION_PROJECT_ID> > firestore.rules.prod.bak
     firebase storage:rules:get --project <PRODUCTION_PROJECT_ID> > storage.rules.prod.bak
     ```

---

## 6. New Firestore Security Architecture

The authoritative `firestore.rules` file enforces least privilege and fail-closed policies:

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function isAdmin() {
      return isAuthenticated() && ('admin' in request.auth.token) && request.auth.token.admin == true;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    // 1. Users
    match /users/{uid} {
      allow read: if isOwner(uid) || isAdmin();
      allow create: if isOwner(uid)
        && request.resource.data.uid == uid
        && request.resource.data.role == 'customer';
      allow update: if (isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.role == resource.data.role
        && (!('role' in request.resource.data) || request.resource.data.role != 'admin'))
        || isAdmin();
      allow delete: if isAdmin();
    }

    // 2. Products
    match /products/{productId} {
      allow get: if resource.data.isVisible == true || isAdmin();
      allow list: if resource.data.isVisible == true || isAdmin();
      allow create, update, delete: if isAdmin();
    }

    // 3. Categories
    match /categories/{categoryId} {
      allow read: if true;
      allow create, update, delete: if isAdmin();
    }

    // 4. Coupons
    match /coupons/{couponCode} {
      allow get: if true;
      allow list: if isAdmin();
      allow create, update, delete: if isAdmin();
    }

    // 5. Reviews
    match /reviews/{reviewId} {
      allow read: if true;
      allow create: if (isAuthenticated()
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.isFake == false)
        || isAdmin();
      allow update: if (isAuthenticated()
        && resource.data.userId == request.auth.uid
        && request.resource.data.userId == resource.data.userId
        && request.resource.data.isFake == resource.data.isFake)
        || isAdmin();
      allow delete: if (isAuthenticated() && resource.data.userId == request.auth.uid) || isAdmin();
    }

    // 6. Orders
    match /orders/{orderId} {
      allow read, update: if isAdmin();
      allow create, delete: if false;
    }

    // 7. Internal Collections
    match /paymentRecords/{id} { allow read, write: if false; }
    match /paymentWebhookEvents/{id} { allow read, write: if false; }
    match /unmatchedPayments/{id} { allow read, write: if false; }
    match /rateLimits/{id} { allow read, write: if false; }

    // 8. Fallback Deny
    match /{document=**} { allow read, write: if false; }
  }
}
```

---

## 7. Cloud Storage Security Architecture

The authoritative `storage.rules` file establishes granular file upload and access boundaries:

```rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isAuthenticated() {
      return request.auth != null;
    }

    function isAdmin() {
      return isAuthenticated() && ('admin' in request.auth.token) && request.auth.token.admin == true;
    }

    function isValidImage(maxBytes) {
      return request.resource.size <= maxBytes
        && request.resource.contentType.matches('image/.*');
    }

    // 1. Products managed assets
    match /products/{productId}/{fileName} {
      allow read: if true;
      allow write: if isAdmin() && isValidImage(10 * 1024 * 1024);
    }

    // 2. Categories managed assets
    match /categories/{categoryId}/{fileName} {
      allow read: if true;
      allow write: if isAdmin() && isValidImage(5 * 1024 * 1024);
    }

    // 3. Customer review images
    match /reviews/{productId}/{fileName} {
      allow read: if true;
      allow create: if (isAdmin() || (isAuthenticated() && fileName.matches('^' + request.auth.uid + '_.*')))
        && isValidImage(5 * 1024 * 1024);
      allow update, delete: if isAdmin()
        || (isAuthenticated() && fileName.matches('^' + request.auth.uid + '_.*'));
    }

    // 4. Customer customization uploads
    match /customizations/{fileName} {
      allow read: if isAdmin();
      allow create: if resource == null && isAuthenticated() && isValidImage(10 * 1024 * 1024);
      allow update, delete: if isAdmin();
    }

    // 5. Fallback Deny
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

### Analysis of Existing Download URLs
- Firebase Storage `getDownloadURL()` generates tokenized URLs containing a persistent `?token=<uuid>`.
- **Finding:** While Cloud Storage SDK operations (`getBytes`, `list`) strictly obey `storage.rules`, pre-existing download URLs bypass security rules unless revoked.
- **Recommendation:** Do not alter existing live customer files in production. For high-security customer customization files in production, future architecture should migrate to signed URLs with short TTLs generated on demand via Firebase Admin SDK.

---

## 8. Administrative Authorization Migration

### The Problem
Previously, `AdminGuard.tsx` and `Navbar.tsx` relied on:
`profile && profile.role === "admin"`
where `profile` was fetched directly from Firestore document `users/{uid}`. If Firestore rules allowed a user to write or update their document, an attacker could set `role: "admin"` and bypass all client admin routing.

### The Solution: Firebase Custom Claims (`admin: true`)
1. **Frontend Integration (`AuthContext.tsx`):**
   - Retrieves `tokenResult = await currentUser.getIdTokenResult()`.
   - Derives `isAdmin = tokenResult.claims.admin === true`.
   - Overrides `profile.role` to `"customer"` if the custom claim is absent, regardless of what is stored in the Firestore document.
   - Provides `refreshClaims()` to support immediate elevation after claim assignment without re-login.
2. **Component Hardening (`AdminGuard.tsx`, `Navbar.tsx`):**
   - Evaluates `isAdmin` from `AuthContext` directly.
   - Non-admin sessions or unauthenticated users are immediately redirected to `/`.
3. **Server-Side API Authorization (`src/lib/auth/adminAuth.ts`):**
   - Exports `verifyAdminRequest(req)`.
   - Verifies Bearer token with `adminAuth.verifyIdToken(token, true)`.
   - Enforces `decoded.admin === true`.
4. **Provisioning Tool (`scripts/manage-admin-claims.mjs`):**
   - Grants and revokes `admin: true` claims using Admin SDK.
   - Preserves all existing custom claims.
   - Includes `--dry-run` flag to preview changes safely without committing.
   - Synchronizes `users/{uid}` in Firestore for UI consistency.

---

## 9. Rules Test Results (RULE-001 through RULE-020)

All 20 mandatory Firestore security tests executed against the live Firestore Emulator loading `firestore.rules`:

| Test ID | Operation | Identity | Expected | Actual | Status |
|---|---|---|---|---|---|
| **RULE-001** | `getDoc(orders/ord-cust-b)` | Anonymous (unauthenticated) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-002** | `getDoc(orders/ord-cust-b)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-003** | `setDoc(orders/ord-tamper-01)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-004** | `updateDoc(orders/ord-cust-b)` (paymentStatus: PAID) | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-005** | `updateDoc(users/cust_a)` (role: admin) | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-006** | `setDoc(users/cust_a)` (role: customer) | Authenticated Customer A (`cust_a`) | ALLOWED | PERMITTED (200) | **PASS** |
| **RULE-007** | `getDoc(users/cust_b)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-008** | `getDoc(orders)` & `updateDoc(products)` | Verified Admin (`admin: true`) | ALLOWED | PERMITTED (200) | **PASS** |
| **RULE-009** | `getDoc(orders)` (Firestore `role: admin`, no claim) | Spoofed User (`spoofed_admin`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-010** | `updateDoc(products/prod_visible)` (price: 10) | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-011** | `getDoc(products/prod_visible)` | Anonymous (unauthenticated) | ALLOWED | PERMITTED (200) | **PASS** |
| **RULE-012** | `getDoc(products/prod_hidden)` & unfiltered query | Anonymous (unauthenticated) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-013** | `setDoc(categories/cat_new)` | Customer (DENIED) / Admin (ALLOWED) | As expected | DENIED / ALLOWED | **PASS** |
| **RULE-014** | `updateDoc(coupons/SAVE20)` (discountValue: 99) | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-015** | `setDoc(reviews)` (legitimate vs forged fake) | Customer (legit ALLOWED / fake DENIED) | As expected | ALLOWED / DENIED | **PASS** |
| **RULE-016** | `getDoc` / `setDoc(paymentRecords)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-017** | `setDoc(paymentWebhookEvents)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-018** | `getDoc` / `setDoc(rateLimits)` | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-019** | `getDoc(unmatchedPayments)` / unknown collection | Authenticated Customer A (`cust_a`) | DENIED | PERMISSION_DENIED | **PASS** |
| **RULE-020** | Query compatibility: single coupon get / list deny | Unauthenticated vs Admin | As expected | PERMITTED / DENIED | **PASS** |

---

## 10. Storage Security Test Results (STORAGE-001 through STORAGE-010)

All 10 mandatory Cloud Storage tests executed against the live Storage Emulator loading `storage.rules`:

| Test ID | Operation | Identity / Parameters | Expected | Actual | Status |
|---|---|---|---|---|---|
| **STORAGE-001** | `getBytes(products/prod_100/hero.jpg)` | Anonymous visitor | ALLOWED | PERMITTED (200) | **PASS** |
| **STORAGE-002** | `uploadBytes(products/prod_100/hack.jpg)` | Anonymous visitor | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-003** | `uploadBytes(categories/cat_apparel/banner.jpg)`| Authenticated non-admin customer | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-004** | `uploadBytes(products/prod_100/admin.jpg)` | Verified Admin (`admin: true`) | ALLOWED | PERMITTED (200) | **PASS** |
| **STORAGE-005** | `uploadBytes(products/prod_100/big.jpg)` | Verified Admin (11 MB oversized payload) | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-006** | `uploadBytes(products/prod_100/exploit.html)` | Verified Admin (`text/html` MIME type) | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-007** | `getBytes(customizations/custom_photo.jpg)` | Customer / Anonymous visitor | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-008** | `uploadBytes(customizations/guest.jpg)` | Anonymous visitor (direct SDK write) | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-009** | `uploadBytes(customizations/existing.jpg)` | Authenticated customer (overwrite attempt) | DENIED | PERMISSION_DENIED | **PASS** |
| **STORAGE-010** | `uploadBytes(reviews/prod_100/cust_a_*.jpg)` | Own UID (ALLOWED) / Spoofed UID (DENIED) | As expected | ALLOWED / DENIED | **PASS** |

---

## 11. Legitimate Application Regression Results

All customer and administrative user flows were verified against the new security rules:
- **Storefront Home & Catalog:** SSR/ISR data fetching via Admin SDK (`page.tsx`, `products/page.tsx`) functions seamlessly.
- **Category Browsing:** Client-side category queries succeed under `allow read: if true;`.
- **Customer Registration & Auth:** New user profile creation in `AuthContext.tsx` writes `role: "customer"`, conforming to `firestore.rules`.
- **Admin Dashboard & Management:** Admins with custom claim `admin: true` access `/admin/dashboard`, view KPIs, update order fulfillment status, manage products, upload category banners, and configure coupons.
- **Product Reviews:** Reading reviews remains public. Customer review submission succeeds for own UID with `isFake: false`. Delivers verification checks via `/api/reviews/eligibility` without requiring direct client order queries.
- **Cart & Checkout:** Single coupon validation (`getDoc`) succeeds in `cart/page.tsx`. COD and Razorpay checkout proceed through transaction-hardened server endpoints.
- **Customer Order Tracking:** Both registered customers and guest customers track orders via `/api/orders/by-ids` using verified ID tokens and cryptographic guest access tokens.

---

## 12. File Modification Summary

| File | Status | Purpose |
|---|---|---|
| `firestore.rules` | **Created** | Comprehensive least-privilege Firestore security rules version 2. |
| `storage.rules` | **Created** | Cloud Storage security rules with size limits, MIME validation, and customization protection. |
| `firebase.json` | **Modified** | Configured emulators to load `firestore.rules` and `storage.rules`. |
| `src/context/AuthContext.tsx` | **Modified** | Migrated admin role evaluation to ID token custom claims; profile synchronization. |
| `src/components/admin/AdminGuard.tsx` | **Modified** | Enforced `isAdmin` verification derived from custom claims. |
| `src/components/storefront/Navbar.tsx` | **Modified** | Updated admin link rendering to evaluate `isAdmin` claim. |
| `src/app/api/reviews/eligibility/route.ts` | **Created** | Authenticated server endpoint for review eligibility, eliminating browser order queries. |
| `src/components/storefront/ProductReviews.tsx` | **Modified** | Refactored eligibility check to consume `/api/reviews/eligibility`. |
| `src/app/api/orders/by-ids/route.ts` | **Modified** | Closed legacy order enumeration oracle by requiring verifiable continuity (TASK J). |
| `src/lib/auth/adminAuth.ts` | **Created** | Server-side helper to verify `admin: true` custom claims on API routes. |
| `scripts/manage-admin-claims.mjs` | **Created** | Safe administrative custom claims management CLI tool with `--dry-run`. |
| `scripts/run-integration-tests.js` | **Modified** | Added new rules and authorization test suites to emulator lifecycle runner. |
| `scripts/run-rules-tests.js` | **Created** | Dedicated runner for fast execution of rules and admin authorization tests. |
| `package.json` / `package-lock.json` | **Modified** | Added `@firebase/rules-unit-testing@5.0.2` and `"test:rules"` script. |
| `tests/integration/firestore-rules.test.ts` | **Created** | Automated tests for RULE-001 through RULE-020. |
| `tests/integration/storage-rules.test.ts` | **Created** | Automated tests for STORAGE-001 through STORAGE-010. |
| `tests/integration/admin-authorization.test.ts` | **Created** | Automated tests for server claim verification and provisioning CLI tool. |
| `tests/integration/guest-order-privacy.test.ts` | **Modified** | Updated PRIV-014 for verified continuity and added PRIV-014B anti-enumeration test. |

---

## 13. Verification Log

| Command | Exit Code | Tests Passed | Tests Failed | Details |
|---|---|---|---|---|
| `npm run typecheck` | 0 | — | 0 | 0 TypeScript errors across entire project. |
| `npm test` | 0 | 12 | 0 | 12/12 unit tests passing in ~124ms. |
| `npm run test:rules` | 0 | 35 | 0 | 35/35 rules tests passing (5 Admin, 20 Firestore, 10 Storage). |
| `npm run test:integration` | 0 | 97 | 0 | 97/97 integration tests across 9 suites passing in ~33s. |
| `npm run build` | 0 | — | 0 | 24/24 App Router routes compiled and optimized in 4.0s. |

**Total Automated Tests Executed: 109 passing (12 unit + 97 integration), 0 failures.**

---

## 14. Security Findings and Unresolved Risks

### Verified Fixes
- **RSK-04 (Admin Privilege Escalation):** Resolved. Role in Firestore document `users/{uid}` is no longer trusted for admin authorization; evaluated exclusively from Firebase Auth custom claims.
- **RSK-06 (Direct Client Firestore SDK Access):** Resolved locally. Restrictive Firestore rules deny direct client reads and writes to `orders`, `paymentRecords`, `coupons`, and `rateLimits`.
- **TASK J (Legacy Guest Order Existence Disclosure):** Resolved. Probe attacks returning order existence or financial totals are eliminated; unverified queries return `{ orders: [] }`.

### Outstanding Operational Blockers
1. **Production Rules Deployment:** Rules exist only in local working tree. Production Firestore and Storage remain at risk until the owner deploys `firestore.rules` and `storage.rules`.
2. **Production Admin Custom Claims:** Approved administrator accounts in production have not yet received the `admin: true` custom claim.
3. **Automated Reservation Cleanup Scheduler (PAY-SCHED):** Abandoned checkouts hold inventory reservations until a background cron/scheduler is implemented to invoke `releaseExpiredReservation()`.
4. **Gateway-Side Payment Status Verification:** Synchronous callback in `/api/razorpay/verify-payment` verifies HMAC signature but does not yet perform an active REST query to Razorpay API (`payments.fetch(paymentId)`) to verify `captured: true`.
5. **Transitive Dependency Vulnerabilities:** 41 npm vulnerabilities remain in lockfile (2 low, 21 moderate, 16 high, 2 critical).

---

## 15. Production Migration and Rollback Plan

> [!CAUTION]
> **DO NOT DEPLOY WITHOUT EXPLICIT OWNER ACTION AND STAGING VALIDATION.**  
> Modifying production security rules without prior custom claim assignment will lock legitimate administrators out of the admin console.

### Pre-Deployment Checklist (Owner Actions)
1. **Export Production Backups:**
   ```bash
   firebase login
   firebase firestore:rules:get --project <PRODUCTION_PROJECT_ID> > firestore.rules.prod.bak
   firebase storage:rules:get --project <PRODUCTION_PROJECT_ID> > storage.rules.prod.bak
   ```
2. **Identify Approved Administrator Accounts:**
   - Map exact UIDs of legitimate business owners.
   - Do NOT mass-promote existing Firestore users with `role: "admin"`.
3. **Provision Admin Custom Claims in Production (Dry-Run First):**
   ```bash
   node scripts/manage-admin-claims.mjs --uid <OWNER_UID> --action grant --dry-run
   node scripts/manage-admin-claims.mjs --uid <OWNER_UID> --action grant
   ```
4. **Verify Admin Token Refresh:**
   - Have the administrator log in to `bazaarvilla.com` and confirm `getIdTokenResult().claims.admin === true`.
5. **Deploy Firestore Security Rules:**
   ```bash
   firebase deploy --only firestore:rules --project <PRODUCTION_PROJECT_ID>
   ```
6. **Deploy Storage Security Rules:**
   ```bash
   firebase deploy --only storage --project <PRODUCTION_PROJECT_ID>
   ```
7. **Deploy Next.js Application on Netlify.**

### Rollback Procedure
If any unexpected permissions errors occur in production:
1. **Restore Firestore Rules:**
   ```bash
   firebase firestore:rules:release firestore.rules.prod.bak --project <PRODUCTION_PROJECT_ID>
   ```
2. **Restore Storage Rules:**
   ```bash
   firebase storage:rules:release storage.rules.prod.bak --project <PRODUCTION_PROJECT_ID>
   ```
3. **Revoke Admin Custom Claim if Needed:**
   ```bash
   node scripts/manage-admin-claims.mjs --uid <TARGET_UID> --action revoke
   ```

---

## 16. Remaining Payment and Infrastructure Risks
- **PAY-SCHED:** Missing automated scheduler/cron for `releaseExpiredReservation()`. Abandoned orders hold inventory until manually released.
- **GATEWAY-VERIFY:** Missing synchronous gateway REST verification in `/api/razorpay/verify-payment`.
- **DEPENDENCIES:** 41 npm vulnerabilities requiring targeted dependency remediation.
- **PRODUCTION DNS/HTTPS:** Must verify authorized domains in Firebase Console under `Authentication -> Settings -> Authorized Domains` for `bazaarvilla.com` and `www.bazaarvilla.com`.

---

## 17. Deployment Status
- **Git Push:** None. Local branch `fix/firestore-rules-custom-claims` only.
- **Git Merge:** None.
- **Netlify Deployment:** Untouched.
- **Live Firebase Security Rules:** Untouched.
- **Production Firebase Accounts / Claims:** Untouched.

---

## 18. Recommended Next Task

### **TASK-007 — Automated Reservation Cleanup Scheduler & Synchronous Gateway Verification**
- **Objective:**
  1. Build a scheduled background worker (or Next.js API cron endpoint secured by a secret token) to automatically invoke `releaseExpiredReservation()` for pending orders older than 15 minutes, returning held stock and coupon capacity.
  2. Enhance `/api/razorpay/verify-payment` to execute a direct server-to-server REST call to Razorpay (`razorpay.payments.fetch(paymentId)`) before finalizing an order as `PAID`.
- **Rationale:** Resolves the final two core operational payment integrity risks prior to commercial payment launch.

---

## 19. Context for the Next AI Agent
- **Active Git Branch:** `fix/firestore-rules-custom-claims`
- **Working Tree:** Contains uncommitted modifications from TASK-001 through TASK-006.
- **Security Rules Files:**
  - `firestore.rules`: Version 2 least privilege rules.
  - `storage.rules`: Version 2 Storage rules.
  - `firebase.json`: Configured with rules pointers.
- **Admin Authorization Model:**
  - Evaluated via `request.auth.token.admin == true` in rules and `verifyAdminRequest()` in APIs.
  - Script: `scripts/manage-admin-claims.mjs` handles provisioning.
- **Test Suite Command:**
  - `npm test`: 12 unit tests.
  - `npm run test:rules`: 35 rules and authorization tests.
  - `npm run test:integration`: 97 integration tests in emulator.
  - `npm run typecheck`: 0 TypeScript errors.
  - `npm run build`: 24 routes compiling cleanly.
