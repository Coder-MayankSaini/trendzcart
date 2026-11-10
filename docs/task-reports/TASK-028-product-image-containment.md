# TASK 028 — Bazaarvilla Product Image Containment & No-Crop Gallery Fix

**Task ID:** TASK-028  
**Date:** 2026-11-11  
**Investigator / Engineer:** Principal Full-Stack Engineer, Storefront UX Architect, Media Systems Specialist  
**Primary Tech Stack:** Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5, Cloudflare R2 (`@aws-sdk/client-s3`), Firebase Auth & Cloud Firestore (Spark plan), Razorpay Live Mode (2.9.6), Netlify Hosting  
**Git Branch:** `task/028-product-image-containment`  
**Base Commit:** `87261bc` (TASK 027 Production Deploy) / `ddfcd85` (Documentation Baseline)  
**Production Site:** `https://bazaarvilla.com` (Netlify Site: `trendzcartdemo` / Site ID: `4fb9d66a-fccf-4ea3-8320-5c43c27f2b6c`)  
**Status:** **COMPLETED LOCALLY — STOPPED AT OWNER RELEASE APPROVAL GATE**  

---

## 1. Executive Summary & Objective

On the Bazaarvilla storefront product detail page (PDP), uploaded product photographs were being unintentionally cropped, clipped, and partially hidden by the image display system. Store owners uploading square (1:1), landscape (16:9, 4:3), and ultra-tall (9:16) product photographs discovered that crucial product details, side text, branding labels, and edge borders were truncated.

### Primary Objective:
**Ensure that every uploaded product photograph is displayed completely on product detail pages without unintended cropping, stretching, clipping, or distortion, regardless of its original aspect ratio.**

### Non-Negotiable Operational Constraints:
1. **Preserve Image Sharpness:** Maintain the high-DPI resolution improvements and modern WebP/AVIF formatting established in TASK 026.
2. **Stable Layout Framing (Zero CLS):** Maintain the recommended 4:5 vertical framing container (`1200 × 1500 px`) to prevent Cumulative Layout Shift (CLS) when browsing multi-image galleries with mixed aspect ratios.
3. **No Unintended Catalog Breakage:** Keep catalog grid cards (`ProductCardImage.tsx`) uniform and cohesive while providing explicit containment support.
4. **Commercial Safety Integrity:** Zero modifications to product pricing, inventory locks, customer orders, Razorpay Live payments, Cash on Delivery restrictions from TASK 027, purchase activity counters from TASK 023, review management from TASK 022, or Cloudflare R2 security boundaries.
5. **Production Release Gate:** **Do not deploy to Netlify production without explicit owner approval.**

---

## 2. Mathematical Root Cause Analysis

### The Underlying Cropping Defect:
Prior to this task, both the gallery component stylesheet (`src/app/globals.css`) and inline React properties on the Next.js `<Image>` component (`src/components/storefront/ProductImageGallery.tsx`) enforced `object-fit: cover` within a fixed 4:5 aspect ratio box:

1. **CSS Level:**
   ```css
   .pig-main-img {
     width: 100%;
     height: auto;
     aspect-ratio: 4/5;
     object-fit: cover; /* Forces image to fill the 4:5 frame by clipping overflow */
   }
   ```
2. **Component Level:**
   ```tsx
   <Image
     src={activeImg}
     alt={title}
     width={900}
     height={1125}
     priority
     className="pig-main-img"
     style={{ width: "100%", height: "auto", objectFit: "cover" }} /* Overrides CSS with cover */
   />
   ```

### Mathematical Truncation Quantified:
When `object-fit: cover` is applied to an element with aspect ratio $A_{\text{box}} = 4/5 = 0.8$, the browser scales the source image until **both** width and height completely cover the box, cropping any portion of the source that exceeds the container's bounds:

