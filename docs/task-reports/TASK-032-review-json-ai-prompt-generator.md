# TASK 032 — Bazaarvilla Product-Specific Review JSON & AI Prompt Generator

**Task ID:** TASK-032  
**Task Title:** Bazaarvilla Product-Specific Review JSON & AI Prompt Generator  
**Engineering Role:** Senior Next.js Fullstack Engineer, E-Commerce Data Architect & AI Prompt Design Specialist  
**Status:** **TASK 032 — LOCALLY COMPLETED AND VERIFIED, PRODUCTION APPROVAL PENDING.**  
**Date:** 2026-11-11  
**Git Branch:** `task/032-review-json-ai-prompt-generator`  
**Production URL:** `https://bazaarvilla.com`  
**Production Remote:** `https://github.com/Coder-MayankSaini/trendzcart.git`  
**Production Baseline Deploy:** `6af47607291e50bfb6bd4653` (TASK 031)  
**Production Baseline Code Commit:** `6c4a0d17316483ec94e675df016146ef8b4f5f2e`  
**Production Baseline Docs Commit:** `6ccc053aa3fb828842d01c1aeeced0be832a61b0`  
**Automated Test Baseline Before:** 545 unique passing tests (190 unit + 355 integration, including 41 security rules)  
**Updated Automated Test Baseline:** **565 unique passing tests (207 unit + 358 integration, including 41 security rules across 25 suites; 100% pass rate)**  
**Visual QA Coverage:** 9 high-fidelity screenshots captured across desktop, tablet, and mobile (down to 320px) in `docs/screenshots/task032/`  

---

## 1. Executive Summary & Objective

In Bazaarvilla's administrative review management interface (`/admin/reviews`), store administrators previously faced repetitive manual friction when importing customer reviews:
1. Administrators had to manually look up and type or paste product document IDs.
2. Generating structured JSON required manual authoring or editing raw templates, introducing potential syntax errors, product ID mismatches, and schema inconsistencies.
3. Formatting authentic raw customer feedback (from WhatsApp messages, offline store receipts, emails, and customer support tickets) into Bazaarvilla's TASK 022 review schema required repetitive prompt engineering.

### Engineering Objectives Achieved:
1. **Search-Enabled Product Selector:** Integrated a real-time product search filter into `/admin/reviews` that searches the authoritative catalog by product name, category, or document ID. Preselects the active product when arriving from catalog links (`?productId=...`) and keeps the browser URL query parameter synchronized without page reloads.
2. **Authoritative Product ID Binding:** Eliminates manual ID typing. The selected product's genuine Firestore document ID is automatically bound to generated templates, prompts, and server validation requests, while presenting a quick "Copy ID" chip for admin reference.
3. **Configurable Review Capacity (1–50 Entries):** Added an interactive numeric stepper with instant preset buttons (1, 3, 5, 10, 20) allowing administrators to set the exact capacity of placeholder entries or formatting requests.
4. **One-Click JSON Template Generator:** Generates valid, parseable JSON populated with the real product ID, exact TASK 022 schema fields (`externalReviewId`, `reviewerDisplayName`, `rating`, `title`, `body`, `reviewedAt`, `source`, `sourceReference`, `customerConsentConfirmed`), and unique placeholder IDs. Supports 1-click clipboard copying and direct 1-click loading into the in-page editor.
5. **Comprehensive AI Formatting Prompt Generator:** Automatically builds an LLM formatting prompt incorporating the website name (`Bazaarvilla` / `https://bazaarvilla.com`), authoritative product ID, product title, concise factual description (with HTML tags stripped), formatted attributes (price, category, sizes, colors, tags), requested capacity, exact schema definition, valid example object, and customization room for language (English, Hindi, Hinglish), tone, and review length.
6. **Strict Truthfulness & Anti-Hallucination Guardrails:** AI prompts explicitly prohibit inventing customer experiences, synthetic names, or simulated consent, instructing LLMs to format only the authentic feedback provided by the administrator.
7. **Server-Authoritative Placeholder & Mismatch Rejection:** Hardened `validation.ts`, `validate/route.ts`, and `publish-batch/route.ts` to detect unedited template placeholders (`isTemplatePlaceholderReview`) and product ID mismatches, preventing fictional or mismatched reviews from being published to the live storefront.
8. **Preservation of Review Authenticity & Verified Purchase Status:** Genuine imported reviews are published to the product detail page with `verifiedPurchase: false`, strictly reserving verified-purchase badges for in-app customers who completed delivered orders (TASK 022 compliance).
9. **Zero Paid AI API Costs:** The generator operates completely client-side and server-authoritatively without third-party LLM API subscriptions, token costs, or external network dependencies.

