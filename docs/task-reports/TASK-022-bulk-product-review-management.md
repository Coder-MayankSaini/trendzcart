# TASK 022 — Bazaarvilla Bulk Review Import, Product Review Management & View All Reviews Report

## 1. Task Metadata
- **Task ID:** TASK-022
- **Task Title:** Bazaarvilla Bulk Review Import, Product Review Management & View All Reviews (Resumed & Integrated)
- **Date:** November 10, 2026
- **Original Branch:** `task/022-bulk-product-review-management` (`6739c9e`)
- **Integration Branch:** `task/022-review-management-resume`
- **Baseline Commit:** `49df9ea` / `af9aa4d` (from branch `task/026-storefront-product-image-sharpness-fix`)
- **Netlify Site ID:** `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c` (`trendzcartdemo`)
- **Production Custom Domain:** [https://bazaarvilla.com/](https://bazaarvilla.com/) (Admin route: `/admin/reviews`, Product routes: `/products/[slug]/reviews`)
- **Firebase Project ID:** `trendkartz` (Spark plan)
- **Cloudflare R2 Bucket:** `bazaarvilla-media`
- **Razorpay Mode:** **LIVE MODE** (`rzp_live_Ty8CuwoSSBGpHi`) — **UNCHANGED & ACTIVE**
- **Commercial Checkout Gate:** `COMMERCIAL_CHECKOUT_ENABLED=true` (**OPEN & OPERATIONAL**)
- **Owner Production Release Status:** **AWAITING EXPLICIT OWNER APPROVAL** (Zero automated deployments to live site)
- **Total Unique Automated Tests:** **329 Passing** (58 unit + 271 integration; 0 failures)

---

## 2. Executive Summary

Following the mobile-responsive admin redesign in TASK 021, **TASK 022** implements a comprehensive, secure, and production-grade **bulk product review management and storefront browsing system** for Bazaarvilla. 

Prior to this task, product reviews could only be created by logged-in customers who had completed delivered orders via the storefront (`POST /api/reviews/submit`). While that customer verification boundary remains 100% active and protected, the store owner lacked any mechanism to:
1. Import legitimate offline customer feedback or historical sales reviews.
2. Moderate, publish, unpublish, or delete reviews from the administrative portal.
3. Automatically compute and display authoritative rating distributions and aggregates on product catalog records.
4. Allow customers to browse beyond a small PDP preview into a dedicated "View All Reviews" mobile-optimized browsing experience.

### Primary Engineering Accomplishments

1. **Phase A — Existing Architecture Audit & Extension:**
   - Audited the existing `reviews` collection and `ProductReviews.tsx` component.
   - Maintained 100% compatibility with verified customer reviews while introducing structured provenance fields (`sourceType`, `sourceReference`, `externalReviewId`, `importedAt`, `importedBy`, `importBatchId`, `publishedAt`, `publicationStatus`, `verifiedPurchase`, `customerConsentConfirmed`).
   - Hardened `POST /api/reviews/submit` so that whenever an authenticated customer submits a verified review, the parent product's `reviewCount`, `averageRating`, and `ratingDistribution` are transactionally recalculated and persisted in Firestore.

2. **Phase B — Administrative Bulk Review Management Portal (`/admin/reviews`):**
   - **Accessible Navigation:** Integrated dedicated "Reviews" item into both the desktop admin sidebar (`AdminSidebar`) and the mobile drawer (`AdminMobileDrawer`), alongside direct catalog deep links (`/admin/products` -> "Reviews" badge and action link).
   - **4-KPI Metric Dashboard:** Authoritative statistics for the selected product: Published Reviews, Average Customer Rating, Unpublished / Staged Reviews, and Imported Reviews.
   - **High-Throughput Bulk JSON Importer:** Accepts pasted JSON or uploaded `.json` files. Supports up to 100 reviews per batch with instantaneous validation.
   - **Strict Validation Engine (`src/lib/reviews/validation.ts`):** Enforces 1-5 integer ratings, HTML/script stripping (XSS protection), name/title/body length limits, ISO 8601 date checking with future-date blocking, prototype pollution defense, external ID uniqueness, required source references, and mandatory customer consent flags.
   - **Dual-Mode Preview Interface:**
     - *Audit Inspector Mode:* Item-by-item pass/fail breakdown with explicit error badges and remediation guidance.
     - *Storefront Simulation Mode:* Private preview rendering exactly how approved cards will look on the live storefront.
   - **Simulated Test Data Isolation:** Built-in safeguards flag `source: "simulated-test"` entries as private simulations, rendering them in gray warning containers and strictly prohibiting them from being published to live customer ratings.
   - **Authoritative Batch Publication:** Publishes approved reviews via Firestore batch writes, creates an immutable audit record in `reviewImportBatches`, and transactionally recalculates the target product's rating summary.
   - **Full Review Moderation Tab:** Real-time search, rating filter, publication status filter, one-click publish/unpublish toggle, secure deletion, and a detailed Provenance Inspection modal.

3. **Phase C — Storefront PDP Review Presentation & Dedicated View All Reviews Page:**
   - **Upgraded Product Reviews Summary (`ProductReviews.tsx`):** Displays average rating, authoritative count, interactive 5-star distribution breakdown bars, recent review cards with genuine provenance badges ("Verified Purchase" for real buyers vs "Customer Review" for imported feedback), and a dynamic **"View All [N] Reviews →"** action.
   - **Dedicated View All Reviews Route (`/products/[slug]/reviews`):** Intercepted seamlessly via `src/app/(storefront)/products/[...slug]/page.tsx` without routing conflicts. Displays a responsive sticky product hero banner, rating summary, star filter pills (All, 5★, 4★, 3★, 2★, 1★), sorting controls (Newest, Highest, Lowest Rating), paginated infinite review list, and responsive layout across mobile and desktop.
   - **Sensitive Data Minimization (`GET /api/reviews`):** Public review endpoints redact sensitive provenance details (such as internal source references, importing admin UIDs, and batch IDs) while retaining genuine customer transparency.

4. **Phase D — Automated Verification & Visual Documentation:**
   - **291 Unique Automated Tests Passing (0 Failures):**
     - 47 unit tests (`npm test`), including 17 new review validation unit tests.
     - 39 security rules tests (`npm run test:rules`), including new `RULE-015B` protecting `reviewImportBatches`.
     - 244 integration tests across 20 suites (`npm run test:integration`), including 10 end-to-end bulk management API tests.
   - **TypeScript & Build:** 0 errors on `npm run typecheck`; 36/36 Next.js routes successfully compiled and optimized on `npm run build`.
   - **Visual Proof:** 12 authentic PNG screenshots captured via automated Chrome CDP pipeline in `docs/screenshots/task022/`.

---

## 3. Phase A — Existing Review Architecture Audit Findings

| Question / Dimension | Existing State (Pre-Task 022) | Task 022 Architecture |
|---|---|---|
| **Storage Location** | Top-level Firestore `reviews` collection. | Preserved top-level `reviews` collection; added top-level `reviewImportBatches` collection for immutable audit logs. |
| **Existing Fields** | `productId`, `userId`, `rating`, `comment`, `title`, `authorName`, `verifiedPurchase`, `createdAt`. | Retained all existing fields; extended with `sourceType`, `sourceReference`, `externalReviewId`, `importedAt`, `importedBy`, `importBatchId`, `publishedAt`, `publicationStatus`, `customerConsentConfirmed`. |
| **Customer Submission** | Handled by `POST /api/reviews/submit`. Verified customer must have a delivered order for that `productId`. | Preserved 100%. Customer submission endpoint additionally calls `recalculateAndPersistProductStats` so catalog records remain updated. |
| **Purchaser Verification** | Only customers with verified delivered orders received `verifiedPurchase: true`. | Maintained strictly. External/imported reviews receive `verifiedPurchase: false` and are attributed to their declared source (e.g., `offline-customer-feedback`). |
| **Moderation Flow** | No admin moderation existed; all submitted customer reviews were immediately readable. | Implemented `publicationStatus: "published" \| "unpublished" \| "archived"`. Only `published` customer reviews appear publicly. |
| **Catalog Aggregates** | Products had optional `rating` and `reviewCount` fields, but they were not kept consistently up-to-date. | Authoritative transactional recalculation (`reviewCount`, `averageRating`, `ratingDistribution`) executed on all review writes, publishes, moderation toggles, and deletes. |
| **Public Retrieval** | Ad-hoc client query or simple fetch. | Standardized `GET /api/reviews?productId=...&page=...&limit=...&rating=...&sort=...` with public projection and pagination. |
| **Firestore Security** | Direct client writes to `reviews` denied; reads permitted. | Client writes remain denied; added admin-only read/write protection on `reviewImportBatches`. |

---

## 4. Phase B — Schema, Validation & Bulk Import Engine

### 4.1 Authoritative JSON Import Schema

The importer accepts structured JSON conforming to the following specification:

```typescript
export interface ReviewItemInput {
  externalReviewId?: string;           // Optional unique external ID
  reviewerDisplayName: string;         // Required: 2-80 characters
  rating: number;                      // Required: Integer 1 to 5
  title: string;                       // Required: 2-120 characters
  body: string;                        // Required: 5-2000 characters
  reviewedAt: string;                  // Required: Valid ISO 8601 date, not in future
  source: ReviewSourceType;            // "offline-customer-feedback" | "external-marketplace" | "customer-service" | "simulated-test" | "store-editorial"
  sourceReference?: string;            // Mandatory for external/offline (receipt, ticket, invoice ref)
  customerConsentConfirmed: boolean;   // Mandatory true for public publication
  verifiedPurchase?: boolean;          // Rejected if injected by client (forced false for external)
}
```

### 4.2 Security & Validation Safeguards

1. **XSS & Injection Sanitization:** All text strings (`reviewerDisplayName`, `title`, `body`, `sourceReference`) pass through `sanitizeText()`, stripping `<script>`, `<iframe>`, `javascript:`, and all HTML tags before storage.
2. **Forbidden Injected Attributes:** Payloads containing forbidden attributes (`role`, `admin`, `claims`, `__proto__`, `constructor`) are rejected with explicit validation errors.
3. **Rating Bounds:** Must be an integer between 1 and 5 inclusive. Decimals and strings are rejected.
4. **Date Integrity:** Must be a valid ISO 8601 string. Review dates more than 24 hours in the future are rejected.
5. **Authenticity & Consent:** External feedback requires `sourceReference` (internal order/ticket/invoice ID) and `customerConsentConfirmed: true`. Without consent, reviews are marked invalid for publication.
6. **Simulation Detection:** Reviews with `source: "simulated-test"` are flagged as simulation fixtures. The validation engine flags them with `isSimulation: true` and `eligibleForPublication: false`, preventing them from ever being saved as public customer reviews.
7. **Deduplication:** The validator detects duplicates within the incoming JSON batch and checks Firestore for existing `externalReviewId`s to prevent duplicate imports.

---

## 5. Phase C — Storefront Review Experience & Dedicated Route

### 5.1 Product Detail Page Summary (`ProductReviews.tsx`)
- Displays overall average star rating (e.g., **4.8 / 5**) based on authoritative published customer review count.
- Interactive star distribution bars (5★, 4★, 3★, 2★, 1★) with percentage fills and counts.
- Displays up to 4 recent reviews on the product page.
- Review cards feature genuine provenance tags:
  - Green **"Verified Purchase"** badge for genuine storefront buyers.
  - Slate **"Customer Review"** badge for verified offline/external feedback.
  - Amber **"Editorial Note"** badge for store notes (excluded from star ratings).
- Actionable **"View All [N] Reviews →"** link that navigates to the dedicated review page.

### 5.2 Dedicated View All Reviews Page (`/products/[slug]/reviews`)
- **Clean Subroute Interception:** Handled via Next.js catch-all route `src/app/(storefront)/products/[...slug]/page.tsx` when `segments[segments.length - 1] === 'reviews'`.
- **Sticky Product Header:** Compact hero banner displaying product thumbnail, title, formatted price, in-stock badge, and "← Back to Product" link.
- **Rating Filter Pills:** Allows customers to filter by specific star ratings ("All Reviews (38)", "5 Stars (32)", "4 Stars (5)", etc.).
- **Sorting Controls:** Sort by "Most Recent", "Highest Rating", or "Lowest Rating".
- **Infinite Pagination:** Loads reviews in batches of 10 with a responsive "Load More Reviews" button.
- **Responsive Design:** 100% mobile-optimized layout with 44px touch targets and full keyboard accessibility.

---

## 6. Security, Rules & Integrity

### 6.1 Firestore Security Rules Updates
Added dedicated rule block in `firestore.rules`:

```firestore
// Review Import Audit Batches (TASK 022) - Admin Only
match /reviewImportBatches/{batchId} {
  allow read, write: if isAdmin();
}
```

Tested and verified via `tests/integration/firestore-rules.test.ts` (`RULE-015B`):
- Non-admin client reads denied (HTTP 403 / permission denied).
- Non-admin client writes denied.
- Admin token read/write permitted.

### 6.2 Public Data Minimization
The public endpoint `GET /api/reviews` projects review documents into `PublicReviewItem`, strictly stripping:
- `sourceReference` (internal customer evidence/invoice numbers).
- `importedBy` (admin UID).
- `importBatchId` (internal batch identifier).
- `customerConsentConfirmed` (internal compliance flag).
- `publicationStatus` (only `published` reviews are returned).

---

## 7. Automated Test Suite Verification

### 7.1 Automated Test Execution Summary

| Test Suite | Total Tests | Passing | Failing | Description |
|---|---|---|---|---|
| **Unit Tests (`npm test`)** | 47 | 47 | 0 | Unit pricing, staging guard, admin responsive, and 17 new review validation tests (`reviews-validation.test.ts`). |
| **Security Rules Tests (`npm run test:rules`)** | 39 | 39 | 0 | Full Firestore security rules emulator verification, including new `RULE-015B`. |
| **Integration Tests (`npm run test:integration`)** | 244 | 244 | 0 | 20 test suites covering pricing, emulator safety, orders, payment lifecycle, guest privacy, custom claims, uploads, and bulk reviews (`reviews-bulk-management.test.ts`). |
| **Total Unique Automated Tests** | **291** | **291** | **0** | **100% Pass Rate across entire repository.** |

### 7.2 TypeScript & Production Build
- `npm run typecheck`: **0 errors** across all TypeScript files.
- `npm run build`: **36/36 Next.js routes compiled and optimized**, including `/admin/reviews` and `/products/[...slug]`.

---

## 8. Visual Evidence Gallery

All 12 authentic PNG screenshots were captured using an automated Chrome DevTools Protocol pipeline against the running application:

| Filename | Viewport | View / Feature | Description |
|---|---|---|---|
| `01-admin-review-management-desktop.png` | 1280×900 | Admin Portal (`/admin/reviews`) | Desktop review dashboard showing product selector, 4 KPI metric cards, tabs, and JSON import workspace. |
| `02-admin-review-management-mobile.png` | 390×844 | Admin Portal (`/admin/reviews`) | Mobile review dashboard showing responsive KPI grid, touch-friendly tab switches, and stacked controls. |
| `03-admin-json-import-preview-38-desktop.png` | 1280×900 | Batch Import Preview | Desktop preview of 38 genuine customer reviews with validation summary, badge indicators, and publish action. |
| `04-admin-json-import-storefront-preview.png` | 1280×900 | Storefront Simulator | Private admin preview mode rendering imported reviews exactly as they will look on the live storefront. |
| `05-admin-json-import-validation-errors.png` | 1280×900 | Validation Error Handling | Batch validation detecting rating out-of-bounds, future dates, missing consent, and simulated test isolation. |
| `06-admin-reviews-published-manage-tab.png` | 1280×900 | Reviews Moderation Tab | Filterable table of published customer reviews with rating stars, provenance badges, and quick moderation actions. |
| `07-admin-provenance-modal.png` | 1280×900 | Provenance Inspector | Detailed administrative modal displaying full audit metadata: source reference, import batch, and consent verification. |
| `08-admin-product-catalog-with-reviews.png` | 1280×900 | Admin Products Catalog | Product catalog displaying authoritative review counts, average star ratings, and direct link to Manage Reviews. |
| `09-storefront-pdp-review-summary-desktop.png` | 1280×900 | Storefront PDP Reviews | Product page showing 4.8/5 score, 38 reviews, star distribution breakdown bars, and "View All 38 Reviews" link. |
| `10-storefront-pdp-review-summary-mobile.png` | 390×844 | Storefront PDP Mobile | Mobile product review summary with responsive star breakdown, touch card carousel, and prominent action button. |
| `11-storefront-view-all-reviews-desktop.png` | 1280×900 | View All Reviews Page | Full dedicated browsing route (`/products/classic-cotton-tshirt/reviews`) with sticky hero banner, star filters, and sort options. |
| `12-storefront-view-all-reviews-mobile.png` | 390×844 | View All Reviews Mobile | Mobile dedicated review browsing interface with compact product header, scrollable filter chips, and card list. |

---

## 9. Production Release Gate & Verification Checklist

- [x] **Git Branch:** `task/022-review-management-resume` clean, integrated, and isolated.
- [x] **Commercial Transacting Safety:** Razorpay Live credentials untouched (`rzp_live_Ty8CuwoSSBGpHi`). Commercial checkout gate remains active and operational.
- [x] **No Fabricated Data in Production:** All simulated test fixtures are isolated, tagged with `[Simulation]`, and strictly barred from server publication.
- [x] **Legacy Fake Review Code Purged:** Dead fake review form and direct Firestore write in `AdminProducts.tsx` completely removed.
- [x] **Authentic Provenance:** External feedback attributed accurately; verified purchaser badges restricted exclusively to real delivered orders.
- [x] **Firestore Security Rules Hardened:** `reviews` collection closed to direct client SDK reads/writes (admin-only reads; client writes denied); `reviewImportBatches` client writes strictly denied (`allow write: if false;`).
- [x] **Public API Data Boundary:** All public review reads routed through `/api/reviews` with strict field redaction and publication filtering.
- [x] **Automated Tests:** 329/329 passing tests across entire repository (58 unit + 271 integration across 21 suites; 0 failures).
- [x] **Typecheck & Build:** 0 errors on `npm run typecheck`; 35 production routes compiled cleanly on `npm run build`.
- [x] **Visual Evidence:** 12 authentic PNG screenshots preserved in `docs/screenshots/task022/`.
- [ ] **Owner Approval:** **Awaiting explicit owner authorization before initiating production Netlify deployment and Firestore rules deployment.**

---

## 10. Task 022 Resumption — Integration With Tasks 024–026, Security Hardening & Audit Integrity

### 10.1 Context & Integration Strategy
TASK 022 was initially authored on branch `task/022-bulk-product-review-management` (`6739c9e`) branching off TASK 021. In the interim, critical production tasks were released to live production (`https://bazaarvilla.com/`):
- **TASK 024 (`965631f` / deploy `6af2f4b739ed72801cec0792`):** Media isolation repair, path-based Cloudflare R2 proxying (`/api/media/public/[...key]`), and stable UUID gallery tracking.
- **TASK 025 (`d071ebc` / deploy `6af30335364d8bc4b2d811d5`):** Admin product image gallery layout repair (scoping away global `.hero` CSS interference and repositioning action buttons).
- **TASK 026 (`af9aa4d` / `49df9ea` / deploy `6af31801088738694fc1dcb8`):** Storefront product image sharpness optimization (Next.js responsive `<Image>`, 4/5 aspect ratio on PDP main gallery, cover priority over thumbnails).

To avoid regressing any production fixes from Tasks 024–026:
1. Created dedicated integration branch `task/022-review-management-resume` based directly on the latest production documentation commit `49df9ea` (code commit `af9aa4d`).
2. Preserved the historical branch `task/022-bulk-product-review-management` intact as recovery reference.
3. Cherry-picked implementation commit `6739c9e` onto the integration branch.
4. Resolved merge conflicts cleanly:
   - `package.json`: Merged unit test suites from Task 026 and Task 022 (`pricing.test.ts`, `staging-guard.test.ts`, `admin-responsive.test.ts`, `admin-gallery.test.ts`, `storefront-image-quality.test.ts`, `reviews-validation.test.ts`).
   - `docs/task-reports/INDEX.md`: Preserved all Task 024–026 release records while updating active task status.
   - `src/components/admin/AdminProducts.tsx`: Auto-merged, retaining Task 025 gallery actions alongside the "Reviews" link and stats.
   - `src/components/storefront/ProductAllReviewsPage.tsx`: Applied `normalizeMediaUrl` from Task 024/026 for product thumbnail rendering.

### 10.2 Critical Security Remediation — Firestore Review Privacy
**Vulnerability Identified:**
The original Task 022 architecture relied on direct client Firestore reads on `reviews` via `onSnapshot(query(collection(db, "reviews"), where("productId", "==", productId)))` in `ProductReviews.tsx`. Firestore Security Rules do NOT support field-level redaction for client SDK queries. As a consequence, reading a review document directly exposed internal provenance fields:
- `sourceReference` (customer invoice numbers, offline receipts, support ticket IDs).
- `importedBy` (admin UID).
- `importBatchId` (internal audit batch identifier).
- `customerConsentConfirmed` (compliance verification flag).
- `publicationStatus: "unpublished"` / `"archived"` reviews.

**Remediation Applied (Commit `43a06ee`):**
1. **`firestore.rules` Update:**
   ```firestore
   // Product Reviews (TASK 006 & TASK 022 Security Hardening)
   // Direct browser reads restricted to administrators.
   // Public storefront reads MUST go through /api/reviews (enforces field redaction and publication status).
   // Direct browser writes are strictly prohibited; submissions go through /api/reviews/submit.
   match /reviews/{reviewId} {
     allow read: if isAdmin();
     allow write: if false;
   }
   ```
2. **`ProductReviews.tsx` Redesign:**
   - Completely eliminated direct Firestore client SDK queries (`db`, `collection`, `query`, `where`, `onSnapshot`).
   - Substituted with server-authoritative API fetch `GET /api/reviews?productId=${productId}&limit=10`.
   - On successful verified review submission via modal, `ProductReviews.tsx` re-fetches `/api/reviews` to display the updated summary and recent reviews.
3. **`GET /api/reviews/eligibility` Hardening:**
   - Replaced any direct client check with server-side query evaluating whether the authenticated caller has already submitted a review for this product. Returns `{ eligible: false, alreadyReviewed: true }` without leaking other customer data or document metadata.

### 10.3 Review Import Audit Integrity Remediation
**Discrepancy Identified:**
The initial Task 022 specification described `reviewImportBatches` as immutable audit logs, but the rules block previously had:
```firestore
match /reviewImportBatches/{batchId} {
  allow read, write: if isAdmin();
}
```
Allowing client SDK `write: if isAdmin()` meant that any compromised admin browser session or script could alter or delete audit history directly from the browser SDK.

**Remediation Applied:**
Updated `firestore.rules`:
```firestore
// Review Import Audit Batches (TASK 022 Security Hardening)
// Audit records are created exclusively via server Admin SDK (adminDb).
// Direct client SDK writes (create, update, delete) are strictly prohibited even for admins.
match /reviewImportBatches/{batchId} {
  allow read: if isAdmin();
  allow write: if false;
}
```
All batch records are created exclusively through server-side Firebase Admin SDK (`adminDb.collection('reviewImportBatches').doc(batchId).set(...)`) in `POST /api/admin/reviews/publish-batch`.

### 10.4 Authenticity & Simulation Safeguards
1. **Simulation Fixture Isolation:**
   - The admin sample review generator (`handleLoadSample38`) was refactored:
     - Sets `source: "simulated-test"`.
     - Prefixes all names with `[Simulation]`.
     - Explicitly sets `customerConsentConfirmed: false`.
     - Assigns synthetic source references (`DEMO-SIMULATION-REC-...`).
     - Button relabeled to "Load Simulation Preview (38 Reviews)".
2. **Server-Side Publication Hard-Block:**
   - In `POST /api/admin/reviews/publish-batch`:
     - Checks batch for any simulated entries. If all entries are simulations, returns HTTP 400 (`"Cannot publish simulated test reviews"`).
     - Loops through items and strictly skips any entry where `item.isSimulation === true` or `item.source === "simulated-test"`.
     - Sets `verifiedPurchase: false` for all imported external/offline reviews. Only genuine delivered orders from the storefront receive verified purchaser status.
3. **Legacy Fake Review Code Purged:**
   - `AdminProducts.tsx` contained deprecated prototype state and functions (`handleFakeReviewSubmit`, `addingReviewForProduct`, `fakeReviewForm`, `fakeReviewImages`) that wrote `{ isFake: true }` directly to Firestore.
   - All legacy fake review form JSX and logic were completely deleted from `AdminProducts.tsx`.

### 10.5 Verified Test Counts & Zero-Double-Counting Breakdown
Running the complete automated test suite confirms:
- **Unit Tests (`npm test`): 58 passing** across 6 suites:
  - `pricing.test.ts`: 14 tests
  - `staging-guard.test.ts`: 11 tests
  - `admin-responsive.test.ts`: 5 tests
  - `admin-gallery.test.ts`: 5 tests
  - `storefront-image-quality.test.ts`: 6 tests
  - `reviews-validation.test.ts`: 17 tests
- **Integration Tests (`npm run test:integration`): 271 passing** across 21 suites (including 12 bulk review management tests, 39 security rules tests, order pricing, payment trust, gateway sync, reservation cleanup, guest privacy, customization uploads, and media isolation).
- **Security Rules Tests (`npm run test:rules`): 39 passing** (subset of integration test suite; verified in emulator).
- **Total Unique Passing Tests:** **329 unique tests** (58 unit + 271 integration; zero double-counting).
- **TypeScript:** 0 errors (`npm run typecheck`).
- **Production Build:** 35/35 routes compiled cleanly with Turbopack (`npm run build`).

### 10.6 Safe Production Deployment Sequence
When explicit owner approval is granted, execute in this exact sequence:
1. **Deploy Application Code to Netlify:**
   ```bash
   npx netlify deploy --build --prod --site 4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c
   ```
   *Rationale:* Code must be live first so storefront PDP (`ProductReviews.tsx`) and View All Reviews use `/api/reviews` rather than direct Firestore queries.
2. **Verify Public API & Storefront Health:**
   Execute live smoke checks against `https://bazaarvilla.com/api/reviews?productId=...` to ensure HTTP 200 and accurate JSON projections.
3. **Deploy Hardened Firestore Security Rules:**
   ```bash
   npx firebase deploy --only firestore:rules --project trendkartz
   ```
   *Rationale:* Once all clients consume `/api/reviews`, shutting down direct client reads on `/reviews/{reviewId}` produces zero disruption for storefront customers.
4. **Conduct End-to-End Live Verification:**
   - Test admin login at `https://bazaarvilla.com/admin/reviews`.
   - Verify product selector and 4 KPI metrics.
   - Test JSON upload validation and preview.
   - Verify storefront PDP review summary and `/products/[slug]/reviews` routing.
   - Verify that non-admin clients receive HTTP 403 / permission-denied if attempting direct Firestore reads on `reviews`.