| Source Aspect Ratio | Source Dimensions | Source Ratio ($W/H$) | Scale Factor ($S$) | Rendered Source Size | Cropped Field Percentage | Loss Description |
|---|---|---|---|---|---|---|
| **16:9 Landscape** | 1600 × 900 px | 1.778 | Scaled by height ($1.0\times$) | 2000 × 1125 px | **55.0% clipped** | 27.5% clipped on left edge, 27.5% clipped on right edge. Product sides completely invisible. |
| **4:3 Standard Photo** | 1600 × 1200 px | 1.333 | Scaled by height ($1.0\times$) | 1500 × 1125 px | **40.0% clipped** | 20.0% cropped horizontally from each side. |
| **1:1 Square** | 1200 × 1200 px | 1.000 | Scaled by height ($1.0\times$) | 1125 × 1125 px | **20.0% clipped** | 10.0% cropped horizontally from each side (e.g., logos, packaging text cut off). |
| **3:4 Portrait** | 900 × 1200 px | 0.750 | Scaled by width ($1.0\times$) | 900 × 1200 px | **6.25% clipped** | 3.125% cropped top and bottom under 4:5 cover frame. |
| **4:5 Portrait** | 1200 × 1500 px | 0.800 | Exact match ($1.0\times$) | 900 × 1125 px | **0.0%** | Baseline ratio; fits perfectly. |
| **9:16 Tall Portrait** | 900 × 1600 px | 0.5625 | Scaled by width ($1.0\times$) | 900 × 1600 px | **29.7% clipped** | 14.85% cropped from top, 14.85% cropped from bottom (e.g., apparel collars or hems cut off). |

---

## 3. Architecture & Technical Implementation

To resolve this issue permanently without causing layout instability, the gallery was re-architected with **Container-Level Framing + Image-Level Containment**:

```
+--------------------------------------------------------------+
| .pig-main (Container Frame: aspect-ratio: 4/5, Flex Centered) |
| Neutral Secondary Background: var(--bg-secondary)             |
|                                                              |
|       +----------------------------------------------+       |
|       | .pig-main-img (object-fit: contain)          |       |
|       | Full image visible: 100% of source pixels    |       |
|       | Left, Right, Top & Bottom fully preserved    |       |
|       +----------------------------------------------+       |
|                                                              |
| [1 / 4 Badge] (z-index: 2, anchored bottom-right)            |
+--------------------------------------------------------------+
| [.pig-thumb] [.pig-thumb] [.pig-thumb] [.pig-thumb]          |
| (object-fit: contain inside square thumbnail preview buttons) |
+--------------------------------------------------------------+
```

### Detailed File Changes:

#### 1. `src/app/globals.css`
- **`.pig-main`:** Configured with `aspect-ratio: 4/5; display: flex; align-items: center; justify-content: center; background: var(--bg-secondary); overflow: hidden; position: relative;`. This guarantees a solid, zero-CLS vertical frame.
- **`.pig-main-img`:** Changed `object-fit: cover` to `object-fit: contain; width: 100%; height: auto; max-height: 100%; aspect-ratio: 4/5;`.
- **`.pig-thumb`:** Added flex alignment and secondary background: `display: flex; align-items: center; justify-content: center; background: var(--bg-secondary);`.
- **`.pig-thumb img`:** Changed `object-fit: cover` to `object-fit: contain;` so thumbnail buttons preview the complete, uncropped product photo.
- **`.pig-counter`:** Added `z-index: 2;` so counter badge (`1 / 4`) floats cleanly above contained imagery without z-index collisions.

#### 2. `src/components/storefront/ProductImageGallery.tsx`
- Upgraded master image attributes to recommended production dimensions `width={1200}` and `height={1500}` with `priority`.
- Removed inline `objectFit: "cover"` override and replaced with `style={{ width: "100%", height: "auto", maxHeight: "100%", objectFit: "contain" }}`.
- Replaced thumbnail inline styles with `style={{ width: "100%", height: "100%", objectFit: "contain" }}`.
- Added explicit test IDs: `data-testid="pig-container"`, `data-testid="pig-thumbs"`, `data-testid="pig-main"`, `data-testid="pig-main-img"`, `data-testid="pig-counter"`.