---

## 2. Production Baseline Verification

Before creating the dedicated task branch `task/032-review-json-ai-prompt-generator`, the local working copy and production commits were verified against reported task baselines:

| Parameter | Baseline Value | Verified State |
|---|---|---|
| **Production Domain** | `https://bazaarvilla.com` | Verified HTTP 200 OK |
| **Latest Production Task** | TASK 031 — Mobile Storefront Responsiveness | Verified Deployed |
| **Deployed Code Commit** | `6c4a0d17316483ec94e675df016146ef8b4f5f2e` | Verified in Git History |
| **Published Netlify Deploy** | `6af47607291e50bfb6bd4653` | Verified Published |
| **Documentation Commit** | `6ccc053aa3fb828842d01c1aeeced0be832a61b0` | Verified on Branch |
| **Active Task Branch** | `task/032-review-json-ai-prompt-generator` | Created from verified commit |
| **Initial Test Baseline** | 545 unique passing tests | 190 unit + 355 integration |

---

## 3. Architecture & Implemented Modules

### 3.1 New Module: `src/lib/reviews/promptGenerator.ts`

Exports three core functions:

```ts
export interface ReviewAiPromptOptions {
    productId: string;
    productName: string;
    productDescription?: string;
    price?: number;
    category?: string;
    tags?: string[];
    sizes?: string[];
    colors?: Array<{ name: string; hex?: string }>;
    count: number;
}

export function generateReviewJsonTemplate(
    productId: string,
    productName?: string,
    count?: number
): ReviewBatchImportPayload;

export function generateReviewAiPrompt(
    options: ReviewAiPromptOptions
): string;
```

#### Key Capabilities:
- **`generateReviewJsonTemplate`**: Clamps count between 1 and 50 (defaults to 5). Formats ISO date string `YYYY-MM-DD` for `reviewedAt`. Generates padded deterministic placeholder external IDs (`TEMPLATE-${productId.slice(0, 16)}-${paddedIndex}`). Clearly identifies placeholders with `[Template Placeholder ...]` and `[Customer Name Placeholder ...]`.
- **`generateReviewAiPrompt`**: Extracts and cleans product metadata. Strips HTML markup and collapses whitespace in product descriptions. Synthesizes catalog attributes (`Price`, `Category`, `Sizes`, `Colors`, `Tags`). Formats prompt sections with clear headers, rules, schema, valid example, and admin customization instructions.

---

### 3.2 Enhanced Validation Engine: `src/lib/reviews/validation.ts`

1. **`isTemplatePlaceholderReview(item: any): boolean`**
   Inspects review entries against regex patterns:
   - Identifiers: `/^template-/i`, `/^placeholder-/i`
   - Reviewer names: `/\[template placeholder/i`, `/\[customer name placeholder/i`, `/\[placeholder/i`
   - Bodies/comments: `/\[template placeholder/i`, `/replace this with authentic customer feedback/i`, `/customer feedback goes here/i`
   - Source references: `/order-ref-placeholder/i`, `/ref-placeholder/i`
   - Headlines: `/\[review headline placeholder/i`, `/template review headline/i`

2. **`validateSingleReviewItem` Enhancement:**
   - Detects template placeholders and adds error: `"This entry contains template placeholder data. Please replace with authentic customer feedback before publishing."`
   - Flags `isTemplatePlaceholder: true`.
   - Strictly sets `valid = false` and `eligibleForPublication = false`.
   - Validates optional item-level `productId` against `expectedProductId` to detect item-level product mismatches.

3. **`validateReviewImportPayload` Enhancement:**
   - Accepts `options.expectedProductId?: string`.
   - If `payload.productId !== options.expectedProductId`, flags top-level batch mismatch and marks batch invalid.
   - Passes expected product ID to single-item validator.

4. **`isPubliclyPublishedReview` Hardening:**
   - Explicitly rejects records where `r.isTemplatePlaceholder === true` or `isTemplatePlaceholderReview(r) === true`.
   - Guarantees that unedited placeholders never contribute to public star ratings, distributions, or storefront review counts.

---

### 3.3 Server API Hardening: `src/app/api/admin/reviews/`

1. **`POST /api/admin/reviews/validate`:**
   - Reads optional `?productId=...` search parameter.
   - Rejects requests with HTTP 400 if `queryProductId` mismatches `body.productId`.
   - Passes `expectedProductId` to `validateReviewImportPayload`.

2. **`POST /api/admin/reviews/publish-batch`:**
   - Enforces `expectedProductId: productId` during validation.
   - Filters eligible entries: `!e.isSimulation && !e.isTemplatePlaceholder && e.source !== "simulated-test"`.
   - Returns clear error if batch contains only template placeholders: `"Template placeholder entries cannot be published as genuine customer reviews. Replace placeholder data with authentic customer feedback."`
   - Atomic commit loop includes safeguard: `if (entry.isTemplatePlaceholder || isTemplatePlaceholderReview(entry)) continue;`.

---

### 3.4 Admin Interface Enhancements: `src/app/(admin)/admin/reviews/page.tsx`

1. **Product Search & Quick Filter:**
   - Real-time search input (`#product-search`) with clear `✕` button.
   - Filters product select options dynamically with count indicator (`X of Y products`).
   - Friendly empty state when no products match search query.
2. **Authoritative Product Context Display:**
   - Product thumbnail with fallback.
   - Truncated product title with tooltip on hover.
   - Formatted price and category badge.
   - Authoritative document ID chip with 1-click "Copy ID" feedback.
   - URL query parameter synchronization via `window.history.replaceState`.
3. **Product-Specific Review JSON & AI Prompt Generator Toolbar:**
   - Positioned prominently at the top of the Bulk JSON Importer tab.
   - Numeric review count stepper (1–50) with quick chips (`1`, `3`, `5`, `10`, `20`).
   - "Copy JSON Template (N)" button with animated feedback ("✓ JSON Template Copied!").
   - "Copy AI Prompt (N Entries)" button with animated feedback ("✓ AI Prompt Copied!").
   - "View Prompt" button opening interactive modal.
   - "Load into Editor" button loading generated template directly into textarea.
4. **AI Prompt Preview Modal:**
   - Read-only monospace scrollable view of the generated prompt.
   - Displays target product title, document ID, and capacity.
   - Fast 1-click "Copy AI Prompt" action.
5. **Product Mismatch Guard:**
   - Client validation stops immediately if pasted JSON contains a `productId` differing from the selected product, alerting the admin with clear guidance rather than silently rewriting product associations.

---

## 4. Authoritative JSON Schema & Generated AI Prompt

### 4.1 Authoritative TASK 022 JSON Schema

```json
{
  "productId": "bazaarvilla-cramease-pro-massager-belt",
  "reviews": [
    {
      "externalReviewId": "TEMPLATE-bazaarvilla-cra-01",
      "reviewerDisplayName": "[Customer Name Placeholder 1]",
      "rating": 5,
      "title": "[Review Headline Placeholder 1]",
      "body": "[Template Placeholder 1: Replace this with authentic customer feedback for CrampEase Pro Period Pain Relief Massager Belt before importing]",
      "reviewedAt": "2026-11-11",
      "source": "offline-customer-feedback",
      "sourceReference": "ORDER-REF-PLACEHOLDER-01",
      "customerConsentConfirmed": true
    }
  ]
}
```