#### 3. `src/components/storefront/ProductCardImage.tsx`
- Extended component props with optional `objectFit?: "cover" | "contain" = "cover"`.
- Preserved uniform catalog grid presentation across `/products` and homepage while providing flexible containment support when required.

#### 4. `src/components/admin/AdminProducts.tsx`
- Updated upload dropzone instructions to eliminate merchant confusion:
  ```tsx
  <p className="admin-dropzone-title">
    Drop product images here, or <span className="admin-dropzone-browse">browse</span>
  </p>
  <p className="admin-dropzone-hint">
    Recommended: 4:5 portrait (1200 × 1500 px) · Square & landscape images also fully supported without cropping
  </p>
  <p className="admin-dropzone-sub">
    PNG, JPG, WebP up to 10MB each. Compressed & auto-optimized to Cloudflare R2 on save.
  </p>
  ```
- Retained all existing 10MB validation, R2 upload boundaries, and compression safeguards. Non-4:5 uploads are fully accepted.

#### 5. `package.json`
- Added `tests/unit/image-containment.test.ts` to `npm test` script.

---

## 4. Visual Evidence & Before/After QA Verification

### Diagnostic Aspect Ratio Test Fixtures:
To empirically verify that edges and corners are 100% visible, five synthetic test fixtures were generated in `public/test-fixtures/`:
1. **16:9 Landscape (`landscape-16-9.png`):** 1600 × 900 px with blue edge border, red corner markers, and bright yellow edge text: `◀◀ LEFT EDGE (CROPPED UNDER COVER) ◀◀` and `▶▶ RIGHT EDGE (CROPPED UNDER COVER) ▶▶`.
2. **1:1 Square (`square-1-1.png`):** 1200 × 1200 px with amber edge border, red corner markers, and yellow side markers.
3. **3:4 Portrait (`portrait-3-4.png`):** 900 × 1200 px with pink edge border, red corner markers, and full boundary framing.
4. **4:5 Portrait (`portrait-4-5.png`):** 1200 × 1500 px with green edge border and red corner markers.
5. **9:16 Tall Portrait (`tall-portrait-9-16.png`):** 900 × 1600 px with purple edge border, red corner markers, and top/bottom edge markers.

### Screenshot Comparison Matrix:

| Viewport & Test Condition | BEFORE (Cropped with `object-fit: cover`) | AFTER (100% Contained with `object-fit: contain`) | Edge & Corner Verification Status |
|---|---|---|---|
| **16:9 Landscape (Desktop 1440px)** | [`before-01-pdp-landscape-16-9-desktop-1440px.png`](../screenshots/task028/before-01-pdp-landscape-16-9-desktop-1440px.png) | [`after-01-pdp-landscape-16-9-desktop-1440px.png`](../screenshots/task028/after-01-pdp-landscape-16-9-desktop-1440px.png) | **100% Visible:** Left and right edge banners (`◀◀ LEFT EDGE`, `▶▶ RIGHT EDGE`) and all 4 red corners (`TL`, `TR`, `BL`, `BR`) were completely clipped off under BEFORE; fully visible and centered with clean neutral padding under AFTER. |
| **1:1 Square (Desktop 1440px)** | [`before-02-pdp-square-1-1-desktop-1440px.png`](../screenshots/task028/before-02-pdp-square-1-1-desktop-1440px.png) | [`after-02-pdp-square-1-1-desktop-1440px.png`](../screenshots/task028/after-02-pdp-square-1-1-desktop-1440px.png) | **100% Visible:** Side markers were partially truncated under BEFORE; all 4 corners and complete borders are uncropped under AFTER. |
| **3:4 Portrait (Desktop 1440px)** | *(Slight crop under before)* | [`after-02b-pdp-portrait-3-4-desktop-1440px.png`](../screenshots/task028/after-02b-pdp-portrait-3-4-desktop-1440px.png) | **100% Visible:** 900 × 1200 px photo fully displayed without vertical truncation, centered in 4:5 frame. |
| **4:5 Portrait (Desktop 1440px)** | [`before-03-pdp-portrait-4-5-desktop-1440px.png`](../screenshots/task028/before-03-pdp-portrait-4-5-desktop-1440px.png) | [`after-03-pdp-portrait-4-5-desktop-1440px.png`](../screenshots/task028/after-03-pdp-portrait-4-5-desktop-1440px.png) | **100% Visible:** Baseline portrait photograph fills the 4:5 frame with zero distortion or blank space. |
| **9:16 Tall Portrait (Desktop 1440px)** | *(Not captured in before)* | [`after-04-pdp-tall-portrait-9-16-desktop-1440px.png`](../screenshots/task028/after-04-pdp-tall-portrait-9-16-desktop-1440px.png) | **100% Visible:** Top and bottom headers completely visible, centered horizontally with neutral flanking bars. |
| **Mobile 320px (iPhone SE)** | — | [`after-05-pdp-responsive-320px.png`](../screenshots/task028/after-05-pdp-responsive-320px.png) | **100% Visible:** Gallery container fits viewport, zero horizontal scrollbar, thumbnail row scrolls smoothly. |
| **Mobile 375px (iPhone Mini)** | [`before-04-pdp-landscape-mobile-375px.png`](../screenshots/task028/before-04-pdp-landscape-mobile-375px.png) | [`after-06-pdp-responsive-375px.png`](../screenshots/task028/after-06-pdp-responsive-375px.png) | **100% Visible:** In BEFORE, landscape photo was heavily cropped horizontally on mobile. In AFTER, the full landscape photo is cleanly contained. |
| **Mobile 430px (iPhone Pro Max)** | — | [`after-07-pdp-responsive-430px.png`](../screenshots/task028/after-07-pdp-responsive-430px.png) | **100% Visible:** Clean full-width card layout, pristine sharpness, uncropped borders. |
| **Tablet 768px (iPad Portrait)** | — | [`after-08-pdp-responsive-768px.png`](../screenshots/task028/after-08-pdp-responsive-768px.png) | **100% Visible:** Gallery column perfectly balanced with product info, contained image sharp and centered. |
| **Laptop 1024px (Small Desktop)** | — | [`after-09-pdp-responsive-1024px.png`](../screenshots/task028/after-09-pdp-responsive-1024px.png) | **100% Visible:** 2-column PDP grid layout; images contain cleanly within gallery frame. |
| **Desktop 1440px (Wide Display)** | — | [`after-10-pdp-responsive-1440px.png`](../screenshots/task028/after-10-pdp-responsive-1440px.png) | **100% Visible:** High-definition presentation with zero blur, zero clipping. |
| **Gallery Thumbnail Interaction** | — | [`after-11-pdp-gallery-navigation-selected.png`](../screenshots/task028/after-11-pdp-gallery-navigation-selected.png) | **100% Verified:** Thumbnail selected; green active border visible; main view instantaneously displays contained photo; counter badge displays clean count. |
| **Admin Upload Guidance** | — | [`after-12-admin-products-dropzone-recommendations.png`](../screenshots/task028/after-12-admin-products-dropzone-recommendations.png) | **100% Verified:** Dropzone displays updated text: `Recommended: 4:5 portrait (1200 × 1500 px) · Square & landscape images also fully supported without cropping`. |

---

## 5. Gallery Navigation, Sharpness & Media Isolation

1. **Multi-Image Thumbnail Switching:**
   - Thumbnail previews use `object-fit: contain` so merchants and customers can see the full shape of every photo before clicking.
   - Active thumbnail receives high-contrast brand border (`2px solid var(--primary)`).
   - Thumbnail switching is instantaneous and causes zero Cumulative Layout Shift (CLS = 0) because `.pig-main` maintains a strict `aspect-ratio: 4/5` bounding box.
   - Counter badge (`.pig-counter`) is elevated with `z-index: 2` to float neatly over contained imagery.
2. **Sharpness & High-DPI Rendering:**
   - Main PDP image utilizes Next.js `<Image>` with recommended dimensions `width={1200}` and `height={1500}` with `priority`.
   - High-density responsive `sizes` attribute (`(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 600px`) ensures devices load high-resolution assets without downsampling blur.
   - Modern image formats (`image/avif`, `image/webp`) from TASK 026 are preserved.