### 4.2 Generated AI Prompt Example

```text
You are a structured data formatting assistant for the Indian e-commerce storefront Bazaarvilla (https://bazaarvilla.com).

The store administrator will provide you with raw, genuine customer feedback (from WhatsApp messages, offline store receipts, emails, customer support tickets, or handwritten feedback cards).
Your task is to transform that authentic feedback into a valid, strictly formatted JSON payload ready for Bazaarvilla's review ingestion system.

================================================================================
CRITICAL TRUTHFULNESS & INTEGRITY RULES (STRICT COMPLIANCE REQUIRED):
================================================================================
1. DO NOT invent, fabricate, hallucinate, or simulate customer experiences, names, star ratings, or consent.
2. Only process genuine customer feedback provided below by the administrator.
3. If the administrator provides fewer reviews than the requested capacity (5), format ONLY the reviews provided. Never generate synthetic filler reviews.
4. The product ID MUST remain EXACTLY "bazaarvilla-cramease-pro-massager-belt". Do NOT alter, trim, or replace this ID.
5. Every review must have customerConsentConfirmed set to true ONLY IF confirmed by the customer, and sourceReference must refer to the genuine source record (e.g., invoice #, ticket #, or order reference).
6. Return ONLY valid, parseable JSON with NO markdown code fences (no ```json), NO explanation, and NO leading/trailing conversational text.