3. **Cloudflare R2 Media Isolation:**
   - Path-based asset delivery (`/api/media/public/[...key]`) established in TASK 024 remains completely untouched.
   - Zero category image contamination or cross-entity asset pollution.

---

## 6. Automated Regression Testing Suite

A dedicated unit test suite was authored in `tests/unit/image-containment.test.ts` covering 10 distinct verification criteria (`CONTAIN-001` through `CONTAIN-010`):

| Test ID | Test Description | Assertions & Scope | Result |
|---|---|---|---|
| `CONTAIN-001` | Main Gallery CSS Containment | Verifies `.pig-main-img` uses `object-fit: contain` in `src/app/globals.css`. | **PASS** |
| `CONTAIN-002` | Main Gallery Bounding Box & Centering | Verifies `.pig-main` specifies `aspect-ratio: 4/5`, `display: flex`, and centering rules. | **PASS** |
| `CONTAIN-003` | Counter Badge Z-Index | Verifies `.pig-counter` has `z-index: 2` to prevent overlap clipping. | **PASS** |
| `CONTAIN-004` | Thumbnail Buttons Containment | Verifies `.pig-thumb img` uses `object-fit: contain` and `.pig-thumb` uses flex centering. | **PASS** |
| `CONTAIN-005` | ProductImageGallery Inline Containment | Verifies JSX enforces `objectFit: "contain"` and does not hardcode `objectFit: "cover"`. | **PASS** |
| `CONTAIN-006` | High-Resolution Dimensions | Verifies main image renders with `width={1200}` and `height={1500}`. | **PASS** |
| `CONTAIN-007` | Thumbnail Strip Inline Containment | Verifies thumbnail images in gallery strip enforce `objectFit: "contain"`. | **PASS** |
| `CONTAIN-008` | ProductCardImage Prop Flexibility | Verifies `ProductCardImage` supports optional `objectFit` prop and defaults to `"cover"`. | **PASS** |
| `CONTAIN-009` | Admin Dropzone Guidance | Verifies upload dropzone copy explicitly welcomes square and landscape images. | **PASS** |
| `CONTAIN-010` | Non-4:5 File Size and MIME Security | Verifies image validation preserves 10MB limits, MIME checking, and does not reject non-4:5 ratios. | **PASS** |

### Complete Test Suite Execution Results:

```
> npm test
...
PASS tests/unit/image-containment.test.ts
  Product Image Containment & Gallery Verification (TASK 028)
    √ CONTAIN-001: globals.css configures .pig-main-img with object-fit: contain (1 ms)
    √ CONTAIN-002: globals.css configures .pig-main with aspect-ratio: 4/5, flex centering, and secondary background (1 ms)
    √ CONTAIN-003: globals.css ensures .pig-counter has elevated z-index (1 ms)
    √ CONTAIN-004: globals.css configures .pig-thumb img with object-fit: contain and flex centering (1 ms)
    √ CONTAIN-005: ProductImageGallery.tsx enforces objectFit: contain on main image and eliminates objectFit: cover (1 ms)
    √ CONTAIN-006: ProductImageGallery.tsx specifies high-resolution 1200x1500 dimensions (1 ms)
    √ CONTAIN-007: ProductImageGallery.tsx enforces objectFit: contain on thumbnail strip items (1 ms)
    √ CONTAIN-008: ProductCardImage.tsx supports explicit objectFit prop while defaulting safely to cover (1 ms)
    √ CONTAIN-009: AdminProducts.tsx dropzone copy provides clear 4:5 recommendation while supporting square and landscape (1 ms)
    √ CONTAIN-010: Validation retains 10MB limit and does not reject non-4:5 aspect ratios (1 ms)

Test Suites: 9 passed, 9 total
Tests:       109 passed, 109 total
Snapshots:   0 total
Time:        3.421 s

> npm run test:rules
Test Suites: 1 passed, 1 total
Tests:       39 passed, 39 total
Snapshots:   0 total
Time:        15.422 s

> npm run test:integration
Test Suites: 23 passed, 23 total
Tests:       297 passed, 297 total
Snapshots:   0 total
Time:        38.834 s

> npm run typecheck
TypeScript compiled cleanly with 0 errors.

> npm run build
Turbopack compiled 35 Next.js production routes cleanly in 3.9s.
```