================================================================================
TARGET PRODUCT CONTEXT:
================================================================================
- Store: Bazaarvilla (https://bazaarvilla.com)
- Target Product ID: bazaarvilla-cramease-pro-massager-belt
- Product Title: CrampEase Pro Period Pain Relief Massager Belt
- Relevant Attributes: Price: ₹1499 | Category: Wellness & Personal Care
- Factual Description: Advanced thermal heating and multi-frequency vibration massage belt designed for rapid abdominal and lower back menstrual pain relief. Features intelligent temperature control and rechargeable battery.
- Maximum Requested Review Capacity: 5 records

================================================================================
EXACT ACCEPTED JSON SCHEMA:
================================================================================
Root object must contain "productId" and an array of "reviews":
{
  "productId": "bazaarvilla-cramease-pro-massager-belt",
  "reviews": [
    {
      "externalReviewId": "string (unique identifier, e.g. 'OFFLINE-INV-10291' or 'WA-FEEDBACK-01', max 100 chars)",
      "reviewerDisplayName": "string (authentic reviewer display name, 1-80 chars)",
      "rating": number (integer between 1 and 5),
      "title": "string (optional concise headline summarizing the feedback, max 150 chars)",
      "body": "string (the authentic customer feedback text, 2 to 3000 chars)",
      "reviewedAt": "string (ISO date 'YYYY-MM-DD' when the feedback was received, e.g. '2026-11-11', not in future)",
      "source": "offline-customer-feedback" | "external-marketplace" | "csv-json-import" | "editorial" | "storefront",
      "sourceReference": "string (invoice, ticket, or reference identifier, min 3 chars)",
      "customerConsentConfirmed": boolean (must be true for eligible publication)
    }
  ]
}

================================================================================
VALID FORMATTING EXAMPLE:
================================================================================
{
  "productId": "bazaarvilla-cramease-pro-massager-belt",
  "reviews": [
    {
      "externalReviewId": "FEEDBACK-REC-8921",
      "reviewerDisplayName": "Sunita Verma",
      "rating": 5,
      "title": "Excellent Quality & Fast Delivery",
      "body": "Received my order in 3 days. The fabric is soft, stitching is neat, and it fits comfortably.",
      "reviewedAt": "2026-11-11",
      "source": "offline-customer-feedback",
      "sourceReference": "INV-2026-8921",
      "customerConsentConfirmed": true
    }
  ]
}

================================================================================
ADMINISTRATOR CUSTOMIZATION INSTRUCTIONS:
================================================================================
You may add instructions below regarding:
- Language: English, Hindi, Hinglish, or regional Indian language (preserve original customer sentiment).
- Formatting & Tone: Keep natural, authentic tone without exaggerated marketing speak.
- Review Length: Concise highlights vs. detailed feedback.
- Star Ratings: Map to genuine customer satisfaction (1=Poor, 2=Fair, 3=Average, 4=Good, 5=Excellent).

================================================================================
PASTE RAW CUSTOMER FEEDBACK BELOW THIS LINE:
================================================================================
1. Customer: ... | Rating: ... | Comment: ... | Source/Invoice: ... | Date: ...
```

---

## 5. Visual QA Verification & Screenshots

All 9 visual QA scenarios were captured in `docs/screenshots/task032/` using Chrome DevTools Protocol connected to a Next.js instance running on port 3333 with Firebase emulators:

| Screenshot | File Name | Viewport | Verified Behavior |
|---|---|---|---|
| **01** | `01-admin-review-generator-overview-desktop-1440px.png` | 1440×900 | Admin Reviews page overview with enhanced product selector, target product context card, Copy ID chip, and the Product-Specific Review JSON & AI Prompt Generator toolbar. |
| **02** | `02-admin-product-search-filtering-desktop-1440px.png` | 1440×900 | Real-time product search filtering the catalog down to matching items with live match counter ("1 of 3 products"). |
| **03** | `03-admin-review-prompt-modal-desktop-1440px.png` | 1440×900 | AI Formatting Prompt preview modal displaying pre-populated product ID, title, attributes, and JSON schema. |
| **04** | `04-admin-template-loaded-into-editor-desktop-1440px.png` | 1440×900 | "Load into Editor" populating the JSON textarea with 5 placeholder entries bound to the selected product ID. |
| **05** | `05-admin-validation-placeholder-detection-desktop-1440px.png` | 1440×900 | Server validation detecting unedited template placeholders, displaying amber "Template Placeholder" badges and rejecting publication eligibility. |
| **06** | `06-admin-genuine-batch-validation-eligible-desktop-1440px.png` | 1440×900 | Validation preview for authentic customer feedback showing green "✓ Eligible" status (2/2 eligible). |
| **07** | `07-admin-review-generator-tablet-768px.png` | 768×1024 | Tablet view showing clean responsive wrapping of selector, count stepper, and action buttons. |
| **08** | `08-admin-review-generator-mobile-375px.png` | 375×812 | Standard mobile viewport showing stacked touch targets (>=44px), full-width cards, and zero horizontal overflow. |
| **09** | `09-admin-review-generator-mobile-320px.png` | 320×568 | Ultra-compact mobile viewport confirming zero layout shifts and clean word wrapping down to 320px. |

---

## 6. Automated Testing Suite & Regression Verification

### 6.1 Unit Tests (`tests/unit/review-prompt-generator.test.ts`)
17 focused unit test criteria were added:
- `GEN-001`: Template generation with accurate product ID and exact requested capacity (default 5).
- `GEN-002`: Review count bounds clamping (clamps <1 to 1, >50 to 50, rounds floats).
- `GEN-003`: Valid parseable JSON conforming strictly to TASK 022 schema.
- `GEN-004`: Generation of unique external review IDs for every placeholder entry.
- `GEN-005`: Clear identification of generated review objects as non-publishable placeholders.
- `GEN-006`: AI prompt content verification (website name `Bazaarvilla`, URL `https://bazaarvilla.com`, product ID, title, review count).
- `GEN-007`: Factual description cleaning and HTML/script tag stripping.
- `GEN-008`: Product attributes formatting (price, category, sizes, colors, tags).
- `GEN-009`: Strict truthfulness & integrity rules forbidding fabricated feedback or simulated consent.
- `GEN-010`: Instruction to format only provided reviews when supply < capacity.
- `GEN-011`: Customization room for language (English/Hindi/Hinglish), tone, and review length.
- `GEN-012`: Placeholder detection logic via `isTemplatePlaceholderReview`.
- `GEN-013`: Rejection of template placeholders from publication eligibility in `validateSingleReviewItem`.
- `GEN-014`: Batch product mismatch rejection when payload `productId` mismatches expected product ID.
- `GEN-015`: Single review item product mismatch rejection when item-level `productId` mismatches.
- `GEN-016`: Strict exclusion of template placeholders from `isPubliclyPublishedReview`.
- `GEN-017`: Admin UI page markup verification (search input, count stepper, copy actions).

### 6.2 Integration Tests (`tests/integration/reviews-bulk-management.test.ts`)
3 focused integration test criteria were added using the Firebase Emulator:
- `REV-IMPORT-015`: Rejection of publishing batches containing template placeholder reviews with HTTP 400.
- `REV-IMPORT-016`: Rejection of review batch validation when target product ID mismatches payload `productId`.
- `REV-IMPORT-017`: Publishing genuine reviews preserves `verifiedPurchase: false` and links to public storefront.

### 6.3 Automated Test Execution Results

```text
Unit Test Suite:
▶ Admin Product Gallery UI & Logic Unit Tests (TASK 025): 5 passed
▶ Admin Responsive Design System & Navigation Unit Tests (TASK 021): 5 passed
▶ Customizable Product COD Restriction Unit Tests (TASK 027): 20 passed
▶ CSV Bulk Product Import Unit Tests (TASK 030): 41 passed
▶ Product Image Containment Unit Tests (TASK 028): 11 passed
▶ Product Purchase Activity Unit Tests (TASK 023): 21 passed
▶ Staging Isolation Guard & Security Unit Tests (TASK 009/010): 8 passed
▶ Storefront Image Quality & Sharpness Unit Tests (TASK 026): 6 passed
▶ Storefront Mobile Responsiveness Unit Tests (TASK 031): 10 passed
▶ Flexible Product Variants Unit Tests (TASK 029): 29 passed
▶ Product-Specific Review JSON & AI Prompt Generator Unit Tests (TASK 032): 17 passed
ℹ tests 207 | pass 207 | fail 0 (100% pass)

Integration Test Suite (Firebase Emulator Suite):
ℹ tests 358 | pass 358 | fail 0 (100% pass across 25 suites)

Total Automated Test Count:
565 unique passing automated tests (207 unit + 358 integration, including 41 security-rule tests)
```

### 6.4 Production Build Verification

```text
▲ Next.js 16.1.6 (Turbopack)
✓ Compiled successfully in 4.1s
✓ Generating static pages using 11 workers (35/35) in 9.0s
✓ 35 / 35 Next.js routes compiled cleanly with 0 TypeScript or bundling errors.
```

---

## 7. Limitations & Architectural Boundaries

1. **No Third-Party Paid AI API Dependency:** Prompt copying and JSON template generation are executed entirely client-side and server-authoritatively. Bazaarvilla does not incur per-token or monthly API subscription fees.
2. **Administrator Custody of Feedback:** The AI prompt provides structured formatting assistance for genuine customer feedback provided by the administrator. It does not scrape external websites or fabricate customer reviews.
3. **Verified Purchase Distinction:** External/offline imported feedback is accurately tagged with `sourceType: "offline-customer-feedback"` and `verifiedPurchase: false`. The `verifiedPurchase: true` badge remains strictly reserved for registered storefront customers with completed in-app orders.

---

## 8. Release Gate & Final Status

- **Git Branch:** `task/032-review-json-ai-prompt-generator`
- **Automated Tests:** 565 / 565 passing (100% pass rate)
- **TypeScript Typecheck:** 0 errors (`tsc --noEmit`)
- **Next.js Production Build:** 35 / 35 routes compiled cleanly
- **Visual QA:** 9 high-fidelity screenshots verified in `docs/screenshots/task032/`
- **Production Deployment Status:** In accordance with project instructions, no production deployment has been executed without explicit owner authorization.

**Final Status:**  
**TASK 032 — LOCALLY COMPLETED AND VERIFIED, PRODUCTION APPROVAL PENDING.**