### Automated Test Count Progression:
- **Baseline (TASK 027):** 396 unique tests (99 unit + 297 integration).
- **New Containment Tests Added:** 10 unique unit tests (`tests/unit/image-containment.test.ts`).
- **Current Total (TASK 028):** **406 unique automated tests passing** (109 unit + 297 integration; zero double-counting).

---

## 7. Commercial Safety & Boundary Verification

The following commercial systems were audited and verified 100% untouched:
- **Product Pricing & Catalog:** No catalog prices, discounts, or coupon codes modified.
- **Inventory Locks & Transactions:** `/api/orders/create` inventory reservation transactions untouched.
- **Payment Gateway:** Razorpay Live credentials (`rzp_live_Ty8CuwoSSBGpHi`), webhook handlers, and server verification unchanged.
- **Cash on Delivery Restrictions (TASK 027):** Mixed-cart COD restrictions for customizable products untouched.
- **Purchase Activity Counter (TASK 023):** Social proof counter logic, time windows, and admin configuration untouched.
- **Review Management (TASK 022):** Review import, moderation, and rating distribution systems untouched.
- **Cloudflare R2 Storage Security:** R2 bucket permissions, presigned PUT signing, and public delivery paths unchanged.
- **Database Migrations:** Zero Firestore document or index schema migrations required.

---

## 8. Preserved Future Backlog

In accordance with architectural planning, the following upcoming capabilities remain queued for subsequent tasks:
1. **Flexible Product Sizes, Physical Dimensions, and Color Variants:**
   - Multi-attribute variant matrix (size + color).
   - Apparel sizing (XS, S, M, L, XL, XXL, Free Size) and metric physical dimensions (e.g., `26 × 26 cm`).
   - Variant-level SKU, price override, and stock tracking.
2. **Shopify-Compatible CSV Bulk Product Importer:**
   - Downloadable Bazaarvilla CSV template + Shopify column mapping.
   - Pre-import validation, error reporting, and non-destructive batch audit logging.
   - Variant and dimension integration powered by the flexible variant schema.

---

## 9. Release Gate & Deployment Readiness

> [!IMPORTANT]
> **MANDATORY PRODUCTION RELEASE GATE**  
> Local implementation, automated regression testing (406 unique tests passing), and visual QA verification across all 6 viewports and 4 aspect ratios are 100% complete.  
> **Deployment to Netlify production (`https://bazaarvilla.com`) is paused awaiting explicit owner authorization.**

### Readiness Checklist:
- [x] Actual cause of image cropping diagnosed and proven mathematically.
- [x] Complete source image visibility verified across portrait (4:5), square (1:1), landscape (16:9), and tall portrait (9:16).
- [x] Zero cropping, zero distortion, zero clipping confirmed via visual test fixtures.
- [x] Zero Cumulative Layout Shift (CLS = 0) achieved via container-level framing.
- [x] Gallery thumbnail navigation and counter badge verified across desktop and mobile.
- [x] Admin dropzone recommendations updated.
- [x] Responsive layout verified at 320px, 375px, 430px, 768px, 1024px, and 1440px.
- [x] 109/109 unit tests passing (`npm test`).
- [x] 39/39 security rules tests passing (`npm run test:rules`).
- [x] 297/297 integration tests passing (`npm run test:integration`).
- [x] 0 TypeScript compilation errors (`npm run typecheck`).
- [x] 35/35 production routes compiled cleanly with Turbopack (`npm run build`).
- [x] 406 total unique passing automated tests (10 new tests added).
- [x] All commercial payment, inventory, and COD boundaries preserved.
- [x] Stopped at the Owner Production Approval Gate.
